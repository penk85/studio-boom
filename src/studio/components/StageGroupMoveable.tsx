// react-moveable GROUP overlay for a multi-selection. Renders one transparent proxy per selected
// clip and uses moveable's group mode to move / resize / rotate them together with a single group
// box. Each per-target event is converted to a composition-space patch (shared stage-helpers) and
// dispatched through the SAME `applyEdit` pipeline as single-clip edits, so group and single edits
// can't diverge. One undo step per group gesture: checkpoint once, then persist each clip with
// history disabled.
//
// The proxies are positioned at each clip's composition box (compositionRectToCss), so a per-target
// screen delta/size maps straight back to that clip's composition transform.
import { useLayoutEffect, useMemo, useRef } from "react";
import { FlipHorizontal, FlipVertical } from "lucide-react";
import Moveable from "react-moveable";
import type { StageTransformPatch } from "../hyperframes/stage-edit";
import {
  compositionGroupBounds,
  compositionGroupCenter,
  compositionRectToCss,
  groupFlipPatch,
  pointerDeltaToComposition,
  roundCompositionRect,
  roundRotationDegrees,
  snapGuideSignature,
  type CompositionRect,
  type StageGeometry,
  type StageSnapGuide,
} from "./stage-helpers";
import type { StageMoveableClip } from "./StageMoveable";

export interface StageGroupMoveableProps {
  /** The selected clips' base composition transforms (locked/audio already excluded by Stage). */
  clips: StageMoveableClip[];
  geometry: StageGeometry;
  applyEdit: (
    clipId: string,
    patch: StageTransformPatch,
    opts: { persist: boolean; history?: boolean },
  ) => void;
  /** Records one undo checkpoint for the whole group gesture. */
  checkpoint: () => void;
  /** Snap the group's bounding box against everything outside the selection; returns one delta. */
  snapGroupMove?: (
    selectedIds: string[],
    bbox: CompositionRect,
    rawDelta: { x: number; y: number },
  ) => { dx: number; dy: number; guides: StageSnapGuide[] };
  /** Report the active snap guides so Stage can draw them (empty = none). */
  onSnapGuidesChange?: (guides: StageSnapGuide[]) => void;
  onInteractingChange?: (interacting: boolean) => void;
}

