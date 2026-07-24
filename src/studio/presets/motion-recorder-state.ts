// Pure keypose, override, variant, and flexible-action state for the action recorder.

import {
  defaultLimbPathDeformForPart,
  variantKeyForPart,
  variantLabelForPart,
} from "../character/character-utils";
import type { CharacterRuntime, RuntimeCharacterSlot } from "../character/runtime";
import type {
  CharacterPart,
  MotionCategory,
  MotionKeyframe,
  MotionPreset,
  MotionTrack,
  PartRole,
  RecordedKeypose,
  RecordedPartOverride,
} from "../types";
import { sampleMotionEase } from "./easing";

export type CharacterSlot = RuntimeCharacterSlot;

export interface RecorderPartState {
  slotId: string;
  target?: "slot" | "bone";
  boneId?: string;
  poseSwap?: string;
  dx: number;
  dy: number;
  scale: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
  skewY: number;
  rotation: number;
  bend: number;
  pathEndX: number;
  pathEndY: number;
  pathCurveX: number;
  pathCurveY: number;
  originX: number;
  originY: number;
  opacity: number;
}

export interface RecorderOverridePatch {
  slotId: string;
  patch: Partial<RecorderPartState>;
}

export interface FlexiblePointChange {
  point: "end" | "curve";
  patch: Partial<RecorderPartState>;
  canvasDelta: { x: number; y: number };
}

const MOTION_VALUE_KEYS = [
  "dx",
  "dy",
  "scale",
  "scaleX",
  "scaleY",
  "skewX",
  "skewY",
  "rotation",
  "bend",
  "pathEndX",
  "pathEndY",
  "pathCurveX",
  "pathCurveY",
  "originX",
  "originY",
  "opacity",
] as const;

type MotionValueKey = (typeof MOTION_VALUE_KEYS)[number];

const MOTION_VALUE_DEFAULTS: Record<MotionValueKey, number> = {
  dx: 0,
  dy: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  skewX: 0,
  skewY: 0,
  rotation: 0,
  bend: 0,
  pathEndX: 0,
  pathEndY: 0,
  pathCurveX: 0,
  pathCurveY: 0,
  originX: 0.5,
  originY: 0.5,
  opacity: 1,
};

export function initialKeyposesForPreset(
  preset: MotionPreset | undefined,
  runtime: CharacterRuntime,
): RecordedKeypose[] {
  if (!preset) return [initialRestKeypose()];
  const keyposes = preset.keyposes?.length
    ? cloneKeyposes(preset.keyposes)
    : keyposesFromTracks(preset, runtime);
  return ensureInitialRestKeypose(keyposes);
}

export function initialRestKeypose(): RecordedKeypose {
  return {
    t: 0,
    parts: [],
  };
}

export function ensureInitialRestKeypose(keyposes: RecordedKeypose[]): RecordedKeypose[] {
  const sorted = cloneKeyposes(keyposes).sort((first, second) => first.t - second.t);
  if (sorted.length === 0) return [initialRestKeypose()];
  if (Math.abs(sorted[0].t) <= 0.001) return sorted;
  return [initialRestKeypose(), ...sorted];
}

export function customPresetName(name: string) {
  return /\bcustom$/i.test(name.trim()) ? name : `${name} custom`;
}

export function recorderActionLimbPathForPart(
  part: CharacterPart,
  deform: Extract<CharacterPart["deform"], { mode: "limb-path" }>,
) {
  const neutral = defaultLimbPathDeformForPart(part);
  if (neutral.mode !== "limb-path") return null;
  return {
    ...deform,
    width: deform.width ?? neutral.width,
    segments: deform.segments ?? neutral.segments,
  };
}

