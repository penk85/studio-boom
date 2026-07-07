// Pure, coordinate-agnostic geometry for the shared selection/transform box
// (`interaction/TransformMoveable`). No React, no store, no Stage-only types — so every
// editor surface (Stage, character editor, motion recorder) shares ONE resize/rotate math
// instead of three drifting copies. Everything here is scale-invariant: the same helpers
// serve composition px, character-canvas px, and screen px. Callers map results to their model.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A model/composition-space rect. Kept as a named alias so existing call sites read the same. */
export type CompositionRect = Rect;

/** A screen-space rect (CSS px) — how the moveable proxy is positioned/sized. */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function rectToBounds(rect: Rect) {
  return {
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
  };
}

/**
 * Map a resized *content* (visible/alpha) rect back to its *frame* (transform) rect, preserving
 * the frame's offset from the content box. This is what lets the selection box hug the visible art
 * while a resize still scales the whole transparent frame correctly (images with padding, base-
 * scaled clips). Scale-invariant, so it works in composition px, canvas px, or screen px.
 *
 * Historically named `scaleCompositionRectFromHandleRect` (clip = frame, handle = content); the
 * name is preserved so Stage call sites are untouched.
 */
export function scaleCompositionRectFromHandleRect(
  startFrame: Rect,
  startContent: Rect,
  previewContent: Rect,
  minSize = 16,
): Rect {
  const startFrameBounds = rectToBounds(startFrame);
  const startContentBounds = rectToBounds(startContent);
  const previewContentBounds = rectToBounds(previewContent);
  const scaleX = previewContent.width / Math.max(1, startContent.width);
  const scaleY = previewContent.height / Math.max(1, startContent.height);
  const left =
    previewContentBounds.left - (startContentBounds.left - startFrameBounds.left) * scaleX;
  const top = previewContentBounds.top - (startContentBounds.top - startFrameBounds.top) * scaleY;

  return {
    x: left,
    y: top,
    width: Math.max(minSize, startFrame.width * scaleX),
    height: Math.max(minSize, startFrame.height * scaleY),
  };
}

/**
 * The CSS `transform-origin` (px, relative to the CONTENT box's top-left) that makes the box
 * rotate around `pivot` — the frame / rotation center — instead of the content-box center. Since
 * the box hugs the (possibly off-center) content rect but the underlying element rotates around
 * its frame center, using the content center here would drift the box off the element during
 * rotation. `pivot` is in the SAME space as `contentRect` (screen px). Omit it to fall back to the
 * content-box center (equivalent to `transform-origin: center center`).
 */
export function contentOriginPx(
  contentRect: ScreenRect,
  pivot?: { x: number; y: number },
): { x: number; y: number } {
  if (!pivot) {
    return { x: contentRect.width / 2, y: contentRect.height / 2 };
  }
  return { x: pivot.x - contentRect.left, y: pivot.y - contentRect.top };
}

interface Pt {
  x: number;
  y: number;
}

/**
 * Decompose a transformed rectangle quad (corners in draw order: top-left, top-right, bottom-right,
 * bottom-left) into the axis-aligned rect it would occupy with no rotation, plus that rotation in
 * degrees. Used to feed a rotated part frame (e.g. the motion recorder's alpha quad) into the
 * axis-aligned `TransformMoveable`. `pivot` is the point the quad is rotated about (same space as
 * the quad). Skew is not represented — a skewed quad is approximated by its top/left edge lengths.
 */
export function axisAlignedContentFromQuad(
  quad: [Pt, Pt, Pt, Pt],
  pivot: Pt,
): { rect: Rect; rotationDeg: number } {
  const [p0, p1, , p3] = quad;
  const angleRad = Math.atan2(p1.y - p0.y, p1.x - p0.x);
  const width = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const height = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  // Un-rotate the top-left corner about the pivot to recover the axis-aligned origin.
  const cos = Math.cos(-angleRad);
  const sin = Math.sin(-angleRad);
  const rx = p0.x - pivot.x;
  const ry = p0.y - pivot.y;
  return {
    rect: {
      x: pivot.x + rx * cos - ry * sin,
      y: pivot.y + rx * sin + ry * cos,
      width,
      height,
    },
    rotationDeg: (angleRad * 180) / Math.PI,
  };
}
