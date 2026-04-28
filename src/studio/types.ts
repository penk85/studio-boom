// Core domain types for the Hyperframes Movie Studio.
// These shapes are persisted in IndexedDB (via Dexie) and serialized into
// Hyperframes-compliant HTML on export.

export type ID = string;

/** Saved ElevenLabs voice for reuse */
export interface SavedVoice {
  id: ID;
  voiceId: string;
  name: string;
  createdAt: number;
}

/** Unit of media stored in IndexedDB. The Blob lives in `mediaBlobs` table. */
export interface MediaAsset {
  id: ID;
  name: string;
  /** "image" | "audio" | "video" */
  kind: "image" | "audio" | "video";
  /** Internal character/voice assets stay out of the user-facing media gallery. */
  scope?: "library" | "character-part" | "generated-audio";
  mimeType: string;
  /** Original filename (for export). */
  filename: string;
  /** Width/height for images & videos. */
  width?: number;
  height?: number;
  /** Duration in seconds for audio & video. */
  duration?: number;
  createdAt: number;
}

export interface MediaBlobRow {
  id: ID; // matches MediaAsset.id
  blob: Blob;
}

/** A character "part" — head, body, mouth shape, etc. */
export type PartRole =
  | "head"
  | "body"
  | "eye"
  | "eyebrow"
  | "mouth"
  | "arm"
  | "hand"
  | "leg"
  | "foot"
  | "hair"
  | "accessory"
  | "static"
  | "custom";

export type MouthViseme = "rest" | "A" | "E" | "O" | "U" | "MBP" | "FV" | "L" | "WQ" | "Smile";

export type EyeState = "open" | "half" | "closed" | "wink";

export type MovementPresetKind = "none" | "blink" | "rotate" | "raise" | "lipSync" | "bounce";

export type BoundsType = "rect" | "ellipse";

export interface CharacterPartBounds {
  type: BoundsType;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SvgMorphMetadata {
  /** First path from the uploaded SVG, saved for future path interpolation. */
  primaryPath?: string;
  viewBox?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: string;
  strokeLinecap?: string;
  strokeLinejoin?: string;
  /** Number of path commands in primaryPath. Useful to diagnose morph readiness. */
  commandCount?: number;
  /** True when this mouth has the same command count as the rest mouth. */
  compatibleWithRest?: boolean;
}

export interface CharacterPart {
  id: ID;
  /** Stable animatable layer. Variants of the same layer share this id. */
  slotId: ID;
  /** User-facing slot label, e.g. "Left brow" or "Mouth". */
  slotName?: string;
  role: PartRole;
  /** Display name, e.g. "Left Arm — raised". */
  name: string;
  /** The pose/variant tag for swappable parts (body idle/walk/cheer, etc.). */
  pose?: string;
  /** For mouth parts, the viseme this image represents. */
  viseme?: MouthViseme;
  /** For eye parts, the eye state. */
  eyeState?: EyeState;
  /** Optional side inferred from filename, e.g. left_eye.svg. */
  side?: "left" | "right" | "center" | "front" | "back";
  mediaId: ID;
  // Transform on the character canvas:
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // degrees
  anchorX: number;
  anchorY: number; // 0..1 within the part (used as transform origin)
  /** Absolute canvas pivot. Mirrors anchorX/Y for old presets, easier for users to drag. */
  pivot?: { x: number; y: number };
  /** Parent part id for future movement inheritance. */
  parentId?: ID;
  /** Soft motion bounds for future animation and preview tests. */
  bounds?: CharacterPartBounds;
  movement?: MovementPresetKind;
  morph?: SvgMorphMetadata;
  zIndex: number;
  /** Parallax depth (-1 back .. 0 neutral .. +1 front). */
  depth: number;
  visible: boolean;
}

/** Manifest of which optional roles this character has. */
export interface PartManifest {
  hasHead: boolean;
  hasBody: boolean;
  hasArms: boolean;
  hasHands: boolean;
  hasLegs: boolean;
  hasFeet: boolean;
  hasEyes: boolean;
  hasBrows: boolean;
  hasMouth: boolean;
  hasHair: boolean;
  hasAccessories: boolean;
}

export const DEFAULT_PART_MANIFEST: PartManifest = {
  hasHead: true,
  hasBody: true,
  hasArms: true,
  hasHands: true,
  hasLegs: true,
  hasFeet: true,
  hasEyes: true,
  hasBrows: true,
  hasMouth: true,
  hasHair: true,
  hasAccessories: true,
};

/** Direction of a head variant for head-turn animations. */
export type HeadDirection = "front" | "3qL" | "3qR" | "sideL" | "sideR";

export interface HeadVariant {
  /** Direction this variant represents. */
  direction: HeadDirection;
  /** Image media id. */
  mediaId: ID;
  /** Optional per-direction offset for face features (eye/brow/mouth). */
  featureOffsetX?: number;
  featureOffsetY?: number;
}

/** Pose parameters for one viseme in a transform-based mouth rig. All values 0..1 unless noted. */
export interface MouthPose {
  open: number;     // 0=closed → 1=max jaw drop
  wide: number;     // 0=neutral → 1=stretched (E-shape); negative = narrower
  round: number;    // 0=neutral → 1=maximum pucker (O/U/WQ)
  smile: number;    // 0=neutral → 1=corners lifted
  teeth: number;    // 0=hidden → 1=fully visible
  tongue: number;   // 0=hidden → 1=fully visible
  fvBite: number;   // 0=normal → 1=upper teeth on lower lip (FV)
}

/** Transform-based mouth rig stored on the character. Drives lip sync via GSAP tweens. */
export interface MouthRig {
  styleId: string;
  lipColor: string;
  teethColor: string;
  tongueColor: string;
  interiorColor: string;
  widthScale: number;
  /** 0 = default arch, positive = more bow/arch, negative = flatter. Range roughly -1 to 1. */
  upperCurve: number;
  lowerCurve: number;
  /** Placement on the character canvas (SVG viewBox 0 0 100 60 maps into this box). */
  placement: { x: number; y: number; width: number; height: number; zIndex: number };
  poses: Record<MouthViseme, MouthPose>;
}

/** Placement for generated fallback mouth shapes when a rig has no custom mouth visemes. */
export interface FallbackMouthAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  anchorX: number;
  anchorY: number;
  zIndex: number;
  depth: number;
}

