// Effects — the same idea Actions are for characters, but for any clip.
//
// An Effect is something a clip *does*: appear, disappear, emphasise, drift
// closer. Most of them do not move the clip at all — Fade is opacity, Pop and
// Slow zoom are scale — which is exactly why they are Effects and not Moves. A
// Move is the narrower thing: a clip travelling a path, made of Points.
//
// Underneath, an Effect is written as ordinary Move data (keyframes plus a step
// that groups them), because that is the only animation model the renderer has.
// That is an implementation detail: once applied there is nothing special about
// an Effect, and every Point it created stays editable below it.
//
// Keyframe x/y are stored as offsets from the clip's own position (see
// `storedValuesFromState`), so a preset can describe motion without knowing
// where on the canvas the clip sits.
import type { Keyframe, KeyframeProperties } from "@hyperframes/core";
import type { ClipMotionStepMeta } from "./keyframes";

export type EffectPresetId =
  | "fade-in"
  | "fade-out"
  | "slide-in-left"
  | "slide-in-right"
  | "rise-up"
  | "pop"
  | "ken-burns";

export interface EffectPreset {
  id: EffectPresetId;
  label: string;
  /** One line, in the user's terms — this is the only explanation they get. */
  hint: string;
  /** Where in the clip the move sits, as fractions of clip duration. */
  span: { from: number; to: number };
  /** Longest the move should run, so it stays snappy on a long clip. */
  maxSeconds?: number;
  ease?: string;
  /** Frames as offsets/absolutes, resolved against the clip's own geometry. */
  frames: EffectPresetFrame[];
}

export interface EffectPresetFrame {
  /** Position within the move's span, 0 to 1. */
  at: number;
  /** Horizontal offset from the clip's resting position, in clip widths. */
  xByWidth?: number;
  /** Vertical offset from the clip's resting position, in clip heights. */
  yByHeight?: number;
  scale?: number;
  rotation?: number;
  opacity?: number;
}

export const EFFECT_PRESETS: EffectPreset[] = [
  {
    id: "fade-in",
    label: "Fade in",
    hint: "Appears from nothing",
    span: { from: 0, to: 0.25 },
    maxSeconds: 0.6,
    ease: "power2.out",
    frames: [
      { at: 0, opacity: 0 },
      { at: 1, opacity: 1 },
    ],
  },
  {
    id: "fade-out",
    label: "Fade out",
    hint: "Disappears at the end",
    span: { from: 0.75, to: 1 },
    maxSeconds: 0.6,
    ease: "power2.in",
    frames: [
      { at: 0, opacity: 1 },
      { at: 1, opacity: 0 },
    ],
  },
  {
    id: "slide-in-left",
    label: "Slide in from left",
    hint: "Enters from off the left edge",
    span: { from: 0, to: 0.3 },
    maxSeconds: 0.8,
    ease: "power3.out",
    frames: [
      { at: 0, xByWidth: -1.2, opacity: 0 },
      { at: 1, xByWidth: 0, opacity: 1 },
    ],
  },
  {
    id: "slide-in-right",
    label: "Slide in from right",
    hint: "Enters from off the right edge",
    span: { from: 0, to: 0.3 },
    maxSeconds: 0.8,
    ease: "power3.out",
    frames: [
      { at: 0, xByWidth: 1.2, opacity: 0 },
      { at: 1, xByWidth: 0, opacity: 1 },
    ],
  },
  {
    id: "rise-up",
    label: "Rise up",
    hint: "Lifts into place from below",
    span: { from: 0, to: 0.3 },
    maxSeconds: 0.7,
    ease: "power2.out",
    frames: [
      { at: 0, yByHeight: 0.35, opacity: 0 },
      { at: 1, yByHeight: 0, opacity: 1 },
    ],
  },
  {
    id: "pop",
    label: "Pop",
    hint: "Springs in with a slight overshoot",
    span: { from: 0, to: 0.28 },
    maxSeconds: 0.6,
    ease: "back.out",
    frames: [
      { at: 0, scale: 0.6, opacity: 0 },
      { at: 1, scale: 1, opacity: 1 },
    ],
  },
  {
    id: "ken-burns",
    label: "Slow zoom",
    hint: "Drifts closer across the whole clip",
    span: { from: 0, to: 1 },
    ease: "none",
    frames: [
      { at: 0, scale: 1 },
      { at: 1, scale: 1.12 },
    ],
  },
];

export function findEffectPreset(id: string): EffectPreset | undefined {
  return EFFECT_PRESETS.find((preset) => preset.id === id);
}

interface PresetClip {
  duration: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Expands a preset into keyframes and the step that groups them, for a clip of
 * this size and length. Pure — the caller commits the result the same way a
 * hand-built Move is committed.
 */
export function buildEffectPresetKeyframes(
  preset: EffectPreset,
  clip: PresetClip,
  createId: () => string,
): { keyframes: Keyframe[]; step: ClipMotionStepMeta } {
  const MIN_SPAN = 0.05;
  const duration = Math.max(0.1, clip.duration);
  // Cap the length so an entrance on a 20s clip is still an entrance.
  const rawEnd = Math.min(duration, preset.span.to * duration);
  let spanStart = Math.max(0, Math.min(duration, preset.span.from * duration));
  let spanEnd =
    preset.maxSeconds === undefined ? rawEnd : Math.min(rawEnd, spanStart + preset.maxSeconds);

  // On a very short clip the preset's own span can collapse. Widen it to stay
  // usable, but never past the clip — an exit that ran off the end would write
  // keyframes the timeline cannot represent.
  if (spanEnd - spanStart < MIN_SPAN) {
    spanEnd = Math.min(duration, spanStart + MIN_SPAN);
    spanStart = Math.max(0, spanEnd - MIN_SPAN);
  }

  const keyframes: Keyframe[] = preset.frames.map((frame, index) => {
    const time = round(spanStart + (spanEnd - spanStart) * frame.at);
    const properties: Partial<KeyframeProperties> = {
      x: round((frame.xByWidth ?? 0) * clip.width),
      y: round((frame.yByHeight ?? 0) * clip.height),
      scale: frame.scale ?? 1,
      rotation: frame.rotation ?? clip.rotation,
      opacity: frame.opacity ?? clip.opacity,
    };
    return {
      id: createId(),
      time,
      properties,
      // The easing belongs to the frame being moved towards, so the first one
      // carries none.
      ...(index > 0 && preset.ease && preset.ease !== "none" ? { ease: preset.ease } : {}),
    } as Keyframe;
  });

  return {
    keyframes,
    step: { id: createId(), checkpointIds: keyframes.map((frame) => frame.id) },
  };
}
