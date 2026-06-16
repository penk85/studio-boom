import { describe, expect, it } from "vitest";
import type { CharacterPreset, CharacterReach } from "../../types";
import { createBlankCharacter, makePart } from "../character-utils";
import { effectiveReachForSlot } from "../motion-constraints";
import { buildDefaultRig } from "../rig";
import { buildCharacterRuntime, runtimePartPlacement } from "../runtime";

function makeMultiAngleCharacter(): CharacterPreset {
  return {
    ...createBlankCharacter("Runtime actor"),
    id: "runtime-actor",
    angles: ["front", "3qR"],
    parts: [
      makePart("body", "front-body-media", {
        id: "front-body",
        slotId: "role:body",
        angleIds: ["front"],
        x: 100,
        y: 120,
        width: 200,
        height: 320,
        zIndex: 1,
      }),
      makePart("body", "3qr-body-media", {
        id: "3qr-body",
        slotId: "role:body",
        angleIds: ["3qR"],
        x: 120,
        y: 124,
        width: 205,
        height: 318,
        zIndex: 1,
      }),
      makePart("arm", "front-arm-media", {
        id: "front-arm",
        slotId: "slot:left-arm",
        side: "left",
        angleIds: ["front"],
        x: 70,
        y: 190,
        width: 70,
        height: 190,
        zIndex: 2,
      }),
      makePart("arm", "3qr-arm-media", {
        id: "3qr-arm",
        slotId: "slot:left-arm",
        side: "left",
        angleIds: ["3qR"],
        x: 86,
        y: 198,
        width: 72,
        height: 188,
        zIndex: 2,
      }),
      makePart("hand", "front-hand-media", {
        id: "front-hand",
        slotId: "slot:left-hand",
        side: "left",
        angleIds: ["front"],
        x: 75,
        y: 360,
        width: 52,
        height: 46,
        zIndex: 3,
      }),
      makePart("hand", "3qr-hand-media", {
        id: "3qr-hand",
        slotId: "slot:left-hand",
        side: "left",
        angleIds: ["3qR"],
        x: 93,
        y: 365,
        width: 54,
        height: 45,
        zIndex: 3,
      }),
    ],
  };
}

describe("character runtime resolver", () => {
  it("scopes slots and bindings to the active angle", () => {
    const character = makeMultiAngleCharacter();
    const runtime = buildCharacterRuntime({
      ...character,
      rig: buildDefaultRig(character, "3qR"),
    });

    expect(runtime.angle).toBe("3qR");
    expect(runtime.slots.map((slot) => [slot.id, slot.parts.map((part) => part.id)])).toEqual([
      ["role:body", ["3qr-body"]],
      ["slot:left-arm", ["3qr-arm"]],
      ["slot:left-hand", ["3qr-hand"]],
    ]);
    expect(runtime.bindingBySlot.get("slot:left-hand")?.effectiveBoneId).toBe(
      "bone:slot:left-hand",
    );
    expect(runtime.worldByBone.has("bone:slot:left-hand")).toBe(true);
  });

  it("builds constraint context from the active angle rig instead of stale top-level mirrors", () => {
    const character = makeMultiAngleCharacter();
    const baseRig = buildDefaultRig(character, "3qR");
    const frontReach: CharacterReach = {
      id: "reach:front-hand",
      slotId: "slot:left-hand",
      rotReach: { min: -90, max: 90 },
    };
    const activeReach: CharacterReach = {
      id: "reach:3qr-hand",
      slotId: "slot:left-hand",
      rotReach: { min: -12, max: 18 },
    };
    const frontRig = baseRig.angles?.front;
    const activeRig = baseRig.angles?.["3qR"];
    if (!frontRig || !activeRig) throw new Error("Expected front and 3qR angle rigs.");
    const runtime = buildCharacterRuntime({
      ...character,
      rig: {
        ...baseRig,
        activeAngle: "3qR",
        reaches: [frontReach],
        angles: {
          ...baseRig.angles,
          front: { ...frontRig, reaches: [frontReach] },
          "3qR": { ...activeRig, reaches: [activeReach] },
        },
      },
    });

    const { reach, source } = effectiveReachForSlot(runtime.constraintContext, "slot:left-hand");
    expect(source).toBe("slotRotReach");
    expect(reach?.rotReach).toEqual({ min: -12, max: 18 });
  });

  it("resolves part placement through bone rotation and slot pivot math", () => {
    const part = makePart("body", "body-media", {
      id: "body",
      slotId: "role:body",
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      anchorX: 0.5,
      anchorY: 0.5,
      pivot: { x: 10, y: 10 },
      zIndex: 1,
    });
    const character: CharacterPreset = {
      ...createBlankCharacter("Rotated runtime actor"),
      id: "rotated-runtime-actor",
      parts: [part],
      rig: {
        version: 1,
        activeAngle: "front",
        bones: [],
        slotBindings: [],
        drawOrder: [],
        slotRelations: [],
        hostConstraints: [],
        reaches: [],
        sockets: [],
        angles: {
          front: {
            angleId: "front",
            bones: [
              { id: "bone:root", name: "Root", role: "root", x: 0, y: 0, rotation: 0, depth: 0 },
              {
                id: "bone:role:body",
                name: "Body",
                role: "body",
                parentId: "bone:root",
                x: 100,
                y: 100,
                rotation: 90,
                depth: 0,
              },
            ],
            slotBindings: [
              {
                slotId: "role:body",
                boneId: "bone:role:body",
                x: 10,
                y: 0,
                rotation: 0,
                scaleX: 1,
                scaleY: 1,
                depth: 0,
              },
            ],
            drawOrder: ["role:body"],
            slotRelations: [],
            hostConstraints: [],
            reaches: [],
            sockets: [],
          },
        },
      },
    };

    const runtime = buildCharacterRuntime(character);
    const slot = runtime.slotById.get("role:body");
    if (!slot) throw new Error("Expected body slot.");

    const placement = runtimePartPlacement(slot, part, runtime);
    expect(placement.x).toBeCloseTo(80);
    expect(placement.y).toBeCloseTo(110);
    expect(placement.pivotX).toBeCloseTo(90);
    expect(placement.pivotY).toBeCloseTo(120);
    expect(placement.rotation).toBeCloseTo(90);
  });
});
