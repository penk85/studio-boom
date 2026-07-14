/**
 * Single source for the flexible limb ("rope" ribbon) runtime: the path/ribbon
 * math AND the build/apply logic both editor preview and generated character
 * compositions run.
 *
 * `createLimbRuntime` is embedded into the generated composition script as
 * `(${createLimbRuntime.toString()})()` and imported normally by
 * `pixi-preview-runtime.ts` / `mesh-deform.ts`, so the two runtimes cannot
 * drift. The factory body must stay fully self-contained: no imports, no
 * references to module scope (only its own locals and globals like `Math`),
 * nothing TS-specific beyond erasable type annotations. Inner functions may
 * reference each other freely — they share the factory closure, so even a
 * minified bundle keeps the references consistent inside `toString()` output.
 * mesh-deform.test.ts locks the embedded factory to the module build.
 */

export interface PathPoint {
  x: number;
  y: number;
}

export interface LimbRibbonPositionOptions {
  basePoints?: PathPoint[];
  lockTs?: number[];
  minWidthScale?: number;
  maxWidthScale?: number;
}

export interface LimbRopeAttachment {
  boneNodeId: string;
  localPoint: PathPoint;
}

export interface LimbBendOptions {
  /**
   * Locked bend direction: +1 folds the joint toward the path's left-hand
   * normal side, -1 the other way. When set it overrides the curve point's
   * side (hyperextension guard) and lets a pulled-in end fold with no curve
   * at all (IK-style "grab the wrist" drags).
   */
  side?: number;
  /** Authored joint position as t along the full path; defaults to midway. */
  jointT?: number;
}

/** Fields `buildRopeRibbon` reads off a rope mesh scene node. */
export interface LimbRopeNodeFields {
  pathPoints?: PathPoint[];
  pathLockTs?: number[];
  pathAttachments?: LimbRopeAttachment[];
  pathBendSide?: number;
  pathJointT?: number;
  crossVertices?: number;
  ropeWidth?: number;
  uvRect?: { u0: number; v0: number; u1: number; v1: number };
  ribbonVertical?: boolean;
}

export interface LimbRopeEntry<TMesh = unknown, TNode = unknown> {
  mesh: TMesh;
  node: TNode;
  basePathPoints: PathPoint[];
  width: number;
  crossVertices: number;
  lockTs?: number[];
  pathAttachments?: LimbRopeAttachment[];
  bendSide?: number;
  jointT?: number;
  positions: Float32Array;
  scratchPath: PathPoint[];
  pathEndX: number;
  pathEndY: number;
  pathCurveX: number;
  pathCurveY: number;
}

export interface LimbRuntime {
  limbRibbonPositions(
    points: PathPoint[],
    width: number,
    crossVertices: number,
    out?: Float32Array,
    options?: LimbRibbonPositionOptions,
  ): Float32Array;
  limbRibbonUVs(
    rows: number,
    crossVertices: number,
    uv: { u0: number; v0: number; u1: number; v1: number },
    vertical: boolean,
    out?: Float32Array,
  ): Float32Array;
  limbRibbonIndices(rows: number, crossVertices: number): Uint32Array;
  limbPathLockFloor(lockTs?: number[]): number;
  limbPathEndWeight(t: number, lockTs?: number[]): number;
  limbPathCurveWeight(t: number, lockTs?: number[]): number;
  limbPathProjectPointT(points: PathPoint[], point: PathPoint): number;
  limbPathPointAt(points: PathPoint[], t: number): PathPoint;
  limbPathTangentAngle(points: PathPoint[], t: number): number;
  limbPathBendPoints(
    basePoints: PathPoint[],
    endOffset: PathPoint,
    curveOffset: PathPoint,
    lockTs?: number[],
    out?: PathPoint[],
    options?: LimbBendOptions,
  ): PathPoint[];
  limbPathDeformedPoint(
    basePoints: PathPoint[],
    deformedPoints: PathPoint[],
    localPoint: PathPoint,
  ): PathPoint;
  clonePathPoints(points?: PathPoint[]): PathPoint[];
  normalizeRadians(value: number): number;
  buildRopeRibbon<TMesh, TNode extends LimbRopeNodeFields>(args: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    MeshSimple: new (options: any) => TMesh;
    texture: { width?: number; height?: number };
    node: TNode;
  }): { mesh: TMesh; entry: LimbRopeEntry<TMesh, TNode> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resetRopeEntries(entries?: Array<LimbRopeEntry<any, any>>): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyRopePathOffsets(entries?: Array<LimbRopeEntry<any, any>>): void;
  applyRopePathAttachments(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    entries: Array<LimbRopeEntry<any, any>> | undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nodes: Record<string, any>,
  ): void;
}

