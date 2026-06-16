import { describe, expect, it } from "vitest";
import type { CharacterPreset, CharacterRig } from "../../types";
import { createBlankCharacter, makePart } from "../character-utils";
import { makeVariantArmCharacter } from "./fixtures";
import {
  activeDepthForSlot,
  availableCharacterAngles,
  buildDefaultRig,
  clampMotionDeltaToReach,
  clearSlotSocketAnchor,
  upsertSlotSocketAnchor,
  computeBoneWorldTransforms,
  moveBoneForSlot,
  moveSlotBinding,
  normalizeCharacterRig,
  rebuildRigPreservingConstraints,
  setSlotHostConstraint,
  setSlotReach,
  setSlotRotReach,
  validateCharacterRig,
} from "../rig";

function makeRigCharacter(): CharacterPreset {
  return {
    ...createBlankCharacter("Rig actor"),
    id: "rig-actor",
    parts: [
      makePart("body", "body-media", {
        id: "body",
        slotId: "role:body",
        x: 100,
        y: 120,
        width: 200,
        height: 320,
        zIndex: 1,
      }),
      makePart("head", "head-media", {
        id: "head",
        slotId: "role:head",
        x: 125,
        y: 60,
        width: 150,
        height: 140,
        zIndex: 5,
      }),
      makePart("eye", "eye-media", {
        id: "left-eye",
        slotId: "slot:left-eye",
        side: "left",
        eyeState: "open",
        x: 160,
        y: 105,
        width: 36,
        height: 24,
        zIndex: 8,
      }),
      makePart("iris", "iris-media", {
        id: "left-iris",
        slotId: "slot:left-iris",
        side: "left",
        x: 173,
        y: 112,
        width: 10,
        height: 10,
        zIndex: 9,
      }),
      makePart("leg", "leg-media", {
        id: "left-leg",
        slotId: "slot:left-leg",
        side: "left",
        x: 120,
        y: 380,
        width: 54,
        height: 170,
        zIndex: 0,
      }),
      makePart("foot", "foot-media", {
        id: "left-foot",
        slotId: "slot:left-foot",
        side: "left",
        x: 124,
        y: 540,
        width: 72,
        height: 34,
        zIndex: 0,
      }),
    ],
  };
}

