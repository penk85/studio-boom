import type { CharacterPart, EyeState } from "../types";
import type { CharacterSlotRef } from "./character-utils";

export const EYE_STATES: EyeState[] = ["open", "half", "closed", "wink"];

export interface EyeVariant {
  state: string;
  part: CharacterPart;
}

export interface BlinkWindow {
  start: number;
  end: number;
}

export function normalizeEyeState(value: string | undefined): EyeState | undefined {
  return EYE_STATES.includes(value as EyeState) ? (value as EyeState) : undefined;
}

export function eyeStateForPart(part: CharacterPart): string | undefined {
  return part.eyeState ?? part.pose ?? "open";
}

export function eyeVariantsForSlot(slot: CharacterSlotRef): EyeVariant[] {
  const variants = new Map<string, CharacterPart>();
  for (const part of slot.parts) {
    if (!part.visible) continue;
    const state = eyeStateForPart(part);
    if (state && !variants.has(state)) variants.set(state, part);
  }
  const ordered: EyeVariant[] = EYE_STATES.flatMap((state) => {
    const part = variants.get(state);
    if (!part) return [];
    variants.delete(state);
    return [{ state, part }];
  });
  for (const [state, part] of variants) ordered.push({ state, part });
  return ordered;
}

export function eyeStateSetForSlot(slot: CharacterSlotRef): Set<string> {
  return new Set(eyeVariantsForSlot(slot).map((variant) => variant.state));
}

export function slotHasEyeState(slot: CharacterSlotRef, state: EyeState) {
  return eyeStateSetForSlot(slot).has(state);
}

export function blinkWindowsForClip(clip: {
  id: string;
  duration: number;
  autoBlink?: boolean;
}): BlinkWindow[] {
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
  availableStates: Set<string>;
}): string {
  if (expressionPoseSwap && availableStates.has(expressionPoseSwap)) return expressionPoseSwap;
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