export function createLimbRuntime(): LimbRuntime {
  /** Lowest allowed lock t; rows at or below it stay pinned to the base path. */
  function limbPathLockFloor(lockTs?: number[]): number {
    let floor = 0;
    if (lockTs) {
      for (let i = 0; i < lockTs.length; i += 1) {
        const lock = Math.max(0, Math.min(0.999, Number(lockTs[i]) || 0));
        if (lock > floor) floor = lock;
      }
    }
    return floor;
  }

  function limbPathEndWeight(t: number, lockTs?: number[]): number {
    const clamped = Math.max(0, Math.min(1, Number(t) || 0));
    const floor = limbPathLockFloor(lockTs);
    if (clamped <= floor) return 0;
    return (clamped - floor) / Math.max(0.0001, 1 - floor);
  }

  function limbPathCurveWeight(t: number, lockTs?: number[]): number {
    const endWeight = limbPathEndWeight(t, lockTs);
    return 4 * endWeight * (1 - endWeight);
  }

  function limbPathProjectPointT(
    points: Array<{ x: number; y: number }>,
    point: { x: number; y: number },
  ): number {
    if (points.length < 2) return 0;
    let total = 0;
    const lengths: number[] = [];
    for (let i = 0; i < points.length - 1; i += 1) {
      const len = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
      lengths.push(len);
      total += len;
    }
    if (total <= 0) return 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestAlong = 0;
    let along = 0;
    for (let i = 0; i < lengths.length; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const denom = vx * vx + vy * vy || 1;
      const u = Math.max(0, Math.min(1, ((point.x - a.x) * vx + (point.y - a.y) * vy) / denom));
      const x = a.x + vx * u;
      const y = a.y + vy * u;
      const dist = Math.hypot(point.x - x, point.y - y);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestAlong = along + lengths[i] * u;
      }
      along += lengths[i];
    }
    return bestAlong / total;
  }

  function limbPathPointAt(
    points: Array<{ x: number; y: number }>,
    t: number,
  ): { x: number; y: number } {
    if (points.length === 0) return { x: 0, y: 0 };
    if (points.length === 1) return { x: points[0].x, y: points[0].y };
    const clamped = Math.max(0, Math.min(1, Number(t) || 0));
    let total = 0;
    const lengths: number[] = [];
    for (let i = 0; i < points.length - 1; i += 1) {
      const len = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
      lengths.push(len);
      total += len;
    }
    if (total <= 0) return { x: points[0].x, y: points[0].y };
    const target = total * clamped;
    let along = 0;
    for (let i = 0; i < lengths.length; i += 1) {
      const len = lengths[i];
      if (target <= along + len || i === lengths.length - 1) {
        const a = points[i];
        const b = points[i + 1];
        const u = len <= 0 ? 0 : (target - along) / len;
        return {
          x: a.x + (b.x - a.x) * u,
          y: a.y + (b.y - a.y) * u,
        };
      }
      along += len;
    }
    const last = points[points.length - 1];
    return { x: last.x, y: last.y };
  }

  function limbPathTangentAngle(points: Array<{ x: number; y: number }>, t: number): number {
    if (points.length < 2) return 0;
    const clamped = Math.max(0, Math.min(1, Number(t) || 0));
    let total = 0;
    const lengths: number[] = [];
    for (let i = 0; i < points.length - 1; i += 1) {
      const len = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
      lengths.push(len);
      total += len;
    }
    if (total <= 0) return 0;
    const target = total * clamped;
    let along = 0;
    for (let i = 0; i < lengths.length; i += 1) {
      const len = lengths[i];
      if (target <= along + len || i === lengths.length - 1) {
        const prev = points[i];
        const next = points[i + 1];
        return Math.atan2(next.y - prev.y, next.x - prev.x);
      }
      along += len;
    }
    const prev = points[points.length - 2];
    const next = points[points.length - 1];
    return Math.atan2(next.y - prev.y, next.x - prev.x);
  }

  function limbPathBendPoints(
    basePoints: Array<{ x: number; y: number }>,
    endOffset: { x: number; y: number },
    curveOffset: { x: number; y: number },
    lockTs?: number[],
    out?: Array<{ x: number; y: number }>,
    options?: { side?: number; jointT?: number },
  ): Array<{ x: number; y: number }> {
    const source =
      basePoints && basePoints.length >= 2
        ? basePoints
        : [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ];
    const result =
      out && out.length === source.length
        ? out
        : source.map((point) => ({ x: point.x, y: point.y }));
    const floor = limbPathLockFloor(lockTs);
    const anchor = limbPathPointAt(source, floor);
    const baseEnd = limbPathPointAt(source, 1);
    const end = {
      x: baseEnd.x + (Number(endOffset.x) || 0),
      y: baseEnd.y + (Number(endOffset.y) || 0),
    };
    const curve = {
      x: Number(curveOffset.x) || 0,
      y: Number(curveOffset.y) || 0,
    };
    const curveMagnitude = Math.hypot(curve.x, curve.y);
    // A locked bend direction clamps which side the joint folds toward
    // (hyperextension guard) and enables IK-style folding when only the end
    // is dragged; an authored joint position sets where the limb bends.
    const authoredSide = options && options.side ? (options.side > 0 ? 1 : -1) : 0;
    let midFrac = 0.5;
    if (options && typeof options.jointT === "number" && options.jointT > 0 && options.jointT < 1) {
      midFrac = Math.max(
        0.1,
        Math.min(0.9, (options.jointT - floor) / Math.max(0.0001, 1 - floor)),
      );
    }
    const baseMidT = floor + (1 - floor) * midFrac;
    const baseMid = limbPathPointAt(source, baseMidT);
    const upperLength = Math.max(0.0001, Math.hypot(baseMid.x - anchor.x, baseMid.y - anchor.y));
    const lowerLength = Math.max(0.0001, Math.hypot(baseEnd.x - baseMid.x, baseEnd.y - baseMid.y));
    const reach = upperLength + lowerLength;
    const split = upperLength / reach;
    const dx = end.x - anchor.x;
    const dy = end.y - anchor.y;
    const distance = Math.hypot(dx, dy);
    const d = Math.max(0.0001, distance);
    const restDx = baseEnd.x - anchor.x;
    const restDy = baseEnd.y - anchor.y;
    const restDistance = Math.max(0.0001, Math.hypot(restDx, restDy));
    const restUx = restDx / restDistance;
    const restUy = restDy / restDistance;
    // At the exact root the target vector has no direction. Keep the rest axis
    // there so a fully folded limb retains a stable elbow instead of collapsing.
    const ux = distance > 0.0001 ? dx / distance : restUx;
    const uy = distance > 0.0001 ? dy / distance : restUy;
    const px = -uy;
    const py = ux;
    const hasCurve = curveMagnitude > 0.001;
    const pulledIn = distance < reach * 0.999;
    const hasBend = hasCurve || (authoredSide !== 0 && pulledIn);
    if (!hasBend) {
      for (let i = 0; i < source.length; i += 1) {
        const t = source.length === 1 ? 0 : i / (source.length - 1);
        if (t <= floor || floor >= 0.999) {
          result[i].x = source[i].x;
          result[i].y = source[i].y;
          continue;
        }
        const w = (t - floor) / Math.max(0.0001, 1 - floor);
        result[i].x = anchor.x + (end.x - anchor.x) * w;
        result[i].y = anchor.y + (end.y - anchor.y) * w;
      }
      return result;
    }
    // Constant-length two-bone solve: both segments keep their rest lengths so
    // bending never stretches the art. The curve point is the pole: it picks
    // the elbow side and how deep the joint folds, and folding pulls the free
    // end toward the anchor the way a real elbow shortens its reach. Only an
    // end dragged past full reach stretches the limb, and then uniformly.
    const pole = {
      x: baseMid.x + (Number(endOffset.x) || 0) * split + curve.x,
      y: baseMid.y + (Number(endOffset.y) || 0) * split + curve.y,
    };
    const splitPoint = { x: anchor.x + dx * split, y: anchor.y + dy * split };
    const poleDistance = Math.abs((pole.x - splitPoint.x) * px + (pole.y - splitPoint.y) * py);
    const overreach = distance > reach ? distance / reach : 1;
    const upperSolved = upperLength * overreach;
    const lowerSolved = lowerLength * overreach;
    const foldLimit = 0.98 * Math.min(upperSolved, lowerSolved);
    // Curve depth deepens the fold beyond what the end position implies; a
    // pure end drag (IK) folds exactly as far as reaching the end requires.
    const fold = hasCurve ? Math.min(poleDistance, foldLimit) : 0;
    const dRequired =
      Math.sqrt(Math.max(0, upperSolved * upperSolved - fold * fold)) +
      Math.sqrt(Math.max(0, lowerSolved * lowerSolved - fold * fold));
    // Two unequal segments cannot reach inside the difference of their lengths.
    // Clamp to that inner radius instead of collapsing the shorter segment.
    const minReach = Math.max(0.0001, Math.abs(upperSolved - lowerSolved));
    const dEff = Math.max(minReach, Math.min(d, dRequired));
    const a = Math.max(
      0,
      Math.min(
        upperSolved,
        (upperSolved * upperSolved - lowerSolved * lowerSolved + dEff * dEff) / (2 * dEff),
      ),
    );
    const h = Math.sqrt(Math.max(0, upperSolved * upperSolved - a * a));
    const root = { x: anchor.x + ux * a, y: anchor.y + uy * a };
    const poleSide = (pole.x - root.x) * px + (pole.y - root.y) * py >= 0 ? 1 : -1;
    // `authoredSide` is relative to the limb's REST axis. Correct it against
    // the live axis so dragging the end through the root cannot flip the elbow.
    const restPx = -restUy;
    const restPy = restUx;
    const liveNormalMatchesRest = px * restPx + py * restPy >= 0 ? 1 : -1;
    const side = authoredSide !== 0 ? authoredSide * liveNormalMatchesRest : poleSide;
    const elbow = { x: root.x + px * h * side, y: root.y + py * h * side };
    const effEnd = { x: anchor.x + ux * dEff, y: anchor.y + uy * dEff };
    const upperRun = Math.max(0.0001, Math.hypot(elbow.x - anchor.x, elbow.y - anchor.y));
    const lowerRun = Math.max(0.0001, Math.hypot(effEnd.x - elbow.x, effEnd.y - elbow.y));
    const total = upperRun + lowerRun;
    const d1x = (elbow.x - anchor.x) / upperRun;
    const d1y = (elbow.y - anchor.y) / upperRun;
    const d2x = (effEnd.x - elbow.x) / lowerRun;
    const d2y = (effEnd.y - elbow.y) / lowerRun;
    // Round the joint: swap the hard corner for a quadratic arc spanning
    // `radius` of arc length on each side, so the art curves around the elbow
    // instead of creasing at it.
    const radius = 0.35 * Math.min(upperRun, lowerRun);
    for (let i = 0; i < source.length; i += 1) {
      const t = source.length === 1 ? 0 : i / (source.length - 1);
      if (t <= floor || floor >= 0.999) {
        result[i].x = source[i].x;
        result[i].y = source[i].y;
        continue;
      }
      const w = (t - floor) / Math.max(0.0001, 1 - floor);
      const s = w * total;
      if (s <= upperRun - radius) {
        result[i].x = anchor.x + d1x * s;
        result[i].y = anchor.y + d1y * s;
        continue;
      }
      if (s >= upperRun + radius) {
        result[i].x = elbow.x + d2x * (s - upperRun);
        result[i].y = elbow.y + d2y * (s - upperRun);
        continue;
      }
      const q = radius <= 0.0001 ? 0.5 : (s - (upperRun - radius)) / (2 * radius);
      const inv = 1 - q;
      const p0x = elbow.x - d1x * radius;
      const p0y = elbow.y - d1y * radius;
      const p2x = elbow.x + d2x * radius;
      const p2y = elbow.y + d2y * radius;
      result[i].x = inv * inv * p0x + 2 * inv * q * elbow.x + q * q * p2x;
      result[i].y = inv * inv * p0y + 2 * inv * q * elbow.y + q * q * p2y;
    }
    return result;
  }

  function limbPathDeformedPoint(
    basePoints: Array<{ x: number; y: number }>,
    deformedPoints: Array<{ x: number; y: number }>,
    localPoint: { x: number; y: number },
  ): { x: number; y: number } {
    if (basePoints.length < 2 || deformedPoints.length < 2) {
      return { x: localPoint.x, y: localPoint.y };
    }
    const t = limbPathProjectPointT(basePoints, localPoint);
    const baseSpine = limbPathPointAt(basePoints, t);
    const deformedSpine = limbPathPointAt(deformedPoints, t);
    const baseAngle = limbPathTangentAngle(basePoints, t);
    const deformedAngle = limbPathTangentAngle(deformedPoints, t);
    const baseTangent = { x: Math.cos(baseAngle), y: Math.sin(baseAngle) };
    const baseNormal = { x: -Math.sin(baseAngle), y: Math.cos(baseAngle) };
    const deformedTangent = { x: Math.cos(deformedAngle), y: Math.sin(deformedAngle) };
    const deformedNormal = { x: -Math.sin(deformedAngle), y: Math.cos(deformedAngle) };
    const dx = localPoint.x - baseSpine.x;
    const dy = localPoint.y - baseSpine.y;
    const along = dx * baseTangent.x + dy * baseTangent.y;
    const cross = dx * baseNormal.x + dy * baseNormal.y;
    return {
      x: deformedSpine.x + deformedTangent.x * along + deformedNormal.x * cross,
      y: deformedSpine.y + deformedTangent.y * along + deformedNormal.y * cross,
    };
  }

  /** Ribbon vertex positions (part-local px) for a spine sampled into points. */
  function limbRibbonPositions(
    points: Array<{ x: number; y: number }>,
    width: number,
    crossVertices: number,
    out?: Float32Array,
    options?: {
      basePoints?: Array<{ x: number; y: number }>;
      lockTs?: number[];
      minWidthScale?: number;
      maxWidthScale?: number;
    },
  ): Float32Array {
    const rows = points.length;
    const cross = Math.max(2, Math.floor(crossVertices) || 2);
    const floats = rows * cross * 2;
    const result = out && out.length === floats ? out : new Float32Array(floats);
    const baseHalf = (Number(width) || 0) / 2;
    const basePoints =
      options?.basePoints && options.basePoints.length === rows ? options.basePoints : undefined;
    const minWidthScale = Math.max(0.2, Number(options?.minWidthScale) || 0.72);
    const maxWidthScale = Math.max(minWidthScale, Number(options?.maxWidthScale) || 1.24);
    let maxDelta = 0;
    if (basePoints) {
      for (let i = 0; i < rows; i += 1) {
        maxDelta = Math.max(
          maxDelta,
          Math.hypot(points[i].x - basePoints[i].x, points[i].y - basePoints[i].y),
        );
      }
    }
    let lockFloor = 0;
    if (options?.lockTs) {
      for (let i = 0; i < options.lockTs.length; i += 1) {
        const lock = Math.max(0, Math.min(0.999, Number(options.lockTs[i]) || 0));
        if (lock > lockFloor) lockFloor = lock;
      }
    }
    const pathLength = (source: Array<{ x: number; y: number }>) => {
      let sum = 0;
      for (let i = 1; i < source.length; i += 1) {
        sum += Math.hypot(source[i].x - source[i - 1].x, source[i].y - source[i - 1].y);
      }
      return sum;
    };
    // One uniform width scale from the whole-path length ratio. Per-row span
    // ratios oscillate across the rounded joint (bezier sampling compresses
    // spans there), and row-to-row width changes scallop the art's silhouette.
    let uniformWidthScale = 1;
    if (basePoints) {
      const stretch = Math.max(
        0.0001,
        pathLength(points) / Math.max(0.0001, pathLength(basePoints)),
      );
      uniformWidthScale = Math.max(minWidthScale, Math.min(maxWidthScale, 1 / Math.sqrt(stretch)));
    }
    for (let i = 0; i < rows; i += 1) {
      const prev = points[i > 0 ? i - 1 : 0];
      const next = points[i < rows - 1 ? i + 1 : rows - 1];
      let tx = next.x - prev.x;
      let ty = next.y - prev.y;
      const len = Math.hypot(tx, ty) || 1;
      tx /= len;
      ty /= len;
      // Left-hand normal to the tangent gives the cross direction.
      const nx = -ty;
      const ny = tx;
      const p = points[i];
      let widthScale = uniformWidthScale;
      if (basePoints && maxDelta > 0.5 && lockFloor > 0 && lockFloor < 0.999) {
        const t = rows === 1 ? 0 : i / (rows - 1);
        const lockBand = 0.14;
        const lockDistance = t - lockFloor;
        if (lockDistance >= -0.01 && lockDistance <= lockBand) {
          const strength = Math.min(1, maxDelta / Math.max(1, Number(width) || 1));
          const fade = 1 - Math.max(0, lockDistance) / lockBand;
          widthScale = Math.max(widthScale, 1 + 0.18 * strength * fade);
        }
      }
      const half = baseHalf * widthScale;
      for (let j = 0; j < cross; j += 1) {
        const s = cross === 1 ? 0.5 : j / (cross - 1);
        const off = (s - 0.5) * half * 2;
        const idx = (i * cross + j) * 2;
        result[idx] = p.x + nx * off;
        result[idx + 1] = p.y + ny * off;
      }
    }
    return result;
  }

  /**
   * Static UVs mapping the visible texture sub-rect across the ribbon: the
   * long axis runs along the spine, the short axis across the columns.
   * `vertical` means the limb's long axis is the texture's v (height).
   *
   * The cross-axis mapping must agree with the LEFT-hand normal used in
   * `limbRibbonPositions`. For a vertical limb the cross axis is x, and the
   * left normal puts column `s = 0` on the +x (screen-right) side, so `u` has
   * to run high→low across `s` (`1 - s`) to keep the texture un-mirrored. For
   * a horizontal limb the cross axis is y and column `s = 0` already lands on
   * -y (screen-top), so `v` maps straight.
   */
  function limbRibbonUVs(
    rows: number,
    crossVertices: number,
    uv: { u0: number; v0: number; u1: number; v1: number },
    vertical: boolean,
    out?: Float32Array,
  ): Float32Array {
    const cross = Math.max(2, Math.floor(crossVertices) || 2);
    const rowCount = Math.max(2, Math.floor(rows) || 2);
    const floats = rowCount * cross * 2;
    const result = out && out.length === floats ? out : new Float32Array(floats);
    for (let i = 0; i < rowCount; i += 1) {
      const t = rowCount === 1 ? 0 : i / (rowCount - 1);
      for (let j = 0; j < cross; j += 1) {
        const s = cross === 1 ? 0 : j / (cross - 1);
        const idx = (i * cross + j) * 2;
        if (vertical) {
          result[idx] = uv.u0 + (uv.u1 - uv.u0) * (1 - s);
          result[idx + 1] = uv.v0 + (uv.v1 - uv.v0) * t;
        } else {
          result[idx] = uv.u0 + (uv.u1 - uv.u0) * t;
          result[idx + 1] = uv.v0 + (uv.v1 - uv.v0) * s;
        }
      }
    }
    return result;
  }

  /** Static triangle indices for the ribbon grid. */
  function limbRibbonIndices(rows: number, crossVertices: number): Uint32Array {
    const cross = Math.max(2, Math.floor(crossVertices) || 2);
    const rowCount = Math.max(2, Math.floor(rows) || 2);
    const out = new Uint32Array((rowCount - 1) * (cross - 1) * 6);
    let k = 0;
    for (let i = 0; i < rowCount - 1; i += 1) {
      for (let j = 0; j < cross - 1; j += 1) {
        const a = i * cross + j;
        const b = a + 1;
        const c = a + cross;
        const d = c + 1;
        out[k++] = a;
        out[k++] = b;
        out[k++] = c;
        out[k++] = b;
        out[k++] = d;
        out[k++] = c;
      }
    }
    return out;
  }

  function clonePathPoints(points?: Array<{ x: number; y: number }>) {
    const source =
      points && points.length >= 2
        ? points
        : [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ];
    return source.map((point) => ({ x: point.x, y: point.y }));
  }

  function normalizeRadians(value: number): number {
    let angle = Number(value) || 0;
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
  }

  /**
   * A textured ribbon (MeshSimple) preserves the full limb art along the
   * spine; a MeshRope pancakes it (texture height crushed into the width).
   * Returns the mesh plus the live entry that per-seek apply functions mutate.
   */
  function buildRopeRibbon(args: {
    MeshSimple: new (options: {
      texture: unknown;
      vertices: Float32Array;
      uvs: Float32Array;
      indices: Uint32Array;
    }) => unknown;
    texture: { width?: number; height?: number };
    node: {
      pathPoints?: Array<{ x: number; y: number }>;
      pathLockTs?: number[];
      pathAttachments?: Array<{ boneNodeId: string; localPoint: { x: number; y: number } }>;
      pathBendSide?: number;
      pathJointT?: number;
      crossVertices?: number;
      ropeWidth?: number;
      uvRect?: { u0: number; v0: number; u1: number; v1: number };
      ribbonVertical?: boolean;
    };
  }) {
    const node = args.node;
    const basePathPoints = clonePathPoints(node.pathPoints);
    const rows = basePathPoints.length;
    const crossVertices = Math.max(2, node.crossVertices || 2);
    const width = node.ropeWidth || Math.min(args.texture.width || 1, args.texture.height || 1);
    const uvRect = node.uvRect || { u0: 0, v0: 0, u1: 1, v1: 1 };
    const positions = limbRibbonPositions(basePathPoints, width, crossVertices);
    const mesh = new args.MeshSimple({
      texture: args.texture,
      vertices: positions,
      uvs: limbRibbonUVs(rows, crossVertices, uvRect, node.ribbonVertical !== false),
      indices: limbRibbonIndices(rows, crossVertices),
    });
    const entry = {
      mesh,
      node,
      basePathPoints,
      width,
      crossVertices,
      lockTs: node.pathLockTs,
      pathAttachments: node.pathAttachments,
      bendSide: node.pathBendSide,
      jointT: node.pathJointT,
      positions,
      scratchPath: basePathPoints.map((point) => ({ x: point.x, y: point.y })),
      pathEndX: 0,
      pathEndY: 0,
      pathCurveX: 0,
      pathCurveY: 0,
    };
    return { mesh, entry };
  }

  /** Reset per-seek animated offsets before timeline vars accumulate. */
  function resetRopeEntries(
    entries?: Array<{ pathEndX: number; pathEndY: number; pathCurveX: number; pathCurveY: number }>,
  ): void {
    (entries || []).forEach((entry) => {
      entry.pathEndX = 0;
      entry.pathEndY = 0;
      entry.pathCurveX = 0;
      entry.pathCurveY = 0;
    });
  }

  /**
   * Rebuild each animated spine from the accumulated end/curve offsets, then
   * rebuild the ribbon geometry so the limb art follows stretch as a ribbon
   * and bend as a constant-length two-bone elbow.
   */
  function applyRopePathOffsets(
    entries?: Array<{
      mesh: { vertices: Float32Array };
      basePathPoints: Array<{ x: number; y: number }>;
      width: number;
      crossVertices: number;
      lockTs?: number[];
      bendSide?: number;
      jointT?: number;
      positions: Float32Array;
      scratchPath: Array<{ x: number; y: number }>;
      pathEndX: number;
      pathEndY: number;
      pathCurveX: number;
      pathCurveY: number;
    }>,
  ): void {
    (entries || []).forEach((entry) => {
      if (entry.basePathPoints.length === 0) return;
      limbPathBendPoints(
        entry.basePathPoints,
        { x: entry.pathEndX, y: entry.pathEndY },
        { x: entry.pathCurveX, y: entry.pathCurveY },
        entry.lockTs,
        entry.scratchPath,
        { side: entry.bendSide, jointT: entry.jointT },
      );
      limbRibbonPositions(entry.scratchPath, entry.width, entry.crossVertices, entry.positions, {
        basePoints: entry.basePathPoints,
        lockTs: entry.lockTs,
      });
      entry.mesh.vertices = entry.positions;
    });
  }

  /**
   * Carry child bones (hands, cuffs) with the deformed spine: translate by the
   * attachment point's base→deformed delta and rotate by the tangent change.
   */
  function applyRopePathAttachments(
    entries:
      | Array<{
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          mesh: { parent: any };
          basePathPoints: Array<{ x: number; y: number }>;
          scratchPath: Array<{ x: number; y: number }>;
          pathAttachments?: Array<{ boneNodeId: string; localPoint: { x: number; y: number } }>;
        }>
      | undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nodes: Record<string, any>,
  ): void {
    (entries || []).forEach((entry) => {
      const attachments = entry.pathAttachments || [];
      if (!attachments.length) return;
      const container = entry.mesh && entry.mesh.parent;
      if (!container || !container.visible || container.alpha <= 0.0001) return;
      attachments.forEach((attachment) => {
        const child = nodes[attachment.boneNodeId];
        const parent = child && child.parent;
        if (!child || !parent) return;
        const t = limbPathProjectPointT(entry.basePathPoints, attachment.localPoint);
        const fromGlobal = container.toGlobal(attachment.localPoint);
        const toGlobal = container.toGlobal(
          limbPathDeformedPoint(entry.basePathPoints, entry.scratchPath, attachment.localPoint),
        );
        const fromParent = parent.toLocal(fromGlobal);
        const toParent = parent.toLocal(toGlobal);
        child.position.x += toParent.x - fromParent.x;
        child.position.y += toParent.y - fromParent.y;
        child.rotation += normalizeRadians(
          limbPathTangentAngle(entry.scratchPath, t) -
            limbPathTangentAngle(entry.basePathPoints, t),
        );
      });
    });
  }

  return {
    limbRibbonPositions,
    limbRibbonUVs,
    limbRibbonIndices,
    limbPathLockFloor,
    limbPathEndWeight,
    limbPathCurveWeight,
    limbPathProjectPointT,
    limbPathPointAt,
    limbPathTangentAngle,
    limbPathBendPoints,
    limbPathDeformedPoint,
    clonePathPoints,
    normalizeRadians,
    buildRopeRibbon,
    resetRopeEntries,
    applyRopePathAttachments,
    applyRopePathOffsets,
  } as LimbRuntime;
}
