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
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { resolveIframe, useElementPicker, usePlayerStore } from "@hyperframes/studio";
import { useStudio } from "../store";
import type { HyperframesPlayerElement } from "../../hyperframes-player";
import { deriveEditorClips, type EditorClip } from "../types";
import { deriveProjectTimelineClips } from "../scenes";
import { hasLibraryDragItem, readLibraryDragItem } from "../library-items";
import { sampleClipKeyframedState } from "../hyperframes/keyframes";
import { hasPickerApi } from "../hyperframes/player-editing";
import {
  compositionDomRectToCss,
  compositionRectToCss,
  getRenderedElementRect,
  getRenderedPixelCompositionRect,
  clientPointToComposition,
  getStageGeometry,
  keyboardNudgeDelta,
  pointerAngleDegrees,
  pointerDeltaToComposition,
  roundRotationDegrees,
  roundCompositionRect,
  hitTestClipIdsAtPoint,
  projectClickOntoPolyline,
  resolveTargetClipId,
  snapCompositionRect,
  type CompositionRect,
  type ResizeHandle,
  type StageSnapGuide,
  type StageSnapTarget,
  type StageGeometry,
  marqueeHitIds,
} from "./stage-helpers";
import { resolvePreviewHtml } from "../hyperframes/preview";
import { liveApplyStagePatch, type StageTransformPatch } from "../hyperframes/stage-edit";
import { StageMoveable } from "./StageMoveable";
import { StageGroupMoveable } from "./StageGroupMoveable";
import {
  useSelectDrag,
  type MoveSession,
  type PointerEventLike,
} from "../interaction/useSelectDrag";
import {
  buildMoveSnapTargets,
  compositionDeltaToLocal,
  domRectToCompositionRect,
  findKeyframeTargetById,
  getStageKeyframeTarget,
  getLayerShortcut,
  getMoveHandleStyle,
  getMovePreview,
  getPickedClipId,
  getResizePreview,
  getRotateHandleStyle,
  getRotationPillStyle,
  getRotationPreview,
  getSelectedKeyframedClip,
  getSelectedMotionEndpoint,
  getStageClickTargets,
  getStageEditableClip,
  isStageNudgeEventTarget,
  sameRect,
  sameRectMap,
  scaleForKeyframedResize,
  shiftRectForDrag,
  shouldPreserveKeyboardFocus,
  STAGE_SNAP_THRESHOLD_PX,
  toCompositionRect,
  type StageDrag,
} from "./stage-interactions";
import { getStageMotionPaths, type StageMotionPathPolylinePoint } from "./stage-motion-paths";
import {
  MotionPathOverlay,
  SelectionCorner,
  StageClickOverlay,
  StageSnapGuideOverlay,
} from "./StageOverlays";

const STAGE_NUDGE_RESET_MS = 400;
const STAGE_NUDGE_STEP = 1;
const STAGE_FAST_NUDGE_STEP = 10;

interface StageProps {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  onIframeLoad: () => void;
}

