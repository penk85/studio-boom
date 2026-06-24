import type { CharacterPart, CharacterPreset } from "../types";
import {
  boundsForPoints,
  composeMatrices,
  matrixAroundPoint,
  transformRect,
  translationMatrix,
  type AffineMatrix,
} from "../character/geometry";

export interface CharacterThumbnailBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CharacterThumbnailFrame {
  part: CharacterPart;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  drawOrder?: number;
}

export function thumbnailBoundsForParts(
  parts: CharacterPart[],
  character: CharacterPreset,
): CharacterThumbnailBounds {
  return thumbnailBoundsForFrames(
    parts.map((part) => frameForPart(part)),
    character,
  );
}

export function thumbnailBoundsForFrames(
  frames: CharacterThumbnailFrame[],
  character: CharacterPreset,
): CharacterThumbnailBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const frame of frames) {
    const { part } = frame;
    if (part.visible === false || part.width <= 0 || part.height <= 0) continue;
    const bounds = transformedBoundsForFrame(frame);
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

export function frameForPart(part: CharacterPart): CharacterThumbnailFrame {
  return {
    part,
    x: part.x,
    y: part.y,
    rotation: part.rotation,
    scaleX: 1,
    scaleY: 1,
    drawOrder: part.zIndex,
  };
}

function transformedBoundsForFrame(frame: CharacterThumbnailFrame): CharacterThumbnailBounds {
  const bounds = boundsForPoints(
    transformRect(thumbnailFrameMatrix(frame), visibleLocalRectForPart(frame.part)),
  );
  return {
    x: bounds.left,
    y: bounds.top,
    width: bounds.right - bounds.left,
    height: bounds.bottom - bounds.top,
  };
}

export function thumbnailFrameMatrix(frame: CharacterThumbnailFrame): AffineMatrix {
  const { part } = frame;
  const pivotLocal = {
    x: part.anchorX * part.width,
    y: part.anchorY * part.height,
  };
  return composeMatrices(
    translationMatrix(frame.x + pivotLocal.x, frame.y + pivotLocal.y),
    matrixAroundPoint(
      { x: 0, y: 0 },
      {
        rotation: Number.isFinite(frame.rotation) ? frame.rotation : 0,
        scaleX: finiteNonZero(frame.scaleX, 1),
        scaleY: finiteNonZero(frame.scaleY, 1),
      },
    ),
    translationMatrix(-pivotLocal.x, -pivotLocal.y),
  );
}

function visibleLocalRectForPart(part: CharacterPart): CharacterThumbnailBounds {
  const alpha = part.alphaBounds;
  if (
    !alpha ||
    alpha.sourceWidth <= 0 ||
    alpha.sourceHeight <= 0 ||
    alpha.width <= 0 ||
    alpha.height <= 0
  ) {
    return { x: 0, y: 0, width: part.width, height: part.height };
  }

  const containScale = Math.min(part.width / alpha.sourceWidth, part.height / alpha.sourceHeight);
  const renderedWidth = alpha.sourceWidth * containScale;
  const renderedHeight = alpha.sourceHeight * containScale;
  return {
    x: (part.width - renderedWidth) / 2 + alpha.x * containScale,
    y: (part.height - renderedHeight) / 2 + alpha.y * containScale,
    width: alpha.width * containScale,
    height: alpha.height * containScale,
  };
}

function finiteNonZero(value: number, fallback: number) {
  return Number.isFinite(value) && Math.abs(value) > 0.0001 ? value : fallback;
}
