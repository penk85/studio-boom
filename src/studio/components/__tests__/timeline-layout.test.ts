import { describe, expect, it } from "vitest";
import type { ClipMotionStep, EditorClip } from "../../types";
import {
  buildTrackLayout,
  compositionOutlineLaneHeight,
  packVisualMotionRows,
  visualMotionLaneHeight,
} from "../timeline-layout";

function makeMotion(id: string, startTime: number, endTime: number): ClipMotionStep {
  return {
    id,
    checkpointIds: [],
    checkpoints: [],
    startKeyframeId: `${id}-start`,
    endKeyframeId: `${id}-end`,
    startTime,
    endTime,
    label: id,
    pathStyle: "linear",
  };
}

function makeClip(motionSteps: ClipMotionStep[]): EditorClip {
  return {
    id: "clip-1",
    name: "Clip 1",
    kind: "image",
    start: 0,
    duration: 5,
    trackIndex: 0,
    laneIndex: 0,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    zIndex: 0,
    locked: false,
    keyframes: [],
    motionStepMetas: [],
    motionSteps,
  };
}

describe("Timeline layout", () => {
  it("packs overlapping visual motions onto separate rows", () => {
    const packing = packVisualMotionRows([
      makeMotion("first", 0, 2),
      makeMotion("overlap", 1, 3),
      makeMotion("later", 3, 4),
    ]);

    expect(packing.rowCount).toBe(2);
    expect(packing.rowByMotionId).toEqual(
      new Map([
        ["first", 0],
        ["overlap", 1],
        ["later", 0],
      ]),
    );
    expect(packing.overlappingMotionIds).toEqual(new Set(["first", "overlap"]));
  });

  it("derives expanded-lane heights from packed rows and outline items", () => {
    const clip = makeClip([makeMotion("first", 0, 2), makeMotion("overlap", 1, 3)]);

    expect(visualMotionLaneHeight(clip)).toBe(84);
    expect(visualMotionLaneHeight()).toBe(54);
    expect(compositionOutlineLaneHeight([])).toBe(50);
  });

  it("keeps empty track lanes at the canonical base height", () => {
    expect(
      buildTrackLayout({
        trackIndex: 0,
        laneCount: 2,
        expandedMotionClips: [],
        expandedCompositionOutlines: [],
        compositionOutlinesByClipId: new Map(),
        expandedCharacters: [],
        expandedLayouts: new Map(),
      }),
    ).toEqual({
      lanes: [
        {
          index: 0,
          top: 0,
          visualMotionRows: [],
          compositionOutlineRows: [],
          motionRows: [],
        },
        {
          index: 1,
          top: 44,
          visualMotionRows: [],
          compositionOutlineRows: [],
          motionRows: [],
        },
      ],
      height: 88,
    });
  });
});
