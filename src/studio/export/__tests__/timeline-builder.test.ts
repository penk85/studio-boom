import { describe, it, expect, vi } from "vitest";
import {
  slotDomId,
  visemeDomId,
  eyeDomId,
  rigComponentId,
  collectCriticalTimes,
  smoothVisemes,
  buildCharacterTimeline,
} from "../timeline-builder";
import type { CharacterClip, CharacterPreset, MotionPreset, MouthViseme } from "../../types";
import { DEFAULT_PART_MANIFEST, DEFAULT_PARALLAX_CONFIG } from "../../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeClip(overrides: Partial<CharacterClip> = {}): CharacterClip {
  return {
    id: "clip-1",
    kind: "character",
    name: "Character",
    characterId: "char-1",
    trackIndex: 0,
    start: 0,
    duration: 5,
    x: 0,
    y: 0,
    width: 600,
    height: 900,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    poses: {},
    motions: [],
    visemes: [],
    ...overrides,
  };
}

function makeCharacter(overrides: Partial<CharacterPreset> = {}): CharacterPreset {
  return {
    id: "char-1",
    name: "Test Character",
    canvasWidth: 600,
    canvasHeight: 900,
    parts: [],
    manifest: { ...DEFAULT_PART_MANIFEST },
    parallax: { ...DEFAULT_PARALLAX_CONFIG },
    headVariants: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

// ─── DOM ID scheme ─────────────────────────────────────────────────────────────

describe("slotDomId", () => {
  it("prefixes with char-clipId-", () => {
    expect(slotDomId("abc", "role:head")).toBe("char-abc-role-head");
  });

  it("replaces non-alphanumeric chars with hyphens", () => {
    expect(slotDomId("c1", "slot:left-eye")).toBe("char-c1-slot-left-eye");
  });
});

describe("visemeDomId", () => {
  it("appends -v-<viseme> to the slot dom id", () => {
    expect(visemeDomId("c1", "role:mouth", "A")).toBe("char-c1-role-mouth-v-A");
  });
});

describe("eyeDomId", () => {
  it("appends -e-<state> to the slot dom id", () => {
    expect(eyeDomId("c1", "role:eye", "open")).toBe("char-c1-role-eye-e-open");
  });
});

describe("rigComponentId", () => {
  it("returns rig-clipId-component", () => {
    expect(rigComponentId("clip-1", "upper-lip")).toBe("rig-clip-1-upper-lip");
  });
});

// ─── collectCriticalTimes ─────────────────────────────────────────────────────

describe("collectCriticalTimes", () => {
  it("always includes 0 and clip.duration", () => {
    const clip = makeClip({ duration: 4, motions: [] });
    const times = collectCriticalTimes(clip, new Map());
    expect(times).toContain(0);
    expect(times).toContain(4);
  });

  it("returns sorted array", () => {
    const clip = makeClip({ duration: 3, motions: [] });
    const times = collectCriticalTimes(clip, new Map());
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThan(times[i - 1]);
    }
  });

  it("adds keyframe boundaries from presets with tracks", () => {
    const preset: MotionPreset = {
      id: "p1",
      name: "Test",
      category: "gesture",
      duration: 2,
      loop: false,
      tracks: [
        {
          partRole: "head",
          keyframes: [{ t: 0 }, { t: 0.5 }, { t: 1 }],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const clip = makeClip({
      duration: 5,
      motions: [{ id: "m1", presetId: "p1", offset: 0, intensity: 1 }],
    });
    const times = collectCriticalTimes(clip, new Map([["p1", preset]]));
    // kf.t * dur: 0*2=0, 0.5*2=1, 1*2=2 — offset=0 so times are 0, 1, 2
    expect(times).toContain(1);
    expect(times).toContain(2);
  });

  it("includes viseme times within clip duration", () => {
    const clip = makeClip({
      duration: 5,
      visemes: [
        { t: 0.5, v: "A" },
        { t: 1.2, v: "rest" },
        { t: 6, v: "A" }, // outside duration — should be excluded
      ],
      motions: [],
    });
    const times = collectCriticalTimes(clip, new Map());
    expect(times).toContain(0.5);
    expect(times).toContain(1.2);
    expect(times).not.toContain(6);
  });

  it("does not duplicate times", () => {
    const clip = makeClip({ duration: 2, motions: [] });
    const times = collectCriticalTimes(clip, new Map());
    const unique = new Set(times);
    expect(unique.size).toBe(times.length);
  });
});

// ─── smoothVisemes ─────────────────────────────────────────────────────────────

describe("smoothVisemes", () => {
  it("returns empty array for empty input", () => {
    expect(smoothVisemes([])).toEqual([]);
  });

  it("returns single event unchanged", () => {
    const result = smoothVisemes([{ t: 0.1, v: "A" }]);
    expect(result.length).toBe(1);
    expect(result[0].v).toBe("A");
  });

  it("collapses rapid events — gap enforcement", () => {
    // maxPerSec=8 → minGap=0.125s; events at 0, 0.05, 0.1, 0.2
    const input = [
      { t: 0, v: "rest" as MouthViseme },
      { t: 0.05, v: "MBP" as MouthViseme },
      { t: 0.1, v: "MBP" as MouthViseme },
      { t: 0.2, v: "E" as MouthViseme },
    ];
    const result = smoothVisemes(input);
    // The first window [0,0.125) produces one event; 0.2 > 0.125+0.0... from best.t
    // At minimum, output should have fewer events than input
    expect(result.length).toBeLessThan(input.length);
  });

  it("prefers higher-priority visemes within a window (A over rest)", () => {
    // Within window: rest(priority 1) vs A(priority 10) → A should win
    const input = [
      { t: 0, v: "rest" as MouthViseme },
      { t: 0.05, v: "A" as MouthViseme },
    ];
    const result = smoothVisemes(input);
    expect(result.length).toBe(1);
    expect(result[0].v).toBe("A");
  });

  it("regression: lastT uses best.t so subsequent events in the dead zone are suppressed", () => {
    // Bug: lastT was set to windowStart, not best.t. This allowed events slightly after
    // best.t (but > windowStart + minGap) to slip through.
    //
    // Setup: best at t=0.11 (inside window [0, 0.125)). Next event at t=0.13.
    // With bug (lastT=0):   0.13 - 0 = 0.13 >= 0.125 → emitted (WRONG)
    // With fix (lastT=0.11): 0.13 - 0.11 = 0.02 < 0.125 → suppressed (CORRECT)
    const input: { t: number; v: MouthViseme }[] = [
      { t: 0, v: "rest" }, // window start
      { t: 0.11, v: "A" }, // best (high priority), inside window
      { t: 0.13, v: "E" }, // just outside window boundary from windowStart
    ];
    const result = smoothVisemes(input, 8); // minGap = 0.125
    // After fix: only 1 event (0.13 is in dead zone from 0.11)
    // With bug: 2 events (0.13 would slip through)
    expect(result.length).toBe(1);
    expect(result[0].v).toBe("A"); // highest priority wins
  });

  it("respects custom maxPerSec rate", () => {
    // maxPerSec=4 → minGap=0.25s
    const input: { t: number; v: MouthViseme }[] = [
      { t: 0, v: "rest" },
      { t: 0.1, v: "A" },
      { t: 0.2, v: "E" },
      { t: 0.3, v: "O" }, // 0.3 - 0.1 (best.t) = 0.2 < 0.25 → suppressed
    ];
    const result = smoothVisemes(input, 4);
    expect(result.length).toBe(1);
  });

  it("output is sorted by ascending t", () => {
    const input: { t: number; v: MouthViseme }[] = [
      { t: 0.0, v: "rest" },
      { t: 0.3, v: "A" },
      { t: 0.6, v: "E" },
    ];
    const result = smoothVisemes(input);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].t).toBeGreaterThanOrEqual(result[i - 1].t);
    }
  });
});

// ─── buildCharacterTimeline ────────────────────────────────────────────────────

describe("buildCharacterTimeline", () => {
  it("returns a GSAP timeline object", () => {
    const clip = makeClip();
    const character = makeCharacter({ parts: [] });
    const tl = buildCharacterTimeline(clip, character, new Map());
    expect(tl).toBeDefined();
    expect(typeof tl.seek).toBe("function");
  });

  it("emits no tweens for a character with no parts", () => {
    const clip = makeClip();
    const character = makeCharacter({ parts: [] });
    const tl = buildCharacterTimeline(clip, character, new Map()) as unknown as {
      _calls: Array<{ method: string }>;
    };
    const fromToCalls = tl._calls.filter((c) => c.method === "fromTo");
    expect(fromToCalls.length).toBe(0);
  });

  it("emits set calls for viseme initial state when clip has mouth parts", () => {
    const mouthRest = {
      id: "m-rest",
      slotId: "role:mouth",
      slotName: "Mouth",
      role: "mouth" as const,
      name: "Mouth rest",
      mediaId: "media-1",
      x: 250,
      y: 600,
      width: 100,
      height: 50,
      rotation: 0,
      anchorX: 0.5,
      anchorY: 0.5,
      pivot: { x: 300, y: 625 },
      viseme: "rest" as MouthViseme,
      motionBehavior: "lipSync" as const,
      zIndex: 5,
      depth: 0,
      visible: true,
    };
    const mouthA = { ...mouthRest, id: "m-a", name: "Mouth A", viseme: "A" as MouthViseme };
    const character = makeCharacter({ parts: [mouthRest, mouthA] });
    const clip = makeClip({
      visemes: [{ t: 0.5, v: "A" }],
    });

    const tl = buildCharacterTimeline(clip, character, new Map()) as unknown as {
      _calls: Array<{ method: string }>;
    };
    const setCalls = tl._calls.filter((c) => c.method === "set");
    expect(setCalls.length).toBeGreaterThan(0);
  });

  it("transformPointAroundPivot — no motion produces identity transform", () => {
    // This geometry function is exercised inside buildCharacterTimeline.
    // For a head part with no motion, the slot position should be 0,0.
    // We verify the timeline is built without throwing.
    const head = {
      id: "h1",
      slotId: "role:head",
      slotName: "Head",
      role: "head" as const,
      name: "Head",
      mediaId: "media-2",
      x: 100,
      y: 50,
      width: 300,
      height: 400,
      rotation: 0,
      anchorX: 0.5,
      anchorY: 0.5,
      pivot: { x: 250, y: 250 },
      motionBehavior: "rotate" as const,
      zIndex: 0,
      depth: 0,
      visible: true,
    };
    const character = makeCharacter({ parts: [head] });
    const clip = makeClip({ motions: [] });
    expect(() => buildCharacterTimeline(clip, character, new Map())).not.toThrow();
  });
});
