import type { CharacterPart, CharacterPreset } from "../types";

export interface CharacterThumbnailBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function thumbnailBoundsForParts(
  parts: CharacterPart[],
  character: CharacterPreset,
): CharacterThumbnailBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const part of parts) {
    if (part.visible === false || part.width <= 0 || part.height <= 0) continue;
    const bounds = rotatedBoundsForPart(part);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || maxX <= minX || maxY <= minY) {
    return {
      x: 0,
      y: 0,
      width: Math.max(1, character.canvasWidth),
      height: Math.max(1, character.canvasHeight),
    };
  }

  const width = maxX - minX;
  const height = maxY - minY;
  const padX = Math.max(width * 0.14, character.canvasWidth * 0.018);
  const padY = Math.max(height * 0.14, character.canvasHeight * 0.018);

  return {
    x: minX - padX,
    y: minY - padY,
    width: Math.max(1, width + padX * 2),
    height: Math.max(1, height + padY * 2),
  };
}

function rotatedBoundsForPart(part: CharacterPart): CharacterThumbnailBounds {
  const rect = visibleRectForPart(part);
  const rotation = Number.isFinite(part.rotation) ? part.rotation : 0;
  if (Math.abs(rotation % 360) < 0.001) return rect;

  const originX = part.x + part.anchorX * part.width;
  const originY = part.y + part.anchorY * part.height;
  const radians = (rotation * Math.PI) / 180;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  const corners = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x + rect.width, rect.y + rect.height],
    [rect.x, rect.y + rect.height],
  ].map(([x, y]) => {
    const dx = x - originX;
    const dy = y - originY;
    return {
      x: originX + dx * cos - dy * sin,
      y: originY + dx * sin + dy * cos,
    };
  });

  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function visibleRectForPart(part: CharacterPart): CharacterThumbnailBounds {
  const alpha = part.alphaBounds;
  if (
    !alpha ||
    alpha.sourceWidth <= 0 ||
    alpha.sourceHeight <= 0 ||
    alpha.width <= 0 ||
    alpha.height <= 0
  ) {
    return { x: part.x, y: part.y, width: part.width, height: part.height };
  }

  const containScale = Math.min(part.width / alpha.sourceWidth, part.height / alpha.sourceHeight);
  const renderedWidth = alpha.sourceWidth * containScale;
  const renderedHeight = alpha.sourceHeight * containScale;
  return {
    x: part.x + (part.width - renderedWidth) / 2 + alpha.x * containScale,
    y: part.y + (part.height - renderedHeight) / 2 + alpha.y * containScale,
    width: alpha.width * containScale,
    height: alpha.height * containScale,
  };
}
