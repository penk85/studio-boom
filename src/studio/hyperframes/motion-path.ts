// Shared motion-path sampler. The stage overlay and the keyframe compiler must
// call this with identical inputs so the SVG preview is byte-equal to the path
// the runtime tweens through. Pinned by a parity test in __tests__/motion-path.test.ts.

export interface PathPoint {
  x: number;
  y: number;
}

export const SMOOTH_SAMPLES_PER_SEGMENT = 24;

/**
 * Sample a Catmull-Rom spline that passes through every checkpoint exactly.
 * - Returns the checkpoints unchanged when there are fewer than 3 points
 *   (two points can only describe a straight line).
 * - Uses a centripetal Catmull-Rom (alpha = 0.5) to avoid loops/cusps when
 *   checkpoints are unevenly spaced.
 * - Output includes the original checkpoints at the segment boundaries so the
 *   curve provably passes through them.
 */
export function sampleSmoothPath(
  checkpoints: PathPoint[],
  samplesPerSegment = SMOOTH_SAMPLES_PER_SEGMENT,
): PathPoint[] {
  if (checkpoints.length < 3) return checkpoints.map((p) => ({ x: p.x, y: p.y }));

  const samples = Math.max(2, Math.floor(samplesPerSegment));
  const result: PathPoint[] = [];
  const last = checkpoints.length - 1;

  for (let i = 0; i < last; i += 1) {
    const p0 = checkpoints[i - 1] ?? checkpoints[i]!;
    const p1 = checkpoints[i]!;
    const p2 = checkpoints[i + 1]!;
    const p3 = checkpoints[i + 2] ?? p2;

    const t0 = 0;
    const t1 = t0 + parameterStep(p0, p1);
    const t2 = t1 + parameterStep(p1, p2);
    const t3 = t2 + parameterStep(p2, p3);

    // Start of the first segment includes p1 (the checkpoint).
    if (i === 0) result.push({ x: p1.x, y: p1.y });

    for (let step = 1; step <= samples; step += 1) {
      const t = t1 + ((t2 - t1) * step) / samples;
      result.push(catmullRomPoint(p0, p1, p2, p3, t0, t1, t2, t3, t));
    }
  }

  // Snap the last sample to the final checkpoint to avoid floating-point drift.
  const final = checkpoints[last]!;
  const tail = result[result.length - 1];
  if (tail) {
    tail.x = final.x;
    tail.y = final.y;
  }
  return result;
}

function parameterStep(a: PathPoint, b: PathPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Centripetal parameterization: alpha = 0.5 → exponent 0.25 on squared distance.
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (!Number.isFinite(dist) || dist <= 1e-6) return 1e-6;
  return Math.sqrt(dist);
}

function catmullRomPoint(
  p0: PathPoint,
  p1: PathPoint,
  p2: PathPoint,
  p3: PathPoint,
  t0: number,
  t1: number,
  t2: number,
  t3: number,
  t: number,
): PathPoint {
  const a1 = lerpPoint(p0, p1, (t - t0) / Math.max(1e-6, t1 - t0));
  const a2 = lerpPoint(p1, p2, (t - t1) / Math.max(1e-6, t2 - t1));
  const a3 = lerpPoint(p2, p3, (t - t2) / Math.max(1e-6, t3 - t2));
  const b1 = lerpPoint(a1, a2, (t - t0) / Math.max(1e-6, t2 - t0));
  const b2 = lerpPoint(a2, a3, (t - t1) / Math.max(1e-6, t3 - t1));
  return lerpPoint(b1, b2, (t - t1) / Math.max(1e-6, t2 - t1));
}

function lerpPoint(a: PathPoint, b: PathPoint, t: number): PathPoint {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

export type PathStyle = "linear" | "smooth";

export function normalizePathStyle(value: unknown): PathStyle {
  return value === "smooth" ? "smooth" : "linear";
}

export interface PositionCheckpoint {
  /** keyframe id — preserved on samples that land exactly on a checkpoint. */
  id: string;
  time: number;
  /** Absolute composition-space coordinates (clip base + keyframe delta). */
  x: number;
  y: number;
  /** Ease applied to the tween leading INTO this checkpoint, if any. */
  ease?: string;
}

export interface PositionPathSample {
  time: number;
  x: number;
  y: number;
  /** When the sample lands on a user-defined checkpoint, carries its id. */
  checkpointId?: string;
  ease?: string;
}

/**
 * The single source of truth for "what does this clip's motion path look like."
 * Both the compiled tween chain and the on-stage SVG overlay call this with the
 * same inputs — guarantees the preview line matches what the runtime plays.
 *
 * - Linear: returns the checkpoints unchanged (one sample per checkpoint).
 * - Smooth with 3+ checkpoints: returns densified samples along a centripetal
 *   Catmull-Rom spline, time-mapped linearly across the range. Endpoint samples
 *   land exactly on the first/last checkpoint.
 * - Smooth with 2 checkpoints: degrades to linear (two points can't curve).
 */
export function buildPositionPath(
  checkpoints: PositionCheckpoint[],
  pathStyle: PathStyle,
  samplesPerSegment = SMOOTH_SAMPLES_PER_SEGMENT,
): PositionPathSample[] {
  if (checkpoints.length === 0) return [];
  if (pathStyle === "linear" || checkpoints.length < 3) {
    return checkpoints.map((cp) => ({
      time: cp.time,
      x: cp.x,
      y: cp.y,
      checkpointId: cp.id,
      ease: cp.ease,
    }));
  }

  const points = sampleSmoothPath(
    checkpoints.map((cp) => ({ x: cp.x, y: cp.y })),
    samplesPerSegment,
  );
  if (points.length === 0) return [];

  const startTime = checkpoints[0]!.time;
  const endTime = checkpoints[checkpoints.length - 1]!.time;
  const span = Math.max(0, endTime - startTime);
  const lastIndex = points.length - 1;
  const samples: PositionPathSample[] = [];

  for (let i = 0; i < points.length; i += 1) {
    const progress = lastIndex === 0 ? 0 : i / lastIndex;
    const time = startTime + span * progress;
    const isFirst = i === 0;
    const isLast = i === lastIndex;
    samples.push({
      time,
      x: points[i]!.x,
      y: points[i]!.y,
      // Pin checkpoint ids only at the path's start/end. Intermediate user
      // checkpoints are still on the curve (Catmull-Rom passes through them),
      // but the sample at that exact index is approximate, so we don't claim
      // them — the stage draws their dots from the original checkpoints array.
      checkpointId: isFirst
        ? checkpoints[0]!.id
        : isLast
          ? checkpoints[checkpoints.length - 1]!.id
          : undefined,
      // Carry the start checkpoint's ease so the entry into the run respects it.
      // Intermediate samples use linear time progression (none).
      ease: isFirst ? checkpoints[0]!.ease : undefined,
    });
  }

  return samples;
}
