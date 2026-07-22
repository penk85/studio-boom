// Pure transform, bounds, fitting, and constraint geometry for character authoring.

import { clamp } from "./mouth-morph";
import type { CharacterAngle, CharacterPart, CharacterPreset, CharacterRig, ID } from "../types";
import {
  alphaCenterForPart,
  editorSelectionBounds,
  localAuthoredBounds,
  localAlphaBounds,
  localRectCanvasBounds,
  pivotForPart,
} from "./alpha-bounds";
import {
  composeMatrices,
  invertMatrix,
  matrixAroundPoint,
  transformPoint,
  translationMatrix,
} from "./geometry";
import type { EditorBoundsMode } from "./character-inspector-options";
import {
  defaultMotionBehaviorForRole,
  getPartSlotId,
  normalizePartVariant,
  partAvailableForAngle,
} from "./character-utils";
import { clampMotionDeltaToReach, resolveSlotBinding, slotIdsForBoneSubtree } from "./rig";
import type { RuntimePartPlacement } from "./runtime";

export interface EditorPartTransform {
  dx: number;
  dy: number;
  rotation: number;
  scale: number;
  scaleY?: number;
  opacity: number;
}

export type ResizeCorner = "nw" | "ne" | "sw" | "se";

export function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const pts = points
    .slice()
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .filter((p, i, arr) => i === 0 || p.x !== arr[i - 1].x || p.y !== arr[i - 1].y);
  if (pts.length <= 2) return pts;
  const cross = (
    o: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: { x: number; y: number }[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export function composeEditorPartTransform(
  part: CharacterPart,
  base: EditorPartTransform,
  shift?: { dx: number; dy: number; rotation?: number },
  placement?: RuntimePartPlacement,
): EditorPartTransform {
  return {
    ...base,
    dx: base.dx + (placement ? placement.x - part.x : 0) + (shift?.dx ?? 0),
    dy: base.dy + (placement ? placement.y - part.y : 0) + (shift?.dy ?? 0),
    rotation:
      base.rotation + (placement ? placement.rotation - part.rotation : 0) + (shift?.rotation ?? 0),
    scale: base.scale * (placement?.scaleX ?? 1),
    scaleY: (base.scaleY ?? base.scale) * (placement?.scaleY ?? 1),
  };
}

export function editorPartMatrix(part: CharacterPart, previewTransform: EditorPartTransform) {
  const pivot = pivotForPart(part);
  const pivotLocal = { x: pivot.x - part.x, y: pivot.y - part.y };
  return composeMatrices(
    translationMatrix(
      part.x + previewTransform.dx + pivotLocal.x,
      part.y + previewTransform.dy + pivotLocal.y,
    ),
    matrixAroundPoint(
      { x: 0, y: 0 },
      {
        rotation: part.rotation + previewTransform.rotation,
        scaleX: previewTransform.scale,
        scaleY: previewTransform.scaleY ?? previewTransform.scale,
      },
    ),
    translationMatrix(-pivotLocal.x, -pivotLocal.y),
  );
}

export function canvasPointToPartLocal(
  part: CharacterPart,
  canvasPoint: { x: number; y: number },
  previewTransform: EditorPartTransform,
) {
  return transformPoint(invertMatrix(editorPartMatrix(part, previewTransform)), canvasPoint);
}

export function partLocalPointToCanvas(
  part: CharacterPart,
  localPoint: { x: number; y: number },
  previewTransform: EditorPartTransform,
) {
  return transformPoint(editorPartMatrix(part, previewTransform), localPoint);
}

export function resizeCursor(corner: ResizeCorner) {
  return corner === "nw" || corner === "se" ? "cursor-nwse-resize" : "cursor-nesw-resize";
}

export function unionFrameBounds(
  parts: CharacterPart[],
  transformForPart?: (part: CharacterPart) => EditorPartTransform,
) {
  const rects = parts.map((p) => {
    const bounds = { x: 0, y: 0, width: p.width, height: p.height };
    const transform = transformForPart?.(p);
    return transform
      ? localRectCanvasBoundsWithTransform(p, bounds, transform)
      : localRectCanvasBounds(p, bounds);
  });
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

// Union of the parts' SELECTION bounds in canvas coords — art/alpha bounds in "art" mode, the full
// registration frame in "frame" mode. This is what the group selection box hugs, so (like the
// single-part box) it tracks the visible art instead of spanning the whole transparent canvas.
export function unionSelectionBounds(
  parts: CharacterPart[],
  boundsMode: EditorBoundsMode,
  transformForPart?: (part: CharacterPart) => EditorPartTransform,
) {
  const rects = parts.map((p) => {
    const local = editorSelectionBounds(p, boundsMode);
    const transform = transformForPart?.(p);
    return transform
      ? localRectCanvasBoundsWithTransform(p, local, transform)
      : localRectCanvasBounds(p, local);
  });
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

export function fitPartsToCanvasFrame(
  parts: CharacterPart[],
  canvasWidth: number,
  canvasHeight: number,
): CharacterPart[] | null {
  const visibleParts = parts.filter((part) => part.visible);
  const scopedParts = visibleParts.length > 0 ? visibleParts : parts;
  if (scopedParts.length === 0) return null;
  const bounds = unionFrameBounds(scopedParts);
  const padding = Math.max(16, Math.min(canvasWidth, canvasHeight) * 0.04);
  const targetWidth = Math.max(1, canvasWidth - padding * 2);
  const targetHeight = Math.max(1, canvasHeight - padding * 2);
  const scale = Math.min(targetWidth / bounds.width, targetHeight / bounds.height);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const left = (canvasWidth - bounds.width * scale) / 2;
  const top = (canvasHeight - bounds.height * scale) / 2;
  const targetIds = new Set(scopedParts.map((part) => part.id));
  return parts.map((part) => {
    if (!targetIds.has(part.id)) return part;
    const pivot = pivotForPart(part);
    const nextX = left + (part.x - bounds.x) * scale;
    const nextY = top + (part.y - bounds.y) * scale;
    const nextPivot = {
      x: left + (pivot.x - bounds.x) * scale,
      y: top + (pivot.y - bounds.y) * scale,
    };
    const pins = part.pins
      ? Object.fromEntries(
          Object.entries(part.pins).map(([name, pin]) => [
            name,
            {
              ...pin,
              x: pin.x * scale,
              y: pin.y * scale,
            },
          ]),
        )
      : part.pins;
    const authoredBounds = part.bounds
      ? {
          ...part.bounds,
          x: left + (part.bounds.x - bounds.x) * scale,
          y: top + (part.bounds.y - bounds.y) * scale,
          width: Math.max(1, part.bounds.width * scale),
          height: Math.max(1, part.bounds.height * scale),
        }
      : part.bounds;
    return normalizePartPatch(
      {
        ...part,
        x: Math.round(nextX),
        y: Math.round(nextY),
        width: Math.max(1, Math.round(part.width * scale)),
        height: Math.max(1, Math.round(part.height * scale)),
        pivot: { x: Math.round(nextPivot.x), y: Math.round(nextPivot.y) },
        pins,
        bounds: authoredBounds,
      },
      {
        x: nextX,
        y: nextY,
        width: part.width * scale,
        height: part.height * scale,
        pivot: nextPivot,
        pins,
        bounds: authoredBounds,
      },
    );
  });
}

export function localRectCanvasBoundsWithTransform(
  part: CharacterPart,
  bounds: { x: number; y: number; width: number; height: number },
  transform: EditorPartTransform,
) {
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x, y: bounds.y + bounds.height },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
  ].map((point) => partLocalPointToCanvas(part, point, transform));
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

// Union of the parts' editor art bounds in canvas coords. Manual authored bounds win over
// measured alpha bounds so drag boundaries match the user's visible orange bounds.
export function unionEditorArtBounds(parts: CharacterPart[]) {
  const rects = parts.map((p) => {
    const a = localAuthoredBounds(p) ?? localAlphaBounds(p);
    return localRectCanvasBounds(p, a);
  });
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

export function unionAlphaBounds(parts: CharacterPart[]) {
  if (parts.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const rects = parts.map((part) => localRectCanvasBounds(part, localAlphaBounds(part)));
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

export function unionHostClampBounds(
  parts: CharacterPart[],
  mode: "insideHostMask" | "insideHostBounds",
) {
  return mode === "insideHostBounds" ? unionFrameBounds(parts) : unionEditorArtBounds(parts);
}

export function clampSlotDragDelta(
  character: CharacterPreset,
  rig: CharacterRig,
  slotId: ID,
  dx: number,
  dy: number,
): { dx: number; dy: number; clamped: boolean } {
  const reach = rig.reaches.find((entry) => entry.slotId === slotId);
  const reachLimited = clampMotionDeltaToReach(reach, dx, dy, 0);
  let nextDx = reachLimited.dx;
  let nextDy = reachLimited.dy;
  let clamped = reachLimited.clamped;

  const constraint = rig.hostConstraints.find((entry) => entry.slotId === slotId);
  if (!constraint || constraint.reachPolicy === "allow" || constraint.mode === "reach") {
    return { dx: nextDx, dy: nextDy, clamped };
  }
  const hostSlotId = constraint.hostSlotId;
  if (!hostSlotId || hostSlotId === slotId) return { dx: nextDx, dy: nextDy, clamped };
  const activeAngle = rig.activeAngle;
  const slotParts = character.parts.filter(
    (part) => getPartSlotId(part) === slotId && partAvailableForAngle(part, activeAngle),
  );
  const hostParts = character.parts.filter(
    (part) => getPartSlotId(part) === hostSlotId && partAvailableForAngle(part, activeAngle),
  );
  if (slotParts.length === 0 || hostParts.length === 0) {
    return { dx: nextDx, dy: nextDy, clamped };
  }

  const subject = unionHostClampBounds(slotParts, constraint.mode);
  const host = unionHostClampBounds(hostParts, constraint.mode);
  const hostLimited = clampRectInsideHost(subject, host, nextDx, nextDy);
  nextDx = hostLimited.dx;
  nextDy = hostLimited.dy;
  clamped = clamped || nextDx !== dx || nextDy !== dy;
  return { dx: nextDx, dy: nextDy, clamped };
}

export function clampRectInsideHost(
  subject: { x: number; y: number; width: number; height: number },
  host: { x: number; y: number; width: number; height: number },
  dx: number,
  dy: number,
): { dx: number; dy: number } {
  let nextDx = dx;
  let nextDy = dy;

  if (subject.width > host.width) {
    const subjectCenter = subject.x + subject.width / 2 + nextDx;
    const hostCenter = host.x + host.width / 2;
    nextDx += hostCenter - subjectCenter;
  } else {
    if (subject.x + nextDx < host.x) nextDx += host.x - (subject.x + nextDx);
    if (subject.x + subject.width + nextDx > host.x + host.width) {
      nextDx -= subject.x + subject.width + nextDx - (host.x + host.width);
    }
  }

  if (subject.height > host.height) {
    const subjectCenter = subject.y + subject.height / 2 + nextDy;
    const hostCenter = host.y + host.height / 2;
    nextDy += hostCenter - subjectCenter;
  } else {
    if (subject.y + nextDy < host.y) nextDy += host.y - (subject.y + nextDy);
    if (subject.y + subject.height + nextDy > host.y + host.height) {
      nextDy -= subject.y + subject.height + nextDy - (host.y + host.height);
    }
  }

  return { dx: Math.round(nextDx), dy: Math.round(nextDy) };
}

export function partIdsForSlotSubtree(
  parts: CharacterPart[],
  rig: CharacterRig,
  slotId: ID,
  angle: CharacterAngle,
  includeRoot = true,
): Set<ID> {
  const binding = resolveSlotBinding(rig, slotId, angle);
  const subtreeSlots = binding
    ? slotIdsForBoneSubtree(rig, binding.effectiveBoneId, angle)
    : new Set<ID>([slotId]);
  if (!includeRoot) subtreeSlots.delete(slotId);
  const scopedParts = parts.filter((part) => partAvailableForAngle(part, angle));
  return new Set(
    scopedParts.filter((part) => subtreeSlots.has(getPartSlotId(part))).map((part) => part.id),
  );
}

export function normalizePartPatch(
  part: CharacterPart,
  patch: Partial<CharacterPart>,
): CharacterPart {
  const pivot =
    patch.x !== undefined ||
    patch.y !== undefined ||
    patch.width !== undefined ||
    patch.height !== undefined ||
    patch.alphaBounds !== undefined
      ? (part.pivot ?? alphaCenterForPart(part))
      : part.pivot;
  const anchorX = pivot ? clamp((pivot.x - part.x) / Math.max(1, part.width), 0, 1) : part.anchorX;
  const anchorY = pivot ? clamp((pivot.y - part.y) / Math.max(1, part.height), 0, 1) : part.anchorY;
  return {
    ...part,
    anchorX,
    anchorY,
    pivot,
    registration: pivot
      ? {
          x: pivot.x - part.x,
          y: pivot.y - part.y,
          rotation: part.rotation,
          space: "part-local-pixels",
        }
      : part.registration,
    variant: normalizePartVariant(part),
    motionBehavior: part.motionBehavior ?? defaultMotionBehaviorForRole(part.role, part.viseme),
  };
}
