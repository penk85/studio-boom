import { describe, expect, it } from "vitest";
import { solveTwoBoneIk } from "../ik";
import { createBlankCharacter, makePart } from "../character-utils";
import { buildCharacterRenderPayload } from "../composition";
import { buildCharacterRuntime } from "../runtime";

describe("two-bone IK", () => {
  it("reaches a target and preserves both segment lengths", () => {
    const result = solveTwoBoneIk({
      root: { x: 0, y: 0 },
      mid: { x: 0, y: 100 },
      end: { x: 0, y: 200 },
      target: { x: 120, y: 120 },
      bendDirection: 1,
    });

    expect(result).toBeDefined();
    const mid = {
      x: Math.cos(result!.parentWorldRotation) * 100,
      y: Math.sin(result!.parentWorldRotation) * 100,
    };
    const end = {
      x: mid.x + Math.cos(result!.childWorldRotation) * 100,
      y: mid.y + Math.sin(result!.childWorldRotation) * 100,
    };
    expect(end.x).toBeCloseTo(result!.reachableTarget.x, 4);
    expect(end.y).toBeCloseTo(result!.reachableTarget.y, 4);
  });

  it("clamps an unreachable target to the chain's outer reach", () => {
    const result = solveTwoBoneIk({
      root: { x: 0, y: 0 },
      mid: { x: 50, y: 0 },
      end: { x: 100, y: 0 },
      target: { x: 500, y: 0 },
      bendDirection: 1,
    });

    expect(result?.clamped).toBe(true);
    expect(Math.hypot(result!.reachableTarget.x, result!.reachableTarget.y)).toBeCloseTo(100, 3);
  });

  it("bakes an IK Action into the same timeline payload used by export", () => {
    const character = {
      ...createBlankCharacter("IK actor"),
      id: "ik-actor",
      parts: [
        makePart("body", "body", {
          id: "body",
          slotId: "role:body",
          x: 100,
          y: 100,
          width: 160,
          height: 240,
          zIndex: 1,
        }),
        makePart("upperLeg", "upper-leg", {
          id: "upper-leg",
          slotId: "slot:left-upperLeg",
          side: "left",
          x: 120,
          y: 300,
          width: 40,
          height: 110,
          zIndex: 1,
          pivot: { x: 140, y: 310 },
        }),
        makePart("lowerLeg", "lower-leg", {
          id: "lower-leg",
          slotId: "slot:left-lowerLeg",
          side: "left",
          x: 125,
          y: 400,
          width: 40,
          height: 110,
          zIndex: 1,
          pivot: { x: 145, y: 410 },
        }),
        makePart("foot", "foot", {
          id: "foot",
          slotId: "slot:left-foot",
          side: "left",
          x: 130,
          y: 500,
          width: 70,
          height: 30,
          zIndex: 1,
          pivot: { x: 150, y: 510 },
        }),
      ],
    };
    const runtime = buildCharacterRuntime(character);
    const constraint = runtime.angleRig.ikConstraints?.[0];
    expect(constraint).toBeDefined();
    const preset = {
      id: "ik-action",
      name: "Place foot",
      category: "full-body" as const,
      duration: 1,
      loop: false,
      tracks: [],
      kinematics: "ik" as const,
      keyposes: [
        { t: 0, parts: [] },
        {
          t: 1,
          parts: [
            {
              target: "bone" as const,
              boneId: constraint!.targetBoneId,
              partRole: "custom" as const,
              dx: 30,
              dy: -20,
            },
          ],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const payload = buildCharacterRenderPayload({
      compositionId: "ik-comp",
      clipId: "ik-clip",
      width: character.canvasWidth,
      height: character.canvasHeight,
      duration: 1,
      character,
      meta: {
        characterId: character.id,
        poses: {},
        motions: [{ id: "applied", presetId: preset.id, offset: 0, intensity: 1 }],
      },
      motionPresets: new Map([[preset.id, preset]]),
    });
    const animated = payload.timelineScene.motionSegments.flatMap((segment) => segment.targets);
    expect(animated.some((target) => target.sceneNodeId?.endsWith(constraint!.parentBoneId))).toBe(
      true,
    );
    expect(animated.some((target) => target.sceneNodeId?.endsWith(constraint!.childBoneId))).toBe(
      true,
    );
  });
});
