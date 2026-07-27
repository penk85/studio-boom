// Timeline — multi-track strip with draggable clips, ruler, playhead.
import { Lock, Minus, SkipBack, Unlock } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { PlayerControls, liveTime, usePlayerStore } from "@hyperframes/studio";
import { db, uid } from "../db";
import { useStudio, type ProjectMutationOptions } from "../store";
import { useHfMediaHealth } from "../hooks/useHfMediaHealth";
import type { CompositionOutlineItem } from "../hyperframes/composition-outline";
import type { MotionPreset, AnyClip, CompositionClip } from "../types";
import {
  deriveProjectScenes,
  deriveProjectTimelineClips,
  type ProjectTimelineClip,
} from "../scenes";
import { isCharacterCompositionClip } from "../types";
import { fmtTime } from "../timeline-utils";
import { TimelineClipBlock } from "./TimelineClipBlock";
import { SceneBoundaryOverlay, SceneStrip, TimelineRuler } from "./TimelineSceneStrip";
import { CLIP_DRAG_THRESHOLD_PX, RULER_HEIGHT, TRACK_HEIGHT } from "./timeline-constants";
import {
  buildCompositionOutlines,
  buildCompositionSourceErrors,
  isKeyframeEditableClip,
  toSceneLocalClipPatch,
} from "./timeline-clip-utils";
import {
  buildExpandedClipLayout,
  buildTrackLayout,
  type ExpandedClipLayout,
  type TimelineCharacterClip,
} from "./timeline-layout";
import { CompositionOutlineHeader, CompositionOutlineLaneSet } from "./TimelineCompositionOutline";
import { VisualMotionLaneHeader, VisualMotionLaneSet } from "./TimelineVisualMotionTracks";
import { CharacterMotionHeader, MotionLaneSet } from "./TimelineCharacterTracks";
const SEEK_DRAG_EDGE_ZONE_PX = 40;
const SEEK_DRAG_MAX_SCROLL_PX = 12;

interface TimelineProps {
  togglePlay: () => void;
  seek: (time: number) => void;
}

