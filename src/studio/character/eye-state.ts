import type { CharacterClip, CharacterPart, EyeState } from "../types";
import type { CharacterSlotRef } from "./character-utils";

export const EYE_STATES: EyeState[] = ["open", "half", "closed", "wink"];

export interface EyeVariant {
  state: EyeState;
  part: CharacterPart;
}

export interface BlinkWindow {
  start: number;
  end: number;
}

export function normalizeEyeState(value: string | undefined): EyeState | undefined {
  return EYE_STATES.includes(value as EyeState) ? (value as EyeState) : undefined;
}

export function eyeStateForPart(part: CharacterPart): EyeState | undefined {
  return (
    normalizeEyeState(part.eyeState ?? part.pose) ??
    (!part.eyeState && !part.pose ? "open" : undefined)
  );
}

export function eyeVariantsForSlot(slot: CharacterSlotRef): EyeVariant[] {
  const variants = new Map<EyeState, CharacterPart>();
  for (const part of slot.parts) {
    if (!part.visible) continue;
    const state = eyeStateForPart(part);
    if (state && !variants.has(state)) variants.set(state, part);
  }
  return EYE_STATES.flatMap((state) => {
    const part = variants.get(state);
    return part ? [{ state, part }] : [];
  });
}

export function eyeStateSetForSlot(slot: CharacterSlotRef): Set<EyeState> {
  return new Set(eyeVariantsForSlot(slot).map((variant) => variant.state));
}

export function slotHasEyeState(slot: CharacterSlotRef, state: EyeState) {
  return eyeStateSetForSlot(slot).has(state);
}

export function blinkWindowsForClip(clip: CharacterClip): BlinkWindow[] {
  if (clip.autoBlink === false) return [];

  const hash = hashString(clip.id);
  const cycle = 3.2 + (hash % 140) / 100;
  const phaseOffset = (((hash >>> 8) % 100) / 100) * cycle;
  const blinkDuration = 0.14;
  const windows: BlinkWindow[] = [];
  let t = (((cycle - blinkDuration - phaseOffset) % cycle) + cycle) % cycle;

  while (t < clip.duration) {
    if (t > 0) windows.push({ start: t, end: Math.min(t + blinkDuration, clip.duration) });
    t += cycle;
  }

  return windows;
}

export function autoBlinkPoseSwapAt(windows: BlinkWindow[], tInClip: number): EyeState | undefined {
  return windows.some((window) => tInClip >= window.start && tInClip < window.end)
    ? "closed"
    : undefined;
}

export function resolveEyeState({
  expressionPoseSwap,
  proceduralPoseSwap,
  availableStates,
}: {
  expressionPoseSwap?: string;
  proceduralPoseSwap?: EyeState;
  availableStates: Set<EyeState>;
}): EyeState {
  const expressionState = normalizeEyeState(expressionPoseSwap);
  if (expressionState && availableStates.has(expressionState)) return expressionState;
  if (proceduralPoseSwap && availableStates.has(proceduralPoseSwap)) return proceduralPoseSwap;
  return availableStates.has("open") ? "open" : (availableStates.values().next().value ?? "open");
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}
