import {
  CHARACTER_JSON_SCHEMA_VERSION,
  CHARACTER_RIG_CONTEXT_AI_OUT_KIND,
  MOTION_REQUEST_AI_OUT_KIND,
  MOTION_SUGGESTION_AI_IN_KIND,
  RIG_SUGGESTION_AI_IN_KIND,
  type AngleRigJson,
  type CharacterJson,
  type CharacterRigContextAiOutJson,
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
      "Prefer semanticBone targets for inherited body movement.",
      "Prefer semanticSlot targets for variant swaps, visibility, opacity, or local offsets.",
      "Do not duplicate parent translations on children. Children inherit bone motion.",
      "Use finite normalized keyframe times from 0 to 1.",
    ],
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
    ],
    constraints: { defaultReachPolicy: "scaleToFit" },
  };
}
