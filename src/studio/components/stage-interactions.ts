// Pure Stage selection, snapping, transform-preview, and keyboard interaction helpers.

import type { CSSProperties } from "react";
import type { PickedElement } from "@hyperframes/studio";
import type { ClipKeyframeProperty, ClipKeyframeSelection, EditorClip } from "../types";
import { sampleClipKeyframedState } from "../hyperframes/keyframes";
import { resolvePickedClipId } from "./stage-helpers";
import {
  compositionDomRectToCss,
  pointerAngleDegrees,
  resizeCompositionRect,
  rotationDeltaDegrees,
  scaleCompositionRectFromHandleRect,
  snapCompositionRect,
  snapRotationDegrees,
  type CompositionRect,
  type ResizeHandle,
  type StageGeometry,
  type StageSnapGuide,
  type StageSnapTarget,
} from "./stage-helpers";

export const MIN_STAGE_RESIZE_SIZE = 16;
export const STAGE_ROTATION_SNAP_DEGREES = 15;
export const STAGE_SNAP_THRESHOLD_PX = 8;

export type StageDrag =
  | null
  | {
      type: "move";
      clipId: string;
      /** Keyframe being moved (when a dot drag starts), so commitDrag can route
       *  to updateClipKeyframe without depending on React state having flushed
       *  the corresponding selectKeyframe call yet. */
      keyframeId?: string;
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startX: number;
      startY: number;
      width: number;
      height: number;
      previewX: number;
      previewY: number;
      snapTargets: StageSnapTarget[];
      snapGuides: StageSnapGuide[];
      geometry: StageGeometry;
    }
  | {
      type: "resize";
      clipId: string;
      handle: ResizeHandle;
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startClip: CompositionRect;
      startHandleRect: CompositionRect;
      previewClip: CompositionRect;
      previewHandleRect: CompositionRect;
      rotation: number;
      geometry: StageGeometry;
    }
  | {
      type: "rotate";
      clipId: string;
      pointerId: number;
      centerClientX: number;
      centerClientY: number;
      lastPointerAngle: number;
      startRotation: number;
      rawRotation: number;
      previewRotation: number;
    };

export interface StageClickTarget {
  id: string;
  name: string;
  kind: EditorClip["kind"];
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
}

export function getStageEditableClip(selectedClip: EditorClip | null) {
  if (!selectedClip) return null;
  if (selectedClip.kind === "audio") return null;
  return selectedClip;
}

export function getStageClickTargets(
  clips: EditorClip[],
  currentTime: number,
  renderedRects: Map<string, DOMRect>,
): StageClickTarget[] {
  return clips
    .filter((clip) => clip.kind !== "audio")
    .map((clip) => {
      const localTime = currentTime - clip.start;
      if (localTime < 0 || localTime > clip.duration) return null;
      const renderedRect = renderedRects.get(clip.id);
      if (renderedRect) {
        return {
          id: clip.id,
          name: clip.name,
          kind: clip.kind,
          x: renderedRect.left,
          y: renderedRect.top,
          width: renderedRect.width,
          height: renderedRect.height,
          rotation: 0,
          zIndex: clip.zIndex,
        };
      }
      const state = sampleClipKeyframedState(clip, Math.max(0, Math.min(clip.duration, localTime)));
      const scale = Math.max(0.01, state.scale);
      return {
        id: clip.id,
        name: clip.name,
        kind: clip.kind,
        x: state.x,
        y: state.y,
        width: clip.width * scale,
        height: clip.height * scale,
        rotation: state.rotation,
        zIndex: clip.zIndex,
      };
    })
    .filter((clip): clip is StageClickTarget => Boolean(clip));
}

export function getStageKeyframeTarget(
  clipId: string,
  property: ClipKeyframeProperty,
  selectedKeyframe: ClipKeyframeSelection | null,
  clips: EditorClip[],
) {
  if (!selectedKeyframe || selectedKeyframe.clipId !== clipId) return null;
  return findKeyframeTargetById(clipId, selectedKeyframe.keyframeId, property, clips);
}

