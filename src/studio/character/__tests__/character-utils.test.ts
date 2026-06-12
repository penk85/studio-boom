import { describe, it, expect } from "vitest";
import {
  anchorPartForVariant,
  claimSharedPartsForAngles,
  listCharacterSlots,
  pickActivePart,
  pickActivePartForSlot,
  pivotAlignedPartOffset,
  roleEnabledByManifest,
  normalizePartRole,
  getPartSlotId,
  defaultSlotIdForRole,
  inferHumanParentPartId,
  withInferredHumanParentIds,
} from "../character-utils";
import { pivotForPart } from "../alpha-bounds";
import type { CharacterPart, CharacterPreset, PartManifest } from "../../types";
import { makeVariantArmCharacter } from "./fixtures";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _id = 0;
function makePart(overrides: Partial<CharacterPart>): CharacterPart {
  const id = `part-${++_id}`;
  const role = overrides.role ?? "head";
  return {
    id,
    slotId: overrides.slotId ?? `role:${role}`,
    slotName: overrides.slotName ?? "Head",
    role,
    name: overrides.name ?? "Part",
    mediaId: "media-1",
    x: 100,
    y: 100,
    width: 200,
    height: 200,
    rotation: 0,
    anchorX: 0.5,
    anchorY: 0.5,
    pivot: { x: 200, y: 200 },
    motionBehavior: "rotate",
    zIndex: overrides.zIndex ?? 0,
    depth: 0,
    visible: overrides.visible ?? true,
    ...overrides,
  };
}

// ─── defaultSlotIdForRole ──────────────────────────────────────────────────────

describe("defaultSlotIdForRole", () => {
  it("returns role:head for head", () => {
    expect(defaultSlotIdForRole("head")).toBe("role:head");
  });

  it("returns role:body for body", () => {
    expect(defaultSlotIdForRole("body")).toBe("role:body");
  });

  it("returns slot:left-eye for left-sided eye", () => {
    expect(defaultSlotIdForRole("eye", undefined, "left")).toBe("slot:left-eye");
  });

  it("returns slot:right-arm for right-sided arm", () => {
    expect(defaultSlotIdForRole("arm", undefined, "right")).toBe("slot:right-arm");
  });

  it("returns slot:front-hair for front-sided hair", () => {
    expect(defaultSlotIdForRole("hair", undefined, "front")).toBe("slot:front-hair");
  });

  it("returns custom:partId for custom role with partId", () => {
    expect(defaultSlotIdForRole("custom", "my-part-id")).toBe("custom:my-part-id");
  });

  it("returns role:custom when no partId for custom", () => {
    expect(defaultSlotIdForRole("custom")).toBe("role:custom");
  });
});

// ─── getPartSlotId ────────────────────────────────────────────────────────────

describe("getPartSlotId", () => {
  it("returns the part's slotId when not a generic sided slot", () => {
    const part = makePart({ role: "head", slotId: "my-custom-slot" });
    expect(getPartSlotId(part)).toBe("my-custom-slot");
  });

  it("returns default slot for sided eye with generic slotId", () => {
    // A part with slotId = "role:eye" and side = "left" is a generic sided slot
    const part = makePart({ role: "eye", slotId: "role:eye", side: "left" });
    expect(getPartSlotId(part)).toBe("slot:left-eye");
  });
});

// ─── inferHumanParentPartId ───────────────────────────────────────────────────

