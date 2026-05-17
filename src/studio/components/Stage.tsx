// Stage — renders project.hf.rootHtml through the HyperFrames player iframe.
// React hosts the editor shell; HyperFrames owns the movie preview.
import "@hyperframes/player";
import { Move, RotateCw } from "lucide-react";
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { resolveIframe, useElementPicker, type PickedElement } from "@hyperframes/studio";
import { useStudio } from "../store";
import type { HyperframesPlayerElement } from "../../hyperframes-player";
import { deriveEditorClips, type EditorClip } from "../types";
import {
  commitElementRect,
  commitElementPosition,
  commitElementRotation,
  hasPickerApi,
  previewElementRect,
  previewElementPosition,
  previewElementRotation,
} from "../hyperframes/player-editing";
import {
  compositionDomRectToCss,
  compositionRectToCss,
  getRenderedPixelCompositionRect,
  getStageGeometry,
  keyboardNudgeDelta,
  pointerAngleDegrees,
  pointerDeltaToComposition,
  rotationDeltaDegrees,
  roundRotationDegrees,
  roundCompositionRect,
  resizeCompositionRect,
  resolvePickedClipId,
  resolveTargetClipId,
  scaleCompositionRectFromHandleRect,
  snapRotationDegrees,
  type CompositionRect,
  type ResizeHandle,
  type StageGeometry,
} from "./stage-helpers";
import { resolvePreviewHtml } from "../hyperframes/preview";

const MIN_STAGE_RESIZE_SIZE = 16;
const STAGE_NUDGE_RESET_MS = 400;
const STAGE_NUDGE_STEP = 1;
const STAGE_FAST_NUDGE_STEP = 10;
const STAGE_ROTATION_SNAP_DEGREES = 15;

interface StageProps {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  onIframeLoad: () => void;
}

