// Stage adapter for the shared selection box (`interaction/TransformMoveable`). It owns the
// Stage-only concerns — the composition⇄screen geometry mapping, edge snapping, and the flip
// toolbar — and delegates all drag/resize/rotate mechanics to the one shared control so the Stage,
// character editor, and motion recorder can't drift apart again.
//
// The box hugs the clip's rendered PIXEL box (`screenRect`, from getRenderedPixelCompositionRect)
// while resize maps that visible box back to the clip's composition box inside TransformMoveable —
// so images with transparent padding resize correctly. Every gesture is turned into a
// StageTransformPatch and dispatched through `applyEdit`, the one place that live-applies + commits.
import { FlipHorizontal, FlipVertical } from "lucide-react";
import type { StageTransformPatch } from "../hyperframes/stage-edit";
import { TransformMoveable } from "../interaction/TransformMoveable";
import type { ScreenRect } from "../interaction/transform-box";
import {
  type CompositionRect,
  type StageGeometry,
  type StageSnapGuide,
  compositionRectToCss,
  roundCompositionRect,
} from "./stage-helpers";

/** Screen-space rect → composition-space rect using the stage scale/offset. */
function screenRectToComposition(rect: ScreenRect, geometry: StageGeometry): CompositionRect {
  return {
    x: (rect.left - geometry.rect.left) * geometry.scaleX,
    y: (rect.top - geometry.rect.top) * geometry.scaleY,
    width: rect.width * geometry.scaleX,
    height: rect.height * geometry.scaleY,
  };
}

export interface StageMoveableClip {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /** Current per-axis mirror sign; used to toggle a flip. */
  scaleX: number;
  scaleY: number;
}

export interface StageMoveableProps {
  /** Base composition transform of the selected clip (source of truth for gesture starts). */
  clip: StageMoveableClip;
  /** Screen-space box of the clip's rendered element (from compositionRectToCss/measurement). */
  screenRect: ScreenRect;
  /** Stage scale/offset mapping screen px ⇄ composition px. */
  geometry: StageGeometry;
  /** The single edit entry point: live-applies the patch, and on persist commits it to rootHtml. */
  applyEdit: (patch: StageTransformPatch, opts: { persist: boolean }) => void;
  /** Snap a proposed move against canvas + sibling edges. Omit to disable snapping. */
  snapMove?: (rect: CompositionRect) => { x: number; y: number; guides: StageSnapGuide[] };
  /** Report the active snap guides so Stage can draw them (empty = none). */
  onSnapGuidesChange?: (guides: StageSnapGuide[]) => void;
  /** Fired true at gesture start / false at release, so Stage can hide legacy chrome + freeze geometry. */
  onInteractingChange?: (interacting: boolean) => void;
}

export function StageMoveable({
  clip,
  screenRect,
  geometry,
  applyEdit,
  snapMove,
  onSnapGuidesChange,
  onInteractingChange,
}: StageMoveableProps) {
  // The clip's composition box in screen space — the transform frame the box's resize maps back to.
  const frameRect = compositionRectToCss(clip, geometry);
  const pivot = {
    x: frameRect.left + frameRect.width / 2,
    y: frameRect.top + frameRect.height / 2,
  };

  const flip = (axis: "h" | "v") => {
    applyEdit(
      {
        scaleX: axis === "h" ? -clip.scaleX : clip.scaleX,
        scaleY: axis === "v" ? -clip.scaleY : clip.scaleY,
      },
      { persist: true },
    );
  };

  return (
    <>
      <div
        data-stage-flip-toolbar=""
        className="pointer-events-auto absolute z-40 flex gap-1 rounded-md border border-border bg-panel/95 p-1 shadow-[0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur"
        style={{ left: screenRect.left, top: Math.max(4, screenRect.top - 38) }}
      >
        <button
          type="button"
          title="Flip horizontal"
          aria-label="Flip horizontal"
          className="flex h-6 w-6 items-center justify-center rounded text-foreground hover:bg-panel-2"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => flip("h")}
        >
          <FlipHorizontal size={15} strokeWidth={2.1} />
        </button>
        <button
          type="button"
          title="Flip vertical"
          aria-label="Flip vertical"
          className="flex h-6 w-6 items-center justify-center rounded text-foreground hover:bg-panel-2"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => flip("v")}
        >
          <FlipVertical size={15} strokeWidth={2.1} />
        </button>
      </div>
      <TransformMoveable
        contentRect={screenRect}
        frameRect={frameRect}
        rotationDeg={clip.rotation}
        pivot={pivot}
        onInteractingChange={(interacting) => {
          if (!interacting) onSnapGuidesChange?.([]);
          onInteractingChange?.(interacting);
        }}
        onMove={(frame, ctx) => {
          const desired = screenRectToComposition(frame, geometry);
          if (ctx.commit) {
            applyEdit({ x: desired.x, y: desired.y }, { persist: true });
            return;
          }
          const snapped = snapMove ? snapMove(desired) : { x: desired.x, y: desired.y, guides: [] };
          onSnapGuidesChange?.(snapped.guides);
          applyEdit({ x: snapped.x, y: snapped.y }, { persist: false });
          // Track the snapped position so the box follows the element when a snap nudges it.
          return compositionRectToCss(
            { x: snapped.x, y: snapped.y, width: clip.width, height: clip.height },
            geometry,
          );
        }}
        onResize={(frame, ctx) => {
          applyEdit(roundCompositionRect(screenRectToComposition(frame, geometry)), {
            persist: ctx.commit,
          });
        }}
        onRotate={(deg, ctx) => {
          applyEdit({ rotation: deg }, { persist: ctx.commit });
        }}
      />
    </>
  );
}