describe("inferHumanParentPartId", () => {
  it("attaches human limb parts to their expected same-side parents", () => {
    const body = makePart({ id: "body", role: "body", slotId: "role:body" });
    const leftArm = makePart({
      id: "left-arm",
      role: "arm",
      side: "left",
      slotId: "slot:left-arm",
    });
    const rightArm = makePart({
      id: "right-arm",
      role: "arm",
      side: "right",
      slotId: "slot:right-arm",
    });
    const rightHand = makePart({
      id: "right-hand",
      role: "hand",
      side: "right",
      slotId: "slot:right-hand",
    });
    const leftLeg = makePart({
      id: "left-leg",
      role: "leg",
      side: "left",
      slotId: "slot:left-leg",
    });
    const leftFoot = makePart({
      id: "left-foot",
      role: "foot",
      side: "left",
      slotId: "slot:left-foot",
    });
    const parts = [body, leftArm, rightArm, rightHand, leftLeg, leftFoot];

    expect(inferHumanParentPartId(parts, leftArm)).toBe("body");
    expect(inferHumanParentPartId(parts, rightArm)).toBe("body");
    expect(inferHumanParentPartId(parts, rightHand)).toBe("right-arm");
    expect(inferHumanParentPartId(parts, leftLeg)).toBe("body");
    expect(inferHumanParentPartId(parts, leftFoot)).toBe("left-leg");
  });

  it("fills missing human parent ids on a character without changing explicit parents", () => {
    const body = makePart({ id: "body", role: "body", slotId: "role:body" });
    const head = makePart({ id: "head", role: "head", slotId: "role:head" });
    const eye = makePart({
      id: "left-eye",
      role: "eye",
      side: "left",
      slotId: "slot:left-eye",
    });
    const hand = makePart({
      id: "hand",
      role: "hand",
      side: "left",
      slotId: "slot:left-hand",
      parentId: "custom-parent",
    });
    const character = {
      id: "character",
      name: "Character",
      canvasWidth: 600,
      canvasHeight: 900,
      parts: [body, head, eye, hand],
      createdAt: 1,
      updatedAt: 1,
    } as CharacterPreset;

    const next = withInferredHumanParentIds(character);

    expect(next.parts.find((part) => part.id === "head")?.parentId).toBe("body");
    expect(next.parts.find((part) => part.id === "left-eye")?.parentId).toBe("head");
    expect(next.parts.find((part) => part.id === "hand")?.parentId).toBe("custom-parent");
  });
});

// ─── normalizePartRole ────────────────────────────────────────────────────────

describe("normalizePartRole", () => {
  it("passes through canonical roles unchanged", () => {
    const canonical = [
      "head",
      "body",
      "eye",
      "iris",
      "eyebrow",
      "nose",
      "mouth",
      "arm",
      "hand",
      "leg",
      "foot",
      "hair",
      "accessory",
      "static",
      "custom",
    ] as const;
    for (const role of canonical) {
      expect(normalizePartRole(role)).toBe(role);
    }
  });

  it("maps legacy eyeL/eyeR → eye", () => {
    expect(normalizePartRole("eyeL")).toBe("eye");
    expect(normalizePartRole("eyeR")).toBe("eye");
  });

  it("maps legacy brow/browL/browR → eyebrow", () => {
    expect(normalizePartRole("brow")).toBe("eyebrow");
    expect(normalizePartRole("browL")).toBe("eyebrow");
    expect(normalizePartRole("browR")).toBe("eyebrow");
  });

  it("maps legacy armL/armR → arm", () => {
    expect(normalizePartRole("armL")).toBe("arm");
    expect(normalizePartRole("armR")).toBe("arm");
  });

  it("maps legacy extra → custom", () => {
    expect(normalizePartRole("extra")).toBe("custom");
  });

  it("maps unknown string → custom", () => {
    expect(normalizePartRole("totally-unknown")).toBe("custom");
    expect(normalizePartRole(undefined)).toBe("custom");
  });
});

// ─── roleEnabledByManifest ────────────────────────────────────────────────────

describe("roleEnabledByManifest", () => {
  const fullManifest: PartManifest = {
    hasHead: true,
    hasBody: true,
    hasArms: true,
    hasHands: true,
    hasLegs: true,
    hasFeet: true,
    hasEyes: true,
    hasIrises: true,
    hasBrows: true,
    hasNose: true,
    hasMouth: true,
    hasHair: true,
    hasAccessories: true,
  };

  it("returns true for all roles in a full manifest", () => {
    const roles = [
      "head",
      "body",
      "arm",
      "hand",
      "leg",
      "foot",
      "eye",
      "iris",
      "eyebrow",
      "nose",
      "mouth",
      "hair",
      "accessory",
    ] as const;
    for (const role of roles) {
      expect(roleEnabledByManifest(role, fullManifest)).toBe(true);
    }
  });

  it("returns false for disabled roles", () => {
    const noLegs = { ...fullManifest, hasLegs: false };
    expect(roleEnabledByManifest("leg", noLegs)).toBe(false);
    expect(roleEnabledByManifest("iris", { ...fullManifest, hasEyes: false })).toBe(false);
    expect(roleEnabledByManifest("iris", { ...fullManifest, hasIrises: false })).toBe(false);
  });

  it("static and custom are always enabled regardless of manifest", () => {
    const emptyManifest = Object.fromEntries(
      Object.keys(fullManifest).map((k) => [k, false]),
    ) as unknown as PartManifest;
    expect(roleEnabledByManifest("static", emptyManifest)).toBe(true);
    expect(roleEnabledByManifest("custom", emptyManifest)).toBe(true);
  });

  it("uses DEFAULT_PART_MANIFEST when manifest is undefined", () => {
    // DEFAULT_PART_MANIFEST has all true
    expect(roleEnabledByManifest("head", undefined)).toBe(true);
  });
});

