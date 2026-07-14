import { describe, expect, it } from "vitest";
import {
  bendPlanePositions,
  clampBendDegrees,
  limbPathBendPoints,
  limbPathDeformedPoint,
  limbPathCurveWeight,
  limbPathEndWeight,
  limbPathLockFloor,
  limbPathPointAt,
  limbPathProjectPointT,
  limbPathTangentAngle,
  limbRibbonIndices,
  limbRibbonPositions,
  limbRibbonUVs,
} from "../mesh-deform";
import { createLimbRuntime, type LimbRuntime } from "../limb-runtime";

/**
 * The composition script embeds the whole factory closure, so re-creating the
 * runtime from its own toString() must reproduce the module build exactly —
 * this is the parity contract that keeps preview and export from drifting.
 */
const embeddedLimb = new Function(`return (${createLimbRuntime.toString()})();`)() as LimbRuntime;

const GRID = { width: 40, height: 120, verticesX: 3, verticesY: 13 } as const;

function vertex(out: Float32Array, verticesX: number, col: number, row: number) {
  const i = row * verticesX + col;
  return { x: out[i * 2], y: out[i * 2 + 1] };
}

function ribbonRowWidth(out: Float32Array, crossVertices: number, row: number) {
  const left = { x: out[row * crossVertices * 2], y: out[row * crossVertices * 2 + 1] };
  const right = {
    x: out[(row * crossVertices + crossVertices - 1) * 2],
    y: out[(row * crossVertices + crossVertices - 1) * 2 + 1],
  };
  return Math.hypot(right.x - left.x, right.y - left.y);
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

  it("preserves volume by scaling width against whole-path stretch", () => {
    const base = [
      { x: 30, y: 0 },
      { x: 30, y: 50 },
      { x: 30, y: 100 },
    ];
    const stretched = [
      { x: 30, y: 0 },
      { x: 30, y: 100 },
      { x: 30, y: 200 },
    ];
    const compressed = [
      { x: 30, y: 0 },
      { x: 30, y: 25 },
      { x: 30, y: 50 },
    ];

    const stretchedPos = limbRibbonPositions(stretched, 40, 2, undefined, {
      basePoints: base,
    });
    const compressedPos = limbRibbonPositions(compressed, 40, 2, undefined, {
      basePoints: base,
    });

    expect(ribbonRowWidth(stretchedPos, 2, 1)).toBeLessThan(40);
    expect(ribbonRowWidth(stretchedPos, 2, 1)).toBeGreaterThanOrEqual(40 * 0.72);
    expect(ribbonRowWidth(compressedPos, 2, 1)).toBeGreaterThan(40);
    expect(ribbonRowWidth(compressedPos, 2, 1)).toBeLessThanOrEqual(40 * 1.24);
  });

  it("adds a small overlap band after a moving lock to cover seam gaps", () => {
    const base = [
      { x: 30, y: 0 },
      { x: 30, y: 25 },
      { x: 30, y: 50 },
      { x: 30, y: 75 },
      { x: 30, y: 100 },
    ];
    const bent = limbPathBendPoints(base, { x: 0, y: 0 }, { x: 40, y: 0 }, [0.5]);
    const pos = limbRibbonPositions(bent, 40, 2, undefined, {
      basePoints: base,
      lockTs: [0.5],
    });

    expect(ribbonRowWidth(pos, 2, 2)).toBeGreaterThan(40);
  });

  it("matches the embedded factory build", () => {
    expect(Array.from(embeddedLimb.limbRibbonPositions(spine, 40, 2))).toEqual(
      Array.from(limbRibbonPositions(spine, 40, 2)),
    );
  });
});