export function constrainFlexibleCurvePatch({
  path,
  baseCurve,
  desired,
  override,
}: {
  path: Extract<CharacterPart["deform"], { mode: "limb-path" }>;
  baseCurve: { x: number; y: number };
  desired: { x: number; y: number };
  override: RecorderPartState;
}): Partial<RecorderPartState> {
  const currentEnd = {
    x: path.end.x + override.pathEndX,
    y: path.end.y + override.pathEndY,
  };
  const axis = {
    x: currentEnd.x - path.start.x,
    y: currentEnd.y - path.start.y,
  };
  const length = Math.hypot(axis.x, axis.y);
  if (length <= 0.001) {
    return {
      pathCurveX: round(desired.x - baseCurve.x, 1),
      pathCurveY: round(desired.y - baseCurve.y, 1),
    };
  }
  const ux = axis.x / length;
  const uy = axis.y / length;
  const nx = -uy;
  const ny = ux;
  const mid = {
    x: path.start.x + axis.x * 0.5,
    y: path.start.y + axis.y * 0.5,
  };
  const dx = desired.x - mid.x;
  const dy = desired.y - mid.y;
  const along = Math.max(-length * 0.24, Math.min(length * 0.24, dx * ux + dy * uy));
  const maxCross = Math.max(12, Math.min(length * 0.72, Math.max(length * 0.38, path.width ?? 0)));
  const cross = Math.max(-maxCross, Math.min(maxCross, dx * nx + dy * ny));
  const constrained = {
    x: mid.x + ux * along + nx * cross,
    y: mid.y + uy * along + ny * cross,
  };
  return {
    pathCurveX: round(constrained.x - baseCurve.x, 1),
    pathCurveY: round(constrained.y - baseCurve.y, 1),
  };
}

export function editorTitle(category: MotionCategory) {
  switch (category) {
    case "expression":
      return "Expression Editor";
    case "gesture":
      return "Gesture Action Editor";
    case "full-body":
      return "Full Body Action Editor";
    case "camera":
      return "Camera Cue Editor";
    case "headTurn":
      return "Head Turn Editor";
    case "custom":
      return "Custom Action Editor";
  }
}

export function cloneKeyposes(keyposes: RecordedKeypose[]): RecordedKeypose[] {
  return keyposes.map((keypose) => ({
    ...keypose,
    parts: keypose.parts.map((part) => ({ ...part })),
    camera: keypose.camera ? { ...keypose.camera } : undefined,
    anticipation: keypose.anticipation ? { ...keypose.anticipation } : undefined,
  }));
}

export function findKeyposeAt(keyposes: RecordedKeypose[], time: number) {
  return keyposes.find((keypose) => Math.abs(keypose.t - time) <= 0.001) ?? null;
}

export function adjacentKeyposeIndex(
  keyposes: RecordedKeypose[],
  selectedTime: number | null,
  draftTime: number,
  direction: -1 | 1,
) {
  if (keyposes.length === 0) return -1;
  const currentIndex =
    selectedTime == null
      ? -1
      : keyposes.findIndex((keypose) => Math.abs(keypose.t - selectedTime) <= 0.001);
  if (currentIndex >= 0) {
    const nextIndex = currentIndex + direction;
    return nextIndex >= 0 && nextIndex < keyposes.length ? nextIndex : -1;
  }
  if (direction > 0) {
    return keyposes.findIndex((keypose) => keypose.t > draftTime + 0.001);
  }
  for (let index = keyposes.length - 1; index >= 0; index -= 1) {
    if (keyposes[index]!.t < draftTime - 0.001) return index;
  }
  return -1;
}

export function keyposeDraftSignature(keypose: RecordedKeypose): string {
  return JSON.stringify({
    t: keypose.t,
    parts: keypose.parts,
    faceTurnX: keypose.faceTurnX,
    faceTurnY: keypose.faceTurnY,
    camera: keypose.camera,
  });
}

function keyposesFromTracks(preset: MotionPreset, runtime: CharacterRuntime): RecordedKeypose[] {
  const tracks = preset.tracks ?? [];
  if (tracks.length === 0) return [];
  const duration = Math.max(0.1, preset.duration);
  const normalizedTimes = new Set<number>([0, 1]);
  for (const track of tracks) {
    for (const keyframe of track.keyframes) {
      normalizedTimes.add(round(Math.max(0, Math.min(1, keyframe.t)), 4));
    }
  }
  return Array.from(normalizedTimes)
    .sort((first, second) => first - second)
    .map((normalizedTime) => {
      const parts: RecordedPartOverride[] = [];
      let camera: RecordedKeypose["camera"];
      for (const track of tracks) {
        const sample = sampleMotionTrack(track, normalizedTime);
        const keys = usedMotionValueKeys(track);
        if (track.partRole === "__camera") {
          camera = {
            dx: sample.dx,
            dy: sample.dy,
            zoom: sample.scale,
          };
          continue;
        }
        for (const slot of slotsForTrack(track, runtime)) {
          parts.push(recordedOverrideFromMotionTrack(track, slot, sample, keys));
        }
      }
      return {
        t: round(normalizedTime * duration, 3),
        parts,
        camera,
      };
    });
}