// ─── listCharacterSlots ───────────────────────────────────────────────────────

describe("listCharacterSlots", () => {
  it("returns empty array for no parts", () => {
    expect(listCharacterSlots([])).toEqual([]);
  });

  it("groups multiple variants into a single slot", () => {
    const head1 = makePart({ role: "head", slotId: "role:head", viseme: undefined });
    const head2 = makePart({ role: "head", slotId: "role:head", name: "Head variant 2" });
    const slots = listCharacterSlots([head1, head2]);
    expect(slots.length).toBe(1);
    expect(slots[0].parts.length).toBe(2);
  });

  it("creates separate slots for head and body", () => {
    const head = makePart({ role: "head", slotId: "role:head" });
    const body = makePart({ role: "body", slotId: "role:body" });
    const slots = listCharacterSlots([head, body]);
    expect(slots.length).toBe(2);
    const roles = slots.map((s) => s.role);
    expect(roles).toContain("head");
    expect(roles).toContain("body");
  });

  it("creates separate slots for left and right eye", () => {
    const leftEye = makePart({ role: "eye", slotId: "slot:left-eye", side: "left" });
    const rightEye = makePart({ role: "eye", slotId: "slot:right-eye", side: "right" });
    const slots = listCharacterSlots([leftEye, rightEye]);
    expect(slots.length).toBe(2);
  });

  it("sorts slots by ascending zIndex", () => {
    const high = makePart({ role: "head", slotId: "role:head", zIndex: 10 });
    const low = makePart({ role: "body", slotId: "role:body", zIndex: 0 });
    const slots = listCharacterSlots([high, low]);
    expect(slots[0].role).toBe("body");
    expect(slots[1].role).toBe("head");
  });
});

// ─── pickActivePart ───────────────────────────────────────────────────────────

describe("pickActivePart", () => {
  it("returns undefined when no visible parts exist", () => {
    const hidden = makePart({ role: "head", visible: false });
    expect(pickActivePart([hidden], "head", {})).toBeUndefined();
  });

  it("returns the first visible part for generic role", () => {
    const p1 = makePart({ role: "arm", slotId: "role:arm", zIndex: 0 });
    const p2 = makePart({ role: "arm", slotId: "role:arm", zIndex: 1 });
    const result = pickActivePart([p1, p2], "arm", {});
    expect(result?.id).toBe(p1.id);
  });

  it("selects mouth part by viseme", () => {
    const rest = makePart({ role: "mouth", slotId: "role:mouth", viseme: "rest" });
    const aPart = makePart({ role: "mouth", slotId: "role:mouth", viseme: "A" });
    expect(pickActivePart([rest, aPart], "mouth", { viseme: "A" })?.id).toBe(aPart.id);
  });

  it("falls back to rest mouth when viseme not found", () => {
    const rest = makePart({ role: "mouth", slotId: "role:mouth", viseme: "rest" });
    const aPart = makePart({ role: "mouth", slotId: "role:mouth", viseme: "A" });
    expect(pickActivePart([rest, aPart], "mouth", { viseme: "O" })?.id).toBe(rest.id);
  });

  it("selects eye part by eyeState", () => {
    const open = makePart({ role: "eye", slotId: "role:eye", eyeState: "open" });
    const closed = makePart({ role: "eye", slotId: "role:eye", eyeState: "closed" });
    expect(pickActivePart([open, closed], "eye", { eyeState: "closed" })?.id).toBe(closed.id);
  });

  it("falls back to open eye when eyeState not found", () => {
    const open = makePart({ role: "eye", slotId: "role:eye", eyeState: "open" });
    const half = makePart({ role: "eye", slotId: "role:eye", eyeState: "half" });
    expect(pickActivePart([open, half], "eye", { eyeState: "wink" })?.id).toBe(open.id);
  });

  it("selects part by pose for generic roles", () => {
    const idle = makePart({ role: "body", slotId: "role:body", pose: "idle" });
    const walk = makePart({ role: "body", slotId: "role:body", pose: "walk" });
    expect(pickActivePart([idle, walk], "body", { pose: "walk" })?.id).toBe(walk.id);
  });
});

