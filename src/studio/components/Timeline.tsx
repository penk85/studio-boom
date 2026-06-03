// Timeline — multi-track strip with draggable clips, ruler, playhead.
import {
  ChevronDown,
  ChevronRight,
  Mic2,
  Minus,
  Plus,
  SkipBack,
  SlidersHorizontal,
  TriangleAlert,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
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
import { generateMotionOccurrences } from "../presets/apply";
import { resolveExclusiveMotionOverlaps } from "../presets/motion-scheduling";
import { useStudio, type ProjectMutationOptions } from "../store";
import { useHfMediaHealth } from "../hooks/useHfMediaHealth";
import {
  extractCompositionOutline,
  type CompositionOutlineItem,
} from "../hyperframes/composition-outline";
import { validateCompositionSourceHtml } from "../hyperframes/composition-source";
import { type ClipMotionCheckpoint, type ClipMotionEndpoint } from "../hyperframes/keyframes";
import type {
  MotionCategory,
  MotionPreset,
  AnyClip,
  AppliedMotion,
  CharacterCompositionClip,
  ClipKeyframeSelection,
  ClipMotionStep,
  CompositionClip,
  EditorClip,
  MediaAsset,
  Project,
} from "../types";
import { characterSpeeches, deriveEditorClips, isCharacterCompositionClip } from "../types";
import { fmtTime } from "../timeline-utils";

const TRACK_HEIGHT = 44;
const COMPOSITION_OUTLINE_PARENT_HEIGHT = 24;
const COMPOSITION_OUTLINE_ROW_HEIGHT = 26;
const VISUAL_MOTION_ROW_HEIGHT = 30;
const VISUAL_MOTION_PARENT_HEIGHT = 24;
const MOTION_ROW_HEIGHT = 28;
const MOTION_PARENT_HEIGHT = 24;
const RULER_HEIGHT = 28;
const CLIP_DRAG_THRESHOLD_PX = 4;
const SEEK_DRAG_EDGE_ZONE_PX = 40;
const SEEK_DRAG_MAX_SCROLL_PX = 12;
const MOTION_CATEGORY_ORDER: MotionCategory[] = [
  "expression",
  "headTurn",
  "gesture",
  "full-body",
  "camera",
  "custom",
];
const CATEGORY_LABELS: Record<MotionCategory, string> = {
  expression: "Expression",
  gesture: "Gesture",
  "full-body": "Full body",
  camera: "Camera",
  headTurn: "Head turn",
  custom: "Custom",
};
const CATEGORY_COLORS: Record<MotionCategory, string> = {
  expression: "bg-sky-500/75 border-sky-300/80",
  gesture: "bg-emerald-500/75 border-emerald-300/80",
  "full-body": "bg-amber-500/80 border-amber-300/80",
  camera: "bg-violet-500/75 border-violet-300/80",
  headTurn: "bg-fuchsia-500/75 border-fuchsia-300/80",
  custom: "bg-slate-400/75 border-slate-200/80",
};
const CATEGORY_DOT_COLORS: Record<MotionCategory, string> = {
  expression: "bg-sky-300",
  gesture: "bg-emerald-300",
  "full-body": "bg-amber-300",
  camera: "bg-violet-300",
  headTurn: "bg-fuchsia-300",
  custom: "bg-slate-300",
};

interface TimelineProps {
  togglePlay: () => void;
  seek: (time: number) => void;
}

export function Timeline({ togglePlay, seek }: TimelineProps) {
  const project = useStudio((s) => s.project);
  const timelineReady = usePlayerStore((s) => s.timelineReady);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const clips = useMemo(() => (project ? deriveEditorClips(project) : []), [project]);
  const tracks = useStudio((s) => s.tracks);
  const zoom = useStudio((s) => s.zoom);
  const setZoom = useStudio((s) => s.setZoom);
  const selectedId = useStudio((s) => s.selectedClipId);
  const selectClip = useStudio((s) => s.selectClip);
  const updateClip = useStudio((s) => s.updateClip);
  const removeClip = useStudio((s) => s.removeClip);
  const addLane = useStudio((s) => s.addLane);
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
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  useEffect(() => {
    const update = (t: number) => {
      if (playheadRef.current) playheadRef.current.style.left = `${t * zoomRef.current}px`;
      if (timeDisplayRef.current) timeDisplayRef.current.textContent = fmtTime(t);
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
  const presets = useMemo(() => queriedPresets ?? [], [queriedPresets]);
  const presetMap = useMemo(() => new Map(presets.map((p) => [p.id, p] as const)), [presets]);
  const mediaAssets = useStudio((s) => s.mediaAssets);
  const mediaHealth = useHfMediaHealth(project?.hf);
  const projectDuration = project?.hf.duration ?? 0;
  const compositionOutlinesByClipId = useMemo(
    () =>
      project
        ? buildCompositionOutlines(project, clips)
        : new Map<string, CompositionOutlineItem[]>(),
    [project, clips],
  );

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const scroller = scrollerRef.current;
      if (!scroller || !timelineReady || projectDuration <= 0) return;
      const rect = scroller.getBoundingClientRect();
      const x = clientX - rect.left + scroller.scrollLeft;
      const nextTime = Math.max(0, Math.min(projectDuration, x / Math.max(zoomRef.current, 1)));
      liveTime.notify(nextTime);
      seek(nextTime);
    },
    [projectDuration, seek, timelineReady],
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

  if (!project) return null;
  const totalWidth = Math.max(1200, project.hf.duration * zoom);
  const timelineClips = clips;
  const compositionSourceErrorsByClipId = buildCompositionSourceErrors(project, timelineClips);
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
    (clip): clip is CharacterCompositionClip =>
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
            {fmtTime(project.hf.duration)}
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
              <Ruler duration={project.hf.duration} zoom={zoom} />
            </div>

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
                        <ClipBlock
                          key={c.id}
                          clip={c}
                          missingMediaIds={missingMediaIds}
                          compositionSourceErrors={compositionSourceErrors}
                          zoom={zoom}
                          selected={c.id === selectedId}
                          tracks={tracks.length}
                          duration={project.hf.duration}
                          laneTops={laneTops}
                          top={laneTop + 4}
                          presetMap={presetMap}
                          expanded={expandedClipIds.has(c.id)}
                          onToggleExpanded={() => toggleExpandedClip(c.id)}
                          onSelect={() => selectClip(c.id)}
                          onChange={(p, options) => updateClip(c.id, p, options)}
                          onHistoryCheckpoint={checkpointHistory}
                          onDelete={() => removeClip(c.id)}
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
                        currentTime={currentTime}
                        selectedKeyframe={selectedKeyframe}
                        onSelectClip={() => selectClip(row.clip.id)}
                        onSelectEndpoint={(selection, time) => {
                          selectKeyframe(selection);
                          seek(row.clip.start + time);
                        }}
                        onAddMotion={(time) => {
                          const selection = addClipMotionStep(row.clip.id, time);
                          if (selection) {
                            selectKeyframe(selection);
                            const nextClip = deriveEditorClips(useStudio.getState().project!).find(
                              (candidate) => candidate.id === row.clip.id,
                            );
                            const keyframe = nextClip?.keyframes.find(
                              (candidate) => candidate.id === selection.keyframeId,
                            );
                            if (keyframe) seek(row.clip.start + keyframe.time);
                          }
                        }}
                        onMoveMotion={(motionId, patch) =>
                          moveClipMotionStep(row.clip.id, motionId, patch, { history: false })
                        }
                        onAddCheckpoint={(motionId, time) => {
                          const selection = addClipMotionCheckpoint(row.clip.id, motionId, time);
                          if (selection) {
                            selectKeyframe(selection);
                            seek(row.clip.start + time);
                          }
                        }}
                        onMoveCheckpoint={(motionId, checkpointId, time) =>
                          moveClipMotionCheckpoint(row.clip.id, motionId, checkpointId, time, {
                            history: false,
                          })
                        }
                        onRemoveMotion={(motionId) => removeClipMotionStep(row.clip.id, motionId)}
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
                        onSelect={() => selectClip(row.clip.id)}
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
                        onSelect={() => selectClip(row.clip.id)}
                        onSelectMotion={setSelectedMotionId}
                        onChange={(motions) =>
                          updateClip(row.clip.id, {
                            character: { ...row.clip.character, motions },
                          } as Partial<CompositionClip>)
                        }
                        onMoveVoice={(speechId, start, options) =>
                          moveSpeech(row.clip.id, speechId, start, options)
                        }
                        onTrimVoice={(speechId, patch, options) =>
                          trimSpeech(row.clip.id, speechId, patch, options)
                        }
                        onOpenVoiceSettings={(speechId) =>
                          openSpeechSettings(row.clip.id, speechId)
                        }
                        onRemoveVoice={(speechId) => removeSpeech(row.clip.id, speechId)}
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

function Ruler({ duration, zoom }: { duration: number; zoom: number }) {
  const step = zoom < 40 ? 5 : zoom < 80 ? 2 : 1;
  const ticks: number[] = [];
  for (let s = 0; s <= duration; s += step) ticks.push(s);
  return (
    <div className="relative h-full">
      {ticks.map((s) => (
        <div
          key={s}
          className="absolute top-0 h-full border-l border-border text-[10px] text-muted-foreground"
          style={{ left: s * zoom, paddingLeft: 4 }}
        >
          {s}s
        </div>
      ))}
    </div>
  );
}

function buildCompositionSourceErrors(
  project: Project,
  clips: EditorClip[],
): Map<string, string[]> {
  const errorsByClipId = new Map<string, string[]>();
  for (const clip of clips) {
    if (clip.kind !== "composition" || !clip.compositionId) continue;
    const source = project.hf.compositionHtml[clip.compositionId];
    if (!source) {
      errorsByClipId.set(clip.id, [`Missing source for composition "${clip.compositionId}".`]);
      continue;
    }
    const result = validateCompositionSourceHtml(source, {
      compositionId: clip.compositionId,
      duration: clip.duration,
      width: clip.width || project.hf.width,
      height: clip.height || project.hf.height,
    });
    if (!result.ok) errorsByClipId.set(clip.id, result.errors);
  }
  return errorsByClipId;
}

function buildCompositionOutlines(
  project: Project,
  clips: EditorClip[],
): Map<string, CompositionOutlineItem[]> {
  const outlines = new Map<string, CompositionOutlineItem[]>();
  for (const clip of clips) {
    if (clip.kind !== "composition" || isCharacterCompositionClip(clip) || !clip.compositionId) {
      continue;
    }
    const source = project.hf.compositionHtml[clip.compositionId];
    if (!source) continue;
    const outline = extractCompositionOutline(source, {
      compositionId: clip.compositionId,
      duration: clip.duration,
    });
    if (outline.length > 0) outlines.set(clip.id, outline);
  }
  return outlines;
}

function ClipBlock({
  clip,
  missingMediaIds,
  compositionSourceErrors,
  zoom,
  selected,
  onSelect,
  onChange,
  onHistoryCheckpoint,
  onDelete,
  duration,
  laneTops,
  top,
  presetMap,
  expanded,
  onToggleExpanded,
}: {
  clip: EditorClip;
  missingMediaIds: string[];
  compositionSourceErrors: string[];
  zoom: number;
  selected: boolean;
  tracks: number;
  duration: number;
  laneTops: number[];
  top: number;
  onSelect: () => void;
  onChange: (p: Partial<AnyClip>, options?: ProjectMutationOptions) => void;
  onHistoryCheckpoint: () => void;
  onDelete: () => void;
  presetMap: Map<string, MotionPreset>;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const isCharacterClip = isCharacterCompositionClip(clip);
  const canExpand = isKeyframeEditableClip(clip);
  const color =
    clip.kind === "audio"
      ? "bg-clip-audio"
      : isCharacterClip
        ? "bg-clip-character"
        : clip.kind === "text"
          ? "bg-fuchsia-500"
          : clip.kind === "composition"
            ? "bg-indigo-500"
            : clip.kind === "video"
              ? "bg-clip"
              : "bg-clip-bg";

  const lane = clip.laneIndex ?? 0;
  const clipMotions = isCharacterClip ? (clip.character.motions ?? []) : [];
  const missingMediaTitle =
    missingMediaIds.length > 0 ? `Missing media: ${missingMediaIds.join(", ")}` : undefined;
  const malformedCompositionTitle =
    compositionSourceErrors.length > 0
      ? `Malformed composition source:\n${compositionSourceErrors.join("\n")}`
      : undefined;
  const clipVolume = clip.volume ?? 1;
  const clipTitle = [
    clip.name,
    clip.kind === "audio" ? `Volume ${Math.round(clipVolume * 100)}%` : undefined,
    missingMediaTitle,
    malformedCompositionTitle,
  ]
    .filter(Boolean)
    .join("\n");

  const onMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
    if (e.button !== 0) return;
    const sx = e.clientX,
      sy = e.clientY;
    const ostart = clip.start;
    const olane = lane;
    const oLaneTop = laneTops[olane] ?? olane * TRACK_HEIGHT;
    let dragging = false;
    let checkpointed = false;
    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!dragging && Math.hypot(dx, dy) < CLIP_DRAG_THRESHOLD_PX) return;
      dragging = true;
      if (!checkpointed) {
        onHistoryCheckpoint();
        checkpointed = true;
      }
      const ns = Math.max(0, Math.min(duration - clip.duration, ostart + (ev.clientX - sx) / zoom));
      // Snap vertical drag to nearest lane within the track.
      const newLane = nearestLaneIndex(laneTops, oLaneTop + dy + TRACK_HEIGHT / 2);
      onChange({ start: ns, laneIndex: newLane }, { history: false });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // Audio/video clips trim against their source: the out-point can't exceed the
  // source length, and trimming the left edge moves the in-point (mediaStartTime).
  const isTrimMedia = clip.kind === "audio" || clip.kind === "video";
  const sourceDuration = clip.sourceDuration;

  const onResizeRight = (e: React.MouseEvent) => {
    e.stopPropagation();
    const sx = e.clientX,
      od = clip.duration;
    const mediaStart = clip.mediaStartTime ?? 0;
    let checkpointed = false;
    const move = (ev: MouseEvent) => {
      if (!checkpointed) {
        onHistoryCheckpoint();
        checkpointed = true;
      }
      let nd = Math.max(0.1, Math.min(duration - clip.start, od + (ev.clientX - sx) / zoom));
      if (isTrimMedia && sourceDuration != null) {
        nd = Math.min(nd, Math.max(0.1, sourceDuration - mediaStart));
      }
      onChange({ duration: nd }, { history: false });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const onResizeLeft = (e: React.MouseEvent) => {
    e.stopPropagation();
    const sx = e.clientX,
      ostart = clip.start,
      od = clip.duration,
      oMediaStart = clip.mediaStartTime ?? 0;
    let checkpointed = false;
    const move = (ev: MouseEvent) => {
      if (!checkpointed) {
        onHistoryCheckpoint();
        checkpointed = true;
      }
      const dx = (ev.clientX - sx) / zoom;
      // Don't extend earlier than the source's own start (in-point can't go below 0).
      const minStart = isTrimMedia ? Math.max(0, ostart - oMediaStart) : 0;
      const ns = Math.max(minStart, Math.min(ostart + od - 0.1, ostart + dx));
      const nd = od - (ns - ostart);
      if (isTrimMedia) {
        const newMediaStart = Math.max(0, oMediaStart + (ns - ostart));
        onChange({ start: ns, duration: nd, mediaStartTime: newMediaStart }, { history: false });
      } else {
        onChange({ start: ns, duration: nd }, { history: false });
      }
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div
      data-timeline-clip-id={clip.id}
      role="button"
      aria-label={`Select ${clip.name}`}
      onMouseDown={onMouseDown}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onKeyDown={(e) => {
        if (e.key === "Delete" || e.key === "Backspace") onDelete();
      }}
      tabIndex={0}
      className={`group absolute cursor-grab overflow-hidden rounded ${color} ${
        selected ? "ring-2 ring-primary" : "ring-1 ring-black/30"
      }`}
      style={{
        left: clip.start * zoom,
        width: Math.max(8, clip.duration * zoom),
        top,
        height: TRACK_HEIGHT - 8,
      }}
      title={clipTitle}
    >
      <div className="flex h-full items-center gap-1 px-2 text-[11px] font-medium text-foreground/95 mix-blend-luminosity">
        {canExpand && (
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpanded();
            }}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-black/20"
            aria-label={expanded ? "Collapse clip details" : "Expand clip details"}
            title={expanded ? "Hide details" : "Show details"}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        )}
        {clip.kind === "audio" &&
          (clipVolume === 0 ? (
            <VolumeX size={12} className="shrink-0" />
          ) : (
            <Volume2 size={12} className="shrink-0" />
          ))}
        <span className="truncate">{clip.name}</span>
        {clip.kind === "audio" && clipVolume < 1 && (
          <span className="shrink-0 text-[10px] text-foreground/80">
            {Math.round(clipVolume * 100)}%
          </span>
        )}
        {(missingMediaIds.length > 0 ||
          compositionSourceErrors.length > 0 ||
          clipMotions.length > 0) && (
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {missingMediaIds.length > 0 && (
              <TriangleAlert
                size={13}
                className="text-amber-200 drop-shadow"
                aria-label={missingMediaTitle}
              />
            )}
            {compositionSourceErrors.length > 0 && (
              <TriangleAlert
                size={13}
                className="text-red-200 drop-shadow"
                aria-label="Malformed composition source"
              />
            )}
            {clipMotions.length > 0 && (
              <span className="flex shrink-0 items-center gap-0.5">
                {clipMotions.slice(0, 4).map((motion) => {
                  const preset = presetMap.get(motion.presetId);
                  return (
                    <span
                      key={motion.id}
                      className={`h-1.5 w-3 rounded-full border ${
                        preset ? CATEGORY_COLORS[preset.category] : CATEGORY_COLORS.custom
                      }`}
                      title={preset?.name ?? "Motion"}
                    />
                  );
                })}
                {clipMotions.length > 4 && (
                  <span className="text-[9px] text-foreground/80">+{clipMotions.length - 4}</span>
                )}
              </span>
            )}
          </span>
        )}
      </div>
      <div
        onMouseDown={onResizeLeft}
        title={isTrimMedia ? "Trim start (in-point)" : "Resize start"}
        className="absolute left-0 top-0 z-10 flex h-full w-2.5 cursor-ew-resize items-center justify-center rounded-l bg-black/45 opacity-0 group-hover:opacity-100"
      >
        <span className="h-1/2 w-0.5 rounded-full bg-white/80" />
      </div>
      <div
        onMouseDown={onResizeRight}
        title={isTrimMedia ? "Trim end (out-point)" : "Resize end"}
        className="absolute right-0 top-0 z-10 flex h-full w-2.5 cursor-ew-resize items-center justify-center rounded-r bg-black/45 opacity-0 group-hover:opacity-100"
      >
        <span className="h-1/2 w-0.5 rounded-full bg-white/80" />
      </div>
    </div>
  );
}

interface ExpandedClipRow {
  clip: CharacterCompositionClip;
  layout: ExpandedClipLayout;
  top: number;
}

interface ExpandedKeyframeRow {
  clip: EditorClip;
  top: number;
}

interface ExpandedCompositionOutlineRow {
  clip: EditorClip;
  outline: CompositionOutlineItem[];
  top: number;
}

interface VisualMotionPacking {
  rowByMotionId: Map<string, number>;
  rowCount: number;
  overlappingMotionIds: Set<string>;
}

interface LaneLayout {
  index: number;
  top: number;
  visualMotionRows: ExpandedKeyframeRow[];
  compositionOutlineRows: ExpandedCompositionOutlineRow[];
  motionRows: ExpandedClipRow[];
}

interface TrackLayout {
  lanes: LaneLayout[];
  height: number;
}

function buildTrackLayout({
  trackIndex,
  laneCount,
  expandedMotionClips,
  expandedCompositionOutlines,
  compositionOutlinesByClipId,
  expandedCharacters,
  expandedLayouts,
}: {
  trackIndex: number;
  laneCount: number;
  expandedMotionClips: EditorClip[];
  expandedCompositionOutlines: EditorClip[];
  compositionOutlinesByClipId: Map<string, CompositionOutlineItem[]>;
  expandedCharacters: CharacterCompositionClip[];
  expandedLayouts: Map<string, ExpandedClipLayout>;
}): TrackLayout {
  let top = 0;
  const lanes: LaneLayout[] = [];
  for (let laneIndex = 0; laneIndex < laneCount; laneIndex++) {
    const visualMotionRows: ExpandedKeyframeRow[] = [];
    const compositionOutlineRows: ExpandedCompositionOutlineRow[] = [];
    const motionRows: ExpandedClipRow[] = [];
    const laneTop = top;
    top += TRACK_HEIGHT;
    const expandedMotionsInLane = expandedMotionClips
      .filter(
        (clip) => clip.trackIndex === trackIndex && Math.max(0, clip.laneIndex ?? 0) === laneIndex,
      )
      .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    for (const clip of expandedMotionsInLane) {
      visualMotionRows.push({ clip, top });
      top += visualMotionLaneHeight(clip);
    }
    const expandedOutlinesInLane = expandedCompositionOutlines
      .filter(
        (clip) => clip.trackIndex === trackIndex && Math.max(0, clip.laneIndex ?? 0) === laneIndex,
      )
      .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    for (const clip of expandedOutlinesInLane) {
      const outline = compositionOutlinesByClipId.get(clip.id) ?? [];
      if (outline.length === 0) continue;
      compositionOutlineRows.push({ clip, outline, top });
      top += compositionOutlineLaneHeight(outline);
    }
    const expandedInLane = expandedCharacters
      .filter(
        (clip) => clip.trackIndex === trackIndex && Math.max(0, clip.laneIndex ?? 0) === laneIndex,
      )
      .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    for (const clip of expandedInLane) {
      const layout = expandedLayouts.get(clip.id);
      if (!layout) continue;
      motionRows.push({ clip, layout, top });
      top += layout.height;
    }
    lanes.push({
      index: laneIndex,
      top: laneTop,
      visualMotionRows,
      compositionOutlineRows,
      motionRows,
    });
  }
  return { lanes, height: top };
}

function packVisualMotionRows(motions: ClipMotionStep[]): VisualMotionPacking {
  const rowByMotionId = new Map<string, number>();
  const overlappingMotionIds = new Set<string>();
  const rowEndTimes: number[] = [];
  const sorted = [...motions].sort(
    (a, b) => a.startTime - b.startTime || a.endTime - b.endTime || a.id.localeCompare(b.id),
  );

  for (const motion of sorted) {
    let rowIndex = rowEndTimes.findIndex((endTime) => endTime <= motion.startTime + 0.001);
    if (rowIndex < 0) rowIndex = rowEndTimes.length;
    rowEndTimes[rowIndex] = motion.endTime;
    rowByMotionId.set(motion.id, rowIndex);
  }

  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j += 1) {
      const b = sorted[j]!;
      if (a.startTime < b.endTime - 0.001 && b.startTime < a.endTime - 0.001) {
        overlappingMotionIds.add(a.id);
        overlappingMotionIds.add(b.id);
      }
    }
  }

  return {
    rowByMotionId,
    rowCount: Math.max(1, rowEndTimes.length),
    overlappingMotionIds,
  };
}

function visualMotionLaneHeight(clip?: EditorClip): number {
  const rowCount = clip ? packVisualMotionRows(clip.motionSteps).rowCount : 1;
  return VISUAL_MOTION_PARENT_HEIGHT + rowCount * VISUAL_MOTION_ROW_HEIGHT;
}

function compositionOutlineLaneHeight(outline: CompositionOutlineItem[]): number {
  return (
    COMPOSITION_OUTLINE_PARENT_HEIGHT + Math.max(1, outline.length) * COMPOSITION_OUTLINE_ROW_HEIGHT
  );
}

function CompositionOutlineHeader({
  clip,
  outline,
}: {
  clip: EditorClip;
  outline: CompositionOutlineItem[];
}) {
  return (
    <div
      style={{ height: compositionOutlineLaneHeight(outline) }}
      className="border-t border-border/60 bg-panel/50"
    >
      <div
        className="flex items-center gap-1 px-3 text-[10px] text-foreground"
        style={{ height: COMPOSITION_OUTLINE_PARENT_HEIGHT }}
      >
        <span className="text-muted-foreground">↳</span>
        <span className="min-w-0 flex-1 truncate">{clip.name}</span>
        <span className="shrink-0 text-muted-foreground">{outline.length}</span>
      </div>
      {outline.map((item) => (
        <div
          key={item.id}
          style={{ height: COMPOSITION_OUTLINE_ROW_HEIGHT, paddingLeft: 24 + item.depth * 10 }}
          className="flex items-center gap-1 border-t border-border/40 pr-3 text-[10px] text-muted-foreground"
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${outlineDotColor(item.kind)}`} />
          <span className="min-w-0 flex-1 truncate">{item.name}</span>
          <span className="shrink-0 uppercase tracking-[0.08em] text-muted-foreground/70">
            {item.timed ? item.kind : "layer"}
          </span>
        </div>
      ))}
    </div>
  );
}

function CompositionOutlineLaneSet({
  clip,
  outline,
  zoom,
  top,
  onSelect,
}: {
  clip: EditorClip;
  outline: CompositionOutlineItem[];
  zoom: number;
  top: number;
  onSelect: () => void;
}) {
  return (
    <div
      className="absolute left-0 right-0 border-t border-border/60 bg-panel/25"
      style={{ top, height: compositionOutlineLaneHeight(outline) }}
    >
      <div
        className="absolute rounded border border-primary/20 bg-primary/5"
        style={{
          left: clip.start * zoom,
          top: COMPOSITION_OUTLINE_PARENT_HEIGHT + 3,
          width: Math.max(8, clip.duration * zoom),
          bottom: 3,
        }}
      />
      {outline.map((item, index) => (
        <button
          key={item.id}
          type="button"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
          className={`absolute h-5 overflow-hidden rounded border px-1.5 text-left text-[10px] text-foreground/90 shadow-sm ${outlineBlockColor(
            item.kind,
          )}`}
          style={{
            left: (clip.start + (item.timed ? item.start : 0)) * zoom,
            top: COMPOSITION_OUTLINE_PARENT_HEIGHT + index * COMPOSITION_OUTLINE_ROW_HEIGHT + 3,
            width: Math.max(12, (item.timed ? item.duration : clip.duration) * zoom),
          }}
          title={`${item.name} (${item.timed ? `${formatSeconds(item.start)}-${formatSeconds(item.start + item.duration)}` : "DOM layer"})`}
          aria-label={`Select parent composition for ${item.name}`}
        >
          <span className="block truncate leading-5">{item.name}</span>
        </button>
      ))}
    </div>
  );
}

function outlineDotColor(kind: CompositionOutlineItem["kind"]): string {
  switch (kind) {
    case "audio":
      return "bg-clip-audio";
    case "composition":
      return "bg-indigo-300";
    case "image":
      return "bg-clip-bg";
    case "text":
      return "bg-fuchsia-300";
    case "video":
      return "bg-clip";
    case "layer":
    default:
      return "bg-slate-400";
  }
}

function outlineBlockColor(kind: CompositionOutlineItem["kind"]): string {
  switch (kind) {
    case "audio":
      return "border-cyan-300/70 bg-cyan-500/45";
    case "composition":
      return "border-indigo-300/70 bg-indigo-500/45";
    case "image":
      return "border-emerald-300/70 bg-emerald-500/45";
    case "text":
      return "border-fuchsia-300/70 bg-fuchsia-500/45";
    case "video":
      return "border-purple-300/70 bg-purple-500/45";
    case "layer":
    default:
      return "border-slate-300/60 bg-slate-500/35";
  }
}

function VisualMotionLaneHeader({ clip }: { clip: EditorClip }) {
  return (
    <div
      style={{ height: visualMotionLaneHeight(clip) }}
      className="border-t border-border/60 bg-panel/50"
    >
      <div
        className="flex items-center gap-1 px-3 text-[10px] text-foreground"
        style={{ height: VISUAL_MOTION_PARENT_HEIGHT }}
      >
        <span className="text-muted-foreground">↳</span>
        <span className="min-w-0 flex-1 truncate">{clip.name}</span>
      </div>
      <div
        style={{ height: visualMotionLaneHeight(clip) - VISUAL_MOTION_PARENT_HEIGHT }}
        className="flex items-center border-t border-border/40 px-3 pl-6 text-[10px] text-muted-foreground"
      >
        <span className="truncate">Motion</span>
      </div>
    </div>
  );
}

function VisualMotionLaneSet({
  clip,
  zoom,
  top,
  currentTime,
  selectedKeyframe,
  onSelectClip,
  onSelectEndpoint,
  onAddMotion,
  onMoveMotion,
  onAddCheckpoint,
  onMoveCheckpoint,
  onRemoveMotion,
  onSeekLocal,
  onHistoryCheckpoint,
}: {
  clip: EditorClip;
  zoom: number;
  top: number;
  currentTime: number;
  selectedKeyframe: ClipKeyframeSelection | null;
  onSelectClip: () => void;
  onSelectEndpoint: (selection: ClipKeyframeSelection, time: number) => void;
  onAddMotion: (time: number) => void;
  onMoveMotion: (
    motionId: string,
    patch: {
      startTime?: number;
      endTime?: number;
      selectEndpoint?: ClipMotionEndpoint;
    },
  ) => void;
  onAddCheckpoint: (motionId: string, time: number) => void;
  onMoveCheckpoint: (motionId: string, checkpointId: string, time: number) => void;
  onRemoveMotion: (motionId: string) => void;
  onSeekLocal: (time: number) => void;
  onHistoryCheckpoint: () => void;
}) {
  const clipEnd = clip.start + clip.duration;
  const localPlayheadTime = Math.max(0, Math.min(clip.duration, currentTime - clip.start));
  const playheadInsideClip = currentTime >= clip.start && currentTime <= clipEnd;
  const motionPacking = useMemo(() => packVisualMotionRows(clip.motionSteps), [clip.motionSteps]);
  const motionAreaHeight = motionPacking.rowCount * VISUAL_MOTION_ROW_HEIGHT;

  return (
    <div
      className="absolute left-0 right-0 border-t border-border/60 bg-panel/25"
      style={{ top, height: visualMotionLaneHeight(clip) }}
    >
      <div
        className="absolute rounded border border-primary/20 bg-primary/5"
        style={{
          left: clip.start * zoom,
          top: VISUAL_MOTION_PARENT_HEIGHT + 4,
          width: Math.max(8, clip.duration * zoom),
          height: Math.max(8, motionAreaHeight - 8),
        }}
      />
      <div
        className="absolute left-0 right-0 border-t border-border/40"
        style={{ top: VISUAL_MOTION_PARENT_HEIGHT, height: motionAreaHeight }}
        onDoubleClick={(event) => {
          const rowRect = event.currentTarget.getBoundingClientRect();
          const projectTime = (event.clientX - rowRect.left) / zoom;
          const localTime = Math.max(0, Math.min(clip.duration, projectTime - clip.start));
          onSelectClip();
          onAddMotion(localTime);
        }}
      >
        {playheadInsideClip && (
          <button
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onSelectClip();
              onAddMotion(localPlayheadTime);
            }}
            className="absolute top-1/2 z-10 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-panel text-[12px] leading-none text-muted-foreground hover:bg-primary/20 hover:text-foreground"
            style={{ left: currentTime * zoom }}
            aria-label="Add motion"
            title="Add motion"
          >
            +
          </button>
        )}
        {clip.motionSteps.map((motion) => {
          const selected =
            selectedKeyframe?.clipId === clip.id &&
            motion.checkpointIds.includes(selectedKeyframe.keyframeId);
          return (
            <VisualMotionBlock
              key={motion.id}
              clip={clip}
              motion={motion}
              zoom={zoom}
              rowIndex={motionPacking.rowByMotionId.get(motion.id) ?? 0}
              overlaps={motionPacking.overlappingMotionIds.has(motion.id)}
              selected={selected}
              selectedCheckpointId={
                selectedKeyframe?.clipId === clip.id ? selectedKeyframe.keyframeId : null
              }
              localPlayheadTime={localPlayheadTime}
              onSelectCheckpoint={(checkpoint) => {
                onSelectClip();
                onSelectEndpoint(
                  selectionForMotionCheckpoint(clip.id, checkpoint),
                  checkpoint.time,
                );
              }}
              onSelectEndpoint={(endpoint) => {
                const selection = selectionForMotionEndpoint(clip.id, motion, endpoint);
                onSelectClip();
                onSelectEndpoint(
                  selection,
                  endpoint === "begin" ? motion.startTime : motion.endTime,
                );
              }}
              onMove={(patch) => onMoveMotion(motion.id, patch)}
              onAddCheckpoint={(time) => onAddCheckpoint(motion.id, time)}
              onMoveCheckpoint={(checkpointId, time) =>
                onMoveCheckpoint(motion.id, checkpointId, time)
              }
              onDelete={() => onRemoveMotion(motion.id)}
              onSeekLocal={onSeekLocal}
              onHistoryCheckpoint={onHistoryCheckpoint}
            />
          );
        })}
      </div>
    </div>
  );
}

function VisualMotionBlock({
  clip,
  motion,
  zoom,
  rowIndex,
  overlaps,
  selected,
  selectedCheckpointId,
  localPlayheadTime,
  onSelectCheckpoint,
  onSelectEndpoint,
  onMove,
  onAddCheckpoint,
  onMoveCheckpoint,
  onDelete,
  onSeekLocal,
  onHistoryCheckpoint,
}: {
  clip: EditorClip;
  motion: ClipMotionStep;
  zoom: number;
  rowIndex: number;
  overlaps: boolean;
  selected: boolean;
  selectedCheckpointId: string | null;
  localPlayheadTime: number;
  onSelectCheckpoint: (checkpoint: ClipMotionCheckpoint) => void;
  onSelectEndpoint: (endpoint: ClipMotionEndpoint) => void;
  onMove: (patch: {
    startTime?: number;
    endTime?: number;
    selectEndpoint?: ClipMotionEndpoint;
  }) => void;
  onAddCheckpoint: (time: number) => void;
  onMoveCheckpoint: (checkpointId: string, time: number) => void;
  onDelete: () => void;
  onSeekLocal: (time: number) => void;
  onHistoryCheckpoint: () => void;
}) {
  const left = (clip.start + motion.startTime) * zoom;
  const width = Math.max(10, (motion.endTime - motion.startTime) * zoom);
  const color = "border-cyan-300/80 bg-cyan-500/75";
  const canAddPlayheadPoint =
    selected &&
    localPlayheadTime > motion.startTime + 0.02 &&
    localPlayheadTime < motion.endTime - 0.02;
  const playheadPointLeft =
    ((pointTimeForMotion(motion, localPlayheadTime) - motion.startTime) /
      Math.max(0.001, motion.endTime - motion.startTime)) *
    100;

  const startDrag = (event: React.PointerEvent, mode: "move" | "start" | "end") => {
    event.stopPropagation();
    if (event.button !== 0) return;
    onSelectEndpoint(mode === "start" ? "begin" : "end");
    const startX = event.clientX;
    const initialStart = motion.startTime;
    const initialEnd = motion.endTime;
    let checkpointed = false;

    const move = (ev: PointerEvent) => {
      if (!checkpointed) {
        onHistoryCheckpoint();
        checkpointed = true;
      }
      const delta = (ev.clientX - startX) / zoom;
      if (mode === "move" || mode === "start") {
        const duration = initialEnd - initialStart;
        const startTime = round(
          Math.max(0, Math.min(Math.max(0, clip.duration - duration), initialStart + delta)),
          2,
        );
        const endTime = round(startTime + duration, 2);
        onMove({
          startTime,
          endTime,
          selectEndpoint: mode === "start" ? "begin" : "end",
        });
        onSeekLocal(mode === "start" ? startTime : endTime);
      } else {
        const endTime = round(
          Math.max(initialStart + 0.05, Math.min(clip.duration, initialEnd + delta)),
          2,
        );
        onMove({
          startTime: initialStart,
          endTime,
          selectEndpoint: "end",
        });
        onSeekLocal(endTime);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      data-timeline-motion-id={motion.id}
      role="button"
      tabIndex={0}
      onPointerDown={(event) => startDrag(event, "move")}
      onClick={(event) => {
        event.stopPropagation();
        onSelectEndpoint("end");
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        const local =
          motion.startTime +
          ((event.clientX - rect.left) / Math.max(1, rect.width)) *
            (motion.endTime - motion.startTime);
        onAddCheckpoint(round(local, 2));
      }}
      onKeyDown={(event) => {
        if (event.key !== "Delete" && event.key !== "Backspace") return;
        event.preventDefault();
        event.stopPropagation();
        onDelete();
      }}
      className={`absolute h-6 overflow-visible rounded border text-left text-[10px] text-foreground shadow-sm ${color} ${
        selected ? "ring-1 ring-primary-foreground" : ""
      } ${overlaps ? "outline outline-1 outline-amber-200/70" : ""}`}
      style={{ left, width, top: rowIndex * VISUAL_MOTION_ROW_HEIGHT + 3 }}
      title={`${motion.label} ${formatSeconds(motion.startTime)}-${formatSeconds(
        motion.endTime,
      )}${overlaps ? " overlaps another motion" : ""}`}
    >
      <span className="pointer-events-none absolute inset-x-2 top-0 block truncate leading-6">
        {motion.label}
      </span>
      {canAddPlayheadPoint && (
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            const time = pointTimeForMotion(motion, localPlayheadTime);
            onAddCheckpoint(time);
            onSeekLocal(time);
          }}
          className="absolute top-1/2 z-30 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
          style={{
            left: `clamp(10px, ${Math.max(
              0,
              Math.min(100, playheadPointLeft),
            )}%, calc(100% - 10px))`,
          }}
          aria-label="Add point at playhead"
          title="Add point at playhead"
        >
          <Plus size={12} />
        </button>
      )}
      {motion.checkpoints.map((checkpoint, index) => (
        <CheckpointMark
          key={checkpoint.id}
          checkpoint={checkpoint}
          index={index}
          count={motion.checkpoints.length}
          left={
            ((checkpoint.time - motion.startTime) /
              Math.max(0.001, motion.endTime - motion.startTime)) *
            100
          }
          selected={selectedCheckpointId === checkpoint.id}
          onSelect={() => onSelectCheckpoint(checkpoint)}
          onMove={(time) => onMoveCheckpoint(checkpoint.id, time)}
          onSeekLocal={onSeekLocal}
          onHistoryCheckpoint={onHistoryCheckpoint}
          motion={motion}
          clip={clip}
          zoom={zoom}
        />
      ))}
      <span
        onPointerDown={(event) => startDrag(event, "start")}
        className="absolute left-0 top-0 h-full w-2 cursor-ew-resize rounded-l bg-white/45"
        title="Move motion"
      />
      <span
        onPointerDown={(event) => startDrag(event, "end")}
        className="absolute right-0 top-0 h-full w-2 cursor-ew-resize rounded-r bg-white/55"
        title="Move end"
      />
      <span className="absolute bottom-0 left-0 top-0 w-px bg-white/70" style={{ left: 6 }} />
      <span className="absolute bottom-0 right-0 top-0 w-px bg-white/80" style={{ right: 6 }} />
    </div>
  );
}

function CheckpointMark({
  checkpoint,
  index,
  count,
  left,
  selected,
  onSelect,
  onMove,
  onSeekLocal,
  onHistoryCheckpoint,
  motion,
  clip,
  zoom,
}: {
  checkpoint: ClipMotionCheckpoint;
  index: number;
  count: number;
  left: number;
  selected: boolean;
  onSelect: () => void;
  onMove: (time: number) => void;
  onSeekLocal: (time: number) => void;
  onHistoryCheckpoint: () => void;
  motion: ClipMotionStep;
  clip: EditorClip;
  zoom: number;
}) {
  const startDrag = (event: React.PointerEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    onSelect();
    const startX = event.clientX;
    const startTime = checkpoint.time;
    let checkpointed = false;
    const move = (ev: PointerEvent) => {
      if (!checkpointed) {
        onHistoryCheckpoint();
        checkpointed = true;
      }
      const nextTime = Math.max(
        0,
        Math.min(clip.duration, startTime + (ev.clientX - startX) / zoom),
      );
      const roundedTime = round(nextTime, 2);
      onMove(roundedTime);
      onSeekLocal(roundedTime);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={checkpoint.label}
      title={`${checkpoint.label} ${formatSeconds(checkpoint.time)}`}
      onPointerDown={startDrag}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      className={`absolute top-1/2 z-20 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-sm ${
        selected ? "border-white bg-primary" : "border-white/90 bg-panel"
      }`}
      style={{
        left: `clamp(7px, ${Math.max(0, Math.min(100, left))}%, calc(100% - 7px))`,
        cursor: "ew-resize",
      }}
      data-motion-checkpoint-id={checkpoint.id}
      data-motion-id={motion.id}
    />
  );
}

function isKeyframeEditableClip(clip: EditorClip): boolean {
  return clip.kind !== "audio";
}

function pointTimeForMotion(motion: ClipMotionStep, localPlayheadTime: number) {
  const inset = Math.min(0.1, Math.max(0, (motion.endTime - motion.startTime) / 4));
  const min = motion.startTime + inset;
  const max = motion.endTime - inset;
  const fallback = motion.startTime + (motion.endTime - motion.startTime) / 2;
  const time = max > min ? Math.max(min, Math.min(max, localPlayheadTime)) : fallback;
  return round(time, 2);
}

function selectionForMotionCheckpoint(
  clipId: string,
  checkpoint: ClipMotionCheckpoint,
): ClipKeyframeSelection {
  return {
    clipId,
    keyframeId: checkpoint.id,
    property: "position",
  };
}

function selectionForMotionEndpoint(
  clipId: string,
  motion: ClipMotionStep,
  endpoint: ClipMotionEndpoint,
): ClipKeyframeSelection {
  return {
    clipId,
    keyframeId: endpoint === "begin" ? motion.startKeyframeId : motion.endKeyframeId,
    property: "position",
  };
}

function nearestLaneIndex(laneTops: number[], y: number) {
  if (laneTops.length === 0) return 0;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  laneTops.forEach((top, index) => {
    const distance = Math.abs(y - (top + TRACK_HEIGHT / 2));
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });
  return bestIndex;
}

interface PackedMotion {
  motion: AppliedMotion;
  preset?: MotionPreset;
}

interface MotionGroupLayout {
  category: MotionCategory;
  label: string;
  rows: PackedMotion[][];
}

interface ExpandedClipLayout {
  voices: VoiceLaneSummary[];
  groups: MotionGroupLayout[];
  height: number;
}

interface VoiceLaneSummary {
  id: string;
  start: number;
  name: string;
  duration: number;
  volume: number;
  /** In-point into the source audio (s); 0 = no trim. */
  mediaStart: number;
  /** Full source audio length (s), used to bound trim; undefined when unknown. */
  sourceDuration?: number;
}

function CharacterMotionHeader({
  clip,
  layout,
}: {
  clip: CharacterCompositionClip;
  layout: ExpandedClipLayout;
}) {
  return (
    <div
      style={{ height: layout.height }}
      className="border-t border-border/60 bg-panel/50 text-[10px]"
    >
      <div
        className="flex items-center gap-1 px-3 text-foreground"
        style={{ height: MOTION_PARENT_HEIGHT }}
      >
        <span className="text-muted-foreground">↳</span>
        <span className="min-w-0 flex-1 truncate">{clip.name}</span>
      </div>
      {layout.voices.length > 0 && (
        <div
          style={{ height: MOTION_ROW_HEIGHT }}
          className="flex items-center gap-1 border-t border-border/40 px-3 pl-6 text-muted-foreground"
        >
          <Mic2 size={10} />
          <span className="truncate">
            Voice / lip sync
            {layout.voices.length > 1 ? ` (${layout.voices.length})` : ""}
          </span>
        </div>
      )}
      {layout.groups.map((group) =>
        group.rows.map((_, rowIndex) => (
          <div
            key={`${group.category}-${rowIndex}`}
            style={{ height: MOTION_ROW_HEIGHT }}
            className="flex items-center gap-1 border-t border-border/40 px-3 pl-6 text-muted-foreground"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${CATEGORY_DOT_COLORS[group.category]}`} />
            <span className="truncate">
              {group.label}
              {group.rows.length > 1 ? ` ${rowIndex + 1}` : ""}
            </span>
          </div>
        )),
      )}
    </div>
  );
}

function MotionLaneSet({
  clip,
  zoom,
  top,
  layout,
  selectedMotionId,
  onSelect,
  onSelectMotion,
  onChange,
  onMoveVoice,
  onTrimVoice,
  onOpenVoiceSettings,
  onRemoveVoice,
  onVoiceHistoryCheckpoint,
  createMotionId,
  presetMap,
}: {
  clip: CharacterCompositionClip;
  zoom: number;
  top: number;
  layout: ExpandedClipLayout;
  selectedMotionId: string | null;
  onSelect: () => void;
  onSelectMotion: (id: string | null) => void;
  onChange: (motions: AppliedMotion[]) => void;
  onMoveVoice: (speechId: string, start: number, options?: ProjectMutationOptions) => void;
  onTrimVoice: (
    speechId: string,
    patch: { start?: number; mediaStartTime?: number; duration?: number },
    options?: ProjectMutationOptions,
  ) => void;
  onOpenVoiceSettings: (speechId: string) => void;
  onRemoveVoice: (speechId: string) => void;
  onVoiceHistoryCheckpoint: () => void;
  createMotionId: () => string;
  presetMap: Map<string, MotionPreset>;
}) {
  const motions = clip.character.motions ?? [];
  const updateMotion = (id: string, patch: Partial<AppliedMotion>) => {
    const nextMotions = motions.map((motion) =>
      motion.id === id ? { ...motion, ...patch } : motion,
    );
    onChange(
      resolveExclusiveMotionOverlaps({
        motions: nextMotions,
        editedMotionId: id,
        presetMap,
        clipDuration: clip.duration,
        createId: createMotionId,
      }),
    );
  };
  const deleteMotion = (id: string) => {
    onChange(motions.filter((motion) => motion.id !== id));
    if (selectedMotionId === id) onSelectMotion(null);
  };
  const voiceTop = MOTION_PARENT_HEIGHT;
  let groupTop = MOTION_PARENT_HEIGHT + (layout.voices.length > 0 ? MOTION_ROW_HEIGHT : 0);
  return (
    <div
      className="absolute left-0 right-0 border-t border-border/60 bg-panel/30"
      style={{ top, height: layout.height }}
    >
      <div
        className="absolute rounded border border-primary/20 bg-primary/5"
        style={{
          left: clip.start * zoom,
          top: MOTION_PARENT_HEIGHT + 3,
          width: Math.max(8, clip.duration * zoom),
          bottom: 3,
        }}
      />
      {layout.voices.length > 0 && (
        <div
          className="absolute left-0 right-0 border-t border-border/40"
          style={{ top: voiceTop, height: MOTION_ROW_HEIGHT }}
        >
          {layout.voices.map((voice) => (
            <VoiceBlock
              key={voice.id}
              clip={clip}
              voice={voice}
              zoom={zoom}
              onMove={(start, options) => onMoveVoice(voice.id, start, options)}
              onTrim={(patch, options) => onTrimVoice(voice.id, patch, options)}
              onOpenSettings={() => onOpenVoiceSettings(voice.id)}
              onRemove={() => onRemoveVoice(voice.id)}
              onHistoryCheckpoint={onVoiceHistoryCheckpoint}
            />
          ))}
        </div>
      )}
      {layout.groups.map((group) => {
        const thisGroupTop = groupTop;
        groupTop += group.rows.length * MOTION_ROW_HEIGHT;
        return (
          <div
            key={group.category}
            className="absolute left-0 right-0"
            style={{
              top: thisGroupTop,
              height: group.rows.length * MOTION_ROW_HEIGHT,
            }}
          >
            {group.rows.map((row, rowIndex) => (
              <div
                key={`${group.category}-${rowIndex}`}
                className="absolute left-0 right-0 border-t border-border/40"
                style={{ top: rowIndex * MOTION_ROW_HEIGHT, height: MOTION_ROW_HEIGHT }}
              >
                {row.map(({ motion, preset }) => (
                  <MotionBlock
                    key={motion.id}
                    motion={motion}
                    clip={clip}
                    preset={preset}
                    zoom={zoom}
                    selected={selectedMotionId === motion.id}
                    onSelect={() => {
                      onSelect();
                      onSelectMotion(motion.id);
                    }}
                    onChange={(patch) => updateMotion(motion.id, patch)}
                    onDelete={() => deleteMotion(motion.id)}
                  />
                ))}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function MotionBlock({
  motion,
  clip,
  preset,
  zoom,
  selected,
  onSelect,
  onChange,
  onDelete,
}: {
  motion: AppliedMotion;
  clip: EditorClip;
  preset?: MotionPreset;
  zoom: number;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<AppliedMotion>) => void;
  onDelete: () => void;
}) {
  const duration = Math.max(0.05, motion.duration ?? preset?.duration ?? 1);
  const occurrences = preset
    ? generateMotionOccurrences(motion, preset, clip.duration)
    : [{ start: motion.offset, end: motion.offset + duration }];
  const color = preset ? CATEGORY_COLORS[preset.category] : CATEGORY_COLORS.custom;

  const startDrag = (e: React.PointerEvent, mode: "move" | "resize") => {
    e.stopPropagation();
    if (e.button !== 0) return;
    onSelect();
    const startX = e.clientX;
    const startOffset = motion.offset;
    const startDuration = duration;
    const move = (ev: PointerEvent) => {
      const delta = (ev.clientX - startX) / zoom;
      if (mode === "move") {
        const maxOffset = Math.max(0, clip.duration - startDuration);
        onChange({ offset: round(Math.max(0, Math.min(maxOffset, startOffset + delta)), 2) });
      } else {
        const maxDuration = Math.max(0.05, clip.duration - motion.offset);
        onChange({
          duration: round(Math.max(0.05, Math.min(maxDuration, startDuration + delta)), 2),
        });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <>
      {occurrences.map((occurrence, index) => {
        const start = Math.max(0, occurrence.start);
        const end = Math.min(clip.duration, occurrence.end);
        if (end <= 0 || start >= clip.duration || end <= start) return null;
        const isPrimary = index === 0;
        return (
          <button
            key={`${motion.id}-${index}-${occurrence.start}`}
            type="button"
            onPointerDown={(e) => isPrimary && startDrag(e, "move")}
            onClick={onSelect}
            onKeyDown={(e) => {
              if (!isPrimary) return;
              if (e.key !== "Delete" && e.key !== "Backspace") return;
              e.preventDefault();
              e.stopPropagation();
              onDelete();
            }}
            className={`absolute top-1 h-5 overflow-hidden rounded border text-left text-[10px] text-foreground shadow-sm ${
              color
            } ${isPrimary ? "cursor-grab" : "pointer-events-none opacity-45"} ${
              selected && isPrimary ? "ring-1 ring-primary-foreground" : ""
            }`}
            style={{
              left: (clip.start + start) * zoom,
              width: Math.max(8, (end - start) * zoom),
            }}
            title={`${preset?.name ?? "Motion"} ${formatSeconds(start)}-${formatSeconds(end)}`}
          >
            {isPrimary && (
              <>
                <span className="block truncate px-1.5 leading-5">{preset?.name ?? "Motion"}</span>
                <span
                  onPointerDown={(e) => startDrag(e, "resize")}
                  className="absolute right-0 top-0 h-full w-2 cursor-ew-resize rounded-r bg-white/50"
                />
              </>
            )}
          </button>
        );
      })}
    </>
  );
}

function VoiceBlock({
  clip,
  voice,
  zoom,
  onMove,
  onTrim,
  onOpenSettings,
  onRemove,
  onHistoryCheckpoint,
}: {
  clip: CharacterCompositionClip;
  voice: VoiceLaneSummary;
  zoom: number;
  onMove: (start: number, options?: ProjectMutationOptions) => void;
  onTrim: (
    patch: { start?: number; mediaStartTime?: number; duration?: number },
    options?: ProjectMutationOptions,
  ) => void;
  onOpenSettings: () => void;
  onRemove: () => void;
  onHistoryCheckpoint: () => void;
}) {
  const end = Math.min(clip.duration, voice.start + voice.duration);
  const width = Math.max(8, Math.max(0.05, end - voice.start) * zoom);
  const trimmed = voice.start + voice.duration > clip.duration + 0.01;
  const inPointed = voice.mediaStart > 0.01;

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const downX = e.clientX;
    const originalStart = voice.start;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - downX) / zoom;
      if (!moved && Math.abs(ev.clientX - downX) < CLIP_DRAG_THRESHOLD_PX) return;
      if (!moved) {
        moved = true;
        onHistoryCheckpoint();
      }
      onMove(Math.max(0, Math.min(clip.duration, originalStart + dx)), { history: false });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Trim out-point: drag the right edge to shorten/lengthen playback, bounded by
  // the remaining source after the in-point and by the host character clip.
  const startTrimRight = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const downX = e.clientX;
    const od = voice.duration;
    const ms = voice.mediaStart;
    let checkpointed = false;
    const move = (ev: PointerEvent) => {
      if (!checkpointed) {
        onHistoryCheckpoint();
        checkpointed = true;
      }
      let nd = Math.max(
        0.1,
        Math.min(clip.duration - voice.start, od + (ev.clientX - downX) / zoom),
      );
      if (voice.sourceDuration != null) {
        nd = Math.min(nd, Math.max(0.1, voice.sourceDuration - ms));
      }
      onTrim({ duration: nd }, { history: false });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Trim in-point: drag the left edge to move where the audio starts playing. The
  // right edge stays anchored; mediaStart can't drop below 0 (source start).
  const startTrimLeft = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const downX = e.clientX;
    const ostart = voice.start;
    const od = voice.duration;
    const oMediaStart = voice.mediaStart;
    let checkpointed = false;
    const move = (ev: PointerEvent) => {
      if (!checkpointed) {
        onHistoryCheckpoint();
        checkpointed = true;
      }
      const dx = (ev.clientX - downX) / zoom;
      const minStart = Math.max(0, ostart - oMediaStart);
      const ns = Math.max(minStart, Math.min(ostart + od - 0.1, ostart + dx));
      const nd = od - (ns - ostart);
      const newMediaStart = Math.max(0, oMediaStart + (ns - ostart));
      onTrim({ start: ns, duration: nd, mediaStartTime: newMediaStart }, { history: false });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      onPointerDown={startDrag}
      className="group absolute top-1 flex h-5 cursor-grab items-center gap-1 overflow-hidden rounded border border-cyan-300/80 bg-cyan-500/70 px-1.5 text-[10px] text-foreground shadow-sm"
      style={{
        left: (clip.start + voice.start) * zoom,
        width,
      }}
      title={`${voice.name} · volume ${Math.round(voice.volume * 100)}%${
        inPointed ? ` · in ${voice.mediaStart.toFixed(1)}s` : ""
      }${trimmed ? " (trimmed by character clip)" : ""}`}
    >
      <div
        onPointerDown={startTrimLeft}
        title="Trim start (in-point)"
        className="absolute left-0 top-0 z-10 flex h-full w-2 cursor-ew-resize items-center justify-center rounded-l bg-black/35 opacity-0 group-hover:opacity-100"
      >
        <span className="h-1/2 w-0.5 rounded-full bg-white/80" />
      </div>
      <div
        onPointerDown={startTrimRight}
        title="Trim end (out-point)"
        className="absolute right-0 top-0 z-10 flex h-full w-2 cursor-ew-resize items-center justify-center rounded-r bg-black/35 opacity-0 group-hover:opacity-100"
      >
        <span className="h-1/2 w-0.5 rounded-full bg-white/80" />
      </div>
      <Mic2 size={10} className="shrink-0" />
      <span className="min-w-0 truncate">{voice.name.replace(/^Voice:\s*/, "")}</span>
      {voice.volume < 1 &&
        (voice.volume === 0 ? (
          <VolumeX size={10} className="shrink-0" />
        ) : (
          <span className="shrink-0 text-[9px] text-foreground/80">
            {Math.round(voice.volume * 100)}%
          </span>
        ))}
      {trimmed && <span className="shrink-0 text-[9px]">trim</span>}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onOpenSettings();
        }}
        title="Open speech settings (volume, lip sync, transcript)"
        aria-label="Open speech settings"
        className="ml-auto hidden shrink-0 rounded px-0.5 text-foreground/80 hover:bg-black/30 hover:text-foreground group-hover:block"
      >
        <SlidersHorizontal size={10} />
      </button>
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        title="Remove speech from this character"
        aria-label="Remove speech from this character"
        className="hidden shrink-0 rounded px-0.5 text-foreground/80 hover:bg-black/30 hover:text-foreground group-hover:block"
      >
        <X size={10} />
      </button>
    </div>
  );
}

function buildExpandedClipLayout(
  clip: CharacterCompositionClip,
  presetMap: Map<string, MotionPreset>,
  mediaAssets: Map<string, MediaAsset>,
): ExpandedClipLayout {
  const motions = clip.character.motions ?? [];
  const voices = voicesForCharacterClip(clip, mediaAssets);
  const voiceRows = voices.length > 0 ? 1 : 0;
  if (motions.length === 0) {
    if (voiceRows > 0) {
      return { voices, groups: [], height: MOTION_PARENT_HEIGHT + MOTION_ROW_HEIGHT };
    }
    const emptyGroup: MotionGroupLayout = { category: "custom", label: "Motions", rows: [[]] };
    return {
      voices,
      groups: [emptyGroup],
      height: MOTION_PARENT_HEIGHT + MOTION_ROW_HEIGHT,
    };
  }

  const groups = MOTION_CATEGORY_ORDER.flatMap((category) => {
    const categoryMotions = motions
      .filter((motion) => (presetMap.get(motion.presetId)?.category ?? "custom") === category)
      .map((motion) => ({ motion, preset: presetMap.get(motion.presetId) }));
    if (categoryMotions.length === 0) return [];
    return [
      {
        category,
        label: CATEGORY_LABELS[category],
        rows: packMotionsForRows(categoryMotions, clip),
      },
    ];
  });

  const rowCount = groups.reduce((sum, group) => sum + group.rows.length, 0);
  return {
    voices,
    groups,
    height:
      MOTION_PARENT_HEIGHT +
      voiceRows * MOTION_ROW_HEIGHT +
      Math.max(1, rowCount) * MOTION_ROW_HEIGHT,
  };
}

// One voice bar per speech (start + own audio length). The bar spans the audio's
// length, not the whole character clip — VoiceBlock clamps width + flags "trim".
function voicesForCharacterClip(
  clip: CharacterCompositionClip,
  mediaAssets: Map<string, MediaAsset>,
): VoiceLaneSummary[] {
  return characterSpeeches(clip.character).map((speech) => {
    const asset = mediaAssets.get(speech.audioId);
    const line = asset?.voiceLine?.text?.trim() ?? clip.character.voiceLine?.text?.trim();
    const sourceDuration = asset?.duration && asset.duration > 0 ? asset.duration : undefined;
    const mediaStart = Math.max(0, speech.mediaStartTime ?? 0);
    // Trimmed length when set; otherwise the remaining source after the in-point.
    const duration =
      speech.duration ??
      (sourceDuration !== undefined ? sourceDuration - mediaStart : clip.duration);
    return {
      id: speech.id,
      start: speech.start,
      name: line ? `Voice: ${line}` : (asset?.name ?? "Voice / lip sync"),
      duration,
      volume: speech.volume ?? 1,
      mediaStart,
      sourceDuration,
    };
  });
}

function packMotionsForRows(
  motions: PackedMotion[],
  clip: CharacterCompositionClip,
): PackedMotion[][] {
  const sorted = [...motions].sort((a, b) => {
    const aDur = motionDuration(a.motion, a.preset);
    const bDur = motionDuration(b.motion, b.preset);
    return (
      a.motion.offset - b.motion.offset ||
      aDur - bDur ||
      (a.preset?.name ?? "").localeCompare(b.preset?.name ?? "") ||
      a.motion.id.localeCompare(b.motion.id)
    );
  });
  const rows: PackedMotion[][] = [];
  const rowIntervals: TimeSpan[][] = [];

  for (const item of sorted) {
    const intervals = intervalsForMotion(item.motion, item.preset, clip.duration);
    let rowIndex = rows.findIndex(
      (_, index) => !intervalsOverlapAny(intervals, rowIntervals[index]),
    );
    if (rowIndex === -1) {
      rowIndex = rows.length;
      rows.push([]);
      rowIntervals.push([]);
    }
    rows[rowIndex].push(item);
    rowIntervals[rowIndex].push(...intervals);
  }

  return rows.length > 0 ? rows : [[]];
}

interface TimeSpan {
  start: number;
  end: number;
}

function intervalsForMotion(
  motion: AppliedMotion,
  preset: MotionPreset | undefined,
  clipDuration: number,
): TimeSpan[] {
  const duration = motionDuration(motion, preset);
  const occurrences = preset
    ? generateMotionOccurrences(motion, preset, clipDuration)
    : [{ start: motion.offset, end: motion.offset + duration }];
  const visible = occurrences
    .map((occurrence) => ({
      start: Math.max(0, occurrence.start),
      end: Math.min(clipDuration, occurrence.end),
    }))
    .filter((interval) => interval.end > interval.start);
  return visible.length > 0 ? visible : [{ start: motion.offset, end: motion.offset + duration }];
}

function motionDuration(motion: AppliedMotion, preset: MotionPreset | undefined) {
  return Math.max(0.05, motion.duration ?? preset?.duration ?? 1);
}

function intervalsOverlapAny(intervals: TimeSpan[], existing: TimeSpan[]) {
  return intervals.some((next) =>
    existing.some((current) => next.start < current.end && current.start < next.end),
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

function formatSeconds(value: number) {
  return `${round(value, 1).toFixed(1)}s`;
}

function round(n: number, digits: number) {
  const k = Math.pow(10, digits);
  return Math.round(n * k) / k;
}