export function Timeline({ togglePlay, seek }: TimelineProps) {
  const rootProject = useStudio((s) => s.project);
  const activeSceneId = useStudio((s) => s.activeSceneId);
  const project = rootProject;
  const timelineReady = usePlayerStore((s) => s.timelineReady);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const clips = useMemo(
    () => (rootProject ? deriveProjectTimelineClips(rootProject) : []),
    [rootProject],
  );
  const tracks = useStudio((s) => s.tracks);
  const zoom = useStudio((s) => s.zoom);
  const setZoom = useStudio((s) => s.setZoom);
  const selectedId = useStudio((s) => s.selectedClipId);
  const selectClip = useStudio((s) => s.selectClip);
  const updateClip = useStudio((s) => s.updateClip);
  const removeClip = useStudio((s) => s.removeClip);
  const setActiveScene = useStudio((s) => s.setActiveScene);
  const addScene = useStudio((s) => s.addScene);
  const duplicateScene = useStudio((s) => s.duplicateScene);
  const removeScene = useStudio((s) => s.removeScene);
  const moveScene = useStudio((s) => s.moveScene);
  const resizeScene = useStudio((s) => s.resizeScene);
  const addLane = useStudio((s) => s.addLane);
  const setTrackLock = useStudio((s) => s.setTrackLock);
  const removeLane = useStudio((s) => s.removeLane);
  const checkpointHistory = useStudio((s) => s.checkpointHistory);
  const selectedKeyframe = useStudio((s) => s.selectedKeyframe);
  const selectKeyframe = useStudio((s) => s.selectKeyframe);
  const addClipMotionStep = useStudio((s) => s.addClipMotionStep);
  const addClipMotionCheckpoint = useStudio((s) => s.addClipMotionCheckpoint);
  const moveClipMotionStep = useStudio((s) => s.moveClipMotionStep);
  const moveClipMotionCheckpoint = useStudio((s) => s.moveClipMotionCheckpoint);
  const removeClipMotionStep = useStudio((s) => s.removeClipMotionStep);
  const moveSpeech = useStudio((s) => s.moveSpeech);
  const trimSpeech = useStudio((s) => s.trimSpeech);
  const openSpeechSettings = useStudio((s) => s.openSpeechSettings);
  const removeSpeech = useStudio((s) => s.removeSpeech);

  const playheadRef = useRef<HTMLDivElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const sceneScrollerRef = useRef<HTMLDivElement>(null);
  const timelineTimeOffsetRef = useRef(0);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  useEffect(() => {
    const update = (t: number) => {
      const projectTime = t + timelineTimeOffsetRef.current;
      if (playheadRef.current)
        playheadRef.current.style.left = `${projectTime * zoomRef.current}px`;
      if (timeDisplayRef.current) timeDisplayRef.current.textContent = fmtTime(projectTime);
    };
    const unsub = liveTime.subscribe(update);
    update(usePlayerStore.getState().currentTime);
    return () => {
      unsub();
    };
  }, []);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const headerTracksRef = useRef<HTMLDivElement>(null);
  const seekDragRef = useRef(false);
  const seekDragPointerIdRef = useRef<number | null>(null);
  const seekDragClientXRef = useRef<number | null>(null);
  const seekDragScrollFrameRef = useRef<number | null>(null);
  const [expandedClipIds, setExpandedClipIds] = useState<Set<string>>(new Set());
  const [selectedMotionId, setSelectedMotionId] = useState<string | null>(null);
  const queriedPresets = useLiveQuery(() => db.motionPresets.toArray(), []);
  const storePresetMap = useStudio((s) => s.motionPresets);
  const presets = useMemo(() => queriedPresets ?? [], [queriedPresets]);
  const presetMap = useMemo(() => {
    const merged = new Map(presets.map((p) => [p.id, p] as const));
    for (const [id, preset] of storePresetMap) merged.set(id, preset);
    return merged;
  }, [presets, storePresetMap]);
  const mediaAssets = useStudio((s) => s.mediaAssets);
  const mediaHealth = useHfMediaHealth(rootProject?.hf);
  const projectDuration = rootProject?.hf.duration ?? 0;
  const scenes = useMemo(
    () => (rootProject ? deriveProjectScenes(rootProject) : []),
    [rootProject],
  );
  const activeSceneStart = scenes.find((scene) => scene.id === activeSceneId)?.start ?? 0;
  timelineTimeOffsetRef.current = activeSceneStart;
  const projectCurrentTime = currentTime + activeSceneStart;
  useEffect(() => {
    if (playheadRef.current) playheadRef.current.style.left = `${projectCurrentTime * zoom}px`;
    if (timeDisplayRef.current) timeDisplayRef.current.textContent = fmtTime(projectCurrentTime);
  }, [projectCurrentTime, zoom]);
  const compositionOutlinesByClipId = useMemo(
    () =>
      rootProject
        ? buildCompositionOutlines(rootProject, clips)
        : new Map<string, CompositionOutlineItem[]>(),
    [rootProject, clips],
  );

  const seekProjectTime = useCallback(
    (projectTime: number) => {
      const boundedTime = Math.max(0, Math.min(projectDuration, projectTime));
      const scene =
        scenes.find(
          (candidate) =>
            boundedTime >= candidate.start &&
            boundedTime < candidate.start + candidate.duration - 0.0001,
        ) ??
        [...scenes]
          .reverse()
          .find(
            (candidate) =>
              boundedTime >= candidate.start && boundedTime <= candidate.start + candidate.duration,
          );
      if (!scene) {
        setActiveScene(null);
        timelineTimeOffsetRef.current = 0;
        liveTime.notify(boundedTime);
        seek(boundedTime);
        return;
      }

      const localTime = Math.max(0, Math.min(scene.duration, boundedTime - scene.start));
      if (activeSceneId !== scene.id) setActiveScene(scene.id);
      timelineTimeOffsetRef.current = scene.start;
      liveTime.notify(localTime);
      seek(localTime);
    },
    [activeSceneId, projectDuration, scenes, seek, setActiveScene],
  );

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const scroller = scrollerRef.current;
      if (!scroller || !timelineReady || projectDuration <= 0) return;
      const rect = scroller.getBoundingClientRect();
      const x = clientX - rect.left + scroller.scrollLeft;
      const nextTime = Math.max(0, Math.min(projectDuration, x / Math.max(zoomRef.current, 1)));
      seekProjectTime(nextTime);
    },
    [projectDuration, seekProjectTime, timelineReady],
  );

  const stepSeekDragAutoScroll = useCallback(() => {
    seekDragScrollFrameRef.current = null;
    const scroller = scrollerRef.current;
    const clientX = seekDragClientXRef.current;
    if (
      !scroller ||
      clientX == null ||
      !seekDragRef.current ||
      scroller.scrollWidth <= scroller.clientWidth
    ) {
      return;
    }

    const rect = scroller.getBoundingClientRect();
    let scrollDelta = 0;
    if (clientX < rect.left + SEEK_DRAG_EDGE_ZONE_PX) {
      const proximity = Math.max(0, 1 - (clientX - rect.left) / SEEK_DRAG_EDGE_ZONE_PX);
      scrollDelta = -SEEK_DRAG_MAX_SCROLL_PX * proximity;
    } else if (clientX > rect.right - SEEK_DRAG_EDGE_ZONE_PX) {
      const proximity = Math.max(0, 1 - (rect.right - clientX) / SEEK_DRAG_EDGE_ZONE_PX);
      scrollDelta = SEEK_DRAG_MAX_SCROLL_PX * proximity;
    }

    if (scrollDelta === 0) return;
    scroller.scrollLeft += scrollDelta;
    seekFromClientX(clientX);
    seekDragScrollFrameRef.current = window.requestAnimationFrame(stepSeekDragAutoScroll);
  }, [seekFromClientX]);

  const autoScrollDuringSeekDrag = useCallback(
    (clientX: number) => {
      seekDragClientXRef.current = clientX;
      if (seekDragScrollFrameRef.current !== null) return;
      seekDragScrollFrameRef.current = window.requestAnimationFrame(stepSeekDragAutoScroll);
    },
    [stepSeekDragAutoScroll],
  );

  const stopSeekDrag = useCallback(() => {
    seekDragRef.current = false;
    seekDragPointerIdRef.current = null;
    seekDragClientXRef.current = null;
    if (seekDragScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(seekDragScrollFrameRef.current);
      seekDragScrollFrameRef.current = null;
    }
  }, []);

  const startSeekDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, options?: { force?: boolean }) => {
      if (event.button !== 0 || !timelineReady) return;
      if (!options?.force && !isTimelineSeekTarget(event.target)) return;

      if (options?.force) {
        event.preventDefault();
        event.stopPropagation();
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      seekDragRef.current = true;
      seekDragPointerIdRef.current = event.pointerId;
      seekFromClientX(event.clientX);
      autoScrollDuringSeekDrag(event.clientX);
    },
    [autoScrollDuringSeekDrag, seekFromClientX, timelineReady],
  );

  const handleSeekPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!seekDragRef.current || seekDragPointerIdRef.current !== event.pointerId) return;
      seekFromClientX(event.clientX);
      autoScrollDuringSeekDrag(event.clientX);
    },
    [autoScrollDuringSeekDrag, seekFromClientX],
  );

  const handleSeekPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (seekDragPointerIdRef.current !== event.pointerId) return;
      stopSeekDrag();
    },
    [stopSeekDrag],
  );

  useEffect(() => stopSeekDrag, [stopSeekDrag]);

  if (!project || !rootProject) return null;
  const totalWidth = Math.max(1200, rootProject.hf.duration * zoom);
  const timelineClips = clips;
  const compositionSourceErrorsByClipId = buildCompositionSourceErrors(rootProject, timelineClips);
  const expandedCompositionOutlines = clips.filter(
    (clip) =>
      clip.kind === "composition" &&
      !isCharacterCompositionClip(clip) &&
      expandedClipIds.has(clip.id) &&
      (compositionOutlinesByClipId.get(clip.id)?.length ?? 0) > 0,
  );
  const expandedMotionClips = clips.filter(
    (clip) =>
      isKeyframeEditableClip(clip) &&
      // Character clips use the richer character expansion (voice + motion
      // groups) below — don't also give them the generic motion lane, which
      // would duplicate the parent-name header.
      !isCharacterCompositionClip(clip) &&
      !(
        clip.kind === "composition" && (compositionOutlinesByClipId.get(clip.id)?.length ?? 0) > 0
      ) &&
      expandedClipIds.has(clip.id),
  );
  const expandedCharacters = clips.filter(
    (clip): clip is TimelineCharacterClip =>
      isCharacterCompositionClip(clip) && expandedClipIds.has(clip.id),
  );
  const expandedLayouts = new Map<string, ExpandedClipLayout>(
    expandedCharacters.map(
      (clip) => [clip.id, buildExpandedClipLayout(clip, presetMap, mediaAssets)] as const,
    ),
  );
  const trackLayouts = tracks.map((track, trackIndex) =>
    buildTrackLayout({
      trackIndex,
      laneCount: Math.max(1, track.lanes ?? 1),
      expandedMotionClips,
      expandedCompositionOutlines,
      compositionOutlinesByClipId,
      expandedCharacters,
      expandedLayouts,
    }),
  );
  const trackHeight = (trackIndex: number) => {
    return trackLayouts[trackIndex]?.height ?? TRACK_HEIGHT;
  };
  const laneHasClip = (trackIndex: number, laneIndex: number) =>
    timelineClips.some(
      (clip) => clip.trackIndex === trackIndex && (clip.laneIndex ?? 0) === laneIndex,
    );
  const activateTimelineClip = (clip: ProjectTimelineClip) => {
    if (activeSceneId !== clip.sceneId) setActiveScene(clip.sceneId);
  };
  const updateTimelineClip = (
    clip: ProjectTimelineClip,
    patch: Partial<AnyClip>,
    options?: ProjectMutationOptions,
  ) => {
    activateTimelineClip(clip);
    updateClip(clip.id, toSceneLocalClipPatch(clip, patch), options);
  };
  const removeTimelineClip = (clip: ProjectTimelineClip) => {
    activateTimelineClip(clip);
    removeClip(clip.id);
  };
  const selectTimelineClip = (clip: ProjectTimelineClip) => {
    activateTimelineClip(clip);
    selectClip(clip.id);
  };
  const toggleExpandedClip = (id: string) => {
    setExpandedClipIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const syncHeaderScroll = () => {
    const scroller = scrollerRef.current;
    const headerTracks = headerTracksRef.current;
    if (!scroller || !headerTracks) return;
    headerTracks.style.transform = `translateY(${-scroller.scrollTop}px)`;
    if (
      sceneScrollerRef.current &&
      Math.abs(sceneScrollerRef.current.scrollLeft - scroller.scrollLeft) > 0.5
    ) {
      sceneScrollerRef.current.scrollLeft = scroller.scrollLeft;
    }
  };

  const syncTimelineScrollLeft = (scrollLeft: number) => {
    const scroller = scrollerRef.current;
    if (!scroller || Math.abs(scroller.scrollLeft - scrollLeft) <= 0.5) return;
    scroller.scrollLeft = scrollLeft;
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      {/* Transport */}
      <div className="flex items-center gap-2 border-b border-border px-2 py-1 text-xs">
        <button
          type="button"
          onClick={() => seek(0)}
          disabled={!timelineReady}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-panel-2 text-foreground hover:bg-panel disabled:cursor-not-allowed disabled:opacity-45"
          title="Stop and rewind"
          aria-label="Stop and rewind"
        >
          <SkipBack size={14} />
        </button>
        <PlayerControls onTogglePlay={togglePlay} onSeek={seek} />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="text-muted-foreground">
            <span ref={timeDisplayRef}>{fmtTime(0)}</span>
            {" / "}
            {fmtTime(rootProject.hf.duration)}
          </span>
          <span className="text-muted-foreground">Zoom</span>
          <input
            type="range"
            min={20}
            max={300}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-32 accent-[oklch(0.7_0.18_295)]"
          />
        </div>
      </div>

      <SceneStrip
        scenes={scenes}
        activeSceneId={activeSceneId}
        zoom={zoom}
        scrollRef={sceneScrollerRef}
        onScrollLeft={syncTimelineScrollLeft}
        onProjectView={() => setActiveScene(null)}
        onSelectScene={(sceneId) => setActiveScene(sceneId)}
        onAddScene={addScene}
        onDuplicateScene={duplicateScene}
        onRemoveScene={removeScene}
        onMoveScene={moveScene}
        onResizeScene={resizeScene}
        onHistoryCheckpoint={checkpointHistory}
      />

      {/* Track headers + tracks */}
      <div className="flex min-h-0 flex-1">
        <div
          className="w-40 shrink-0 overflow-hidden border-r border-border bg-panel-2"
          onWheel={(e) => {
            if (!scrollerRef.current) return;
            scrollerRef.current.scrollTop += e.deltaY;
          }}
        >
          <div style={{ height: RULER_HEIGHT }} className="border-b border-border" />
          <div ref={headerTracksRef} style={{ willChange: "transform" }}>
            {tracks.map((t, i) => {
              const layout = trackLayouts[i];
              const lanes = layout?.lanes ?? [];
              const lanePrefix =
                t.kind === "audio"
                  ? "A"
                  : t.kind === "background"
                    ? "BG"
                    : t.kind === "character"
                      ? "C"
                      : "V";
              return (
                <div
                  key={t.id}
                  style={{ height: trackHeight(i) }}
                  className={`flex flex-col border-b border-border ${i % 2 ? "bg-track-alt" : "bg-track"}`}
                >
                  <div className="flex items-center gap-2 px-3 text-xs" style={{ height: 18 }}>
                    <span
                      className={`h-2 w-2 rounded-full ${
                        t.kind === "background"
                          ? "bg-clip-bg"
                          : t.kind === "character"
                            ? "bg-clip-character"
                            : t.kind === "audio"
                              ? "bg-clip-audio"
                              : "bg-clip"
                      }`}
                    />
                    <span className="flex-1 truncate text-foreground">{t.name}</span>
                    <button
                      onClick={() => setTrackLock(i, !t.locked)}
                      title={
                        t.locked
                          ? "Unlock track (its clips ignore canvas clicks while locked)"
                          : "Lock track (its clips ignore canvas clicks and drags)"
                      }
                      className={`rounded p-0.5 leading-none hover:bg-panel ${
                        t.locked ? "text-primary" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t.locked ? <Lock size={11} /> : <Unlock size={11} />}
                    </button>
                    <button
                      onClick={() => addLane(i)}
                      title="Add a sub-track lane"
                      className="rounded border border-border px-1.5 text-[10px] leading-tight text-muted-foreground hover:bg-panel hover:text-foreground"
                    >
                      +
                    </button>
                  </div>
                  <div className="flex flex-1 flex-col">
                    {lanes.map((lane) => {
                      const hasClips = laneHasClip(i, lane.index);
                      const canRemove = lanes.length > 1 && !hasClips;
                      return (
                        <div key={lane.index}>
                          <div
                            style={{ height: TRACK_HEIGHT - (lane.index === 0 ? 18 : 0) }}
                            className="flex items-center gap-1 px-3 text-[10px] text-muted-foreground"
                          >
                            <span className="flex-1">
                              {lanePrefix}
                              {lane.index + 1}
                            </span>
                            {lanes.length > 1 && (
                              <button
                                type="button"
                                disabled={!canRemove}
                                onClick={() => canRemove && removeLane(i, lane.index)}
                                title={
                                  hasClips
                                    ? "Remove the clips on this lane before deleting it"
                                    : "Remove empty lane"
                                }
                                className="flex h-4 w-4 items-center justify-center rounded border border-border text-muted-foreground hover:bg-panel hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                              >
                                <Minus size={10} />
                              </button>
                            )}
                          </div>
                          {lane.visualMotionRows.map((row) => (
                            <VisualMotionLaneHeader key={`${row.clip.id}-motion`} clip={row.clip} />
                          ))}
                          {lane.compositionOutlineRows.map((row) => (
                            <CompositionOutlineHeader
                              key={`${row.clip.id}-contents`}
                              clip={row.clip}
                              outline={row.outline}
                            />
                          ))}
                          {lane.motionRows.map((row) => (
                            <CharacterMotionHeader
                              key={row.clip.id}
                              clip={row.clip}
                              layout={row.layout}
                            />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div
          ref={scrollerRef}
          onScroll={syncHeaderScroll}
          onPointerDown={startSeekDrag}
          onPointerMove={handleSeekPointerMove}
          onPointerUp={handleSeekPointerUp}
          onPointerCancel={handleSeekPointerUp}
          onLostPointerCapture={stopSeekDrag}
          data-timeline-seek-surface=""
          className="relative min-h-0 flex-1 overflow-auto"
        >
          <div style={{ width: totalWidth, position: "relative" }}>
            {/* Ruler */}
            <div
              className="sticky top-0 z-10 border-b border-border bg-panel-2"
              style={{ height: RULER_HEIGHT }}
            >
              <TimelineRuler duration={rootProject.hf.duration} zoom={zoom} />
            </div>

            <SceneBoundaryOverlay scenes={scenes} zoom={zoom} top={RULER_HEIGHT} />

            {/* Tracks */}
            {tracks.map((t, i) => {
              const layout = trackLayouts[i];
              const lanes = layout?.lanes ?? [];
              const laneTops = lanes.map((lane) => lane.top);
              return (
                <div
                  key={t.id}
                  style={{ height: trackHeight(i) }}
                  className={`relative border-b border-border ${i % 2 ? "bg-track-alt" : "bg-track"}`}
                >
                  {/* Grid */}
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 opacity-30"
                    style={{
                      backgroundImage: `linear-gradient(to right, var(--color-grid-line) 1px, transparent 1px)`,
                      backgroundSize: `${zoom}px 100%`,
                    }}
                  />
                  {/* Lane separators */}
                  {lanes.map((lane) => (
                    <div
                      key={lane.index}
                      aria-hidden
                      className="pointer-events-none absolute left-0 right-0 border-b border-border/50"
                      style={{ top: lane.top + TRACK_HEIGHT }}
                    />
                  ))}
                  {timelineClips
                    .filter((c) => c.trackIndex === i)
                    .map((c) => {
                      const laneIndex = Math.max(0, Math.min(lanes.length - 1, c.laneIndex ?? 0));
                      const laneTop = laneTops[laneIndex] ?? laneIndex * TRACK_HEIGHT;
                      const missingMediaIds = mediaHealth.missingAssetIdsByClipId.get(c.id) ?? [];
                      const compositionSourceErrors =
                        compositionSourceErrorsByClipId.get(c.id) ?? [];
                      return (
                        <TimelineClipBlock
                          key={c.id}
                          clip={c}
                          missingMediaIds={missingMediaIds}
                          compositionSourceErrors={compositionSourceErrors}
                          zoom={zoom}
                          selected={c.id === selectedId}
                          duration={rootProject.hf.duration}
                          laneTops={laneTops}
                          top={laneTop + 4}
                          presetMap={presetMap}
                          expanded={expandedClipIds.has(c.id)}
                          onToggleExpanded={() => toggleExpandedClip(c.id)}
                          onSelect={() => selectTimelineClip(c)}
                          onChange={(p, options) => updateTimelineClip(c, p, options)}
                          onHistoryCheckpoint={checkpointHistory}
                          onDelete={() => removeTimelineClip(c)}
                        />
                      );
                    })}
                  {lanes.flatMap((lane) =>
                    lane.visualMotionRows.map((row) => (
                      <VisualMotionLaneSet
                        key={`${row.clip.id}-motion`}
                        clip={row.clip}
                        zoom={zoom}
                        top={row.top}
                        currentTime={projectCurrentTime}
                        selectedKeyframe={selectedKeyframe}
                        onSelectClip={() => selectTimelineClip(row.clip)}
                        onSelectEndpoint={(selection, time) => {
                          activateTimelineClip(row.clip);
                          selectKeyframe(selection);
                          seek(row.clip.start + time);
                        }}
                        onAddMotion={(time) => {
                          activateTimelineClip(row.clip);
                          const selection = addClipMotionStep(row.clip.id, time);
                          if (selection) {
                            selectKeyframe(selection);
                            const state = useStudio.getState();
                            const nextProject = state.project;
                            const nextClip = nextProject
                              ? deriveProjectTimelineClips(nextProject).find(
                                  (candidate) => candidate.id === row.clip.id,
                                )
                              : null;
                            const keyframe = nextClip?.keyframes.find(
                              (candidate) => candidate.id === selection.keyframeId,
                            );
                            if (keyframe) seek(row.clip.start + keyframe.time);
                          }
                        }}
                        onMoveMotion={(motionId, patch) => {
                          activateTimelineClip(row.clip);
                          moveClipMotionStep(row.clip.id, motionId, patch, { history: false });
                        }}
                        onAddCheckpoint={(motionId, time) => {
                          activateTimelineClip(row.clip);
                          const selection = addClipMotionCheckpoint(row.clip.id, motionId, time);
                          if (selection) {
                            selectKeyframe(selection);
                            seek(row.clip.start + time);
                          }
                        }}
                        onMoveCheckpoint={(motionId, checkpointId, time) => {
                          activateTimelineClip(row.clip);
                          moveClipMotionCheckpoint(row.clip.id, motionId, checkpointId, time, {
                            history: false,
                          });
                        }}
                        onRemoveMotion={(motionId) => {
                          activateTimelineClip(row.clip);
                          removeClipMotionStep(row.clip.id, motionId);
                        }}
                        onSeekLocal={(time) => seek(row.clip.start + time)}
                        onHistoryCheckpoint={checkpointHistory}
                      />
                    )),
                  )}
                  {lanes.flatMap((lane) =>
                    lane.compositionOutlineRows.map((row) => (
                      <CompositionOutlineLaneSet
                        key={`${row.clip.id}-contents`}
                        clip={row.clip}
                        outline={row.outline}
                        zoom={zoom}
                        top={row.top}
                        onSelect={() => selectTimelineClip(row.clip)}
                      />
                    )),
                  )}
                  {lanes.flatMap((lane) =>
                    lane.motionRows.map((row) => (
                      <MotionLaneSet
                        key={row.clip.id}
                        clip={row.clip}
                        zoom={zoom}
                        top={row.top}
                        layout={row.layout}
                        selectedMotionId={selectedMotionId}
                        onSelect={() => selectTimelineClip(row.clip)}
                        onSelectMotion={setSelectedMotionId}
                        onChange={(motions) =>
                          updateTimelineClip(row.clip, {
                            character: { ...row.clip.character, motions },
                          } as Partial<CompositionClip>)
                        }
                        onMoveVoice={(speechId, start, options) => {
                          activateTimelineClip(row.clip);
                          moveSpeech(row.clip.id, speechId, start, options);
                        }}
                        onTrimVoice={(speechId, patch, options) => {
                          activateTimelineClip(row.clip);
                          trimSpeech(row.clip.id, speechId, patch, options);
                        }}
                        onOpenVoiceSettings={(speechId) => {
                          activateTimelineClip(row.clip);
                          openSpeechSettings(row.clip.id, speechId);
                        }}
                        onRemoveVoice={(speechId) => {
                          activateTimelineClip(row.clip);
                          removeSpeech(row.clip.id, speechId);
                        }}
                        onVoiceHistoryCheckpoint={checkpointHistory}
                        createMotionId={uid}
                        presetMap={presetMap}
                      />
                    )),
                  )}
                </div>
              );
            })}

            {/* Playhead — position updated imperatively via liveTime, not React re-renders */}
            <div
              ref={playheadRef}
              className="pointer-events-none absolute top-0 z-20"
              style={{
                left: 0,
                top: 0,
                bottom: 0,
                width: 2,
              }}
            >
              <div
                className="absolute bottom-0 top-0"
                style={{
                  left: 0,
                  width: 2,
                  background: "var(--color-playhead)",
                  boxShadow: "0 0 8px var(--color-playhead)",
                }}
              />
              <button
                type="button"
                data-timeline-playhead-handle=""
                aria-label="Drag playhead"
                className="pointer-events-auto absolute top-0 h-5 w-5 -translate-x-1/2 cursor-ew-resize touch-none rounded-sm border border-primary/60 bg-panel/95 shadow-[0_2px_8px_rgba(0,0,0,0.35)]"
                onPointerDown={(event) => startSeekDrag(event, { force: true })}
              >
                <span
                  aria-hidden="true"
                  className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-l-[6px] border-r-[6px] border-t-[7px] border-l-transparent border-r-transparent border-t-primary"
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function isTimelineSeekTarget(target: EventTarget | null) {
  const element = target instanceof Element ? target : null;
  if (!element) return true;
  return !element.closest(
    [
      "[data-timeline-clip-id]",
      "[data-timeline-motion-id]",
      "[data-motion-id]",
      "[data-motion-checkpoint-id]",
      "button",
      "input",
      "textarea",
      "select",
      "[role='button']",
      "[role='slider']",
      "[contenteditable='true']",
    ].join(", "),
  );
}