export function StageGroupMoveable({
  clips,
  geometry,
  applyEdit,
  checkpoint,
  snapGroupMove,
  onSnapGuidesChange,
  onInteractingChange,
}: StageGroupMoveableProps) {
  const moveableRef = useRef<Moveable>(null);
  const proxyMap = useRef<Map<string, HTMLDivElement>>(new Map());
  const interactingRef = useRef(false);
  // Patches accumulated during the gesture, keyed by clip id, committed on release.
  const pendingRef = useRef<Map<string, StageTransformPatch>>(new Map());
  // Last guide signature we notified, so a stable (or empty) guide set doesn't setState per frame.
  const guideSigRef = useRef<string>("");

  const screenRects = useMemo(
    () => new Map(clips.map((clip) => [clip.id, compositionRectToCss(clip, geometry)])),
    [clips, geometry],
  );

  // Screen-space top-left of the group's bounding box, for placing the flip toolbar above it.
  const toolbarAnchor = useMemo(() => {
    if (screenRects.size === 0) return null;
    let left = Infinity;
    let top = Infinity;
    for (const rect of screenRects.values()) {
      left = Math.min(left, rect.left);
      top = Math.min(top, rect.top);
    }
    return { left, top };
  }, [screenRects]);

  // Mirror the whole selection across its bounding-box center: reflect each clip's position on the
  // flip axis and toggle that axis's mirror sign. One undo step for the whole gesture (checkpoint
  // once, then commit each clip with history disabled) — the same contract as a group drag/resize.
  const flipGroup = (axis: "h" | "v") => {
    const center = compositionGroupCenter(clips);
    if (!center) return;
    checkpoint();
    for (const clip of clips) {
      applyEdit(clip.id, groupFlipPatch(clip, axis, center), { persist: true, history: false });
    }
  };

  // Keep each proxy aligned to its clip's box + rotation (skipped mid-gesture so moveable owns them).
  useLayoutEffect(() => {
    if (interactingRef.current) return;
    for (const clip of clips) {
      const proxy = proxyMap.current.get(clip.id);
      const rect = screenRects.get(clip.id);
      if (!proxy || !rect) continue;
      proxy.style.left = `${rect.left}px`;
      proxy.style.top = `${rect.top}px`;
      proxy.style.width = `${Math.max(1, rect.width)}px`;
      proxy.style.height = `${Math.max(1, rect.height)}px`;
      proxy.style.transform = `rotate(${clip.rotation}deg)`;
    }
    moveableRef.current?.updateRect();
  }, [clips, screenRects]);

  const clipById = useMemo(() => new Map(clips.map((clip) => [clip.id, clip])), [clips]);
  const clipForTarget = (target: HTMLElement | SVGElement): StageMoveableClip | null => {
    const id = (target as HTMLElement).dataset?.clipId;
    return id ? (clipById.get(id) ?? null) : null;
  };

  const begin = () => {
    pendingRef.current.clear();
    interactingRef.current = true;
    onInteractingChange?.(true);
  };
  const stage = (clipId: string, patch: StageTransformPatch) => {
    pendingRef.current.set(clipId, patch);
    applyEdit(clipId, patch, { persist: false });
  };
  const finish = () => {
    const pending = pendingRef.current;
    interactingRef.current = false;
    guideSigRef.current = "";
    onInteractingChange?.(false);
    if (pending.size > 0) {
      checkpoint();
      for (const [clipId, patch] of pending) {
        applyEdit(clipId, patch, { persist: true, history: false });
      }
    }
    pending.clear();
  };
  // Notify guides only when they change (keeps the no-snap common case setState-free per frame).
  const notifyGuides = (guides: StageSnapGuide[]) => {
    const sig = snapGuideSignature(guides);
    if (sig === guideSigRef.current) return;
    guideSigRef.current = sig;
    onSnapGuidesChange?.(guides);
  };

  const targets = clips
    .map((clip) => proxyMap.current.get(clip.id))
    .filter((el): el is HTMLDivElement => !!el);

  return (
    <>
      {toolbarAnchor && (
        <div
          data-stage-group-flip-toolbar=""
          className="pointer-events-auto absolute z-40 flex gap-1 rounded-md border border-border bg-panel/95 p-1 shadow-[0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur"
          style={{ left: toolbarAnchor.left, top: Math.max(4, toolbarAnchor.top - 38) }}
        >
          <button
            type="button"
            title="Flip selection horizontal"
            aria-label="Flip selection horizontal"
            className="flex h-6 w-6 items-center justify-center rounded text-foreground hover:bg-panel-2"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => flipGroup("h")}
          >
            <FlipHorizontal size={15} strokeWidth={2.1} />
          </button>
          <button
            type="button"
            title="Flip selection vertical"
            aria-label="Flip selection vertical"
            className="flex h-6 w-6 items-center justify-center rounded text-foreground hover:bg-panel-2"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => flipGroup("v")}
          >
            <FlipVertical size={15} strokeWidth={2.1} />
          </button>
        </div>
      )}
      {clips.map((clip) => (
        <div
          key={clip.id}
          data-clip-id={clip.id}
          data-stage-group-proxy=""
          ref={(el) => {
            if (el) proxyMap.current.set(clip.id, el);
            else proxyMap.current.delete(clip.id);
          }}
          style={{ position: "absolute", left: 0, top: 0, transformOrigin: "center center" }}
        />
      ))}
      <Moveable
        ref={moveableRef}
        target={targets}
        draggable
        resizable
        rotatable
        origin={false}
        onDragGroupStart={begin}
        onDragGroup={({ events }) => {
          if (events.length === 0) return;
          // A group drag translates every member by the same delta, so snap the group's bounding
          // box ONCE and apply the resulting delta uniformly — the selection stays rigid while its
          // box snaps to canvas / sibling edges.
          const raw = pointerDeltaToComposition(
            events[0]!.beforeTranslate[0],
            events[0]!.beforeTranslate[1],
            geometry,
          );
          const bounds = compositionGroupBounds(clips);
          const snapped =
            snapGroupMove && bounds
              ? snapGroupMove(
                  clips.map((clip) => clip.id),
                  bounds,
                  raw,
                )
              : { dx: raw.x, dy: raw.y, guides: [] };
          const sdx = snapped.dx / geometry.scaleX;
          const sdy = snapped.dy / geometry.scaleY;
          for (const ev of events) {
            const clip = clipForTarget(ev.target);
            if (!clip) continue;
            ev.target.style.transform = `translate(${sdx}px, ${sdy}px) rotate(${clip.rotation}deg)`;
            stage(clip.id, { x: clip.x + snapped.dx, y: clip.y + snapped.dy });
          }
          notifyGuides(snapped.guides);
        }}
        onDragGroupEnd={finish}
        onResizeGroupStart={begin}
        onResizeGroup={({ events }) => {
          for (const ev of events) {
            ev.target.style.width = `${ev.width}px`;
            ev.target.style.height = `${ev.height}px`;
            ev.target.style.transform = ev.transform;
            const clip = clipForTarget(ev.target);
            if (!clip) continue;
            // Proxy sits on the clip's composition box, so screen size/translate map straight back.
            stage(
              clip.id,
              roundCompositionRect({
                x: clip.x + ev.drag.beforeTranslate[0] * geometry.scaleX,
                y: clip.y + ev.drag.beforeTranslate[1] * geometry.scaleY,
                width: ev.width * geometry.scaleX,
                height: ev.height * geometry.scaleY,
              }),
            );
          }
        }}
        onResizeGroupEnd={finish}
        onRotateGroupStart={begin}
        onRotateGroup={({ events }) => {
          for (const ev of events) {
            ev.target.style.transform = ev.transform;
            const clip = clipForTarget(ev.target);
            if (!clip) continue;
            // Group rotate orbits each clip around the group center: apply the rotation AND the
            // orbit translation moveable computes for this target.
            const comp = pointerDeltaToComposition(
              ev.drag.beforeTranslate[0],
              ev.drag.beforeTranslate[1],
              geometry,
            );
            stage(clip.id, {
              rotation: roundRotationDegrees(ev.rotation),
              x: clip.x + comp.x,
              y: clip.y + comp.y,
            });
          }
        }}
        onRotateGroupEnd={finish}
      />
    </>
  );
}
