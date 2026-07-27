import { describe, expect, it } from "vitest";
import { createBlankCharacter, makePart } from "../character-utils";
import { applyMeasuredAlphaBounds } from "../use-character-artwork-analysis";

describe("character artwork analysis", () => {
  it("backfills only missing alpha bounds and preserves existing measurements", () => {
    const missing = makePart("body", "body", { id: "missing" });
    const existing = makePart("head", "head", {
      id: "existing",
      alphaBounds: {
        x: 1,
        y: 2,
        width: 30,
        height: 40,
        sourceWidth: 100,
        sourceHeight: 100,
        threshold: 8,
      },
    });
    const character = {
      ...createBlankCharacter(),
      parts: [missing, existing],
      updatedAt: 1,
    };
    const measured = {
      x: 5,
      y: 6,
      width: 70,
      height: 80,
      sourceWidth: 100,
      sourceHeight: 100,
      threshold: 8,
    };

    const result = applyMeasuredAlphaBounds(
      character,
      [
        { id: missing.id, alphaBounds: measured },
        { id: existing.id, alphaBounds: measured },
      ],
      2,
    );

    expect(result.updatedAt).toBe(2);
    expect(result.parts[0].alphaBounds).toEqual(measured);
    expect(result.parts[1].alphaBounds).toEqual(existing.alphaBounds);
  });

  it("keeps document identity when no patch applies", () => {
    const character = createBlankCharacter();

    expect(applyMeasuredAlphaBounds(character, [], 2)).toBe(character);
    expect(
      applyMeasuredAlphaBounds(
        character,
        [
          {
            id: "missing-part",
            alphaBounds: {
              x: 0,
              y: 0,
              width: 1,
              height: 1,
              sourceWidth: 1,
              sourceHeight: 1,
              threshold: 8,
            },
          },
        ],
        2,
      ),
    ).toBe(character);
  });
});
