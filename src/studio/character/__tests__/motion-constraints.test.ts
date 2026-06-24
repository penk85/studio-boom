import { describe, expect, it } from "vitest";
import type { CharacterReach, CharacterSlotVariantPackage } from "../../types";
import { makePart } from "../character-utils";
import {
  buildMotionConstraintContext,
  effectiveReachForSlot,
  motionDeltaMovesJoint,
  parentSlotIdForBone,
  resolveFkJointDelta,
  resolveMotionDelta,
} from "../motion-constraints";

const armReach: CharacterReach = {
  id: "reach:slot:right-arm",
  slotId: "slot:right-arm",
  rotReach: { min: -40, max: 25 },
};

const fistPackage: CharacterSlotVariantPackage = {
  id: "variant:fist",
  slotId: "slot:right-hand",
  key: "closedFist",
  displayName: "Closed fist",
  rig: {
    bones: [
      {
        id: "vbone:fist",
        pivot: { x: 10, y: 12 },
        rotationLimits: [-80, -20],
      },
    ],
  },
};

describe("motion-constraints boundary", () => {
  it("clamps rotation and drift to the slot's authored reach", () => {
    const ctx = buildMotionConstraintContext({ reaches: [armReach] });
    const resolved = resolveMotionDelta({
      ctx,
      slotId: "slot:right-arm",
      role: "arm",
      dx: 0,
      dy: 0,
      rotation: 60,
    });
    expect(resolved.rotation).toBe(25);
    expect(resolved.clamped).toBe(true);
    expect(resolved.clampReasons).toEqual(["rotation"]);
    expect(resolved.effectiveReachSource).toBe("slotRotReach");
  });

  it("passes deltas through untouched when no reach is authored", () => {
    const ctx = buildMotionConstraintContext({ reaches: [] });
    const resolved = resolveMotionDelta({
      ctx,
      slotId: "slot:right-arm",
      dx: 14,
      dy: -3,
      rotation: 200,
    });
    expect(resolved).toMatchObject({ dx: 14, dy: -3, rotation: 200, clamped: false });
    expect(resolved.effectiveReachSource).toBe("none");
  });

  it("lets an active movement opt a layer out of bounds by slot id or role", () => {
    const ctx = buildMotionConstraintContext({ reaches: [armReach] });
    const bySlot = resolveMotionDelta({
      ctx,
      slotId: "slot:right-arm",
      role: "arm",
      dx: 0,
      dy: 0,
      rotation: 60,
      unclampedLayers: new Set(["slot:right-arm"]),
    });
    const byRole = resolveMotionDelta({
      ctx,
      slotId: "slot:right-arm",
      role: "arm",
      dx: 0,
      dy: 0,
      rotation: 60,
      unclampedLayers: new Set(["arm"]),
    });
    expect(bySlot.rotation).toBe(60);
    expect(bySlot.clamped).toBe(false);
    expect(byRole.rotation).toBe(60);
    expect(byRole.clamped).toBe(false);
  });

  it("overrides the slot reach with the active variant's rotation limits", () => {
    const handReach: CharacterReach = {
      id: "reach:slot:right-hand",
      slotId: "slot:right-hand",
      rotReach: { min: -10, max: 10 },
    };
    const ctx = buildMotionConstraintContext({
      reaches: [handReach],
      variantPackages: [fistPackage],
    });
    const open = effectiveReachForSlot(ctx, "slot:right-hand", { "slot:right-hand": "openPalm" });
    expect(open.reach?.rotReach).toEqual({ min: -10, max: 10 });
    expect(open.source).toBe("slotRotReach");

    const fist = effectiveReachForSlot(ctx, "slot:right-hand", { "slot:right-hand": "closedFist" });
    expect(fist.reach?.rotReach).toEqual({ min: -80, max: -20 });
    expect(fist.source).toBe("variantRotationLimits");

    const resolved = resolveMotionDelta({
      ctx,
      slotId: "slot:right-hand",
      activeVariants: new Map([["slot:right-hand", "closedFist"]]),
      dx: 0,
      dy: 0,
      rotation: 0,
    });
    expect(resolved.rotation).toBe(-20);
    expect(resolved.clamped).toBe(true);
  });

  it("applies variant rotation limits even when the slot has no authored reach", () => {
    const ctx = buildMotionConstraintContext({
      reaches: [],
      variantPackages: [fistPackage],
    });
    const resolved = resolveMotionDelta({
      ctx,
      slotId: "slot:right-hand",
      activeVariants: { "slot:right-hand": "closedFist" },
      dx: 5,
      dy: 5,
      rotation: 45,
    });
    expect(resolved.rotation).toBe(-20);
    expect(resolved.dx).toBe(5);
    expect(resolved.dy).toBe(5);
    expect(resolved.effectiveReachSource).toBe("variantRotationLimits");
  });

  it("matches a variant package to its key through parts carrying variantPackageId", () => {
    const part = makePart("hand", "hand-media", {
      id: "hand-fist",
      slotId: "slot:right-hand",
      pose: "fist",
      variantPackageId: "variant:anon",
    });
    const ctx = buildMotionConstraintContext({
      reaches: [],
      variantPackages: [{ ...fistPackage, id: "variant:anon", key: undefined }],
      parts: [part],
    });
    const { source } = effectiveReachForSlot(ctx, "slot:right-hand", {
      "slot:right-hand": "fist",
    });
    expect(source).toBe("variantRotationLimits");
  });

  it("locks FK child translation when an ancestor bone is already animated", () => {
    const ctx = buildMotionConstraintContext({
      reaches: [],
      bones: [
        { id: "bone:body", role: "body", name: "Body", x: 0, y: 0, rotation: 0, depth: 0 },
        {
          id: "bone:arm",
          role: "arm",
          name: "Arm",
          parentId: "bone:body",
          x: 10,
          y: 20,
          rotation: 0,
          depth: 0,
        },
        {
          id: "bone:hand",
          role: "hand",
          name: "Hand",
          parentId: "bone:arm",
          x: 5,
          y: 40,
          rotation: 0,
          depth: 0,
        },
      ],
    });

    const locked = resolveFkJointDelta({
      ctx,
      boneId: "bone:hand",
      slotId: "slot:hand",
      role: "hand",
      dx: 18,
      dy: -4,
      animatedBoneIds: new Set(["bone:body"]),
    });
    expect(locked).toMatchObject({ dx: 0, dy: 0, clamped: true, ancestorBoneId: "bone:body" });

    const allowed = resolveFkJointDelta({
      ctx,
      boneId: "bone:hand",
      slotId: "slot:hand",
      role: "hand",
      dx: 18,
      dy: -4,
      animatedBoneIds: new Set(["bone:body"]),
      unclampedLayers: new Set(["bone:hand"]),
    });
    expect(allowed).toMatchObject({ dx: 18, dy: -4, clamped: false });
  });

  it("does not FK-lock contained face feature drift", () => {
    const ctx = buildMotionConstraintContext({
      reaches: [],
      bones: [
        { id: "bone:head", role: "head", name: "Head", x: 0, y: 0, rotation: 0, depth: 0 },
        {
          id: "bone:eye",
          role: "eye",
          name: "Eye",
          parentId: "bone:head",
          x: 10,
          y: 20,
          rotation: 0,
          depth: 0,
        },
        {
          id: "bone:iris",
          role: "iris",
          name: "Iris",
          parentId: "bone:eye",
          x: 4,
          y: 6,
          rotation: 0,
          depth: 0,
        },
      ],
    });

    const resolved = resolveFkJointDelta({
      ctx,
      boneId: "bone:iris",
      slotId: "slot:iris",
      role: "iris",
      dx: 5,
      dy: 2,
      animatedBoneIds: new Set(["bone:head"]),
    });

    expect(resolved).toMatchObject({ dx: 5, dy: 2, clamped: false });
  });

  it("detects joint-moving transform deltas", () => {
    expect(
      motionDeltaMovesJoint({
        dx: 0,
        dy: 0,
        rotation: 0,
        scale: 1,
        scaleX: 1,
        scaleY: 1,
      }),
    ).toBe(false);
    expect(motionDeltaMovesJoint({ dx: 0, dy: 0, rotation: 12 })).toBe(true);
    expect(motionDeltaMovesJoint({ dx: 0, dy: 0, rotation: 0, scaleX: 1.1 })).toBe(true);
  });

  it("finds the parent slot whose variant re-anchors a bone", () => {
    const rig = {
      bones: [
        { id: "bone:slot:right-arm", name: "Arm", role: "arm", x: 0, y: 0, rotation: 0 },
        {
          id: "bone:slot:right-hand",
          name: "Hand",
          role: "hand",
          parentId: "bone:slot:right-arm",
          x: 10,
          y: 10,
          rotation: 0,
        },
      ],
      slotBindings: [
        {
          slotId: "slot:right-arm",
          boneId: "bone:slot:right-arm",
          x: 0,
          y: 0,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          depth: 0,
        },
        {
          slotId: "slot:right-hand",
          boneId: "bone:slot:right-hand",
          x: 0,
          y: 0,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          depth: 0,
        },
      ],
    } as Parameters<typeof parentSlotIdForBone>[0];
    expect(parentSlotIdForBone(rig, "bone:slot:right-hand")).toBe("slot:right-arm");
    expect(parentSlotIdForBone(rig, "bone:slot:right-arm")).toBeUndefined();
  });
});
