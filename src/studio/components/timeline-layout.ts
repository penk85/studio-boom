// Pure Timeline row packing and expanded-lane layout calculations.

import {
  ACTION_LANE_DOT_COLORS,
  ACTION_LANE_LABELS,
  ACTION_LANE_ORDER,
  type ActionLaneKind,
  actionLaneForPreset,
} from "../presets/action-terminology";
import { generateMotionOccurrences } from "../presets/apply";
import type { CompositionOutlineItem } from "../hyperframes/composition-outline";
import type {
  AppliedMotion,
  CharacterCompositionClip,
  ClipMotionStep,
  EditorClip,
  MediaAsset,
  MotionPreset,
} from "../types";
import { characterSpeeches } from "../types";
import type { ProjectTimelineClip } from "../scenes";
import {
  COMPOSITION_OUTLINE_PARENT_HEIGHT,
  COMPOSITION_OUTLINE_ROW_HEIGHT,
  MOTION_PARENT_HEIGHT,
  MOTION_ROW_HEIGHT,
  TRACK_HEIGHT,
  VISUAL_MOTION_PARENT_HEIGHT,
  VISUAL_MOTION_ROW_HEIGHT,
} from "./timeline-constants";

export type TimelineCharacterClip = ProjectTimelineClip & CharacterCompositionClip;

export interface ExpandedClipRow {
  clip: TimelineCharacterClip;
  layout: ExpandedClipLayout;
  top: number;
}

export interface ExpandedKeyframeRow {
  clip: ProjectTimelineClip;
  top: number;
}

export interface ExpandedCompositionOutlineRow {
  clip: ProjectTimelineClip;
  outline: CompositionOutlineItem[];
  top: number;
}

export interface VisualMotionPacking {
  rowByMotionId: Map<string, number>;
  rowCount: number;
  overlappingMotionIds: Set<string>;
}

export interface LaneLayout {
  index: number;
  top: number;
  visualMotionRows: ExpandedKeyframeRow[];
  compositionOutlineRows: ExpandedCompositionOutlineRow[];
  motionRows: ExpandedClipRow[];
}

export interface TrackLayout {
  lanes: LaneLayout[];
  height: number;
}

export interface PackedMotion {
  motion: AppliedMotion;
  preset?: MotionPreset;
}

export interface MotionGroupLayout {
  id: ActionLaneKind;
  label: string;
  dotClass: string;
  rows: PackedMotion[][];
}

export interface ExpandedClipLayout {
  voices: VoiceLaneSummary[];
  groups: MotionGroupLayout[];
  height: number;
}

export interface VoiceLaneSummary {
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

export function buildTrackLayout({
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
  expandedMotionClips: ProjectTimelineClip[];
  expandedCompositionOutlines: ProjectTimelineClip[];
  compositionOutlinesByClipId: Map<string, CompositionOutlineItem[]>;
  expandedCharacters: TimelineCharacterClip[];
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

export function packVisualMotionRows(motions: ClipMotionStep[]): VisualMotionPacking {
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
    const first = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j += 1) {
      const second = sorted[j]!;
      if (first.startTime < second.endTime - 0.001 && second.startTime < first.endTime - 0.001) {
        overlappingMotionIds.add(first.id);
        overlappingMotionIds.add(second.id);
      }
    }
  }

  return {
    rowByMotionId,
    rowCount: Math.max(1, rowEndTimes.length),
    overlappingMotionIds,
  };
}

export function visualMotionLaneHeight(clip?: EditorClip): number {
  const rowCount = clip ? packVisualMotionRows(clip.motionSteps).rowCount : 1;
  return VISUAL_MOTION_PARENT_HEIGHT + rowCount * VISUAL_MOTION_ROW_HEIGHT;
}

export function compositionOutlineLaneHeight(outline: CompositionOutlineItem[]): number {
  return (
    COMPOSITION_OUTLINE_PARENT_HEIGHT + Math.max(1, outline.length) * COMPOSITION_OUTLINE_ROW_HEIGHT
  );
}

export function buildExpandedClipLayout(
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
    const emptyGroup: MotionGroupLayout = {
      id: "action",
      label: ACTION_LANE_LABELS.action,
      dotClass: ACTION_LANE_DOT_COLORS.action,
      rows: [[]],
    };
    return {
      voices,
      groups: [emptyGroup],
      height: MOTION_PARENT_HEIGHT + MOTION_ROW_HEIGHT,
    };
  }

  const groups = ACTION_LANE_ORDER.flatMap((lane) => {
    const laneMotions = motions
      .filter((motion) => actionLaneForPreset(presetMap.get(motion.presetId)) === lane)
      .map((motion) => ({ motion, preset: presetMap.get(motion.presetId) }));
    if (laneMotions.length === 0) return [];
    return [
      {
        id: lane,
        label: ACTION_LANE_LABELS[lane],
        dotClass: ACTION_LANE_DOT_COLORS[lane],
        rows: packMotionsForRows(laneMotions, clip),
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
export function voicesForCharacterClip(
  clip: CharacterCompositionClip,
  mediaAssets: Map<string, MediaAsset>,
): VoiceLaneSummary[] {
  return characterSpeeches(clip.character).map((speech) => {
    const asset = mediaAssets.get(speech.audioId);
    const line = asset?.voiceLine?.text?.trim() ?? clip.character.voiceLine?.text?.trim();
    const sourceDuration = asset?.duration && asset.duration > 0 ? asset.duration : undefined;
    const mediaStart = Math.max(0, speech.mediaStartTime ?? 0);
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

export function packMotionsForRows(
  motions: PackedMotion[],
  clip: CharacterCompositionClip,
): PackedMotion[][] {
  const sorted = [...motions].sort((first, second) => {
    const firstDuration = motionDuration(first.motion, first.preset);
    const secondDuration = motionDuration(second.motion, second.preset);
    return (
      first.motion.offset - second.motion.offset ||
      firstDuration - secondDuration ||
      (first.preset?.name ?? "").localeCompare(second.preset?.name ?? "") ||
      first.motion.id.localeCompare(second.motion.id)
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
