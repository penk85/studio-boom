// Pure, substrate-agnostic helpers for the Figma-style select/drag gesture model.
// No DOM access — these are unit-testable building blocks shared by every canvas
// (Stage, CharacterEditor, MotionPresetRecorder) so all six interaction rules behave
// identically everywhere. The DOM wiring lives in useSelectDrag.ts.

/** A screen point in client coordinates. */
export interface PointerPoint {
  x: number;
  y: number;
}

/** Remembers the last click so a repeat click in the same spot drills the z-stack. */
export interface DrillPick {
  x: number;
  y: number;
  /** The candidate stack at that point, joined — identifies "the same spot/stack". */
  key: string;
  /** Index into the candidate list that was selected. */
  index: number;
}

/** How close two clicks must be to count as "the same spot" for drill-through (px). */
export const DEFAULT_DRILL_RADIUS = 6;

/** How far the pointer must move before a press becomes a drag instead of a click (px). */
export const DEFAULT_DRAG_THRESHOLD = 4;

/**
 * Choose which object a press should drag.
 *
 * Rule 2 (drag the selected element from anywhere, even when overlapped): if the current
 * selection is under the pointer, it wins regardless of stacking. Rule 3 (drag an
 * unselected element in one gesture): otherwise the topmost candidate is the subject.
 *
 * @param candidates Selectable ids under the pointer, ordered top→bottom (locked excluded).
 * @param selectedId The currently selected id, if any.
 */
export function resolveDragSubject(
  candidates: readonly string[],
  selectedId: string | null,
): string | null {
  if (selectedId && candidates.includes(selectedId)) return selectedId;
  return candidates[0] ?? null;
}

/**
 * Resolve a click into a selection, cycling through the z-stack on repeat clicks.
 *
 * Rule 1 (click selects top; click again in the same spot drills to the element
 * underneath, wrapping around). A click at a new spot or on a different stack resets to
 * the topmost candidate.
 *
 * When `allowDrill` is false the repeat-click cycle is suppressed: every click resolves to
 * the topmost candidate. Callers that prefer "plain click never changes which overlapped
 * layer you get, hold a modifier to reach underneath" pass `allowDrill: event.altKey`.
 *
 * @returns the id to select (or null when nothing is under the pointer) plus the
 * `nextPick` the caller should remember for the following click.
 */
export function resolveDrillSelection(
  candidates: readonly string[],
  lastPick: DrillPick | null,
  point: PointerPoint,
  radius: number = DEFAULT_DRILL_RADIUS,
  allowDrill: boolean = true,
): { id: string | null; nextPick: DrillPick | null } {
  if (candidates.length === 0) return { id: null, nextPick: null };

  const key = candidates.join("|");
  const samePoint =
    allowDrill &&
    !!lastPick &&
    lastPick.key === key &&
    Math.hypot(point.x - lastPick.x, point.y - lastPick.y) < radius;
  const index = samePoint ? (lastPick.index + 1) % candidates.length : 0;
  return {
    id: candidates[index],
    nextPick: { x: point.x, y: point.y, key, index },
  };
}

/** True once the pointer has moved far enough from the press origin to count as a drag. */
export function exceedsDragThreshold(
  start: PointerPoint,
  current: PointerPoint,
  threshold: number = DEFAULT_DRAG_THRESHOLD,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}
