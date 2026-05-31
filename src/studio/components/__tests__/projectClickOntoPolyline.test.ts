import { describe, expect, it } from "vitest";
import { projectClickOntoPolyline } from "../stage-helpers";

describe("projectClickOntoPolyline", () => {
  it("returns null when the polyline has fewer than two points", () => {
    expect(projectClickOntoPolyline({ x: 0, y: 0 }, [])).toBeNull();
    expect(projectClickOntoPolyline({ x: 0, y: 0 }, [{ x: 0, y: 0, time: 0 }])).toBeNull();
  });

  it("projects a click onto the closer of two segments", () => {
    const polyline = [
      { x: 0, y: 0, time: 0 },
      { x: 100, y: 0, time: 1 },
      { x: 100, y: 100, time: 2 },
    ];
    // Click well above the horizontal segment but right of the vertical one.
    const projection = projectClickOntoPolyline({ x: 50, y: 5 }, polyline);
    expect(projection).not.toBeNull();
    expect(projection!.segmentIndex).toBe(0);
    expect(projection!.x).toBe(50);
    expect(projection!.y).toBe(0);
    expect(projection!.ratio).toBeCloseTo(0.5);
    expect(projection!.time).toBeCloseTo(0.5);
  });

  it("interpolates time linearly along the segment", () => {
    const polyline = [
      { x: 0, y: 0, time: 1 },
      { x: 200, y: 0, time: 5 },
    ];
    const projection = projectClickOntoPolyline({ x: 50, y: 0 }, polyline);
    expect(projection).not.toBeNull();
    expect(projection!.ratio).toBeCloseTo(0.25);
    // time = 1 + (5 - 1) * 0.25 = 2
    expect(projection!.time).toBeCloseTo(2);
  });

  it("clamps the projection to the segment ends", () => {
    const polyline = [
      { x: 0, y: 0, time: 0 },
      { x: 100, y: 0, time: 1 },
    ];
    // Click far to the left of the segment.
    const before = projectClickOntoPolyline({ x: -50, y: 0 }, polyline);
    expect(before!.ratio).toBe(0);
    expect(before!.time).toBe(0);
    // Click far to the right.
    const after = projectClickOntoPolyline({ x: 500, y: 0 }, polyline);
    expect(after!.ratio).toBe(1);
    expect(after!.time).toBe(1);
  });

  it("handles a zero-length segment without dividing by zero", () => {
    const polyline = [
      { x: 50, y: 50, time: 0 },
      { x: 50, y: 50, time: 1 },
      { x: 200, y: 50, time: 2 },
    ];
    const projection = projectClickOntoPolyline({ x: 100, y: 50 }, polyline);
    expect(projection).not.toBeNull();
    // The non-degenerate segment (index 1) is closer.
    expect(projection!.segmentIndex).toBe(1);
    expect(projection!.x).toBeCloseTo(100);
  });
});
