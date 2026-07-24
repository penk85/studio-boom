import { describe, expect, it } from "vitest";
import type { EditorClip } from "../../types";
import {
  buildMoveSnapTargets,
  compositionDeltaToLocal,
  getLayerShortcut,
  getMovePreview,
  getResizePreview,
  getRotationPreview,
  scaleForKeyframedResize,
  type StageDrag,
} from "../stage-interactions";
import { getStageMotionPaths, motionPathData } from "../stage-motion-paths";

function makeClip(overrides: Partial<EditorClip> = {}): EditorClip {
  return {
    id: "clip-1",
    name: "Clip 1",
    kind: "image",
    start: 0,
    duration: 4,
    trackIndex: 0,
    laneIndex: 0,
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    zIndex: 1,
    locked: false,
    keyframes: [],
    motionStepMetas: [],
    motionSteps: [],
    ...overrides,
  };
}

describe("Stage interaction helpers", () => {
  it("builds snap targets from the canvas and other visual clips only", () => {
    const targets = buildMoveSnapTargets(
      [
        makeClip(),
        makeClip({ id: "clip-2", x: 300, y: 200 }),
        makeClip({ id: "audio-1", kind: "audio" }),
      ],
      1920,
      1080,
      "clip-1",
    );

    expect(targets).toEqual([
      {
        id: "stage-canvas",
        kind: "canvas",
        rect: { x: 0, y: 0, width: 1920, height: 1080 },
      },
      {
        id: "clip-2",
        kind: "clip",
        rect: { x: 300, y: 200, width: 100, height: 50 },
      },
    ]);
  });

  it("snaps a move preview using the drag's captured geometry and targets", () => {
    const drag: Extract<StageDrag, { type: "move" }> = {
      type: "move",
      clipId: "clip-1",
      pointerId: 1,
      startClientX: 0,
      startClientY: 0,
      startX: 7,
      startY: 20,
      width: 100,
      height: 50,
      previewX: 7,
      previewY: 20,
      snapTargets: [
        {
          id: "stage-canvas",
          kind: "canvas",
          rect: { x: 0, y: 0, width: 1920, height: 1080 },
        },
      ],
      snapGuides: [],
      geometry: {
        rect: new DOMRect(0, 0, 1920, 1080),
        scaleX: 1,
        scaleY: 1,
      },
    };

    expect(getMovePreview(drag, { x: 0, y: 0 }, true)).toMatchObject({
      previewX: 0,
      previewY: 20,
      snapGuides: [expect.objectContaining({ axis: "x", targetId: "stage-canvas" })],
    });
    expect(getMovePreview(drag, { x: 3, y: -5 }, false)).toEqual({
      previewX: 10,
      previewY: 15,
      snapGuides: [],
    });
  });

  it("derives resize, rotation, and local-axis previews without component state", () => {
    const resizeDrag: Extract<StageDrag, { type: "resize" }> = {
      type: "resize",
      clipId: "clip-1",
      handle: "se",
      pointerId: 1,
      startClientX: 0,
      startClientY: 0,
      startClip: { x: 100, y: 100, width: 80, height: 40 },
      startHandleRect: { x: 100, y: 100, width: 80, height: 40 },
      previewClip: { x: 100, y: 100, width: 80, height: 40 },
      previewHandleRect: { x: 100, y: 100, width: 80, height: 40 },
      rotation: 0,
      geometry: {
        rect: new DOMRect(0, 0, 1920, 1080),
        scaleX: 1,
        scaleY: 1,
      },
    };
    expect(getResizePreview(resizeDrag, 40, 0, true)).toEqual({
      previewHandleRect: { x: 100, y: 100, width: 120, height: 60 },
      previewClip: { x: 100, y: 100, width: 120, height: 60 },
    });

    const rotateDrag: Extract<StageDrag, { type: "rotate" }> = {
      type: "rotate",
      clipId: "clip-1",
      pointerId: 1,
      centerClientX: 0,
      centerClientY: 0,
      lastPointerAngle: 0,
      startRotation: 0,
      rawRotation: 0,
      previewRotation: 0,
    };
    expect(getRotationPreview(rotateDrag, 1, 1, true)).toEqual({
      lastPointerAngle: 45,
      rawRotation: 45,
      previewRotation: 45,
    });
    expect(compositionDeltaToLocal(10, 0, 90)).toEqual(
      expect.objectContaining({ x: expect.closeTo(0), y: -10 }),
    );
    expect(
      scaleForKeyframedResize(
        { width: 100, height: 50 },
        {
          x: 0,
          y: 0,
          width: 200,
          height: 100,
        },
      ),
    ).toBe(2);
  });

  it("maps modified arrow keys to layer commands", () => {
    expect(getLayerShortcut(new KeyboardEvent("keydown", { key: "ArrowUp", ctrlKey: true }))).toBe(
      "forward",
    );
    expect(
      getLayerShortcut(
        new KeyboardEvent("keydown", { key: "ArrowDown", metaKey: true, shiftKey: true }),
      ),
    ).toBe("back");
    expect(getLayerShortcut(new KeyboardEvent("keydown", { key: "ArrowUp" }))).toBeNull();
  });
});

describe("Stage motion-path helpers", () => {
  it("derives a visible standalone position path in Stage coordinates", () => {
    const clip = makeClip({
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      keyframes: [
        { id: "start", time: 0, properties: { x: 0, y: 0 } },
        { id: "end", time: 1, properties: { x: 100, y: 50 } },
      ],
    });

    const paths = getStageMotionPaths(
      clip,
      null,
      { rect: new DOMRect(5, 10, 1920, 1080), scaleX: 1, scaleY: 1 },
      null,
    );

    expect(paths).toHaveLength(1);
    expect(paths[0]?.checkpoints).toEqual([
      { id: "start", x: 15, y: 20, selected: false },
      { id: "end", x: 115, y: 70, selected: false },
    ]);
    expect(motionPathData(paths[0]!.polyline)).toBe("M 15 20 L 115 70");
  });

  it("rounds path coordinates and replaces non-finite SVG values", () => {
    expect(
      motionPathData([
        { x: 1.234, y: Number.POSITIVE_INFINITY, time: 0 },
        { x: 10, y: 20.678, time: 1 },
      ]),
    ).toBe("M 1.23 0 L 10 20.68");
  });
});
