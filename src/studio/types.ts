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

export type PartMotionBehavior = "none" | "blink" | "rotate" | "raise" | "lipSync" | "bounce";

export type BoundsType = "rect" | "ellipse";

export interface CharacterPartBounds {
  type: BoundsType;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Tight visible-pixel bounds for an image/SVG part, measured in source media pixels. */
export interface CharacterPartAlphaBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  threshold?: number;
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
  /** Absolute canvas pivot. Mirrors anchorX/Y and is easier for users to drag. */
  pivot?: { x: number; y: number };
  /** Parent part id for future motion inheritance. */
  parentId?: ID;
  /** Soft motion bounds for future animation and preview tests. */
  bounds?: CharacterPartBounds;
  /** Tight alpha bounds used by editors for selection, handles, and default pivots. */
  alphaBounds?: CharacterPartAlphaBounds;
  motionBehavior?: PartMotionBehavior;
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
  open: number; // 0=closed → 1=max jaw drop
  wide: number; // 0=neutral → 1=stretched (E-shape); negative = narrower
  round: number; // 0=neutral → 1=maximum pucker (O/U/WQ)
  smile: number; // 0=neutral → 1=corners lifted
  teeth: number; // 0=hidden → 1=fully visible
  tongue: number; // 0=hidden → 1=fully visible
  fvBite: number; // 0=normal → 1=upper teeth on lower lip (FV)
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

/** Single keyframe value for one part within a reusable motion preset. */
export interface MotionKeyframe {
  t: number; // 0..1 normalized (multiplied by preset.duration at runtime)
  /** Offset deltas applied on top of the part's rest pose. */
  dx?: number;
  dy?: number;
  scale?: number; // uniform scale multiplier (1 = unchanged)
  scaleX?: number; // horizontal squash multiplier (1 = unchanged)
  scaleY?: number; // vertical stretch multiplier (1 = unchanged)
  skewX?: number; // additive degrees
  skewY?: number; // additive degrees
  rotation?: number; // additive degrees
  originX?: number; // transform origin x, 0..1 within part
  originY?: number; // transform origin y, 0..1 within part
  opacity?: number; // 0..1, replaces base
  ease?: string; // linear|easeIn|easeOut|easeInOut|snappy|overshoot|bounce|elastic|hold
}

/** Per-part transform track inside a reusable motion preset. */
export interface MotionTrack {
  /** Which part role to drive (e.g. "mouth", "armR", "brow"). */
  partRole: PartRole | "__camera";
  /** Optional exact slot target for character-specific presets. */
  slotId?: ID;
  /** Optional pose/variant swap for this part. Held for the duration. */
  poseSwap?: string;
  keyframes: MotionKeyframe[];
}

export type MotionCategory =
  | "expression"
  | "gesture"
  | "full-body"
  | "camera"
  | "headTurn"
  | "custom";

/** Recorded pose snapshot used by the Motion Preset Recorder.
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
  scaleX?: number; // horizontal squash multiplier (1 = unchanged)
  scaleY?: number; // vertical stretch multiplier (1 = unchanged)
  skewX?: number; // additive degrees
  skewY?: number; // additive degrees
  rotation?: number;
  originX?: number; // transform origin x, 0..1 within part
  originY?: number; // transform origin y, 0..1 within part
  opacity?: number;
}

export interface AnticipationSpec {
  /** Fraction of the main delta to pre-move in the opposite direction. */
  amount: number; // 0..1
  /** Seconds before the keypose to place the anticipation pre-pose. */
  duration: number;
}

export interface RecordedKeypose {
  /** Time in seconds within the preset. */
  t: number;
  ease?: string;
  parts: RecordedPartOverride[];
  /** Semantic horizontal face-turn control. Resolved to GSAP transforms at playback/export. */
  faceTurnX?: number; // -1..1
  /** Optional camera state at this keypose. */
  camera?: { dx?: number; dy?: number; zoom?: number };
  /** Procedural anticipation pre-pose inserted before this keypose. */
  anticipation?: AnticipationSpec;
}

/** Optional head-turn directive carried by headTurn motion presets. */
export interface HeadTurnSpec {
  from: HeadDirection;
  to: HeadDirection;
  ease?: string;
}

