// Expanded character Action/Expression and speech rows beneath character clips.
import type { PointerEvent as ReactPointerEvent } from "react";
import { Mic2, SlidersHorizontal, VolumeX, X } from "lucide-react";
import { ACTION_CATEGORY_COLORS } from "../presets/action-terminology";
import { generateMotionOccurrences } from "../presets/apply";
import { resolveExclusiveMotionOverlaps } from "../presets/motion-scheduling";
import type { ProjectMutationOptions } from "../store";
import type { AppliedMotion, CharacterCompositionClip, EditorClip, MotionPreset } from "../types";
import {
  CLIP_DRAG_THRESHOLD_PX,
  MOTION_PARENT_HEIGHT,
  MOTION_ROW_HEIGHT,
} from "./timeline-constants";
import type {
  ExpandedClipLayout,
  TimelineCharacterClip,
  VoiceLaneSummary,
} from "./timeline-layout";
import {
  formatTimelineSeconds as formatSeconds,
  roundTimelineValue as round,
} from "./timeline-display";

export function CharacterMotionHeader({
  clip,
  layout,
}: {
  clip: CharacterCompositionClip;
  layout: ExpandedClipLayout;
}) {
  return (
    <div
      style={{ height: layout.height }}
      className="border-t border-border/60 bg-panel/50 text-ui-sm"
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
            key={`${group.id}-${rowIndex}`}
            style={{ height: MOTION_ROW_HEIGHT }}
            className="flex items-center gap-1 border-t border-border/40 px-3 pl-6 text-muted-foreground"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${group.dotClass}`} />
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

export function MotionLaneSet({
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
  clip: TimelineCharacterClip;
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
            key={group.id}
            className="absolute left-0 right-0"
            style={{
              top: thisGroupTop,
              height: group.rows.length * MOTION_ROW_HEIGHT,
            }}
          >
            {group.rows.map((row, rowIndex) => (
              <div
                key={`${group.id}-${rowIndex}`}
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
  const color = preset ? ACTION_CATEGORY_COLORS[preset.category] : ACTION_CATEGORY_COLORS.custom;

  const startDrag = (event: React.PointerEvent, mode: "move" | "resize") => {
    event.stopPropagation();
    if (event.button !== 0) return;
    onSelect();
    const startX = event.clientX;
    const startOffset = motion.offset;
    const startDuration = duration;
    const move = (pointerEvent: PointerEvent) => {
      const delta = (pointerEvent.clientX - startX) / zoom;
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
            onPointerDown={(event) => isPrimary && startDrag(event, "move")}
            onClick={onSelect}
            onKeyDown={(event) => {
              if (!isPrimary) return;
              if (event.key !== "Delete" && event.key !== "Backspace") return;
              event.preventDefault();
              event.stopPropagation();
              onDelete();
            }}
            className={`absolute top-1 h-5 overflow-hidden rounded border text-left text-ui-sm text-foreground shadow-sm ${
              color
            } ${isPrimary ? "cursor-grab" : "pointer-events-none opacity-45"} ${
              selected && isPrimary ? "ring-1 ring-primary-foreground" : ""
            }`}
            style={{
              left: (clip.start + start) * zoom,
              width: Math.max(8, (end - start) * zoom),
            }}
            title={`${preset?.name ?? "Action"} ${formatSeconds(start)}-${formatSeconds(end)}`}
          >
            {isPrimary && (
              <>
                <span className="block truncate px-1.5 leading-5">{preset?.name ?? "Action"}</span>
                <span
                  onPointerDown={(event) => startDrag(event, "resize")}
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

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const downX = event.clientX;
    const originalStart = voice.start;
    let moved = false;
    const move = (pointerEvent: PointerEvent) => {
      const delta = (pointerEvent.clientX - downX) / zoom;
      if (!moved && Math.abs(pointerEvent.clientX - downX) < CLIP_DRAG_THRESHOLD_PX) return;
      if (!moved) {
        moved = true;
        onHistoryCheckpoint();
      }
      onMove(Math.max(0, Math.min(clip.duration, originalStart + delta)), { history: false });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startTrimRight = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const downX = event.clientX;
    const originalDuration = voice.duration;
    const mediaStart = voice.mediaStart;
    let checkpointed = false;
    const move = (pointerEvent: PointerEvent) => {
      if (!checkpointed) {
        onHistoryCheckpoint();
        checkpointed = true;
      }
      let duration = Math.max(
        0.1,
        Math.min(
          clip.duration - voice.start,
          originalDuration + (pointerEvent.clientX - downX) / zoom,
        ),
      );
      if (voice.sourceDuration != null) {
        duration = Math.min(duration, Math.max(0.1, voice.sourceDuration - mediaStart));
      }
      onTrim({ duration }, { history: false });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startTrimLeft = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const downX = event.clientX;
    const originalStart = voice.start;
    const originalDuration = voice.duration;
    const originalMediaStart = voice.mediaStart;
    let checkpointed = false;
    const move = (pointerEvent: PointerEvent) => {
      if (!checkpointed) {
        onHistoryCheckpoint();
        checkpointed = true;
      }
      const delta = (pointerEvent.clientX - downX) / zoom;
      const minStart = Math.max(0, originalStart - originalMediaStart);
      const start = Math.max(
        minStart,
        Math.min(originalStart + originalDuration - 0.1, originalStart + delta),
      );
      const duration = originalDuration - (start - originalStart);
      const mediaStartTime = Math.max(0, originalMediaStart + (start - originalStart));
      onTrim({ start, duration, mediaStartTime }, { history: false });
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
      className="group absolute top-1 flex h-5 cursor-grab items-center gap-1 overflow-hidden rounded border border-cyan-300/80 bg-cyan-500/70 px-1.5 text-ui-sm text-foreground shadow-sm"
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
          <span className="shrink-0 text-ui-sm text-foreground/80">
            {Math.round(voice.volume * 100)}%
          </span>
        ))}
      {trimmed && <span className="shrink-0 text-ui-sm">trim</span>}
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
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
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
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
