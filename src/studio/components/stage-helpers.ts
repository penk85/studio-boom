import type { EditorClip } from "../types";
import type { PickedElement } from "@hyperframes/studio";

export interface StageGeometry {
  rect: DOMRect;
  scaleX: number;
  scaleY: number;
}

export type ResizeHandle = "nw" | "ne" | "sw" | "se";

export interface CompositionRect {
  x: number;
  y: number;
  width: number;
  height: number;
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

export function scaleCompositionRectFromHandleRect(
  startClip: CompositionRect,
  startHandleRect: CompositionRect,
  previewHandleRect: CompositionRect,
  minSize = 16,
): CompositionRect {
  const startClipBounds = rectToBounds(startClip);
  const startHandleBounds = rectToBounds(startHandleRect);
  const previewHandleBounds = rectToBounds(previewHandleRect);
  const scaleX = previewHandleRect.width / Math.max(1, startHandleRect.width);
  const scaleY = previewHandleRect.height / Math.max(1, startHandleRect.height);
  const left = previewHandleBounds.left - (startHandleBounds.left - startClipBounds.left) * scaleX;
  const top = previewHandleBounds.top - (startHandleBounds.top - startClipBounds.top) * scaleY;

  return {
    x: left,
    y: top,
    width: Math.max(minSize, startClip.width * scaleX),
    height: Math.max(minSize, startClip.height * scaleY),
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

export function compositionDomRectToCss(rect: DOMRect, geometry: StageGeometry) {
  return {
    left: rect.left / geometry.scaleX + geometry.rect.left,
    top: rect.top / geometry.scaleY + geometry.rect.top,
    width: rect.width / geometry.scaleX,
    height: rect.height / geometry.scaleY,
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
  const fromTarget = resolveElementClipId(target instanceof Element ? target : null, clipIds);
  if (fromTarget) return fromTarget;
  return resolveElementClipId(fallbackNode, clipIds);
}

function resolveElementClipId(node: Element | null, clipIds: Set<string>): string | null {
  let current: Element | null = node;
  while (current) {
    if (current.id && clipIds.has(current.id)) return current.id;
    current = current.parentElement;
  }
  return null;
}

function rectToBounds(rect: CompositionRect) {
  return {
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
  };
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
