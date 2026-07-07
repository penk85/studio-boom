// The ONE selection/transform box for the whole editor. A react-moveable drag/resize/rotate
// control shared by the Stage, the character editor, and the motion recorder, so there is a
// single interaction to maintain instead of three drifting copies.
//
// It is a pure INPUT DEVICE (same philosophy as the Stage's original StageMoveable): it never
// touches a store or a model. It hugs a CONTENT box (the visible / alpha bounds) and reports each
// gesture as a normalized, screen-space FRAME rect (or rotation) plus a `commit` flag. Every
// surface supplies a thin adapter that maps those screen results into its own model — absolute
// clip transforms (Stage), part base transforms (character build), or motion override deltas
// (recorder). The frame≠content split is what lets the box hug the art while a resize still scales
// the whole (often transparent-padded) frame, via the shared `scaleCompositionRectFromHandleRect`.
import { useLayoutEffect, useRef } from "react";
import Moveable from "react-moveable";
import {
  type ScreenRect,
  contentOriginPx,
  scaleCompositionRectFromHandleRect,
} from "./transform-box";

export interface TransformGestureContext {
  /** True on the final call of a gesture (pointer released) — the caller should persist then. */
  commit: boolean;
}

export interface TransformMoveableProps {
  /** Screen-space box the control hugs — the visible / alpha bounds. Recomputed by the caller. */
  contentRect: ScreenRect;
  /** Screen-space transform frame (full element box). Only used to remap a resize back to the frame. */
  frameRect: ScreenRect;
  /** Current rendered rotation of the selection, in degrees. */
  rotationDeg: number;
  /**
   * Screen-space rotation pivot (usually the frame center or the part's pivot). The box rotates
   * around this point rather than the content-box center, so an off-center content box does not
   * drift off the element during rotation. Omit to pivot around the content-box center.
   */
  pivot?: { x: number; y: number };
  resizable?: boolean;
  rotatable?: boolean;
  /** Minimum frame size (screen px) enforced during resize. */
  minFrameSize?: number;
  /** Fired true at gesture start / false at release, so callers can freeze re-measurement. */
  onInteractingChange?: (interacting: boolean) => void;
  /**
   * A move gesture: `frame` is the proposed new frame rect (screen px). Return an adjusted frame
   * (e.g. snapped) to keep the box tracking it; return nothing to accept the proposal. The caller
   * applies the move to its model here (live preview when `!commit`, persist when `commit`).
   */
  onMove?: (frame: ScreenRect, ctx: TransformGestureContext) => ScreenRect | void;
  /** A resize gesture: `frame` is the new frame rect (screen px), already remapped from the content box. */
  onResize?: (frame: ScreenRect, ctx: TransformGestureContext) => void;
  /** A rotate gesture: `deg` is the new absolute rotation (degrees). */
  onRotate?: (deg: number, ctx: TransformGestureContext) => void;
}

const toRect = (r: ScreenRect) => ({ x: r.left, y: r.top, width: r.width, height: r.height });
const roundDeg = (deg: number) => Math.round(deg * 10) / 10;

