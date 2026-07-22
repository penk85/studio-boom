import { describe, expect, it } from "vitest";
import { makePart } from "../character-utils";
import {
  canvasPointToPartLocal,
  clampRectInsideHost,
  composeEditorPartTransform,
  convexHull,
  partLocalPointToCanvas,
  type EditorPartTransform,
} from "../character-editor-geometry";

describe("character editor geometry", () => {
  it("reduces a swept point cloud to its outer convex boundary", () => {
    expect(
      convexHull([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
        { x: 5, y: 5 },
        { x: 0, y: 0 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
  });

  it("clamps a translated subject inside its host bounds", () => {
    expect(
      clampRectInsideHost(
        { x: 10, y: 10, width: 20, height: 20 },
        { x: 0, y: 0, width: 40, height: 40 },
        25,
        -25,
      ),
    ).toEqual({ dx: 10, dy: -10 });
  });

  it("keeps part-local and canvas transforms inverse to one another", () => {
    const part = makePart("body", "body", {
      x: 20,
      y: 30,
      width: 120,
      height: 160,
      rotation: 18,
    });
    const base: EditorPartTransform = {
      dx: 4,
      dy: -3,
      rotation: 7,
      scale: 1.2,
      scaleY: 0.8,
      opacity: 1,
    };
    const transform = composeEditorPartTransform(part, base, { dx: 2, dy: 5, rotation: -2 });
    const local = { x: 37, y: 64 };
    const roundTrip = canvasPointToPartLocal(
      part,
      partLocalPointToCanvas(part, local, transform),
      transform,
    );

    expect(roundTrip.x).toBeCloseTo(local.x, 8);
    expect(roundTrip.y).toBeCloseTo(local.y, 8);
  });
});
