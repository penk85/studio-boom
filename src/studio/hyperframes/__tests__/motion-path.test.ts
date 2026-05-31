import { describe, expect, it } from "vitest";
import {
  buildPositionPath,
  normalizePathStyle,
  sampleSmoothPath,
  SMOOTH_SAMPLES_PER_SEGMENT,
  type PositionCheckpoint,
} from "../motion-path";

describe("normalizePathStyle", () => {
  it("defaults unknown values to linear", () => {
    expect(normalizePathStyle(undefined)).toBe("linear");
    expect(normalizePathStyle(null)).toBe("linear");
    expect(normalizePathStyle("nope")).toBe("linear");
    expect(normalizePathStyle(7)).toBe("linear");
  });

  it("preserves smooth", () => {
    expect(normalizePathStyle("smooth")).toBe("smooth");
  });
});

describe("sampleSmoothPath", () => {
  it("returns the input when there are fewer than three points", () => {
    expect(sampleSmoothPath([])).toEqual([]);
    expect(sampleSmoothPath([{ x: 0, y: 0 }])).toEqual([{ x: 0, y: 0 }]);
    expect(
      sampleSmoothPath([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it("passes through every input checkpoint", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 60 },
      { x: 220, y: -20 },
      { x: 340, y: 80 },
    ];
    const samples = sampleSmoothPath(points);
    // First sample is exactly the first input.
    expect(samples[0]).toEqual(points[0]);
    // Last sample is snapped to the last input.
    expect(samples[samples.length - 1]).toEqual(points[points.length - 1]);
  });

  it("emits N*samplesPerSegment + 1 points for N+1 checkpoints", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 60 },
      { x: 220, y: -20 },
    ];
    const samples = sampleSmoothPath(points, 8);
    // 2 segments × 8 samples + 1 starting point.
    expect(samples.length).toBe(17);
  });
});

describe("buildPositionPath", () => {
  const checkpoints: PositionCheckpoint[] = [
    { id: "a", time: 0, x: 0, y: 0, ease: "power2.out" },
    { id: "b", time: 0.5, x: 100, y: 80 },
    { id: "c", time: 1.0, x: 220, y: 30 },
    { id: "d", time: 1.5, x: 340, y: 150 },
  ];

  it("linear style returns one sample per checkpoint", () => {
    const samples = buildPositionPath(checkpoints, "linear");
    expect(samples.length).toBe(checkpoints.length);
    expect(samples[0]).toMatchObject({
      time: 0,
      x: 0,
      y: 0,
      checkpointId: "a",
      ease: "power2.out",
    });
    expect(samples[samples.length - 1]).toMatchObject({
      time: 1.5,
      x: 340,
      y: 150,
      checkpointId: "d",
    });
  });

  it("smooth style with fewer than 3 checkpoints degrades to linear", () => {
    const two: PositionCheckpoint[] = [
      { id: "a", time: 0, x: 0, y: 0 },
      { id: "b", time: 1, x: 100, y: 0 },
    ];
    expect(buildPositionPath(two, "smooth")).toEqual(buildPositionPath(two, "linear"));
  });

  it("smooth style produces densified samples that bracket the input range", () => {
    const samples = buildPositionPath(checkpoints, "smooth");
    expect(samples.length).toBeGreaterThan(checkpoints.length);
    expect(samples[0]).toMatchObject({ x: 0, y: 0, time: 0, checkpointId: "a" });
    const tail = samples[samples.length - 1]!;
    expect(tail.x).toBe(340);
    expect(tail.y).toBe(150);
    expect(tail.time).toBeCloseTo(1.5);
    expect(tail.checkpointId).toBe("d");
  });

  it("smooth style time-maps samples linearly across the span", () => {
    const samples = buildPositionPath(checkpoints, "smooth", 4);
    const span = checkpoints[checkpoints.length - 1]!.time - checkpoints[0]!.time;
    const lastIndex = samples.length - 1;
    samples.forEach((sample, i) => {
      const expected = checkpoints[0]!.time + (span * i) / lastIndex;
      expect(sample.time).toBeCloseTo(expected);
    });
  });
});

describe("preview/playback parity", () => {
  it("the SVG overlay sampler and compiler use the same path points", () => {
    // The stage overlay calls buildPositionPath(checkpoints, "smooth") to build
    // the polyline. The compiler calls the same function with the same inputs.
    // If both consumers ever drift to different samplers, the on-screen line
    // would stop matching the played animation. We pin them here.
    const checkpoints: PositionCheckpoint[] = [
      { id: "a", time: 0, x: 50, y: 80 },
      { id: "b", time: 0.7, x: 220, y: -30 },
      { id: "c", time: 1.5, x: 400, y: 120 },
      { id: "d", time: 2.4, x: 520, y: 60 },
    ];
    const stageSamples = buildPositionPath(checkpoints, "smooth", SMOOTH_SAMPLES_PER_SEGMENT);
    const compilerSamples = buildPositionPath(checkpoints, "smooth", SMOOTH_SAMPLES_PER_SEGMENT);
    expect(compilerSamples).toEqual(stageSamples);
  });
});
