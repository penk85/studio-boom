import { describe, expect, it } from "vitest";
import type { CharacterPart, CharacterPreset } from "../../types";
import { createBlankCharacter, makePart } from "../character-utils";
import {
  resolveRuntimePartFrame,
  resolveRuntimePosePartFrame,
  type PartFrameTransform,
} from "../part-frame";
import { buildDefaultRig } from "../rig";
import { buildCharacterRuntime, runtimePartPlacement } from "../runtime";
import { runtimeMotionTargetForSlot } from "../motion-targets";

const identityTransform: PartFrameTransform = {
  dx: 0,
  dy: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  skewX: 0,
  skewY: 0,
  originX: 0.5,
  originY: 0.5,
};

function makeParentChildCharacter(parent: CharacterPart, child: CharacterPart): CharacterPreset {
  const character = {
    ...createBlankCharacter("Parent child actor"),
    parts: [parent, child],
  };
  return { ...character, rig: buildDefaultRig(character) };
}

function frameForSlot(
  character: CharacterPreset,
  slotId: string,
  transforms: ReadonlyMap<string, PartFrameTransform>,
) {
  const runtime = buildCharacterRuntime(character);
  const slot = runtime.slotById.get(slotId);
  const part = slot?.parts[0];
  if (!slot || !part) throw new Error(`Expected ${slotId}.`);
  return resolveRuntimePosePartFrame({
    slotId,
    resolveTransformForSlot: (candidateSlotId) => transforms.get(candidateSlotId),
    part,
    placement: runtimePartPlacement(slot, part, runtime, { basePart: part }),
    runtime,
    target: runtimeMotionTargetForSlot(runtime, slotId),
    transform: transforms.get(slotId) ?? identityTransform,
    localBounds: { x: 0, y: 0, width: part.width, height: part.height },
  });
}

describe("runtime pose part frames", () => {
  it("carries a hand frame with its animated parent arm", () => {
    const character = makeParentChildCharacter(
      makePart("arm", "arm-media", {
        id: "right-arm",
        slotId: "slot:right-arm",
        side: "right",
        x: 100,
        y: 100,
        width: 50,
        height: 140,
      }),
      makePart("hand", "hand-media", {
        id: "right-hand",
        slotId: "slot:right-hand",
        side: "right",
        parentId: "right-arm",
        x: 108,
        y: 225,
        width: 36,
        height: 36,
      }),
    );
    const rest = frameForSlot(character, "slot:right-hand", new Map());
    const moved = frameForSlot(
      character,
      "slot:right-hand",
      new Map([
        [
          "slot:right-arm",
          {
            ...identityTransform,
            dx: 28,
            dy: -11,
          },
        ],
      ]),
    );

    expect(moved.pivot.x - rest.pivot.x).toBeCloseTo(28);
    expect(moved.pivot.y - rest.pivot.y).toBeCloseTo(-11);
  });

  it("rotates a hand around its animated parent arm joint", () => {
    const character = makeParentChildCharacter(
      makePart("arm", "arm-media", {
        id: "right-arm",
        slotId: "slot:right-arm",
        side: "right",
        x: 100,
        y: 100,
        width: 50,
        height: 140,
      }),
      makePart("hand", "hand-media", {
        id: "right-hand",
        slotId: "slot:right-hand",
        side: "right",
        parentId: "right-arm",
        x: 108,
        y: 225,
        width: 36,
        height: 36,
      }),
    );
    const arm = frameForSlot(character, "slot:right-arm", new Map());
    const rest = frameForSlot(character, "slot:right-hand", new Map());
    const rotated = frameForSlot(
      character,
      "slot:right-hand",
      new Map([
        [
          "slot:right-arm",
          {
            ...identityTransform,
            rotation: 90,
          },
        ],
      ]),
    );
    const relative = {
      x: rest.pivot.x - arm.pivot.x,
      y: rest.pivot.y - arm.pivot.y,
    };

    expect(rotated.pivot.x).toBeCloseTo(arm.pivot.x - relative.y);
    expect(rotated.pivot.y).toBeCloseTo(arm.pivot.y + relative.x);
  });

  it("moves a nested iris by the exact same inherited eye delta", () => {
    const character = makeParentChildCharacter(
      makePart("eye", "eye-media", {
        id: "left-eye",
        slotId: "slot:left-eye",
        side: "left",
        eyeState: "open",
        x: 140,
        y: 112,
        width: 32,
        height: 20,
      }),
      makePart("iris", "iris-media", {
        id: "left-iris",
        slotId: "slot:left-iris",
        side: "left",
        parentId: "left-eye",
        x: 152,
        y: 116,
        width: 8,
        height: 8,
      }),
    );
    const runtime = buildCharacterRuntime(character);
    expect(
      runtime.angleRig.slotRelations.find((relation) => relation.childSlotId === "slot:left-iris")
        ?.renderMode,
    ).toBe("nested");

    const rest = frameForSlot(character, "slot:left-iris", new Map());
    const moved = frameForSlot(
      character,
      "slot:left-iris",
      new Map([
        [
          "slot:left-eye",
          {
            ...identityTransform,
            dx: 14,
            dy: 6,
          },
        ],
      ]),
    );

    expect(moved.pivot.x - rest.pivot.x).toBeCloseTo(14);
    expect(moved.pivot.y - rest.pivot.y).toBeCloseTo(6);
  });

  it("scales a nested iris around its animated eye joint", () => {
    const character = makeParentChildCharacter(
      makePart("eye", "eye-media", {
        id: "left-eye",
        slotId: "slot:left-eye",
        side: "left",
        eyeState: "open",
        x: 140,
        y: 112,
        width: 32,
        height: 20,
      }),
      makePart("iris", "iris-media", {
        id: "left-iris",
        slotId: "slot:left-iris",
        side: "left",
        parentId: "left-eye",
        x: 152,
        y: 116,
        width: 8,
        height: 8,
      }),
    );
    const eye = frameForSlot(character, "slot:left-eye", new Map());
    const rest = frameForSlot(character, "slot:left-iris", new Map());
    const scaled = frameForSlot(
      character,
      "slot:left-iris",
      new Map([
        [
          "slot:left-eye",
          {
            ...identityTransform,
            scaleX: 1.5,
            scaleY: 0.75,
          },
        ],
      ]),
    );

    expect(scaled.pivot.x).toBeCloseTo(eye.pivot.x + (rest.pivot.x - eye.pivot.x) * 1.5);
    expect(scaled.pivot.y).toBeCloseTo(eye.pivot.y + (rest.pivot.y - eye.pivot.y) * 0.75);
  });

  it("keeps the low-level frame API available without inherited motion", () => {
    const character = makeParentChildCharacter(
      makePart("arm", "arm-media", {
        id: "right-arm",
        slotId: "slot:right-arm",
        side: "right",
      }),
      makePart("hand", "hand-media", {
        id: "right-hand",
        slotId: "slot:right-hand",
        side: "right",
        parentId: "right-arm",
      }),
    );
    const runtime = buildCharacterRuntime(character);
    const slot = runtime.slotById.get("slot:right-hand");
    const part = slot?.parts[0];
    if (!slot || !part) throw new Error("Expected right hand.");
    const frame = resolveRuntimePartFrame({
      part,
      placement: runtimePartPlacement(slot, part, runtime, { basePart: part }),
      runtime,
      target: runtimeMotionTargetForSlot(runtime, slot.id),
      transform: identityTransform,
      localBounds: { x: 0, y: 0, width: part.width, height: part.height },
    });

    expect(frame.quad).toHaveLength(4);
  });
});
