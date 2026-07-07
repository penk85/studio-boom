import type { EditorClip } from "../types";
import type { PickedElement } from "@hyperframes/studio";
import { type CompositionRect, type ScreenRect, rectToBounds } from "../interaction/transform-box";

// The transform-box geometry now lives in `interaction/transform-box.ts` so every editor
// surface shares one copy. Re-exported here so existing Stage imports keep working.
export { scaleCompositionRectFromHandleRect } from "../interaction/transform-box";
export type { CompositionRect, ScreenRect } from "../interaction/transform-box";

export interface StageGeometry {
  rect: DOMRect;
  scaleX: number;
  scaleY: number;
}

export type ResizeHandle = "nw" | "ne" | "sw" | "se";

export type StageSnapAxis = "x" | "y";
export type StageSnapAnchor = "start" | "center" | "end";

export interface StageSnapTarget {
  id: string;
  rect: CompositionRect;
  kind?: "canvas" | "clip";
}

export interface StageSnapGuide {
  axis: StageSnapAxis;
  position: number;
  sourceAnchor: StageSnapAnchor;
  targetAnchor: StageSnapAnchor;
  targetId: string;
  targetKind?: "canvas" | "clip";
}

export interface StageSnapResult {
  rect: CompositionRect;
  guides: StageSnapGuide[];
}

interface PixelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  sampleWidth: number;
  sampleHeight: number;
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const MAX_PIXEL_SAMPLE_SIZE = 1024;
const ALPHA_THRESHOLD = 8;
const BACKGROUND_COLOR_THRESHOLD = 32;
const CORNER_COLOR_TOLERANCE = 18;
const CORNER_SAMPLE_SIZE = 5;

export function getStageGeometry(
  container: HTMLElement,
  width: number,
  height: number,
  renderedRect?: DOMRect | null,
): StageGeometry {
  const containerRect = container.getBoundingClientRect();
  const rect =
    renderedRect && renderedRect.width > 0 && renderedRect.height > 0
      ? new DOMRect(
          renderedRect.left - containerRect.left,
          renderedRect.top - containerRect.top,
          renderedRect.width,
          renderedRect.height,
        )
      : getContainedRect(containerRect, width, height);

  return {
    rect,
    scaleX: width / rect.width,
    scaleY: height / rect.height,
  };
}

export function pointerDeltaToComposition(dx: number, dy: number, geometry: StageGeometry) {
  return {
    x: dx * geometry.scaleX,
    y: dy * geometry.scaleY,
  };
}

export function keyboardNudgeDelta(key: string, step: number): { x: number; y: number } | null {
  switch (key) {
    case "ArrowLeft":
      return { x: -step, y: 0 };
    case "ArrowRight":
      return { x: step, y: 0 };
    case "ArrowUp":
      return { x: 0, y: -step };
    case "ArrowDown":
      return { x: 0, y: step };
    default:
      return null;
  }
}

export function pointerAngleDegrees(
  centerClientX: number,
  centerClientY: number,
  clientX: number,
  clientY: number,
): number {
  return (Math.atan2(clientY - centerClientY, clientX - centerClientX) * 180) / Math.PI;
}

export function rotationDeltaDegrees(previousAngle: number, nextAngle: number): number {
  const delta = ((nextAngle - previousAngle + 540) % 360) - 180;
  return Object.is(delta, -0) ? 0 : delta;
}

export function snapRotationDegrees(rotation: number, step = 15): number {
  const snapStep = Math.max(1, step);
  return Math.round(rotation / snapStep) * snapStep;
}

export function roundRotationDegrees(rotation: number): number {
  return Math.round(rotation * 10) / 10;
}

