// Draggable, trimmable Timeline clip block and its action summary badge.

import { ChevronDown, ChevronRight, TriangleAlert, Volume2, VolumeX } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  ACTION_CATEGORY_DOT_COLORS,
  ACTION_LANE_LABELS,
  actionBadgeFallback,
  actionLaneForPreset,
  actionTitle,
} from "../presets/action-terminology";
import type { ProjectMutationOptions } from "../store";
import type { AnyClip, AppliedMotion, EditorClip, MotionCategory, MotionPreset } from "../types";
import { isCharacterCompositionClip } from "../types";
import { CLIP_DRAG_THRESHOLD_PX, TRACK_HEIGHT } from "./timeline-constants";
import { isKeyframeEditableClip, nearestLaneIndex } from "./timeline-clip-utils";

export function TimelineClipBlock({
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
  const motionTitle = characterActionTitle(clipMotions, presetMap);
  const motionBadge = characterActionBadge(clipMotions, presetMap);
  const clipVolume = clip.volume ?? 1;
  const clipTitle = [
    clip.name,
    clip.kind === "audio" ? `Volume ${Math.round(clipVolume * 100)}%` : undefined,
    missingMediaTitle,
    malformedCompositionTitle,
    motionTitle,
  ]
    .filter(Boolean)
    .join("\n");

  const onMouseDown = (event: ReactMouseEvent) => {
    event.stopPropagation();
    onSelect();
    if (event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const originalStart = clip.start;
    const originalLane = lane;
    const originalLaneTop = laneTops[originalLane] ?? originalLane * TRACK_HEIGHT;
    let dragging = false;
    let checkpointed = false;
    const move = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) < CLIP_DRAG_THRESHOLD_PX) return;
      dragging = true;
      if (!checkpointed) {
        onHistoryCheckpoint();
        checkpointed = true;
      }
      const nextStart = Math.max(
        0,
        Math.min(duration - clip.duration, originalStart + (moveEvent.clientX - startX) / zoom),
      );
      const newLane = nearestLaneIndex(laneTops, originalLaneTop + dy + TRACK_HEIGHT / 2);
      onChange({ start: nextStart, laneIndex: newLane }, { history: false });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const isTrimMedia = clip.kind === "audio" || clip.kind === "video";
  const sourceDuration = clip.sourceDuration;

  const onResizeRight = (event: ReactMouseEvent) => {
    event.stopPropagation();
    const startX = event.clientX;
    const originalDuration = clip.duration;
    const mediaStart = clip.mediaStartTime ?? 0;
    let checkpointed = false;
    const move = (moveEvent: MouseEvent) => {
      if (!checkpointed) {
        onHistoryCheckpoint();
        checkpointed = true;
      }
      let nextDuration = Math.max(
        0.1,
        Math.min(duration - clip.start, originalDuration + (moveEvent.clientX - startX) / zoom),
      );
      if (isTrimMedia && sourceDuration != null) {
        nextDuration = Math.min(nextDuration, Math.max(0.1, sourceDuration - mediaStart));
      }
      onChange({ duration: nextDuration }, { history: false });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const onResizeLeft = (event: ReactMouseEvent) => {
    event.stopPropagation();
    const startX = event.clientX;
    const originalStart = clip.start;
    const originalDuration = clip.duration;
    const originalMediaStart = clip.mediaStartTime ?? 0;
    let checkpointed = false;
    const move = (moveEvent: MouseEvent) => {
      if (!checkpointed) {
        onHistoryCheckpoint();
        checkpointed = true;
      }
      const dx = (moveEvent.clientX - startX) / zoom;
      const minStart = isTrimMedia ? Math.max(0, originalStart - originalMediaStart) : 0;
      const nextStart = Math.max(
        minStart,
        Math.min(originalStart + originalDuration - 0.1, originalStart + dx),
      );
      const nextDuration = originalDuration - (nextStart - originalStart);
      if (isTrimMedia) {
        const newMediaStart = Math.max(0, originalMediaStart + (nextStart - originalStart));
        onChange(
          { start: nextStart, duration: nextDuration, mediaStartTime: newMediaStart },
          { history: false },
        );
      } else {
        onChange({ start: nextStart, duration: nextDuration }, { history: false });
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
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onKeyDown={(event) => {
        if (event.key === "Delete" || event.key === "Backspace") onDelete();
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
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
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
        <span className="min-w-0 flex-1 truncate">{clip.name}</span>
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
            {motionBadge && (
              <span
                className="flex max-w-28 shrink items-center gap-1 rounded bg-black/25 px-1.5 py-0.5 text-[9px] leading-none text-foreground/95 shadow-sm"
                title={motionBadge.title}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    ACTION_CATEGORY_DOT_COLORS[motionBadge.category]
                  }`}
                />
                <span className="truncate">{motionBadge.label}</span>
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

function characterActionBadge(
  motions: AppliedMotion[],
  presetMap: Map<string, MotionPreset>,
): { label: string; title: string; category: MotionCategory } | null {
  if (motions.length === 0) return null;
  const firstPreset = presetMap.get(motions[0]?.presetId ?? "");
  return {
    label: characterActionBadgeLabel(motions, presetMap),
    title: characterActionTitle(motions, presetMap) ?? "Action",
    category: firstPreset?.category ?? "custom",
  };
}

function characterActionBadgeLabel(
  motions: AppliedMotion[],
  presetMap: Map<string, MotionPreset>,
): string {
  if (motions.length === 0) return "";
  const firstName = presetMap.get(motions[0]?.presetId ?? "")?.name;
  if (motions.length === 1) return firstName ?? actionBadgeFallback(1);
  return firstName ? `${firstName} +${motions.length - 1}` : actionBadgeFallback(motions.length);
}

function characterActionTitle(
  motions: AppliedMotion[],
  presetMap: Map<string, MotionPreset>,
): string | undefined {
  if (motions.length === 0) return undefined;
  const names = motions.map(
    (motion, index) => presetMap.get(motion.presetId)?.name ?? `Action ${index + 1}`,
  );
  const lanes = new Set(
    motions.map((motion) => actionLaneForPreset(presetMap.get(motion.presetId))),
  );
  if (lanes.size === 1) {
    const lane = Array.from(lanes)[0]!;
    return `${ACTION_LANE_LABELS[lane]}: ${names.join(", ")}`;
  }
  return actionTitle(names);
}
