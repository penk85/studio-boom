import { describe, expect, it } from "vitest";
import { makePart } from "../character-utils";
import { previewLabels, wordToVisemes } from "../character-editor-preview";

describe("character editor preview helpers", () => {
  it("maps spoken letters to the existing viseme vocabulary", () => {
    expect(wordToVisemes("Mommy")).toEqual(["rest", "MBP", "O", "MBP", "MBP", "E", "rest"]);
  });

  it("offers role-native and configured custom previews", () => {
    expect(previewLabels(makePart("head", "head"))).toEqual([{ kind: "nod", label: "Test Nod" }]);
    expect(previewLabels(makePart("custom", "custom", { motionBehavior: "lipSync" }))).toEqual([
      { kind: "talk", label: "Test Talk" },
    ]);
  });
});
