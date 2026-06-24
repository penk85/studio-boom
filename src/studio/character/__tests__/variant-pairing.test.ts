import { describe, expect, it } from "vitest";
import type { CharacterPreset } from "../../types";
import {
  getPartSlotId,
  makePart,
  variantKeyForPart,
  variantKeySourceForPart,
} from "../character-utils";
import {
  anchorEntryForChild,
  anchorSourceForChild,
  buildRigHealthReport,
  collectVariantKeyIssues,
  findVariantKeyNearMisses,
  isUnkeyedVariantPart,
  migrateLegacyVariantSockets,
  normalizeVariantKey,
  removeVariantPin,
  resetVariantPinToArtwork,
  renameVariantKeyEverywhere,
  setVariantPinRotation,
  slotVariantKeys,
  upsertVariantPinAtPoint,
  variantPreviewDeltas,
} from "../variant-pairing";
import { normalizeCharacterRig } from "../rig";
import { makeVariantArmCharacter } from "./fixtures";

function withHandKey(character: CharacterPreset, key: string): CharacterPreset {
  return {
    ...character,
    parts: character.parts.map((part) =>
      part.id === "hand-bent"
        ? { ...part, pose: key, variant: { ...(part.variant ?? { kind: "pose" }), key } }
        : part,
    ),
  };
}

const bentArmSocketPackage = {
  id: "variant:arm-bent",
  slotId: "slot:right-arm",
  key: "bent",
  displayName: "Bent arm",
  rig: {
    sockets: {
      outputs: [{ id: "socket:wrist", childSlotId: "slot:right-hand", x: 352, y: 248 }],
    },
  },
};

/** Author the bent-arm wrist pin on the active parent artwork. */
function withWristSocket(
  character: CharacterPreset,
  opts: { x?: number; y?: number; rotation?: number } = {},
): CharacterPreset {
  const placed = upsertVariantPinAtPoint(character, {
    parentSlotId: "slot:right-arm",
    variantKey: "bent",
    childSlotId: "slot:right-hand",
    anchorPoint: { x: opts.x ?? 352, y: opts.y ?? 248 },
  });
  return opts.rotation === undefined
    ? placed
    : setVariantPinRotation(placed, {
        parentSlotId: "slot:right-arm",
        variantKey: "bent",
        childSlotId: "slot:right-hand",
        rotation: opts.rotation,
      });
}

describe("variantKeySourceForPart", () => {
  it("mirrors variantKeyForPart's fallback order and names the winning source", () => {
    const base = { id: "p1" };
    expect(variantKeySourceForPart({ ...base, variant: { key: " open " } })).toEqual({
      key: "open",
      source: "explicitKey",
    });
    expect(variantKeySourceForPart({ ...base, variantPackageId: "pkg-1", pose: "x" })).toEqual({
      key: "pkg-1",
      source: "package",
    });
    expect(variantKeySourceForPart({ ...base, viseme: "A", pose: "x" })).toEqual({
      key: "A",
      source: "viseme",
    });
    expect(variantKeySourceForPart({ ...base, eyeState: "open", pose: "x" })).toEqual({
      key: "open",
      source: "eyeState",
    });
    expect(variantKeySourceForPart({ ...base, pose: "bent" })).toEqual({
      key: "bent",
      source: "pose",
    });
    expect(variantKeySourceForPart(base)).toEqual({ key: "p1", source: "idFallback" });
    // The refactored variantKeyForPart can never drift from the source resolution.
    for (const part of [
      { ...base, variant: { key: "open" } },
      { ...base, viseme: "A" as const },
      base,
    ]) {
      expect(variantKeyForPart(part)).toBe(variantKeySourceForPart(part).key);
    }
  });
});

