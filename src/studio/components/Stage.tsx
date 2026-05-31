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
import {
  deriveEditorClips,
  type ClipKeyframeProperty,
  type ClipKeyframeSelection,
  type EditorClip,
} from "../types";
import { getKeyframesForProperty, sampleClipKeyframedState } from "../hyperframes/keyframes";
import { buildPositionPath, type PositionCheckpoint } from "../hyperframes/motion-path";
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
  projectClickOntoPolyline,
  resolvePickedClipId,
  resolveTargetClipId,
  scaleCompositionRectFromHandleRect,
  snapRotationDegrees,
  type CompositionRect,
  type ResizeHandle,
  type StageGeometry,
  compositionPointToCss,
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
      /** Keyframe being moved (when a dot drag starts), so commitDrag can route
       *  to updateClipKeyframe without depending on React state having flushed
       *  the corresponding selectKeyframe call yet. */
      keyframeId?: string;
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

// Visible dot the user can drag — one per user checkpoint.
interface StageMotionPathCheckpoint {
  id: string;
  x: number;
  y: number;
  selected: boolean;
}

// Bare CSS point for the SVG path data + the clip-local time at that point.
// Time is needed when the user clicks somewhere on the line: we interpolate
// between two adjacent samples' times to pick where to insert a checkpoint.
interface StageMotionPathPolylinePoint {
  x: number;
  y: number;
  time: number;
}

interface StageMotionPath {
  id: string;
  active: boolean;
  /** Motion-step id when the path corresponds to one, otherwise undefined
   *  (standalone position-keyframe runs). Used to route line-clicks back to
   *  addClipMotionCheckpoint. */
  motionId?: string;
  polyline: StageMotionPathPolylinePoint[];
  checkpoints: StageMotionPathCheckpoint[];
}

