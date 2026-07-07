import { describe, expect, it } from "vitest";
import {
  bendPlanePositions,
  clampBendDegrees,
  limbRibbonIndices,
  limbRibbonPositions,
  limbRibbonUVs,
} from "../mesh-deform";

const GRID = { width: 40, height: 120, verticesX: 3, verticesY: 13 } as const;

function vertex(out: Float32Array, verticesX: number, col: number, row: number) {
  const i = row * verticesX + col;
  return { x: out[i * 2], y: out[i * 2 + 1] };
}

describe("bendPlanePositions", () => {
  it("reproduces the straight PlaneGeometry grid at bend 0", () => {
    const out = bendPlanePositions({ ...GRID, axis: "y", anchor: "start", bend: 0 });
    for (let row = 0; row < GRID.verticesY; row++) {
      for (let col = 0; col < GRID.verticesX; col++) {
        const p = vertex(out, GRID.verticesX, col, row);
        expect(p.x).toBeCloseTo((col * GRID.width) / (GRID.verticesX - 1), 5);
        expect(p.y).toBeCloseTo((row * GRID.height) / (GRID.verticesY - 1), 5);
      }
    }
  });

  it("keeps the anchored joint row fixed while the free end swings", () => {
    const out = bendPlanePositions({ ...GRID, axis: "y", anchor: "start", bend: 60 });
    for (let col = 0; col < GRID.verticesX; col++) {
      const p = vertex(out, GRID.verticesX, col, 0);
      expect(p.x).toBeCloseTo((col * GRID.width) / (GRID.verticesX - 1), 5);
      expect(p.y).toBeCloseTo(0, 5);
    }
    const tip = vertex(out, GRID.verticesX, 1, GRID.verticesY - 1);
    expect(tip.x).toBeGreaterThan(GRID.width / 2 + 10);
    expect(tip.y).toBeLessThan(GRID.height);
  });

  it("bends from the actual registration point instead of the rectangle edge", () => {
    const out = bendPlanePositions({
      ...GRID,
      axis: "y",
      anchor: "start",
      originX: 10,
      originY: 20,
      bend: 60,
    });
    for (let col = 0; col < GRID.verticesX; col++) {
      const above = vertex(out, GRID.verticesX, col, 1);
      expect(above.x).toBeCloseTo((col * GRID.width) / (GRID.verticesX - 1), 5);
      expect(above.y).toBeCloseTo(10, 5);

      const joint = vertex(out, GRID.verticesX, col, 2);
      expect(joint.x).toBeCloseTo((col * GRID.width) / (GRID.verticesX - 1), 5);
      expect(joint.y).toBeCloseTo(20, 5);
    }
    const tip = vertex(out, GRID.verticesX, 1, GRID.verticesY - 1);
    expect(tip.x).toBeGreaterThan(20);
    expect(tip.y).toBeLessThan(GRID.height);
  });

  it("rotates the free-end cross-section by exactly the bend angle", () => {
    const bend = 45;
    const out = bendPlanePositions({ ...GRID, axis: "y", anchor: "start", bend });
    const left = vertex(out, GRID.verticesX, 0, GRID.verticesY - 1);
    const right = vertex(out, GRID.verticesX, GRID.verticesX - 1, GRID.verticesY - 1);
    const angle = (Math.atan2(right.y - left.y, right.x - left.x) * 180) / Math.PI;
    expect(Math.abs(angle)).toBeCloseTo(bend, 3);
  });

  it("preserves the spine length along the arc within 0.5%", () => {
    const out = bendPlanePositions({ ...GRID, axis: "y", anchor: "start", bend: 90 });
    let length = 0;
    for (let row = 1; row < GRID.verticesY; row++) {
      const a = vertex(out, GRID.verticesX, 1, row - 1);
      const b = vertex(out, GRID.verticesX, 1, row);
      length += Math.hypot(b.x - a.x, b.y - a.y);
    }
    expect(length).toBeGreaterThan(GRID.height * 0.995);
    expect(length).toBeLessThanOrEqual(GRID.height + 0.001);
  });

  it("mirrors anchor end against anchor start row for row", () => {
    const start = bendPlanePositions({ ...GRID, axis: "y", anchor: "start", bend: 30 });
    const end = bendPlanePositions({ ...GRID, axis: "y", anchor: "end", bend: 30 });
    for (let col = 0; col < GRID.verticesX; col++) {
      const fromStart = vertex(start, GRID.verticesX, col, GRID.verticesY - 3);
      const fromEnd = vertex(end, GRID.verticesX, col, 2);
      expect(fromEnd.x).toBeCloseTo(fromStart.x, 5);
      expect(fromEnd.y).toBeCloseTo(GRID.height - fromStart.y, 5);
    }
  });

  it("bends horizontal limbs toward +y with the transposed math", () => {
    const out = bendPlanePositions({
      width: 120,
      height: 40,
      verticesX: 13,
      verticesY: 3,
      axis: "x",
      anchor: "start",
      bend: 60,
    });
    for (let row = 0; row < 3; row++) {
      const p = vertex(out, 13, 0, row);
      expect(p.x).toBeCloseTo(0, 5);
      expect(p.y).toBeCloseTo((row * 40) / 2, 5);
    }
    const tip = vertex(out, 13, 12, 1);
    expect(tip.y).toBeGreaterThan(20 + 10);
    expect(tip.x).toBeLessThan(120);
  });

  it("stays valid when embedded via Function.prototype.toString", () => {
    const embedded = new Function(
      `return ${bendPlanePositions.toString()};`,
    )() as typeof bendPlanePositions;
    const args = { ...GRID, axis: "y", anchor: "end", bend: -35 } as const;
    expect(Array.from(embedded({ ...args }))).toEqual(Array.from(bendPlanePositions({ ...args })));
  });

  it("reuses the provided output buffer when sized correctly", () => {
    const out = new Float32Array(GRID.verticesX * GRID.verticesY * 2);
    const result = bendPlanePositions({ ...GRID, axis: "y", anchor: "start", bend: 15, out });
    expect(result).toBe(out);
  });
});