export function findKeyframeTargetById(
  clipId: string,
  keyframeId: string,
  property: ClipKeyframeProperty,
  clips: EditorClip[],
) {
  const clip = clips.find((candidate) => candidate.id === clipId);
  if (!clip || clip.kind === "audio") return null;
  const keyframe = clip.keyframes.find((candidate) => candidate.id === keyframeId);
  if (!keyframe) return null;
  return {
    clip,
    time: keyframe.time,
    property,
    selection: {
      clipId,
      keyframeId: keyframe.id,
      property,
    },
  };
}

export function getSelectedMotionEndpoint(
  clip: EditorClip | null,
  selectedKeyframe: ClipKeyframeSelection | null,
) {
  if (!clip || !selectedKeyframe || selectedKeyframe.clipId !== clip.id) return null;
  const motion = clip.motionSteps.find((candidate) =>
    candidate.checkpointIds.includes(selectedKeyframe.keyframeId),
  );
  if (!motion) return null;
  const checkpoint = motion.checkpoints.find(
    (candidate) => candidate.id === selectedKeyframe.keyframeId,
  );
  return {
    motion,
    endpointLabel: checkpoint?.label ?? "Point",
  };
}

export function getSelectedKeyframedClip(
  clip: EditorClip | null,
  selectedKeyframe: ClipKeyframeSelection | null,
): EditorClip | null {
  if (!clip || !selectedKeyframe || selectedKeyframe.clipId !== clip.id) return null;
  const keyframe = clip.keyframes.find((candidate) => candidate.id === selectedKeyframe.keyframeId);
  if (!keyframe) return null;
  const state = sampleClipKeyframedState(clip, keyframe.time);
  const scale = Math.max(0.01, state.scale);
  return {
    ...clip,
    x: state.x,
    y: state.y,
    width: clip.width * scale,
    height: clip.height * scale,
    rotation: state.rotation,
    opacity: state.opacity,
  };
}

export function scaleForKeyframedResize(
  clip: Pick<EditorClip, "width" | "height">,
  rect: CompositionRect,
): number {
  const scaleX = rect.width / Math.max(1, clip.width);
  const scaleY = rect.height / Math.max(1, clip.height);
  return Math.max(0.01, Math.round(((scaleX + scaleY) / 2) * 1000) / 1000);
}

export function getPickedClipId(
  iframe: HTMLIFrameElement | null,
  pickedElement: PickedElement | null,
  clipIds: Set<string>,
) {
  return resolvePickedClipId(iframe, pickedElement, clipIds);
}

export function buildMoveSnapTargets(
  clips: EditorClip[],
  projectWidth: number,
  projectHeight: number,
  movingClipId: string,
): StageSnapTarget[] {
  return [
    {
      id: "stage-canvas",
      kind: "canvas",
      rect: { x: 0, y: 0, width: projectWidth, height: projectHeight },
    },
    ...clips
      .filter((clip) => clip.id !== movingClipId && clip.kind !== "audio")
      .map((clip) => ({
        id: clip.id,
        kind: "clip" as const,
        rect: toCompositionRect(clip),
      })),
  ];
}

export function getMovePreview(
  drag: Extract<StageDrag, { type: "move" }>,
  delta: { x: number; y: number },
  snap: boolean,
) {
  const rect = {
    x: drag.startX + delta.x,
    y: drag.startY + delta.y,
    width: drag.width,
    height: drag.height,
  };
  if (!snap) {
    return {
      previewX: rect.x,
      previewY: rect.y,
      snapGuides: [],
    };
  }

  const result = snapCompositionRect(
    rect,
    drag.snapTargets,
    STAGE_SNAP_THRESHOLD_PX * Math.max(drag.geometry.scaleX, drag.geometry.scaleY),
  );
  return {
    previewX: result.rect.x,
    previewY: result.rect.y,
    snapGuides: result.guides,
  };
}