describe("limb path attachment helpers", () => {
  const straight = [
    { x: 30, y: 0 },
    { x: 30, y: 50 },
    { x: 30, y: 100 },
  ];

  it("samples by distance along the path", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 0, y: 30 },
      { x: 40, y: 30 },
    ];

    expect(limbPathPointAt(path, 0.5)).toEqual({ x: 5, y: 30 });
  });

  it("keeps stretch straight when the bend handle is neutral", () => {
    const points = limbPathBendPoints(straight, { x: 50, y: 0 }, { x: 0, y: 0 });

    expect(points).toEqual([
      { x: 30, y: 0 },
      { x: 55, y: 50 },
      { x: 80, y: 100 },
    ]);
  });

  it("bends toward the curve point without stretching the art", () => {
    const dense = Array.from({ length: 17 }, (_, i) => ({ x: 30, y: (100 * i) / 16 }));
    const points = limbPathBendPoints(dense, { x: 0, y: 0 }, { x: 42, y: 0 });

    expect(points[0]).toEqual({ x: 30, y: 0 });
    // The elbow swings out toward the pole side.
    expect(Math.max(...points.map((p) => p.x))).toBeGreaterThan(50);
    // Folding pulls the free end toward the anchor instead of elongating.
    const endDistance = Math.hypot(points[16].x - 30, points[16].y - 0);
    expect(endDistance).toBeLessThan(100);
    // Arc length stays at the rest length (minus the small rounded-corner
    // cut), so texel density never drops from bending.
    let length = 0;
    for (let i = 1; i < points.length; i += 1) {
      length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    expect(length).toBeLessThanOrEqual(100.5);
    expect(length).toBeGreaterThan(88);
  });

  it("rounds the elbow instead of creasing at a hard corner", () => {
    const dense = Array.from({ length: 33 }, (_, i) => ({ x: 30, y: (100 * i) / 32 }));
    const points = limbPathBendPoints(dense, { x: 0, y: 0 }, { x: 42, y: 0 });

    // Total direction change from the first to the last segment is large,
    // but no single step turns by more than half of it: curvature is spread
    // across the rounded joint rather than concentrated at one row.
    const angles: number[] = [];
    for (let i = 1; i < points.length; i += 1) {
      angles.push(Math.atan2(points[i].y - points[i - 1].y, points[i].x - points[i - 1].x));
    }
    const turn = (a: number, b: number) => {
      let delta = b - a;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      return Math.abs(delta);
    };
    const totalTurn = turn(angles[0], angles[angles.length - 1]);
    let maxStepTurn = 0;
    for (let i = 1; i < angles.length; i += 1) {
      maxStepTurn = Math.max(maxStepTurn, turn(angles[i - 1], angles[i]));
    }
    expect(totalTurn).toBeGreaterThan(Math.PI / 4);
    expect(maxStepTurn).toBeLessThan(totalTurn / 2);
  });

  it("folds like IK when only the end is dragged inside reach and a side is locked", () => {
    const dense = Array.from({ length: 17 }, (_, i) => ({ x: 30, y: (100 * i) / 16 }));
    // Pull the hand 30px up with no curve at all; side -1 = fold toward +x
    // for this vertical limb (left-hand normal is -x).
    const points = limbPathBendPoints(
      dense,
      { x: 0, y: -30 },
      { x: 0, y: 0 },
      undefined,
      undefined,
      {
        side: -1,
      },
    );

    // The end lands exactly on the drag target (classic IK) …
    expect(points[16].x).toBeCloseTo(30, 1);
    expect(points[16].y).toBeCloseTo(70, 1);
    // … the elbow folds out to the requested side …
    expect(Math.max(...points.map((p) => p.x))).toBeGreaterThan(45);
    // … and arc length stays at the rest length minus the rounded-corner cut.
    let length = 0;
    for (let i = 1; i < points.length; i += 1) {
      length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    expect(length).toBeLessThanOrEqual(100.5);
    expect(length).toBeGreaterThan(88);
    // Without a locked side the same drag compresses straight (legacy shape).
    const straightDrag = limbPathBendPoints(dense, { x: 0, y: -30 }, { x: 0, y: 0 });
    expect(Math.max(...straightDrag.map((p) => p.x))).toBeCloseTo(30, 5);
  });

  it("keeps the elbow stable when the end reaches and crosses the root", () => {
    const dense = Array.from({ length: 33 }, (_, i) => ({ x: 30, y: (100 * i) / 32 }));
    const atRoot = limbPathBendPoints(
      dense,
      { x: 0, y: -100 },
      { x: 0, y: 0 },
      undefined,
      undefined,
      { side: -1 },
    );
    const pastRoot = limbPathBendPoints(
      dense,
      { x: 0, y: -101 },
      { x: 0, y: 0 },
      undefined,
      undefined,
      { side: -1 },
    );

    // A fully folded limb keeps its elbow volume instead of collapsing onto
    // the root, and crossing the root preserves the authored world-space side.
    expect(Math.max(...atRoot.map((p) => p.x))).toBeGreaterThan(65);
    expect(Math.max(...pastRoot.map((p) => p.x))).toBeGreaterThan(65);
    expect(Math.min(...pastRoot.map((p) => p.x))).toBeGreaterThanOrEqual(29.9);
  });

  it("clamps the fold to the locked side even when the curve points the other way", () => {
    const dense = Array.from({ length: 17 }, (_, i) => ({ x: 30, y: (100 * i) / 16 }));
    const guarded = limbPathBendPoints(
      dense,
      { x: 0, y: 0 },
      { x: -42, y: 0 },
      undefined,
      undefined,
      {
        side: -1,
      },
    );
    const free = limbPathBendPoints(dense, { x: 0, y: 0 }, { x: -42, y: 0 });

    // Unguarded, the curve pulls the elbow toward -x; guarded it stays +x.
    expect(Math.min(...free.map((p) => p.x))).toBeLessThan(10);
    expect(Math.min(...guarded.map((p) => p.x))).toBeGreaterThanOrEqual(29.9);
    expect(Math.max(...guarded.map((p) => p.x))).toBeGreaterThan(50);
  });

  it("bends at the authored joint position instead of the midpoint", () => {
    const dense = Array.from({ length: 33 }, (_, i) => ({ x: 30, y: (100 * i) / 32 }));
    const high = limbPathBendPoints(dense, { x: 0, y: 0 }, { x: 30, y: 0 }, undefined, undefined, {
      jointT: 0.25,
    });
    const low = limbPathBendPoints(dense, { x: 0, y: 0 }, { x: 30, y: 0 }, undefined, undefined, {
      jointT: 0.75,
    });

    const peakY = (points: Array<{ x: number; y: number }>) => {
      let best = points[0];
      for (const p of points) if (p.x > best.x) best = p;
      return best.y;
    };
    // A higher joint puts the elbow apex nearer the anchor than a lower one.
    expect(peakY(high)).toBeLessThan(peakY(low));
  });

  it("still stretches uniformly when the end is dragged past full reach", () => {
    const points = limbPathBendPoints(straight, { x: 0, y: 50 }, { x: 20, y: 0 });

    // Overreach keeps the limb nearly straight and reaches toward the target
    // by scaling both segments instead of folding.
    const endDistance = Math.hypot(points[2].x - 30, points[2].y - 0);
    expect(endDistance).toBeGreaterThan(100);
  });

  it("carries an off-spine child socket with the rotated ribbon cross-section", () => {
    const base = [
      { x: 30, y: 0 },
      { x: 30, y: 100 },
    ];
    const bent = [
      { x: 30, y: 0 },
      { x: 80, y: 50 },
    ];

    const socket = limbPathDeformedPoint(base, bent, { x: 50, y: 100 });

    expect(socket.x).toBeCloseTo(94.14, 2);
    expect(socket.y).toBeCloseTo(35.86, 2);
  });

  it("keeps embedded attachment helpers source-compatible", () => {
    expect(
      embeddedLimb.limbPathPointAt(
        [
          { x: 0, y: 0 },
          { x: 0, y: 10 },
        ],
        0.5,
      ),
    ).toEqual({ x: 0, y: 5 });
    expect(embeddedLimb.limbPathBendPoints(straight, { x: 50, y: 0 }, { x: 0, y: 0 })).toEqual(
      limbPathBendPoints(straight, { x: 50, y: 0 }, { x: 0, y: 0 }),
    );
    expect(
      embeddedLimb.limbPathBendPoints(straight, { x: 0, y: -10 }, { x: 42, y: 0 }, [0.25]),
    ).toEqual(limbPathBendPoints(straight, { x: 0, y: -10 }, { x: 42, y: 0 }, [0.25]));
    expect(
      embeddedLimb.limbPathDeformedPoint(
        [
          { x: 0, y: 0 },
          { x: 0, y: 10 },
        ],
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        { x: 2, y: 10 },
      ),
    ).toEqual(
      limbPathDeformedPoint(
        [
          { x: 0, y: 0 },
          { x: 0, y: 10 },
        ],
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        { x: 2, y: 10 },
      ),
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

describe("limb path lock weights", () => {
  it("keeps points before the latest lock fixed and eases distal points after it", () => {
    expect(limbPathEndWeight(0.25, [0.5])).toBe(0);
    expect(limbPathEndWeight(0.5, [0.5])).toBe(0);
    expect(limbPathEndWeight(0.75, [0.5])).toBeCloseTo(0.5, 5);
    expect(limbPathEndWeight(1, [0.5])).toBeCloseTo(1, 5);

    expect(limbPathCurveWeight(0.5, [0.5])).toBe(0);
    expect(limbPathCurveWeight(0.75, [0.5])).toBeCloseTo(1, 5);
    expect(limbPathCurveWeight(1, [0.5])).toBeCloseTo(0, 5);
  });

  it("projects attachment points and samples path tangents", () => {
    const path = [
      { x: 10, y: 10 },
      { x: 10, y: 60 },
      { x: 60, y: 60 },
    ];
    expect(limbPathProjectPointT(path, { x: 10, y: 35 })).toBeCloseTo(0.25, 5);
    expect(limbPathProjectPointT(path, { x: 35, y: 60 })).toBeCloseTo(0.75, 5);
    expect(limbPathTangentAngle(path, 0.25)).toBeCloseTo(Math.PI / 2, 5);
    expect(limbPathTangentAngle(path, 0.75)).toBeCloseTo(0, 5);
  });

  it("stays valid when embedded via the factory's Function.prototype.toString", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
    ];

    expect(embeddedLimb.limbPathEndWeight(0.8, [0.25, 0.5])).toBeCloseTo(
      limbPathEndWeight(0.8, [0.25, 0.5]),
      5,
    );
    expect(embeddedLimb.limbPathCurveWeight(0.8, [0.25, 0.5])).toBeCloseTo(
      limbPathCurveWeight(0.8, [0.25, 0.5]),
      5,
    );
    expect(embeddedLimb.limbPathProjectPointT(path, { x: 0, y: 75 })).toBeCloseTo(0.75, 5);
    expect(embeddedLimb.limbPathTangentAngle(path, 0.5)).toBeCloseTo(Math.PI / 2, 5);
    expect(embeddedLimb.limbPathLockFloor([0.25, 0.5])).toBeCloseTo(
      limbPathLockFloor([0.25, 0.5]),
      5,
    );
    // The apply/build runtime is part of the same embed: exercising geometry
    // through the embedded factory guards the whole shared surface.
    expect(
      Array.from(embeddedLimb.limbRibbonUVs(3, 2, { u0: 0.2, v0: 0.1, u1: 0.8, v1: 0.9 }, true)),
    ).toEqual(Array.from(limbRibbonUVs(3, 2, { u0: 0.2, v0: 0.1, u1: 0.8, v1: 0.9 }, true)));
    expect(Array.from(embeddedLimb.limbRibbonIndices(3, 2))).toEqual(
      Array.from(limbRibbonIndices(3, 2)),
    );
  });
});
