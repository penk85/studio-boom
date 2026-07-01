// react-moveable overlay for the selected stage clip. It replaces the hand-rolled
// move/resize/rotate handles for a single clip with moveable's imperative control box.
//
// Why moveable: moveable updates its control box and target imperatively (direct DOM
// writes), so a drag no longer calls setDrag() every animation frame and re-renders all
// of Stage — that per-frame re-render was the real drag lag, not the object mirror.
//
// This component is a pure INPUT DEVICE: it turns moveable's pointer deltas into a
// composition-space transform patch (via the shared stage-helpers) and dispatches it through
// `applyEdit` — the one place that live-applies + commits. It does not touch the player element
// or the store directly, so its preview and the eventual commit can't diverge.
import { useLayoutEffect, useRef } from "react";
import { FlipHorizontal, FlipVertical } from "lucide-react";
import Moveable from "react-moveable";
import type { StageTransformPatch } from "../hyperframes/stage-edit";
import {
  pointerDeltaToComposition,
  roundCompositionRect,
  roundRotationDegrees,
  scaleCompositionRectFromHandleRect,
  snapGuideSignature,
  type StageGeometry,
  type StageSnapGuide,
} from "./stage-helpers";

interface CompositionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Screen-space rect → composition-space rect using the stage scale/offset. */
function screenRectToComposition(
  rect: { left: number; top: number; width: number; height: number },
  geometry: StageGeometry,
): CompositionRect {
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
  screenRect: { left: number; top: number; width: number; height: number };
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
  const proxyRef = useRef<HTMLDivElement>(null);
  const moveableRef = useRef<Moveable>(null);
  // Last guide signature we notified, so a stable (or empty) guide set doesn't setState per frame.
  const guideSigRef = useRef<string>("");
  // The live patch for the in-flight gesture, committed verbatim on release — guarantees the
  // value the user sees mirrored is exactly the value stored (no drift).
  const pendingRef = useRef<StageTransformPatch | null>(null);
  // True while a gesture is in flight. Moveable owns the proxy transform during a gesture;
  // syncing from props (e.g. a stray re-measure re-render) would fight it and cause a jump.
  const interactingRef = useRef(false);
  // Captured at resize start: the clip's composition box and its rendered (visible) box, both
  // in composition space. scaleCompositionRectFromHandleRect maps the resized visible box back
  // to the clip box, so resize is correct even when the visible box ≠ the clip box (images with
  // transparent padding, base-scaled clips) — matching the legacy resize math exactly.
  const resizeStartRef = useRef<{ clip: CompositionRect; handle: CompositionRect } | null>(null);

  // Keep the proxy aligned to the clip's rendered box + rotation whenever selection,
  // measurement, or stage geometry changes, then let moveable recompute its handle box.
  // Skipped mid-gesture so we never override moveable's live transform.
  useLayoutEffect(() => {
    const proxy = proxyRef.current;
    if (!proxy || interactingRef.current) return;
    proxy.style.left = `${screenRect.left}px`;
    proxy.style.top = `${screenRect.top}px`;
    proxy.style.width = `${Math.max(1, screenRect.width)}px`;
    proxy.style.height = `${Math.max(1, screenRect.height)}px`;
    proxy.style.transform = `rotate(${clip.rotation}deg)`;
    moveableRef.current?.updateRect();
  }, [screenRect.left, screenRect.top, screenRect.width, screenRect.height, clip.rotation]);

  const begin = () => {
    pendingRef.current = null;
    interactingRef.current = true;
    onInteractingChange?.(true);
  };
  const preview = (patch: StageTransformPatch) => {
    pendingRef.current = patch;
    applyEdit(patch, { persist: false });
  };
  const finish = () => {
    const patch = pendingRef.current;
    pendingRef.current = null;
    interactingRef.current = false;
    guideSigRef.current = "";
    onInteractingChange?.(false);
    if (patch) applyEdit(patch, { persist: true });
  };
  // Notify guides only when they change (keeps the no-snap common case setState-free per frame).
  const notifyGuides = (guides: StageSnapGuide[]) => {
    const sig = snapGuideSignature(guides);
    if (sig === guideSigRef.current) return;
    guideSigRef.current = sig;
    onSnapGuidesChange?.(guides);
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
        ref={proxyRef}
        data-stage-moveable-proxy=""
        style={{ position: "absolute", left: 0, top: 0, transformOrigin: "center center" }}
      />
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
      <Moveable
        ref={moveableRef}
        target={proxyRef}
        draggable
        resizable
        rotatable
        origin={false}
        throttleDrag={0}
        throttleResize={0}
        throttleRotate={0}
        onDragStart={begin}
        onDrag={(e) => {
          const comp = pointerDeltaToComposition(
            e.beforeTranslate[0],
            e.beforeTranslate[1],
            geometry,
          );
          const desired = {
            x: clip.x + comp.x,
            y: clip.y + comp.y,
            width: clip.width,
            height: clip.height,
          };
          const snapped = snapMove ? snapMove(desired) : { x: desired.x, y: desired.y, guides: [] };
          // Drive the proxy from the SNAPPED delta (not moveable's raw transform) so the control box
          // tracks the element when a snap nudges the position.
          const sdx = (snapped.x - clip.x) / geometry.scaleX;
          const sdy = (snapped.y - clip.y) / geometry.scaleY;
          e.target.style.transform = `translate(${sdx}px, ${sdy}px) rotate(${clip.rotation}deg)`;
          notifyGuides(snapped.guides);
          preview({ x: snapped.x, y: snapped.y });
        }}
        onDragEnd={finish}
        onResizeStart={() => {
          begin();
          // Freeze the gesture's reference frames: the clip box + the current visible box.
          resizeStartRef.current = {
            clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height },
            handle: screenRectToComposition(screenRect, geometry),
          };
        }}
        onResize={(e) => {
          e.target.style.width = `${e.width}px`;
          e.target.style.height = `${e.height}px`;
          e.target.style.transform = e.transform;
          const start = resizeStartRef.current;
          if (!start) return;
          // The new visible box in composition space: start visible box + moveable's translate,
          // resized to the new dimensions.
          const previewHandle: CompositionRect = {
            x: start.handle.x + e.drag.beforeTranslate[0] * geometry.scaleX,
            y: start.handle.y + e.drag.beforeTranslate[1] * geometry.scaleY,
            width: e.width * geometry.scaleX,
            height: e.height * geometry.scaleY,
          };
          preview(
            roundCompositionRect(
              scaleCompositionRectFromHandleRect(start.clip, start.handle, previewHandle),
            ),
          );
        }}
        onResizeEnd={finish}
        onRotateStart={begin}
        onRotate={(e) => {
          e.target.style.transform = e.transform;
          preview({ rotation: roundRotationDegrees(e.rotation) });
        }}
        onRotateEnd={finish}
      />
    </>
  );
}
