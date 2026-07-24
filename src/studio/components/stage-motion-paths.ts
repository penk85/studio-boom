// Pure Stage motion-path derivation shared by the Stage controller and SVG chrome.

import type { ClipKeyframeSelection, EditorClip } from "../types";
import { getKeyframesForProperty, sampleClipKeyframedState } from "../hyperframes/keyframes";
import { buildPositionPath, type PositionCheckpoint } from "../hyperframes/motion-path";
import { compositionPointToCss, type StageGeometry } from "./stage-helpers";
import type { StageDrag } from "./stage-interactions";

export interface StageMotionPathCheckpoint {
  id: string;
  x: number;
  y: number;
  selected: boolean;
}

export interface StageMotionPathPolylinePoint {
  x: number;
  y: number;
  time: number;
}

export interface StageMotionPath {
  id: string;
  active: boolean;
  motionId?: string;
  polyline: StageMotionPathPolylinePoint[];
  checkpoints: StageMotionPathCheckpoint[];
}

export function getStageMotionPaths(
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

export function motionPathData(points: StageMotionPathPolylinePoint[]) {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${formatSvgNumber(point.x)} ${formatSvgNumber(point.y)}`,
    )
    .join(" ");
}

function formatSvgNumber(value: number) {
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "0";
}