describe("slotVariantKeys", () => {
  it("collects distinct part keys and package keys for a slot", () => {
    const character = makeVariantArmCharacter();
    expect(slotVariantKeys(character, "slot:right-arm")).toEqual(["straight", "bent"]);
    const withPackage = {
      ...character,
      variantPackages: [{ ...bentArmSocketPackage, key: "raised" }],
    };
    expect(slotVariantKeys(withPackage, "slot:right-arm")).toEqual(["straight", "bent", "raised"]);
  });

  it("filters part and package keys to the active angle when provided", () => {
    const character: CharacterPreset = {
      ...makeVariantArmCharacter(),
      angles: ["front", "3qR"],
      parts: [
        makePart("body", "front-neutral-media", {
          id: "front-neutral",
          slotId: "role:body",
          pose: "neutral",
          angleIds: ["front"],
        }),
        makePart("body", "front-turned-media", {
          id: "front-turned",
          slotId: "role:body",
          pose: "turned",
          angleIds: ["front"],
        }),
        makePart("body", "3qr-neutral-media", {
          id: "3qr-neutral",
          slotId: "role:body",
          pose: "neutral",
          angleIds: ["3qR"],
        }),
      ],
      variantPackages: [
        {
          id: "variant:front-body-package",
          slotId: "role:body",
          key: "front-package",
          displayName: "Front package",
          angleIds: ["front"],
        },
      ],
    };

    expect(slotVariantKeys(character, "role:body", "front")).toEqual([
      "neutral",
      "turned",
      "front-package",
    ]);
    expect(slotVariantKeys(character, "role:body", "3qR")).toEqual(["neutral"]);
  });
});

describe("findVariantKeyNearMisses", () => {
  it("flags case/whitespace near-misses as warnings when they cost an anchor", () => {
    const misses = findVariantKeyNearMisses(withHandKey(makeVariantArmCharacter(), "Bent"));
    expect(misses).toHaveLength(1);
    expect(misses[0]).toMatchObject({
      parentSlotId: "slot:right-arm",
      childSlotId: "slot:right-hand",
      parentKey: "bent",
      childKey: "Bent",
      childPartId: "hand-bent",
      severity: "warning",
    });
    expect(normalizeVariantKey(misses[0].childKey)).toBe(normalizeVariantKey(misses[0].parentKey));
  });

  it("downgrades to info when an authored socket resolves the anchor anyway", () => {
    const character = withWristSocket(withHandKey(makeVariantArmCharacter(), "Bent"));
    const misses = findVariantKeyNearMisses(character);
    expect(misses).toHaveLength(1);
    expect(misses[0].severity).toBe("info");
  });

  it("reports nothing for exact matches or unrelated keys", () => {
    expect(findVariantKeyNearMisses(makeVariantArmCharacter())).toEqual([]);
    expect(findVariantKeyNearMisses(withHandKey(makeVariantArmCharacter(), "raised"))).toEqual([]);
  });
});

describe("isUnkeyedVariantPart / collectVariantKeyIssues", () => {
  it("flags id-fallback keys only inside multi-variant slots", () => {
    const character = makeVariantArmCharacter();
    const unkeyed = character.parts.map((part) =>
      part.id === "hand-bent" ? { ...part, pose: undefined, variant: undefined } : part,
    );
    const modified = { ...character, parts: unkeyed };
    const handBent = modified.parts.find((part) => part.id === "hand-bent")!;
    const body = modified.parts.find((part) => part.id === "body")!;
    expect(isUnkeyedVariantPart(modified, handBent)).toBe(true);
    // Body is alone in its slot — id fallback is normal there.
    expect(isUnkeyedVariantPart(modified, body)).toBe(false);

    const issues = collectVariantKeyIssues(modified);
    expect(issues.get("hand-bent")?.some((issue) => issue.severity === "warning")).toBe(true);
    expect(issues.has("body")).toBe(false);
  });

  it("attaches near-miss messages to the child part with the slot label", () => {
    const issues = collectVariantKeyIssues(withHandKey(makeVariantArmCharacter(), "Bent"));
    const messages = issues.get("hand-bent")?.map((issue) => issue.message) ?? [];
    expect(
      messages.some((message) => message.includes('"Bent"') && message.includes('"bent"')),
    ).toBe(true);
    expect(issues.get("hand-straight")).toBeUndefined();
  });
});

