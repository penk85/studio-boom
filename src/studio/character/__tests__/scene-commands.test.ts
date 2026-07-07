import { describe, expect, it } from "vitest";
import { createBlankCharacter, makePart } from "../character-utils";
import { normalizeCharacterRig } from "../rig";
import { applyCharacterSceneCommand, rotatePointAroundAnchor } from "../scene-commands";
import { anchorEntryForChild, anchorSourceForChild } from "../variant-pairing";
import { makeVariantArmCharacter } from "./fixtures";

function makeCommandCharacter() {
  return {
    ...createBlankCharacter("Command actor"),
    id: "command-actor",
    parts: [
      makePart("body", "body-media", {
        id: "body",
        slotId: "role:body",
        x: 100,
        y: 100,
        width: 100,
        height: 200,
        pivot: { x: 150, y: 180 },
        zIndex: 0,
      }),
      makePart("arm", "arm-media", {
        id: "arm",
        slotId: "slot:left-arm",
        side: "left",
        x: 10,
        y: 20,
        width: 30,
        height: 40,
        pivot: { x: 15, y: 25 },
        zIndex: 1,
      }),
      makePart("hand", "hand-media", {
        id: "hand",
        slotId: "slot:left-hand",
        side: "left",
        x: 40,
        y: 55,
        width: 20,
        height: 20,
        pivot: { x: 45, y: 60 },
        zIndex: 2,
      }),
    ],
  };
}

