// Core domain types for the Hyperframes Movie Studio.
// These shapes are persisted in IndexedDB (via Dexie) and serialized into
// Hyperframes-compliant HTML on export.

export type ID = string;

/** Unit of media stored in IndexedDB. The Blob lives in `mediaBlobs` table. */
export interface MediaAsset {
  id: ID;
  name: string;
  /** "image" | "audio" | "video" */
  kind: "image" | "audio" | "video";
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
  | "armL"
  | "armR"
  | "legL"
  | "legR"
  | "eye"
  | "eyeL"
  | "eyeR"
  | "brow"
  | "browL"
  | "browR"
  | "mouth"
  | "extra";

export type MouthViseme =
  | "rest"
  | "A"
  | "E"
  | "I"
  | "O"
  | "U"
  | "MBP"
  | "FV"
  | "L";

export type EyeState = "open" | "half" | "closed";

export interface CharacterPart {
  id: ID;
  role: PartRole;
  /** Display name, e.g. "Left Arm — raised". */
  name: string;
  /** The pose/variant tag for swappable parts (body idle/walk/cheer, etc.). */
  pose?: string;
  /** For mouth parts, the viseme this image represents. */
  viseme?: MouthViseme;
  /** For eye parts, the eye state. */
  eyeState?: EyeState;
  mediaId: ID;
  // Transform on the character canvas:
  x: number; y: number;
  width: number; height: number;
  rotation: number; // degrees
  anchorX: number; anchorY: number; // 0..1 within the part (used as transform origin)
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
  hasLegs: boolean;
  hasEyes: boolean;
  hasBrows: boolean;
  hasMouth: boolean;
}

export const DEFAULT_PART_MANIFEST: PartManifest = {
  hasHead: true,
  hasBody: true,
  hasArms: true,
  hasLegs: true,
  hasEyes: true,
  hasBrows: true,
  hasMouth: true,
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
  createdAt: number;
  updatedAt: number;
}

/** Single keyframe value for one part within an action preset. */
export interface ActionKeyframe {
  t: number; // 0..1 normalized (multiplied by preset.duration at runtime)
  /** Offset deltas applied on top of the part's rest pose. */
  dx?: number;
  dy?: number;
  scale?: number;     // multiplier (1 = unchanged)
  rotation?: number;  // additive degrees
  opacity?: number;   // 0..1, replaces base
  ease?: string;      // simple name: linear|easeIn|easeOut|easeInOut
}

/** Per-part track inside an Action Preset. */
export interface ActionTrack {
  /** Which part role to drive (e.g. "mouth", "armR", "brow"). */
  partRole: PartRole | "__camera";
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
  start: number; // seconds on the project timeline
  duration: number;
  // Stage transform (ignored for pure audio):
  x: number; y: number;
  width: number; height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
}

export interface MediaClip extends BaseClip {
  kind: "image" | "video" | "audio";
  mediaId: ID;
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