export function Stage({ iframeRef, onIframeLoad }: StageProps) {
  const project = useStudio((s) => s.project);
  const selectClip = useStudio((s) => s.selectClip);
  const selectedClipId = useStudio((s) => s.selectedClipId);
  const selectedKeyframe = useStudio((s) => s.selectedKeyframe);
  const selectKeyframe = useStudio((s) => s.selectKeyframe);
  const updateClip = useStudio((s) => s.updateClip);
  const updateClipKeyframe = useStudio((s) => s.updateClipKeyframe);
  const addClipMotionCheckpoint = useStudio((s) => s.addClipMotionCheckpoint);
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
  const stageEditableClip = useMemo(() => getStageEditableClip(selectedClip), [selectedClip]);
  const selectedMotionEndpoint = useMemo(
    () => getSelectedMotionEndpoint(stageEditableClip, selectedKeyframe),
    [selectedKeyframe, stageEditableClip],
  );
  const selectedKeyframedClip = useMemo(
    () => getSelectedKeyframedClip(stageEditableClip, selectedKeyframe),
    [selectedKeyframe, stageEditableClip],
  );
  const activeHandleClip = selectedKeyframedClip ?? stageEditableClip;
  const outlinedClip = useMemo(() => {
    if (!stageEditableClip) return null;
    if (drag?.type === "move" && drag.clipId === stageEditableClip.id) {
      return { ...stageEditableClip, x: drag.previewX, y: drag.previewY };
    }
    if (drag?.type === "resize" && drag.clipId === stageEditableClip.id) {
      return { ...stageEditableClip, ...drag.previewClip };
    }
    return selectedKeyframedClip ?? stageEditableClip;
  }, [drag, selectedKeyframedClip, stageEditableClip]);
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
  const motionPaths =
    stageEditableClip && stageGeometry
      ? getStageMotionPaths(stageEditableClip, selectedKeyframe, stageGeometry, drag)
      : [];
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
      : (activeHandleClip?.rotation ?? 0);
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
  const selectedKeyframeKey = selectedKeyframe
    ? `${selectedKeyframe.clipId}:${selectedKeyframe.keyframeId}:${selectedKeyframe.property}`
    : null;
  const moveHandleLabel = selectedKeyframe ? "Move selected keyframe" : "Move selected clip";
  const rotateHandleLabel = selectedKeyframe ? "Rotate selected keyframe" : "Rotate selected clip";

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
    setPreviewError(null);
    void resolvePreviewHtml(project)
      .then((html) => {
        if (!alive) return;
        setResolvedHtml(html);
      })
      .catch((error) => {
        if (!alive) return;
        setResolvedHtml(null);
        setPreviewError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      alive = false;
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
    const player = playerRef.current;
    if (!player) return;

    const preventPlayerClickToggle = (event: Event) => {
      event.stopImmediatePropagation();
    };

    player.addEventListener("click", preventPlayerClickToggle, { capture: true });
    return () => {
      player.removeEventListener("click", preventPlayerClickToggle, { capture: true });
    };
  }, [resolvedHtml]);

  useEffect(() => {
    if (!stageEditableClip || !resolvedHtml) {
      setRenderedElementRect(null);
      return;
    }
    if (drag) return;

    const clipId = stageEditableClip.id;
    const fallbackClip = activeHandleClip ?? stageEditableClip;
    let stopped = false;
    const measure = async () => {
      if (stopped) return;
      const nextRect = await getRenderedPixelCompositionRect(
        iframeRef.current,
        clipId,
        toCompositionRect(fallbackClip),
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
  }, [activeHandleClip, drag, iframeRef, selectedKeyframe, stageEditableClip, resolvedHtml]);

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
  }, [selectedClipId, selectedKeyframeKey]);

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
        const keyframeTarget = getStageKeyframeTarget(
          currentDrag.clipId,
          "rotation",
          selectedKeyframe,
          clips,
        );
        if (keyframeTarget) {
          updateClipKeyframe(keyframeTarget.selection, { rotation: finalRotation });
        } else {
          updateClip(currentDrag.clipId, { rotation: finalRotation });
        }
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
        // Prefer the drag's own keyframeId (set when starting from a path dot)
        // so we route correctly even if selectKeyframe hasn't propagated yet.
        const keyframeTarget = currentDrag.keyframeId
          ? findKeyframeTargetById(currentDrag.clipId, currentDrag.keyframeId, "position", clips)
          : getStageKeyframeTarget(currentDrag.clipId, "position", selectedKeyframe, clips);
        const moved =
          Math.abs(nextX - currentDrag.startX) > 0.5 || Math.abs(nextY - currentDrag.startY) > 0.5;
        if (keyframeTarget) {
          // For a tap-to-select on a dot (no movement), skip the no-op commit
          // so we don't pollute undo history.
          if (moved) {
            updateClipKeyframe(keyframeTarget.selection, {
              x: nextX,
              y: nextY,
            });
          }
        } else if (moved) {
          updateClip(currentDrag.clipId, { x: nextX, y: nextY });
        }
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
      const keyframeTarget = getStageKeyframeTarget(
        currentDrag.clipId,
        "scale",
        selectedKeyframe,
        clips,
      );
      if (keyframeTarget) {
        previewElementRect(iframeRef.current, currentDrag.clipId, finalClip);
        updateClipKeyframe(keyframeTarget.selection, {
          scale: scaleForKeyframedResize(keyframeTarget.clip, finalClip),
        });
      } else {
        commitElementRect(iframeRef.current, currentDrag.clipId, finalClip);
        updateClip(currentDrag.clipId, {
          x: finalClip.x,
          y: finalClip.y,
          width: finalClip.width,
          height: finalClip.height,
        });
      }
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
  }, [
    activeDragKey,
    clearDrag,
    clips,
    iframeRef,
    queueDragPreview,
    selectedKeyframe,
    updateClip,
    updateClipKeyframe,
  ]);

  const startResize = (handle: ResizeHandle, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!project || !stageEditableClip || !activeHandleClip || !stageShellRef.current) return;
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
    const startClip = toCompositionRect(activeHandleClip);
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
      rotation: activeHandleClip.rotation,
      geometry,
    });
  };

  const startRotate = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!stageEditableClip || !activeHandleClip || !stageShellRef.current || !outlineRect) return;
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
      startRotation: activeHandleClip.rotation,
      rawRotation: activeHandleClip.rotation,
      previewRotation: activeHandleClip.rotation,
    });
  };

  // Phase 1: click any motion-path dot to select that keyframe and start dragging.
  const startCheckpointDrag = (
    clipForDrag: EditorClip,
    keyframeId: string,
    event: ReactPointerEvent<SVGElement>,
  ) => {
    if (!project || !stageShellRef.current) return;
    if (clipForDrag.kind === "audio") return;
    const keyframe = clipForDrag.keyframes.find((kf) => kf.id === keyframeId);
    if (!keyframe) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    // Make the inspector reflect the grabbed checkpoint.
    selectClip(clipForDrag.id);
    selectKeyframe({ clipId: clipForDrag.id, keyframeId, property: "position" });

    const state = sampleClipKeyframedState(clipForDrag, keyframe.time);
    const iframe = resolveIframe(playerRef.current);
    const geometry = getStageGeometry(
      stageShellRef.current,
      project.hf.width,
      project.hf.height,
      iframe?.getBoundingClientRect() ?? null,
    );

    beginDrag({
      type: "move",
      clipId: clipForDrag.id,
      keyframeId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: state.x,
      startY: state.y,
      previewX: state.x,
      previewY: state.y,
      geometry,
    });
  };

  // Phase 2: click anywhere on the visible path line to insert a checkpoint at
  // that location and immediately start dragging it. Falls back to a normal
  // select-and-drag if the closest position turns out to coincide with an
  // existing checkpoint (the store de-duplicates by time epsilon).
  const startPathClickDrag = (
    clipForDrag: EditorClip,
    motionId: string,
    polyline: StageMotionPathPolylinePoint[],
    event: ReactPointerEvent<SVGElement>,
  ) => {
    if (!project || !stageShellRef.current) return;
    if (clipForDrag.kind === "audio") return;
    if (polyline.length < 2) return;

    const shellRect = stageShellRef.current.getBoundingClientRect();
    const clickX = event.clientX - shellRect.left;
    const clickY = event.clientY - shellRect.top;
    const projection = projectClickOntoPolyline({ x: clickX, y: clickY }, polyline);
    if (!projection) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    const selection = addClipMotionCheckpoint(clipForDrag.id, motionId, projection.time);
    if (!selection) return;
    selectClip(clipForDrag.id);
    selectKeyframe(selection);

    // After insertion, the project is updated synchronously by the zustand
    // store. Pull the fresh clip state to compute composition coordinates for
    // the new keyframe, so the move-drag starts exactly where the cursor is.
    const nextProject = useStudio.getState().project;
    const nextClip = nextProject
      ? deriveEditorClips(nextProject).find((candidate) => candidate.id === clipForDrag.id)
      : null;
    const newKeyframe = nextClip?.keyframes.find((kf) => kf.id === selection.keyframeId);
    if (!nextClip || !newKeyframe) return;

    const state = sampleClipKeyframedState(nextClip, newKeyframe.time);
    const iframe = resolveIframe(playerRef.current);
    const geometry = getStageGeometry(
      stageShellRef.current,
      project.hf.width,
      project.hf.height,
      iframe?.getBoundingClientRect() ?? null,
    );

    beginDrag({
      type: "move",
      clipId: clipForDrag.id,
      keyframeId: selection.keyframeId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: state.x,
      startY: state.y,
      previewX: state.x,
      previewY: state.y,
      geometry,
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

      const keyframeTarget = getStageKeyframeTarget(
        currentClip.id,
        "position",
        useStudio.getState().selectedKeyframe,
        deriveEditorClips(useStudio.getState().project!),
      );
      const keyframedState = keyframeTarget
        ? sampleClipKeyframedState(keyframeTarget.clip, keyframeTarget.time)
        : null;
      const nextX = Math.round((keyframedState?.x ?? currentClip.x) + delta.x);
      const nextY = Math.round((keyframedState?.y ?? currentClip.y) + delta.y);
      commitElementPosition(iframeRef.current, currentClip.id, nextX, nextY);
      if (keyframeTarget) {
        updateClipKeyframe(keyframeTarget.selection, { x: nextX, y: nextY }, { history: false });
        const nextProject = useStudio.getState().project;
        const nextClip = nextProject
          ? deriveEditorClips(nextProject).find((candidate) => candidate.id === currentClip.id)
          : null;
        stageEditableClipRef.current = nextClip ?? currentClip;
      } else {
        updateClip(currentClip.id, { x: nextX, y: nextY }, { history: false });
        stageEditableClipRef.current = { ...currentClip, x: nextX, y: nextY };
      }
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
    updateClipKeyframe,
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
      {motionPaths.length > 0 && stageEditableClip && (
        <MotionPathOverlay
          paths={motionPaths}
          onCheckpointPointerDown={(checkpointId, event) =>
            startCheckpointDrag(stageEditableClip, checkpointId, event)
          }
          onPathPointerDown={(motionId, polyline, event) =>
            startPathClickDrag(stageEditableClip, motionId, polyline, event)
          }
        />
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
      {outlineRect && selectedMotionEndpoint && (
        <div
          className="pointer-events-none absolute z-40 rounded-full border border-primary/40 bg-panel/95 px-2 py-0.5 text-[11px] font-medium text-foreground shadow-[0_2px_10px_rgba(0,0,0,0.28)]"
          style={{
            left: outlineRect.left,
            top: Math.max(4, outlineRect.top - 28),
          }}
        >
          {selectedMotionEndpoint.motion.label} {selectedMotionEndpoint.endpointLabel}
        </div>
      )}
      {outlineRect && rotateHandleStyle && stageEditableClip && activeHandleClip && (
        <button
          type="button"
          data-stage-rotate-handle=""
          data-stage-keyboard-nudge=""
          title={rotateHandleLabel}
          aria-label={rotateHandleLabel}
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
      {outlineRect && moveHandleStyle && stageEditableClip && activeHandleClip && (
        <button
          ref={moveHandleRef}
          type="button"
          data-stage-move-handle=""
          data-stage-keyboard-nudge=""
          title={moveHandleLabel}
          aria-label={moveHandleLabel}
          className="absolute z-40 flex h-7 w-7 items-center justify-center rounded-md border border-primary/70 bg-panel/95 text-foreground shadow-[0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur hover:bg-panel-2"
          style={{
            ...moveHandleStyle,
            cursor: drag ? "grabbing" : "grab",
          }}
          onPointerDown={(event) => {
            if (!stageEditableClip || !activeHandleClip || !stageShellRef.current) return;
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
              startX: activeHandleClip.x,
              startY: activeHandleClip.y,
              previewX: activeHandleClip.x,
              previewY: activeHandleClip.y,
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

function MotionPathOverlay({
  paths,
  onCheckpointPointerDown,
  onPathPointerDown,
}: {
  paths: StageMotionPath[];
  onCheckpointPointerDown: (checkpointId: string, event: ReactPointerEvent<SVGElement>) => void;
  onPathPointerDown: (
    motionId: string,
    polyline: StageMotionPathPolylinePoint[],
    event: ReactPointerEvent<SVGElement>,
  ) => void;
}) {
  // SVG container stays pointer-events-none so empty stage-area clicks pass
  // through to the iframe/player. Per-element pointer-events are enabled below
  // on dots and on the wide "hit-area" stroke under each line.
  return (
    <svg
      data-stage-motion-path=""
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible"
    >
      <defs>
        {paths.map((path, index) => (
          <marker
            key={path.id}
            id={`stage-motion-arrow-${index}`}
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path
              d="M 0 0 L 8 4 L 0 8 z"
              fill={path.active ? "var(--color-primary)" : "rgba(255,255,255,0.64)"}
            />
          </marker>
        ))}
      </defs>
      {paths.map((path, index) => {
        const pathData = motionPathData(path.polyline);
        const stroke = path.active ? "var(--color-primary)" : "rgba(255,255,255,0.62)";
        // Only paths bound to a motion step accept the click-to-insert gesture;
        // standalone position runs don't have a motion to attach a checkpoint to.
        const lineHitTarget = path.motionId ? (
          <path
            data-stage-motion-line-hit=""
            d={pathData}
            fill="none"
            stroke="transparent"
            strokeWidth={14}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ cursor: "copy", pointerEvents: "stroke" }}
            onPointerDown={(event) => onPathPointerDown(path.motionId!, path.polyline, event)}
          />
        ) : null;
        return (
          <g key={path.id} opacity={path.active ? 0.92 : 0.48}>
            <path
              d={pathData}
              fill="none"
              stroke="rgba(3,7,18,0.72)"
              strokeWidth={7}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={pathData}
              fill="none"
              stroke={stroke}
              strokeWidth={2.25}
              strokeDasharray="8 7"
              strokeLinecap="round"
              strokeLinejoin="round"
              markerEnd={`url(#stage-motion-arrow-${index})`}
            />
            {lineHitTarget}
            {path.checkpoints.map((point, pointIndex) => {
              const selected = point.selected;
              const endpoint = pointIndex === 0 || pointIndex === path.checkpoints.length - 1;
              const radius = selected ? 7 : endpoint ? 5.5 : 4.5;
              return (
                <g
                  key={point.id}
                  data-stage-motion-checkpoint=""
                  style={{
                    pointerEvents: "auto",
                    cursor: selected ? "grabbing" : "grab",
                  }}
                  onPointerDown={(event) => onCheckpointPointerDown(point.id, event)}
                >
                  <circle cx={point.x} cy={point.y} r={radius + 2.5} fill="rgba(3,7,18,0.76)" />
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={radius}
                    fill={selected ? "var(--color-primary)" : "var(--color-panel)"}
                    stroke={path.active ? "var(--color-primary)" : "rgba(255,255,255,0.68)"}
                    strokeWidth={selected ? 2.5 : 1.75}
                  />
                  {selected && (
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={2.4}
                      fill="var(--color-primary-foreground)"
                    />
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
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

function getStageEditableClip(selectedClip: EditorClip | null) {
  if (!selectedClip) return null;
  if (selectedClip.kind === "audio") return null;
  return selectedClip;
}

function getStageMotionPaths(
  clip: EditorClip,
  selectedKeyframe: ClipKeyframeSelection | null,
  geometry: StageGeometry,
  drag: StageDrag,
): StageMotionPath[] {
  const selectedMotion = selectedKeyframe
    ? clip.motionSteps.find((motion) => motion.checkpointIds.includes(selectedKeyframe.keyframeId))
    : null;
  const motionSteps = selectedMotion ? [selectedMotion] : clip.motionSteps;

  const paths: StageMotionPath[] =
    motionSteps.length > 0
      ? motionSteps.map((motion) =>
          buildStageMotionPathFromStep(motion, clip, selectedKeyframe, geometry, drag, {
            id: motion.id,
            active: !selectedMotion || motion.id === selectedMotion.id,
          }),
        )
      : buildStandaloneStageMotionPath(clip, selectedKeyframe, geometry, drag);

  return paths.filter((path) => hasVisibleStagePolyline(path.polyline));
}

function buildStageMotionPathFromStep(
  motion: EditorClip["motionSteps"][number],
  clip: EditorClip,
  selectedKeyframe: ClipKeyframeSelection | null,
  geometry: StageGeometry,
  drag: StageDrag,
  identity: { id: string; active: boolean },
): StageMotionPath {
  // Build the user-checkpoint dots first — these honor drag previews per dot.
  const checkpoints = motion.checkpoints.map((checkpoint) =>
    stageCheckpointAt({
      clip,
      time: checkpoint.time,
      pointId: checkpoint.id,
      selectedKeyframe,
      geometry,
      drag,
    }),
  );

  // Build the polyline. For linear we reuse the checkpoint dots verbatim. For
  // smooth we sample the spline through the user's checkpoints (with drag
  // previews applied so the curve bends live as you drag).
  const polyline: StageMotionPathPolylinePoint[] =
    motion.pathStyle === "smooth"
      ? buildSmoothPolyline(motion, clip, selectedKeyframe, geometry, drag)
      : checkpoints.map((checkpoint, index) =>
          toPolylinePoint(checkpoint, motion.checkpoints[index]!.time),
        );

  return { ...identity, motionId: motion.id, polyline, checkpoints };
}

function buildStandaloneStageMotionPath(
  clip: EditorClip,
  selectedKeyframe: ClipKeyframeSelection | null,
  geometry: StageGeometry,
  drag: StageDrag,
): StageMotionPath[] {
  const positionKeyframes = getKeyframesForProperty(clip.keyframes, "position");
  if (positionKeyframes.length === 0) return [];

  const checkpoints: StageMotionPathCheckpoint[] = [];
  const polylineTimes: number[] = [];
  if (positionKeyframes[0] && positionKeyframes[0].time > 0) {
    checkpoints.push(
      stageCheckpointAt({
        clip,
        time: 0,
        pointId: `${clip.id}:motion-origin`,
        selectedKeyframe,
        geometry,
        drag,
      }),
    );
    polylineTimes.push(0);
  }
  for (const keyframe of positionKeyframes) {
    checkpoints.push(
      stageCheckpointAt({
        clip,
        time: keyframe.time,
        pointId: keyframe.id,
        selectedKeyframe,
        geometry,
        drag,
      }),
    );
    polylineTimes.push(keyframe.time);
  }
  return [
    {
      id: `${clip.id}:position-path`,
      active: true,
      polyline: checkpoints.map((checkpoint, index) =>
        toPolylinePoint(checkpoint, polylineTimes[index]!),
      ),
      checkpoints,
    },
  ];
}

function buildSmoothPolyline(
  motion: EditorClip["motionSteps"][number],
  clip: EditorClip,
  selectedKeyframe: ClipKeyframeSelection | null,
  geometry: StageGeometry,
  drag: StageDrag,
): StageMotionPathPolylinePoint[] {
  // Reconstruct the same composition-space checkpoints the compiler uses, then
  // call the shared sampler. Drag previews must be applied BEFORE sampling so
  // the curve re-shapes as the user drags a checkpoint.
  const positionCheckpoints: PositionCheckpoint[] = motion.checkpoints.map((checkpoint) => {
    const state = sampleClipKeyframedState(clip, checkpoint.time);
    const previewed = applyCheckpointDragInComposition(
      { x: state.x, y: state.y },
      checkpoint.id,
      clip.id,
      selectedKeyframe,
      drag,
    );
    return {
      id: checkpoint.id,
      time: checkpoint.time,
      x: previewed.x,
      y: previewed.y,
      ease: checkpoint.ease,
    };
  });

  const samples = buildPositionPath(positionCheckpoints, "smooth");
  return samples.map((sample) => {
    const state = sampleClipKeyframedState(clip, sample.time);
    const scale = Math.max(0.01, state.scale);
    const css = compositionPointToCss(
      {
        // Display is center-of-clip; the curve shape is identical to the
        // top-left path that the compiler tweens, just offset by half size.
        x: sample.x + (clip.width * scale) / 2,
        y: sample.y + (clip.height * scale) / 2,
      },
      geometry,
    );
    return { x: css.x, y: css.y, time: sample.time };
  });
}

function stageCheckpointAt({
  clip,
  time,
  pointId,
  selectedKeyframe,
  geometry,
  drag,
}: {
  clip: EditorClip;
  time: number;
  pointId: string;
  selectedKeyframe: ClipKeyframeSelection | null;
  geometry: StageGeometry;
  drag: StageDrag;
}): StageMotionPathCheckpoint {
  const state = sampleClipKeyframedState(clip, time);
  const scale = Math.max(0.01, state.scale);
  const point = compositionPointToCss(
    {
      x: state.x + (clip.width * scale) / 2,
      y: state.y + (clip.height * scale) / 2,
    },
    geometry,
  );
  return applyCheckpointDragInCss(
    {
      id: pointId,
      x: point.x,
      y: point.y,
      selected: selectedKeyframe?.clipId === clip.id && selectedKeyframe.keyframeId === pointId,
    },
    clip.id,
    selectedKeyframe,
    geometry,
    drag,
  );
}

function applyCheckpointDragInCss(
  point: StageMotionPathCheckpoint,
  clipId: string,
  selectedKeyframe: ClipKeyframeSelection | null,
  geometry: StageGeometry,
  drag: StageDrag,
): StageMotionPathCheckpoint {
  if (!drag || drag.type !== "move" || drag.clipId !== clipId) return point;
  const editingKeyframe = selectedKeyframe?.clipId === clipId;
  if (editingKeyframe && selectedKeyframe.keyframeId !== point.id) return point;
  return {
    ...point,
    x: point.x + (drag.previewX - drag.startX) / geometry.scaleX,
    y: point.y + (drag.previewY - drag.startY) / geometry.scaleY,
  };
}

function applyCheckpointDragInComposition(
  point: { x: number; y: number },
  checkpointId: string,
  clipId: string,
  selectedKeyframe: ClipKeyframeSelection | null,
  drag: StageDrag,
): { x: number; y: number } {
  if (!drag || drag.type !== "move" || drag.clipId !== clipId) return point;
  const editingKeyframe = selectedKeyframe?.clipId === clipId;
  if (editingKeyframe && selectedKeyframe.keyframeId !== checkpointId) return point;
  return {
    x: point.x + (drag.previewX - drag.startX),
    y: point.y + (drag.previewY - drag.startY),
  };
}

function toPolylinePoint(
  checkpoint: StageMotionPathCheckpoint,
  time: number,
): StageMotionPathPolylinePoint {
  return { x: checkpoint.x, y: checkpoint.y, time };
}

function hasVisibleStagePolyline(points: StageMotionPathPolylinePoint[]) {
  if (points.length < 2) return false;
  return points.some((point, index) => {
    const previous = points[index - 1];
    return previous ? Math.hypot(point.x - previous.x, point.y - previous.y) > 1 : false;
  });
}

function motionPathData(points: StageMotionPathPolylinePoint[]) {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${formatSvgNumber(point.x)} ${formatSvgNumber(point.y)}`,
    )
    .join(" ");
}

function getStageKeyframeTarget(
  clipId: string,
  property: ClipKeyframeProperty,
  selectedKeyframe: ClipKeyframeSelection | null,
  clips: EditorClip[],
) {
  if (!selectedKeyframe || selectedKeyframe.clipId !== clipId) return null;
  return findKeyframeTargetById(clipId, selectedKeyframe.keyframeId, property, clips);
}

function findKeyframeTargetById(
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

function getSelectedMotionEndpoint(
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

function getSelectedKeyframedClip(
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

function scaleForKeyframedResize(
  clip: Pick<EditorClip, "width" | "height">,
  rect: CompositionRect,
): number {
  const scaleX = rect.width / Math.max(1, clip.width);
  const scaleY = rect.height / Math.max(1, clip.height);
  return Math.max(0.01, Math.round(((scaleX + scaleY) / 2) * 1000) / 1000);
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

function formatSvgNumber(value: number) {
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "0";
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