describe("parent variant child anchors", () => {
  it("re-anchors the hand bone from child art paired to the bent arm variant", () => {
    const rig = buildDefaultRig(makeVariantArmCharacter());
    const hand = rig.bones.find((bone) => bone.id === "bone:slot:right-hand");
    expect(hand?.parentId).toBe("bone:slot:right-arm");
    // Base anchor comes from the straight (representative) hand: pivot 300,345 − arm pivot 290,170.
    expect(hand?.x).toBe(10);
    expect(hand?.y).toBe(175);
    // Bent arm carries the hand to the bent-hand pivot: 370,230 − 290,170.
    expect(hand?.parentVariantAnchors).toEqual({ bent: { x: 80, y: 60, source: "pairedArt" } });
  });

  it("prefers an authored joint socket over paired child art", () => {
    const character = makeVariantArmCharacter();
    const withSocket = upsertSlotSocketAnchor(buildDefaultRig(character), {
      parentSlotId: "slot:right-arm",
      childSlotId: "slot:right-hand",
      variantKey: "bent",
      x: 352,
      y: 248,
    });
    const rig = normalizeCharacterRig({ ...character, rig: withSocket });
    const hand = rig.bones.find((bone) => bone.id === "bone:slot:right-hand");
    expect(hand?.parentVariantAnchors).toEqual({ bent: { x: 62, y: 78, source: "socket" } });
  });

  it("scopes joints to their angle — a front wrist never moves the side-view hand", () => {
    const character: CharacterPreset = {
      ...makeVariantArmCharacter(),
      angles: ["front", "sideL"],
    };
    const withSocket = upsertSlotSocketAnchor(
      buildDefaultRig(character),
      {
        parentSlotId: "slot:right-arm",
        childSlotId: "slot:right-hand",
        variantKey: "bent",
        x: 352,
        y: 248,
      },
      "front",
    );
    const rig = normalizeCharacterRig({ ...character, rig: withSocket });
    const handOn = (angle: "front" | "sideL") =>
      rig.angles?.[angle]?.bones.find((bone) => bone.id === "bone:slot:right-hand");
    expect(handOn("front")?.parentVariantAnchors?.bent?.source).toBe("socket");
    // The side skeleton falls back to its own paired art — the front joint does not leak.
    expect(handOn("sideL")?.parentVariantAnchors?.bent?.source).toBe("pairedArt");
  });

  it("carries authored joints across constraint-preserving rebuilds and clears cleanly", () => {
    const character = makeVariantArmCharacter();
    const withSocket = upsertSlotSocketAnchor(buildDefaultRig(character), {
      parentSlotId: "slot:right-arm",
      childSlotId: "slot:right-hand",
      variantKey: "bent",
      x: 352,
      y: 248,
      rotation: -35,
    });
    const rebuilt = rebuildRigPreservingConstraints({ ...character, rig: withSocket });
    const rebuiltSocket = rebuilt.sockets?.find(
      (socket) => socket.slotId === "slot:right-arm" && socket.childSlotId === "slot:right-hand",
    );
    expect(rebuiltSocket).toMatchObject({
      x: 300,
      y: 345,
      variantAnchors: { bent: { x: 352, y: 248, rotation: -35 } },
    });
    // Re-pinning the position preserves the authored rotation.
    const moved = upsertSlotSocketAnchor(rebuilt, {
      parentSlotId: "slot:right-arm",
      childSlotId: "slot:right-hand",
      variantKey: "bent",
      x: 360,
      y: 240,
    });
    const movedSocket = moved.sockets?.find(
      (socket) => socket.slotId === "slot:right-arm" && socket.childSlotId === "slot:right-hand",
    );
    expect(movedSocket?.variantAnchors.bent).toEqual({ x: 360, y: 240, rotation: -35 });
    // Clearing the only override keeps the base rest socket.
    const cleared = clearSlotSocketAnchor(moved, {
      parentSlotId: "slot:right-arm",
      childSlotId: "slot:right-hand",
      variantKey: "bent",
    });
    const clearedSocket = cleared.sockets?.find(
      (socket) => socket.slotId === "slot:right-arm" && socket.childSlotId === "slot:right-hand",
    );
    expect(clearedSocket?.variantAnchors.bent).toBeUndefined();
    expect(clearedSocket).toMatchObject({ x: 300, y: 345 });
  });

  it("computes no anchors for variant-less characters", () => {
    const rig = buildDefaultRig(makeRigCharacter());
    for (const bone of rig.bones) {
      expect(bone.parentVariantAnchors).toBeUndefined();
    }
  });

  it("keeps freshly derived anchors when a saved rig restates the bone", () => {
    const character = makeVariantArmCharacter();
    const built = buildDefaultRig(character);
    const staleBones = built.bones.map((bone) =>
      bone.id === "bone:slot:right-hand"
        ? { ...bone, parentVariantAnchors: { bent: { x: 1, y: 1 } } }
        : bone,
    );
    const normalized = normalizeCharacterRig({
      ...character,
      rig: { ...built, bones: staleBones },
    });
    const hand = normalized.bones.find((bone) => bone.id === "bone:slot:right-hand");
    expect(hand?.parentVariantAnchors).toEqual({ bent: { x: 80, y: 60, source: "pairedArt" } });
  });
});

