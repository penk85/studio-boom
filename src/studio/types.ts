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
  anchorX: number; anchorY: number; // 0..1 within the part
  zIndex: number;
  visible: boolean;
}

export interface CharacterPreset {
  id: ID;
  name: string;
  /** Logical canvas size for the character (e.g. 600 x 900). */
  canvasWidth: number;
  canvasHeight: number;
  parts: CharacterPart[];
  createdAt: number;
  updatedAt: number;
}

export interface MovementKeyframe {
  t: number; // seconds within the movement
  x?: number; y?: number;
  scale?: number; rotation?: number; opacity?: number;
  /** Optional pose swap: { partRole: poseTag } */
  poses?: Record<string, string>;
  ease?: string; // gsap ease name
}

export interface MovementPreset {
  id: ID;
  name: string;
  duration: number;
  keyframes: MovementKeyframe[];
  createdAt: number;
}

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

export interface CharacterClip extends BaseClip {
  kind: "character";
  characterId: ID;
  /** Currently selected pose per part role. */
  poses: Record<string, string>;
  /** Optional audio for lip sync. */
  lipSyncAudioId?: ID;
  /** Generated viseme keyframes (relative to clip start). */
  visemes?: { t: number; v: MouthViseme }[];
  /** Applied movement preset(s). */
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

export interface Project {
  id: ID;
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number; // seconds
  tracks: Track[];
  clips: AnyClip[];
  createdAt: number;
  updatedAt: number;
}