export function getResizePreview(
  drag: Extract<StageDrag, { type: "resize" }>,
  deltaX: number,
  deltaY: number,
  preserveAspect: boolean,
) {
  const previewHandleRect = resizeCompositionRect({
    handle: drag.handle,
    startX: drag.startHandleRect.x,
    startY: drag.startHandleRect.y,
    startWidth: drag.startHandleRect.width,
    startHeight: drag.startHandleRect.height,
    deltaX,
    deltaY,
    preserveAspect,
    minSize: MIN_STAGE_RESIZE_SIZE,
  });
  return {
    previewHandleRect,
    previewClip: scaleCompositionRectFromHandleRect(
      drag.startClip,
      drag.startHandleRect,
      previewHandleRect,
      MIN_STAGE_RESIZE_SIZE,
    ),
  };
}

export function getRotationPreview(
  drag: Extract<StageDrag, { type: "rotate" }>,
  clientX: number,
  clientY: number,
  snap: boolean,
) {
  const pointerAngle = pointerAngleDegrees(
    drag.centerClientX,
    drag.centerClientY,
    clientX,
    clientY,
  );
  const rawRotation = drag.rawRotation + rotationDeltaDegrees(drag.lastPointerAngle, pointerAngle);
  return {
    lastPointerAngle: pointerAngle,
    rawRotation,
    previewRotation: snap
      ? snapRotationDegrees(rawRotation, STAGE_ROTATION_SNAP_DEGREES)
      : rawRotation,
  };
}

export function toCompositionRect(clip: Pick<EditorClip, "x" | "y" | "width" | "height">) {
  return {
    x: clip.x,
    y: clip.y,
    width: Math.max(MIN_STAGE_RESIZE_SIZE, clip.width),
    height: Math.max(MIN_STAGE_RESIZE_SIZE, clip.height),
  };
}

