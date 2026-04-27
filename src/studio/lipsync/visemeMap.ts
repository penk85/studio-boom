// Maps ElevenLabs character-level alignment → viseme keyframes.
import type { MouthViseme } from "../types";

export interface ElevenLabsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export interface VisemeKey {
  t: number; // seconds, relative to clip start
  v: MouthViseme;
}

export interface VisemeTimingOptions {
  minHoldSeconds?: number;
  blendWindowSeconds?: number;
}

const REST_GAP = 0.12; // silence > 120ms between chars => insert rest
const MIN_VISEME_HOLD = 0.06; // minimum 60ms hold before switching
const AUDIO_LEAD_MS = 30; // mouth moves this many ms before sound
const VISEME_BLEND_WINDOW = 0.075; // crossfade near boundaries for softer swaps

function letterToViseme(ch: string, lastVowel: MouthViseme | null): MouthViseme | null {
  const c = ch.toLowerCase();
  if (/\s/.test(c) || /[.,!?;:"'()\-—…]/.test(c)) return "rest";
  switch (c) {
    case "m":
    case "b":
    case "p":
      return "MBP";
    case "f":
    case "v":
      return "FV";
    case "a":
    case "h":
    case "j":
      return "A";
    case "e":
    case "i":
    case "y":
    case "s":
    case "z":
    case "c":
    case "d":
    case "g":
    case "k":
    case "n":
    case "r":
    case "t":
      return "E";
    case "o":
      return "O";
    case "u":
      return "U";
    case "w":
    case "q":
      return "WQ";
    case "l":
      return "L";
    default:
      // Other consonants: hold last vowel shape if present, else rest
      return lastVowel ?? "rest";
  }
}

/**
 * Convert ElevenLabs character timestamps into a sparse viseme track.
 * Adjacent identical visemes are collapsed. Silence gaps insert "rest".
 * Short visemes (< MIN_VISEME_DURATION) are merged into neighbors.
 */
export function alignmentToVisemes(a: ElevenLabsAlignment): VisemeKey[] {
  const out: VisemeKey[] = [{ t: 0, v: "rest" }];
  let lastVowel: MouthViseme | null = null;
  let prevEnd = 0;

  for (let i = 0; i < a.characters.length; i++) {
    const ch = a.characters[i];
    const start = a.character_start_times_seconds[i] ?? prevEnd;
    const end = a.character_end_times_seconds[i] ?? start;

    // Insert a rest if there's a noticeable silence gap.
    if (start - prevEnd > REST_GAP) {
      pushKey(out, { t: prevEnd + 0.04, v: "rest" });
    }

    const v = letterToViseme(ch, lastVowel);
    if (v) {
      if (v === "A" || v === "E" || v === "O" || v === "U" || v === "WQ") lastVowel = v;
      pushKey(out, { t: start, v });
    }
    prevEnd = end;
  }
  // Close with rest at end
  pushKey(out, { t: prevEnd + 0.05, v: "rest" });
  return out;
}

function pushKey(arr: VisemeKey[], k: VisemeKey) {
  const last = arr[arr.length - 1];
  if (last && last.v === k.v) return;
  if (last && k.t <= last.t) k.t = last.t + 0.01;
  arr.push(k);
}

/** Active viseme at time `t` (relative to clip start), with minimum hold enforcement. */
export function visemeAt(
  keys: VisemeKey[] | undefined,
  t: number,
  options?: VisemeTimingOptions,
): MouthViseme {
  return visemeStateAt(keys, t, options).current;
}

export interface VisemeState {
  current: MouthViseme;
  next?: MouthViseme;
  blend: number; // 0..1 blend toward next
}

/** Current viseme plus an optional short blend into the next viseme. */
export function visemeStateAt(
  keys: VisemeKey[] | undefined,
  t: number,
  options?: VisemeTimingOptions,
): VisemeState {
  if (!keys || keys.length === 0) return { current: "rest", blend: 0 };
  const minHoldSeconds = options?.minHoldSeconds ?? MIN_VISEME_HOLD;
  const blendWindowSeconds = options?.blendWindowSeconds ?? VISEME_BLEND_WINDOW;

  // Apply audio lead time: look up viseme slightly ahead
  const leadSec = AUDIO_LEAD_MS / 1000;
  const tAdjusted = t + leadSec;

  // Find current and next keyframes
  let currentIdx = -1;
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].t <= tAdjusted) {
      currentIdx = i;
    } else {
      break;
    }
  }

  if (currentIdx < 0) return { current: "rest", blend: 0 };
  if (currentIdx >= keys.length - 1) return { current: keys[currentIdx].v, blend: 0 };

  const current = keys[currentIdx];
  const next = keys[currentIdx + 1];
  const timeUntilNext = next.t - tAdjusted;

  // If next viseme is too close, extend current viseme.
  if (timeUntilNext < minHoldSeconds) {
    return { current: current.v, blend: 0 };
  }

  const canBlend = next.v !== current.v && timeUntilNext <= blendWindowSeconds;
  if (!canBlend) return { current: current.v, blend: 0 };

  const raw = 1 - timeUntilNext / blendWindowSeconds;
  const blend = Math.max(0, Math.min(1, raw * raw * (3 - 2 * raw)));
  return { current: current.v, next: next.v, blend };
}
