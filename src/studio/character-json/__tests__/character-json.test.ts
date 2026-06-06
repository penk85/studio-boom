import { describe, expect, it } from "vitest";
import type { CharacterPreset, MotionPreset } from "../../types";
import { createBlankCharacter, makePart } from "../../character/character-utils";
import {
  angleRigJsonFromPreset,
  characterJsonFromPreset,
  motionJsonFromPreset,
} from "../normalize";
import { buildCharacterRigContextAiOut, buildMotionRequestAiOut } from "../ai-context";
import { motionJsonToPreset } from "../../presets/motion-json";
import {
  resolveMotionTarget,
  validateAngleRigJson,
  validateCharacterJson,
  validateMotionJsonForAngle,
} from "../validate";

function makeCharacter(): CharacterPreset {
  return {
    ...createBlankCharacter("Marisol"),
    id: "marisol",
    canvasWidth: 900,
    canvasHeight: 1200,
    parts: [
      makePart("body", "body-media", {
        id: "body",
        slotId: "slot:torso",
        slotName: "Torso",
        x: 340,
        y: 420,
        width: 220,
        height: 360,
        zIndex: 10,
      }),
      makePart("hand", "hand-open-media", {
        id: "right-hand-open",
        slotId: "slot:rightHand",
        slotName: "Right hand",
        side: "right",
        pose: "openPalm",
        x: 580,
        y: 540,
        width: 80,
        height: 90,
        zIndex: 30,
      }),
      makePart("hand", "hand-fist-media", {
        id: "right-hand-fist",
        slotId: "slot:rightHand",
        slotName: "Right hand",
        side: "right",
        pose: "closedFist",
        x: 580,
        y: 540,
        width: 80,
        height: 90,
        zIndex: 30,
      }),
      makePart("custom", "umbrella-media", {
        id: "umbrella",
        slotId: "slot:umbrella",
        slotName: "Umbrella",
        pose: "open",
        x: 630,
        y: 240,
        width: 220,
        height: 260,
        zIndex: 35,
      }),
    ],
  };
}