describe("clampBendDegrees", () => {
  it("clamps to the readable bend range and zeroes junk", () => {
    expect(clampBendDegrees(45)).toBe(45);
    expect(clampBendDegrees(200)).toBe(90);
    expect(clampBendDegrees(-200)).toBe(-90);
    expect(clampBendDegrees(Number.NaN)).toBe(0);
  });
});

describe("limbRibbonPositions", () => {
  // A straight vertical spine down x=30, from y=0 to y=120.
  const spine = Array.from({ length: 5 }, (_, i) => ({ x: 30, y: (i / 4) * 120 }));

  it("keeps the ribbon's real width across a straight spine (no pancake)", () => {
    const pos = limbRibbonPositions(spine, 40, 2);
    // Row 0's two columns straddle the spine (x=30) by ±20 → x=10 and x=50.
    expect([pos[0], pos[2]].sort((a, b) => a - b)).toEqual([10, 50]);
    // Both columns sit on the joint row (y=0).
    expect(pos[1]).toBeCloseTo(0, 5);
    expect(pos[3]).toBeCloseTo(0, 5);
    // Cross width is preserved, not collapsed into a thin strip.
    const width = Math.hypot(pos[2] - pos[0], pos[3] - pos[1]);
    expect(width).toBeCloseTo(40, 5);
  });

  it("orients the cross section perpendicular to a bent spine", () => {
    // 90-degree corner: down then right.
    const bent = [
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 50, y: 50 },
    ];
    const pos = limbRibbonPositions(bent, 20, 2);
    // Middle row's tangent is diagonal, so its cross vector must be perpendicular
    // to that tangent and still span the full width.
    const mid = { lx: pos[4], ly: pos[5], rx: pos[6], ry: pos[7] };
    const width = Math.hypot(mid.rx - mid.lx, mid.ry - mid.ly);
    expect(width).toBeCloseTo(20, 3);
    // Tangent at the corner ≈ (1,1)/√2; cross ≈ perpendicular (dot ≈ 0).
    const cross = { x: mid.rx - mid.lx, y: mid.ry - mid.ly };
    expect(cross.x * 1 + cross.y * 1).toBeCloseTo(0, 3);
  });

  it("matches its Function.prototype.toString embed", () => {
    const embedded = new Function(
      `return ${limbRibbonPositions.toString()};`,
    )() as typeof limbRibbonPositions;
    expect(Array.from(embedded(spine, 40, 2))).toEqual(
      Array.from(limbRibbonPositions(spine, 40, 2)),
    );
  });
});

describe("limbRibbonUVs / limbRibbonIndices", () => {
  it("maps the visible sub-rect along the spine for a vertical limb", () => {
    const uv = { u0: 0.2, v0: 0.1, u1: 0.8, v1: 0.9 };
    const uvs = limbRibbonUVs(3, 2, uv, true);
    // Row 0 (t=0): v=v0. Cross-axis u runs high→low across s so it stays
    // un-mirrored against the left-hand ribbon normal (see limbRibbonUVs).
    expect(uvs[0]).toBeCloseTo(0.8, 5); // col0 (s=0, +x side) u = u1
    expect(uvs[1]).toBeCloseTo(0.1, 5); // v = v0
    expect(uvs[2]).toBeCloseTo(0.2, 5); // col1 (s=1, -x side) u = u0
    // Last row (t=1): v=v1.
    expect(uvs[uvs.length - 1]).toBeCloseTo(0.9, 5);
  });

  it("keeps a vertical limb un-mirrored: u0 on the -x column, u1 on +x", () => {
    // Straight vertical spine → the left column (smaller x) must sample the
    // texture's left edge (u0), the right column its right edge (u1). This is
    // the parity guard for the at-rest squash/mirror regression.
    const spine = [
      { x: 30, y: 0 },
      { x: 30, y: 60 },
      { x: 30, y: 120 },
    ];
    const pos = limbRibbonPositions(spine, 40, 2);
    const uvs = limbRibbonUVs(spine.length, 2, { u0: 0, v0: 0, u1: 1, v1: 1 }, true);
    const cols = [
      { x: pos[0], u: uvs[0] },
      { x: pos[2], u: uvs[2] },
    ].sort((a, b) => a.x - b.x);
    expect(cols[0].u).toBeCloseTo(0, 5); // left column → u0
    expect(cols[1].u).toBeCloseTo(1, 5); // right column → u1
  });

  it("keeps a horizontal limb un-flipped: v0 on the -y column, v1 on +y", () => {
    const spine = [
      { x: 0, y: 20 },
      { x: 60, y: 20 },
      { x: 120, y: 20 },
    ];
    const pos = limbRibbonPositions(spine, 40, 2);
    const uvs = limbRibbonUVs(spine.length, 2, { u0: 0, v0: 0, u1: 1, v1: 1 }, false);
    const cols = [
      { y: pos[1], v: uvs[1] },
      { y: pos[3], v: uvs[3] },
    ].sort((a, b) => a.y - b.y);
    expect(cols[0].v).toBeCloseTo(0, 5); // top column → v0
    expect(cols[1].v).toBeCloseTo(1, 5); // bottom column → v1
  });

  it("builds two triangles per grid quad", () => {
    const indices = limbRibbonIndices(3, 2); // 2 quads → 4 triangles → 12 indices
    expect(indices).toHaveLength(12);
    expect(Math.max(...indices)).toBe(5); // 3 rows * 2 cols → indices 0..5
  });
});
