import { describe, expect, it } from "vitest";
import { createBlankCharacter, defaultLimbPathDeformForPart, makePart } from "../character-utils";
import { defaultLimbPathDeformForSlot } from "../deform-fit";
import { makeVariantArmCharacter } from "./fixtures";

describe("defaultLimbPathDeformForSlot", () => {
  it("fits an arm path from its rig joint to the child hand socket", () => {
    const character = makeVariantArmCharacter();
    const arm = character.parts.find((part) => part.id === "arm-straight");
    if (!arm) throw new Error("Expected arm fixture.");

    const deform = defaultLimbPathDeformForSlot(character, "slot:right-arm", arm);

    expect(deform.mode).toBe("limb-path");
    if (deform.mode !== "limb-path") return;
    expect(deform.start).toEqual({ x: 10, y: 10 });
    expect(deform.end.x).toBeCloseTo(20, 1);
    expect(deform.end.y).toBeCloseTo(185, 1);
    expect(deform.curve).toEqual({ x: 15, y: 97.5 });
    expect(deform.locks?.[0]).toEqual({ x: 11.4, y: 34.5 });
  });

  it("falls back to visible artwork when a slot has ambiguous children", () => {
    const body = makePart("body", "body-media", {
      id: "body",
      slotId: "role:body",
      x: 100,
      y: 100,
      width: 200,
      height: 320,
      alphaBounds: { x: 20, y: 10, width: 160, height: 300, sourceWidth: 200, sourceHeight: 320 },
    });
    const arm = makePart("arm", "arm-media", {
      id: "arm",
      slotId: "slot:right-arm",
      side: "right",
      x: 260,
      y: 140,
      width: 60,
      height: 170,
    });
    const leg = makePart("leg", "leg-media", {
      id: "leg",
      slotId: "slot:right-leg",
      side: "right",
      x: 210,
      y: 390,
      width: 70,
      height: 210,
    });
    const character = { ...createBlankCharacter("Body"), parts: [body, arm, leg] };

    expect(defaultLimbPathDeformForSlot(character, "role:body", body)).toEqual(
      defaultLimbPathDeformForPart(body),
    );
  });
});
