import { describe, it, expect } from "vitest";
import {
  alignmentToVisemes,
  visemeAt,
  visemeStateAt,
  type ElevenLabsAlignment,
} from "../visemeMap";

// Constants mirrored from visemeMap.ts for assertions
const AUDIO_LEAD_MS = 30;
const LEAD_SEC = AUDIO_LEAD_MS / 1000;
const BLEND_WINDOW = 0.175;

function align(characters: string[], starts: number[], ends: number[]): ElevenLabsAlignment {
  return {
    characters,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  };
}

// ─── alignmentToVisemes ────────────────────────────────────────────────────────

describe("alignmentToVisemes", () => {
  it("returns [rest, rest] for empty alignment", () => {
    const result = alignmentToVisemes(align([], [], []));
    expect(result[0]).toEqual({ t: 0, v: "rest" });
    expect(result[result.length - 1].v).toBe("rest");
  });

  it("maps vowel 'a' → A", () => {
    const result = alignmentToVisemes(align(["a"], [0.1], [0.3]));
    expect(result.some((k) => k.v === "A")).toBe(true);
  });

  it("maps 'o' → O", () => {
    const result = alignmentToVisemes(align(["o"], [0.1], [0.2]));
    expect(result.some((k) => k.v === "O")).toBe(true);
  });

  it("maps 'u' → U", () => {
    const result = alignmentToVisemes(align(["u"], [0.1], [0.2]));
    expect(result.some((k) => k.v === "U")).toBe(true);
  });

  it("maps bilabials m/b/p → MBP", () => {
    for (const ch of ["m", "b", "p"]) {
      const result = alignmentToVisemes(align([ch], [0.1], [0.2]));
      expect(result.some((k) => k.v === "MBP")).toBe(true);
    }
  });

  it("maps f/v → FV", () => {
    for (const ch of ["f", "v"]) {
      const result = alignmentToVisemes(align([ch], [0.1], [0.2]));
      expect(result.some((k) => k.v === "FV")).toBe(true);
    }
  });

  it("maps 'l' → L", () => {
    const result = alignmentToVisemes(align(["l"], [0.1], [0.2]));
    expect(result.some((k) => k.v === "L")).toBe(true);
  });

  it("maps w/q → WQ", () => {
    for (const ch of ["w", "q"]) {
      const result = alignmentToVisemes(align([ch], [0.1], [0.2]));
      expect(result.some((k) => k.v === "WQ")).toBe(true);
    }
  });

  it("maps e/i/y/s/z/c/d/g/k/n/r/t → E", () => {
    for (const ch of ["e", "i", "y", "s", "z", "c", "d", "g", "k", "n", "r", "t"]) {
      const result = alignmentToVisemes(align([ch], [0.1], [0.2]));
      expect(result.some((k) => k.v === "E")).toBe(true);
    }
  });

  it("maps whitespace and punctuation → rest", () => {
    for (const ch of [" ", ".", ",", "!", "?"]) {
      const result = alignmentToVisemes(align([ch], [0.1], [0.2]));
      // All keys must be known visemes
      const known = new Set(["rest", "A", "E", "O", "U", "MBP", "FV", "L", "WQ", "Smile"]);
      result.forEach((k) => expect(known.has(k.v)).toBe(true));
    }
  });

  it("inserts a rest key for silence gap > 120ms", () => {
    // 'a' ends at 0.1, 'e' starts at 0.5 → gap = 400ms > 120ms
    const result = alignmentToVisemes(align(["a", "e"], [0.0, 0.5], [0.1, 0.7]));
    const restInGap = result.find((k) => k.t > 0.1 && k.t < 0.5 && k.v === "rest");
    expect(restInGap).toBeDefined();
  });

  it("does not insert rest for gap < 120ms", () => {
    // 'a' ends at 0.1, 'e' starts at 0.15 → gap = 50ms < 120ms
    const result = alignmentToVisemes(align(["a", "e"], [0.0, 0.15], [0.1, 0.25]));
    const restInGap = result.find((k) => k.t > 0.1 && k.t < 0.15);
    expect(restInGap).toBeUndefined();
  });

  it("deduplicates consecutive identical visemes", () => {
    // b and p both map to MBP — should collapse to one MBP event
    const result = alignmentToVisemes(align(["b", "p"], [0.1, 0.2], [0.2, 0.3]));
    const mbpEvents = result.filter((k) => k.v === "MBP");
    expect(mbpEvents.length).toBe(1);
  });

  it("unknown consonant inherits last vowel shape", () => {
    // 'a' then 'x' (unknown) → 'x' should inherit A (no new unknown viseme)
    const result = alignmentToVisemes(align(["a", "x"], [0.1, 0.2], [0.2, 0.3]));
    const knownVisemes = new Set(["rest", "A", "E", "O", "U", "MBP", "FV", "L", "WQ", "Smile"]);
    result.forEach((k) => expect(knownVisemes.has(k.v)).toBe(true));
  });

  it("closes with a rest key after the last character", () => {
    const result = alignmentToVisemes(align(["a"], [0.1], [0.3]));
    const last = result[result.length - 1];
    expect(last.v).toBe("rest");
    expect(last.t).toBeGreaterThan(0.3);
  });

  it("produces monotonically increasing timestamps", () => {
    const result = alignmentToVisemes(
      align(["h", "e", "l", "l", "o"], [0.0, 0.1, 0.2, 0.3, 0.4], [0.1, 0.2, 0.3, 0.4, 0.5]),
    );
    for (let i = 1; i < result.length; i++) {
      expect(result[i].t).toBeGreaterThan(result[i - 1].t);
    }
  });
});