/** Per-character parallax configuration. */
export interface ParallaxConfig {
  /** React to scene-level camera moves. */
  onCamera: boolean;
  /** React to this character clip moving on stage. */
  onClip: boolean;
  /** Multiplier for parallax magnitude. */
  intensity: number;
}

export const DEFAULT_PARALLAX_CONFIG: ParallaxConfig = {
  onCamera: true,
  onClip: true,
  intensity: 0.15,
};

export interface CharacterPreset {
  id: ID;
  name: string;
  /** Logical canvas size for the character (e.g. 600 x 900). */
  canvasWidth: number;
  canvasHeight: number;
  parts: CharacterPart[];
  manifest: PartManifest;
  /** @deprecated kept for migration — use `parallax` instead. */
  parallaxEnabled?: boolean;
  /** Per-character parallax config. */
  parallax: ParallaxConfig;
  /** Optional head variants for head-turn animations. */
  headVariants?: HeadVariant[];
  /** Where generated fallback lip-sync mouth shapes should appear. */
  fallbackMouth?: FallbackMouthAnchor;
  /** Transform-based mouth rig. When present, replaces SVG-file viseme parts for lip sync. */
  mouthRig?: MouthRig;
  /** Which mouth system to use for lip sync. "rig" = transform rig, "images" = SVG viseme files. */
  mouthStyle?: "rig" | "images";
  createdAt: number;
  updatedAt: number;
}

/** Single keyframe value for one part within an action preset. */
export interface ActionKeyframe {
  t: number; // 0..1 normalized (multiplied by preset.duration at runtime)
  /** Offset deltas applied on top of the part's rest pose. */
  dx?: number;
  dy?: number;
  scale?: number; // multiplier (1 = unchanged)
  rotation?: number; // additive degrees
  opacity?: number; // 0..1, replaces base
  ease?: string; // simple name: linear|easeIn|easeOut|easeInOut
}

/** Per-part track inside an Action Preset. */
export interface ActionTrack {
  /** Which part role to drive (e.g. "mouth", "armR", "brow"). */
  partRole: PartRole | "__camera";
  /** Optional exact slot target for character-specific presets. */
  slotId?: ID;
  /** Optional pose/variant swap for this part. Held for the duration. */
  poseSwap?: string;
  /** If true, this preset's mouth track overrides lip sync visemes. */
  lockMouth?: boolean;
  keyframes: ActionKeyframe[];
}

