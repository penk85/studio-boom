import { describe, expect, it } from "vitest";
import { makePart } from "../character-utils";
import {
  editorControlBounds,
  editorSelectionBounds,
  localAuthoredBounds,
  localRectCanvasBounds,
  pointInEditorHitBounds,
} from "../alpha-bounds";

describe("character editor bounds", () => {
  it("uses authored bounds before measured alpha bounds in art mode", () => {
    const part = makePart("hair", "hair-media", {
      x: 100,
      y: 50,
      width: 200,
      height: 180,
      alphaBounds: {
        x: 0,
        y: 0,
        width: 200,
        height: 180,
        sourceWidth: 200,
        sourceHeight: 180,
      },
      bounds: { type: "rect", x: 130, y: 90, width: 70, height: 80 },
    });

    expect(localAuthoredBounds(part)).toEqual({ x: 30, y: 40, width: 70, height: 80 });
    expect(editorSelectionBounds(part, "art")).toEqual({ x: 30, y: 40, width: 70, height: 80 });
    expect(editorSelectionBounds(part, "frame")).toEqual({ x: 0, y: 0, width: 200, height: 180 });

    expect(pointInEditorHitBounds(part, { x: 40, y: 50 }, 1, "art")).toBe(true);
    expect(pointInEditorHitBounds(part, { x: 5, y: 50 }, 1, "art")).toBe(false);

    const control = editorControlBounds(part, 1, "art");
    expect(control.x).toBe(18);
    expect(control.y).toBe(28);
    expect(control.width).toBe(94);
    expect(control.height).toBe(104);
  });

  it("projects local bounds through part rotation for canvas-space clamping", () => {
    const part = makePart("hair", "hair-media", {
      x: 100,
      y: 100,
      width: 100,
      height: 80,
      pivot: { x: 150, y: 140 },
      rotation: 90,
      bounds: { type: "rect", x: 120, y: 110, width: 40, height: 20 },
    });

    const canvasBounds = localRectCanvasBounds(part, localAuthoredBounds(part)!);

    expect(canvasBounds.x).toBe(160);
    expect(canvasBounds.y).toBe(110);
    expect(canvasBounds.width).toBe(20);
    expect(canvasBounds.height).toBe(40);
  });
});