describe("variantPreviewDeltas", () => {
  it("returns empty maps when nothing is previewed", () => {
    const shift = variantPreviewDeltas(makeVariantArmCharacter(), {});
    expect(shift.parts.size).toBe(0);
    expect(shift.bones.size).toBe(0);
  });

  it("shifts the hand parts by the bent-arm paired anchor delta", () => {
    const shift = variantPreviewDeltas(makeVariantArmCharacter(), {
      "slot:right-arm": "bent",
    });
    // Hand bone base (10, 175) → bent anchor (80, 60): delta (70, -115).
    expect(shift.bones.get("bone:slot:right-hand")).toEqual({ dx: 70, dy: -115, rotation: 0 });
    expect(shift.parts.get("hand-straight")).toEqual({ dx: 70, dy: -115, rotation: 0 });
    expect(shift.parts.get("hand-bent")).toEqual({ dx: 70, dy: -115, rotation: 0 });
    // The arm itself does not move — only re-anchored children do.
    expect(shift.parts.get("arm-straight")).toBeUndefined();
    expect(shift.parts.get("body")).toBeUndefined();
  });

  it("uses an authored socket anchor when one exists", () => {
    const character = withWristSocket(makeVariantArmCharacter());
    const shift = variantPreviewDeltas(character, { "slot:right-arm": "bent" });
    // Socket (352, 248) − arm pivot (290, 170) = anchor (62, 78); base (10, 175) → (52, -97).
    expect(shift.bones.get("bone:slot:right-hand")).toEqual({ dx: 52, dy: -97, rotation: 0 });
  });

  it("previewing the representative variant produces no shift", () => {
    const shift = variantPreviewDeltas(makeVariantArmCharacter(), {
      "slot:right-arm": "straight",
    });
    expect(shift.parts.size).toBe(0);
  });

  it("pivot-aligns a slot's own previewed variant onto the joint at rest", () => {
    // Hand previews "bent" while the arm stays straight: the bent art must ride the straight
    // wrist (pivot-aligned, like playback), not sit at its authored canvas spot.
    const shift = variantPreviewDeltas(makeVariantArmCharacter(), {
      "slot:right-hand": "bent",
    });
    // Runtime placement already aligns every variant registration to the slot bone.
    expect(shift.parts.get("hand-bent")).toBeUndefined();
    // The representative and other slots keep their authored spots.
    expect(shift.parts.get("hand-straight")).toBeUndefined();
    expect(shift.parts.get("arm-straight")).toBeUndefined();
  });

  it("composes own-slot alignment with the parent's bone re-anchor", () => {
    // Arm bent moves the hand bone to the bent-arm pin; the selected hand follows that bone.
    const shift = variantPreviewDeltas(makeVariantArmCharacter(), {
      "slot:right-arm": "bent",
      "slot:right-hand": "bent",
    });
    expect(shift.parts.get("hand-bent")).toEqual({ dx: 70, dy: -115, rotation: 0 });
    // With an authored pin, the displayed hand lands on that exact joint.
    const socketShift = variantPreviewDeltas(withWristSocket(makeVariantArmCharacter()), {
      "slot:right-arm": "bent",
      "slot:right-hand": "bent",
    });
    expect(socketShift.parts.get("hand-bent")).toEqual({ dx: 52, dy: -97, rotation: 0 });
  });

  it("never aligns face slots (eyes and mouths keep authored placement)", () => {
    const base = makeVariantArmCharacter();
    const character: CharacterPreset = {
      ...base,
      parts: [
        ...base.parts,
        makePart("mouth", "mouth-rest-media", {
          id: "mouth-rest",
          slotId: "role:mouth",
          viseme: "rest",
          x: 210,
          y: 260,
          width: 90,
          height: 42,
          zIndex: 5,
          pivot: { x: 255, y: 281 },
        }),
        makePart("mouth", "mouth-a-media", {
          id: "mouth-a",
          slotId: "role:mouth",
          viseme: "A",
          x: 214,
          y: 250,
          width: 90,
          height: 54,
          zIndex: 5,
          pivot: { x: 240, y: 270 },
        }),
      ],
    };
    const shift = variantPreviewDeltas(character, { "role:mouth": "A" });
    expect(shift.parts.size).toBe(0);
  });
});