export function Stage({ iframeRef, onIframeLoad }: StageProps) {
  const rootProject = useStudio((s) => s.project);
  const activeSceneId = useStudio((s) => s.activeSceneId);
  // The Stage always previews the whole film, never a single scene. `activeSceneId`
  // scopes *editing* (which composition a mutation lands in), not what is rendered,
  // so playback runs from the first scene to the last instead of stopping at a
  // scene boundary. See docs/ux-followups.md §1.
  const project = rootProject;
  const setActiveScene = useStudio((s) => s.setActiveScene);
  const selectClip = useStudio((s) => s.selectClip);
  const selectedClipId = useStudio((s) => s.selectedClipId);
  const selectedClipIds = useStudio((s) => s.selectedClipIds);
  const selectClips = useStudio((s) => s.selectClips);
  const toggleClipInSelection = useStudio((s) => s.toggleClipInSelection);
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
  const currentTime = usePlayerStore((s) => s.currentTime);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const playerRef = useRef<HyperframesPlayerElement>(null);
  const stageShellRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<StageDrag>(null);
  const queuedDragRef = useRef<StageDrag>(null);
  const dragFrameRef = useRef<number | null>(null);
  // Which gesture owns the active drag: the Move-handle/resize/rotate window pipeline, or
  // a controller-driven canvas body-drag. Lets the window pointermove handler step aside
  // for body-drags so the two don't both apply the same move.
  const dragDriverRef = useRef<"window" | "controller">("window");
  const nudgeResetTimerRef = useRef<number | null>(null);
  const nudgeCheckpointedRef = useRef(false);
  const stageEditableClipRef = useRef<EditorClip | null>(null);
  const clipIdsRef = useRef<Set<string>>(new Set());
  const moveHandleRef = useRef<HTMLButtonElement>(null);
  // Last geometry computed while NOT dragging. Reused (frozen) for the duration of a
  // drag so the selection chrome and motion paths don't flicker — see `stageGeometry`.
  const lastStageGeometryRef = useRef<StageGeometry | null>(null);
  // Set by a base-property stage commit (move/resize/rotate/nudge) once the change has
  // already been applied to the live player iframe. The resolve effect consumes it to skip
  // re-bundling and swapping `srcdoc`, which would reload the iframe (black flash) only to
  // re-render what the live DOM already shows. Keyframe commits do NOT set this — they
  // change the GSAP timeline and need a real reload to take effect on play/seek.
  const suppressReloadRef = useRef(false);
  const [resolvedHtml, setResolvedHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [drag, setDrag] = useState<StageDrag>(null);
  // True while a react-moveable gesture is in flight. Treated like `drag` for freezing
  // geometry and suspending measurement, so the moveable proxy never gets re-synced (and
  // never jumps) mid-gesture.
  const [moveableInteracting, setMoveableInteracting] = useState(false);
  // The rubber-band rectangle (stage-shell-local px) while a marquee selection is in flight; null
  // when idle. Rendered as editor-only chrome and used to freeze geometry / suspend the moveable
  // control box for the duration of the sweep.
  const [marquee, setMarquee] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  // Snap guides produced by a react-moveable drag (single or group). The legacy handle drag carries
  // its own guides on the drag state; these cover the moveable-driven paths through the same
  // StageSnapGuideOverlay so both interaction systems draw identical guides.
  const [moveableSnapGuides, setMoveableSnapGuides] = useState<StageSnapGuide[]>([]);
  const [renderedElementRect, setRenderedElementRect] = useState<DOMRect | null>(null);
  const [renderedClickRects, setRenderedClickRects] = useState<Map<string, DOMRect>>(new Map());

  // Clips from every scene, with `start` in absolute film time — the same clock the
  // player now reports, so time-based hit testing and overlays line up. Each clip
  // carries its owning `sceneId` so an edit can be routed to the right composition.
  const clips = useMemo(() => (project ? deriveProjectTimelineClips(project) : []), [project]);
  const clipIds = useMemo(() => new Set(clips.map((clip) => clip.id)), [clips]);
  const sceneIdByClipId = useMemo(
    () => new Map(clips.map((clip) => [clip.id, clip.sceneId] as const)),
    [clips],
  );
  // Editing is still scene-scoped: point the store at the clip's own scene before
  // mutating it, otherwise the write lands in whichever composition was last active.
  const activateClipScene = useCallback(
    (clipId: string) => {
      const sceneId = sceneIdByClipId.get(clipId);
      if (sceneId === undefined) return;
      if (useStudio.getState().activeSceneId !== sceneId) setActiveScene(sceneId);
    },
    [sceneIdByClipId, setActiveScene],
  );
  const selectStageClip = useCallback(
    (clipId: string | null) => {
      if (clipId) activateClipScene(clipId);
      selectClip(clipId);
    },
    [activateClipScene, selectClip],
  );

  // Dropping a Library item on the canvas places it where it was dropped, starting
  // at the playhead — the two things the user has already expressed by dragging
  // there at that moment. Clicking in the Library still adds at the default spot.
  const [libraryDropActive, setLibraryDropActive] = useState(false);
  const handleLibraryDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    setLibraryDropActive(false);
    const item = readLibraryDragItem(event.dataTransfer);
    if (!item) return;
    event.preventDefault();
    const geometry = lastStageGeometryRef.current;
    const center = geometry
      ? clientPointToComposition(event.clientX, event.clientY, geometry)
      : undefined;
    void useStudio.getState().addLibraryItem(item, {
      center,
      start: usePlayerStore.getState().currentTime,
    });
  }, []);
  const stageClickTargets = useMemo(
    () => getStageClickTargets(clips, currentTime, renderedClickRects),
    [clips, currentTime, renderedClickRects],
  );
  const selectedClip = useMemo(
    () => clips.find((clip) => clip.id === selectedClipId) ?? null,
    [clips, selectedClipId],
  );
  // The multi-selection set is only authoritative when it actually contains the primary clip;
  // otherwise a single-select action changed the primary and the set is stale, so fall back to
  // just the primary. This keeps other selectedClipId writers correct without touching them all.
  const effectiveSelectedIds = useMemo(() => {
    if (selectedClipId && selectedClipIds.includes(selectedClipId)) return selectedClipIds;
    return selectedClipId ? [selectedClipId] : [];
  }, [selectedClipId, selectedClipIds]);
  const multiSelected = effectiveSelectedIds.length > 1;
  const multiSelectionTargets = useMemo(
    () =>
      multiSelected
        ? stageClickTargets.filter((target) => effectiveSelectedIds.includes(target.id))
        : [],
    [multiSelected, stageClickTargets, effectiveSelectedIds],
  );
  // The transformable members of a multi-selection (locked / audio can't be moved as a group).
  const groupMoveableClips = useMemo(
    () =>
      multiSelected
        ? clips
            .filter(
              (clip) =>
                effectiveSelectedIds.includes(clip.id) && !clip.locked && clip.kind !== "audio",
            )
            .map((clip) => ({
              id: clip.id,
              x: clip.x,
              y: clip.y,
              width: clip.width,
              height: clip.height,
              rotation: clip.rotation,
              scaleX: clip.scaleX ?? 1,
              scaleY: clip.scaleY ?? 1,
            }))
        : [],
    [multiSelected, clips, effectiveSelectedIds],
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
    // Freeze geometry during a drag: the iframe never moves or resizes mid-gesture,
    // and re-reading its bounding rect on every drag frame intermittently returns a
    // 0-size rect (while the browser repaints the iframe), which collapses geometry to
    // the letterboxed fallback for a frame and makes the selection chrome / motion
    // paths flicker. Reusing the pre-drag geometry also drops a forced reflow per frame.
    if ((drag || moveableInteracting || marquee) && lastStageGeometryRef.current)
      return lastStageGeometryRef.current;
    if (!project || !stageShellRef.current) return null;
    const iframe = resolveIframe(playerRef.current);
    const iframeRect = iframe?.getBoundingClientRect();
    const geometry = getStageGeometry(
      stageShellRef.current,
      project.hf.width,
      project.hf.height,
      iframeRect && iframeRect.width > 0 && iframeRect.height > 0 ? iframeRect : null,
    );
    lastStageGeometryRef.current = geometry;
    return geometry;
  })();
  const motionPaths =
    stageEditableClip && stageGeometry
      ? getStageMotionPaths(stageEditableClip, selectedKeyframe, stageGeometry, drag)
      : [];
  const snapGuides = drag?.type === "move" ? drag.snapGuides : moveableSnapGuides;
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
  // react-moveable owns the selected clip's move/resize/rotate chrome for the base-property
  // case (single unlocked clip, no keyframe selected, not playing). Its imperative control
  // box replaces the hand-rolled handles below and removes the per-frame Stage re-render.
  // Keyframe/motion-path editing still routes through the legacy handles for now.
  const useMoveable =
    !!stageEditableClip &&
    !selectedClip?.locked &&
    !selectedKeyframe &&
    !isPlaying &&
    !multiSelected &&
    !marquee &&
    !!outlineRect &&
    !!stageGeometry;
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
    dragDriverRef.current = "window";
    setDrag(null);
  }, []);

  // The single entry point for a base-transform edit (move/resize/rotate/flip). Live-applies the
  // patch through the one player-editing dispatch, and on `persist` commits the same values to
  // rootHtml with reload suppressed (the element already shows them). Both the legacy drag handlers
  // and the react-moveable overlay route through this, so preview and commit can never diverge.
  // Keyframe-targeted edits keep their own paths for now (they need a real reload + scale mapping).
  const applyStageEdit = useCallback(
    (clipId: string, patch: StageTransformPatch, opts: { persist: boolean; history?: boolean }) => {
      const appliedLive = liveApplyStagePatch(
        iframeRef.current,
        clipId,
        patch,
        opts.persist ? "commit" : "preview",
      );
      if (!opts.persist) return;
      if (appliedLive) suppressReloadRef.current = true;
      activateClipScene(clipId);
      updateClip(clipId, patch, opts.history === undefined ? undefined : { history: opts.history });
    },
    [activateClipScene, iframeRef, updateClip],
  );

  // Snap a single clip's proposed move against canvas + sibling edges, reusing the exact targets and
  // snapCompositionRect that the legacy handle drag uses — so react-moveable drags snap identically.
  // Returns the snapped position plus the guides to draw. The guide side effect is left to the
  // caller (StageMoveable) so this stays a pure query.
  const snapClipMove = useCallback(
    (clipId: string, rect: CompositionRect): { x: number; y: number; guides: StageSnapGuide[] } => {
      if (!project || !stageGeometry) return { x: rect.x, y: rect.y, guides: [] };
      const targets = buildMoveSnapTargets(clips, project.hf.width, project.hf.height, clipId);
      const result = snapCompositionRect(
        rect,
        targets,
        STAGE_SNAP_THRESHOLD_PX * Math.max(stageGeometry.scaleX, stageGeometry.scaleY),
      );
      return { x: result.rect.x, y: result.rect.y, guides: result.guides };
    },
    [clips, project, stageGeometry],
  );

  // Snap a whole group's move: snap the selection's bounding box against everything OUTSIDE the
  // selection, and return the single delta to apply uniformly to every member (so the group stays
  // rigid while its box snaps). Same targets/threshold as the single-clip path.
  const snapGroupMove = useCallback(
    (
      selectedIds: string[],
      bbox: CompositionRect,
      rawDelta: { x: number; y: number },
    ): { dx: number; dy: number; guides: StageSnapGuide[] } => {
      if (!project || !stageGeometry) return { dx: rawDelta.x, dy: rawDelta.y, guides: [] };
      const selected = new Set(selectedIds);
      const targets = buildMoveSnapTargets(
        clips.filter((clip) => !selected.has(clip.id)),
        project.hf.width,
        project.hf.height,
        "",
      );
      const proposed = {
        x: bbox.x + rawDelta.x,
        y: bbox.y + rawDelta.y,
        width: bbox.width,
        height: bbox.height,
      };
      const result = snapCompositionRect(
        proposed,
        targets,
        STAGE_SNAP_THRESHOLD_PX * Math.max(stageGeometry.scaleX, stageGeometry.scaleY),
      );
      return { dx: result.rect.x - bbox.x, dy: result.rect.y - bbox.y, guides: result.guides };
    },
    [clips, project, stageGeometry],
  );

  // Moveable gestures freeze geometry while in flight; on release we also drop any snap guides they
  // drew, so a guide never lingers after the drag that produced it.
  const handleMoveableInteractingChange = useCallback((interacting: boolean) => {
    setMoveableInteracting(interacting);
    if (!interacting) setMoveableSnapGuides([]);
  }, []);

  // ─── Move preview/commit (shared by the Move handle and canvas body-drag) ─────
  const previewMoveDrag = useCallback(
    (currentDrag: Extract<NonNullable<StageDrag>, { type: "move" }>, event: PointerEvent) => {
      const delta = pointerDeltaToComposition(
        event.clientX - currentDrag.startClientX,
        event.clientY - currentDrag.startClientY,
        currentDrag.geometry,
      );
      const preview = getMovePreview(currentDrag, delta, !event.altKey);
      const nextX = preview.previewX;
      const nextY = preview.previewY;
      applyStageEdit(currentDrag.clipId, { x: nextX, y: nextY }, { persist: false });
      queueDragPreview({
        ...currentDrag,
        previewX: nextX,
        previewY: nextY,
        snapGuides: preview.snapGuides,
      });
    },
    [applyStageEdit, queueDragPreview],
  );

  const commitMoveDrag = useCallback(
    (currentDrag: Extract<NonNullable<StageDrag>, { type: "move" }>, event: PointerEvent) => {
      const delta = pointerDeltaToComposition(
        event.clientX - currentDrag.startClientX,
        event.clientY - currentDrag.startClientY,
        currentDrag.geometry,
      );
      const preview = getMovePreview(currentDrag, delta, !event.altKey);
      const nextX = preview.previewX;
      const nextY = preview.previewY;
      // Prefer the drag's own keyframeId (set when starting from a path dot)
      // so we route correctly even if selectKeyframe hasn't propagated yet.
      const keyframeTarget = currentDrag.keyframeId
        ? findKeyframeTargetById(currentDrag.clipId, currentDrag.keyframeId, "position", clips)
        : getStageKeyframeTarget(currentDrag.clipId, "position", selectedKeyframe, clips);
      const moved =
        Math.abs(nextX - currentDrag.startX) > 0.5 || Math.abs(nextY - currentDrag.startY) > 0.5;
      // For a tap-to-select on a dot (no movement), skip the no-op commit so we don't pollute
      // undo history.
      if (keyframeTarget) {
        if (moved) {
          // Keyframe edits change the GSAP timeline and need a real reload — live-apply for
          // instant feedback, but persist through updateClipKeyframe (not applyStageEdit).
          liveApplyStagePatch(
            iframeRef.current,
            currentDrag.clipId,
            { x: nextX, y: nextY },
            "commit",
          );
          updateClipKeyframe(keyframeTarget.selection, { x: nextX, y: nextY });
        }
      } else if (moved) {
        applyStageEdit(currentDrag.clipId, { x: nextX, y: nextY }, { persist: true });
      }
      clearDrag();
    },
    [applyStageEdit, clearDrag, clips, iframeRef, selectedKeyframe, updateClipKeyframe],
  );

  // ─── Figma-style canvas select/drag (project-wide model) ─────────────────────
  // Locked clips are excluded from canvas hit-testing — clicks fall through to the clip
  // beneath them. They stay selectable from the timeline layer list so they can be
  // unlocked. Selection two-way-syncs with the timeline through `selectedClipId`.
  const lockedClipIds = useMemo(
    () => new Set(clips.filter((clip) => clip.locked).map((clip) => clip.id)),
    [clips],
  );

  // Begin a canvas body-drag. Reuses the same drag state + window preview/commit effect
  // as the Move handle (so snapping, keyframe routing, and undo all behave identically);
  // the controller drives the move through the returned session.
  const beginBodyMove = useCallback(
    (clipId: string, down: PointerEventLike): MoveSession | null => {
      if (!project || !stageShellRef.current) return null;
      const clip = clips.find((candidate) => candidate.id === clipId);
      if (!clip || clip.locked || clip.kind === "audio") return null;
      const iframe = resolveIframe(playerRef.current);
      const geometry = getStageGeometry(
        stageShellRef.current,
        project.hf.width,
        project.hf.height,
        iframe?.getBoundingClientRect() ?? null,
      );
      dragDriverRef.current = "controller";
      beginDrag({
        type: "move",
        clipId,
        pointerId: down.pointerId,
        startClientX: down.clientX,
        startClientY: down.clientY,
        startX: clip.x,
        startY: clip.y,
        width: clip.width,
        height: clip.height,
        previewX: clip.x,
        previewY: clip.y,
        snapTargets: buildMoveSnapTargets(clips, project.hf.width, project.hf.height, clipId),
        snapGuides: [],
        geometry,
      });
      return {
        move: (event) => {
          const current = dragRef.current;
          if (current?.type === "move") previewMoveDrag(current, event);
        },
        end: (event) => {
          const current = dragRef.current;
          if (current?.type === "move") commitMoveDrag(current, event);
          else clearDrag();
        },
      };
    },
    [beginDrag, clearDrag, clips, commitMoveDrag, previewMoveDrag, project],
  );

  const onCanvasPointerDown = useSelectDrag({
    hitTest: (down) =>
      hitTestClipIdsAtPoint(down.target, down.clientX, down.clientY, clipIds, (id) =>
        lockedClipIds.has(id),
      ),
    getSelectedId: () => selectedClipId,
    selectId: (id, additive) => {
      if (additive) {
        if (id) toggleClipInSelection(id);
      } else {
        selectStageClip(id);
      }
    },
    beginMove: beginBodyMove,
    beginMarquee: (down, additive) => {
      const shell = stageShellRef.current;
      const geometry = stageGeometry;
      if (!shell || !geometry) return null;
      const shellRect = shell.getBoundingClientRect();
      const startX = down.clientX - shellRect.left;
      const startY = down.clientY - shellRect.top;
      // Snapshot the selectable clip rects (shell-local) once — clips don't move during a marquee,
      // so the intersection set only depends on the sweeping band, not on live geometry. Locked
      // clips are excluded to match click hit-testing (they can't be selected there either).
      const targets = stageClickTargets
        .filter((target) => !lockedClipIds.has(target.id))
        .map((target) => ({
          id: target.id,
          rect: compositionRectToCss(target, geometry),
        }));
      // Additive marquee unions with the selection present when the sweep began.
      const base = additive ? effectiveSelectedIds : [];
      const apply = (clientX: number, clientY: number) => {
        const curX = clientX - shellRect.left;
        const curY = clientY - shellRect.top;
        const box = {
          left: Math.min(startX, curX),
          top: Math.min(startY, curY),
          width: Math.abs(curX - startX),
          height: Math.abs(curY - startY),
        };
        setMarquee(box);
        selectClips([...base, ...marqueeHitIds(box, targets)]);
      };
      return {
        move: (ev) => apply(ev.clientX, ev.clientY),
        end: (ev) => {
          apply(ev.clientX, ev.clientY);
          setMarquee(null);
        },
      };
    },
    capturePointer: (down, pointerId) => {
      // Capture on the overlay element under the pointer (never the stage shell) so
      // pointermoves keep arriving even over the player iframe, while the synthesized
      // `click` still targets the overlay — not the shell, whose onClick would otherwise
      // deselect the clip we just selected.
      try {
        const target = down.target instanceof Element ? down.target : null;
        target?.setPointerCapture(pointerId);
      } catch {
        /* pointer capture is best-effort */
      }
    },
  });

  // Resolve asset URLs and serve the complete preview HTML through srcdoc.
  // Blob URLs cannot be passed through `src`: the player appends shader query
  // params to `src`, which changes object URLs and breaks loading.
  //
  // Keyed on `project.hf` (the rendered film), NOT the whole `project`. Setting a
  // new `srcdoc` fully reloads the iframe document (black flash + GSAP re-boot), so
  // we must only do it when the rendered output actually changed. `saveProject`
  // bumps `project` with `{ ...p, updatedAt }` but shares the same `hf` reference, and
  // selection/keyframe-selection live outside `project` entirely — none of those touch
  // `hf`, so none of them reload. The latest `project` is read at resolve time.
  const projectHf = rootProject?.hf;
  useEffect(() => {
    const state = useStudio.getState();
    // The whole film, never a single scene — this is what makes playback cross
    // scene boundaries instead of stopping at the active scene's end.
    const current = state.project;
    if (!current) {
      setResolvedHtml(null);
      setPreviewError(null);
      return;
    }
    if (repairTimelineLanes()) return;
    // A base-property stage edit already updated the live iframe; don't reload it.
    if (suppressReloadRef.current) {
      suppressReloadRef.current = false;
      return;
    }
    let alive = true;
    setPreviewError(null);
    void resolvePreviewHtml(current)
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
    // Deliberately not keyed on `activeSceneId`: switching the editing scope must
    // not reload the preview, because the preview already holds every scene.
  }, [projectHf, repairTimelineLanes]);

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
    if (drag || moveableInteracting) return;

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
  }, [
    activeHandleClip,
    drag,
    moveableInteracting,
    iframeRef,
    selectedKeyframe,
    stageEditableClip,
    resolvedHtml,
  ]);

  const measureRenderedClickRects = useCallback(() => {
    if (!resolvedHtml) {
      setRenderedClickRects((currentRects) =>
        currentRects.size === 0 ? currentRects : new Map<string, DOMRect>(),
      );
      return;
    }

    const iframe = iframeRef.current ?? resolveIframe(playerRef.current);
    if (!iframe) {
      setRenderedClickRects((currentRects) =>
        currentRects.size === 0 ? currentRects : new Map<string, DOMRect>(),
      );
      return;
    }

    const nextRects = new Map<string, DOMRect>();
    for (const clip of clips) {
      if (clip.kind === "audio") continue;
      const rect = getRenderedElementRect(iframe, clip.id);
      if (!rect) continue;
      nextRects.set(clip.id, new DOMRect(rect.left, rect.top, rect.width, rect.height));
    }

    setRenderedClickRects((currentRects) =>
      sameRectMap(currentRects, nextRects) ? currentRects : nextRects,
    );
  }, [clips, iframeRef, resolvedHtml]);

  useEffect(() => {
    if (!resolvedHtml) {
      setRenderedClickRects((currentRects) =>
        currentRects.size === 0 ? currentRects : new Map<string, DOMRect>(),
      );
      return;
    }
    // Suspend click-rect polling while dragging: it re-reads iframe rects and re-renders
    // the hit-test overlay every 200ms, competing with the gesture for layout/paint while
    // hit-testing is already paused under pointer capture. It resumes (and re-measures)
    // once the drag commits and the iframe settles.
    if (drag || moveableInteracting) return;

    let stopped = false;
    const measure = () => {
      if (!stopped) measureRenderedClickRects();
    };

    const frame = window.requestAnimationFrame(measure);
    const interval = window.setInterval(measure, 200);
    return () => {
      stopped = true;
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
    };
  }, [drag, moveableInteracting, measureRenderedClickRects, resolvedHtml]);

  useEffect(() => {
    if (!resolvedHtml || isPlaying) return;
    const frame = window.requestAnimationFrame(measureRenderedClickRects);
    return () => window.cancelAnimationFrame(frame);
  }, [currentTime, isPlaying, measureRenderedClickRects, resolvedHtml]);

  // Element picker — click in player iframe → select clip.
  const { pickedElement, enablePick, isPickMode } = useElementPicker(iframeRef, {
    workspaceFiles: project ? { "index.html": project.hf.rootHtml } : undefined,
    onSyncFiles: (files) => {
      // The picker edits the film root we handed it, so commit to the film root —
      // never into whichever scene composition happens to be the editing scope.
      if (files["index.html"]) updateRootHtml(files["index.html"], { scope: "film" });
    },
  });

  useEffect(() => {
    const clipId = getPickedClipId(iframeRef.current, pickedElement, clipIds);
    if (clipId) selectStageClip(clipId);
  }, [clipIds, iframeRef, pickedElement, selectStageClip]);

  useEffect(() => {
    if (!resolvedHtml) return;

    const cleanups = new Map<Document, () => void>();
    let stopped = false;

    const bindFrameDocument = (frame: HTMLIFrameElement, rootFrame: HTMLIFrameElement) => {
      const doc = frame.contentDocument;
      if (!doc || cleanups.has(doc)) return;
      const isRootFrame = frame === rootFrame;

      const pickFromEvent = (event: MouseEvent | PointerEvent) => {
        if ("button" in event && event.button !== 0) return;
        const ownerFrame = doc.defaultView?.frameElement;
        const clipId = resolveTargetClipId(event.target, clipIdsRef.current, ownerFrame);
        if (clipId) {
          selectStageClip(clipId);
          return;
        }
        if (isRootFrame) selectStageClip(null);
      };

      const handlePointerDown = (event: PointerEvent) => pickFromEvent(event);
      const handleClick = (event: MouseEvent) => pickFromEvent(event);

      doc.addEventListener("pointerdown", handlePointerDown, true);
      doc.addEventListener("click", handleClick, true);
      cleanups.set(doc, () => {
        doc.removeEventListener("pointerdown", handlePointerDown, true);
        doc.removeEventListener("click", handleClick, true);
      });
    };

    const bindAccessibleFrames = () => {
      if (stopped) return;
      const rootIframe = iframeRef.current ?? resolveIframe(playerRef.current);
      if (!rootIframe) return;
      if (iframeRef.current !== rootIframe) {
        (iframeRef as { current: HTMLIFrameElement | null }).current = rootIframe;
        onIframeLoad();
      }
      bindFrameDocument(rootIframe, rootIframe);
      for (const frame of rootIframe.contentDocument?.querySelectorAll("iframe") ?? []) {
        if (frame instanceof HTMLIFrameElement) bindFrameDocument(frame, rootIframe);
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
  }, [iframeRef, onIframeLoad, resolvedHtml, selectStageClip]);

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
    clipIdsRef.current = clipIds;
  }, [clipIds]);

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
      // Canvas body-drags are driven by the select/drag controller; the window pipeline
      // here only owns the Move handle, resize, and rotate gestures.
      if (dragDriverRef.current === "controller") return;
      if (currentDrag.type === "rotate") {
        const preview = getRotationPreview(
          currentDrag,
          event.clientX,
          event.clientY,
          event.shiftKey,
        );
        applyStageEdit(
          currentDrag.clipId,
          { rotation: preview.previewRotation },
          { persist: false },
        );
        queueDragPreview({ ...currentDrag, ...preview });
        return;
      }

      if (currentDrag.type === "move") {
        previewMoveDrag(currentDrag, event);
        return;
      }

      const delta = pointerDeltaToComposition(
        event.clientX - currentDrag.startClientX,
        event.clientY - currentDrag.startClientY,
        currentDrag.geometry,
      );
      const localDelta = compositionDeltaToLocal(delta.x, delta.y, currentDrag.rotation);
      // Resize preserves aspect ratio by default; hold Shift to resize freely.
      const preview = getResizePreview(currentDrag, localDelta.x, localDelta.y, !event.shiftKey);
      applyStageEdit(currentDrag.clipId, preview.previewClip, { persist: false });
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
        const keyframeTarget = getStageKeyframeTarget(
          currentDrag.clipId,
          "rotation",
          selectedKeyframe,
          clips,
        );
        if (keyframeTarget) {
          liveApplyStagePatch(
            iframeRef.current,
            currentDrag.clipId,
            { rotation: finalRotation },
            "commit",
          );
          updateClipKeyframe(keyframeTarget.selection, { rotation: finalRotation });
        } else {
          applyStageEdit(currentDrag.clipId, { rotation: finalRotation }, { persist: true });
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
        commitMoveDrag(currentDrag, event);
        return;
      }

      const localDelta = compositionDeltaToLocal(delta.x, delta.y, currentDrag.rotation);
      // Resize preserves aspect ratio by default; hold Shift to resize freely.
      const { previewClip } = getResizePreview(
        currentDrag,
        localDelta.x,
        localDelta.y,
        !event.shiftKey,
      );
      const finalClip = roundCompositionRect(previewClip);
      const keyframeTarget = getStageKeyframeTarget(
        currentDrag.clipId,
        "scale",
        selectedKeyframe,
        clips,
      );
      if (keyframeTarget) {
        // Keyframe resize maps the rect to a scale keyframe; live-apply the rect for feedback
        // (non-persisting preview), then persist the scale keyframe.
        liveApplyStagePatch(iframeRef.current, currentDrag.clipId, finalClip, "preview");
        updateClipKeyframe(keyframeTarget.selection, {
          scale: scaleForKeyframedResize(keyframeTarget.clip, finalClip),
        });
      } else {
        applyStageEdit(
          currentDrag.clipId,
          {
            x: finalClip.x,
            y: finalClip.y,
            width: finalClip.width,
            height: finalClip.height,
          },
          { persist: true },
        );
      }
      setRenderedElementRect(null);
      clearDrag();
    };

    const restoreDrag = (currentDrag: NonNullable<StageDrag>) => {
      // Revert the live element to its gesture-start transform (no store commit).
      if (currentDrag.type === "move") {
        liveApplyStagePatch(
          iframeRef.current,
          currentDrag.clipId,
          { x: currentDrag.startX, y: currentDrag.startY },
          "commit",
        );
        return;
      }

      if (currentDrag.type === "rotate") {
        liveApplyStagePatch(
          iframeRef.current,
          currentDrag.clipId,
          { rotation: currentDrag.startRotation },
          "commit",
        );
        return;
      }

      liveApplyStagePatch(iframeRef.current, currentDrag.clipId, currentDrag.startClip, "commit");
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
    applyStageEdit,
    clearDrag,
    clips,
    commitMoveDrag,
    iframeRef,
    previewMoveDrag,
    queueDragPreview,
    selectedKeyframe,
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
    selectStageClip(clipForDrag.id);
    selectKeyframe({ clipId: clipForDrag.id, keyframeId, property: "position" });

    const state = sampleClipKeyframedState(clipForDrag, keyframe.time);
    const scale = Math.max(0.01, state.scale);
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
      width: clipForDrag.width * scale,
      height: clipForDrag.height * scale,
      previewX: state.x,
      previewY: state.y,
      snapTargets: buildMoveSnapTargets(clips, project.hf.width, project.hf.height, clipForDrag.id),
      snapGuides: [],
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
    selectStageClip(clipForDrag.id);
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
    const scale = Math.max(0.01, state.scale);
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
      width: nextClip.width * scale,
      height: nextClip.height * scale,
      previewX: state.x,
      previewY: state.y,
      snapTargets: buildMoveSnapTargets(clips, project.hf.width, project.hf.height, clipForDrag.id),
      snapGuides: [],
      geometry,
    });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        selectStageClip(null);
        return;
      }

      const layerShortcut = getLayerShortcut(event);
      if (layerShortcut) {
        if (!isStageNudgeEventTarget(event.target)) return;
        const currentClip = stageEditableClipRef.current;
        if (!currentClip || currentClip.locked || dragRef.current) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        activateClipScene(currentClip.id);
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
      if (!currentClip || currentClip.locked || dragRef.current) return;

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
      if (keyframeTarget) {
        liveApplyStagePatch(iframeRef.current, currentClip.id, { x: nextX, y: nextY }, "commit");
        updateClipKeyframe(keyframeTarget.selection, { x: nextX, y: nextY }, { history: false });
        const nextProject = useStudio.getState().project;
        const nextClip = nextProject
          ? deriveEditorClips(nextProject).find((candidate) => candidate.id === currentClip.id)
          : null;
        stageEditableClipRef.current = nextClip ?? currentClip;
      } else {
        applyStageEdit(currentClip.id, { x: nextX, y: nextY }, { persist: true, history: false });
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
    activateClipScene,
    applyStageEdit,
    bringClipForward,
    bringClipToFront,
    checkpointHistory,
    iframeRef,
    selectStageClip,
    sendClipBackward,
    sendClipToBack,
    updateClipKeyframe,
  ]);

  if (!project) return null;

  return (
    <div
      ref={stageShellRef}
      // `isolate` gives the Stage its own stacking context so all its editor chrome stays
      // contained here — react-moveable's control box paints at z-index 3000, which would
      // otherwise escape to the root stacking context and punch through a full-screen modal
      // (character editor / presets). Containment is the fix; nothing needs to "stand down".
      className="absolute inset-0 isolate overflow-hidden bg-stage-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) selectStageClip(null);
      }}
      onDragOver={(event) => {
        if (!hasLibraryDragItem(event.dataTransfer)) return;
        // Required for the drop to fire at all, and it also stops the browser
        // from navigating away when the payload happens to look like a URL.
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        if (!libraryDropActive) setLibraryDropActive(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setLibraryDropActive(false);
      }}
      onDrop={handleLibraryDrop}
    >
      {libraryDropActive && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[2500] flex items-start justify-center border-2 border-dashed border-primary bg-primary/10"
        >
          <span className="mt-4 rounded-full bg-primary px-3 py-1 text-ui-sm font-medium text-primary-foreground shadow">
            Drop to place it here
          </span>
        </div>
      )}
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
      {stageGeometry && (
        <StageClickOverlay
          clips={stageClickTargets}
          geometry={stageGeometry}
          onCanvasPointerDown={onCanvasPointerDown}
        />
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
      {snapGuides.length > 0 && stageGeometry && (
        <StageSnapGuideOverlay guides={snapGuides} geometry={stageGeometry} />
      )}
      {stageGeometry &&
        multiSelectionTargets.map((target) => {
          const rect = compositionRectToCss(target, stageGeometry);
          return (
            <div
              key={target.id}
              data-stage-multi-selection=""
              className="pointer-events-none absolute z-30 border border-primary/80"
              style={{
                left: rect.left,
                top: rect.top,
                width: Math.max(1, rect.width),
                height: Math.max(1, rect.height),
                transform: `rotate(${target.rotation}deg)`,
                transformOrigin: "center center",
              }}
            />
          );
        })}
      {marquee && (
        <div
          data-stage-marquee=""
          className="pointer-events-none absolute z-40 border border-primary/70 bg-primary/10"
          style={{
            left: marquee.left,
            top: marquee.top,
            width: Math.max(1, marquee.width),
            height: Math.max(1, marquee.height),
          }}
        />
      )}
      {multiSelected &&
        stageGeometry &&
        !selectedKeyframe &&
        !isPlaying &&
        !marquee &&
        groupMoveableClips.length > 1 && (
          <StageGroupMoveable
            clips={groupMoveableClips}
            geometry={stageGeometry}
            applyEdit={applyStageEdit}
            checkpoint={checkpointHistory}
            snapGroupMove={snapGroupMove}
            onSnapGuidesChange={setMoveableSnapGuides}
            onInteractingChange={handleMoveableInteractingChange}
          />
        )}
      {useMoveable && stageEditableClip && outlineRect && stageGeometry && (
        <StageMoveable
          key={stageEditableClip.id}
          clip={{
            id: stageEditableClip.id,
            x: stageEditableClip.x,
            y: stageEditableClip.y,
            width: stageEditableClip.width,
            height: stageEditableClip.height,
            rotation: stageEditableClip.rotation,
            scaleX: stageEditableClip.scaleX ?? 1,
            scaleY: stageEditableClip.scaleY ?? 1,
          }}
          screenRect={outlineRect}
          geometry={stageGeometry}
          applyEdit={(patch, opts) => applyStageEdit(stageEditableClip.id, patch, opts)}
          snapMove={(rect) => snapClipMove(stageEditableClip.id, rect)}
          onSnapGuidesChange={setMoveableSnapGuides}
          onInteractingChange={handleMoveableInteractingChange}
        />
      )}
      {outlineRect && !useMoveable && !marquee && (
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
          {!selectedClip?.locked && (
            <>
              <SelectionCorner handle="nw" onPointerDown={startResize} />
              <SelectionCorner handle="ne" onPointerDown={startResize} />
              <SelectionCorner handle="sw" onPointerDown={startResize} />
              <SelectionCorner handle="se" onPointerDown={startResize} />
            </>
          )}
        </div>
      )}
      {outlineRect && selectedMotionEndpoint && (
        <div
          className="pointer-events-none absolute z-40 rounded-full border border-primary/40 bg-panel/95 px-2 py-0.5 text-ui-sm font-medium text-foreground shadow-[0_2px_10px_rgba(0,0,0,0.28)]"
          style={{
            left: outlineRect.left,
            top: Math.max(4, outlineRect.top - 28),
          }}
        >
          {selectedMotionEndpoint.motion.label} {selectedMotionEndpoint.endpointLabel}
        </div>
      )}
      {outlineRect &&
        !useMoveable &&
        !marquee &&
        rotateHandleStyle &&
        stageEditableClip &&
        activeHandleClip &&
        !selectedClip?.locked && (
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
          className="pointer-events-none absolute z-40 rounded-full border border-border bg-panel/95 px-2 py-0.5 text-ui-sm font-medium text-foreground shadow-[0_2px_10px_rgba(0,0,0,0.28)]"
          style={rotationPillStyle}
        >
          {Math.round(previewRotation)}°
        </div>
      )}
      {outlineRect &&
        !useMoveable &&
        !marquee &&
        moveHandleStyle &&
        stageEditableClip &&
        activeHandleClip &&
        !selectedClip?.locked && (
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
                width: activeHandleClip.width,
                height: activeHandleClip.height,
                previewX: activeHandleClip.x,
                previewY: activeHandleClip.y,
                snapTargets: buildMoveSnapTargets(
                  clips,
                  project.hf.width,
                  project.hf.height,
                  stageEditableClip.id,
                ),
                snapGuides: [],
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
