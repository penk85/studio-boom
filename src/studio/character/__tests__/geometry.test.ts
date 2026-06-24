import { describe, expect, it } from "vitest";
import {
  composeMatrices,
  invertMatrix,
  matrixAroundPoint,
  pointInTransformedRect,
  transformPoint,
  translationMatrix,
} from "../geometry";

describe("character affine geometry", () => {
  it("round-trips points through an authored transform", () => {
    const matrix = composeMatrices(
      translationMatrix(120, 80),
      matrixAroundPoint(
        { x: 20, y: 15 },
        { rotation: 37, scaleX: 1.4, scaleY: 0.7, skewX: 8, skewY: -3 },
      ),
    );
    const point = { x: 42, y: 19 };
    const world = transformPoint(matrix, point);
    const local = transformPoint(invertMatrix(matrix), world);

    expect(local.x).toBeCloseTo(point.x);
    expect(local.y).toBeCloseTo(point.y);
  });

  it("hit-tests in local space instead of an oversized axis-aligned box", () => {
    const matrix = composeMatrices(
      translationMatrix(100, 100),
      matrixAroundPoint({ x: 0, y: 0 }, { rotation: 45 }),
    );
    const rect = { x: 0, y: 0, width: 100, height: 20 };

    expect(pointInTransformedRect({ x: 128, y: 142 }, matrix, rect)).toBe(true);
    expect(pointInTransformedRect({ x: 100, y: 155 }, matrix, rect)).toBe(false);
  });
});
