// Pure hit-testing and transform snapshots for Character Editor pointer gestures.

import type { CharacterPart, ID } from "../types";
import {
  alphaMaskContains,
  pointInEditorHitBounds,
  pivotForPart,
  type AlphaHitMask,
} from "./alpha-bounds";
import type { EditorBoundsMode } from "./character-inspector-options";
import { getPartSlotId, partMatchesVariant } from "./character-utils";
import {
  canvasPointToPartLocal,
  type EditorPartTransform,
  type ResizeCorner,
} from "./character-editor-geometry";
import { rotatePointAroundAnchor } from "./scene-commands";

interface CharacterEditorHitTestOptions {
  parts: CharacterPart[];
  point: { x: number; y: number };
  selectedPartId: ID | null;
  viewportScale: number;
  boundsMode: EditorBoundsMode;
  transformForPart: (part: CharacterPart) => EditorPartTransform;
  drawOrderForPart?: (part: CharacterPart) => number;
  activeVariantForPart?: (part: CharacterPart, slotParts: CharacterPart[]) => string | undefined;
  alphaMaskForPart?: (part: CharacterPart) => AlphaHitMask | undefined;
}

/**
 * Returns selectable artwork under a canvas point, ordered exact-alpha hits first and then
 * padded art-bounds hits. Each tier remains topmost-first.
 */
export function hitTestCharacterEditorParts({
  parts,
  point,
  selectedPartId,
  viewportScale,
  boundsMode,
  transformForPart,
  drawOrderForPart = (part) => part.zIndex,
  activeVariantForPart,
  alphaMaskForPart,
}: CharacterEditorHitTestOptions): CharacterPart[] {
  const exact: CharacterPart[] = [];
  const padded: CharacterPart[] = [];
  const partsBySlot = new Map<ID, CharacterPart[]>();
  for (const part of parts) {
    const slotId = getPartSlotId(part);
    const slotParts = partsBySlot.get(slotId);
    if (slotParts) slotParts.push(part);
    else partsBySlot.set(slotId, [part]);
  }
  const candidates = parts
    .filter((part) => (part.visible || part.id === selectedPartId) && !part.locked)
    .slice()
    .sort((a, b) => drawOrderForPart(b) - drawOrderForPart(a));

  for (const part of candidates) {
    if (part.id !== selectedPartId) {
      const slotParts = partsBySlot.get(getPartSlotId(part)) ?? [part];
      if (slotParts.length > 1) {
        const activeVariant = activeVariantForPart?.(part, slotParts);
        if (activeVariant && !partMatchesVariant(part, activeVariant)) continue;
      }
    }
    const transform = transformForPart(part);
    if (transform.opacity <= 0.05 && part.id !== selectedPartId) continue;
    const local = canvasPointToPartLocal(part, point, transform);
    const inEditorBounds = pointInEditorHitBounds(part, local, viewportScale, boundsMode);
    if (boundsMode === "frame") {
      if (inEditorBounds) exact.push(part);
    } else if (inEditorBounds && alphaMaskContains(alphaMaskForPart?.(part), part, local)) {
      exact.push(part);
    } else if (inEditorBounds) {
      padded.push(part);
    }
  }
  return [...exact, ...padded];
}

export interface CharacterPartTransformSnapshot {
  id: ID;
  x: number;
  y: number;
  width: number;
  height: number;
  pivot: { x: number; y: number };
  rotation: number;
}

export function snapshotCharacterPartTransforms(
  parts: CharacterPart[],
): Map<ID, CharacterPartTransformSnapshot> {
  return new Map(
    parts.map((part) => [
      part.id,
      {
        id: part.id,
        x: part.x,
        y: part.y,
        width: part.width,
        height: part.height,
        pivot: pivotForPart(part),
        rotation: part.rotation,
      },
    ]),
  );
}

export function resizeAnchorForCorner(
  bounds: { x: number; y: number; width: number; height: number },
  corner: ResizeCorner,
) {
  return {
    x: corner.includes("w") ? bounds.x + bounds.width : bounds.x,
    y: corner.includes("n") ? bounds.y + bounds.height : bounds.y,
  };
}

export function resizeScaleForPointerDelta(
  bounds: { x: number; y: number; width: number; height: number },
  corner: ResizeCorner,
  anchor: { x: number; y: number },
  dx: number,
  dy: number,
) {
  const movingX = corner.includes("w") ? bounds.x + dx : bounds.x + bounds.width + dx;
  const movingY = corner.includes("n") ? bounds.y + dy : bounds.y + bounds.height + dy;
  return {
    scaleX: Math.max(8, Math.abs(anchor.x - movingX)) / Math.max(1, bounds.width),
    scaleY: Math.max(8, Math.abs(anchor.y - movingY)) / Math.max(1, bounds.height),
  };
}

export function scaleCharacterPartsFromSnapshot(
  parts: CharacterPart[],
  snapshot: ReadonlyMap<ID, CharacterPartTransformSnapshot>,
  anchor: { x: number; y: number },
  scaleX: number,
  scaleY: number,
): CharacterPart[] {
  return parts.map((part) => {
    const base = snapshot.get(part.id);
    if (!base) return part;
    return {
      ...part,
      x: Math.round(anchor.x + (base.x - anchor.x) * scaleX),
      y: Math.round(anchor.y + (base.y - anchor.y) * scaleY),
      width: Math.max(4, Math.round(base.width * scaleX)),
      height: Math.max(4, Math.round(base.height * scaleY)),
      pivot: {
        x: Math.round(anchor.x + (base.pivot.x - anchor.x) * scaleX),
        y: Math.round(anchor.y + (base.pivot.y - anchor.y) * scaleY),
      },
    };
  });
}

export function rotateCharacterPartsFromSnapshot(
  parts: CharacterPart[],
  snapshot: ReadonlyMap<ID, CharacterPartTransformSnapshot>,
  anchor: { x: number; y: number },
  degrees: number,
): CharacterPart[] {
  return parts.map((part) => {
    const base = snapshot.get(part.id);
    if (!base) return part;
    const rotatedPivot = rotatePointAroundAnchor(base.pivot, anchor, degrees);
    return {
      ...part,
      x: Math.round(base.x + rotatedPivot.x - base.pivot.x),
      y: Math.round(base.y + rotatedPivot.y - base.pivot.y),
      pivot: { x: Math.round(rotatedPivot.x), y: Math.round(rotatedPivot.y) },
      rotation: Math.round(base.rotation + degrees),
    };
  });
}

export function restoreCharacterPartsFromSnapshot(
  parts: CharacterPart[],
  snapshot: ReadonlyMap<ID, CharacterPartTransformSnapshot>,
): CharacterPart[] {
  return parts.map((part) => {
    const base = snapshot.get(part.id);
    return base
      ? {
          ...part,
          x: base.x,
          y: base.y,
          width: base.width,
          height: base.height,
          pivot: base.pivot,
          rotation: base.rotation,
        }
      : part;
  });
}