type StageDrag =
  | null
  | {
      type: "move";
      clipId: string;
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startX: number;
      startY: number;
      previewX: number;
      previewY: number;
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

export function Stage({ iframeRef, onIframeLoad }: StageProps) {
  const project = useStudio((s) => s.project);
  const selectClip = useStudio((s) => s.selectClip);
  const selectedClipId = useStudio((s) => s.selectedClipId);
  const updateClip = useStudio((s) => s.updateClip);
  const updateRootHtml = useStudio((s) => s.updateRootHtml);
  const checkpointHistory = useStudio((s) => s.checkpointHistory);
  const bringClipForward = useStudio((s) => s.bringClipForward);
  const sendClipBackward = useStudio((s) => s.sendClipBackward);
  const bringClipToFront = useStudio((s) => s.bringClipToFront);
  const sendClipToBack = useStudio((s) => s.sendClipToBack);
  const repairTimelineLanes = useStudio((s) => s.repairTimelineLanes);

  const playerRef = useRef<HyperframesPlayerElement>(null);
  const stageShellRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<StageDrag>(null);
  const queuedDragRef = useRef<StageDrag>(null);
  const dragFrameRef = useRef<number | null>(null);
  const nudgeResetTimerRef = useRef<number | null>(null);
  const nudgeCheckpointedRef = useRef(false);
  const stageEditableClipRef = useRef<EditorClip | null>(null);
  const moveHandleRef = useRef<HTMLButtonElement>(null);
  const [resolvedHtml, setResolvedHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [drag, setDrag] = useState<StageDrag>(null);
  const [renderedElementRect, setRenderedElementRect] = useState<DOMRect | null>(null);

  const clips = useMemo(() => (project ? deriveEditorClips(project) : []), [project]);
  const clipIds = useMemo(() => new Set(clips.map((clip) => clip.id)), [clips]);
  const selectedClip = useMemo(
    () => clips.find((clip) => clip.id === selectedClipId) ?? null,
    [clips, selectedClipId],
  );
  const stageEditableClip = useMemo(
    () => getStageEditableClip(selectedClip, clips),
    [clips, selectedClip],
  );
  const outlinedClip = useMemo(() => {
    if (!stageEditableClip) return null;
    if (drag?.type === "move" && drag.clipId === stageEditableClip.id) {
      return { ...stageEditableClip, x: drag.previewX, y: drag.previewY };
    }
    if (drag?.type === "resize" && drag.clipId === stageEditableClip.id) {
      return { ...stageEditableClip, ...drag.previewClip };
    }
    return stageEditableClip;
  }, [drag, stageEditableClip]);
  const stageGeometry = (() => {
    if (!project || !stageShellRef.current) return null;
    const iframe = resolveIframe(playerRef.current);
    const iframeRect = iframe?.getBoundingClientRect();
    return getStageGeometry(
      stageShellRef.current,
      project.hf.width,
      project.hf.height,
      iframeRect && iframeRect.width > 0 && iframeRect.height > 0 ? iframeRect : null,
    );
  })();
  const outlineRect =
    stageEditableClip && outlinedClip && stageGeometry
      ? drag?.type === "resize" && drag.clipId === stageEditableClip.id
        ? compositionRectToCss(drag.previewHandleRect, stageGeometry)
        : renderedElementRect
          ? shiftRectForDrag(
              compositionDomRectToCss(renderedElementRect, stageGeometry),
              drag,
              stageGeometry,
              stageEditableClip.id,
            )
          : compositionRectToCss(outlinedClip, stageGeometry)
      : null;
  const previewRotation =
    drag?.type === "rotate" && stageEditableClip && drag.clipId === stageEditableClip.id
      ? drag.previewRotation
      : (stageEditableClip?.rotation ?? 0);
  const moveHandleStyle = outlineRect
    ? getMoveHandleStyle(outlineRect, stageShellRef.current)
    : null;
  const rotateHandleStyle = outlineRect
    ? getRotateHandleStyle(outlineRect, previewRotation, stageShellRef.current)
    : null;
  const rotationPillStyle =
    outlineRect && drag?.type === "rotate"
      ? getRotationPillStyle(outlineRect, previewRotation, stageShellRef.current)
      : null;
  const activeDragKey = drag ? `${drag.pointerId}:${drag.clipId}` : null;

  const beginDrag = useCallback((nextDrag: NonNullable<StageDrag>) => {
    dragRef.current = nextDrag;
    queuedDragRef.current = null;
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    setDrag(nextDrag);
  }, []);

  const queueDragPreview = useCallback((nextDrag: NonNullable<StageDrag>) => {
    dragRef.current = nextDrag;
    queuedDragRef.current = nextDrag;
    if (dragFrameRef.current !== null) return;

    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      const queuedDrag = queuedDragRef.current;
      queuedDragRef.current = null;
      setDrag(queuedDrag);
    });
  }, []);

  const clearDrag = useCallback(() => {
    dragRef.current = null;
    queuedDragRef.current = null;
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    setDrag(null);
  }, []);

  // Resolve asset URLs and serve the complete preview HTML through srcdoc.
  // Blob URLs cannot be passed through `src`: the player appends shader query
  // params to `src`, which changes object URLs and breaks loading.
  useEffect(() => {
    if (!project) {
      setResolvedHtml(null);
      setPreviewError(null);
      return;
    }
    if (repairTimelineLanes()) return;
    let alive = true;
    let cleanupResolvedHtml: (() => void) | null = null;
    setPreviewError(null);
    void resolvePreviewHtml(project)
      .then((resolved) => {
        if (!alive) {
          resolved.revoke();
          return;
        }
        cleanupResolvedHtml = resolved.revoke;
        setResolvedHtml(resolved.html);
      })
      .catch((error) => {
        if (!alive) return;
        setResolvedHtml(null);
        setPreviewError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      alive = false;
      cleanupResolvedHtml?.();
    };
  }, [project, repairTimelineLanes]);

  useEffect(() => {
    if (!resolvedHtml) return;
    const iframe = resolveIframe(playerRef.current);
    (iframeRef as { current: HTMLIFrameElement | null }).current = iframe;
    if (!iframe) return;

    iframe.addEventListener("load", onIframeLoad);
    onIframeLoad();
    return () => {
      iframe.removeEventListener("load", onIframeLoad);
      if ((iframeRef as { current: HTMLIFrameElement | null }).current === iframe) {
        (iframeRef as { current: HTMLIFrameElement | null }).current = null;
      }
    };
  }, [iframeRef, onIframeLoad, resolvedHtml]);

  useEffect(() => {
    if (!stageEditableClip || !resolvedHtml) {
      setRenderedElementRect(null);
      return;
    }
    if (drag) return;

    const clipId = stageEditableClip.id;
    let stopped = false;
    const measure = async () => {
      if (stopped) return;
      const nextRect = await getRenderedPixelCompositionRect(
        iframeRef.current,
        clipId,
        toCompositionRect(stageEditableClip),
      );
      if (stopped) return;
      setRenderedElementRect((currentRect) =>
        sameRect(currentRect, nextRect) ? currentRect : nextRect,
      );
    };

    void measure();
    const interval = window.setInterval(() => void measure(), 200);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [drag, iframeRef, stageEditableClip, resolvedHtml]);

  // Element picker — click in player iframe → select clip.
  const { pickedElement, enablePick, isPickMode } = useElementPicker(iframeRef, {
    workspaceFiles: project ? { "index.html": project.hf.rootHtml } : undefined,
    onSyncFiles: (files) => {
      if (files["index.html"]) updateRootHtml(files["index.html"]);
    },
  });

  useEffect(() => {
    const clipId = getPickedClipId(iframeRef.current, pickedElement, clipIds);
    if (clipId) selectClip(clipId);
  }, [clipIds, iframeRef, pickedElement, selectClip]);

  useEffect(() => {
    if (!resolvedHtml) return;
    const rootIframe = iframeRef.current;
    if (!rootIframe) return;

    const cleanups = new Map<Document, () => void>();
    let stopped = false;

    const bindFrameDocument = (frame: HTMLIFrameElement) => {
      const doc = frame.contentDocument;
      if (!doc || cleanups.has(doc)) return;

      const handleClick = (event: MouseEvent) => {
        const ownerFrame = doc.defaultView?.frameElement;
        const clipId = resolveTargetClipId(
          event.target,
          clipIds,
          ownerFrame instanceof Element ? ownerFrame : null,
        );
        if (clipId) selectClip(clipId);
      };

      doc.addEventListener("click", handleClick, true);
      cleanups.set(doc, () => {
        doc.removeEventListener("click", handleClick, true);
      });
    };

    const bindAccessibleFrames = () => {
      if (stopped) return;
      bindFrameDocument(rootIframe);
      for (const frame of rootIframe.contentDocument?.querySelectorAll("iframe") ?? []) {
        if (frame instanceof HTMLIFrameElement) bindFrameDocument(frame);
      }
    };

    bindAccessibleFrames();
    const retryTimer = window.setInterval(bindAccessibleFrames, 250);

    return () => {
      stopped = true;
      window.clearInterval(retryTimer);
      for (const cleanup of cleanups.values()) cleanup();
      cleanups.clear();
    };
  }, [clipIds, iframeRef, resolvedHtml, selectClip]);

  useEffect(() => {
    if (!resolvedHtml || drag || isPickMode) return;

    let attempts = 0;
    const maxAttempts = 20;
    const tryEnablePick = () => {
      enablePick();
      return hasPickerApi(iframeRef.current);
    };

    if (tryEnablePick()) return;

    const retryTimer = window.setInterval(() => {
      attempts += 1;
      if (tryEnablePick() || attempts >= maxAttempts) {
        window.clearInterval(retryTimer);
      }
    }, 200);

    return () => {
      window.clearInterval(retryTimer);
    };
  }, [drag, enablePick, iframeRef, isPickMode, resolvedHtml]);

  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);

  useEffect(() => {
    stageEditableClipRef.current = stageEditableClip;
  }, [stageEditableClip]);

  useEffect(() => {
    return () => {
      if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
      if (nudgeResetTimerRef.current !== null) window.clearTimeout(nudgeResetTimerRef.current);
    };
  }, []);

  useEffect(() => {
    nudgeCheckpointedRef.current = false;
    if (nudgeResetTimerRef.current !== null) {
      window.clearTimeout(nudgeResetTimerRef.current);
      nudgeResetTimerRef.current = null;
    }
  }, [selectedClipId]);

  useEffect(() => {
    if (!stageEditableClip || !outlineRect || drag) return;
    if (shouldPreserveKeyboardFocus(document.activeElement)) return;
    moveHandleRef.current?.focus({ preventScroll: true });
  }, [drag, outlineRect, selectedClipId, stageEditableClip]);

  useEffect(() => {
    if (!activeDragKey) return;

    const handlePointerMove = (event: PointerEvent) => {
      const currentDrag = dragRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) return;
      if (currentDrag.type === "rotate") {
        const preview = getRotationPreview(
          currentDrag,
          event.clientX,
          event.clientY,
          event.shiftKey,
        );
        previewElementRotation(iframeRef.current, currentDrag.clipId, preview.previewRotation);
        queueDragPreview({ ...currentDrag, ...preview });
        return;
      }

      const delta = pointerDeltaToComposition(
        event.clientX - currentDrag.startClientX,
        event.clientY - currentDrag.startClientY,
        currentDrag.geometry,
      );

      if (currentDrag.type === "move") {
        const nextX = currentDrag.startX + delta.x;
        const nextY = currentDrag.startY + delta.y;
        previewElementPosition(iframeRef.current, currentDrag.clipId, nextX, nextY);
        queueDragPreview({ ...currentDrag, previewX: nextX, previewY: nextY });
        return;
      }

      const localDelta = compositionDeltaToLocal(delta.x, delta.y, currentDrag.rotation);
      const preview = getResizePreview(currentDrag, localDelta.x, localDelta.y, event.shiftKey);
      previewElementRect(iframeRef.current, currentDrag.clipId, preview.previewClip);
      queueDragPreview({ ...currentDrag, ...preview });
    };

    const commitDrag = (event: PointerEvent) => {
      const currentDrag = dragRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) return;
      if (currentDrag.type === "rotate") {
        const preview = getRotationPreview(
          currentDrag,
          event.clientX,
          event.clientY,
          event.shiftKey,
        );
        const finalRotation = roundRotationDegrees(preview.previewRotation);
        commitElementRotation(iframeRef.current, currentDrag.clipId, finalRotation);
        updateClip(currentDrag.clipId, { rotation: finalRotation });
        setRenderedElementRect(null);
        clearDrag();
        return;
      }

      const delta = pointerDeltaToComposition(
        event.clientX - currentDrag.startClientX,
        event.clientY - currentDrag.startClientY,
        currentDrag.geometry,
      );

      if (currentDrag.type === "move") {
        const nextX = currentDrag.startX + delta.x;
        const nextY = currentDrag.startY + delta.y;
        commitElementPosition(iframeRef.current, currentDrag.clipId, nextX, nextY);
        updateClip(currentDrag.clipId, { x: nextX, y: nextY });
        clearDrag();
        return;
      }

      const localDelta = compositionDeltaToLocal(delta.x, delta.y, currentDrag.rotation);
      const { previewClip } = getResizePreview(
        currentDrag,
        localDelta.x,
        localDelta.y,
        event.shiftKey,
      );
      const finalClip = roundCompositionRect(previewClip);
      commitElementRect(iframeRef.current, currentDrag.clipId, finalClip);
      updateClip(currentDrag.clipId, {
        x: finalClip.x,
        y: finalClip.y,
        width: finalClip.width,
        height: finalClip.height,
      });
      setRenderedElementRect(null);
      clearDrag();
    };

    const restoreDrag = (currentDrag: NonNullable<StageDrag>) => {
      if (currentDrag.type === "move") {
        commitElementPosition(
          iframeRef.current,
          currentDrag.clipId,
          currentDrag.startX,
          currentDrag.startY,
        );
        return;
      }

      if (currentDrag.type === "rotate") {
        commitElementRotation(iframeRef.current, currentDrag.clipId, currentDrag.startRotation);
        return;
      }

      commitElementRect(iframeRef.current, currentDrag.clipId, currentDrag.startClip);
    };

    const cancelKeyboardDrag = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const currentDrag = dragRef.current;
      if (currentDrag) restoreDrag(currentDrag);
      clearDrag();
    };

    const cancelPointerDrag = (event: PointerEvent) => {
      const currentDrag = dragRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) return;
      restoreDrag(currentDrag);
      clearDrag();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", commitDrag);
    window.addEventListener("pointercancel", cancelPointerDrag);
    window.addEventListener("keydown", cancelKeyboardDrag);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", commitDrag);
      window.removeEventListener("pointercancel", cancelPointerDrag);
      window.removeEventListener("keydown", cancelKeyboardDrag);
    };
  }, [activeDragKey, clearDrag, iframeRef, queueDragPreview, updateClip]);

  const startResize = (handle: ResizeHandle, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!stageEditableClip || !stageShellRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const iframe = resolveIframe(playerRef.current);
    const geometry = getStageGeometry(
      stageShellRef.current,
      project.hf.width,
      project.hf.height,
      iframe?.getBoundingClientRect() ?? null,
    );
    const startClip = toCompositionRect(stageEditableClip);
    const startHandleRect = renderedElementRect
      ? domRectToCompositionRect(renderedElementRect)
      : startClip;

    beginDrag({
      type: "resize",
      clipId: stageEditableClip.id,
      handle,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startClip,
      startHandleRect,
      previewClip: startClip,
      previewHandleRect: startHandleRect,
      rotation: stageEditableClip.rotation,
      geometry,
    });
  };

  const startRotate = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!stageEditableClip || !stageShellRef.current || !outlineRect) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    const shellRect = stageShellRef.current.getBoundingClientRect();
    const centerClientX = shellRect.left + outlineRect.left + outlineRect.width / 2;
    const centerClientY = shellRect.top + outlineRect.top + outlineRect.height / 2;
    const pointerAngle = pointerAngleDegrees(
      centerClientX,
      centerClientY,
      event.clientX,
      event.clientY,
    );

    beginDrag({
      type: "rotate",
      clipId: stageEditableClip.id,
      pointerId: event.pointerId,
      centerClientX,
      centerClientY,
      lastPointerAngle: pointerAngle,
      startRotation: stageEditableClip.rotation,
      rawRotation: stageEditableClip.rotation,
      previewRotation: stageEditableClip.rotation,
    });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        selectClip(null);
        return;
      }

      const layerShortcut = getLayerShortcut(event);
      if (layerShortcut) {
        if (!isStageNudgeEventTarget(event.target)) return;
        const currentClip = stageEditableClipRef.current;
        if (!currentClip || dragRef.current) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (layerShortcut === "front") bringClipToFront(currentClip.id);
        else if (layerShortcut === "back") sendClipToBack(currentClip.id);
        else if (layerShortcut === "forward") bringClipForward(currentClip.id);
        else sendClipBackward(currentClip.id);
        return;
      }

      const delta = keyboardNudgeDelta(
        event.key,
        event.shiftKey ? STAGE_FAST_NUDGE_STEP : STAGE_NUDGE_STEP,
      );
      if (!delta) return;

      if (
        !isStageNudgeEventTarget(event.target) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }

      const currentClip = stageEditableClipRef.current;
      if (!currentClip || dragRef.current) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (!nudgeCheckpointedRef.current) {
        checkpointHistory();
        nudgeCheckpointedRef.current = true;
      }

      const nextX = Math.round(currentClip.x + delta.x);
      const nextY = Math.round(currentClip.y + delta.y);
      commitElementPosition(iframeRef.current, currentClip.id, nextX, nextY);
      updateClip(currentClip.id, { x: nextX, y: nextY }, { history: false });
      stageEditableClipRef.current = { ...currentClip, x: nextX, y: nextY };
      setRenderedElementRect(null);

      if (nudgeResetTimerRef.current !== null) window.clearTimeout(nudgeResetTimerRef.current);
      nudgeResetTimerRef.current = window.setTimeout(() => {
        nudgeCheckpointedRef.current = false;
        nudgeResetTimerRef.current = null;
      }, STAGE_NUDGE_RESET_MS);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [
    bringClipForward,
    bringClipToFront,
    checkpointHistory,
    iframeRef,
    selectClip,
    sendClipBackward,
    sendClipToBack,
    updateClip,
  ]);

  if (!project) return null;

  return (
    <div
      ref={stageShellRef}
      className="absolute inset-0 overflow-hidden bg-stage-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) selectClip(null);
      }}
    >
      {resolvedHtml && (
        <hyperframes-player
          //key={resolvedHtml}
          ref={playerRef}
          srcdoc={resolvedHtml}
          width={project.hf.width}
          height={project.hf.height}
          style={{ position: "absolute", inset: 0, display: "block" }}
        />
      )}
      {previewError && (
        <div className="absolute inset-0 grid place-items-center bg-stage-bg px-8 text-center">
          <div className="max-w-xl rounded-md border border-destructive/30 bg-background/95 p-4 text-sm text-foreground shadow-sm">
            <div className="mb-2 font-medium text-destructive">HyperFrames preview failed</div>
            <div className="whitespace-pre-wrap text-muted-foreground">{previewError}</div>
          </div>
        </div>
      )}
      {outlineRect && (
        <div
          data-stage-selection-overlay=""
          className="pointer-events-none absolute z-30 border border-primary/75"
          style={{
            left: outlineRect.left,
            top: outlineRect.top,
            width: Math.max(1, outlineRect.width),
            height: Math.max(1, outlineRect.height),
            transform: `rotate(${previewRotation}deg)`,
            transformOrigin: "center center",
          }}
        >
          <SelectionCorner handle="nw" onPointerDown={startResize} />
          <SelectionCorner handle="ne" onPointerDown={startResize} />
          <SelectionCorner handle="sw" onPointerDown={startResize} />
          <SelectionCorner handle="se" onPointerDown={startResize} />
        </div>
      )}
      {outlineRect && rotateHandleStyle && stageEditableClip && (
        <button
          type="button"
          data-stage-rotate-handle=""
          data-stage-keyboard-nudge=""
          title="Rotate selected clip"
          aria-label="Rotate selected clip"
          className="absolute z-40 flex h-7 w-7 items-center justify-center rounded-full border border-primary/70 bg-panel/95 text-foreground shadow-[0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur hover:bg-panel-2"
          style={{
            ...rotateHandleStyle,
            cursor: drag?.type === "rotate" ? "grabbing" : "grab",
          }}
          onPointerDown={startRotate}
        >
          <RotateCw size={15} strokeWidth={2.2} />
        </button>
      )}
      {rotationPillStyle && (
        <div
          className="pointer-events-none absolute z-40 rounded-full border border-border bg-panel/95 px-2 py-0.5 text-[11px] font-medium text-foreground shadow-[0_2px_10px_rgba(0,0,0,0.28)]"
          style={rotationPillStyle}
        >
          {Math.round(previewRotation)}°
        </div>
      )}
      {outlineRect && moveHandleStyle && stageEditableClip && (
        <button
          ref={moveHandleRef}
          type="button"
          data-stage-move-handle=""
          data-stage-keyboard-nudge=""
          title="Move selected clip"
          aria-label="Move selected clip"
          className="absolute z-40 flex h-7 w-7 items-center justify-center rounded-md border border-primary/70 bg-panel/95 text-foreground shadow-[0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur hover:bg-panel-2"
          style={{
            ...moveHandleStyle,
            cursor: drag ? "grabbing" : "grab",
          }}
          onPointerDown={(event) => {
            if (!stageEditableClip || !stageShellRef.current) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            const iframe = resolveIframe(playerRef.current);
            const geometry = getStageGeometry(
              stageShellRef.current,
              project.hf.width,
              project.hf.height,
              iframe?.getBoundingClientRect() ?? null,
            );
            beginDrag({
              type: "move",
              clipId: stageEditableClip.id,
              pointerId: event.pointerId,
              startClientX: event.clientX,
              startClientY: event.clientY,
              startX: stageEditableClip.x,
              startY: stageEditableClip.y,
              previewX: stageEditableClip.x,
              previewY: stageEditableClip.y,
              geometry,
            });
          }}
        >
          <Move size={15} strokeWidth={2.2} />
        </button>
      )}
      <div className="pointer-events-none absolute bottom-2 right-3 rounded bg-panel/80 px-2 py-1 text-xs text-muted-foreground">
        {project.hf.width}×{project.hf.height}
      </div>
    </div>
  );
}

