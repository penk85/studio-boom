import type { CharacterPart, CharacterPartAlphaBounds } from "../types";

export interface LocalAlphaRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AlphaHitMask {
  data: Uint8ClampedArray;
  sampleWidth: number;
  sampleHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  threshold: number;
}

const DEFAULT_ALPHA_THRESHOLD = 8;
const MAX_SAMPLE_SIZE = 1024;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function fullAlphaBounds(
  sourceWidth: number,
  sourceHeight: number,
): CharacterPartAlphaBounds {
  const width = Math.max(1, Math.round(sourceWidth || 1));
  const height = Math.max(1, Math.round(sourceHeight || 1));
  return {
    x: 0,
    y: 0,
    width,
    height,
    sourceWidth: width,
    sourceHeight: height,
    threshold: DEFAULT_ALPHA_THRESHOLD,
  };
}

export function localAlphaBounds(part: CharacterPart): LocalAlphaRect {
  const bounds = part.alphaBounds;
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return { x: 0, y: 0, width: part.width, height: part.height };
  }
  const sourceWidth = Math.max(1, bounds.sourceWidth || part.width);
  const sourceHeight = Math.max(1, bounds.sourceHeight || part.height);
  const x = (bounds.x / sourceWidth) * part.width;
  const y = (bounds.y / sourceHeight) * part.height;
  const width = (bounds.width / sourceWidth) * part.width;
  const height = (bounds.height / sourceHeight) * part.height;
  return {
    x: clamp(x, 0, part.width),
    y: clamp(y, 0, part.height),
    width: clamp(width, 1, part.width),
    height: clamp(height, 1, part.height),
  };
}

export function localAuthoredBounds(part: CharacterPart): LocalAlphaRect | undefined {
  const bounds = part.bounds;
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return undefined;
  return {
    x: bounds.x - part.x,
    y: bounds.y - part.y,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
  };
}

export function localEditorArtBounds(part: CharacterPart): LocalAlphaRect {
  return localAuthoredBounds(part) ?? localAlphaBounds(part);
}

export function localRegistrationBounds(part: CharacterPart): LocalAlphaRect {
  return { x: 0, y: 0, width: part.width, height: part.height };
}

