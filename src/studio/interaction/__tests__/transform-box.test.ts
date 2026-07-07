import { describe, expect, it } from "vitest";
import {
  axisAlignedContentFromQuad,
  contentOriginPx,
  rectToBounds,
  scaleCompositionRectFromHandleRect,
} from "../transform-box";

describe("scaleCompositionRectFromHandleRect", () => {
  it("is the identity on the frame when the content box equals the frame", () => {
    // No transparent padding: resizing the visible box resizes the frame 1:1.
    const start = { x: 100, y: 100, width: 200, height: 200 };
    expect(
      scaleCompositionRectFromHandleRect(
        start,
        start,
        { x: 100, y: 100, width: 300, height: 300 },
        1,
      ),
    ).toEqual({ x: 100, y: 100, width: 300, height: 300 });
  });

  it("scales the whole frame from a resized off-center content box", () => {
    // Content sits inset inside a padded frame; growing it 1.5x grows the frame 1.5x and keeps
    // the content's inset proportional (frame left moves from 100 toward the anchored corner).
    expect(
      scaleCompositionRectFromHandleRect(
        { x: 100, y: 100, width: 200, height: 200 },
        { x: 150, y: 150, width: 100, height: 100 },
        { x: 150, y: 150, width: 150, height: 150 },
        1,
      ),
    ).toEqual({ x: 75, y: 75, width: 300, height: 300 });
  });

  it("clamps the frame to minSize", () => {
    const result = scaleCompositionRectFromHandleRect(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 0, width: 2, height: 2 },
      16,
    );
    expect(result.width).toBe(16);
    expect(result.height).toBe(16);
  });
});

describe("contentOriginPx", () => {
  it("falls back to the content-box center when no pivot is given", () => {
    expect(contentOriginPx({ left: 40, top: 60, width: 100, height: 80 })).toEqual({
      x: 50,
      y: 40,
    });
  });

  it("returns the pivot relative to the content box top-left so the box rotates around the frame center", () => {
    // Content box is off-center inside its frame; the pivot (frame center) is outside the content
    // box, so the origin is a point measured from the content box's own top-left corner.
    expect(
      contentOriginPx({ left: 100, top: 100, width: 40, height: 40 }, { x: 90, y: 130 }),
    ).toEqual({ x: -10, y: 30 });
  });
});

describe("axisAlignedContentFromQuad", () => {
  it("returns the rect unchanged with zero rotation for an axis-aligned quad", () => {
    const quad: [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ] = [
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 80 },
      { x: 10, y: 80 },
    ];
    const { rect, rotationDeg } = axisAlignedContentFromQuad(quad, { x: 60, y: 50 });
    expect(rotationDeg).toBeCloseTo(0);
    expect(rect.x).toBeCloseTo(10);
    expect(rect.y).toBeCloseTo(20);
    expect(rect.width).toBeCloseTo(100);
    expect(rect.height).toBeCloseTo(60);
  });

  it("recovers the un-rotated rect + angle for a 90°-rotated quad", () => {
    // A 100x60 rect centered at (60,50), rotated 90° about its center.
    const pivot = { x: 60, y: 50 };
    const quad: [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ] = [
      { x: 90, y: 0 }, // top-left after +90° rotation
      { x: 90, y: 100 },
      { x: 30, y: 100 },
      { x: 30, y: 0 },
    ];
    const { rect, rotationDeg } = axisAlignedContentFromQuad(quad, pivot);
    expect(rotationDeg).toBeCloseTo(90);
    expect(rect.width).toBeCloseTo(100);
    expect(rect.height).toBeCloseTo(60);
    // Un-rotated, the rect returns to the axis-aligned box around the pivot.
    expect(rect.x).toBeCloseTo(10);
    expect(rect.y).toBeCloseTo(20);
  });
});

describe("rectToBounds", () => {
  it("converts x/y/width/height to left/top/right/bottom", () => {
    expect(rectToBounds({ x: 10, y: 20, width: 30, height: 40 })).toEqual({
      left: 10,
      top: 20,
      right: 40,
      bottom: 60,
    });
  });
});