describe("CharacterRig V1", () => {
  it("uses character.angles as the canonical angle list when present", () => {
    const character: CharacterPreset = {
      ...makeRigCharacter(),
      angles: ["front"],
      parts: [
        ...makeRigCharacter().parts,
        makePart("arm", "side-arm-media", {
          id: "side-arm",
          slotId: "slot:right-arm",
          angleIds: ["sideL"],
        }),
      ],
      rig: {
        ...buildDefaultRig(makeRigCharacter()),
        activeAngle: "sideL",
        angles: {
          sideL: {
            angleId: "sideL",
            bones: [],
            slotBindings: [],
            drawOrder: [],
            slotRelations: [],
            hostConstraints: [],
            reaches: [],
          },
        },
      },
    };

    expect(availableCharacterAngles(character)).toEqual(["front"]);
  });

  it("builds an FK leg hierarchy where parent rotation affects the child bone", () => {
    const character = makeRigCharacter();
    const baseRig = buildDefaultRig(character);
    const rig: CharacterRig = {
      ...baseRig,
      bones: baseRig.bones.map((bone) =>
        bone.id === "bone:slot:left-leg" ? { ...bone, rotation: 90 } : bone,
      ),
    };

    const leg = rig.bones.find((bone) => bone.id === "bone:slot:left-leg");
    const foot = rig.bones.find((bone) => bone.id === "bone:slot:left-foot");
    const world = computeBoneWorldTransforms(rig);

    expect(leg?.parentId).toBe("bone:role:body");
    expect(foot?.parentId).toBe("bone:slot:left-leg");
    expect(world.get("bone:slot:left-foot")?.rotation).toBeCloseTo(90);
    expect(world.get("bone:slot:left-foot")?.x).not.toBe(foot?.x);
  });

  it("supports optional upper/lower arm and leg chains with canonical sockets", () => {
    const character: CharacterPreset = {
      ...createBlankCharacter("Split limbs"),
      id: "split-limbs",
      parts: [
        makePart("body", "body-media", {
          id: "body",
          slotId: "role:body",
          x: 100,
          y: 120,
          width: 200,
          height: 300,
          zIndex: 1,
        }),
        makePart("upperArm", "upper-arm-media", {
          id: "upper-arm",
          slotId: "slot:right-upperArm",
          side: "right",
          x: 285,
          y: 190,
          width: 42,
          height: 120,
          zIndex: 2,
          pivot: { x: 300, y: 205 },
        }),
        makePart("lowerArm", "lower-arm-media", {
          id: "lower-arm",
          slotId: "slot:right-lowerArm",
          side: "right",
          x: 300,
          y: 295,
          width: 38,
          height: 110,
          zIndex: 3,
          pivot: { x: 315, y: 305 },
        }),
        makePart("hand", "hand-media", {
          id: "hand",
          slotId: "slot:right-hand",
          side: "right",
          x: 304,
          y: 392,
          width: 42,
          height: 42,
          zIndex: 4,
          pivot: { x: 320, y: 405 },
        }),
        makePart("upperLeg", "upper-leg-media", {
          id: "upper-leg",
          slotId: "slot:right-upperLeg",
          side: "right",
          x: 225,
          y: 400,
          width: 48,
          height: 130,
          zIndex: 1,
          pivot: { x: 245, y: 410 },
        }),
        makePart("lowerLeg", "lower-leg-media", {
          id: "lower-leg",
          slotId: "slot:right-lowerLeg",
          side: "right",
          x: 230,
          y: 520,
          width: 44,
          height: 120,
          zIndex: 1,
          pivot: { x: 250, y: 530 },
        }),
        makePart("foot", "foot-media", {
          id: "foot",
          slotId: "slot:right-foot",
          side: "right",
          x: 238,
          y: 630,
          width: 78,
          height: 34,
          zIndex: 2,
          pivot: { x: 255, y: 642 },
        }),
      ],
    };

    const rig = buildDefaultRig(character);
    expect(rig.bones.find((bone) => bone.id === "bone:slot:right-lowerArm")?.parentId).toBe(
      "bone:slot:right-upperArm",
    );
    expect(rig.bones.find((bone) => bone.id === "bone:slot:right-hand")?.parentId).toBe(
      "bone:slot:right-lowerArm",
    );
    expect(rig.bones.find((bone) => bone.id === "bone:slot:right-lowerLeg")?.parentId).toBe(
      "bone:slot:right-upperLeg",
    );
    expect(rig.bones.find((bone) => bone.id === "bone:slot:right-foot")?.parentId).toBe(
      "bone:slot:right-lowerLeg",
    );
    expect(
      rig.sockets?.find(
        (socket) =>
          socket.slotId === "slot:right-lowerArm" && socket.childSlotId === "slot:right-hand",
      ),
    ).toMatchObject({ name: "Wrist", x: 320, y: 405 });
    expect(
      rig.sockets?.find(
        (socket) =>
          socket.slotId === "slot:right-upperLeg" && socket.childSlotId === "slot:right-lowerLeg",
      ),
    ).toMatchObject({ name: "Knee", x: 250, y: 530 });
  });

  it("infers same-side limb parents from slot ids when explicit side metadata is missing", () => {
    const character: CharacterPreset = {
      ...createBlankCharacter("Inferred sides"),
      id: "inferred-sides",
      parts: [
        makePart("body", "body-media", {
          id: "body",
          slotId: "slot:torso",
          x: 100,
          y: 120,
          width: 200,
          height: 300,
          zIndex: 1,
        }),
        makePart("arm", "left-arm-media", {
          id: "left-arm",
          slotId: "slot:arm-left",
          slotName: "Left arm",
          x: 80,
          y: 210,
          width: 50,
          height: 160,
          zIndex: 2,
        }),
        makePart("arm", "right-arm-media", {
          id: "right-arm",
          slotId: "slot:arm-right",
          slotName: "Right arm",
          x: 270,
          y: 210,
          width: 50,
          height: 160,
          zIndex: 2,
        }),
        makePart("hand", "left-hand-media", {
          id: "left-hand",
          slotId: "slot:hand-left",
          slotName: "Left hand",
          x: 74,
          y: 360,
          width: 42,
          height: 42,
          zIndex: 3,
        }),
        makePart("hand", "right-hand-media", {
          id: "right-hand",
          slotId: "slot:hand-right",
          slotName: "Right hand",
          x: 284,
          y: 360,
          width: 42,
          height: 42,
          zIndex: 3,
        }),
      ],
    };

    const rig = buildDefaultRig(character);
    const leftHand = rig.bones.find((bone) => bone.id === "bone:slot:hand-left");
    const rightHand = rig.bones.find((bone) => bone.id === "bone:slot:hand-right");

    expect(leftHand?.side).toBe("left");
    expect(rightHand?.side).toBe("right");
    expect(leftHand?.parentId).toBe("bone:slot:arm-left");
    expect(rightHand?.parentId).toBe("bone:slot:arm-right");
  });

  it("rejects invalid bone graphs before AI rigger suggestions can be applied", () => {
    const baseRig = buildDefaultRig(makeRigCharacter());
    const rig: CharacterRig = {
      ...baseRig,
      bones: baseRig.bones.map((bone) => {
        if (bone.id === "bone:slot:left-leg") return { ...bone, parentId: "bone:slot:left-foot" };
        if (bone.id === "bone:slot:left-foot") return { ...bone, parentId: "bone:slot:left-leg" };
        return bone;
      }),
    };

    const validation = validateCharacterRig(rig);

    expect(validation.ok).toBe(false);
    expect(validation.errors.join("\n")).toContain("parent cycle");
  });

  it("separates slot attachment moves from bone rest moves", () => {
    const rig = buildDefaultRig(makeRigCharacter());
    const footBone = rig.bones.find((bone) => bone.id === "bone:slot:left-foot");
    const footBinding = rig.slotBindings.find((binding) => binding.slotId === "slot:left-foot");

    const attachmentMoved = moveSlotBinding(rig, "slot:left-foot", 12, -4);
    const boneMoved = moveBoneForSlot(rig, "slot:left-foot", 12, -4);

    expect(attachmentMoved.bones.find((bone) => bone.id === "bone:slot:left-foot")).toEqual(
      footBone,
    );
    expect(
      attachmentMoved.slotBindings.find((binding) => binding.slotId === "slot:left-foot")?.x,
    ).toBe((footBinding?.x ?? 0) + 12);
    expect(
      attachmentMoved.slotBindings.find((binding) => binding.slotId === "slot:left-foot")?.y,
    ).toBe((footBinding?.y ?? 0) - 4);
    expect(boneMoved.slotBindings.find((binding) => binding.slotId === "slot:left-foot")).toEqual(
      footBinding,
    );
    expect(boneMoved.bones.find((bone) => bone.id === "bone:slot:left-foot")?.x).toBe(
      (footBone?.x ?? 0) + 12,
    );
  });

  it("normalizes angle rigs as independent concrete skeletons", () => {
    const character = {
      ...makeRigCharacter(),
      angles: ["front", "sideL"] as CharacterPreset["angles"],
    };
    const base = buildDefaultRig(character);
    const front = base.angles?.front;
    expect(front).toBeTruthy();
    if (!front) return;
    const side = {
      ...front,
      angleId: "sideL" as const,
      bones: front.bones.map((bone) =>
        bone.id === "bone:slot:left-foot"
          ? {
              ...bone,
              id: "sideL:bone:left-foot",
              semanticBoneId: "bone:slot:left-foot",
              x: bone.x + 32,
            }
          : bone,
      ),
      slotBindings: front.slotBindings.map((binding) =>
        binding.slotId === "slot:left-foot"
          ? { ...binding, boneId: "sideL:bone:left-foot" }
          : binding,
      ),
    };

    const normalized = normalizeCharacterRig({
      ...character,
      rig: { ...base, activeAngle: "sideL", angles: { front, sideL: side } },
    });

    expect(normalized.bones.some((bone) => bone.id === "sideL:bone:left-foot")).toBe(true);
    expect(normalized.angles?.front?.bones.some((bone) => bone.id === "sideL:bone:left-foot")).toBe(
      false,
    );
    expect(
      normalized.angles?.sideL?.bones.find((bone) => bone.id === "sideL:bone:left-foot")
        ?.semanticBoneId,
    ).toBe("bone:slot:left-foot");
  });

  it("starts with no reaches and stores/clears a traced reach per slot", () => {
    const base = buildDefaultRig(makeRigCharacter());
    expect(base.reaches).toEqual([]);

    const withReach = setSlotReach(base, "slot:left-eye", [
      { x: -10, y: -8 },
      { x: 10, y: -8 },
      { x: 10, y: 8 },
      { x: -10, y: 8 },
    ]);
    expect(withReach.reaches.find((r) => r.slotId === "slot:left-eye")?.reach).toHaveLength(4);

    // Survives normalization.
    const normalized = normalizeCharacterRig({ ...makeRigCharacter(), rig: withReach });
    expect(normalized.reaches.some((r) => r.slotId === "slot:left-eye")).toBe(true);

    // Fewer than three points clears it.
    const cleared = setSlotReach(withReach, "slot:left-eye", [{ x: 0, y: 0 }]);
    expect(cleared.reaches.find((r) => r.slotId === "slot:left-eye")?.reach).toBeUndefined();
  });

  it("rebuild preserves authored movement/rotation reaches (buildDefaultRig drops them)", () => {
    const character = makeRigCharacter();
    let rig = buildDefaultRig(character);
    rig = setSlotReach(rig, "slot:left-eye", [
      { x: -10, y: -8 },
      { x: 10, y: -8 },
      { x: 10, y: 8 },
      { x: -10, y: 8 },
    ]);
    rig = setSlotRotReach(rig, "slot:left-eye", { min: -30, max: 45 });
    const authored: CharacterPreset = { ...character, rig };

    // A plain rebuild from parts loses the reaches — this is the bug the editor's withRig hit.
    expect(buildDefaultRig(authored).reaches).toEqual([]);

    // The preserving rebuild keeps both reach and rotReach, and stays valid.
    const rebuilt = rebuildRigPreservingConstraints(authored);
    const eyeReach = rebuilt.reaches.find((r) => r.slotId === "slot:left-eye");
    expect(eyeReach?.reach).toHaveLength(4);
    expect(eyeReach?.rotReach).toEqual({ min: -30, max: 45 });
    expect(validateCharacterRig(rebuilt).ok).toBe(true);
  });

  it("rebuild preserves a manually chosen host (drag boundary) but keeps inferred defaults", () => {
    const character = makeRigCharacter();
    // Manually constrain the body to stay inside the head (not an inferred default).
    const rig = setSlotHostConstraint(
      buildDefaultRig(character),
      "role:body",
      "role:head",
      "insideHostBounds",
    );
    const authored: CharacterPreset = { ...character, rig };

    const rebuilt = rebuildRigPreservingConstraints(authored);
    const bodyHost = rebuilt.hostConstraints.find((c) => c.slotId === "role:body");
    expect(bodyHost?.hostSlotId).toBe("role:head");
    expect(bodyHost?.mode).toBe("insideHostBounds");
    // Inferred face-slot host defaults still present for slots the user never touched.
    expect(rebuilt.hostConstraints.some((c) => c.slotId === "slot:left-iris")).toBe(true);
    expect(validateCharacterRig(rebuilt).ok).toBe(true);
  });

  it("rebuild drops a carried reach whose slot no longer exists", () => {
    const character = makeRigCharacter();
    const rig = setSlotReach(buildDefaultRig(character), "slot:left-eye", [
      { x: -10, y: -8 },
      { x: 10, y: -8 },
      { x: 10, y: 8 },
      { x: -10, y: 8 },
    ]);
    // Remove the eye part so its slot is gone; the stale reach must not survive (and must not
    // break validation).
    const withoutEye: CharacterPreset = {
      ...character,
      parts: character.parts.filter((p) => p.id !== "left-eye"),
      rig,
    };
    const rebuilt = rebuildRigPreservingConstraints(withoutEye);
    expect(rebuilt.reaches.some((r) => r.slotId === "slot:left-eye")).toBe(false);
    expect(validateCharacterRig(rebuilt).ok).toBe(true);
  });

  it("infers and normalizes host constraints for face slots", () => {
    const base = buildDefaultRig(makeRigCharacter());
    const eyeRelation = base.slotRelations.find(
      (relation) => relation.childSlotId === "slot:left-eye",
    );
    const irisRelation = base.slotRelations.find(
      (relation) => relation.childSlotId === "slot:left-iris",
    );
    const eyeHost = base.hostConstraints.find(
      (constraint) => constraint.slotId === "slot:left-eye",
    );

    expect(eyeRelation).toMatchObject({
      parentRef: { type: "slot", id: "role:head" },
      relationType: "containedFeature",
      visibilityMode: "withParentSlot",
      renderMode: "sibling",
    });
    expect(irisRelation).toMatchObject({
      parentRef: { type: "slot", id: "slot:left-eye" },
      relationType: "containedFeature",
      activeWhenParentVariant: { keys: ["open"] },
      visibilityMode: "withParentVariant",
      renderMode: "nested",
    });
    expect(eyeHost).toMatchObject({
      hostSlotId: "role:head",
      hostBoneId: "bone:role:head",
      mode: "insideHostMask",
      reachPolicy: "scaleToFit",
    });
    expect(
      base.hostConstraints.find((constraint) => constraint.slotId === "slot:left-iris"),
    ).toMatchObject({
      hostSlotId: "slot:left-eye",
      hostBoneId: "bone:slot:left-eye",
      mode: "insideHostMask",
      reachPolicy: "scaleToFit",
    });

    const cleared = setSlotHostConstraint(base, "slot:left-eye", undefined);
    expect(
      cleared.hostConstraints.some((constraint) => constraint.slotId === "slot:left-eye"),
    ).toBe(false);

    const normalized = normalizeCharacterRig({ ...makeRigCharacter(), rig: base });
    expect(
      normalized.hostConstraints.find((constraint) => constraint.slotId === "slot:left-eye"),
    ).toMatchObject({ hostSlotId: "role:head" });
    expect(
      normalized.slotRelations.find((relation) => relation.childSlotId === "slot:left-iris"),
    ).toMatchObject({ parentRef: { type: "slot", id: "slot:left-eye" } });
  });

  it("stores a rotation reach with min ≤ 0 ≤ max and clears an empty one", () => {
    const base = buildDefaultRig(makeRigCharacter());
    const twisted = setSlotRotReach(base, "slot:left-eye", { min: -30, max: 45 });
    expect(twisted.reaches.find((r) => r.slotId === "slot:left-eye")?.rotReach).toEqual({
      min: -30,
      max: 45,
    });

    // A same-sign range is clamped around rest (0).
    const oneSided = setSlotRotReach(base, "slot:left-eye", { min: 10, max: 40 });
    expect(oneSided.reaches.find((r) => r.slotId === "slot:left-eye")?.rotReach).toEqual({
      min: 0,
      max: 40,
    });

    const cleared = setSlotRotReach(twisted, "slot:left-eye", { min: 0, max: 0 });
    expect(cleared.reaches.find((r) => r.slotId === "slot:left-eye")?.rotReach).toBeUndefined();
  });

  it("tones a sampled motion delta down to the layer's reach", () => {
    const reach = {
      id: "reach:slot:left-eye",
      slotId: "slot:left-eye",
      reach: [
        { x: -10, y: -10 },
        { x: 10, y: -10 },
        { x: 10, y: 10 },
        { x: -10, y: 10 },
      ],
      rotReach: { min: -20, max: 30 },
    };

    // Inside the drift box and twist range → untouched.
    expect(clampMotionDeltaToReach(reach, 5, -5, 10)).toEqual({
      dx: 5,
      dy: -5,
      rotation: 10,
      clamped: false,
    });

    // Drift beyond the box → clamped onto its nearest edge.
    const drift = clampMotionDeltaToReach(reach, 40, 0, 0);
    expect(drift).toEqual({ dx: 10, dy: 0, rotation: 0, clamped: true });

    // Twist beyond max → capped at the range.
    const twist = clampMotionDeltaToReach(reach, 0, 0, 90);
    expect(twist.rotation).toBe(30);
    expect(twist.clamped).toBe(true);

    // No reach authored → motion passes through untouched.
    expect(clampMotionDeltaToReach(undefined, 99, 99, 99)).toEqual({
      dx: 99,
      dy: 99,
      rotation: 99,
      clamped: false,
    });
  });

  it("uses the active angle depth override as the parallax depth", () => {
    const baseRig = buildDefaultRig(makeRigCharacter());
    const rig: CharacterRig = {
      ...baseRig,
      activeAngle: "3qL",
      slotBindings: baseRig.slotBindings.map((binding) =>
        binding.slotId === "slot:left-eye"
          ? { ...binding, depth: 5, angleOverrides: { "3qL": { depth: 3 } } }
          : binding,
      ),
    };

    expect(activeDepthForSlot(rig, "slot:left-eye")).toBe(3);
    expect(activeDepthForSlot({ ...rig, activeAngle: "front" }, "slot:left-eye")).toBe(5);
  });
});
