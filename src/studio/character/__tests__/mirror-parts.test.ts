import { describe, expect, it } from "vitest";
import type { CharacterPart } from "../../types";
import { makePart } from "../character-utils";
import { planMirrorSlot } from "../mirror-parts";

const CANVAS_WIDTH = 600;

function leftEyeParts(): CharacterPart[] {
  return [
    {
      ...makePart("eye", "eye-open-media", {
        id: "left-eye-open",
        name: "Left eye open",
        slotId: "slot:left-eye",
        side: "left",
        eyeState: "open",
        x: 180,
        y: 180,
        width: 48,
        height: 28,
        zIndex: 4,
        pivot: { x: 204, y: 194 },
      }),
      pins: {
        "left-wrist": { x: 10, y: 20, rotation: 15, space: "part-local-pixels" as const },
      },
      bounds: { type: "rect" as const, x: 170, y: 170, width: 70, height: 50 },
    },
    makePart("eye", "eye-closed-media", {
      id: "left-eye-closed",
      name: "Left eye closed",
      slotId: "slot:left-eye",
      side: "left",
      eyeState: "closed",
      x: 180,
      y: 188,
      width: 48,
      height: 12,
      zIndex: 4,
    }),
  ];
}

function idFactory() {
  let n = 0;
  return () => `mirrored-${(n += 1)}`;
}

describe("planMirrorSlot", () => {
  it("mirrors every variant layer into the opposite slot with mirrored geometry", () => {
    const plan = planMirrorSlot({
      docParts: leftEyeParts(),
      slotId: "slot:left-eye",
      angle: "front",
      canvasWidth: CANVAS_WIDTH,
      makeId: idFactory(),
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.targetSlotId).toBe("slot:right-eye");
    expect(plan.targetSide).toBe("right");
    expect(plan.newParts).toHaveLength(2);

    const open = plan.newParts[0];
    expect(open.side).toBe("right");
    expect(open.slotId).toBe("slot:right-eye");
    expect(open.name).toBe("Right eye open");
    expect(open.eyeState).toBe("open");
    // x mirrored across the canvas center: 600 − 180 − 48.
    expect(open.x).toBe(372);
    expect(open.y).toBe(180);
    // Pivot mirrors in canvas space; pins mirror in part-local space.
    expect(open.pivot).toEqual({ x: 396, y: 194 });
    expect(open.pins).toEqual({
      "right-wrist": { x: 38, y: 20, rotation: -15, space: "part-local-pixels" },
    });
    expect(open.bounds).toMatchObject({ x: 360, width: 70 });
    expect(open.parentId).toBeUndefined();

    const closed = plan.newParts[1];
    expect(closed.eyeState).toBe("closed");
    expect(closed.x).toBe(372);
    expect(closed.y).toBe(188);
  });

  it("refuses when the opposite slot already has artwork for the angle", () => {
    const docParts = [
      ...leftEyeParts(),
      makePart("eye", "right-eye-media", {
        id: "right-eye-open",
        slotId: "slot:right-eye",
        side: "right",
        eyeState: "open",
        x: 372,
        y: 180,
        width: 48,
        height: 28,
        zIndex: 4,
      }),
    ];
    const plan = planMirrorSlot({
      docParts,
      slotId: "slot:left-eye",
      angle: "front",
      canvasWidth: CANVAS_WIDTH,
      makeId: idFactory(),
    });

    expect(plan).toMatchObject({ ok: false, reason: "occupied", targetSlotId: "slot:right-eye" });
  });

  it("refuses unsided slots and empty slots", () => {
    const mouth = makePart("mouth", "mouth-media", {
      id: "mouth-rest",
      slotId: "role:mouth",
      viseme: "rest",
      x: 210,
      y: 260,
      width: 90,
      height: 42,
      zIndex: 5,
    });
    expect(
      planMirrorSlot({
        docParts: [mouth],
        slotId: "role:mouth",
        angle: "front",
        canvasWidth: CANVAS_WIDTH,
        makeId: idFactory(),
      }),
    ).toMatchObject({ ok: false, reason: "unsided" });
    expect(
      planMirrorSlot({
        docParts: [],
        slotId: "slot:left-eye",
        angle: "front",
        canvasWidth: CANVAS_WIDTH,
        makeId: idFactory(),
      }),
    ).toMatchObject({ ok: false, reason: "empty" });
  });
});
