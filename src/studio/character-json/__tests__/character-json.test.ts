import { describe, expect, it } from "vitest";
import type { CharacterPreset, MotionPreset } from "../../types";
import { createBlankCharacter, makePart } from "../../character/character-utils";
import {
  angleRigJsonFromPreset,
  characterJsonFromPreset,
  motionJsonFromPreset,
} from "../normalize";
import {
  buildCharacterRigContextAiOut,
  buildMotionControlSurface,
  buildMotionRequestAiOut,
} from "../ai-context";
import { motionJsonToPreset } from "../../presets/motion-json";
import {
  resolveMotionTarget,
  validateAngleRigJson,
  validateCharacterJson,
  validateMotionJson,
  validateMotionJsonForAngle,
} from "../validate";
import {
  MOTION_EASE_NAMES,
  MOTION_TRANSFORM_FIELD_NAMES,
  type MotionJson,
} from "../schema";

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
      makePart("head", "head-media", {
        id: "head",
        slotId: "slot:head",
        slotName: "Head",
        x: 370,
        y: 250,
        width: 160,
        height: 160,
        zIndex: 20,
      }),
      makePart("eye", "eye-media", {
        id: "left-eye",
        slotId: "slot:left-eye",
        slotName: "Left eye",
        side: "left",
        eyeState: "open",
        x: 410,
        y: 306,
        width: 40,
        height: 24,
        zIndex: 25,
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
    expect(
      angleRig.hostConstraints?.find((constraint) => constraint.slotId === "slot:left-eye"),
    ).toMatchObject({
      hostSlotId: "slot:head",
      mode: "insideHostMask",
    });
    expect(
      angleRig.slotRelations?.find((relation) => relation.childSlotId === "slot:left-eye"),
    ).toMatchObject({
      parentRef: { type: "slot", id: "slot:head" },
      relationType: "containedFeature",
      renderMode: "sibling",
    });
    expect(validateCharacterJson(characterJson).ok).toBe(true);
    expect(validateAngleRigJson(angleRig).ok).toBe(true);
  });

  it("exports available angles and filters angle rig variants by part angle tags", () => {
    const character: CharacterPreset = {
      ...createBlankCharacter("Turner"),
      id: "turner",
      angles: ["front", "sideL"],
      canvasWidth: 900,
      canvasHeight: 1200,
      parts: [
        makePart("body", "body-front-media", {
          id: "body-front",
          slotId: "slot:torso",
          slotName: "Torso",
          angleIds: ["front"],
          x: 340,
          y: 420,
          width: 220,
          height: 360,
          zIndex: 10,
        }),
        makePart("body", "body-side-media", {
          id: "body-side",
          slotId: "slot:torso",
          slotName: "Torso",
          angleIds: ["sideL"],
          x: 360,
          y: 420,
          width: 180,
          height: 360,
          zIndex: 10,
        }),
        makePart("hand", "shared-hand-media", {
          id: "shared-hand",
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
      ],
    };

    const characterJson = characterJsonFromPreset(character);
    const sideRig = angleRigJsonFromPreset(character, "sideL");

    expect(characterJson.angles).toEqual(["front", "sideL"]);
    expect(
      characterJson.semanticSlots.find((slot) => slot.id === "slot:rightHand")?.angleIds,
    ).toEqual(["front", "sideL"]);
    expect(
      sideRig.slots.find((slot) => slot.id === "slot:torso")?.variants.map((variant) => variant.id),
    ).toEqual(["body-side"]);
    expect(
      sideRig.slots.find((slot) => slot.id === "slot:rightHand")?.variants.map((variant) => variant.id),
    ).toEqual(["openPalm"]);
  });

  it("exports generic slot variant metadata for non-mouth and non-eye parts", () => {
    const character: CharacterPreset = {
      ...createBlankCharacter("Hands"),
      id: "hands",
      canvasWidth: 900,
      canvasHeight: 1200,
      parts: [
        makePart("hand", "hand-open-media", {
          id: "right-hand-open",
          slotId: "slot:rightHand",
          slotName: "Right hand",
          side: "right",
          variant: { key: "open", name: "Open hand", kind: "handShape" },
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
          variant: { key: "fist", name: "Fist", kind: "handShape" },
          x: 580,
          y: 540,
          width: 80,
          height: 90,
          zIndex: 30,
        }),
      ],
    };

    const angleRig = angleRigJsonFromPreset(character, "front");
    const handVariants = angleRig.slots.find((slot) => slot.id === "slot:rightHand")?.variants;

    expect(handVariants).toMatchObject([
      { id: "open", variant: { key: "open", name: "Open hand", kind: "handShape" } },
      { id: "fist", variant: { key: "fist", name: "Fist", kind: "handShape" } },
    ]);
    expect(validateAngleRigJson(angleRig).ok).toBe(true);
  });

  it("exports rich variant packages as self-contained slot variants", () => {
    const character: CharacterPreset = {
      ...createBlankCharacter("Rigged Arms"),
      id: "rigged-arms",
      canvasWidth: 900,
      canvasHeight: 1200,
      parts: [
        makePart("arm", "upper-arm-media", {
          id: "right-upper-arm-explaining",
          slotId: "slot:rightArm",
          slotName: "Right arm",
          side: "right",
          variantPackageId: "variant:explaining-arm",
          variant: { key: "variant:explaining-arm", name: "Bent elbow / explaining", kind: "pose" },
          x: 520,
          y: 330,
          width: 90,
          height: 150,
          zIndex: 30,
        }),
        makePart("arm", "forearm-media", {
          id: "right-forearm-explaining",
          slotId: "slot:rightArm",
          slotName: "Right arm",
          side: "right",
          variantPackageId: "variant:explaining-arm",
          variant: { key: "variant:explaining-arm", name: "Bent elbow / explaining", kind: "pose" },
          x: 610,
          y: 400,
          width: 120,
          height: 72,
          zIndex: 31,
        }),
      ],
      variantPackages: [
        {
          id: "variant:explaining-arm",
          key: "variant:explaining-arm",
          slotId: "slot:rightArm",
          displayName: "Bent elbow / explaining",
          slotCompatibility: ["slot:rightArm"],
          angleIds: ["front"],
          artwork: {
            partIds: ["right-upper-arm-explaining", "right-forearm-explaining"],
          },
          rig: {
            bones: [
              {
                id: "upperArm",
                pivot: { x: 520, y: 330 },
                defaultRotation: -20,
                rotationLimits: [-45, 20],
              },
              {
                id: "forearm",
                pivot: { x: 620, y: 410 },
                defaultRotation: -55,
                rotationLimits: [-80, -20],
              },
            ],
            controls: [
              {
                id: "elbowBend",
                label: "Elbow bend",
                type: "rotation",
                targetBoneId: "forearm",
                range: [0, 1],
              },
            ],
            clipping: {
              coverPartIds: ["right-forearm-explaining"],
              rules: ["forearm_under_upper_arm"],
            },
            sockets: {
              mount: { id: "rightShoulder", x: 520, y: 330 },
              outputs: [{ id: "wrist", childSlotId: "slot:rightHand", x: 700, y: 370 }],
            },
            zOrder: ["right-upper-arm-explaining", "right-forearm-explaining"],
          },
          aiMetadata: {
            plainDescription:
              "The right arm is raised with the elbow bent, useful for explaining.",
            tags: ["arm", "right", "bent", "explaining"],
            bodyPart: "arm",
            side: "right",
            energy: "medium",
            goodFor: ["explaining", "presenting"],
            lessIdealFor: ["sleeping"],
          },
        },
      ],
    };

    const angleRig = angleRigJsonFromPreset(character, "front");
    const armVariant = angleRig.slots.find((slot) => slot.id === "slot:rightArm")?.variants[0];

    expect(armVariant).toMatchObject({
      id: "variant:explaining-arm",
      displayName: "Bent elbow / explaining",
      artwork: { partIds: ["right-upper-arm-explaining", "right-forearm-explaining"] },
      rig: {
        controls: [{ id: "elbowBend", targetBoneId: "forearm" }],
        sockets: {
          mount: { id: "rightShoulder" },
          outputs: [{ id: "wrist", childSlotId: "slot:rightHand" }],
        },
      },
      aiMetadata: { tags: ["arm", "right", "bent", "explaining"] },
    });
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

  it("fails clearly when a motion is scoped to another angle", () => {
    const angleRig = angleRigJsonFromPreset(makeCharacter(), "sideL");
    const motion = {
      ...motionJsonFromPreset(makeMotion()),
      angleIds: ["front" as const],
    };

    const validation = validateMotionJsonForAngle(motion, angleRig);

    expect(validation.ok).toBe(false);
    expect(validation.errors.map((issue) => issue.message).join("\n")).toContain(
      'not available for angle "sideL"',
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

  it("normalizes unknown AI motion categories to custom", () => {
    const angleRig = angleRigJsonFromPreset(makeCharacter(), "front");
    const result = motionJsonToPreset(
      {
        kind: "studioBoom.motion.v1",
        schemaVersion: 1,
        suggestedFilename: "forward-walk.motion.json",
        id: "motion:forward-walk",
        name: "Forward Walk",
        category: "locomotion" as MotionPreset["category"],
        duration: 1,
        loop: true,
        targetSpace: "parentRelative",
        tracks: [
          {
            id: "track:body",
            target: { kind: "semanticBone", id: "bone:slot:rightHand" },
            channel: "transform",
            keyframes: [
              { t: 0, dy: 0 },
              { t: 0.5, dy: -8 },
              { t: 1, dy: 0 },
            ],
          },
        ],
      },
      angleRig,
      { id: "preset:forward-walk" },
    );

    expect(result.errors).toEqual([]);
    expect(result.preset?.category).toBe("custom");
    expect(result.warnings.join("\n")).toContain(
      'Unknown motion category "locomotion" will be imported as "custom"',
    );
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

describe("native motion control surface (3D + easing)", () => {
  function threeDMotion(extra: Partial<MotionJson> = {}): MotionJson {
    return {
      kind: "studioBoom.motion.v1",
      schemaVersion: 1,
      suggestedFilename: "card-flip.motion.json",
      id: "motion:card-flip",
      name: "Card Flip",
      category: "gesture",
      duration: 1,
      loop: false,
      targetSpace: "parentRelative",
      tracks: [
        {
          id: "track:flip",
          target: { kind: "semanticBone", id: "bone:slot:rightHand" },
          channel: "transform",
          keyframes: [
            { t: 0, rotationY: 0, transformPerspective: 800, ease: "easeInOut" },
            { t: 1, rotationY: 360, transformPerspective: 800, ease: "overshoot" },
          ],
        },
      ],
      ...extra,
    };
  }

  it("accepts a 3D transform motion (rotationY + transformPerspective)", () => {
    const angleRig = angleRigJsonFromPreset(makeCharacter(), "front");
    const validation = validateMotionJsonForAngle(threeDMotion(), angleRig);
    expect(validation.ok).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it("rejects non-finite 3D values", () => {
    const validation = validateMotionJson(
      threeDMotion({
        tracks: [
          {
            id: "track:flip",
            target: { kind: "semanticBone", id: "bone:slot:rightHand" },
            channel: "transform",
            keyframes: [{ t: 0, rotationY: Number.POSITIVE_INFINITY }],
          },
        ],
      }),
    );
    expect(validation.ok).toBe(false);
    expect(validation.errors.map((issue) => issue.path)).toContain(
      "$.tracks[0].keyframes[0].rotationY",
    );
  });

  it("converts a 3D motion into keyposes carrying rotationY/transformPerspective and source ease", () => {
    const angleRig = angleRigJsonFromPreset(makeCharacter(), "front");
    const result = motionJsonToPreset(threeDMotion(), angleRig, { id: "preset:flip" });
    expect(result.errors).toEqual([]);
    const parts = result.preset?.keyposes?.flatMap((keypose) => keypose.parts) ?? [];
    expect(parts.some((part) => (part.rotationY ?? 0) > 0)).toBe(true);
    expect(parts.some((part) => part.transformPerspective === 800)).toBe(true);
    // The AI's per-keyframe ease is preserved into the keypose (no longer hardcoded easeInOut).
    expect(result.preset?.keyposes?.some((keypose) => keypose.ease === "overshoot")).toBe(true);
  });

  it("warns (does not reject) on an unknown ease, so it can fall back gracefully", () => {
    const angleRig = angleRigJsonFromPreset(makeCharacter(), "front");
    const motion = threeDMotion({
      tracks: [
        {
          id: "track:flip",
          target: { kind: "semanticBone", id: "bone:slot:rightHand" },
          channel: "transform",
          keyframes: [
            { t: 0, rotation: 0, ease: "wobble" },
            { t: 1, rotation: 30 },
          ],
        },
      ],
    });
    const validation = validateMotionJsonForAngle(motion, angleRig);
    expect(validation.ok).toBe(true);
    expect(validation.warnings.map((issue) => issue.message).join("\n")).toContain(
      'Unknown ease "wobble"',
    );
  });

  it("warns (does not render) on overlays — the reserved sanitized-vector seam", () => {
    const validation = validateMotionJson(
      threeDMotion({
        overlays: [
          { id: "fx:hearts", kind: "hearts", anchor: { kind: "semanticBone", id: "bone:head" } },
        ],
      }),
    );
    expect(validation.ok).toBe(true);
    expect(validation.warnings.map((issue) => issue.path)).toContain("$.overlays");
  });

  it("advertises exactly the validated control vocabulary (OUT ≡ IN parity)", () => {
    const controls = buildMotionControlSurface();
    const advertised = controls.transformFields.map((field) => field.name);
    expect(advertised).toEqual([...MOTION_TRANSFORM_FIELD_NAMES]);
    expect(controls.easings).toEqual([...MOTION_EASE_NAMES]);
    // 3D controls must be present and documented for the AI.
    for (const name of ["rotationX", "rotationY", "transformPerspective"]) {
      const field = controls.transformFields.find((entry) => entry.name === name);
      expect(field?.doc.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("includes the controls + 3D example in the motion request package", () => {
    const character = makeCharacter();
    const motionRequest = buildMotionRequestAiOut({
      character: characterJsonFromPreset(character),
      activeAngle: angleRigJsonFromPreset(character, "front"),
      request: "Card flip",
    });
    expect(motionRequest.controls.transformFields.some((field) => field.name === "rotationY")).toBe(
      true,
    );
    const exampleKeyframes = motionRequest.exampleMotion.tracks.flatMap((track) => track.keyframes);
    expect(exampleKeyframes.some((keyframe) => keyframe.rotationY !== undefined)).toBe(true);
  });
});