describe("variant pin writes", () => {
  it("authors the pin on the active parent variant without creating packages", () => {
    const character = withWristSocket(makeVariantArmCharacter());
    expect(character.variantPackages).toBeUndefined();
    const bentArm = character.parts.find((part) => part.id === "arm-bent");
    expect(bentArm?.pins?.["wrist:right"]).toMatchObject({ x: 72, y: 88 });
    expect(anchorSourceForChild(character, "slot:right-hand", "bent")).toBe("pin");
    expect(anchorEntryForChild(character, "slot:right-hand", "bent")).toMatchObject({
      x: 62,
      y: 78,
      source: "pin",
    });
  });

  it("updates an existing pin in place", () => {
    const character = withWristSocket(withWristSocket(makeVariantArmCharacter()), {
      x: 360,
      y: 240,
    });
    expect(
      character.parts.find((part) => part.id === "arm-bent")?.pins?.["wrist:right"],
    ).toMatchObject({ x: 80, y: 80 });
  });

  it("places a pin from a desired canvas anchor point", () => {
    const character = upsertVariantPinAtPoint(makeVariantArmCharacter(), {
      parentSlotId: "slot:right-arm",
      variantKey: "bent",
      childSlotId: "slot:right-hand",
      // Want the hand bone to land at canvas (370, 230) — the bent wrist.
      anchorPoint: { x: 370, y: 230 },
    });
    expect(anchorEntryForChild(character, "slot:right-hand", "bent")).toMatchObject({
      x: 80,
      y: 60,
      source: "pin",
    });
  });

  it("removes a pin and leaves the required contract visibly unresolved", () => {
    const withSocket = withWristSocket(makeVariantArmCharacter());
    const cleared = removeVariantPin(withSocket, {
      parentSlotId: "slot:right-arm",
      variantKey: "bent",
      childSlotId: "slot:right-hand",
    });
    expect(cleared.variantPackages).toBeUndefined();
    expect(anchorSourceForChild(cleared, "slot:right-hand", "bent")).toBe("fallback");
  });

  it("resets a bad persisted pin from the child artwork pivot", () => {
    const placed = withWristSocket(makeVariantArmCharacter(), { x: 500, y: 500 });
    const repaired = resetVariantPinToArtwork(placed, {
      parentSlotId: "slot:right-arm",
      variantKey: "bent",
      childSlotId: "slot:right-hand",
    });
    expect(anchorEntryForChild(repaired, "slot:right-hand", "bent")).toMatchObject({
      x: 80,
      y: 60,
      source: "pin",
    });
  });
});

describe("migrateLegacyVariantSockets", () => {
  it("converts legacy package sockets into per-angle rig joints and strips them", () => {
    const character: CharacterPreset = {
      ...makeVariantArmCharacter(),
      // Auto-generated displayName (equals the key) marks the package as a writer-made shell.
      variantPackages: [{ ...bentArmSocketPackage, displayName: "bent" }],
    };
    const migrated = migrateLegacyVariantSockets(character);
    // Strictly-empty shell after stripping (auto displayName, no artwork/metadata) is pruned.
    expect(migrated.variantPackages).toBeUndefined();
    const wristSocket = migrated.rig?.sockets?.find(
      (socket) => socket.slotId === "slot:right-arm" && socket.childSlotId === "slot:right-hand",
    );
    expect(wristSocket?.variantAnchors.bent).toMatchObject({ x: 352, y: 248 });
    expect(anchorSourceForChild(migrated, "slot:right-hand", "bent")).toBe("pin");
    // Idempotent: a second run is a no-op (nothing legacy left to migrate).
    expect(migrateLegacyVariantSockets(migrated)).toBe(migrated);
  });

  it("keeps packages that still carry user content, stripping only their sockets", () => {
    const character: CharacterPreset = {
      ...makeVariantArmCharacter(),
      variantPackages: [
        {
          ...bentArmSocketPackage,
          aiMetadata: { plainDescription: "Bent arm for explaining." },
        },
      ],
    };
    const migrated = migrateLegacyVariantSockets(character);
    expect(migrated.variantPackages).toHaveLength(1);
    expect(migrated.variantPackages?.[0].aiMetadata).toBeDefined();
    expect(migrated.variantPackages?.[0].rig).toBeUndefined();
    expect(
      migrated.rig?.sockets?.find(
        (socket) => socket.slotId === "slot:right-arm" && socket.childSlotId === "slot:right-hand",
      )?.variantAnchors.bent,
    ).toMatchObject({ x: 352, y: 248 });
  });

  it("scopes legacy sockets by the package's angleIds", () => {
    const character: CharacterPreset = {
      ...makeVariantArmCharacter(),
      angles: ["front", "sideL"],
      variantPackages: [{ ...bentArmSocketPackage, angleIds: ["front"] }],
    };
    const migrated = migrateLegacyVariantSockets(character);
    expect(
      migrated.rig?.angles?.front?.sockets?.find(
        (socket) => socket.slotId === "slot:right-arm" && socket.childSlotId === "slot:right-hand",
      )?.variantAnchors.bent,
    ).toMatchObject({ x: 352, y: 248 });
    expect(
      migrated.rig?.angles?.sideL?.sockets?.find(
        (socket) => socket.slotId === "slot:right-arm" && socket.childSlotId === "slot:right-hand",
      )?.variantAnchors.bent,
    ).toBeUndefined();
  });
});

