import { describe, expect, it } from "vitest";
import { createBlankCharacter, makePart } from "../../character/character-utils";
import { thumbnailBoundsForParts } from "../character-thumbnail-bounds";

describe("thumbnailBoundsForParts", () => {
  it("crops around tight visible pixels instead of the whole source frame", () => {
    const character = createBlankCharacter("Preview");
    const part = makePart("body", "body-media", {
      x: 100,
      y: 150,
      width: 200,
      height: 300,
      alphaBounds: {
        x: 50,
        y: 25,
        width: 100,
        height: 250,
        sourceWidth: 200,
        sourceHeight: 300,
      },
    });

    const bounds = thumbnailBoundsForParts([part], character);

    expect(bounds.x).toBeGreaterThan(part.x);
    expect(bounds.width).toBeLessThan(part.width);
    expect(bounds.height).toBeGreaterThan(part.height);
  });

  it("keeps rotated parts inside the preview crop", () => {
    const character = createBlankCharacter("Preview");
    const basePart = makePart("head", "head-media", {
      x: 200,
      y: 200,
      width: 160,
      height: 120,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    const rotatedPart = { ...basePart, rotation: 45 };

    const baseBounds = thumbnailBoundsForParts([basePart], character);
    const rotatedBounds = thumbnailBoundsForParts([rotatedPart], character);

    expect(rotatedBounds.width).toBeGreaterThan(baseBounds.width);
    expect(rotatedBounds.height).toBeGreaterThan(baseBounds.height);
  });

  it("matches object-contain placement for narrow source media", () => {
    const character = createBlankCharacter("Preview");
    const part = makePart("body", "body-media", {
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      alphaBounds: {
        x: 0,
        y: 0,
        width: 100,
        height: 200,
        sourceWidth: 100,
        sourceHeight: 200,
      },
    });

    const bounds = thumbnailBoundsForParts([part], character);

    expect(bounds.x).toBeGreaterThan(0);
    expect(bounds.width).toBeLessThan(part.width);
  });

  it("falls back to the character canvas when no visible parts are available", () => {
    const character = createBlankCharacter("Preview");
    const bounds = thumbnailBoundsForParts([], character);

    expect(bounds).toMatchObject({
      x: 0,
      y: 0,
      width: character.canvasWidth,
      height: character.canvasHeight,
    });
  });
});
