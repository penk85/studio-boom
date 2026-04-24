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

const REST_GAP = 0.12; // silence > 120ms between chars => insert rest

function letterToViseme(ch: string, lastVowel: MouthViseme | null): MouthViseme | null {
  const c = ch.toLowerCase();
  if (/\s/.test(c) || /[.,!?;:"'()\-—…]/.test(c)) return "rest";
  switch (c) {
    case "a": return "A";
    case "e": case "i": case "y": return "E";
    case "o": return "O";
    case "u": case "w": return "U";
    case "m": case "b": case "p": return "MBP";
    case "f": case "v": return "FV";
    case "l": return "L";
    default:
      // Other consonants: hold last vowel shape if present, else rest
      return lastVowel ?? "rest";
  }
}

/**
 * Convert ElevenLabs character timestamps into a sparse viseme track.
 * Adjacent identical visemes are collapsed. Silence gaps insert "rest".
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
      if (v === "A" || v === "E" || v === "O" || v === "U") lastVowel = v;
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

/** Active viseme at time `t` (relative to clip start). */
export function visemeAt(keys: VisemeKey[] | undefined, t: number): MouthViseme {
  if (!keys || keys.length === 0) return "rest";
  let v: MouthViseme = "rest";
  for (const k of keys) {
    if (k.t <= t) v = k.v;
    else break;
  }
  return v;
}
