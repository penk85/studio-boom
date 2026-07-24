import { describe, expect, it } from "vitest";
import { createBlankProject } from "../../store";
import type { EditorClip } from "../../types";
import type { ProjectTimelineClip } from "../../scenes";
import {
  buildCompositionSourceErrors,
  isKeyframeEditableClip,
  nearestLaneIndex,
  toSceneLocalClipPatch,
} from "../timeline-clip-utils";

function makeClip(overrides: Partial<EditorClip> = {}): EditorClip {
  return {
    id: "clip-1",
    name: "Clip 1",
    kind: "image",
    start: 12,
    duration: 4,
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
    motionSteps: [],
    ...overrides,
  };
}

function makeTimelineClip(overrides: Partial<ProjectTimelineClip> = {}): ProjectTimelineClip {
  return {
    ...makeClip(),
    sceneId: "scene-1",
    sceneIndex: 1,
    sceneStart: 10,
    localStart: 2,
    ...overrides,
  };
}

describe("Timeline clip utilities", () => {
  it("converts absolute project starts into the owning scene's local time", () => {
    expect(toSceneLocalClipPatch(makeTimelineClip(), { start: 16, duration: 3 })).toEqual({
      start: 6,
      duration: 3,
    });
    expect(toSceneLocalClipPatch(makeTimelineClip({ sceneId: null }), { start: 16 })).toEqual({
      start: 16,
    });
    expect(toSceneLocalClipPatch(makeTimelineClip(), { duration: 3 })).toEqual({
      duration: 3,
    });
  });

  it("chooses the lane whose center is closest to the drag point", () => {
    expect(nearestLaneIndex([], 200)).toBe(0);
    expect(nearestLaneIndex([0, 44, 88], 20)).toBe(0);
    expect(nearestLaneIndex([0, 44, 88], 70)).toBe(1);
    expect(nearestLaneIndex([0, 44, 88], 108)).toBe(2);
  });

  it("keeps audio out of keyframe expansion", () => {
    expect(isKeyframeEditableClip(makeClip())).toBe(true);
    expect(isKeyframeEditableClip(makeClip({ kind: "audio" }))).toBe(false);
  });

  it("reports a missing sub-composition source against its parent clip", () => {
    const project = createBlankProject("Timeline utility test");
    const clip = makeClip({
      kind: "composition",
      compositionId: "missing-composition",
    });

    expect(buildCompositionSourceErrors(project, [clip])).toEqual(
      new Map([[clip.id, ['Missing source for composition "missing-composition".']]]),
    );
  });
});
