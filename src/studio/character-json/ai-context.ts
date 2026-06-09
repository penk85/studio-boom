import {
  CHARACTER_JSON_SCHEMA_VERSION,
  CHARACTER_RIG_CONTEXT_AI_OUT_KIND,
  MOTION_EASE_NAMES,
  MOTION_REQUEST_AI_OUT_KIND,
  MOTION_SUGGESTION_AI_IN_KIND,
  MOTION_TRANSFORM_FIELD_DOCS,
  MOTION_TRANSFORM_FIELD_NAMES,
  RIG_SUGGESTION_AI_IN_KIND,
  type AngleRigJson,
  type CharacterJson,
  type CharacterRigContextAiOutJson,
  type MotionControlSurfaceJson,
  type MotionJson,
  type MotionRequestAiOutJson,
} from "./schema";
import { aiOutFilename, motionJsonFilename, slugifyName } from "./normalize";

export function buildCharacterRigContextAiOut(
  character: CharacterJson,
  angles: AngleRigJson[],
): CharacterRigContextAiOutJson {
  return {
    kind: CHARACTER_RIG_CONTEXT_AI_OUT_KIND,
    schemaVersion: CHARACTER_JSON_SCHEMA_VERSION,
    suggestedFilename: aiOutFilename(character.name, "rig-context"),
    character,
    angles,
    instructions: [
      "Return only valid JSON.",
      `For rig changes, use kind "${RIG_SUGGESTION_AI_IN_KIND}".`,
      `For motion changes, use kind "${MOTION_SUGGESTION_AI_IN_KIND}".`,
      "Use semanticBone and semanticSlot targets when the motion should work across angles.",
      "Use angleBone or angleSlot targets only for angle-specific edits.",
      "Use motion.angleIds or track.angleIds when a movement is intended only for specific character angles.",
      "Bone transform tracks are parent-relative. Do not restate inherited parent motion on child bones.",
      "Slot variant tracks can swap any slot variant, including hands, clothing, props, eyes, and mouths.",
      "Depth is for parallax. Draw order is for visual stacking. Do not mix them.",
    ],
    validKinds: {
      character: "studioBoom.character.v1",
      angleRig: "studioBoom.angleRig.v1",
      motion: "studioBoom.motion.v1",
      rigSuggestion: RIG_SUGGESTION_AI_IN_KIND,
      motionSuggestion: MOTION_SUGGESTION_AI_IN_KIND,
    },
  };
}

/**
 * The native control surface advertised to the AI. Built from the same shared constants validation
 * uses, so what we advertise (OUT) is exactly what we accept (IN). This describes the control
 * *vocabulary* — the AI composes the actual movement; the editor defines no named effects.
 */
export function buildMotionControlSurface(): MotionControlSurfaceJson {
  return {
    transformFields: MOTION_TRANSFORM_FIELD_NAMES.map((name) => ({
      name,
      unit: MOTION_TRANSFORM_FIELD_DOCS[name].unit,
      doc: MOTION_TRANSFORM_FIELD_DOCS[name].doc,
    })),
    easings: [...MOTION_EASE_NAMES],
    channels: ["transform", "variant", "visibility", "opacity"],
    targetKinds: ["semanticBone", "semanticSlot", "angleBone", "angleSlot", "camera"],
    note:
      "Compose movements yourself from these primitives — there are no named effects. A card flip " +
      "is rotationY 0→360 with transformPerspective; a pendulum is an oscillating rotation with an " +
      "off-center origin (e.g. originY 0); a spin is rotation 0→360. Keyframe times t are normalized " +
      "0..1 and transforms are parent-relative.",
  };
}

