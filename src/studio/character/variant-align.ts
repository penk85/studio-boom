import type { CharacterPart, ID } from "../types";
import { localAlphaBounds } from "./alpha-bounds";
import {
  defaultVariantForSlotParts,
  partMatchesVariant,
  variantKeyForPart,
} from "./character-utils";

/**
 * A computed snap that puts one variant's artwork visually on top of the slot's
 * default variant. Variant swaps (blinks, visemes, pose changes) render at
 * authored canvas offsets, so art drawn or imported at a different spot shows
 * up offset from the character every time the variant swaps in. Aligning the
 * visible-pixel centers is the authoring-side fix.
 */
export interface VariantAlignPlan {
  /** Every layer of the selected variant; they move together as one group. */
  moveIds: ID[];
  dx: number;
  dy: number;
  referenceKey: string;
  /** A part of the reference variant, for labeling the action in the UI. */
  referencePart: CharacterPart;
  /** True when the visible-pixel centers already coincide (within rounding). */
  aligned: boolean;
}

/** Canvas-space rect of a part's visible pixels (falls back to its frame). */
function canvasAlphaRect(part: CharacterPart): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const local = localAlphaBounds(part);
  return { x: part.x + local.x, y: part.y + local.y, width: local.width, height: local.height };
}

/** Canvas-space union of the parts' visible-pixel rects (falls back to frames). */
export function unionCanvasAlphaRect(parts: CharacterPart[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const part of parts) {
    const rect = canvasAlphaRect(part);
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function unionCenter(parts: CharacterPart[]): { x: number; y: number } {
  const rect = unionCanvasAlphaRect(parts);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Plan snapping the selected part's variant onto the slot's default variant by
 * aligning visible-pixel union centers. Returns null when there is nothing to
 * align against: single-variant slots, the selected part IS the default
 * variant, or either side has no visible parts.
 */
export function planVariantAlign(
  slotParts: CharacterPart[],
  selected: CharacterPart,
): VariantAlignPlan | null {
  const selectedKey = variantKeyForPart(selected);
  const referenceKey = defaultVariantForSlotParts(slotParts, selected.role);
  if (!referenceKey || partMatchesVariant(selected, referenceKey)) return null;

  const targetParts = slotParts.filter(
    (part) => part.visible && partMatchesVariant(part, selectedKey),
  );
  const referenceParts = slotParts.filter(
    (part) => part.visible && partMatchesVariant(part, referenceKey),
  );
  if (targetParts.length === 0 || referenceParts.length === 0) return null;

  const from = unionCenter(targetParts);
  const to = unionCenter(referenceParts);
  const dx = Math.round(to.x - from.x);
  const dy = Math.round(to.y - from.y);
  return {
    moveIds: targetParts.map((part) => part.id),
    dx,
    dy,
    referenceKey,
    referencePart: referenceParts[0],
    aligned: dx === 0 && dy === 0,
  };
}
