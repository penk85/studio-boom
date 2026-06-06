import { describe, expect, it } from "vitest";
import { BUILTIN_MOTION_PRESETS } from "../seed";

describe("built-in motion presets", () => {
  it("keeps full-body jump parent-relative by not duplicating body translation on the head", () => {
    const jump = BUILTIN_MOTION_PRESETS.find((preset) => preset.name === "Jump");

    expect(jump).toBeDefined();
    expect(jump?.tracks.some((track) => track.partRole === "body")).toBe(true);
    expect(jump?.tracks.some((track) => track.partRole === "head" && hasTranslation(track))).toBe(
      false,
    );
  });

  it("does not cancel jump arm motion with duplicate opposite role tracks", () => {
    const jump = BUILTIN_MOTION_PRESETS.find((preset) => preset.name === "Jump");
    const armTracks = jump?.tracks.filter((track) => track.partRole === "arm") ?? [];

    expect(armTracks).toHaveLength(1);
    expect(armTracks[0]?.keyframes.some((keyframe) => keyframe.rotation !== 0)).toBe(true);
  });

  it("keeps idle bob on the parent body control so the head inherits the bob once", () => {
    const idle = BUILTIN_MOTION_PRESETS.find((preset) => preset.name === "Idle bob");

    expect(idle?.tracks.some((track) => track.partRole === "body" && hasTranslation(track))).toBe(
      true,
    );
    expect(idle?.tracks.some((track) => track.partRole === "head" && hasTranslation(track))).toBe(
      false,
    );
  });
});

function hasTranslation(track: { keyframes: Array<{ dx?: number; dy?: number }> }): boolean {
  return track.keyframes.some((keyframe) => (keyframe.dx ?? 0) !== 0 || (keyframe.dy ?? 0) !== 0);
}