export function buildMotionRequestAiOut(args: {
  character: CharacterJson;
  activeAngle: AngleRigJson;
  request: string;
  exampleMotion?: MotionJson;
}): MotionRequestAiOutJson {
  const requestSlug = slugifyName(args.request, "motion-request");
  return {
    kind: MOTION_REQUEST_AI_OUT_KIND,
    schemaVersion: CHARACTER_JSON_SCHEMA_VERSION,
    suggestedFilename: `${requestSlug}.motion-request.ai-out.json`,
    request: args.request,
    character: args.character,
    activeAngle: args.activeAngle,
    instructions: [
      "Return a single JSON object.",
      `Use kind "${MOTION_SUGGESTION_AI_IN_KIND}" with a nested motion object of kind "studioBoom.motion.v1".`,
      "Use targetSpace parentRelative.",
      'Choose category from exactly: "expression", "gesture", "full-body", "camera", "headTurn", or "custom". Do not invent category labels.',
      "Author the movement yourself from the native controls in `controls` — there are no named effects. Express flips, spins, swings, twirls, etc. directly as transform keyframes.",
      "Use rotationX/rotationY together with transformPerspective for true 3D (flips, card flips); plain rotation is 2D about the Z axis.",
      "Set each keyframe's `ease` from controls.easings to shape the curve between keyframes; for oscillations (swing/pendulum) author multiple keyframes.",
      "Prefer semanticBone targets for inherited body movement.",
      "Prefer semanticSlot targets for variant swaps, visibility, opacity, or local offsets.",
      `Set angleIds to ["${args.activeAngle.angleId}"] when the requested motion is only valid for this angle.`,
      "Do not duplicate parent translations on children. Children inherit bone motion.",
      "Use finite normalized keyframe times from 0 to 1.",
    ],
    controls: buildMotionControlSurface(),
    exampleMotion: args.exampleMotion ?? exampleMotion(args.request),
  };
}

function exampleMotion(request: string): MotionJson {
  const name = request.trim() || "Example Gesture";
  return {
    kind: "studioBoom.motion.v1",
    schemaVersion: CHARACTER_JSON_SCHEMA_VERSION,
    suggestedFilename: motionJsonFilename(name),
    id: `motion:${slugifyName(name, "example")}`,
    name,
    category: "gesture",
    duration: 1,
    loop: false,
    targetSpace: "parentRelative",
    tracks: [
      {
        id: "track:body",
        target: { kind: "semanticBone", id: "bone:torso" },
        channel: "transform",
        keyframes: [
          { t: 0, dy: 0 },
          { t: 0.5, dy: -12, ease: "easeOut" },
          { t: 1, dy: 0, ease: "easeIn" },
        ],
      },
      {
        id: "track:right-hand-variant",
        target: { kind: "semanticSlot", id: "slot:rightHand" },
        channel: "variant",
        keyframes: [
          { t: 0, variant: "openPalm" },
          { t: 0.5, variant: "closedFist" },
          { t: 1, variant: "openPalm" },
        ],
      },
      {
        // Illustrative 3D "card flip" — authored as plain keyframes, not a named effect.
        id: "track:head-cardflip",
        target: { kind: "semanticBone", id: "bone:head" },
        channel: "transform",
        keyframes: [
          { t: 0, rotationY: 0, transformPerspective: 800, ease: "easeInOut" },
          { t: 1, rotationY: 360, transformPerspective: 800, ease: "easeInOut" },
        ],
      },
      {
        // Illustrative "pendulum" — oscillating 2D rotation pivoting from the top edge (originY 0).
        id: "track:arm-pendulum",
        target: { kind: "semanticBone", id: "bone:armR" },
        channel: "transform",
        keyframes: [
          { t: 0, rotation: 0, originY: 0, ease: "easeInOut" },
          { t: 0.25, rotation: 18, originY: 0, ease: "easeInOut" },
          { t: 0.75, rotation: -18, originY: 0, ease: "easeInOut" },
          { t: 1, rotation: 0, originY: 0, ease: "easeInOut" },
        ],
      },
    ],
    constraints: { defaultReachPolicy: "scaleToFit" },
  };
}