describe("renameVariantKeyEverywhere", () => {
  it("rewrites variant references while stable part-local pins remain on the artwork", () => {
    const base = withWristSocket(makeVariantArmCharacter());
    const wristPin = base.parts.find((part) => part.id === "arm-bent")?.pins?.["wrist:right"];
    const character: CharacterPreset = {
      ...base,
      posePresets: [
        { id: "pose-1", name: "Waving", poses: { "slot:right-arm": "bent" } },
        { id: "pose-2", name: "Standing", poses: { "slot:right-arm": "straight" } },
      ],
    };
    const renamed = renameVariantKeyEverywhere(character, "slot:right-arm", "bent", "raised");
    expect(renamed.parts.find((part) => part.id === "arm-bent")?.pins?.["wrist:right"]).toEqual(
      wristPin,
    );
    expect(renamed.rig?.sockets ?? []).toHaveLength(0);
    expect(renamed.posePresets?.[0].poses["slot:right-arm"]).toBe("raised");
    expect(renamed.posePresets?.[1].poses["slot:right-arm"]).toBe("straight");
    // Identical or empty renames are no-ops.
    expect(renameVariantKeyEverywhere(character, "slot:right-arm", "bent", "bent")).toBe(character);
  });
});

describe("buildRigHealthReport", () => {
  it("lists every parent variant key per child with its resolution source", () => {
    const withSocket = upsertVariantPinAtPoint(makeVariantArmCharacter(), {
      parentSlotId: "slot:right-arm",
      variantKey: "straight",
      childSlotId: "slot:right-hand",
      anchorPoint: { x: 300, y: 350 },
    });
    const report = buildRigHealthReport(withSocket);
    const handRows = report.anchorRows.filter((row) => row.childSlotId === "slot:right-hand");
    expect(handRows.map((row) => [row.variantKey, row.source])).toEqual([
      ["straight", "pin"],
      ["bent", "pin"],
    ]);
    expect(report.warnings.filter((entry) => entry.severity === "warning")).toEqual([]);
  });

  it("flags near-miss keys with jump-to context", () => {
    const report = buildRigHealthReport(withHandKey(makeVariantArmCharacter(), "Bent"));
    const warning = report.warnings.find(
      (entry) => entry.severity === "warning" && entry.message.includes('"Bent"'),
    );
    expect(warning).toBeDefined();
    expect(warning).toMatchObject({
      childSlotId: "slot:right-hand",
      parentSlotId: "slot:right-arm",
      variantKey: "bent",
      partId: "hand-bent",
    });
  });

  it("notes auto-center pivots only on parents that carry anchored children", () => {
    const character = makeVariantArmCharacter();
    // Strip the deliberate arm pivot so it falls back to the alpha-center default.
    const withAutoPivot = {
      ...character,
      parts: character.parts.map((part) =>
        getPartSlotId(part) === "slot:right-arm" ? { ...part, pivot: undefined } : part,
      ),
    };
    const report = buildRigHealthReport(withAutoPivot);
    expect(
      report.warnings.some(
        (entry) => entry.severity === "info" && entry.parentSlotId === "slot:right-arm",
      ),
    ).toBe(true);
    // With the authored pivot in place there is no pivot note.
    const authored = buildRigHealthReport(character);
    expect(authored.warnings.some((entry) => entry.parentSlotId === "slot:right-arm")).toBe(false);
  });

  it("reports a clean bill for variant-less characters", () => {
    const character = makeVariantArmCharacter();
    const singleVariant = {
      ...character,
      parts: character.parts.filter((part) => !part.id.endsWith("-bent")),
    };
    const report = buildRigHealthReport(singleVariant);
    expect(report.anchorRows).toEqual([]);
    expect(report.warnings).toEqual([]);
  });
});