export type ActionCategory =
  | "expression"
  | "gesture"
  | "full-body"
  | "camera"
  | "headTurn"
  | "custom";

/** Recorded pose snapshot used by the Preset Recorder.
 *  Each part override stores a *delta* relative to that part's rest pose. */
export interface RecordedPartOverride {
  partRole: PartRole;
  /** Exact slot target when this was recorded against a specific character. */
  slotId?: ID;
  /** Pose/variant tag to swap to (optional). */
  poseSwap?: string;
  dx?: number;
  dy?: number;
  scale?: number;
  rotation?: number;
  opacity?: number;
}

export interface RecordedKeypose {
  /** Time in seconds within the preset. */
  t: number;
  ease?: string;
  parts: RecordedPartOverride[];
  /** Optional camera state at this keypose. */
  camera?: { dx?: number; dy?: number; zoom?: number };
}

/** Optional head-turn directive carried by headTurn presets. */
export interface HeadTurnSpec {
  from: HeadDirection;
  to: HeadDirection;
  ease?: string;
}

/** Reusable "Action Preset" — covers expressions AND movements. */
export interface ActionPreset {
  id: ID;
  name: string;
  category: ActionCategory;
  /** Base duration in seconds. */
  duration: number;
  loop: boolean;
  tracks: ActionTrack[];
  /** Visual recorder data — preferred over `tracks` when present. */
  keyposes?: RecordedKeypose[];
  /** For headTurn category. */
  headTurn?: HeadTurnSpec;
  /** Optional description for tooltips. */
  description?: string;
  /** Built-in presets are read-only. */
  builtin?: boolean;
  createdAt: number;
  updatedAt: number;

  /** @deprecated v1 movement preset shape — kept for migration. */
  keyframes?: unknown;
}

/** Backward-compat alias. */
export type MovementPreset = ActionPreset;
export type MovementKeyframe = ActionKeyframe;

export type TrackKind = "background" | "character" | "audio" | "overlay";

export interface BaseClip {
  id: ID;
  name: string;
  trackIndex: number;
  /** Sub-track lane within the parent track (0-based). Default 0. */
  laneIndex?: number;
  start: number; // seconds on the project timeline
  duration: number;
  // Stage transform (ignored for pure audio):
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
}

export interface MediaClip extends BaseClip {
  kind: "image" | "video" | "audio";
  mediaId: ID;
  /** Auto-generated speech audio linked to a character clip, if any. */
  linkedCharacterClipId?: ID;
}

export interface AppliedAction {
  id: ID;
  presetId: ID;
  /** Offset (seconds) within the character clip when this action starts. */
  offset: number;
  /** Optional duration override; defaults to preset.duration. */
  duration?: number;
  /** 0..1 scale of the effect. */
  intensity: number;
}

export interface CharacterClip extends BaseClip {
  kind: "character";
  characterId: ID;
  /** Currently selected pose per part role. */
  poses: Record<string, string>;
  /** Optional audio for lip sync. */
  lipSyncAudioId?: ID;
  /** Generated viseme keyframes (relative to clip start). */
  visemes?: { t: number; v: MouthViseme }[];
  /** Applied action presets (expressions, gestures, etc.). */
  actions?: AppliedAction[];
  /** @deprecated old movements list — migrated to `actions`. */
  movements?: { presetId: ID; offset: number }[];
  autoBlink?: boolean;
  /** ElevenLabs voice line that produced lipSyncAudioId + visemes. */
  voiceLine?: {
    text: string;
    voiceId: string;
    modelId: string;
    stability: number;
    similarityBoost: number;
  };
}

export type AnyClip = MediaClip | CharacterClip;

export interface Track {
  id: ID;
  name: string;
  kind: TrackKind;
  /** Number of sub-track lanes (default 1). */
  lanes?: number;
  muted?: boolean;
  locked?: boolean;
}

export interface CameraKeyframe {
  t: number; // seconds on project timeline
  x: number;
  y: number;
  zoom: number;
  ease?: string;
}

export interface Project {
  id: ID;
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number; // seconds
  tracks: Track[];
  clips: AnyClip[];
  /** Optional scene-level camera animation that drives parallax. */
  camera?: { keyframes: CameraKeyframe[] };
  createdAt: number;
  updatedAt: number;
}