export function resizeCompositionRect({
  handle,
  startX,
  startY,
  startWidth,
  startHeight,
  deltaX,
  deltaY,
  preserveAspect = false,
  minSize = 16,
}: {
  handle: ResizeHandle;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  deltaX: number;
  deltaY: number;
  preserveAspect?: boolean;
  minSize?: number;
}): CompositionRect {
  const left = startX;
  const top = startY;
  const right = startX + startWidth;
  const bottom = startY + startHeight;
  const movesEast = handle.endsWith("e");
  const movesSouth = handle.startsWith("s");
  const anchorX = movesEast ? left : right;
  const anchorY = movesSouth ? top : bottom;
  const movedX = (movesEast ? right : left) + deltaX;
  const movedY = (movesSouth ? bottom : top) + deltaY;
  const min = Math.max(1, minSize);

  let width = Math.max(min, movesEast ? movedX - anchorX : anchorX - movedX);
  let height = Math.max(min, movesSouth ? movedY - anchorY : anchorY - movedY);

  if (preserveAspect && startWidth > 0 && startHeight > 0) {
    const aspectRatio = startWidth / startHeight;
    const widthDelta = Math.abs(width - startWidth);
    const heightDelta = Math.abs(height - startHeight);

    if (widthDelta >= heightDelta) {
      height = width / aspectRatio;
      if (height < min) {
        height = min;
        width = height * aspectRatio;
      }
    } else {
      width = height * aspectRatio;
      if (width < min) {
        width = min;
        height = width / aspectRatio;
      }
    }
  }

  const nextLeft = movesEast ? anchorX : anchorX - width;
  const nextTop = movesSouth ? anchorY : anchorY - height;

  return {
    x: nextLeft,
    y: nextTop,
    width,
    height,
  };
}

export function roundCompositionRect(rect: CompositionRect): CompositionRect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

export function snapCompositionRect(
  rect: CompositionRect,
  targets: StageSnapTarget[],
  threshold: number,
): StageSnapResult {
  const snapThreshold = Math.max(0, threshold);
  if (snapThreshold <= 0 || targets.length === 0) return { rect, guides: [] };

  const xSnap = findAxisSnap("x", rect, targets, snapThreshold);
  const ySnap = findAxisSnap("y", rect, targets, snapThreshold);

  return {
    rect: {
      ...rect,
      x: rect.x + (xSnap?.delta ?? 0),
      y: rect.y + (ySnap?.delta ?? 0),
    },
    guides: [xSnap?.guide, ySnap?.guide].filter((guide): guide is StageSnapGuide => Boolean(guide)),
  };
}

export function compositionRectToCss(
  clip: Pick<EditorClip, "x" | "y" | "width" | "height">,
  geometry: StageGeometry,
) {
  return {
    left: clip.x / geometry.scaleX + geometry.rect.left,
    top: clip.y / geometry.scaleY + geometry.rect.top,
    width: clip.width / geometry.scaleX,
    height: clip.height / geometry.scaleY,
  };
}

export function compositionPointToCss(point: { x: number; y: number }, geometry: StageGeometry) {
  return {
    x: point.x / geometry.scaleX + geometry.rect.left,
    y: point.y / geometry.scaleY + geometry.rect.top,
  };
}

export function compositionDomRectToCss(rect: DOMRect, geometry: StageGeometry) {
  return {
    left: rect.left / geometry.scaleX + geometry.rect.left,
    top: rect.top / geometry.scaleY + geometry.rect.top,
    width: rect.width / geometry.scaleX,
    height: rect.height / geometry.scaleY,
  };
}