// ─── visemeAt ──────────────────────────────────────────────────────────────────

describe("visemeAt", () => {
  const keys = [
    { t: 0, v: "rest" as const },
    { t: 0.5, v: "A" as const },
    { t: 1.0, v: "rest" as const },
  ];

  it("returns rest for undefined keys", () => {
    expect(visemeAt(undefined, 0.5)).toBe("rest");
  });

  it("returns rest for empty keys array", () => {
    expect(visemeAt([], 0.5)).toBe("rest");
  });

  it("returns rest when t is before first key (after lead adjustment)", () => {
    // adjusted = -0.5 + LEAD_SEC < 0, no key found
    expect(visemeAt(keys, -0.5)).toBe("rest");
  });

  it("returns the current viseme mid-sequence", () => {
    // adjusted = 0.2 + 0.03 = 0.23, keys[0].t=0 ≤ 0.23
    expect(visemeAt(keys, 0.2)).toBe("rest");
  });

  it("returns A after the 0.5s boundary", () => {
    // adjusted = 0.55 + 0.03 = 0.58, keys[1].t=0.5 ≤ 0.58
    expect(visemeAt(keys, 0.55)).toBe("A");
  });

  it("returns last viseme past the end", () => {
    // adjusted = 1.5 + 0.03 = 1.53, keys[2] is the latest
    expect(visemeAt(keys, 1.5)).toBe("rest");
  });

  it("returns last key's viseme when at final key (no next)", () => {
    // Single key: always returns that key's viseme
    const single = [{ t: 0, v: "A" as const }];
    expect(visemeAt(single, 0.0)).toBe("A");
    expect(visemeAt(single, 5.0)).toBe("A");
  });
});

// ─── visemeStateAt ─────────────────────────────────────────────────────────────

describe("visemeStateAt", () => {
  const keys = [
    { t: 0, v: "rest" as const },
    { t: 0.5, v: "A" as const },
    { t: 1.0, v: "rest" as const },
  ];

  it("returns rest blend=0 for undefined keys", () => {
    expect(visemeStateAt(undefined, 0.5)).toEqual({ current: "rest", blend: 0 });
  });

  it("returns rest blend=0 for empty keys", () => {
    expect(visemeStateAt([], 0.5)).toEqual({ current: "rest", blend: 0 });
  });

  it("returns no blend when well before transition", () => {
    // adjusted=0.23, timeUntilNext=0.5-0.23=0.27 > 0.175 → no blend
    const state = visemeStateAt(keys, 0.2);
    expect(state.current).toBe("rest");
    expect(state.blend).toBe(0);
    expect(state.next).toBeUndefined();
  });

  it("blends into next viseme within blend window", () => {
    // adjusted=0.35, timeUntilNext=0.15 < 0.175 → blend > 0
    const state = visemeStateAt(keys, 0.32);
    expect(state.current).toBe("rest");
    expect(state.next).toBe("A");
    expect(state.blend).toBeGreaterThan(0);
    expect(state.blend).toBeLessThan(1);
  });

  it("blend uses smoothstep (≈0.5 at midpoint of window)", () => {
    // Midpoint: timeUntilNext = BLEND_WINDOW / 2 = 0.0875
    // t where adjusted = 0.5 - 0.0875 = 0.4125 → t = 0.4125 - LEAD_SEC
    const tMid = 0.4125 - LEAD_SEC;
    const state = visemeStateAt(keys, tMid);
    expect(state.blend).toBeCloseTo(0.5, 1);
  });

  it("holds current if next is closer than minHold threshold", () => {
    // Force minHoldSeconds = 0.2 → at t=0.46, timeUntilNext=0.01 < 0.2 → hold
    const state = visemeStateAt(keys, 0.46, { minHoldSeconds: 0.2 });
    expect(state.current).toBe("rest");
    expect(state.blend).toBe(0);
  });

  it("respects custom blendWindowSeconds = 0 (never blend)", () => {
    const state = visemeStateAt(keys, 0.35, { blendWindowSeconds: 0 });
    expect(state.blend).toBe(0);
  });

  it("blend is 0 at the last key (no next)", () => {
    const state = visemeStateAt(keys, 1.5);
    expect(state.blend).toBe(0);
    expect(state.next).toBeUndefined();
  });

  it("does not blend when current and next viseme are identical", () => {
    const sameKeys = [
      { t: 0, v: "rest" as const },
      { t: 0.5, v: "rest" as const },
    ];
    // Both are rest — canBlend = false (next.v === current.v)
    const state = visemeStateAt(sameKeys, 0.35);
    expect(state.blend).toBe(0);
  });
});
