import { describe, expect, it } from "vitest";
import type { CharacterPreset, CharacterRig } from "../../types";
import { createBlankCharacter, makePart } from "../character-utils";
import {
  activeDepthForSlot,
  buildDefaultRig,
  clampMotionDeltaToReach,
  computeBoneWorldTransforms,
  moveBoneForSlot,
  moveSlotBinding,
  normalizeCharacterRig,
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

describe("CharacterRig V1", () => {
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
    const character = { ...makeRigCharacter(), angles: ["front", "sideL"] as CharacterPreset["angles"] };
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
    expect(base.hostConstraints.find((constraint) => constraint.slotId === "slot:left-iris"))
      .toMatchObject({
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
