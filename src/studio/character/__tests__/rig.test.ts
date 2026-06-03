import { describe, expect, it } from "vitest";
import type { CharacterPreset, CharacterRig } from "../../types";
import { createBlankCharacter, makePart } from "../character-utils";
import {
  activeDepthForSlot,
  buildDefaultRig,
  clampHostedPartPosition,
  computeBoneWorldTransforms,
  moveBoneForSlot,
  moveSlotBinding,
  moveSlotParts,
  normalizeCharacterRig,
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

  it("clamps hosted facial slots inside their host bounds", () => {
    const character = makeRigCharacter();
    const clamped = clampHostedPartPosition(character, "slot:left-eye", { x: 999, y: 999 });
    const movedParts = moveSlotParts(character, "slot:left-eye", 999, 999, { clampToHost: true });
    const movedEye = movedParts.find((part) => part.id === "left-eye");

    expect(clamped.clamped).toBe(true);
    expect(clamped.x).toBeLessThanOrEqual(239);
    expect(clamped.y).toBeLessThanOrEqual(176);
    expect(movedEye?.x).toBe(clamped.x);
    expect(movedEye?.y).toBe(clamped.y);
  });

  it("keeps inferred host constraints when normalizing a partial rig", () => {
    const character = makeRigCharacter();
    const baseRig = buildDefaultRig(character);
    const normalized = normalizeCharacterRig({
      ...character,
      rig: {
        ...baseRig,
        hostConstraints: baseRig.hostConstraints.filter(
          (constraint) => constraint.slotId !== "slot:left-eye",
        ),
      },
    });

    expect(
      normalized.hostConstraints.some((constraint) => constraint.slotId === "slot:left-eye"),
    ).toBe(true);
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
