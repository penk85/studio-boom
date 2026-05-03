import type { AppliedMotion, MotionCategory, MotionPreset } from "../types";

const MIN_DURATION = 0.05;

export const EXCLUSIVE_MOTION_CATEGORIES = new Set<MotionCategory>(["expression"]);

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function appliedMotionDuration(
  motion: AppliedMotion,
  preset: MotionPreset | undefined,
): number {
  return Math.max(MIN_DURATION, motion.duration ?? preset?.duration ?? 1);
}

function categoryForMotion(
  motion: AppliedMotion,
  presetMap: Map<string, MotionPreset>,
): MotionCategory | undefined {
  return presetMap.get(motion.presetId)?.category;
}

function singleInterval(
  motion: AppliedMotion,
  preset: MotionPreset | undefined,
  clipDuration: number,
) {
  const duration = appliedMotionDuration(motion, preset);
  const maxOffset = Math.max(0, clipDuration - duration);
  const start = clamp(motion.offset, 0, maxOffset);
  const end = Math.min(clipDuration, start + duration);
  return { start, end, duration };
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }) {
  return a.start < b.end && b.start < a.end;
}

function nonRepeating(motion: AppliedMotion): AppliedMotion {
  const {
    loop: _loop,
    loopGap: _loopGap,
    loopGapMax: _loopGapMax,
    loopMode: _loopMode,
    ...rest
  } = motion;
  return { ...rest, loop: false };
}

/**
 * Enforce one active motion for categories that should never overlap.
 *
 * For expressions, the edited/new motion wins its interval. Existing expressions
 * are trimmed or split around it so the user gets a sequence, never a stack.
 */
export function resolveExclusiveMotionOverlaps({
  motions,
  editedMotionId,
  presetMap,
  clipDuration,
  createId,
}: {
  motions: AppliedMotion[];
  editedMotionId: string;
  presetMap: Map<string, MotionPreset>;
  clipDuration: number;
  createId: () => string;
}): AppliedMotion[] {
  const edited = motions.find((motion) => motion.id === editedMotionId);
  if (!edited) return motions;

  const category = categoryForMotion(edited, presetMap);
  if (!category || !EXCLUSIVE_MOTION_CATEGORIES.has(category)) return motions;

  const editedPreset = presetMap.get(edited.presetId);
  const editedInterval = singleInterval(edited, editedPreset, clipDuration);
  const normalizedEdited = nonRepeating({ ...edited, offset: editedInterval.start });
  const out: AppliedMotion[] = [];

  for (const motion of motions) {
    if (motion.id === editedMotionId) {
      out.push(normalizedEdited);
      continue;
    }

    if (categoryForMotion(motion, presetMap) !== category) {
      out.push(motion);
      continue;
    }

    const preset = presetMap.get(motion.presetId);
    const interval = singleInterval(motion, preset, clipDuration);
    if (!overlaps(interval, editedInterval)) {
      out.push(nonRepeating({ ...motion, offset: interval.start }));
      continue;
    }

    const leftDuration = editedInterval.start - interval.start;
    const rightDuration = interval.end - editedInterval.end;

    if (leftDuration >= MIN_DURATION) {
      out.push(
        nonRepeating({
          ...motion,
          offset: interval.start,
          duration: round(leftDuration, 2),
        }),
      );
    }

    if (rightDuration >= MIN_DURATION) {
      out.push(
        nonRepeating({
          ...motion,
          id: leftDuration >= MIN_DURATION ? createId() : motion.id,
          offset: round(editedInterval.end, 2),
          duration: round(rightDuration, 2),
        }),
      );
    }
  }

  return out;
}

function round(value: number, digits: number) {
  const k = Math.pow(10, digits);
  return Math.round(value * k) / k;
}
