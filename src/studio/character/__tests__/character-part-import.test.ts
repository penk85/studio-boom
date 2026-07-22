import { describe, expect, it } from "vitest";
import type { CharacterPart } from "../../types";
import {
  defaultImportedVariantKind,
  detectImportedEyeState,
  detectImportedPartRole,
  detectImportedPartSide,
  detectImportedVariantKey,
  detectImportedViseme,
  fitImportedPartToCanvas,
  maxPartZIndex,
  slotIdForImportedPart,
  slugCharacterPartKey,
} from "../character-part-import";

describe("character part import helpers", () => {
  it("infers semantic metadata from artwork filenames", () => {
    expect(detectImportedPartRole("left-hand-fist.svg")).toBe("hand");
    expect(detectImportedPartSide("left-hand-fist.svg")).toBe("left");
    expect(detectImportedVariantKey("left-hand-fist.svg", "hand", "left")).toBe("fist");
    expect(detectImportedViseme("mouth-MBP.svg")).toBe("MBP");
    expect(detectImportedViseme("mouth-default.svg")).toBeUndefined();
    expect(detectImportedEyeState("right-eye-blink.svg")).toBe("closed");
  });

  it("centers and scales oversized artwork without enlarging smaller artwork", () => {
    expect(fitImportedPartToCanvas(2000, 1000, 1000, 1000)).toEqual({
      x: 150,
      y: 325,
      width: 700,
      height: 350,
    });
    expect(fitImportedPartToCanvas(100, 50, 1000, 1000)).toEqual({
      x: 450,
      y: 475,
      width: 100,
      height: 50,
    });
  });

  it("keeps slot, variant-kind, slug, and z-index defaults stable", () => {
    expect(slotIdForImportedPart("hand", "part-1", "right")).toBe("slot:right-hand");
    expect(slotIdForImportedPart("custom", "part-1", undefined)).toBe("custom:part-1");
    expect(defaultImportedVariantKind("mouth", "A", undefined)).toBe("viseme");
    expect(defaultImportedVariantKind("hand", undefined, undefined)).toBe("handShape");
    expect(slugCharacterPartKey("  Cape / Back  ")).toBe("cape-back");
    expect(
      maxPartZIndex([
        { zIndex: -2 } as CharacterPart,
        { zIndex: 7 } as CharacterPart,
        { zIndex: 3 } as CharacterPart,
      ]),
    ).toBe(7);
  });
});