export function domRectToCompositionRect(rect: DOMRect): CompositionRect {
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

export function sameRect(a: DOMRect | null, b: DOMRect | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

export function sameRectMap(a: Map<string, DOMRect>, b: Map<string, DOMRect>) {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [id, rect] of a) {
    if (!sameRect(rect, b.get(id) ?? null)) return false;
  }
  return true;
}

export function shiftRectForDrag(
  rect: ReturnType<typeof compositionDomRectToCss>,
  drag: StageDrag,
  geometry: StageGeometry,
  clipId: string,
) {
  if (!drag || drag.type !== "move" || drag.clipId !== clipId) return rect;
  return {
    ...rect,
    left: rect.left + (drag.previewX - drag.startX) / geometry.scaleX,
    top: rect.top + (drag.previewY - drag.startY) / geometry.scaleY,
  };
}

export function compositionDeltaToLocal(deltaX: number, deltaY: number, rotation: number) {
  if (rotation === 0) return { x: deltaX, y: deltaY };
  const radians = (-rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: deltaX * cos - deltaY * sin,
    y: deltaX * sin + deltaY * cos,
  };
}

export function getMoveHandleStyle(
  rect: ReturnType<typeof compositionDomRectToCss>,
  container: HTMLElement | null,
): CSSProperties {
  const handleSize = 28;
  const gap = 8;
  const padding = 4;
  const stageWidth = container?.clientWidth ?? rect.left + rect.width + handleSize + gap + padding;
  const stageHeight =
    container?.clientHeight ?? rect.top + rect.height + handleSize + gap + padding;
  const maxLeft = Math.max(padding, stageWidth - handleSize - padding);
  const maxTop = Math.max(padding, stageHeight - handleSize - padding);

  const rightOutside = rect.left + rect.width + gap;
  const leftOutside = rect.left - handleSize - gap;
  const aboveOutside = rect.top - handleSize - gap;
  const belowOutside = rect.top + rect.height + gap;

  const left =
    rightOutside + handleSize <= stageWidth - padding
      ? rightOutside
      : leftOutside >= padding
        ? leftOutside
        : clamp(rect.left + rect.width - handleSize, padding, maxLeft);
  const top =
    aboveOutside >= padding
      ? aboveOutside
      : belowOutside + handleSize <= stageHeight - padding
        ? belowOutside
        : clamp(rect.top, padding, maxTop);

  return {
    left,
    top,
  };
}

export function getRotateHandleStyle(
  rect: ReturnType<typeof compositionDomRectToCss>,
  rotation: number,
  container: HTMLElement | null,
): CSSProperties {
  const handleSize = 28;
  const gap = 14;
  const padding = 4;
  const stageWidth = container?.clientWidth ?? rect.left + rect.width;
  const stageHeight = container?.clientHeight ?? rect.top + rect.height;
  const maxLeft = Math.max(padding, stageWidth - handleSize - padding);
  const maxTop = Math.max(padding, stageHeight - handleSize - padding);
  const topCenter = rotatedRectPoint(rect, 0.5, 0, rotation);
  const outward = rotateUnitVector(0, -1, rotation);
  const left = clamp(
    topCenter.x + outward.x * (handleSize / 2 + gap) - handleSize / 2,
    padding,
    maxLeft,
  );
  const top = clamp(
    topCenter.y + outward.y * (handleSize / 2 + gap) - handleSize / 2,
    padding,
    maxTop,
  );

  return { left, top };
}

export function getRotationPillStyle(
  rect: ReturnType<typeof compositionDomRectToCss>,
  rotation: number,
  container: HTMLElement | null,
): CSSProperties {
  const pillWidth = 48;
  const padding = 4;
  const stageWidth = container?.clientWidth ?? rect.left + rect.width;
  const stageHeight = container?.clientHeight ?? rect.top + rect.height;
  const maxLeft = Math.max(padding, stageWidth - pillWidth - padding);
  const maxTop = Math.max(padding, stageHeight - 22 - padding);
  const bottomCenter = rotatedRectPoint(rect, 0.5, 1, rotation);
  const outward = rotateUnitVector(0, 1, rotation);
  const left = clamp(bottomCenter.x + outward.x * 18 - pillWidth / 2, padding, maxLeft);
  const top = clamp(bottomCenter.y + outward.y * 18, padding, maxTop);

  return { left, top, minWidth: pillWidth, textAlign: "center" };
}

function rotatedRectPoint(
  rect: ReturnType<typeof compositionDomRectToCss>,
  xRatio: number,
  yRatio: number,
  rotation: number,
) {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const x = rect.left + rect.width * xRatio;
  const y = rect.top + rect.height * yRatio;
  const rotated = rotateUnitVector(x - centerX, y - centerY, rotation);
  return {
    x: centerX + rotated.x,
    y: centerY + rotated.y,
  };
}

function rotateUnitVector(x: number, y: number, rotation: number) {
  if (rotation === 0) return { x, y };
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export type LayerShortcut = "forward" | "backward" | "front" | "back";

export function getLayerShortcut(event: KeyboardEvent): LayerShortcut | null {
  if ((!event.metaKey && !event.ctrlKey) || event.altKey) return null;
  if (event.key === "ArrowUp") return event.shiftKey ? "front" : "forward";
  if (event.key === "ArrowDown") return event.shiftKey ? "back" : "backward";
  return null;
}

function isTextEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function isStageNudgeEventTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return true;
  if (isTextEditingTarget(target)) return false;
  if (target.closest("[data-stage-keyboard-nudge], [data-timeline-clip-id]")) return true;
  return !target.closest(
    "button, a[href], [role='button'], [role='slider'], [role='spinbutton'], [role='textbox']",
  );
}

export function shouldPreserveKeyboardFocus(activeElement: Element | null) {
  if (!(activeElement instanceof HTMLElement)) return false;
  if (activeElement.closest("[data-stage-keyboard-nudge]")) return false;
  if (activeElement.closest("[data-timeline-clip-id]")) return true;
  return Boolean(
    isTextEditingTarget(activeElement) ||
    activeElement.closest(
      "button, a[href], [role='button'], [role='slider'], [role='spinbutton'], [role='textbox']",
    ),
  );
}