export function TransformMoveable({
  contentRect,
  frameRect,
  rotationDeg,
  pivot,
  resizable = true,
  rotatable = true,
  minFrameSize = 16,
  onInteractingChange,
  onMove,
  onResize,
  onRotate,
}: TransformMoveableProps) {
  const proxyRef = useRef<HTMLDivElement>(null);
  const moveableRef = useRef<Moveable>(null);
  // Moveable owns the proxy transform during a gesture; syncing from props mid-gesture would
  // fight it and cause a jump. This gates the prop-sync layout effect.
  const interactingRef = useRef(false);
  // The last previewed result per gesture, re-reported verbatim on release so the committed value
  // is exactly what the user saw (no drift).
  const lastMoveRef = useRef<ScreenRect | null>(null);
  const lastResizeRef = useRef<ScreenRect | null>(null);
  const lastRotateRef = useRef<number | null>(null);
  // The frame captured at drag start. moveable's beforeTranslate is cumulative from the gesture
  // start, so the move must be anchored to the start frame — not the live `frameRect` prop, which
  // moves underneath us on surfaces that live-apply the drag to their model (character, recorder).
  const moveStartRef = useRef<ScreenRect | null>(null);
  // Reference frames captured at resize start (the box + its content box), for the visible→frame remap.
  const resizeStartRef = useRef<{ frame: ScreenRect; content: ScreenRect } | null>(null);

  const origin = contentOriginPx(contentRect, pivot);
  const originCss = `${origin.x}px ${origin.y}px`;

  // Keep the proxy glued to the content box + rotation whenever selection / measurement / geometry
  // changes, then let moveable recompute its handle box. Skipped mid-gesture (moveable owns it).
  useLayoutEffect(() => {
    const proxy = proxyRef.current;
    if (!proxy || interactingRef.current) return;
    proxy.style.left = `${contentRect.left}px`;
    proxy.style.top = `${contentRect.top}px`;
    proxy.style.width = `${Math.max(1, contentRect.width)}px`;
    proxy.style.height = `${Math.max(1, contentRect.height)}px`;
    proxy.style.transformOrigin = originCss;
    proxy.style.transform = `rotate(${rotationDeg}deg)`;
    moveableRef.current?.updateRect();
  }, [
    contentRect.left,
    contentRect.top,
    contentRect.width,
    contentRect.height,
    rotationDeg,
    originCss,
  ]);

  const begin = () => {
    interactingRef.current = true;
    onInteractingChange?.(true);
  };
  const finish = () => {
    interactingRef.current = false;
    onInteractingChange?.(false);
  };

  return (
    <>
      <div
        ref={proxyRef}
        data-transform-moveable-proxy=""
        style={{ position: "absolute", left: 0, top: 0, transformOrigin: originCss }}
      />
      <Moveable
        ref={moveableRef}
        target={proxyRef}
        draggable
        resizable={resizable}
        rotatable={rotatable}
        origin={false}
        transformOrigin={originCss}
        throttleDrag={0}
        throttleResize={0}
        throttleRotate={0}
        onDragStart={() => {
          begin();
          moveStartRef.current = frameRect;
        }}
        onDrag={(e) => {
          const start = moveStartRef.current ?? frameRect;
          const proposed: ScreenRect = {
            left: start.left + e.beforeTranslate[0],
            top: start.top + e.beforeTranslate[1],
            width: start.width,
            height: start.height,
          };
          const adjusted = onMove?.(proposed, { commit: false }) ?? proposed;
          lastMoveRef.current = adjusted;
          // Drive the proxy from the (possibly snapped) frame delta so the box tracks the element.
          const tx = adjusted.left - start.left;
          const ty = adjusted.top - start.top;
          e.target.style.transform = `translate(${tx}px, ${ty}px) rotate(${rotationDeg}deg)`;
        }}
        onDragEnd={() => {
          if (lastMoveRef.current) onMove?.(lastMoveRef.current, { commit: true });
          lastMoveRef.current = null;
          moveStartRef.current = null;
          finish();
        }}
        onResizeStart={() => {
          begin();
          resizeStartRef.current = { frame: frameRect, content: contentRect };
        }}
        onResize={(e) => {
          e.target.style.width = `${e.width}px`;
          e.target.style.height = `${e.height}px`;
          e.target.style.transform = e.transform;
          const start = resizeStartRef.current;
          if (!start) return;
          const previewContent = {
            x: start.content.left + e.drag.beforeTranslate[0],
            y: start.content.top + e.drag.beforeTranslate[1],
            width: e.width,
            height: e.height,
          };
          const nextFrame = scaleCompositionRectFromHandleRect(
            toRect(start.frame),
            toRect(start.content),
            previewContent,
            minFrameSize,
          );
          const frame: ScreenRect = {
            left: nextFrame.x,
            top: nextFrame.y,
            width: nextFrame.width,
            height: nextFrame.height,
          };
          lastResizeRef.current = frame;
          onResize?.(frame, { commit: false });
        }}
        onResizeEnd={() => {
          if (lastResizeRef.current) onResize?.(lastResizeRef.current, { commit: true });
          lastResizeRef.current = null;
          resizeStartRef.current = null;
          finish();
        }}
        onRotateStart={begin}
        onRotate={(e) => {
          e.target.style.transform = e.transform;
          const deg = roundDeg(e.rotation);
          lastRotateRef.current = deg;
          onRotate?.(deg, { commit: false });
        }}
        onRotateEnd={() => {
          if (lastRotateRef.current != null) onRotate?.(lastRotateRef.current, { commit: true });
          lastRotateRef.current = null;
          finish();
        }}
      />
    </>
  );
}
