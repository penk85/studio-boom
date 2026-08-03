// Expanded stage-motion rows and draggable checkpoints beneath visual clips.
import { useMemo } from "react";
import { Plus } from "lucide-react";
import type { ProjectTimelineClip } from "../scenes";
import type { ClipKeyframeSelection, ClipMotionStep, EditorClip } from "../types";
import type { ClipMotionCheckpoint, ClipMotionEndpoint } from "../hyperframes/keyframes";
import { VISUAL_MOTION_PARENT_HEIGHT, VISUAL_MOTION_ROW_HEIGHT } from "./timeline-constants";
import { packVisualMotionRows, visualMotionLaneHeight } from "./timeline-layout";
import {
  formatTimelineSeconds as formatSeconds,
  roundTimelineValue as round,
} from "./timeline-display";

export function VisualMotionLaneHeader({ clip }: { clip: EditorClip }) {
  return (
    <div
      style={{ height: visualMotionLaneHeight(clip) }}
      className="border-t border-border/60 bg-panel/50"
    >
      <div
        className="flex items-center gap-1 px-3 text-ui-sm text-foreground"
        style={{ height: VISUAL_MOTION_PARENT_HEIGHT }}
      >
        <span className="text-muted-foreground">↳</span>
        <span className="min-w-0 flex-1 truncate">{clip.name}</span>
      </div>
      <div
        style={{ height: visualMotionLaneHeight(clip) - VISUAL_MOTION_PARENT_HEIGHT }}
        className="flex items-center border-t border-border/40 px-3 pl-6 text-ui-sm text-muted-foreground"
      >
        <span className="truncate">Move</span>
      </div>
    </div>
  );
}

export function VisualMotionLaneSet({
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
  clip: ProjectTimelineClip;
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
            className="absolute top-1/2 z-10 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-panel text-ui leading-none text-muted-foreground hover:bg-primary/20 hover:text-foreground"
            style={{ left: currentTime * zoom }}
            aria-label="Add move"
            title="Add a move at the playhead"
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
      className={`absolute h-6 overflow-visible rounded border text-left text-ui-sm text-foreground shadow-sm ${color} ${
        selected ? "ring-1 ring-primary-foreground" : ""
      } ${overlaps ? "outline outline-1 outline-amber-200/70" : ""}`}
      style={{ left, width, top: rowIndex * VISUAL_MOTION_ROW_HEIGHT + 3 }}
      title={`${motion.label} ${formatSeconds(motion.startTime)}-${formatSeconds(
        motion.endTime,
      )}${overlaps ? " overlaps another move" : ""}`}
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
        title="Drag to shift this move earlier or later"
      />
      <span
        onPointerDown={(event) => startDrag(event, "end")}
        className="absolute right-0 top-0 h-full w-2 cursor-ew-resize rounded-r bg-white/55"
        title="Drag to change when this move ends"
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