function makeMotion(): MotionPreset {
  return {
    id: "hand-clap",
    name: "Hand Clap",
    category: "gesture",
    duration: 0.9,
    loop: false,
    tracks: [
      {
        target: "bone",
        boneId: "bone:slot:rightHand",
        partRole: "hand",
        keyframes: [
          { t: 0, rotation: 0 },
          { t: 0.5, rotation: 20 },
          { t: 1, rotation: 0 },
        ],
      },
      {
        partRole: "hand",
        slotId: "slot:rightHand",
        poseSwap: "closedFist",
        keyframes: [
          { t: 0, opacity: 1 },
          { t: 1, opacity: 1 },
        ],
      },
    ],
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("character JSON architecture", () => {
  it("creates identifiable canonical JSON artifacts from a character", () => {
    const character = makeCharacter();
    const characterJson = characterJsonFromPreset(character);
    const angleRig = angleRigJsonFromPreset(character, "front");

    expect(characterJson.kind).toBe("studioBoom.character.v1");
    expect(characterJson.suggestedFilename).toBe("marisol.character.json");
    expect(angleRig.kind).toBe("studioBoom.angleRig.v1");
    expect(angleRig.suggestedFilename).toBe("marisol.front.angle-rig.json");
    expect(characterJson.semanticSlots.find((slot) => slot.id === "slot:umbrella")).toMatchObject({
      role: "custom",
      semanticType: "prop",
    });
    expect(validateCharacterJson(characterJson).ok).toBe(true);
    expect(validateAngleRigJson(angleRig).ok).toBe(true);
  });

  it("validates angle rig references before generated HTML is touched", () => {
    const angleRig = angleRigJsonFromPreset(makeCharacter(), "front");
    const broken = {
      ...angleRig,
      bindings: angleRig.bindings.map((binding, index) =>
        index === 0 ? { ...binding, boneId: "missing:bone" } : binding,
      ),
    };

    const validation = validateAngleRigJson(broken);

    expect(validation.ok).toBe(false);
    expect(validation.errors.map((issue) => issue.message).join("\n")).toContain("Missing bone");
  });

  it("resolves semantic motion targets to the active angle", () => {
    const angleRig = angleRigJsonFromPreset(makeCharacter(), "front");

    const hand = resolveMotionTarget({ kind: "semanticSlot", id: "slot:rightHand" }, angleRig);

    expect(hand.ok).toBe(true);
    if (hand.ok) {
      expect(hand.target).toMatchObject({
        kind: "angleSlot",
        angleId: "front",
        id: "slot:rightHand",
      });
    }
  });

  it("fails clearly when a semantic target is unmapped for an angle", () => {
    const angleRig = {
      ...angleRigJsonFromPreset(makeCharacter(), "front"),
      angleId: "sideL" as const,
      slots: [],
      bindings: [],
      drawOrder: [],
    };
    const motion = {
      kind: "studioBoom.motion.v1",
      schemaVersion: 1,
      suggestedFilename: "hand-clap.motion.json",
      id: "motion:hand-clap",
      name: "Hand Clap",
      category: "gesture",
      duration: 1,
      loop: false,
      targetSpace: "parentRelative",
      tracks: [
        {
          id: "track:right-hand",
          target: { kind: "semanticSlot", id: "slot:rightHand" },
          channel: "variant",
          keyframes: [{ t: 0, variant: "closedFist" }],
        },
      ],
    };

    const validation = validateMotionJsonForAngle(motion, angleRig);

    expect(validation.ok).toBe(false);
    expect(validation.errors.map((issue) => issue.message).join("\n")).toContain(
      'angle "sideL" has no mapped slot',
    );
  });

  it("exports AI context and motion request JSON with obvious directions", () => {
    const character = makeCharacter();
    const characterJson = characterJsonFromPreset(character);
    const angleRig = angleRigJsonFromPreset(character, "front");
    const motionJson = motionJsonFromPreset(makeMotion());

    const rigContext = buildCharacterRigContextAiOut(characterJson, [angleRig]);
    const motionRequest = buildMotionRequestAiOut({
      character: characterJson,
      activeAngle: angleRig,
      request: "Forward walk",
      exampleMotion: motionJson,
    });

    expect(rigContext.kind).toBe("studioBoom.ai.characterRigContext.v1");
    expect(rigContext.suggestedFilename).toBe("marisol.rig-context.ai-out.json");
    expect(motionRequest.kind).toBe("studioBoom.ai.motionRequest.v1");
    expect(motionRequest.suggestedFilename).toBe("forward-walk.motion-request.ai-out.json");
    expect(motionRequest.instructions.join("\n")).toContain("semanticBone");
    expect(motionJson.suggestedFilename).toBe("hand-clap.motion.json");
  });

  it("converts valid AI motion JSON into an editable MotionPreset", () => {
    const angleRig = angleRigJsonFromPreset(makeCharacter(), "front");
    const result = motionJsonToPreset(
      {
        kind: "studioBoom.motion.v1",
        schemaVersion: 1,
        suggestedFilename: "hand-clap.motion.json",
        id: "motion:hand-clap",
        name: "Hand Clap",
        category: "gesture",
        duration: 1,
        loop: false,
        targetSpace: "parentRelative",
        tracks: [
          {
            id: "track:right-hand-bone",
            target: { kind: "semanticBone", id: "bone:slot:rightHand" },
            channel: "transform",
            keyframes: [
              { t: 0, rotation: 0 },
              { t: 0.5, rotation: 25 },
              { t: 1, rotation: 0 },
            ],
          },
          {
            id: "track:right-hand-variant",
            target: { kind: "semanticSlot", id: "slot:rightHand" },
            channel: "variant",
            keyframes: [
              { t: 0, variant: "openPalm" },
              { t: 0.5, variant: "closedFist" },
            ],
          },
        ],
      },
      angleRig,
      { id: "preset:ai-hand-clap", createdAt: 10, updatedAt: 20 },
    );

    expect(result.errors).toEqual([]);
    expect(result.preset).toMatchObject({
      id: "preset:ai-hand-clap",
      name: "Hand Clap",
      category: "gesture",
      duration: 1,
      loop: false,
      builtin: false,
      createdAt: 10,
      updatedAt: 20,
    });
    expect(result.preset?.keyposes?.some((keypose) => keypose.t === 0.5)).toBe(true);
    expect(
      result.preset?.keyposes
        ?.flatMap((keypose) => keypose.parts)
        .some((part) => part.target === "bone" && part.boneId === "bone:slot:rightHand"),
    ).toBe(true);
    expect(
      result.preset?.keyposes
        ?.flatMap((keypose) => keypose.parts)
        .some((part) => part.slotId === "slot:rightHand" && part.poseSwap === "closedFist"),
    ).toBe(true);
  });

  it("rejects AI motion JSON with invalid slot variants before preset creation", () => {
    const angleRig = angleRigJsonFromPreset(makeCharacter(), "front");
    const result = motionJsonToPreset(
      {
        kind: "studioBoom.motion.v1",
        schemaVersion: 1,
        suggestedFilename: "bad.motion.json",
        id: "motion:bad",
        name: "Bad Variant",
        category: "gesture",
        duration: 1,
        loop: false,
        targetSpace: "parentRelative",
        tracks: [
          {
            id: "track:right-hand-variant",
            target: { kind: "semanticSlot", id: "slot:rightHand" },
            channel: "variant",
            keyframes: [{ t: 0, variant: "laserHand" }],
          },
        ],
      },
      angleRig,
      { id: "preset:bad" },
    );

    expect(result.preset).toBeUndefined();
    expect(result.errors.join("\n")).toContain('Variant "laserHand" is not defined');
  });
});