/** Reusable motion preset — covers expressions, gestures, full-body motion, camera moves, and head turns. */
export interface MotionPreset {
  id: ID;
  name: string;
  category: MotionCategory;
  /** Base duration in seconds. */
  duration: number;
  loop: boolean;
  tracks: MotionTrack[];
  /** Visual recorder data — preferred over `tracks` when present. */
  keyposes?: RecordedKeypose[];
  /** Provisional head-turn data. A richer face-plane head-turn design is deferred. */
  headTurn?: HeadTurnSpec;
  /** Optional description for tooltips. */
  description?: string;
  /** Built-in presets are read-only. */
  builtin?: boolean;
  createdAt: number;
  updatedAt: number;
}

// ─── HyperFrames Layer 2: Render Model ───────────────────────────────────────

/** Registered media asset in the HF project. */
export interface HFAsset {
  id: string;
  filename: string;
  mimeType: string;
  kind?: "image" | "audio" | "video" | "svg" | "font";
  width?: number;
  height?: number;
  duration?: number;
}

/** Attrs bag for HyperFrames data attributes.
 *  data-start supports both numeric seconds and string clip-id references (HF spec). */
export type HFAttrs = {
  "data-start"?: number | string;
  "data-duration"?: number;
  "data-track-index"?: number;
  "data-composition-id"?: string;
  "data-composition-src"?: string;
  "data-width"?: number;
  "data-height"?: number;
  /** User-set display opacity (0..1). HFClip.style.opacity is always 0 for HF main-timeline init. */
  "data-opacity"?: number;
  [key: string]: string | number | boolean | undefined;
};

/** One clip in the main HyperFrames composition. Maps 1:1 to a DOM element.
 *  For character clips, attrs["data-composition-id"] === "comp_<clipId>" links to HFComposition.id.
 *  There is no separate compositionId field — attrs["data-composition-id"] is canonical. */
export interface HFClip {
  id: string;
  tag: "div" | "img" | "video" | "audio";
  attrs: HFAttrs;
  style: Record<string, string | number>;
  mediaId?: string; // links to HFAsset.id for blob copy
}

/** One element in a character sub-composition. */
export interface HFElement {
  id: string;
  tag: "div" | "img" | "svg";
  attrs: Record<string, string | number | boolean | undefined>;
  style: Record<string, string | number>;
  children?: HFElement[];
  mediaId?: string; // for img elements — links to HFAsset
  svgContent?: string; // for inline svg (mouth rig). Trust boundary: only set by rig builder.
}

/** One GSAP call in a composition timeline. */
export type HFTimelineCall =
  | { method: "to" | "set"; targets: string; vars: object; position: number }
  | { method: "fromTo"; targets: string; fromVars: object; toVars: object; position: number };

/** A character sub-composition. Canonical — generated by bakeCharacterClip, never manually edited.
 *  id = "comp_<clipId>" — unique per clip instance, not per character. */
export interface HFComposition {
  id: string; // "comp_<clipId>"
  sourceClipId: string;
  characterId: string;
  width: number;
  height: number;
  root: { attrs: HFAttrs; style: Record<string, string | number> };
  elements: HFElement[];
  timelineCalls: HFTimelineCall[];
  sourceHash: string;
  bakedAt: number;
  dirty: boolean;
}

/** The canonical HyperFrames project. Serialized to ZIP, rendered by CLI.
 *  hf.clips is the body of index.html — it IS the root composition. */
export interface HyperFramesProject {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  assets: HFAsset[];
  clips: HFClip[];
  compositions: HFComposition[];
}

// ─── Layer 1: Editor Authoring State ─────────────────────────────────────────

export interface AppliedMotion {
  id: ID;
  presetId: ID;
  offset: number;
  duration?: number;
  intensity: number;
  loop?: boolean;
  loopGap?: number;
  loopMode?: "fixed" | "random";
  loopGapMax?: number;
}

/** Per-clip authoring state — drives re-baking for character clips. */
export interface ClipEditorMeta {
  // Display / editor UI
  name?: string;
  kind?: "image" | "audio" | "video" | "character";
  uiTrackIndex?: number; // which editor track (0-based, maps to editorMeta.tracks[i])
  uiLaneIndex?: number;  // which lane within the track
  // Character clips
  characterId?: string;
  // Audio clips linked to character clips (auto-generated by bake)
  linkedCharacterClipId?: string;
  // Character animation authoring
  motions?: AppliedMotion[];
  visemes?: { t: number; v: MouthViseme }[];
  poses?: Record<string, string>;
  autoBlink?: boolean;
  /** Layer 1 authoring reference. bakeCharacterClip converts this into a sibling audio HFClip. */
  lipSyncAudioId?: string;
  /** HF track index for the sibling audio clip. Allocated by allocateHfTrackIndex() at attachment time. */
  lipSyncTrackIndex?: number;
  voiceLine?: {
    text: string;
    voiceId: string;
    modelId: string;
    stability: number;
    similarityBoost: number;
  };
}

