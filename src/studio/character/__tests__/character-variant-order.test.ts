import { describe, expect, it } from "vitest";
import type { CharacterPart, EyeState, MouthViseme } from "../../types";
import { makePart } from "../character-utils";
import { orderCharacterVariants } from "../character-variant-order";

describe("orderCharacterVariants", () => {
  it("uses lip-sync order for mouth variants", () => {
    const parts = (["Smile", "O", "rest", "A"] as MouthViseme[]).map((viseme) =>
      makePart("mouth", `mouth-${viseme}`, {
        id: `mouth-${viseme}`,
        viseme,
      }),
    );

    expect(orderCharacterVariants(parts).map((part) => part.viseme)).toEqual([
      "rest",
      "A",
      "O",
      "Smile",
    ]);
  });

  it("uses blink order for eye variants", () => {
    const parts = (["wink", "closed", "open", "half"] as EyeState[]).map((eyeState) =>
      makePart("eye", `eye-${eyeState}`, {
        id: `eye-${eyeState}`,
        eyeState,
      }),
    );

    expect(orderCharacterVariants(parts).map((part) => part.eyeState)).toEqual([
      "open",
      "half",
      "closed",
      "wink",
    ]);
  });

  it("sorts other variants by key and then layer order without mutating the input", () => {
    const parts = [
      makePart("hand", "fist-high", {
        id: "fist-high",
        variant: { key: "fist", kind: "handShape" },
        zIndex: 8,
      }),
      makePart("hand", "open", {
        id: "open",
        variant: { key: "open", kind: "handShape" },
        zIndex: 2,
      }),
      makePart("hand", "fist-low", {
        id: "fist-low",
        variant: { key: "fist", kind: "handShape" },
        zIndex: 3,
      }),
    ] satisfies CharacterPart[];

    expect(orderCharacterVariants(parts).map((part) => part.id)).toEqual([
      "fist-low",
      "fist-high",
      "open",
    ]);
    expect(parts.map((part) => part.id)).toEqual(["fist-high", "open", "fist-low"]);
  });
});
