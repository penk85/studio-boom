import { describe, expect, it } from "vitest";
import type { CharacterPartLimbPathDeform, RecordedKeypose } from "../../types";
import {
  adjacentKeyposeIndex,
  constrainFlexibleCurvePatch,
  defaultOverride,
  ensureInitialRestKeypose,
  isDirtyOverride,
  recorderOverrideMapsEqual,
  scaleMagnitude,
  signedScaleValue,
  toggleSignedScale,
} from "../motion-recorder-state";

describe("motion recorder state", () => {
  it("sorts and clones keyposes while ensuring a rest pose at zero", () => {
    const source: RecordedKeypose[] = [
      {
        t: 2,
        parts: [{ partRole: "arm", slotId: "arm-left", dx: 20 }],
        camera: { dx: 10 },
      },
      { t: 1, parts: [] },
    ];

    const result = ensureInitialRestKeypose(source);

    expect(result.map((keypose) => keypose.t)).toEqual([0, 1, 2]);
    expect(result[2]).not.toBe(source[0]);
    expect(result[2]?.parts[0]).not.toBe(source[0]?.parts[0]);
    expect(result[2]?.camera).not.toBe(source[0]?.camera);
  });

  it("selects adjacent keyposes from either a selection or the draft time", () => {
    const keyposes: RecordedKeypose[] = [
      { t: 0, parts: [] },
      { t: 1, parts: [] },
      { t: 2, parts: [] },
    ];

    expect(adjacentKeyposeIndex(keyposes, 1, 1, -1)).toBe(0);
    expect(adjacentKeyposeIndex(keyposes, 1, 1, 1)).toBe(2);
    expect(adjacentKeyposeIndex(keyposes, null, 0.5, 1)).toBe(1);
    expect(adjacentKeyposeIndex(keyposes, null, 1.5, -1)).toBe(1);
    expect(adjacentKeyposeIndex(keyposes, 2, 2, 1)).toBe(-1);
  });

  it("compares complete override maps and detects meaningful edits", () => {
    const rest = defaultOverride("arm-left");
    const same = { ...rest };
    const moved = { ...rest, dx: 1 };

    expect(
      recorderOverrideMapsEqual(new Map([["arm-left", rest]]), new Map([["arm-left", same]])),
    ).toBe(true);
    expect(
      recorderOverrideMapsEqual(new Map([["arm-left", rest]]), new Map([["arm-left", moved]])),
    ).toBe(false);
    expect(isDirtyOverride(rest)).toBe(false);
    expect(isDirtyOverride(moved)).toBe(true);
  });

  it("preserves mirror direction while editing scale magnitude", () => {
    expect(scaleMagnitude(-2)).toBe(2);
    expect(signedScaleValue(-2, 1.25)).toBe(-1.25);
    expect(signedScaleValue(2, 1.25)).toBe(1.25);
    expect(toggleSignedScale(-2)).toBe(2);
    expect(toggleSignedScale(2)).toBe(-2);
  });

  it("constrains flexible curve handles to a stable bend envelope", () => {
    const path = {
      mode: "limb-path",
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      curve: { x: 50, y: 0 },
      width: 10,
    } satisfies CharacterPartLimbPathDeform;

    expect(
      constrainFlexibleCurvePatch({
        path,
        baseCurve: path.curve,
        desired: { x: 50, y: 1000 },
        override: defaultOverride("arm-left"),
      }),
    ).toEqual({ pathCurveX: 0, pathCurveY: 38 });
  });
});