function SelectionCorner({
  handle,
  onPointerDown,
}: {
  handle: ResizeHandle;
  onPointerDown: (handle: ResizeHandle, event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const classes = {
    nw: "-left-2 -top-2 cursor-nwse-resize border-l-2 border-t-2",
    ne: "-right-2 -top-2 cursor-nesw-resize border-r-2 border-t-2",
    sw: "-bottom-2 -left-2 cursor-nesw-resize border-b-2 border-l-2",
    se: "-bottom-2 -right-2 cursor-nwse-resize border-b-2 border-r-2",
  }[handle];
  const labels = {
    nw: "Resize selected clip from top left",
    ne: "Resize selected clip from top right",
    sw: "Resize selected clip from bottom left",
    se: "Resize selected clip from bottom right",
  };
  return (
    <button
      type="button"
      aria-label={labels[handle]}
      className={`pointer-events-auto absolute h-4 w-4 border-primary/95 bg-transparent p-0 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] ${classes}`}
      onPointerDown={(event) => onPointerDown(handle, event)}
    />
  );
}

function getStageEditableClip(selectedClip: EditorClip | null, clips: EditorClip[]) {
  if (!selectedClip) return null;
  if (selectedClip.kind === "audio") return null;
  return selectedClip;
}

function getPickedClipId(
  iframe: HTMLIFrameElement | null,
  pickedElement: PickedElement | null,
  clipIds: Set<string>,
) {
  return resolvePickedClipId(iframe, pickedElement, clipIds);
}

function getResizePreview(
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

function getRotationPreview(
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

function toCompositionRect(clip: Pick<EditorClip, "x" | "y" | "width" | "height">) {
  return {
    x: clip.x,
    y: clip.y,
    width: Math.max(MIN_STAGE_RESIZE_SIZE, clip.width),
    height: Math.max(MIN_STAGE_RESIZE_SIZE, clip.height),
  };
}

function domRectToCompositionRect(rect: DOMRect): CompositionRect {
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function sameRect(a: DOMRect | null, b: DOMRect | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

function shiftRectForDrag(
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

function compositionDeltaToLocal(deltaX: number, deltaY: number, rotation: number) {
  if (rotation === 0) return { x: deltaX, y: deltaY };
  const radians = (-rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: deltaX * cos - deltaY * sin,
    y: deltaX * sin + deltaY * cos,
  };
}

function getMoveHandleStyle(
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

function getRotateHandleStyle(
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

function getRotationPillStyle(
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

type LayerShortcut = "forward" | "backward" | "front" | "back";

function getLayerShortcut(event: KeyboardEvent): LayerShortcut | null {
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

function isStageNudgeEventTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return true;
  if (isTextEditingTarget(target)) return false;
  if (target.closest("[data-stage-keyboard-nudge], [data-timeline-clip-id]")) return true;
  return !target.closest(
    "button, a[href], [role='button'], [role='slider'], [role='spinbutton'], [role='textbox']",
  );
}

function shouldPreserveKeyboardFocus(activeElement: Element | null) {
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
