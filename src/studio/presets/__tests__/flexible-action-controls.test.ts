import { describe, expect, it } from "vitest";
import type { CharacterPartLimbPathDeform } from "../../types";
import {
  flexibleActionControlState,
  flexibleBendPatch,
  flexibleReachPatch,
  type FlexiblePathOffsets,
} from "../flexible-action-controls";

const path: CharacterPartLimbPathDeform = {
  mode: "limb-path",
  start: { x: 20, y: 10 },
  end: { x: 20, y: 110 },
  width: 30,
  side: -1,
};

const rest: FlexiblePathOffsets = {
  pathEndX: 0,
  pathEndY: 0,
  pathCurveX: 0,
  pathCurveY: 0,
};

describe("flexible action controls", () => {
  it("projects raw path offsets into human-facing bend and reach values", () => {
    const state = flexibleActionControlState(
      path,
      {
        ...rest,
        pathEndX: 7,
        pathEndY: -24,
        pathCurveX: 18,
        pathCurveY: 5,
      },
      -1,
    );

    expect(state).toMatchObject({
      bend: 18,
      reach: -24,
      bendLimit: 38,
      reachLimit: 100,
      bendModified: true,
      reachModified: true,
    });
  });

  it("sets bend in the configured direction and preserves along-path adjustment", () => {
    expect(flexibleBendPatch(path, { ...rest, pathCurveX: 4, pathCurveY: 9 }, 22, -1)).toEqual({
      pathCurveX: 22,
      pathCurveY: 9,
    });
  });

  it("sets signed reach and preserves sideways endpoint adjustment", () => {
    expect(flexibleReachPatch(path, { ...rest, pathEndX: 6, pathEndY: 12 }, -30)).toEqual({
      pathEndX: 6,
      pathEndY: -30,
    });
  });

  it("reports off-axis canvas edits as modified even when the projected slider is at rest", () => {
    const state = flexibleActionControlState(path, { ...rest, pathEndX: 8, pathCurveY: 4 }, -1);

    expect(state.reach).toBe(0);
    expect(state.reachModified).toBe(true);
    expect(state.bend).toBe(0);
    expect(state.bendModified).toBe(true);
  });
});