/** Axis-aligned overlap test. Touching edges (zero-area overlap) do not count as a hit. */
export function rectsOverlap(a: ScreenRect, b: ScreenRect): boolean {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

/**
 * The ids whose (axis-aligned) rect overlaps the marquee box. Rotated clips are tested against
 * their unrotated composition box — a good-enough first pass that matches how react-selecto treats
 * bounding rects; oriented-box precision can come later if it matters.
 */
export function marqueeHitIds(
  box: ScreenRect,
  targets: { id: string; rect: ScreenRect }[],
): string[] {
  return targets.filter((target) => rectsOverlap(box, target.rect)).map((target) => target.id);
}

/** A stable signature for a guide set, so callers can notify only when the guides actually change. */
export function snapGuideSignature(guides: StageSnapGuide[]): string {
  return guides.map((guide) => `${guide.axis}:${guide.position}:${guide.targetId}`).join("|");
}

/** Bounding box of a set of composition boxes (unrotated), or null when empty. */
export function compositionGroupBounds(
  clips: Pick<CompositionRect, "x" | "y" | "width" | "height">[],
): CompositionRect | null {
  if (clips.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const clip of clips) {
    minX = Math.min(minX, clip.x);
    minY = Math.min(minY, clip.y);
    maxX = Math.max(maxX, clip.x + clip.width);
    maxY = Math.max(maxY, clip.y + clip.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Bounding-box center of a set of composition boxes (unrotated), or null when empty. */
export function compositionGroupCenter(
  clips: Pick<CompositionRect, "x" | "y" | "width" | "height">[],
): { cx: number; cy: number } | null {
  const bounds = compositionGroupBounds(clips);
  if (!bounds) return null;
  return { cx: bounds.x + bounds.width / 2, cy: bounds.y + bounds.height / 2 };
}

export interface GroupFlipClip extends CompositionRect {
  scaleX: number;
  scaleY: number;
}

/**
 * Mirror one clip within a group flip: reflect its position across the group center on the flip
 * axis and toggle that axis's mirror sign; the other axis passes through. Both x and y are always
 * returned because the live-apply position path needs the pair, and both scale axes are returned
 * because a flip commit resets any axis it isn't given. Per-clip rotation is intentionally left
 * untouched — same deferred rotate+mirror stance as the single-clip flip.
 */
export function groupFlipPatch(
  clip: GroupFlipClip,
  axis: "h" | "v",
  center: { cx: number; cy: number },
): { x: number; y: number; scaleX: number; scaleY: number } {
  return axis === "h"
    ? {
        x: 2 * center.cx - clip.x - clip.width,
        y: clip.y,
        scaleX: -clip.scaleX,
        scaleY: clip.scaleY,
      }
    : {
        x: clip.x,
        y: 2 * center.cy - clip.y - clip.height,
        scaleX: clip.scaleX,
        scaleY: -clip.scaleY,
      };
}

export function getRenderedElementRect(
  iframe: HTMLIFrameElement | null,
  elementId: string | null | undefined,
): DOMRect | null {
  if (!iframe || !elementId) return null;
  try {
    const element = iframe.contentDocument?.getElementById(elementId);
    const rect = element?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return rect;
  } catch {
    return null;
  }
}

export async function getRenderedPixelRect(
  iframe: HTMLIFrameElement | null,
  elementId: string | null | undefined,
): Promise<DOMRect | null> {
  if (!iframe || !elementId) return null;

  try {
    const element = iframe.contentDocument?.getElementById(elementId);
    const elementRect = getRenderedElementRect(iframe, elementId);
    if (!element || !elementRect) return null;
    if (element.tagName.toLowerCase() !== "img") return elementRect;

    const image = element as HTMLImageElement;
    if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      return elementRect;
    }

    const pixelBounds = measureImagePixelBounds(image);
    return pixelBounds ? pixelBoundsToRenderedRect(pixelBounds, elementRect) : elementRect;
  } catch {
    return getRenderedElementRect(iframe, elementId);
  }
}

export async function getRenderedPixelCompositionRect(
  iframe: HTMLIFrameElement | null,
  elementId: string | null | undefined,
  elementRect: CompositionRect,
): Promise<DOMRect | null> {
  if (!iframe || !elementId) return null;

  const fallbackRect = new DOMRect(
    elementRect.x,
    elementRect.y,
    elementRect.width,
    elementRect.height,
  );

  try {
    const element = iframe.contentDocument?.getElementById(elementId);
    if (!element) return null;
    if (element.tagName.toLowerCase() !== "img") return fallbackRect;

    const image = element as HTMLImageElement;
    if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      return fallbackRect;
    }

    const pixelBounds = measureImagePixelBounds(image);
    return pixelBounds ? pixelBoundsToRenderedRect(pixelBounds, fallbackRect) : fallbackRect;
  } catch {
    return fallbackRect;
  }
}

export function pixelBoundsToRenderedRect(bounds: PixelBounds, renderedRect: DOMRect): DOMRect {
  const left = renderedRect.left + (bounds.x / bounds.sampleWidth) * renderedRect.width;
  const top = renderedRect.top + (bounds.y / bounds.sampleHeight) * renderedRect.height;
  const width = (bounds.width / bounds.sampleWidth) * renderedRect.width;
  const height = (bounds.height / bounds.sampleHeight) * renderedRect.height;
  return new DOMRect(left, top, width, height);
}

export function resolvePickedClipId(
  iframe: HTMLIFrameElement | null,
  pickedElement: PickedElement | null,
  clipIds: Set<string>,
): string | null {
  if (!pickedElement) return null;
  if (pickedElement.id && clipIds.has(pickedElement.id)) return pickedElement.id;

  const doc = iframe?.contentDocument;
  if (!doc || !pickedElement.selector) return null;

  let node: HTMLElement | null = null;
  try {
    node = doc.querySelector(pickedElement.selector) as HTMLElement | null;
  } catch {
    return null;
  }

  while (node) {
    if (node.id && clipIds.has(node.id)) return node.id;
    node = node.parentElement;
  }

  return null;
}

export function resolveTargetClipId(
  target: EventTarget | null,
  clipIds: Set<string>,
  fallbackNode?: Element | null,
): string | null {
  const fromTarget = resolveElementClipId(asElement(target), clipIds);
  if (fromTarget) return fromTarget;
  return resolveElementClipId(asElement(fallbackNode ?? null), clipIds);
}

function resolveElementClipId(node: Element | null, clipIds: Set<string>): string | null {
  let current: Element | null = node;
  while (current) {
    if (current.id && clipIds.has(current.id)) return current.id;
    current = current.parentElement;
  }
  return null;
}

/**
 * Ordered stack of clip ids under a point, topmost first, with locked clips removed.
 * This is the candidate list the Figma-style select/drag controller drills through.
 *
 * Hit-tests the parent-document `StageClickOverlay` rectangles (one `data-clip-id` rect
 * per visible clip). `elementsFromPoint` returns them already z-ordered top→bottom, so a
 * locked rect on top simply lets the click fall through to the unlocked clip beneath it.
 */
export function hitTestClipIdsAtPoint(
  target: EventTarget | null,
  clientX: number,
  clientY: number,
  clipIds: Set<string>,
  isLocked: (id: string) => boolean,
): string[] {
  const el = asElement(target);
  const doc = el?.ownerDocument ?? (typeof document !== "undefined" ? document : null);
  if (!doc) return [];
  const ids: string[] = [];
  for (const node of doc.elementsFromPoint(clientX, clientY)) {
    const id = resolveClipIdAttr(node, clipIds);
    if (id && !isLocked(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Walk up from a node to the nearest ancestor carrying a known `data-clip-id`. */
function resolveClipIdAttr(node: Element | null, clipIds: Set<string>): string | null {
  let current: Element | null = node;
  while (current) {
    const id = current.getAttribute?.("data-clip-id");
    if (id && clipIds.has(id)) return id;
    current = current.parentElement;
  }
  return null;
}

function asElement(value: unknown): Element | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { nodeType?: number };
  return candidate.nodeType === 1 ? (value as Element) : null;
}

function findAxisSnap(
  axis: StageSnapAxis,
  rect: CompositionRect,
  targets: StageSnapTarget[],
  threshold: number,
): { delta: number; guide: StageSnapGuide } | null {
  const sourcePositions = snapPositionsForRect(axis, rect);
  let best: {
    distance: number;
    delta: number;
    guide: StageSnapGuide;
  } | null = null;

  for (const target of targets) {
    const targetPositions = snapPositionsForRect(axis, target.rect);
    for (const source of sourcePositions) {
      for (const targetPosition of targetPositions) {
        const delta = targetPosition.value - source.value;
        const distance = Math.abs(delta);
        if (distance > threshold) continue;
        if (best && distance >= best.distance) continue;
        best = {
          distance,
          delta,
          guide: {
            axis,
            position: targetPosition.value,
            sourceAnchor: source.anchor,
            targetAnchor: targetPosition.anchor,
            targetId: target.id,
            targetKind: target.kind,
          },
        };
      }
    }
  }

  return best ? { delta: best.delta, guide: best.guide } : null;
}

function snapPositionsForRect(
  axis: StageSnapAxis,
  rect: CompositionRect,
): { anchor: StageSnapAnchor; value: number }[] {
  const bounds = rectToBounds(rect);
  if (axis === "x") {
    return [
      { anchor: "start", value: bounds.left },
      { anchor: "center", value: bounds.left + rect.width / 2 },
      { anchor: "end", value: bounds.right },
    ];
  }
  return [
    { anchor: "start", value: bounds.top },
    { anchor: "center", value: bounds.top + rect.height / 2 },
    { anchor: "end", value: bounds.bottom },
  ];
}

function measureImagePixelBounds(image: HTMLImageElement): PixelBounds | null {
  const sourceWidth = Math.max(1, image.naturalWidth);
  const sourceHeight = Math.max(1, image.naturalHeight);
  const sampleScale = Math.min(1, MAX_PIXEL_SAMPLE_SIZE / Math.max(sourceWidth, sourceHeight));
  const sampleWidth = Math.max(1, Math.round(sourceWidth * sampleScale));
  const sampleHeight = Math.max(1, Math.round(sourceHeight * sampleScale));
  const canvas = image.ownerDocument.createElement("canvas");
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  try {
    ctx.clearRect(0, 0, sampleWidth, sampleHeight);
    ctx.drawImage(image, 0, 0, sampleWidth, sampleHeight);
    const data = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data;
    return (
      alphaPixelBounds(data, sampleWidth, sampleHeight) ??
      backgroundPixelBounds(data, sampleWidth, sampleHeight)
    );
  } catch {
    return null;
  }
}

function alphaPixelBounds(
  data: Uint8ClampedArray,
  sampleWidth: number,
  sampleHeight: number,
): PixelBounds | null {
  let hasTransparentPixel = false;
  let minX = sampleWidth;
  let minY = sampleHeight;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < sampleHeight; y++) {
    for (let x = 0; x < sampleWidth; x++) {
      const alpha = data[(y * sampleWidth + x) * 4 + 3];
      if (alpha <= ALPHA_THRESHOLD) {
        hasTransparentPixel = true;
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (!hasTransparentPixel || maxX < minX || maxY < minY) return null;
  return toPixelBounds(minX, minY, maxX, maxY, sampleWidth, sampleHeight);
}

function backgroundPixelBounds(
  data: Uint8ClampedArray,
  sampleWidth: number,
  sampleHeight: number,
): PixelBounds | null {
  const corners = [
    sampleAverage(data, sampleWidth, sampleHeight, 0, 0),
    sampleAverage(data, sampleWidth, sampleHeight, sampleWidth - CORNER_SAMPLE_SIZE, 0),
    sampleAverage(data, sampleWidth, sampleHeight, 0, sampleHeight - CORNER_SAMPLE_SIZE),
    sampleAverage(
      data,
      sampleWidth,
      sampleHeight,
      sampleWidth - CORNER_SAMPLE_SIZE,
      sampleHeight - CORNER_SAMPLE_SIZE,
    ),
  ];
  const background = averageColor(corners);
  if (corners.some((corner) => colorDistance(corner, background) > CORNER_COLOR_TOLERANCE)) {
    return null;
  }

  let minX = sampleWidth;
  let minY = sampleHeight;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < sampleHeight; y++) {
    for (let x = 0; x < sampleWidth; x++) {
      const color = pixelAt(data, sampleWidth, x, y);
      if (color.a <= ALPHA_THRESHOLD) continue;
      if (colorDistance(color, background) <= BACKGROUND_COLOR_THRESHOLD) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) return null;
  const bounds = toPixelBounds(minX, minY, maxX, maxY, sampleWidth, sampleHeight);
  const coverage = (bounds.width * bounds.height) / (sampleWidth * sampleHeight);
  return coverage < 0.98 ? bounds : null;
}

function toPixelBounds(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  sampleWidth: number,
  sampleHeight: number,
): PixelBounds {
  return {
    x: Math.max(0, minX),
    y: Math.max(0, minY),
    width: Math.max(1, Math.min(sampleWidth, maxX + 1) - Math.max(0, minX)),
    height: Math.max(1, Math.min(sampleHeight, maxY + 1) - Math.max(0, minY)),
    sampleWidth,
    sampleHeight,
  };
}

function sampleAverage(
  data: Uint8ClampedArray,
  sampleWidth: number,
  sampleHeight: number,
  startX: number,
  startY: number,
): Rgba {
  const left = Math.max(0, Math.min(sampleWidth - 1, startX));
  const top = Math.max(0, Math.min(sampleHeight - 1, startY));
  const right = Math.min(sampleWidth, left + CORNER_SAMPLE_SIZE);
  const bottom = Math.min(sampleHeight, top + CORNER_SAMPLE_SIZE);
  const colors: Rgba[] = [];

  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) colors.push(pixelAt(data, sampleWidth, x, y));
  }
  return averageColor(colors);
}

function pixelAt(data: Uint8ClampedArray, sampleWidth: number, x: number, y: number): Rgba {
  const index = (y * sampleWidth + x) * 4;
  return {
    r: data[index],
    g: data[index + 1],
    b: data[index + 2],
    a: data[index + 3],
  };
}

function averageColor(colors: Rgba[]): Rgba {
  const count = Math.max(1, colors.length);
  return {
    r: colors.reduce((sum, color) => sum + color.r, 0) / count,
    g: colors.reduce((sum, color) => sum + color.g, 0) / count,
    b: colors.reduce((sum, color) => sum + color.b, 0) / count,
    a: colors.reduce((sum, color) => sum + color.a, 0) / count,
  };
}

function colorDistance(a: Rgba, b: Rgba) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  const da = (a.a - b.a) * 0.5;
  return Math.sqrt(dr * dr + dg * dg + db * db + da * da);
}

function getContainedRect(containerRect: DOMRect, width: number, height: number): DOMRect {
  const scale = Math.min(containerRect.width / width, containerRect.height / height);
  const renderedWidth = width * scale;
  const renderedHeight = height * scale;
  const left = (containerRect.width - renderedWidth) / 2;
  const top = (containerRect.height - renderedHeight) / 2;
  return new DOMRect(left, top, renderedWidth, renderedHeight);
}

// ─── Motion path polyline projection ─────────────────────────────────────────
// Used by Stage's line-click-to-insert-checkpoint gesture. Kept here (not in
// Stage.tsx) so vitest can import it without pulling in @hyperframes/studio.

export interface PolylinePoint {
  x: number;
  y: number;
  time: number;
}

export interface PolylineProjection {
  segmentIndex: number;
  /** 0..1 along the closest segment. */
  ratio: number;
  x: number;
  y: number;
  time: number;
  distance: number;
}

/**
 * Find where a click lands on a polyline by projecting it onto every segment
 * and keeping the nearest. Time is linearly interpolated between the segment
 * endpoints' times. Returns null only when the polyline has fewer than two
 * points.
 */
export function projectClickOntoPolyline(
  click: { x: number; y: number },
  polyline: PolylinePoint[],
): PolylineProjection | null {
  if (polyline.length < 2) return null;

  let best: PolylineProjection | null = null;
  for (let i = 0; i < polyline.length - 1; i += 1) {
    const a = polyline[i]!;
    const b = polyline[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let ratio = 0;
    if (len2 > 0) {
      ratio = ((click.x - a.x) * dx + (click.y - a.y) * dy) / len2;
      if (ratio < 0) ratio = 0;
      else if (ratio > 1) ratio = 1;
    }
    const px = a.x + dx * ratio;
    const py = a.y + dy * ratio;
    const distance = Math.hypot(click.x - px, click.y - py);
    if (!best || distance < best.distance) {
      best = {
        segmentIndex: i,
        ratio,
        x: px,
        y: py,
        time: a.time + (b.time - a.time) * ratio,
        distance,
      };
    }
  }
  return best;
}
