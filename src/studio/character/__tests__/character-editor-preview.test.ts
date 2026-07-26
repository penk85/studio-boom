import { describe, expect, it } from "vitest";
import { makePart } from "../character-utils";
import {
  activePreviewVariantForPart,
  previewDelta,
  previewLabels,
  wordToVisemes,
  type PreviewState,
} from "../character-editor-preview";

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

  it("samples geometric preview motion from an explicit timestamp", () => {
    const arm = makePart("arm", "arm", { id: "arm", slotId: "arm-left" });
    const preview: PreviewState = {
      kind: "wave",
      targetPartId: arm.id,
      targetSlotId: "arm-left",
      targetRole: "arm",
      startedAt: 1_000,
      durationMs: 1_000,
    };

    expect(previewDelta(arm, preview, undefined, [], undefined, 1_250)).toMatchObject({
      dx: 0,
      dy: 0,
      rotation: 18,
      scale: 1,
      opacity: 1,
    });
  });

  it("resolves blink and forced-viseme variants without renderer state", () => {
    const eye = makePart("eye", "eye", { slotId: "eyes", eyeState: "open" });
    const mouth = makePart("mouth", "mouth", { slotId: "mouth", viseme: "rest" });

    expect(
      activePreviewVariantForPart(
        eye,
        {
          kind: "blink",
          targetPartId: eye.id,
          targetSlotId: "eyes",
          targetRole: "eye",
          startedAt: 1_000,
          durationMs: 1_000,
        },
        1_450,
      ),
    ).toBe("closed");
    expect(
      activePreviewVariantForPart(mouth, {
        kind: "talk",
        targetPartId: mouth.id,
        targetSlotId: "mouth",
        targetRole: "mouth",
        startedAt: 1_000,
        durationMs: 1_000,
        forcedViseme: "MBP",
      }),
    ).toBe("MBP");
  });
});
