// Selection frames and transform controls layered over the Character Editor's Pixi canvas.
import { useLayoutEffect, useState } from "react";
import type React from "react";
import { TransformMoveable } from "../interaction/TransformMoveable";
import type { ScreenRect } from "../interaction/transform-box";
import type { CharacterPart, CharacterPartBounds } from "../types";
import { editorSelectionBounds, pivotForPart } from "./alpha-bounds";
import { defaultVariantForSlotParts, getPartSlotId, partMatchesVariant } from "./character-utils";
import { composeEditorPartTransform, type EditorPartTransform } from "./character-editor-geometry";
import {
  activePreviewVariantForPart,
  previewDelta,
  type PreviewState,
} from "./character-editor-preview";
import type { EditorBoundsMode } from "./CharacterInspectorPanels";
import type { CharacterRuntime, RuntimePartPlacement } from "./runtime";

export function PartLayer({
  part,
  selected,
  dimmed = false,
  blurred = false,
  ghosted = false,
  preview,
  previewParentPart,
  allParts,
  runtime,
  previewVariantKey,
  shift,
  placement,
}: {
  part: CharacterPart;
  selected: boolean;
  dimmed?: boolean;
  blurred?: boolean;
  /** A sibling variant is selected, so this frame remains as alignment chrome. */
  ghosted?: boolean;
  preview: PreviewState | null;
  previewParentPart?: CharacterPart;
  allParts: CharacterPart[];
  runtime: CharacterRuntime;
  previewVariantKey?: string;
  shift?: { dx: number; dy: number; rotation?: number };
  placement?: RuntimePartPlacement;
}) {
  const sameSlotParts = allParts.filter(
    (candidate) => getPartSlotId(candidate) === getPartSlotId(part),
  );
  const ghost = ghosted && sameSlotParts.length > 1 && part.visible;
  const activeVariant =
    sameSlotParts.length > 1
      ? (previewVariantKey ??
        activePreviewVariantForPart(part, preview) ??
        defaultVariantForSlotParts(sameSlotParts, part.role))
      : undefined;
  if (sameSlotParts.length > 1 && !selected && !ghost) {
    if (activeVariant && !partMatchesVariant(part, activeVariant)) return null;
  }
  if (!part.visible && !selected && !previewVariantKey) return null;

  const baseTransform = previewDelta(part, preview, previewParentPart, allParts, runtime);
  const previewTransform = composeEditorPartTransform(part, baseTransform, shift, placement);
  const baseOpacity = part.visible ? previewTransform.opacity : 0.28;
  const opacity = ghost
    ? baseOpacity * 0.35
    : dimmed
      ? baseOpacity * 0.12
      : blurred
        ? baseOpacity * 0.7
        : baseOpacity;
  const pivot = pivotForPart(part);

  return (
    <>
      {part.bounds && selected && <BoundsOverlay bounds={part.bounds} zIndex={part.zIndex - 1} />}
      <div
        className="absolute select-none"
        style={{
          left: part.x + previewTransform.dx,
          top: part.y + previewTransform.dy,
          width: part.width,
          height: part.height,
          zIndex: placement?.drawOrder ?? part.zIndex,
          opacity,
          filter: !ghost && blurred && !dimmed ? "blur(2px)" : undefined,
          transition: "filter 120ms ease",
          pointerEvents: "none",
          transform: `rotate(${part.rotation + previewTransform.rotation}deg) scale(${previewTransform.scale}, ${previewTransform.scaleY ?? previewTransform.scale})`,
          transformOrigin: `${((pivot.x - part.x) / part.width) * 100}% ${((pivot.y - part.y) / part.height) * 100}%`,
        }}
        data-character-editor-chrome="part-frame"
        aria-label={selected ? `${part.name} selection frame` : undefined}
      />
    </>
  );
}

/**
 * Selection chrome for one part, adapting canvas-space edits to the shared transform control.
 */
export function CharacterPartMoveable({
  part,
  previewTransform,
  canvasRef,
  wrapRef,
  scale,
  boundsMode,
  onBegin,
  onPatch,
  onEnd,
}: {
  part: CharacterPart;
  previewTransform: EditorPartTransform;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  wrapRef: React.RefObject<HTMLDivElement | null>;
  scale: number;
  boundsMode: EditorBoundsMode;
  onBegin: () => void;
  onPatch: (patch: Partial<CharacterPart>) => void;
  onEnd: () => void;
}) {
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const viewScale = Math.max(0.0001, scale);

  // Surrounding editor chrome can move without changing either ref.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const canvasBox = canvas.getBoundingClientRect();
    const wrapBox = wrap.getBoundingClientRect();
    const x = canvasBox.left - wrapBox.left;
    const y = canvasBox.top - wrapBox.top;
    setOrigin((previous) =>
      previous && previous.x === x && previous.y === y ? previous : { x, y },
    );
  });

  if (!origin) return null;

  const dx = previewTransform.dx;
  const dy = previewTransform.dy;
  const toScreen = (rect: { x: number; y: number; width: number; height: number }): ScreenRect => ({
    left: origin.x + rect.x * viewScale,
    top: origin.y + rect.y * viewScale,
    width: Math.max(1, rect.width * viewScale),
    height: Math.max(1, rect.height * viewScale),
  });
  const frameToCanvasPatch = (frame: ScreenRect) => ({
    x: Math.round((frame.left - origin.x) / viewScale - dx),
    y: Math.round((frame.top - origin.y) / viewScale - dy),
    width: Math.max(1, Math.round(frame.width / viewScale)),
    height: Math.max(1, Math.round(frame.height / viewScale)),
  });

  const selection = editorSelectionBounds(part, boundsMode);
  const contentRect = toScreen({
    x: part.x + dx + selection.x,
    y: part.y + dy + selection.y,
    width: selection.width,
    height: selection.height,
  });
  const frameRect = toScreen({
    x: part.x + dx,
    y: part.y + dy,
    width: part.width,
    height: part.height,
  });
  const pivotCanvas = pivotForPart(part);
  const pivot = {
    x: origin.x + (pivotCanvas.x + dx) * viewScale,
    y: origin.y + (pivotCanvas.y + dy) * viewScale,
  };

  return (
    <TransformMoveable
      contentRect={contentRect}
      frameRect={frameRect}
      rotationDeg={part.rotation + previewTransform.rotation}
      pivot={pivot}
      onInteractingChange={(isInteracting) => (isInteracting ? onBegin() : onEnd())}
      onMove={(frame) => {
        const patch = frameToCanvasPatch(frame);
        onPatch({ x: patch.x, y: patch.y });
      }}
      onResize={(frame) => {
        const patch = frameToCanvasPatch(frame);
        onPatch(patch);
      }}
      onRotate={(degrees) => {
        onPatch({ rotation: Math.round((degrees - previewTransform.rotation) * 10) / 10 });
      }}
    />
  );
}

function BoundsOverlay({ bounds, zIndex }: { bounds: CharacterPartBounds; zIndex: number }) {
  return (
    <div
      className="pointer-events-none absolute border border-dashed border-primary/70 bg-primary/10"
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        borderRadius: bounds.type === "ellipse" ? "9999px" : 4,
        zIndex,
      }}
    />
  );
}