/** UI track metadata — names, kinds, lock/mute state. */
export interface TrackMeta {
  id: string;
  name: string;
  kind: TrackKind;
  lanes?: number;
  muted?: boolean;
  locked?: boolean;
}

/** All non-rendering Studio Boom authoring state for a project. */
export interface ProjectEditorMeta {
  tracks: TrackMeta[];
  clips: Record<string, ClipEditorMeta>; // clipId → authoring state
}

// ─── Project ──────────────────────────────────────────────────────────────────

export interface Project {
  id: ID;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Canonical HyperFrames renderable model (Layer 2). */
  hf: HyperFramesProject;
  /** Non-rendering authoring metadata (Layer 1). */
  editorMeta: ProjectEditorMeta;
}

// ─── Editor clip view (derived, not persisted) ────────────────────────────────

/** Flat clip representation for UI components. Derived from HFClip + ClipEditorMeta.
 *  Not stored — recomputed from project.hf + project.editorMeta when needed. */
export interface EditorClip {
  id: string;
  name: string;
  kind: "image" | "audio" | "video" | "character";
  start: number;
  duration: number;
  trackIndex: number;
  laneIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  // Character-specific
  characterId?: string;
  poses?: Record<string, string>;
  motions?: AppliedMotion[];
  visemes?: { t: number; v: MouthViseme }[];
  autoBlink?: boolean;
  lipSyncAudioId?: string;
  voiceLine?: {
    text: string;
    voiceId: string;
    modelId: string;
    stability: number;
    similarityBoost: number;
  };
  // Media-specific
  mediaId?: string;
  linkedCharacterClipId?: string;
}

/** Derive the flat editor view of all clips from the canonical HF + editorMeta. */
export function deriveEditorClips(project: Project): EditorClip[] {
  const result: EditorClip[] = [];
  for (const hfClip of project.hf.clips) {
    const meta = project.editorMeta.clips[hfClip.id] ?? {};
    const start =
      typeof hfClip.attrs["data-start"] === "number"
        ? hfClip.attrs["data-start"]
        : parseFloat(String(hfClip.attrs["data-start"] ?? "0")) || 0;
    const duration = (hfClip.attrs["data-duration"] as number) ?? 0;
    const x = (hfClip.style["left"] as number) ?? 0;
    const y = (hfClip.style["top"] as number) ?? 0;
    const width = (hfClip.style["width"] as number) ?? 0;
    const height = (hfClip.style["height"] as number) ?? 0;
    const opacity = (hfClip.attrs["data-opacity"] as number) ?? 1;
    const zIndex = (hfClip.style["z-index"] as number) ?? 0;

    result.push({
      id: hfClip.id,
      name: meta.name ?? "",
      kind: meta.kind ?? "image",
      start,
      duration,
      trackIndex: meta.uiTrackIndex ?? 0,
      laneIndex: meta.uiLaneIndex ?? 0,
      x,
      y,
      width,
      height,
      rotation: 0, // rotation is not currently exported — editor-only display
      opacity,
      zIndex,
      characterId: meta.characterId,
      poses: meta.poses,
      motions: meta.motions,
      visemes: meta.visemes,
      autoBlink: meta.autoBlink,
      lipSyncAudioId: meta.lipSyncAudioId,
      voiceLine: meta.voiceLine,
      mediaId: hfClip.mediaId,
      linkedCharacterClipId: meta.linkedCharacterClipId,
    });
  }
  return result;
}

// ─── Legacy clip types (still used by character editor, tests, UI compat) ─────

export type TrackKind = "background" | "character" | "audio" | "overlay";

export interface BaseClip {
  id: ID;
  name: string;
  trackIndex: number;
  laneIndex?: number;
  start: number;
  duration: number;
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
  linkedCharacterClipId?: ID;
}

export interface CharacterClip extends BaseClip {
  kind: "character";
  characterId: ID;
  poses: Record<string, string>;
  lipSyncAudioId?: ID;
  visemes?: { t: number; v: MouthViseme }[];
  motions?: AppliedMotion[];
  autoBlink?: boolean;
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
  lanes?: number;
  muted?: boolean;
  locked?: boolean;
}

export interface CameraKeyframe {
  t: number;
  x: number;
  y: number;
  zoom: number;
  ease?: string;
}
