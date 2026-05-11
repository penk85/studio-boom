// Timeline — multi-track strip with draggable clips, ruler, playhead.
import { ChevronDown, ChevronRight, Lock, Mic2, Minus, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { PlayerControls, liveTime, usePlayerStore } from "@hyperframes/studio";
import { db, uid } from "../db";
import { generateMotionOccurrences } from "../presets/apply";
import { resolveExclusiveMotionOverlaps } from "../presets/motion-scheduling";
import { useStudio } from "../store";
import { useHfMediaHealth } from "../hooks/useHfMediaHealth";
import type {
  MotionCategory,
  MotionPreset,
  AnyClip,
  AppliedMotion,
  CharacterClip,
  EditorClip,
  MediaClip,
} from "../types";
import { deriveEditorClips } from "../types";
import { fmtTime } from "../timeline-utils";

const TRACK_HEIGHT = 44;
const MOTION_ROW_HEIGHT = 28;
const MOTION_PARENT_HEIGHT = 24;
const RULER_HEIGHT = 28;
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
    return () => { unsub(); };
  }, []);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const headerTracksRef = useRef<HTMLDivElement>(null);
  const [expandedClipIds, setExpandedClipIds] = useState<Set<string>>(new Set());
  const [selectedMotionId, setSelectedMotionId] = useState<string | null>(null);
  const queriedPresets = useLiveQuery(() => db.motionPresets.toArray(), []);
  const presets = useMemo(() => queriedPresets ?? [], [queriedPresets]);
  const presetMap = useMemo(() => new Map(presets.map((p) => [p.id, p] as const)), [presets]);
  const mediaHealth = useHfMediaHealth(project?.hf);
  if (!project) return null;
  const totalWidth = Math.max(1200, project.hf.duration * zoom);
  const timelineClips = clips.filter((clip) => !isLinkedSpeechAudioClip(clip));
  const linkedSpeechByCharacterId = new Map<string, EditorClip>(
    clips
      .filter(isLinkedSpeechAudioClip)
      .map((clip) => [clip.linkedCharacterClipId!, clip] as const),
  );
  const expandedCharacters = clips.filter(
    (clip) => clip.kind === "character" && expandedClipIds.has(clip.id),
  );
  const expandedLayouts = new Map<string, ExpandedClipLayout>(
    expandedCharacters.map(
      (clip) =>
        [
          clip.id,
          buildExpandedClipLayout(clip, presetMap, linkedSpeechByCharacterId.get(clip.id)),
        ] as const,
    ),
  );
  const trackLayouts = tracks.map((track, trackIndex) =>
    buildTrackLayout({
      trackIndex,
      laneCount: Math.max(1, track.lanes ?? 1),
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
                          {lane.expandedRows.map((row) => (
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
                      return (
                        <ClipBlock
                          key={c.id}
                          clip={c}
                          missingMediaIds={missingMediaIds}
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
                          onChange={(p) => updateClip(c.id, p)}
                          onDelete={() => removeClip(c.id)}
                        />
                      );
                    })}
                  {lanes.flatMap((lane) =>
                    lane.expandedRows.map((row) => (
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
                          updateClip(row.clip.id, { motions } as Partial<CharacterClip>)
                        }
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
                background: "var(--color-playhead)",
                boxShadow: "0 0 8px var(--color-playhead)",
              }}
            />
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

function ClipBlock({
  clip,
  missingMediaIds,
  zoom,
  selected,
  onSelect,
  onChange,
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
  zoom: number;
  selected: boolean;
  tracks: number;
  duration: number;
  laneTops: number[];
  top: number;
  onSelect: () => void;
  onChange: (p: Partial<AnyClip>) => void;
  onDelete: () => void;
  presetMap: Map<string, MotionPreset>;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const color =
    clip.kind === "audio"
      ? "bg-clip-audio"
      : clip.kind === "character"
        ? "bg-clip-character"
        : clip.kind === "video"
          ? "bg-clip"
          : "bg-clip-bg";

  const lane = clip.laneIndex ?? 0;
  const linkedAudio = clip.kind === "audio" && !!clip.linkedCharacterClipId;
  const clipMotions = clip.kind === "character" ? (clip.motions ?? []) : [];
  const missingMediaTitle =
    missingMediaIds.length > 0 ? `Missing media: ${missingMediaIds.join(", ")}` : undefined;

  const onMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
    if (e.button !== 0) return;
    if (linkedAudio) return;
    const sx = e.clientX,
      sy = e.clientY;
    const ostart = clip.start;
    const olane = lane;
    const oLaneTop = laneTops[olane] ?? olane * TRACK_HEIGHT;
    const move = (ev: MouseEvent) => {
      const ns = Math.max(0, Math.min(duration - clip.duration, ostart + (ev.clientX - sx) / zoom));
      // Snap vertical drag to nearest lane within the track.
      const dy = ev.clientY - sy;
      const newLane = nearestLaneIndex(laneTops, oLaneTop + dy + TRACK_HEIGHT / 2);
      onChange({ start: ns, laneIndex: newLane });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const onResizeRight = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (linkedAudio) return;
    const sx = e.clientX,
      od = clip.duration;
    const move = (ev: MouseEvent) => {
      const nd = Math.max(0.1, Math.min(duration - clip.start, od + (ev.clientX - sx) / zoom));
      onChange({ duration: nd });
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
    if (linkedAudio) return;
    const sx = e.clientX,
      ostart = clip.start,
      od = clip.duration;
    const move = (ev: MouseEvent) => {
      const dx = (ev.clientX - sx) / zoom;
      const ns = Math.max(0, Math.min(ostart + od - 0.1, ostart + dx));
      const nd = od - (ns - ostart);
      onChange({ start: ns, duration: nd });
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
      onMouseDown={onMouseDown}
      onKeyDown={(e) => {
        if (linkedAudio) return;
        if (e.key === "Delete" || e.key === "Backspace") onDelete();
      }}
      tabIndex={0}
      className={`group absolute overflow-hidden rounded ${linkedAudio ? "cursor-not-allowed opacity-90" : "cursor-grab"} ${color} ${selected ? "ring-2 ring-primary" : "ring-1 ring-black/30"}`}
      style={{
        left: clip.start * zoom,
        width: Math.max(8, clip.duration * zoom),
        top,
        height: TRACK_HEIGHT - 8,
      }}
      title={missingMediaTitle ? `${clip.name}\n${missingMediaTitle}` : clip.name}
    >
      <div className="flex h-full items-center gap-1 px-2 text-[11px] font-medium text-foreground/95 mix-blend-luminosity">
        {clip.kind === "character" && (
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpanded();
            }}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-black/20"
            aria-label={expanded ? "Collapse motion lanes" : "Expand motion lanes"}
            title={expanded ? "Hide motion lanes" : "Show motion lanes"}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        )}
        {linkedAudio && <Lock size={11} className="shrink-0" aria-label="Linked speech audio" />}
        <span className="truncate">{clip.name}</span>
        {(missingMediaIds.length > 0 || clipMotions.length > 0) && (
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {missingMediaIds.length > 0 && (
              <TriangleAlert
                size={13}
                className="text-amber-200 drop-shadow"
                aria-label={missingMediaTitle}
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
      {!linkedAudio && (
        <>
          <div
            onMouseDown={onResizeLeft}
            className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize bg-black/30 opacity-0 group-hover:opacity-100"
          />
          <div
            onMouseDown={onResizeRight}
            className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize bg-black/30 opacity-0 group-hover:opacity-100"
          />
        </>
      )}
    </div>
  );
}

interface ExpandedClipRow {
  clip: EditorClip;
  layout: ExpandedClipLayout;
  top: number;
}

interface LaneLayout {
  index: number;
  top: number;
  expandedRows: ExpandedClipRow[];
}

interface TrackLayout {
  lanes: LaneLayout[];
  height: number;
}

function buildTrackLayout({
  trackIndex,
  laneCount,
  expandedCharacters,
  expandedLayouts,
}: {
  trackIndex: number;
  laneCount: number;
  expandedCharacters: EditorClip[];
  expandedLayouts: Map<string, ExpandedClipLayout>;
}): TrackLayout {
  let top = 0;
  const lanes: LaneLayout[] = [];
  for (let laneIndex = 0; laneIndex < laneCount; laneIndex++) {
    const expandedRows: ExpandedClipRow[] = [];
    const laneTop = top;
    top += TRACK_HEIGHT;
    const expandedInLane = expandedCharacters
      .filter(
        (clip) => clip.trackIndex === trackIndex && Math.max(0, clip.laneIndex ?? 0) === laneIndex,
      )
      .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    for (const clip of expandedInLane) {
      const layout = expandedLayouts.get(clip.id);
      if (!layout) continue;
      expandedRows.push({ clip, layout, top });
      top += layout.height;
    }
    lanes.push({ index: laneIndex, top: laneTop, expandedRows });
  }
  return { lanes, height: top };
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
  voice?: EditorClip;
  groups: MotionGroupLayout[];
  height: number;
}

function CharacterMotionHeader({ clip, layout }: { clip: EditorClip; layout: ExpandedClipLayout }) {
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
      {layout.voice && (
        <div
          style={{ height: MOTION_ROW_HEIGHT }}
          className="flex items-center gap-1 border-t border-border/40 px-3 pl-6 text-muted-foreground"
        >
          <Mic2 size={10} />
          <span className="truncate">Voice / lip sync</span>
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
  createMotionId,
  presetMap,
}: {
  clip: EditorClip;
  zoom: number;
  top: number;
  layout: ExpandedClipLayout;
  selectedMotionId: string | null;
  onSelect: () => void;
  onSelectMotion: (id: string | null) => void;
  onChange: (motions: AppliedMotion[]) => void;
  createMotionId: () => string;
  presetMap: Map<string, MotionPreset>;
}) {
  const motions = clip.motions ?? [];
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
  let groupTop = MOTION_PARENT_HEIGHT + (layout.voice ? MOTION_ROW_HEIGHT : 0);
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
      {layout.voice && (
        <div
          className="absolute left-0 right-0 border-t border-border/40"
          style={{ top: voiceTop, height: MOTION_ROW_HEIGHT }}
        >
          <VoiceBlock clip={clip} audioClip={layout.voice} zoom={zoom} />
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
  audioClip,
  zoom,
}: {
  clip: EditorClip;
  audioClip: EditorClip;
  zoom: number;
}) {
  const offset = Math.max(0, audioClip.start - clip.start);
  const end = Math.min(clip.duration, offset + audioClip.duration);
  const width = Math.max(8, Math.max(0.05, end - offset) * zoom);
  const trimmed = audioClip.duration > Math.max(0, clip.duration - offset) + 0.01;
  return (
    <div
      className="absolute top-1 flex h-5 items-center gap-1 overflow-hidden rounded border border-cyan-300/80 bg-cyan-500/70 px-1.5 text-[10px] text-foreground shadow-sm"
      style={{
        left: (clip.start + offset) * zoom,
        width,
      }}
      title={`${audioClip.name}${trimmed ? " (trimmed by character clip)" : ""}`}
    >
      <Lock size={10} className="shrink-0" />
      <span className="min-w-0 truncate">{audioClip.name.replace(/^🎙\s*/, "")}</span>
      {trimmed && <span className="ml-auto shrink-0 text-[9px]">trim</span>}
    </div>
  );
}

function buildExpandedClipLayout(
  clip: EditorClip,
  presetMap: Map<string, MotionPreset>,
  voice?: EditorClip,
): ExpandedClipLayout {
  const motions = clip.motions ?? [];
  if (motions.length === 0) {
    if (voice) {
      return {
        voice,
        groups: [],
        height: MOTION_PARENT_HEIGHT + MOTION_ROW_HEIGHT,
      };
    }
    const emptyGroup: MotionGroupLayout = {
      category: "custom",
      label: "Motions",
      rows: [[]],
    };
    return {
      voice,
      groups: [emptyGroup],
      height: MOTION_PARENT_HEIGHT + (voice ? MOTION_ROW_HEIGHT : 0) + MOTION_ROW_HEIGHT,
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
    voice,
    groups,
    height:
      MOTION_PARENT_HEIGHT +
      (voice ? MOTION_ROW_HEIGHT : 0) +
      Math.max(1, rowCount) * MOTION_ROW_HEIGHT,
  };
}

function packMotionsForRows(motions: PackedMotion[], clip: EditorClip): PackedMotion[][] {
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

function isLinkedSpeechAudioClip(
  clip: EditorClip,
): clip is EditorClip & { linkedCharacterClipId: string } {
  return clip.kind === "audio" && !!clip.linkedCharacterClipId;
}

function formatSeconds(value: number) {
  return `${round(value, 1).toFixed(1)}s`;
}

function round(n: number, digits: number) {
  const k = Math.pow(10, digits);
  return Math.round(n * k) / k;
}
