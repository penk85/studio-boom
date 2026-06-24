import { describe, expect, it } from "vitest";
import type { CharacterPreset } from "../../types";
import { createBlankCharacter, makePart } from "../character-utils";
import {
  canvasDeltaToMotionDelta,
  motionDeltaToCanvasDelta,
  runtimeMotionTargetForSlot,
  slotIdForRecordedOverride,
} from "../motion-targets";
import { buildCharacterRuntime } from "../runtime";

function characterWithPairedArms(): CharacterPreset {
  const left = makePart("arm", "left-media", {
    id: "left-arm",
    slotId: "slot:left-arm",
    side: "left",
    x: 10,
    y: 20,
    width: 30,
    height: 80,
  });
  const right = makePart("arm", "right-media", {
    id: "right-arm",
    slotId: "slot:right-arm",
    side: "right",
    x: 100,
    y: 20,
    width: 30,
    height: 80,
  });
  return {
    ...createBlankCharacter("Paired arms"),
    parts: [left, right],
    rig: {
      version: 2,
      activeAngle: "front",
      bones: [],
      slotBindings: [],
      drawOrder: [],
      slotRelations: [],
      hostConstraints: [],
      reaches: [],
      sockets: [],
      angles: {
        front: {
          angleId: "front",
          bones: [
            { id: "root", name: "Root", role: "root", x: 0, y: 0, rotation: 30 },
            {
              id: "left-bone",
              name: "Left arm",
              role: "arm",
              side: "left",
              parentId: "root",
              x: 20,
              y: 20,
              rotation: 0,
            },
            {
              id: "right-bone",
              name: "Right arm",
              role: "arm",
              side: "right",
              parentId: "root",
              x: 100,
              y: 20,
              rotation: 0,
            },
            {
              id: "left-child",
              name: "Left child",
              role: "hand",
              parentId: "left-bone",
              x: 0,
              y: 80,
              rotation: 0,
            },
            {
              id: "right-child",
              name: "Right child",
              role: "hand",
              parentId: "right-bone",
              x: 0,
              y: 80,
              rotation: 0,
            },
          ],
          slotBindings: [
            {
              slotId: "slot:left-arm",
              boneId: "left-bone",
              x: 0,
              y: 0,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              depth: 0,
            },
            {
              slotId: "slot:right-arm",
              boneId: "right-bone",
              x: 0,
              y: 0,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              depth: 0,
            },
          ],
          drawOrder: ["slot:left-arm", "slot:right-arm"],
          slotRelations: [],
          hostConstraints: [],
          reaches: [],
          sockets: [],
        },
      },
    },
  };
}

describe("runtime motion targets", () => {
  it("never resolves an ambiguous role-only override to an arbitrary side", () => {
    const runtime = buildCharacterRuntime(characterWithPairedArms());
    expect(slotIdForRecordedOverride(runtime, { partRole: "arm" })).toBeUndefined();
    expect(
      slotIdForRecordedOverride(runtime, {
        target: "bone",
        boneId: "left-bone",
        slotId: "slot:left-arm",
        partRole: "arm",
      }),
    ).toBe("slot:left-arm");
  });

  it("round-trips drag deltas through the target parent frame", () => {
    const runtime = buildCharacterRuntime(characterWithPairedArms());
    const target = runtimeMotionTargetForSlot(runtime, "slot:left-arm");
    const local = canvasDeltaToMotionDelta(runtime, target, { x: 20, y: 10 });
    const canvas = motionDeltaToCanvasDelta(runtime, target, local);

    expect(target).toEqual({ kind: "bone", slotId: "slot:left-arm", boneId: "left-bone" });
    expect(canvas.x).toBeCloseTo(20);
    expect(canvas.y).toBeCloseTo(10);
  });

  it("retains the attachment bone on a terminal slot target", () => {
    const character = characterWithPairedArms();
    const hand = makePart("hand", "right-hand-media", {
      id: "right-hand",
      slotId: "slot:right-hand",
      side: "right",
      x: 105,
      y: 95,
      width: 20,
      height: 20,
    });
    const angleRig = character.rig?.angles?.front;
    if (!character.rig || !angleRig) throw new Error("Expected front rig.");
    const runtime = buildCharacterRuntime({
      ...character,
      parts: [...character.parts, hand],
      rig: {
        ...character.rig,
        angles: {
          front: {
            ...angleRig,
            bones: [
              ...angleRig.bones,
              {
                id: "right-hand-bone",
                name: "Right hand",
                role: "hand",
                side: "right",
                parentId: "right-bone",
                x: 0,
                y: 80,
                rotation: 0,
              },
            ],
            slotBindings: [
              ...angleRig.slotBindings,
              {
                slotId: "slot:right-hand",
                boneId: "right-hand-bone",
                x: -5,
                y: -5,
                rotation: 0,
                scaleX: 1,
                scaleY: 1,
                depth: 0,
              },
            ],
            drawOrder: [...angleRig.drawOrder, "slot:right-hand"],
          },
        },
      },
    });

    expect(runtimeMotionTargetForSlot(runtime, "slot:right-hand")).toEqual({
      kind: "slot",
      slotId: "slot:right-hand",
      boneId: "right-hand-bone",
    });
  });
});