describe("anchor rotation", () => {
  function withRotatedSocket(rotation: number): CharacterPreset {
    return withWristSocket(makeVariantArmCharacter(), { rotation });
  }

  it("carries pin rotation into the resolved child rest transform", () => {
    const character = withRotatedSocket(-35);
    expect(anchorEntryForChild(character, "slot:right-hand", "bent")).toEqual({
      x: 62,
      y: 78,
      rotation: -35,
      source: "pin",
    });
  });

  it("preserves rotation when the pin position is moved", () => {
    const moved = upsertVariantPinAtPoint(withRotatedSocket(-35), {
      parentSlotId: "slot:right-arm",
      variantKey: "bent",
      childSlotId: "slot:right-hand",
      anchorPoint: { x: 370, y: 230 },
    });
    const entry = anchorEntryForChild(moved, "slot:right-hand", "bent");
    expect(entry).toMatchObject({ x: 80, y: 60, rotation: -35, source: "pin" });
  });

  it("setVariantPinRotation updates an existing variant pin", () => {
    const character = setVariantPinRotation(
      withWristSocket(makeVariantArmCharacter(), { x: 370, y: 230 }),
      {
        parentSlotId: "slot:right-arm",
        variantKey: "bent",
        childSlotId: "slot:right-hand",
        rotation: -20,
      },
    );
    expect(anchorEntryForChild(character, "slot:right-hand", "bent")).toMatchObject({
      x: 80,
      y: 60,
      rotation: -20,
      source: "pin",
    });
  });

  it("rotates preview parts about their pivot and keeps the anchor as the joint", () => {
    const shift = variantPreviewDeltas(withRotatedSocket(90), {
      "slot:right-arm": "bent",
    });
    // The bone sits at the straight hand's pivot, so that part rotates in place at the joint.
    const straightShift = shift.parts.get("hand-straight");
    expect(straightShift?.rotation).toBeCloseTo(90);
    expect(straightShift?.dx).toBeCloseTo(352 - 300);
    expect(straightShift?.dy).toBeCloseTo(248 - 345);
    const bentShift = shift.parts.get("hand-bent");
    expect(bentShift?.rotation).toBeCloseTo(90);
    expect(bentShift?.dx).toBeCloseTo(52);
    expect(bentShift?.dy).toBeCloseTo(-97);
    expect(shift.bones.get("bone:slot:right-hand")?.rotation).toBeCloseTo(90);
  });

  it("migrated paired artwork pins carry a neutral child rotation", () => {
    expect(
      anchorEntryForChild(makeVariantArmCharacter(), "slot:right-hand", "bent")?.rotation,
    ).toBe(0);
  });
});

describe("cross-angle key consistency (rig health)", () => {
  it("reports keys and slots missing on other angles, info-level only", () => {
    const base = makeVariantArmCharacter();
    const character: CharacterPreset = {
      ...base,
      angles: ["front", "sideL"],
      parts: [
        ...base.parts.map((part) => ({ ...part, angleIds: ["front" as const] })),
        // Side view has the arm slot with only the straight key — "bent" is front-only.
        ...base.parts
          .filter((part) => part.id === "arm-straight")
          .map((part) => ({ ...part, id: "side-arm-straight", angleIds: ["sideL" as const] })),
      ],
    };
    const report = buildRigHealthReport(character);
    const infos = report.warnings.filter((entry) => entry.severity === "info");
    expect(
      infos.some((entry) => entry.message.includes('"bent"') && entry.message.includes("missing")),
    ).toBe(true);
    expect(infos.some((entry) => entry.message.includes("has no Left Side artwork yet"))).toBe(
      true,
    );
    // Single-angle characters get no cross-angle chatter.
    expect(
      buildRigHealthReport(base).warnings.filter((entry) => entry.message.includes("artwork yet")),
    ).toEqual([]);
  });
});