export function localRectCanvasBounds(part: CharacterPart, bounds: LocalAlphaRect): LocalAlphaRect {
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x, y: bounds.y + bounds.height },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
  ].map((point) => partLocalPointToCanvas(part, point));
  const minX = Math.min(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  const maxX = Math.max(...corners.map((point) => point.x));
  const maxY = Math.max(...corners.map((point) => point.y));
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

export function partLocalPointToCanvas(
  part: CharacterPart,
  point: { x: number; y: number },
): { x: number; y: number } {
  const pivot = pivotForPart(part);
  const pivotLocal = { x: pivot.x - part.x, y: pivot.y - part.y };
  const radians = (part.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const relX = point.x - pivotLocal.x;
  const relY = point.y - pivotLocal.y;
  return {
    x: pivot.x + relX * cos - relY * sin,
    y: pivot.y + relX * sin + relY * cos,
  };
}

export function editorHitBounds(
  part: CharacterPart,
  viewportScale: number,
  boundsMode: "art" | "frame" = "art",
): LocalAlphaRect {
  if (boundsMode === "frame") return localRegistrationBounds(part);
  return paddedBounds(localEditorArtBounds(part), viewportScale, { paddingPx: 8, minSizePx: 28 });
}

export function editorSelectionBounds(
  part: CharacterPart,
  boundsMode: "art" | "frame" = "art",
): LocalAlphaRect {
  return boundsMode === "frame" ? localRegistrationBounds(part) : localEditorArtBounds(part);
}

export function editorControlBounds(
  part: CharacterPart,
  viewportScale: number,
  boundsMode: "art" | "frame" = "art",
): LocalAlphaRect {
  if (boundsMode === "frame") return localRegistrationBounds(part);
  return paddedBounds(localEditorArtBounds(part), viewportScale, { paddingPx: 12, minSizePx: 44 });
}

function paddedBounds(
  bounds: LocalAlphaRect,
  viewportScale: number,
  options: { paddingPx: number; minSizePx: number },
): LocalAlphaRect {
  const px = 1 / Math.max(0.0001, viewportScale);
  const padding = options.paddingPx * px;
  const minSize = options.minSizePx * px;
  const width = Math.max(bounds.width + padding * 2, minSize);
  const height = Math.max(bounds.height + padding * 2, minSize);
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  };
}

export function alphaCenterForPart(part: CharacterPart): { x: number; y: number } {
  const bounds = localAlphaBounds(part);
  return {
    x: part.x + bounds.x + bounds.width / 2,
    y: part.y + bounds.y + bounds.height / 2,
  };
}

export function pivotForPart(part: CharacterPart): { x: number; y: number } {
  return part.pivot ?? alphaCenterForPart(part);
}

export function pointInPartAlphaBounds(
  part: CharacterPart,
  point: { x: number; y: number },
  padding = 0,
) {
  const bounds = localAlphaBounds(part);
  return (
    point.x >= bounds.x - padding &&
    point.x <= bounds.x + bounds.width + padding &&
    point.y >= bounds.y - padding &&
    point.y <= bounds.y + bounds.height + padding
  );
}

export function pointInEditorHitBounds(
  part: CharacterPart,
  point: { x: number; y: number },
  viewportScale: number,
  boundsMode: "art" | "frame" = "art",
) {
  const bounds = editorHitBounds(part, viewportScale, boundsMode);
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

export function alphaMaskContains(
  mask: AlphaHitMask | undefined,
  part: CharacterPart,
  point: { x: number; y: number },
): boolean {
  if (!mask) return pointInPartAlphaBounds(part, point);
  if (point.x < 0 || point.y < 0 || point.x > part.width || point.y > part.height) return false;
  const sourceX = (point.x / Math.max(1, part.width)) * mask.sourceWidth;
  const sourceY = (point.y / Math.max(1, part.height)) * mask.sourceHeight;
  const sampleX = Math.floor((sourceX / Math.max(1, mask.sourceWidth)) * mask.sampleWidth);
  const sampleY = Math.floor((sourceY / Math.max(1, mask.sourceHeight)) * mask.sampleHeight);
  if (sampleX < 0 || sampleY < 0 || sampleX >= mask.sampleWidth || sampleY >= mask.sampleHeight) {
    return false;
  }
  return mask.data[(sampleY * mask.sampleWidth + sampleX) * 4 + 3] > mask.threshold;
}

export async function measureAlphaBoundsFromBlob(
  blob: Blob,
  fallbackWidth = 1,
  fallbackHeight = 1,
): Promise<CharacterPartAlphaBounds> {
  if (typeof document === "undefined") {
    return fullAlphaBounds(fallbackWidth, fallbackHeight);
  }

  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    const sourceWidth = Math.max(1, image.naturalWidth || fallbackWidth || 1);
    const sourceHeight = Math.max(1, image.naturalHeight || fallbackHeight || 1);
    const sampleScale = Math.min(1, MAX_SAMPLE_SIZE / Math.max(sourceWidth, sourceHeight));
    const sampleWidth = Math.max(1, Math.round(sourceWidth * sampleScale));
    const sampleHeight = Math.max(1, Math.round(sourceHeight * sampleScale));
    const canvas = document.createElement("canvas");
    canvas.width = sampleWidth;
    canvas.height = sampleHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return fullAlphaBounds(sourceWidth, sourceHeight);

    ctx.clearRect(0, 0, sampleWidth, sampleHeight);
    ctx.drawImage(image, 0, 0, sampleWidth, sampleHeight);

    const pixels = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data;
    let minX = sampleWidth;
    let minY = sampleHeight;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < sampleHeight; y++) {
      for (let x = 0; x < sampleWidth; x++) {
        const alpha = pixels[(y * sampleWidth + x) * 4 + 3];
        if (alpha <= DEFAULT_ALPHA_THRESHOLD) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    if (maxX < minX || maxY < minY) return fullAlphaBounds(sourceWidth, sourceHeight);

    const x = clamp(Math.floor(minX / sampleScale), 0, sourceWidth - 1);
    const y = clamp(Math.floor(minY / sampleScale), 0, sourceHeight - 1);
    const right = clamp(Math.ceil((maxX + 1) / sampleScale), x + 1, sourceWidth);
    const bottom = clamp(Math.ceil((maxY + 1) / sampleScale), y + 1, sourceHeight);
    return {
      x,
      y,
      width: right - x,
      height: bottom - y,
      sourceWidth,
      sourceHeight,
      threshold: DEFAULT_ALPHA_THRESHOLD,
    };
  } catch {
    return fullAlphaBounds(fallbackWidth, fallbackHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function createAlphaHitMaskFromBlob(
  blob: Blob,
  fallbackWidth = 1,
  fallbackHeight = 1,
): Promise<AlphaHitMask | null> {
  if (typeof document === "undefined") return null;

  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    const sourceWidth = Math.max(1, image.naturalWidth || fallbackWidth || 1);
    const sourceHeight = Math.max(1, image.naturalHeight || fallbackHeight || 1);
    const sampleScale = Math.min(1, MAX_SAMPLE_SIZE / Math.max(sourceWidth, sourceHeight));
    const sampleWidth = Math.max(1, Math.round(sourceWidth * sampleScale));
    const sampleHeight = Math.max(1, Math.round(sourceHeight * sampleScale));
    const canvas = document.createElement("canvas");
    canvas.width = sampleWidth;
    canvas.height = sampleHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.clearRect(0, 0, sampleWidth, sampleHeight);
    ctx.drawImage(image, 0, 0, sampleWidth, sampleHeight);
    return {
      data: ctx.getImageData(0, 0, sampleWidth, sampleHeight).data,
      sampleWidth,
      sampleHeight,
      sourceWidth,
      sourceHeight,
      threshold: DEFAULT_ALPHA_THRESHOLD,
    };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode image for alpha bounds"));
    image.src = url;
  });
}
