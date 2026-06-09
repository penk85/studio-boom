import { describe, it, expect } from "vitest";
import {
  ease,
  sampleTrack,
  applyIntensity,
  combine,
  composeMotionsAt,
  generateMotionOccurrences,
  expandKeyposesWithAnticipation,
  deltaFor,
  deltaForBone,
  type ComposedDelta,
} from "../apply";
import type { MotionKeyframe, MotionPreset, AppliedMotion } from "../../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeKeyframe(t: number, overrides: Partial<MotionKeyframe> = {}): MotionKeyframe {
  return { t, ...overrides };
}

function makePreset(overrides: Partial<MotionPreset> = {}): MotionPreset {
  return {
    id: "p1",
    name: "Test",
    category: "gesture",
    duration: 1,
    loop: false,
    tracks: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeClip(overrides: Partial<{ duration: number; motions: AppliedMotion[] }> = {}): {
  duration: number;
  motions: AppliedMotion[];
} {
  return {
    duration: 5,
    motions: [],
    ...overrides,
  };
}

function makeAppliedMotion(overrides: Partial<AppliedMotion> = {}): AppliedMotion {
  return {
    id: "m1",
    presetId: "p1",
    offset: 0,
    intensity: 1,
    ...overrides,
  };
}

// ─── ease ─────────────────────────────────────────────────────────────────────

describe("ease", () => {
  it("linear: f(0)=0, f(0.5)=0.5, f(1)=1", () => {
    expect(ease("linear", 0)).toBe(0);
    expect(ease("linear", 0.5)).toBe(0.5);
    expect(ease("linear", 1)).toBe(1);
  });

  it("easeIn: f(0)=0, f(0.5)=0.25 (x²), f(1)=1", () => {
    expect(ease("easeIn", 0)).toBe(0);
    expect(ease("easeIn", 0.5)).toBeCloseTo(0.25);
    expect(ease("easeIn", 1)).toBe(1);
  });

  it("easeOut: f(0)=0, f(0.5)≈0.75, f(1)=1", () => {
    expect(ease("easeOut", 0)).toBe(0);
    expect(ease("easeOut", 0.5)).toBeCloseTo(0.75);
    expect(ease("easeOut", 1)).toBe(1);
  });

  it("hold: f(x<1)=0, f(1)=1", () => {
    expect(ease("hold", 0)).toBe(0);
    expect(ease("hold", 0.99)).toBe(0);
    expect(ease("hold", 1)).toBe(1);
  });

  it("elastic: f(0)=0, f(1)=1", () => {
    expect(ease("elastic", 0)).toBe(0);
    expect(ease("elastic", 1)).toBe(1);
  });

  it("bounce: f(0)=0, f(1)=1", () => {
    expect(ease("bounce", 0)).toBeCloseTo(0);
    expect(ease("bounce", 1)).toBeCloseTo(1);
  });

  it("clamps x to [0,1]", () => {
    expect(ease("linear", -0.5)).toBe(0);
    expect(ease("linear", 1.5)).toBe(1);
  });

  it("unknown name falls back to easeInOut", () => {
    // easeInOut(0.5) = 0.5 (smooth symmetric)
    expect(ease("invalid-name", 0.5)).toBeCloseTo(0.5);
    expect(ease(undefined, 0.5)).toBeCloseTo(0.5);
  });
});

// ─── sampleTrack ──────────────────────────────────────────────────────────────

describe("sampleTrack", () => {
  it("returns identity delta for empty keyframes", () => {
    const d = sampleTrack([], 0.5);
    expect(d.dx).toBe(0);
    expect(d.dy).toBe(0);
    expect(d.scale).toBe(1);
    expect(d.rotation).toBe(0);
  });

  it("returns the single keyframe's values regardless of u", () => {
    const kf = makeKeyframe(0, { dx: 10, dy: -5, rotation: 45 });
    const d0 = sampleTrack([kf], 0);
    const d1 = sampleTrack([kf], 1);
    expect(d0.dx).toBe(10);
    expect(d1.dx).toBe(10);
    expect(d0.rotation).toBe(45);
  });

  it("interpolates between two keyframes at u=0", () => {
    const kfs = [makeKeyframe(0, { dx: 0 }), makeKeyframe(1, { dx: 100 })];
    expect(sampleTrack(kfs, 0).dx).toBeCloseTo(0);
  });

  it("interpolates between two keyframes at u=0.5", () => {
    const kfs = [
      makeKeyframe(0, { dx: 0, ease: "linear" }),
      makeKeyframe(1, { dx: 100, ease: "linear" }),
    ];
    expect(sampleTrack(kfs, 0.5).dx).toBeCloseTo(50);
  });

  it("interpolates between two keyframes at u=1", () => {
    const kfs = [makeKeyframe(0, { dx: 0 }), makeKeyframe(1, { dx: 100 })];
    expect(sampleTrack(kfs, 1).dx).toBeCloseTo(100);
  });

  it("uses the first segment for u before first keyframe", () => {
    const kfs = [makeKeyframe(0.25, { dy: 0 }), makeKeyframe(0.75, { dy: 100 })];
    // At u=0.0, before the first keyframe, uses [0] and [1] with local=0 → dy≈0
    const d = sampleTrack(kfs, 0.0);
    expect(d.dy).toBeCloseTo(0);
  });

  it("uses the last segment for u after last keyframe", () => {
    const kfs = [makeKeyframe(0, { dy: 0 }), makeKeyframe(0.5, { dy: 50 })];
    // At u=1.0, the last segment loops → saturates at dy=50
    const d = sampleTrack(kfs, 1.0);
    expect(d.dy).toBeCloseTo(50);
  });

  it("interpolates 3D fields (rotationY) and carries transformPerspective", () => {
    const kfs = [
      makeKeyframe(0, { rotationY: 0, transformPerspective: 800, ease: "linear" }),
      makeKeyframe(1, { rotationY: 360, transformPerspective: 800, ease: "linear" }),
    ];
    expect(sampleTrack(kfs, 0.5).rotationY).toBeCloseTo(180);
    expect(sampleTrack(kfs, 1).rotationY).toBeCloseTo(360);
    expect(sampleTrack(kfs, 0.5).transformPerspective).toBe(800);
  });
});

// ─── applyIntensity ───────────────────────────────────────────────────────────

describe("applyIntensity", () => {
  function makeDelta(overrides: Partial<ComposedDelta> = {}): ComposedDelta {
    return {
      dx: 0,
      dy: 0,
      scale: 1,
      scaleX: 1,
      scaleY: 1,
      skewX: 0,
      skewY: 0,
      rotation: 0,
      rotationX: 0,
      rotationY: 0,
      transformPerspective: null,
      originX: null,
      originY: null,
      opacity: null,
      ...overrides,
    };
  }

  it("intensity=1 preserves all values", () => {
    const d = makeDelta({ dx: 50, dy: -20, scale: 1.5, rotation: 30 });
    const r = applyIntensity(d, 1);
    expect(r.dx).toBeCloseTo(50);
    expect(r.dy).toBeCloseTo(-20);
    expect(r.scale).toBeCloseTo(1.5);
    expect(r.rotation).toBeCloseTo(30);
  });

  it("intensity=0 zeroes translations and rotations, returns scale to 1", () => {
    const d = makeDelta({ dx: 50, dy: -20, scale: 1.5, rotation: 30 });
    const r = applyIntensity(d, 0);
    expect(r.dx).toBeCloseTo(0);
    expect(r.dy).toBeCloseTo(0);
    expect(r.scale).toBeCloseTo(1);
    expect(r.rotation).toBeCloseTo(0);
  });

  it("intensity=0.5 halves translations and rotations", () => {
    const d = makeDelta({ dx: 100, rotation: 60 });
    const r = applyIntensity(d, 0.5);
    expect(r.dx).toBeCloseTo(50);
    expect(r.rotation).toBeCloseTo(30);
  });

  it("intensity=0.5 brings scale halfway back to 1", () => {
    const d = makeDelta({ scale: 1.4 }); // deviation = 0.4
    const r = applyIntensity(d, 0.5);
    expect(r.scale).toBeCloseTo(1.2); // 1 + 0.4 * 0.5
  });
});

// ─── combine ──────────────────────────────────────────────────────────────────

describe("combine", () => {
  function delta(overrides: Partial<ComposedDelta> = {}): ComposedDelta {
    return {
      dx: 0,
      dy: 0,
      scale: 1,
      scaleX: 1,
      scaleY: 1,
      skewX: 0,
      skewY: 0,
      rotation: 0,
      rotationX: 0,
      rotationY: 0,
      transformPerspective: null,
      originX: null,
      originY: null,
      opacity: null,
      ...overrides,
    };
  }

  it("translations are additive", () => {
    const r = combine(delta({ dx: 10, dy: 5 }), delta({ dx: 20, dy: -3 }));
    expect(r.dx).toBeCloseTo(30);
    expect(r.dy).toBeCloseTo(2);
  });

  it("scales are multiplicative", () => {
    const r = combine(delta({ scale: 1.5 }), delta({ scale: 2 }));
    expect(r.scale).toBeCloseTo(3);
  });

  it("rotations are additive", () => {
    const r = combine(delta({ rotation: 30 }), delta({ rotation: 45 }));
    expect(r.rotation).toBeCloseTo(75);
  });

  it("originX/Y from b takes precedence over a when b has a value", () => {
    const r = combine(delta({ originX: 0.2 }), delta({ originX: 0.8 }));
    expect(r.originX).toBeCloseTo(0.8);
  });

  it("originX/Y falls back to a when b is null", () => {
    const r = combine(delta({ originX: 0.3 }), delta({ originX: null }));
    expect(r.originX).toBeCloseTo(0.3);
  });
});

// ─── generateMotionOccurrences ────────────────────────────────────────────────

describe("generateMotionOccurrences", () => {
  it("returns single occurrence for non-looping motion", () => {
    const motion = makeAppliedMotion({ offset: 1 });
    const preset = makePreset({ duration: 2, loop: false });
    const occ = generateMotionOccurrences(motion, preset, 10);
    expect(occ.length).toBe(1);
    expect(occ[0]).toEqual({ start: 1, end: 3 });
  });

  it("returns multiple occurrences for looping motion", () => {
    const motion = makeAppliedMotion({ offset: 0, loop: true, loopGap: 0 });
    const preset = makePreset({ duration: 1, loop: true });
    const occ = generateMotionOccurrences(motion, preset, 3.5);
    expect(occ.length).toBeGreaterThanOrEqual(3);
    expect(occ[0]).toEqual({ start: 0, end: 1 });
    expect(occ[1]).toEqual({ start: 1, end: 2 });
  });

  it("respects loopGap between repetitions", () => {
    const motion = makeAppliedMotion({ offset: 0, loop: true, loopGap: 0.5 });
    const preset = makePreset({ duration: 1, loop: true });
    const occ = generateMotionOccurrences(motion, preset, 5);
    expect(occ[1].start).toBeCloseTo(1.5); // dur + gap
  });

  it("is deterministic (same seed = same output)", () => {
    const motion = makeAppliedMotion({
      id: "seed-test",
      offset: 0,
      loop: true,
      loopGap: 0,
      loopGapMax: 1,
      loopMode: "random",
    });
    const preset = makePreset({ duration: 0.5, loop: true });
    const occ1 = generateMotionOccurrences(motion, preset, 10);
    const occ2 = generateMotionOccurrences(motion, preset, 10);
    expect(occ1).toEqual(occ2);
  });
});

// ─── composeMotionsAt ─────────────────────────────────────────────────────────

describe("composeMotionsAt", () => {
  it("returns identity deltas when clip has no motions", () => {
    const clip = makeClip({ motions: [] });
    const result = composeMotionsAt(clip, 0, new Map());
    expect(result.perPart.size).toBe(0);
    expect(result.camera).toEqual({ dx: 0, dy: 0, zoom: 1 });
    expect(result.faceTurnX).toBe(0);
  });

  it("ignores unknown preset ids", () => {
    const motion = makeAppliedMotion({ presetId: "missing" });
    const clip = makeClip({ motions: [motion] });
    const result = composeMotionsAt(clip, 0.5, new Map());
    expect(result.perPart.size).toBe(0);
  });

  it("applies a single track motion to the correct part role", () => {
    const preset = makePreset({
      tracks: [
        {
          partRole: "head",
          keyframes: [
            makeKeyframe(0, { dy: 0, ease: "linear" }),
            makeKeyframe(1, { dy: 50, ease: "linear" }),
          ],
        },
      ],
    });
    const motion = makeAppliedMotion({ offset: 0, intensity: 1 });
    const clip = makeClip({ motions: [motion] });
    const presets = new Map([["p1", preset]]);

    // At t=0.5, u=0.5, linear → dy ≈ 25
    const result = composeMotionsAt(clip, 0.5, presets);
    const headDelta = deltaFor(result, "head");
    expect(headDelta.dy).toBeCloseTo(25, 0);
  });

  it("skips preset and track motion outside their declared angles", () => {
    const sidePreset = makePreset({
      angleIds: ["sideL"],
      tracks: [{ partRole: "head", keyframes: [makeKeyframe(0, { dx: 30 })] }],
    });
    const mixedPreset = makePreset({
      id: "p2",
      tracks: [
        {
          angleIds: ["front"],
          partRole: "head",
          keyframes: [makeKeyframe(0, { dy: 10 })],
        },
        {
          angleIds: ["sideL"],
          partRole: "head",
          keyframes: [makeKeyframe(0, { dy: 40 })],
        },
      ],
    });
    const clip = makeClip({
      motions: [
        makeAppliedMotion({ presetId: "p1" }),
        makeAppliedMotion({ id: "m2", presetId: "p2" }),
      ],
    });
    const presets = new Map([
      ["p1", sidePreset],
      ["p2", mixedPreset],
    ]);

    const front = composeMotionsAt(clip, 0, presets, "front");
    const side = composeMotionsAt(clip, 0, presets, "sideL");

    expect(deltaFor(front, "head").dx).toBe(0);
    expect(deltaFor(front, "head").dy).toBe(10);
    expect(deltaFor(side, "head").dx).toBe(30);
    expect(deltaFor(side, "head").dy).toBe(40);
  });

  it("applies intensity scaling", () => {
    const preset = makePreset({
      tracks: [
        {
          partRole: "head",
          keyframes: [
            makeKeyframe(0, { dy: 0, ease: "linear" }),
            makeKeyframe(1, { dy: 100, ease: "linear" }),
          ],
        },
      ],
    });
    const motion = makeAppliedMotion({ offset: 0, intensity: 0.5 });
    const clip = makeClip({ motions: [motion] });
    const presets = new Map([["p1", preset]]);

    const result = composeMotionsAt(clip, 1.0, presets);
    const headDelta = deltaFor(result, "head");
    // At u=1, dy=100*0.5 intensity = 50
    expect(headDelta.dy).toBeCloseTo(50, 0);
  });

  it("collects out-of-bounds layers from an active movement", () => {
    const preset = makePreset({
      allowOutOfBounds: ["slot:left-eye", "head"],
      tracks: [
        { partRole: "head", keyframes: [makeKeyframe(0, { dy: 0 }), makeKeyframe(1, { dy: 5 })] },
      ],
    });
    const clip = makeClip({ motions: [makeAppliedMotion({ offset: 0, intensity: 1 })] });
    const presets = new Map([["p1", preset]]);

    // Active at t=0.5 → its overrides are collected.
    expect(composeMotionsAt(clip, 0.5, presets).unclampedLayers).toEqual(
      new Set(["slot:left-eye", "head"]),
    );
    // Not active before its occurrence → no overrides.
    const late = makeAppliedMotion({ offset: 5, intensity: 1 });
    expect(
      composeMotionsAt(makeClip({ motions: [late] }), 0.5, new Map([["p1", preset]]))
        .unclampedLayers,
    ).toEqual(new Set());
  });

  it("keeps bone-targeted motion on per-bone deltas without creating pose swaps", () => {
    const preset = makePreset({
      tracks: [
        {
          target: "bone",
          boneId: "bone:slot:left-leg",
          partRole: "leg",
          keyframes: [
            makeKeyframe(0, { rotation: 0, ease: "linear" }),
            makeKeyframe(1, { rotation: 40, ease: "linear" }),
          ],
        },
        {
          target: "slot",
          slotId: "role:mouth",
          partRole: "mouth",
          poseSwap: "Smile",
          keyframes: [makeKeyframe(0, {})],
        },
      ],
    });
    const motion = makeAppliedMotion({ offset: 0, intensity: 1 });
    const result = composeMotionsAt(
      makeClip({ motions: [motion] }),
      0.5,
      new Map([["p1", preset]]),
    );

    expect(deltaForBone(result, "leg", "slot:left-leg", "bone:slot:left-leg").rotation).toBeCloseTo(
      20,
    );
    expect(deltaFor(result, "leg", "slot:left-leg").rotation).toBe(0);
    expect(result.poseSwap.get("bone:bone:slot:left-leg")).toBeUndefined();
    expect(result.poseSwap.get("slot:role:mouth")).toBe("Smile");
  });

  it("accumulates two non-exclusive motions on the same part", () => {
    const preset1 = makePreset({
      id: "p1",
      tracks: [{ partRole: "head", keyframes: [makeKeyframe(0, { dx: 10 })] }],
    });
    const preset2 = makePreset({
      id: "p2",
      category: "gesture",
      tracks: [{ partRole: "head", keyframes: [makeKeyframe(0, { dx: 20 })] }],
    });
    const motion1 = makeAppliedMotion({ id: "m1", presetId: "p1", offset: 0 });
    const motion2 = makeAppliedMotion({ id: "m2", presetId: "p2", offset: 0 });
    const clip = makeClip({ motions: [motion1, motion2] });
    const presets = new Map([
      ["p1", preset1],
      ["p2", preset2],
    ]);

    const result = composeMotionsAt(clip, 0, presets);
    const headDelta = deltaFor(result, "head");
    expect(headDelta.dx).toBeCloseTo(30); // additive
  });
});

// ─── expandKeyposesWithAnticipation ───────────────────────────────────────────

describe("expandKeyposesWithAnticipation", () => {
  it("passes through keyposes without anticipation unchanged", () => {
    const keyposes = [{ t: 0.5, parts: [{ partRole: "head" as const, dx: 10 }] }];
    const result = expandKeyposesWithAnticipation(keyposes);
    expect(result.length).toBe(1);
    expect(result[0].t).toBe(0.5);
  });

  it("inserts an anticipation pre-pose before the main keypose", () => {
    const keyposes = [
      {
        t: 0.5,
        parts: [{ partRole: "head" as const, dx: 10 }],
        anticipation: { amount: 0.5, duration: 0.1 },
      },
    ];
    const result = expandKeyposesWithAnticipation(keyposes);
    expect(result.length).toBe(2);
    // Pre-pose comes first, at t = 0.5 - 0.1 = 0.4
    expect(result[0].t).toBeCloseTo(0.4);
    // Pre-pose dx is inverted: -10 * 0.5 = -5
    expect(result[0].parts[0].dx).toBeCloseTo(-5);
  });

  it("sorts output by ascending t", () => {
    const keyposes = [
      {
        t: 1.0,
        parts: [{ partRole: "head" as const, dx: 10 }],
        anticipation: { amount: 0.5, duration: 0.2 },
      },
      { t: 0.5, parts: [{ partRole: "body" as const, dy: 5 }] },
    ];
    const result = expandKeyposesWithAnticipation(keyposes);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].t).toBeGreaterThanOrEqual(result[i - 1].t);
    }
  });

  it("skips anticipation for keypose at t=0", () => {
    const keyposes = [
      {
        t: 0,
        parts: [{ partRole: "head" as const, dx: 10 }],
        anticipation: { amount: 0.5, duration: 0.1 },
      },
    ];
    // Anticipation only inserted when keypose.t > 0
    const result = expandKeyposesWithAnticipation(keyposes);
    expect(result.length).toBe(1);
  });
});
