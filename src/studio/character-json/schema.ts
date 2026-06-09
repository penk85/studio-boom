import type {
  CharacterAngle,
  CharacterPart,
  CharacterPartBounds,
  EyeState,
  ID,
  MotionCategory,
  MouthViseme,
  PartRole,
} from "../types";

export const CHARACTER_JSON_KIND = "studioBoom.character.v1";
export const ANGLE_RIG_JSON_KIND = "studioBoom.angleRig.v1";
export const MOTION_JSON_KIND = "studioBoom.motion.v1";
export const CHARACTER_RIG_CONTEXT_AI_OUT_KIND = "studioBoom.ai.characterRigContext.v1";
export const MOTION_REQUEST_AI_OUT_KIND = "studioBoom.ai.motionRequest.v1";
export const RIG_SUGGESTION_AI_IN_KIND = "studioBoom.ai.rigSuggestion.v1";
export const MOTION_SUGGESTION_AI_IN_KIND = "studioBoom.ai.motionSuggestion.v1";

export const CHARACTER_JSON_SCHEMA_VERSION = 1;

export const MOTION_CATEGORY_VALUES: MotionCategory[] = [
  "expression",
  "gesture",
  "full-body",
  "camera",
  "headTurn",
  "custom",
];

const MOTION_CATEGORY_ALIASES: Record<string, MotionCategory> = {
  "body gesture": "gesture",
  bodygesture: "gesture",
  "camera move": "camera",
  cameramove: "camera",
  "full body": "full-body",
  fullbody: "full-body",
  full_body: "full-body",
};

export function normalizeMotionCategory(value: unknown): MotionCategory | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if ((MOTION_CATEGORY_VALUES as string[]).includes(normalized)) {
    return normalized as MotionCategory;
  }
  return MOTION_CATEGORY_ALIASES[normalized.toLowerCase()] ?? null;
}

export function normalizeMotionCategoryForImport(value: unknown): {
  category: MotionCategory;
  warning?: string;
} {
  const normalized = normalizeMotionCategory(value);
  if (normalized) return { category: normalized };
  const label = typeof value === "string" && value.trim() ? value.trim() : "unknown";
  return {
    category: "custom",
    warning: `Unknown motion category "${label}" will be imported as "custom". Choose one of: ${MOTION_CATEGORY_VALUES.join(", ")}.`,
  };
}

export type StudioBoomJsonKind =
  | typeof CHARACTER_JSON_KIND
  | typeof ANGLE_RIG_JSON_KIND
  | typeof MOTION_JSON_KIND
  | typeof CHARACTER_RIG_CONTEXT_AI_OUT_KIND
  | typeof MOTION_REQUEST_AI_OUT_KIND
  | typeof RIG_SUGGESTION_AI_IN_KIND
  | typeof MOTION_SUGGESTION_AI_IN_KIND;

export interface StudioBoomJsonArtifactBase {
  kind: StudioBoomJsonKind;
  schemaVersion: typeof CHARACTER_JSON_SCHEMA_VERSION;
  suggestedFilename: string;
}

export type SemanticType =
  | "bodyPart"
  | "faceFeature"
  | "mouthShape"
  | "clothing"
  | "prop"
  | "appendage"
  | "accessory"
  | "custom";

export interface SemanticBoneJson {
  id: ID;
  name: string;
  role: PartRole | "root" | "custom";
  aliases?: string[];
  aiHint?: string;
}

export interface SemanticSlotJson {
  id: ID;
  name: string;
  role: PartRole;
  semanticType: SemanticType;
  angleIds?: CharacterAngle[];
  aliases?: string[];
  aiHint?: string;
  defaultAttachment?: ID;
  preferredRig?: "single" | "chain" | "mesh";
}

export interface CharacterJson extends StudioBoomJsonArtifactBase {
  kind: typeof CHARACTER_JSON_KIND;
  id: ID;
  name: string;
  description?: string;
  defaultAngle: CharacterAngle;
  angles: CharacterAngle[];
  semanticBones: SemanticBoneJson[];
  semanticSlots: SemanticSlotJson[];
}

export interface AngleBoneJson {
  id: ID;
  semanticBoneId?: ID;
  name: string;
  role: PartRole | "root" | "custom";
  parentId: ID | null;
  x: number;
  y: number;
  rotation: number;
  depth?: number;
  length?: number;
  maxExtension?: number | null;
}

export interface AngleSlotVariantJson {
  id: ID;
  mediaId: ID;
  name: string;
  angleIds?: CharacterAngle[];
  pose?: string;
  viseme?: MouthViseme;
  eyeState?: EyeState;
}

export interface AngleSlotJson {
  id: ID;
  semanticSlotId?: ID;
  name: string;
  role: PartRole;
  variants: AngleSlotVariantJson[];
  bounds?: CharacterPartBounds;
}

export interface AngleSlotBindingJson {
  slotId: ID;
  boneId: ID;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  depth: number;
  defaultVariant?: ID;
  visible?: boolean;
}