// ─── pickActivePartForSlot ────────────────────────────────────────────────────

describe("pickActivePartForSlot", () => {
  it("delegates to pickActivePart with slot role and id", () => {
    const rest = makePart({ role: "mouth", slotId: "role:mouth", viseme: "rest" });
    const aPart = makePart({ role: "mouth", slotId: "role:mouth", viseme: "A" });
    const slot = { id: "role:mouth", role: "mouth" as const, name: "Mouth", parts: [rest, aPart] };
    const result = pickActivePartForSlot(slot, { viseme: "A" });
    expect(result?.id).toBe(aPart.id);
  });
});

describe("anchorPartForVariant / pivotAlignedPartOffset", () => {
  const handParts = () =>
    makeVariantArmCharacter().parts.filter((part) => part.slotId === "slot:right-hand");

  it("picks the first visible matching part, falling back to hidden matches", () => {
    const parts = handParts();
    expect(anchorPartForVariant(parts, "bent")?.id).toBe("hand-bent");
    const hiddenBent = parts.map((part) =>
      part.id === "hand-bent" ? { ...part, visible: false } : part,
    );
    expect(anchorPartForVariant(hiddenBent, "bent")?.id).toBe("hand-bent");
    expect(anchorPartForVariant(parts, undefined)).toBeUndefined();
    expect(anchorPartForVariant(parts, "no-such-key")).toBeUndefined();
  });

  it("is the identity for the representative group", () => {
    const rep = handParts().find((part) => part.id === "hand-straight")!;
    expect(pivotAlignedPartOffset(rep, rep, rep)).toEqual({ x: 0, y: 0 });
  });

  it("places a single-part variant so its pivot lands on the reference pivot", () => {
    const parts = handParts();
    const rep = parts.find((part) => part.id === "hand-straight")!;
    const bent = parts.find((part) => part.id === "hand-bent")!;
    const offset = pivotAlignedPartOffset(rep, bent, bent);
    // Rendered canvas position = rep.xy + offset; the placed pivot must equal the rep pivot.
    const placedPivot = {
      x: rep.x + offset.x + (pivotForPart(bent).x - bent.x),
      y: rep.y + offset.y + (pivotForPart(bent).y - bent.y),
    };
    expect(placedPivot).toEqual(pivotForPart(rep));
  });

  it("moves multi-layer variants as a group, preserving relative layout", () => {
    const parts = handParts();
    const rep = parts.find((part) => part.id === "hand-straight")!;
    const anchor = parts.find((part) => part.id === "hand-bent")!;
    const cuff: CharacterPart = {
      ...anchor,
      id: "hand-bent-cuff",
      x: anchor.x + 12,
      y: anchor.y - 8,
    };
    const anchorOffset = pivotAlignedPartOffset(rep, anchor, anchor);
    const cuffOffset = pivotAlignedPartOffset(rep, anchor, cuff);
    expect(cuffOffset.x - anchorOffset.x).toBe(cuff.x - anchor.x);
    expect(cuffOffset.y - anchorOffset.y).toBe(cuff.y - anchor.y);
  });
});

describe("claimSharedPartsForAngles", () => {
  it("stamps only implicitly-shared parts and leaves scoped parts alone", () => {
    const shared = makePart({ id: "body", role: "body", slotId: "role:body" });
    const scoped = makePart({
      id: "side-arm",
      role: "arm",
      slotId: "slot:right-arm",
      angleIds: ["sideL"],
    });
    const character = { parts: [shared, scoped] } as CharacterPreset;
    const claimed = claimSharedPartsForAngles(character, ["front"]);
    expect(claimed.parts.find((part) => part.id === "body")?.angleIds).toEqual(["front"]);
    expect(claimed.parts.find((part) => part.id === "side-arm")?.angleIds).toEqual(["sideL"]);
    // Nothing implicitly shared → same reference (no-op).
    expect(claimSharedPartsForAngles(claimed, ["front"])).toBe(claimed);
  });
});