function slotsForTrack(track: MotionTrack, runtime: CharacterRuntime) {
  if (track.slotId) return runtime.slots.filter((slot) => slot.id === track.slotId);
  if (track.target === "bone" && track.boneId) {
    return runtime.slots.filter(
      (slot) => runtime.bindingBySlot.get(slot.id)?.effectiveBoneId === track.boneId,
    );
  }
  return runtime.slots.filter((slot) => slot.role === track.partRole);
}

function usedMotionValueKeys(track: MotionTrack): MotionValueKey[] {
  return MOTION_VALUE_KEYS.filter((key) =>
    track.keyframes.some((keyframe) => keyframe[key] !== undefined),
  );
}

function recordedOverrideFromMotionTrack(
  track: MotionTrack,
  slot: CharacterSlot,
  sample: Partial<Record<MotionValueKey, number>>,
  keys: MotionValueKey[],
): RecordedPartOverride {
  const out: RecordedPartOverride =
    track.target === "bone" && track.boneId
      ? {
          target: "bone",
          boneId: track.boneId,
          slotId: slot.id,
          partRole: slot.role,
        }
      : { target: "slot", partRole: slot.role, slotId: slot.id };
  if (track.poseSwap) out.poseSwap = track.poseSwap;
  const writable = out as RecordedPartOverride & Partial<Record<MotionValueKey, number>>;
  for (const key of keys) {
    const value = sample[key];
    if (value !== undefined) writable[key] = round(value, 4);
  }
  return out;
}

function sampleMotionTrack(
  track: MotionTrack,
  normalizedTime: number,
): Partial<Record<MotionValueKey, number>> {
  const sorted = [...track.keyframes].sort((first, second) => first.t - second.t);
  if (sorted.length === 0) return {};
  if (sorted.length === 1) return sampleSingleMotionKeyframe(sorted[0]!);
  let first = sorted[0]!;
  let second = sorted[sorted.length - 1]!;
  for (let index = 0; index < sorted.length - 1; index += 1) {
    if (sorted[index + 1]!.t >= normalizedTime) {
      first = sorted[index]!;
      second = sorted[index + 1]!;
      break;
    }
  }
  const span = Math.max(0.0001, second.t - first.t);
  const progress = sampleMotionEase(
    second.ease ?? first.ease,
    Math.max(0, Math.min(1, (normalizedTime - first.t) / span)),
  );
  const out: Partial<Record<MotionValueKey, number>> = {};
  for (const key of MOTION_VALUE_KEYS) {
    const firstValue = first[key];
    const secondValue = second[key];
    if (firstValue === undefined && secondValue === undefined) continue;
    if (firstValue === undefined) out[key] = secondValue;
    else if (secondValue === undefined) out[key] = firstValue;
    else out[key] = firstValue + (secondValue - firstValue) * progress;
  }
  return out;
}

function sampleSingleMotionKeyframe(
  keyframe: MotionKeyframe,
): Partial<Record<MotionValueKey, number>> {
  const out: Partial<Record<MotionValueKey, number>> = {};
  for (const key of MOTION_VALUE_KEYS) {
    const value = keyframe[key] ?? MOTION_VALUE_DEFAULTS[key];
    if (keyframe[key] !== undefined) out[key] = value;
  }
  return out;
}

export function defaultOverride(slotId: string, part?: CharacterPart): RecorderPartState {
  return {
    slotId,
    dx: 0,
    dy: 0,
    scale: 1,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
    skewY: 0,
    rotation: 0,
    bend: 0,
    pathEndX: 0,
    pathEndY: 0,
    pathCurveX: 0,
    pathCurveY: 0,
    originX: part?.anchorX ?? 0.5,
    originY: part?.anchorY ?? 0.5,
    opacity: 1,
  };
}