describe("character scene commands", () => {
  it("moves slot parts and their rig binding through one command", () => {
    const character = makeCommandCharacter();
    const result = applyCharacterSceneCommand(character, {
      kind: "move-slot",
      slotId: "slot:left-arm",
      dx: 7,
      dy: -3,
    });

    const moved = result.character.parts.find((part) => part.id === "arm")!;
    const body = result.character.parts.find((part) => part.id === "body")!;

    expect(result.changed).toBe(true);
    expect(moved.x).toBe(17);
    expect(moved.y).toBe(17);
    expect(moved.pivot).toEqual({ x: 22, y: 22 });
    expect(body.x).toBe(100);
  });

  it("scales slot parts around a canvas anchor", () => {
    const character = makeCommandCharacter();
    const result = applyCharacterSceneCommand(character, {
      kind: "scale-slot",
      slotId: "slot:left-arm",
      anchor: { x: 0, y: 0 },
      scaleX: 2,
      scaleY: 0.5,
    });

    const arm = result.character.parts.find((part) => part.id === "arm")!;

    expect(arm.x).toBe(20);
    expect(arm.y).toBe(10);
    expect(arm.width).toBe(60);
    expect(arm.height).toBe(20);
    expect(arm.pivot).toEqual({ x: 30, y: 13 });
  });

  it("can preview-move slot parts without mutating the rig binding", () => {
    const character = makeCommandCharacter();
    const rig = normalizeCharacterRig(character);
    const result = applyCharacterSceneCommand(
      { ...character, rig },
      {
        kind: "move-slot",
        slotId: "slot:left-arm",
        dx: 12,
        dy: 8,
        rig,
        updateRig: false,
      },
    );

    const arm = result.character.parts.find((part) => part.id === "arm")!;

    expect(arm.x).toBe(22);
    expect(arm.y).toBe(28);
    expect(result.character.rig).toBe(rig);
  });

  it("rotates a slot around a canvas anchor using the shared scene math", () => {
    const character = makeCommandCharacter();
    const result = applyCharacterSceneCommand(character, {
      kind: "rotate-slot",
      slotId: "slot:left-arm",
      anchor: { x: 0, y: 0 },
      degrees: 90,
      includeSubtree: false,
    });

    const arm = result.character.parts.find((part) => part.id === "arm")!;
    const expectedPivot = rotatePointAroundAnchor({ x: 15, y: 25 }, { x: 0, y: 0 }, 90);

    expect(Math.round(expectedPivot.x)).toBe(-25);
    expect(Math.round(expectedPivot.y)).toBe(15);
    expect(arm.x).toBe(-30);
    expect(arm.y).toBe(10);
    expect(arm.pivot).toEqual({ x: -25, y: 15 });
    expect(arm.rotation).toBe(90);
  });

  it("places, clears, and resets variant pins through scene commands", () => {
    const placed = applyCharacterSceneCommand(makeVariantArmCharacter(), {
      kind: "place-variant-pin",
      parentSlotId: "slot:right-arm",
      variantKey: "bent",
      childSlotId: "slot:right-hand",
      anchorPoint: { x: 370, y: 230 },
    }).character;

    expect(anchorEntryForChild(placed, "slot:right-hand", "bent")).toMatchObject({
      x: 80,
      y: 60,
      source: "pin",
    });

    const cleared = applyCharacterSceneCommand(placed, {
      kind: "clear-variant-pin",
      parentSlotId: "slot:right-arm",
      variantKey: "bent",
      childSlotId: "slot:right-hand",
    }).character;

    expect(anchorSourceForChild(cleared, "slot:right-hand", "bent")).toBe("fallback");

    const reset = applyCharacterSceneCommand(cleared, {
      kind: "reset-variant-pin",
      parentSlotId: "slot:right-arm",
      variantKey: "bent",
      childSlotId: "slot:right-hand",
    }).character;

    expect(anchorEntryForChild(reset, "slot:right-hand", "bent")).toMatchObject({
      x: 80,
      y: 60,
      source: "pin",
    });
  });

  it("sets variant pin rotation through the same command boundary", () => {
    const placed = applyCharacterSceneCommand(makeVariantArmCharacter(), {
      kind: "place-variant-pin",
      parentSlotId: "slot:right-arm",
      variantKey: "bent",
      childSlotId: "slot:right-hand",
      anchorPoint: { x: 370, y: 230 },
    }).character;
    const rotated = applyCharacterSceneCommand(placed, {
      kind: "set-variant-pin-rotation",
      parentSlotId: "slot:right-arm",
      variantKey: "bent",
      childSlotId: "slot:right-hand",
      rotation: 32,
    }).character;

    expect(anchorEntryForChild(rotated, "slot:right-hand", "bent")).toMatchObject({
      rotation: 32,
      source: "pin",
    });
  });

  it("reparents slots through a renderer-neutral scene command", () => {
    const result = applyCharacterSceneCommand(makeVariantArmCharacter(), {
      kind: "set-slot-parent",
      childSlotId: "slot:right-hand",
      parentSlotId: "role:body",
      angle: "front",
    });
    const rig = normalizeCharacterRig(result.character);
    const handBone = rig.bones.find((bone) => bone.id === "bone:slot:right-hand");
    const relation = rig.slotRelations.find((item) => item.childSlotId === "slot:right-hand");

    expect(result.changed).toBe(true);
    expect(handBone?.parentId).toBe("bone:role:body");
    expect(handBone?.restSource).toEqual({
      slotId: "role:body",
      pinName: "wrist:right",
    });
    expect(relation?.parentRef).toEqual({ type: "slot", id: "role:body" });
  });

  it("moves and fine-tunes bone rest through scene commands", () => {
    const character = makeCommandCharacter();
    const rig = normalizeCharacterRig(character);
    const binding = rig.slotBindings.find((item) => item.slotId === "slot:left-arm")!;
    const bone = rig.bones.find((item) => item.id === binding.boneId)!;
    const bodyBinding = rig.slotBindings.find((item) => item.slotId === "role:body")!;
    const bodyBone = rig.bones.find((item) => item.id === bodyBinding.boneId)!;

    const moved = applyCharacterSceneCommand(character, {
      kind: "move-bone-rest",
      boneId: bone.id,
      dx: 12,
      dy: -4,
      angle: rig.activeAngle,
    }).character;
    const movedBone = normalizeCharacterRig(moved).bones.find((item) => item.id === bone.id)!;

    expect(movedBone.x).toBe(bone.x + 12);
    expect(movedBone.y).toBe(bone.y - 4);

    const fineTuned = applyCharacterSceneCommand(moved, {
      kind: "set-bone-rest-transform",
      boneId: bodyBone.id,
      patch: { rotation: 18 },
      angle: rig.activeAngle,
    }).character;
    const fineTunedBone = normalizeCharacterRig(fineTuned).bones.find(
      (item) => item.id === bodyBone.id,
    )!;

    expect(fineTunedBone.rotation).toBe(18);
  });

  it("updates rig depths, host constraints, and reach constraints through commands", () => {
    const character = makeCommandCharacter();
    const rig = normalizeCharacterRig(character);
    const binding = rig.slotBindings.find((item) => item.slotId === "slot:left-arm")!;

    const withDepths = applyCharacterSceneCommand(
      applyCharacterSceneCommand(character, {
        kind: "set-bone-depth",
        boneId: binding.boneId,
        depth: 9,
      }).character,
      {
        kind: "set-slot-depth",
        slotId: "slot:left-arm",
        depth: 7,
      },
    ).character;
    const depthRig = normalizeCharacterRig(withDepths);

    expect(depthRig.bones.find((bone) => bone.id === binding.boneId)?.depth).toBe(9);
    expect(depthRig.slotBindings.find((item) => item.slotId === "slot:left-arm")?.depth).toBe(7);

    const withConstraints = applyCharacterSceneCommand(
      applyCharacterSceneCommand(
        applyCharacterSceneCommand(withDepths, {
          kind: "set-slot-host",
          slotId: "slot:left-hand",
          hostSlotId: "slot:left-arm",
          mode: "insideHostBounds",
          reachPolicy: "cap",
        }).character,
        {
          kind: "set-slot-reach",
          slotId: "slot:left-hand",
          reach: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 0, y: 10 },
          ],
        },
      ).character,
      {
        kind: "set-slot-rot-reach",
        slotId: "slot:left-hand",
        rotReach: { min: -15, max: 20 },
      },
    ).character;
    const constraintRig = normalizeCharacterRig(withConstraints);

    expect(constraintRig.hostConstraints).toContainEqual(
      expect.objectContaining({
        slotId: "slot:left-hand",
        hostSlotId: "slot:left-arm",
        mode: "insideHostBounds",
        reachPolicy: "cap",
      }),
    );
    expect(constraintRig.reaches.find((item) => item.slotId === "slot:left-hand")).toMatchObject({
      reach: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ],
      rotReach: { min: -15, max: 20 },
    });

    const cleared = applyCharacterSceneCommand(withConstraints, {
      kind: "clear-slot-reach",
      slotId: "slot:left-hand",
    }).character;
    const clearedReach = normalizeCharacterRig(cleared).reaches.find(
      (item) => item.slotId === "slot:left-hand",
    );

    expect(clearedReach).toMatchObject({ reach: undefined, rotReach: undefined });
  });

  it("sets flexible-part deformation across every variant in a slot", () => {
    const character = makeVariantArmCharacter();
    const result = applyCharacterSceneCommand(character, {
      kind: "set-slot-deform",
      slotId: "slot:right-arm",
      deform: {
        mode: "limb-path",
        start: { x: 10, y: 10 },
        end: { x: 10, y: 180 },
        segments: 8,
      },
    });

    expect(result.changed).toBe(true);
    expect(
      result.character.parts
        .filter((part) => part.slotId === "slot:right-arm")
        .map((part) => part.deform),
    ).toEqual([
      {
        mode: "limb-path",
        start: { x: 10, y: 10 },
        end: { x: 10, y: 180 },
        segments: 8,
      },
      {
        mode: "limb-path",
        start: { x: 10, y: 10 },
        end: { x: 10, y: 180 },
        segments: 8,
      },
    ]);
    expect(result.character.parts.find((part) => part.slotId === "slot:right-hand")?.deform).toBe(
      undefined,
    );

    const cleared = applyCharacterSceneCommand(result.character, {
      kind: "set-slot-deform",
      slotId: "slot:right-arm",
      deform: undefined,
    });

    expect(
      cleared.character.parts
        .filter((part) => part.slotId === "slot:right-arm")
        .every((part) => part.deform === undefined),
    ).toBe(true);
  });
});
