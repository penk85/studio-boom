import { describe, expect, it } from "vitest";
import {
  EFFECT_PRESETS,
  buildEffectPresetKeyframes,
  findEffectPreset,
  type EffectPreset,
} from "../effect-presets";

const CLIP = { duration: 4, width: 400, height: 200, rotation: 0, opacity: 1 };
let counter = 0;
const createId = () => `k${counter++}`;

function build(preset: EffectPreset, clip = CLIP) {
  counter = 0;
  return buildEffectPresetKeyframes(preset, clip, createId);
}

describe("move presets", () => {
  it("gives every preset a distinct id and a hint", () => {
    const ids = EFFECT_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of EFFECT_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.hint.length).toBeGreaterThan(0);
      expect(preset.frames.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("expands into keyframes grouped by one step", () => {
    const { keyframes, step } = build(findEffectPreset("fade-in")!);
    expect(keyframes).toHaveLength(2);
    expect(step.checkpointIds).toEqual(keyframes.map((frame) => frame.id));
    expect(keyframes[0]!.properties.opacity).toBe(0);
    expect(keyframes[1]!.properties.opacity).toBe(1);
  });

  it("keeps an entrance short on a long clip", () => {
    // 25% of a 40s clip would be a 10s "fade in". maxSeconds keeps it an entrance.
    const { keyframes } = build(findEffectPreset("fade-in")!, { ...CLIP, duration: 40 });
    expect(keyframes[1]!.time).toBeLessThanOrEqual(0.6);
  });

  it("still produces a usable span on a very short clip", () => {
    const { keyframes } = build(findEffectPreset("fade-in")!, { ...CLIP, duration: 0.1 });
    expect(keyframes[1]!.time).toBeGreaterThan(keyframes[0]!.time);
  });

  it("places an exit at the end of the clip, not the start", () => {
    const { keyframes } = build(findEffectPreset("fade-out")!, { ...CLIP, duration: 4 });
    expect(keyframes[0]!.time).toBeGreaterThan(2);
    expect(keyframes[1]!.time).toBeLessThanOrEqual(4);
    expect(keyframes[1]!.properties.opacity).toBe(0);
  });

  it("expresses slide distance in clip widths, so it scales with the clip", () => {
    const narrow = build(findEffectPreset("slide-in-left")!, { ...CLIP, width: 100 });
    const wide = build(findEffectPreset("slide-in-left")!, { ...CLIP, width: 800 });
    expect(narrow.keyframes[0]!.properties.x).toBe(-120);
    expect(wide.keyframes[0]!.properties.x).toBe(-960);
    // Both land back at the clip's resting position.
    expect(narrow.keyframes[1]!.properties.x).toBe(0);
    expect(wide.keyframes[1]!.properties.x).toBe(0);
  });

  it("leaves the resting position alone for a scale-only move", () => {
    const { keyframes } = build(findEffectPreset("ken-burns")!);
    for (const frame of keyframes) {
      expect(frame.properties.x).toBe(0);
      expect(frame.properties.y).toBe(0);
    }
    expect(keyframes[1]!.properties.scale).toBeGreaterThan(1);
  });

  it("puts easing on the frame being moved towards, never the first", () => {
    const { keyframes } = build(findEffectPreset("pop")!);
    expect(keyframes[0]!.ease).toBeUndefined();
    expect(keyframes[1]!.ease).toBe("back.out");
  });

  it("omits easing entirely when the preset asks for none", () => {
    const { keyframes } = build(findEffectPreset("ken-burns")!);
    expect(keyframes.every((frame) => frame.ease === undefined)).toBe(true);
  });

  it("respects the clip's own rotation and opacity as the resting values", () => {
    const { keyframes } = build(findEffectPreset("ken-burns")!, {
      ...CLIP,
      rotation: 15,
      opacity: 0.5,
    });
    expect(keyframes[0]!.properties.rotation).toBe(15);
    expect(keyframes[0]!.properties.opacity).toBe(0.5);
  });

  it("never produces a frame outside the clip", () => {
    for (const preset of EFFECT_PRESETS) {
      for (const duration of [0.1, 1, 4, 40]) {
        const { keyframes } = build(preset, { ...CLIP, duration });
        for (const frame of keyframes) {
          expect(frame.time, `${preset.id} @ ${duration}s`).toBeGreaterThanOrEqual(0);
          expect(frame.time, `${preset.id} @ ${duration}s`).toBeLessThanOrEqual(duration);
        }
      }
    }
  });
});
