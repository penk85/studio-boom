import { describe, expect, it } from "vitest";
import type { CharacterPreset, CharacterReach } from "../../types";
import { createBlankCharacter, makePart } from "../character-utils";
import { effectiveReachForSlot } from "../motion-constraints";
import { smartImportPlacement } from "../placement-guide";
import { buildDefaultRig } from "../rig";
import {
  buildCharacterRuntime,
  resolveRuntimeSlotPart,
  runtimeBoneWorldTransforms,
  runtimePartPlacement,
} from "../runtime";
import { makeVariantArmCharacter } from "./fixtures";

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
        version: 2,
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
                id: "bone:pelvis",
                name: "Pelvis",
                role: "custom",
                controlKind: "pelvis",
                parentId: "bone:root",
                x: 0,
                y: 0,
                rotation: 0,
                depth: 0,
              },
              {
                id: "bone:role:body",
                name: "Body",
                role: "body",
                parentId: "bone:pelvis",
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
    expect(placement.x).toBeCloseTo(90);
    expect(placement.y).toBeCloseTo(100);
    expect(placement.pivotX).toBeCloseTo(100);
    expect(placement.pivotY).toBeCloseTo(110);
    expect(placement.rotation).toBeCloseTo(90);
  });

  it("lets an explicit active-angle variant override the binding rest part", () => {
    const rest = makePart("arm", "rest-media", {
      id: "arm-rest",
      slotId: "slot:left-arm",
      side: "left",
      pose: "rest",
    });
    const raised = makePart("arm", "raised-media", {
      id: "arm-raised",
      slotId: "slot:left-arm",
      side: "left",
      pose: "raised",
    });
    const character = {
      ...createBlankCharacter("Variant actor"),
      parts: [rest, raised],
    };
    const builtRig = buildDefaultRig(character);
    const angleRig = builtRig.angles?.front;
    if (!angleRig) throw new Error("Expected front angle rig.");
    const runtime = buildCharacterRuntime({
      ...character,
      rig: {
        ...builtRig,
        angles: {
          ...builtRig.angles,
          front: {
            ...angleRig,
            slotBindings: angleRig.slotBindings.map((binding) =>
              binding.slotId === "slot:left-arm" ? { ...binding, partId: rest.id } : binding,
            ),
          },
        },
      },
    });
    const slot = runtime.slotById.get("slot:left-arm");
    if (!slot) throw new Error("Expected arm slot.");

    expect(resolveRuntimeSlotPart(slot, runtime)?.id).toBe(rest.id);
    expect(resolveRuntimeSlotPart(slot, runtime, "raised")?.id).toBe(raised.id);
  });

  it("does not move imported limb artwork after aligning it to an existing variant", () => {
    const body = makePart("body", "body-media", {
      id: "body",
      x: 150,
      y: 120,
      width: 260,
      height: 360,
    });
    const straight = makePart("arm", "arm-straight-media", {
      id: "arm-straight",
      slotId: "slot:left-arm",
      side: "left",
      pose: "straight",
      x: 198,
      y: 276,
      width: 50,
      height: 154,
      pivot: { x: 232, y: 292 },
    });
    const placement = smartImportPlacement({
      slotParts: [straight],
      role: "arm",
      side: "left",
      artWidth: 100,
      artHeight: 200,
      canvasWidth: 600,
      canvasHeight: 900,
    });
    if (!placement) throw new Error("Expected variant placement.");
    const bent = makePart("arm", "arm-bent-media", {
      id: "arm-bent",
      slotId: "slot:left-arm",
      side: "left",
      pose: "bent",
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      pivot: placement.pivot,
    });
    const character = {
      ...createBlankCharacter("Imported arm variant"),
      parts: [body, straight, bent],
    };
    const runtime = buildCharacterRuntime({
      ...character,
      rig: buildDefaultRig(character),
    });
    const slot = runtime.slotById.get("slot:left-arm");
    if (!slot) throw new Error("Expected left arm slot.");

    const rendered = runtimePartPlacement(slot, bent, runtime, { poseKey: "bent" });
    expect(rendered.x).toBeCloseTo(bent.x);
    expect(rendered.y).toBeCloseTo(bent.y);
  });

  it("uses the active parent variant socket for child placement", () => {
    const character = makeVariantArmCharacter();
    const runtime = buildCharacterRuntime({
      ...character,
      rig: buildDefaultRig(character),
    });
    const handSlot = runtime.slotById.get("slot:right-hand");
    const bentHand = handSlot ? resolveRuntimeSlotPart(handSlot, runtime, "bent") : undefined;
    if (!handSlot || !bentHand) throw new Error("Expected bent hand.");
    const activeVariants = {
      "slot:right-arm": "bent",
      "slot:right-hand": "bent",
    };
    const worldByBone = runtimeBoneWorldTransforms(runtime, activeVariants);
    const placement = runtimePartPlacement(handSlot, bentHand, runtime, {
      poseKey: "bent",
      activeVariants,
      worldByBone,
    });

    expect(worldByBone.get("bone:slot:right-hand")).toMatchObject({
      x: 370,
      y: 230,
    });
    expect(placement.pivotX).toBeCloseTo(370);
    expect(placement.pivotY).toBeCloseTo(230);
  });

  it("keeps mouth variants at their authored offsets from the rest mouth", () => {
    const rest = makePart("mouth", "mouth-rest-media", {
      id: "mouth-rest",
      slotId: "role:mouth",
      viseme: "rest",
      x: 210,
      y: 260,
      width: 90,
      height: 42,
      zIndex: 5,
    });
    const open = makePart("mouth", "mouth-a-media", {
      id: "mouth-a",
      slotId: "role:mouth",
      viseme: "A",
      x: 190,
      y: 250,
      width: 150,
      height: 70,
      zIndex: 5,
    });
    const character: CharacterPreset = {
      ...createBlankCharacter("Mouth runtime actor"),
      parts: [rest, open],
    };
    const runtime = buildCharacterRuntime({
      ...character,
      rig: buildDefaultRig(character),
    });
    const slot = runtime.slotById.get("role:mouth");
    if (!slot) throw new Error("Expected mouth slot.");

    const placement = runtimePartPlacement(slot, open, runtime, {
      poseKey: "A",
    });

    expect(placement.x).toBeCloseTo(open.x);
    expect(placement.y).toBeCloseTo(open.y);
    expect(placement.pivotX).toBeCloseTo(open.pivot!.x);
    expect(placement.pivotY).toBeCloseTo(open.pivot!.y);
  });
});