export interface AngleHostConstraintJson {
  slotId: ID;
  hostSlotId?: ID;
  hostBoneId?: ID;
  mode: "insideHostMask" | "insideHostBounds" | "reach";
  reachPolicy?: "scaleToFit" | "cap" | "allow";
}

export interface AngleSlotRelationJson {
  id: ID;
  childSlotId: ID;
  parentRef:
    | { type: "slot"; id: ID }
    | { type: "semanticSlot"; id: ID }
    | { type: "role"; role: PartRole; side?: CharacterPart["side"] }
    | { type: "bone"; id: ID };
  relationType:
    | "attachment"
    | "containedFeature"
    | "decorativeChild"
    | "heldProp"
    | "clothingCoverage";
  activeWhenParentVariant?: {
    keys?: string[];
    partIds?: ID[];
  };
  transformMode: "inheritParent" | "independent";
  visibilityMode: "withParentSlot" | "withParentVariant" | "independent";
  renderMode: "nested" | "sibling";
  clipMode?: "none" | "clipToParentShape" | "clipToMaskSlot";
  clipSlotId?: ID;
  characterViewIds?: CharacterAngle[];
}

export interface AngleReachJson {
  id: ID;
  slotId: ID;
  reach?: Array<{ x: number; y: number }>;
  rotReach?: { min: number; max: number };
}

export interface AngleRigJson extends StudioBoomJsonArtifactBase {
  kind: typeof ANGLE_RIG_JSON_KIND;
  characterId: ID;
  angleId: CharacterAngle;
  canvas: { width: number; height: number };
  bones: AngleBoneJson[];
  slots: AngleSlotJson[];
  bindings: AngleSlotBindingJson[];
  slotRelations?: AngleSlotRelationJson[];
  hostConstraints?: AngleHostConstraintJson[];
  reaches?: AngleReachJson[];
  drawOrder: ID[];
}

export type MotionTargetJson =
  | { kind: "semanticBone"; id: ID }
  | { kind: "semanticSlot"; id: ID }
  | { kind: "angleBone"; angleId: CharacterAngle; id: ID }
  | { kind: "angleSlot"; angleId: CharacterAngle; id: ID }
  | { kind: "camera"; id?: "__camera" };

export type MotionTrackChannel = "transform" | "variant" | "visibility" | "opacity";

export interface MotionJsonKeyframe {
  t: number;
  dx?: number;
  dy?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  skewX?: number;
  skewY?: number;
  rotation?: number;
  originX?: number;
  originY?: number;
  opacity?: number;
  variant?: string;
  visible?: boolean;
  ease?: string;
}

export interface MotionJsonTrack {
  id: ID;
  angleIds?: CharacterAngle[];
  target: MotionTargetJson;
  channel: MotionTrackChannel;
  keyframes: MotionJsonKeyframe[];
}

export interface MotionJson extends StudioBoomJsonArtifactBase {
  kind: typeof MOTION_JSON_KIND;
  id: ID;
  name: string;
  category: MotionCategory;
  angleIds?: CharacterAngle[];
  duration: number;
  loop: boolean;
  targetSpace: "parentRelative";
  tracks: MotionJsonTrack[];
  constraints?: {
    defaultReachPolicy?: "scaleToFit" | "cap" | "allow";
    allowOutOfBounds?: Array<{
      target: MotionTargetJson;
      reason?: string;
    }>;
  };
  description?: string;
}

export interface JsonValidationIssue {
  path: string;
  message: string;
}

export interface JsonValidationResult {
  ok: boolean;
  errors: JsonValidationIssue[];
  warnings: JsonValidationIssue[];
}

export interface ResolvedMotionTarget {
  requested: MotionTargetJson;
  angleId: CharacterAngle;
  kind: "angleBone" | "angleSlot" | "camera";
  id: ID;
}

export interface CharacterRigContextAiOutJson extends StudioBoomJsonArtifactBase {
  kind: typeof CHARACTER_RIG_CONTEXT_AI_OUT_KIND;
  character: CharacterJson;
  angles: AngleRigJson[];
  instructions: string[];
  validKinds: {
    character: typeof CHARACTER_JSON_KIND;
    angleRig: typeof ANGLE_RIG_JSON_KIND;
    motion: typeof MOTION_JSON_KIND;
    rigSuggestion: typeof RIG_SUGGESTION_AI_IN_KIND;
    motionSuggestion: typeof MOTION_SUGGESTION_AI_IN_KIND;
  };
}

export interface MotionRequestAiOutJson extends StudioBoomJsonArtifactBase {
  kind: typeof MOTION_REQUEST_AI_OUT_KIND;
  request: string;
  character: CharacterJson;
  activeAngle: AngleRigJson;
  instructions: string[];
  exampleMotion: MotionJson;
}

export type InboundAiSuggestionJson =
  | (StudioBoomJsonArtifactBase & {
      kind: typeof RIG_SUGGESTION_AI_IN_KIND;
      character?: CharacterJson;
      angleRigs?: AngleRigJson[];
    })
  | (StudioBoomJsonArtifactBase & {
      kind: typeof MOTION_SUGGESTION_AI_IN_KIND;
      motion: MotionJson;
    });
