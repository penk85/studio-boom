import { describe, expect, it } from "vitest";
import type { CharacterPart } from "../../types";
import { makePart } from "../character-utils";
import { planVariantAlign } from "../variant-align";

function eyeSlotParts(overrides?: {
  closed?: Partial<CharacterPart>;
  open?: Partial<CharacterPart>;
}): CharacterPart[] {
  return [
    makePart("eye", "eye-open-media", {
      id: "eye-open",
      slotId: "slot:left-eye",
      side: "left",
      eyeState: "open",
      x: 180,
      y: 180,
      width: 48,
      height: 28,
      zIndex: 4,
      ...overrides?.open,
    }),
    makePart("eye", "eye-closed-media", {
      id: "eye-closed",
      slotId: "slot:left-eye",
      side: "left",
      eyeState: "closed",
      x: 300,
      y: 400,
      width: 48,
      height: 12,
      zIndex: 4,
      ...overrides?.closed,
    }),
  ];
}

describe("planVariantAlign", () => {
  it("snaps a stray closed eye onto the open eye's visible center", () => {
    const parts = eyeSlotParts();
    const plan = planVariantAlign(parts, parts[1]);

    // open center (204, 194) − closed center (324, 406)
    expect(plan).not.toBeNull();
    expect(plan!.moveIds).toEqual(["eye-closed"]);
    expect(plan!.dx).toBe(-120);
    expect(plan!.dy).toBe(-212);
    expect(plan!.referencePart.id).toBe("eye-open");
    expect(plan!.aligned).toBe(false);
  });

  it("aligns by trimmed alpha bounds, not the padded image frame", () => {
    // The closed art carries transparent padding: pixels live in the right half.
    const parts = eyeSlotParts({
      closed: {
        x: 180,
        y: 180,
        width: 96,
        height: 28,
        alphaBounds: {
          x: 48,
          y: 0,
          width: 48,
          height: 28,
          sourceWidth: 96,
          sourceHeight: 28,
          threshold: 8,
        },
      },
    });
    const plan = planVariantAlign(parts, parts[1]);

    // Closed pixel center sits at (252, 194); open pixel center at (204, 194).
    expect(plan!.dx).toBe(-48);
    expect(plan!.dy).toBe(0);
  });

  it("returns null when the selected part is the slot's default variant", () => {
    const parts = eyeSlotParts();
    expect(planVariantAlign(parts, parts[0])).toBeNull();
  });

  it("returns null for single-variant slots", () => {
    const [open] = eyeSlotParts();
    expect(planVariantAlign([open], open)).toBeNull();
  });

  it("moves every layer of a multi-layer variant by one shared delta", () => {
    const upper = makePart("arm", "upper-media", {
      id: "expl-upper",
      slotId: "slot:right-arm",
      side: "right",
      variant: { key: "explaining", name: "Explaining arm", kind: "pose" },
      x: 320,
      y: 200,
      width: 48,
      height: 96,
      zIndex: 7,
    });
    const fore = makePart("arm", "fore-media", {
      id: "expl-fore",
      slotId: "slot:right-arm",
      side: "right",
      variant: { key: "explaining", name: "Explaining arm", kind: "pose" },
      x: 356,
      y: 260,
      width: 72,
      height: 42,
      zIndex: 8,
    });
    const straight = makePart("arm", "straight-media", {
      id: "arm-straight",
      slotId: "slot:right-arm",
      side: "right",
      variant: { key: "straight", name: "Straight arm", kind: "pose" },
      x: 290,
      y: 210,
      width: 60,
      height: 180,
      zIndex: 1,
    });
    const plan = planVariantAlign([straight, upper, fore], upper);

    expect(plan).not.toBeNull();
    // Both layers of "explaining" move together; the straight reference stays.
    expect(new Set(plan!.moveIds)).toEqual(new Set(["expl-upper", "expl-fore"]));
    // straight center (320, 300) − explaining union center ((320..428)×(200..302) → (374, 251))
    expect(plan!.dx).toBe(-54);
    expect(plan!.dy).toBe(49);
  });

  it("reports aligned when the visible centers already coincide", () => {
    const parts = eyeSlotParts({ closed: { x: 180, y: 188, width: 48, height: 12 } });
    const plan = planVariantAlign(parts, parts[1]);

    expect(plan).not.toBeNull();
    expect(plan!.aligned).toBe(true);
    expect(plan!.dx).toBe(0);
    expect(plan!.dy).toBe(0);
  });
});
