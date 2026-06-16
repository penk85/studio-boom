import type {
  CharacterAngle,
  CharacterPart,
  CharacterPartBounds,
  CharacterVariantAiMetadata,
  CharacterVariantArtwork,
  CharacterVariantRigPackage,
  CharacterSlotVariant,
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

/**
 * The native transform control surface the AI authors motion from. This is the single source of
 * truth for (a) what the prompt advertises, (b) which keyframe fields validation accepts as finite
 * numbers, and (c) which fields the adapter interpolates. Editing this list updates all three so
 * OUT and IN can never drift. It is the control *vocabulary* — not a catalog of named movements.
 */
export const MOTION_TRANSFORM_FIELD_NAMES = [
  "dx",
  "dy",
  "scale",
  "scaleX",
  "scaleY",
  "skewX",
  "skewY",
  "rotation",
  "rotationX",
  "rotationY",
  "transformPerspective",
  "originX",
  "originY",
  "opacity",
] as const;

export type MotionTransformFieldName = (typeof MOTION_TRANSFORM_FIELD_NAMES)[number];

/** Human-facing unit + meaning for each transform field, used to build the AI control surface. */
export const MOTION_TRANSFORM_FIELD_DOCS: Record<
  MotionTransformFieldName,
  { unit: string; doc: string }
> = {
  dx: { unit: "px", doc: "Translate horizontally (parent-relative)." },
  dy: { unit: "px", doc: "Translate vertically (parent-relative)." },
  scale: { unit: "multiplier", doc: "Uniform scale (1 = unchanged)." },
  scaleX: { unit: "multiplier", doc: "Horizontal scale/squash (1 = unchanged)." },
  scaleY: { unit: "multiplier", doc: "Vertical scale/stretch (1 = unchanged)." },
  skewX: { unit: "deg", doc: "Horizontal skew." },
  skewY: { unit: "deg", doc: "Vertical skew." },
  rotation: { unit: "deg", doc: "2D rotation about the Z axis." },
  rotationX: { unit: "deg", doc: "3D rotation about the X axis (vertical flip)." },
  rotationY: { unit: "deg", doc: "3D rotation about the Y axis (horizontal/card flip)." },
  transformPerspective: {
    unit: "px",
    doc: "3D perspective depth; set this for believable rotationX/rotationY flips.",
  },
  originX: { unit: "0..1", doc: "Transform-origin X within the part (e.g. 0.5 = center)." },
  originY: { unit: "0..1", doc: "Transform-origin Y within the part (e.g. 0 = top edge)." },
  opacity: { unit: "0..1", doc: "Opacity; replaces the base value." },
};

/**
 * Easing names the renderer honors (the `EASE` map in presets/apply.ts implements exactly these).
 * Advertised to the AI and used by validation; keep the two in sync via this constant.
 */
export const MOTION_EASE_NAMES = [
  "linear",
  "easeIn",
  "easeOut",
  "easeInOut",
  "soft",
  "snappy",
  "overshoot",
  "bounce",
  "elastic",
  "hold",
] as const;

export type MotionEaseName = (typeof MOTION_EASE_NAMES)[number];

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
  displayName?: string;
  slotCompatibility?: ID[];
  angleIds?: CharacterAngle[];
  variant?: CharacterSlotVariant;
  artwork?: CharacterVariantArtwork;
  rig?: CharacterVariantRigPackage;
  aiMetadata?: CharacterVariantAiMetadata;
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
  /** Angle-local joints: base socket anchors plus optional per-parent-variant overrides. */
  sockets?: Array<{
    id: ID;
    slotId: ID;
    childSlotId: ID;
    name?: string;
    x: number;
    y: number;
    rotation?: number;
    variantAnchors: Record<string, { x: number; y: number; rotation?: number }>;
  }>;
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
  /** 3D rotation about the X axis (vertical flip), degrees. */
  rotationX?: number;
  /** 3D rotation about the Y axis (horizontal / card flip), degrees. */
  rotationY?: number;
  /** 3D perspective depth in px; set for believable rotationX/rotationY flips. */
  transformPerspective?: number;
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

/**
 * DEFERRED / RESERVED SEAM — not rendered yet. Temporary decorations that belong to a motion
 * (hearts, tears, sparkles, etc.). When implemented these will be **restricted, sanitized vector
 * overlays**: a constrained, whitelisted vector vocabulary sanitized before it enters the DOM, with
 * motion driven by our GSAP schedule — NOT arbitrary inline SVG/markup, and no SMIL/CSS animation
 * inside the overlay (so playback stays seek-deterministic). Validation currently warns and ignores.
 */
export interface MotionOverlayJson {
  id: ID;
  /** Restricted overlay kind (validated against a whitelist in the future render phase). */
  kind: string;
  /** Rig target the overlay is anchored to. */
  anchor: MotionTargetJson;
  /** Normalized [0..1] spawn/clear window within the motion. */
  start?: number;
  duration?: number;
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
  /** Reserved seam for restricted/sanitized vector overlays. Not rendered yet (see MotionOverlayJson). */
  overlays?: MotionOverlayJson[];
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

export interface MotionPromptCharacterJson {
  id: ID;
  name: string;
  description?: string;
  defaultAngle: CharacterAngle;
  angles: CharacterAngle[];
  semanticBones: SemanticBoneJson[];
  semanticSlots: SemanticSlotJson[];
}

export interface MotionPromptBoneJson {
  id: ID;
  semanticBoneId?: ID;
  name: string;
  role: PartRole | "root" | "custom";
  side?: CharacterPart["side"];
  parentId: ID | null;
  /** Local rest offset from the parent bone, in canvas pixels. */
  x: number;
  y: number;
  /** Local rest rotation relative to the parent bone, degrees. */
  rotation: number;
  depth?: number;
  /** Authored/fallback length from the source rig, when present. */
  length?: number;
  /** Canvas-space rest pivot after parent transforms are resolved. */
  pivot: { x: number; y: number };
  /** Canvas-space rest direction, degrees. Prefer this over placeholder local rotations. */
  restAngle: number;
  /** Motion-facing segment length in pixels, derived from child pivots when possible. */
  segmentLength: number;
  segmentVector?: { x: number; y: number };
  segmentChildId?: ID;
  lengthSource: "childPivot" | "authoredLength" | "slotBounds" | "zero";
  jointRange?: { min: number; max: number; source: "slotRotReach" };
}

export interface MotionPromptSlotVariantJson {
  id: ID;
  name: string;
  displayName?: string;
  variant?: CharacterSlotVariant;
  pose?: string;
  viseme?: MouthViseme;
  eyeState?: EyeState;
  aiMetadata?: CharacterVariantAiMetadata;
  angleIds?: CharacterAngle[];
}

export interface MotionPromptSlotJson {
  id: ID;
  semanticSlotId?: ID;
  name: string;
  role: PartRole;
  side?: CharacterPart["side"];
  bounds?: CharacterPartBounds;
  drawOrderIndex?: number;
  nearFar?: "near" | "far" | "center";
  binding?: {
    boneId: ID;
    defaultVariant?: ID;
    visible?: boolean;
    depth: number;
  };
  motionLimits?: MotionPromptReachJson;
  contact?: {
    canPlant: boolean;
    groundY?: number;
    footLockAvailable: boolean;
    hint: string;
  };
  variants: MotionPromptSlotVariantJson[];
}

export interface MotionPromptReachJson {
  slotId: ID;
  reachBounds?: { minX: number; maxX: number; minY: number; maxY: number };
  rotReach?: { min: number; max: number };
}

export interface MotionPromptAngleJson {
  angleId: CharacterAngle;
  canvas: { width: number; height: number };
  facing: {
    forwardAxis: "+x" | "-x" | "camera";
    screenVector: { x: number; y: number };
    hint: string;
  };
  ground: {
    y: number;
    source: "slotBounds" | "bonePivots" | "canvasBottom";
    plantedSlotIds: ID[];
    footLockAvailable: boolean;
    hint: string;
  };
  cadenceHints: {
    characterHeightPx: number;
    suggestedStepDurationSec: number;
    stepsPerCycle: number;
    stridePxRange: { min: number; max: number };
  };
  depthOrdering: {
    animationSupported: boolean;
    nearToFarSlotIds: ID[];
    hint: string;
  };
  boneLocks?: Array<{
    parentBoneId: ID;
    childBoneId: ID;
    childSlotId?: ID;
    policy: "fkInheritsParent";
    ikAvailable: boolean;
    hint: string;
  }>;
  bones: MotionPromptBoneJson[];
  slots: MotionPromptSlotJson[];
  slotRelations?: AngleSlotRelationJson[];
  hostConstraints?: AngleHostConstraintJson[];
  reaches?: MotionPromptReachJson[];
  sockets?: Array<{
    id: ID;
    slotId: ID;
    childSlotId: ID;
    name?: string;
    x: number;
    y: number;
    rotation?: number;
    variantKeys: string[];
  }>;
}

/** The native control surface advertised to the AI — what it can author motion from. */
export interface MotionControlSurfaceJson {
  /** Per-keyframe transform fields on a transform track (name, unit, meaning). */
  transformFields: Array<{ name: MotionTransformFieldName; unit: string; doc: string }>;
  /** Easing names the renderer honors for per-keyframe `ease`. */
  easings: MotionEaseName[];
  /** Channels a track can use. */
  channels: MotionTrackChannel[];
  /** Target kinds a track can address. */
  targetKinds: string[];
  /** Plain-language reminder of how to compose movements from these controls. */
  note: string;
}

export interface MotionRequestAiOutJson extends StudioBoomJsonArtifactBase {
  kind: typeof MOTION_REQUEST_AI_OUT_KIND;
  request: string;
  character: MotionPromptCharacterJson;
  activeAngle: MotionPromptAngleJson;
  instructions: string[];
  /** Native controls the AI authors movement from (single source of truth, see MOTION_TRANSFORM_FIELD_NAMES). */
  controls: MotionControlSurfaceJson;
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
