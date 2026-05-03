import { describe, it, expect } from "vitest";
import { pickFreeLane, createBlankProject, normalizeProjectTrackOrder } from "../store";
import type { AnyClip, Project, Track } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeClip(trackIndex: number, laneIndex: number, start: number, duration: number): AnyClip {
  return {
    id: `clip-${Math.random()}`,
    kind: "image",
    name: "Clip",
    mediaId: "m1",
    trackIndex,
    laneIndex,
    start,
    duration,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
  };
}

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: `track-${Math.random()}`,
    name: "Track",
    kind: "character",
    lanes: 1,
    ...overrides,
  };
}

function makeProject(tracks: Track[], clips: AnyClip[] = []): Project {
  return {
    id: "proj-1",
    name: "Test",
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 30,
    tracks,
    clips,
    createdAt: 0,
    updatedAt: 0,
  };
}

// ─── pickFreeLane ─────────────────────────────────────────────────────────────

describe("pickFreeLane", () => {
  it("returns lane 0 when there are no clips", () => {
    expect(pickFreeLane([], 0, 0, 5, 1)).toBe(0);
  });

  it("returns lane 0 when existing clips are on a different track", () => {
    const clip = makeClip(1 /* trackIndex */, 0, 0, 5);
    expect(pickFreeLane([clip], 0, 0, 5, 1)).toBe(0);
  });

  it("returns lane 0 when existing clip is on a non-overlapping time range", () => {
    // Existing: track 0, lane 0, t=10..15. New: t=0..5 → no overlap
    const clip = makeClip(0, 0, 10, 5);
    expect(pickFreeLane([clip], 0, 0, 5, 1)).toBe(0);
  });

  it("returns lane 1 when lane 0 is fully occupied", () => {
    const clip = makeClip(0, 0, 0, 10);
    // maxLanes=1 → lane 0 is occupied, so returns 1 (new lane)
    expect(pickFreeLane([clip], 0, 0, 5, 1)).toBe(1);
  });

  it("returns lane 0 when lane 1 is occupied but lane 0 is free (different time)", () => {
    const clip = makeClip(0, 1, 0, 10); // lane 1 occupied
    // Lane 0 is free → return 0
    expect(pickFreeLane([clip], 0, 0, 5, 2)).toBe(0);
  });

  it("returns next available lane beyond maxLanes when all are occupied", () => {
    const lane0 = makeClip(0, 0, 0, 10);
    const lane1 = makeClip(0, 1, 0, 10);
    // maxLanes=2, both occupied → returns 2
    expect(pickFreeLane([lane0, lane1], 0, 0, 5, 2)).toBe(2);
  });

  it("detects overlap: existing [0,5), new [4,9) → conflict on lane 0", () => {
    const clip = makeClip(0, 0, 0, 5);
    expect(pickFreeLane([clip], 0, 4, 5, 1)).toBe(1);
  });

  it("no conflict: existing [0,5), new [5,10) → adjacent, not overlapping", () => {
    // cEnd = 5, new start = 5: c.start < end (0 < 10) BUT cEnd > start (5 > 5) is false
    const clip = makeClip(0, 0, 0, 5);
    expect(pickFreeLane([clip], 0, 5, 5, 1)).toBe(0);
  });
});

// ─── createBlankProject ───────────────────────────────────────────────────────

describe("createBlankProject", () => {
  it("creates a project with the specified name", () => {
    const p = createBlankProject("My Movie");
    expect(p.name).toBe("My Movie");
  });

  it("creates a project with default name when not provided", () => {
    const p = createBlankProject();
    expect(p.name).toBe("Untitled Movie");
  });

  it("has default stage dimensions 1920×1080", () => {
    const p = createBlankProject();
    expect(p.width).toBe(1920);
    expect(p.height).toBe(1080);
  });

  it("has 4 default tracks in canonical order", () => {
    const p = createBlankProject();
    expect(p.tracks.length).toBe(4);
    expect(p.tracks[0].kind).toBe("character");
    expect(p.tracks[1].kind).toBe("overlay");
    expect(p.tracks[2].kind).toBe("background");
    expect(p.tracks[3].kind).toBe("audio");
  });

  it("has no clips", () => {
    const p = createBlankProject();
    expect(p.clips).toEqual([]);
  });

  it("assigns unique ids", () => {
    const p1 = createBlankProject();
    const p2 = createBlankProject();
    expect(p1.id).not.toBe(p2.id);
  });
});

// ─── normalizeProjectTrackOrder ───────────────────────────────────────────────

describe("normalizeProjectTrackOrder", () => {
  it("returns the same project reference when order is already correct", () => {
    const tracks = [
      makeTrack({ kind: "character" }),
      makeTrack({ kind: "overlay" }),
      makeTrack({ kind: "background" }),
      makeTrack({ kind: "audio" }),
    ];
    const project = makeProject(tracks);
    const result = normalizeProjectTrackOrder(project);
    expect(result).toBe(project); // same reference — no reorder needed
  });

  it("reorders tracks to canonical order: character→overlay→background→audio", () => {
    const audio = makeTrack({ kind: "audio" });
    const bg = makeTrack({ kind: "background" });
    const char = makeTrack({ kind: "character" });
    const overlay = makeTrack({ kind: "overlay" });
    const project = makeProject([audio, bg, char, overlay]);
    const result = normalizeProjectTrackOrder(project);
    expect(result.tracks[0].kind).toBe("character");
    expect(result.tracks[1].kind).toBe("overlay");
    expect(result.tracks[2].kind).toBe("background");
    expect(result.tracks[3].kind).toBe("audio");
  });

  it("remaps clip trackIndex to match new track positions", () => {
    // audio at index 0, character at index 1 → after normalize, char→0, audio→1
    const audio = makeTrack({ kind: "audio" });
    const char = makeTrack({ kind: "character" });
    const clip = makeClip(1 /* character was at index 1 */, 0, 0, 5);
    const project = makeProject([audio, char], [clip]);
    const result = normalizeProjectTrackOrder(project);
    // character is now at index 0
    expect(result.clips[0].trackIndex).toBe(0);
  });

  it("is idempotent — calling twice produces same result", () => {
    const audio = makeTrack({ kind: "audio" });
    const char = makeTrack({ kind: "character" });
    const project = makeProject([audio, char]);
    const once = normalizeProjectTrackOrder(project);
    const twice = normalizeProjectTrackOrder(once);
    expect(twice).toBe(once); // no change on second call
  });

  it("preserves relative order of same-kind tracks", () => {
    const char1 = makeTrack({ kind: "character" });
    const char2 = makeTrack({ kind: "character" });
    const audio = makeTrack({ kind: "audio" });
    const project = makeProject([audio, char1, char2]);
    const result = normalizeProjectTrackOrder(project);
    // Both character tracks should appear first, in original relative order
    expect(result.tracks[0].id).toBe(char1.id);
    expect(result.tracks[1].id).toBe(char2.id);
    expect(result.tracks[2].kind).toBe("audio");
  });
});