export function recorderOverrideMapsEqual(
  first: Map<string, RecorderPartState>,
  second: Map<string, RecorderPartState>,
): boolean {
  if (first.size !== second.size) return false;
  for (const [key, firstValue] of first.entries()) {
    const secondValue = second.get(key);
    if (!secondValue || !recorderOverridesEqual(firstValue, secondValue)) return false;
  }
  return true;
}

export function recorderOverridesEqual(
  first: RecorderPartState,
  second: RecorderPartState,
): boolean {
  return (
    first.slotId === second.slotId &&
    first.target === second.target &&
    first.boneId === second.boneId &&
    first.poseSwap === second.poseSwap &&
    Object.is(first.dx, second.dx) &&
    Object.is(first.dy, second.dy) &&
    Object.is(first.scale, second.scale) &&
    Object.is(first.scaleX, second.scaleX) &&
    Object.is(first.scaleY, second.scaleY) &&
    Object.is(first.skewX, second.skewX) &&
    Object.is(first.skewY, second.skewY) &&
    Object.is(first.rotation, second.rotation) &&
    Object.is(first.bend, second.bend) &&
    Object.is(first.pathEndX, second.pathEndX) &&
    Object.is(first.pathEndY, second.pathEndY) &&
    Object.is(first.pathCurveX, second.pathCurveX) &&
    Object.is(first.pathCurveY, second.pathCurveY) &&
    Object.is(first.originX, second.originX) &&
    Object.is(first.originY, second.originY) &&
    Object.is(first.opacity, second.opacity)
  );
}

export function isDirtyOverride(override: RecorderPartState | undefined, part?: CharacterPart) {
  if (!override) return false;
  const rest = defaultOverride(override.slotId, part);
  return (
    override.poseSwap !== undefined ||
    override.dx !== 0 ||
    override.dy !== 0 ||
    override.scale !== 1 ||
    override.scaleX !== 1 ||
    override.scaleY !== 1 ||
    override.skewX !== 0 ||
    override.skewY !== 0 ||
    override.rotation !== 0 ||
    override.bend !== 0 ||
    override.pathEndX !== 0 ||
    override.pathEndY !== 0 ||
    override.pathCurveX !== 0 ||
    override.pathCurveY !== 0 ||
    override.originX !== rest.originX ||
    override.originY !== rest.originY ||
    override.opacity !== 1
  );
}

export function variantOptionsForSlot(slot: CharacterSlot) {
  const variants = new Map<string, string>();
  for (const part of slot.parts) {
    if (!part.variant && !part.pose && !part.viseme && !part.eyeState) continue;
    const value = variantKeyForPart(part);
    if (!value) continue;
    variants.set(value, variantLabelForPart(part));
  }
  if (variants.size === 0) return [];
  const defaultValue = slot.role === "eye" ? "open" : slot.role === "mouth" ? "rest" : undefined;
  return [
    {
      value: "",
      label: defaultValue ? `Default (${variantLabel(slot.role, defaultValue)})` : "Default",
    },
    ...Array.from(variants, ([value, label]) => ({ value, label })),
  ];
}

function variantLabel(role: PartRole, value: string) {
  if (role === "mouth" && value === "O") return "Round / O";
  if (role === "mouth" && value === "MBP") return "Closed / MBP";
  if (role === "mouth" && value === "FV") return "Teeth / FV";
  if (role === "mouth" && value === "WQ") return "Pucker / WQ";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function roleLabel(role: PartRole) {
  return role
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function round(value: number, digits: number) {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

export function scaleMagnitude(value: number) {
  return round(Math.max(0.1, Math.abs(value || 1)), 2);
}

export function signedScaleValue(current: number, magnitude: number) {
  const sign = current < 0 ? -1 : 1;
  return round(sign * Math.max(0.1, Math.abs(magnitude)), 2);
}

export function toggleSignedScale(current: number) {
  return round((current < 0 ? 1 : -1) * scaleMagnitude(current), 2);
}
