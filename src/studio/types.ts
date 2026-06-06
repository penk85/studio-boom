// Core domain types for the Hyperframes Movie Studio.
// These shapes are persisted in IndexedDB (via Dexie).

import type { Keyframe, TimelineElement } from "@hyperframes/core";
import { parseStudioHtml } from "./hyperframes/html";
import {
  deriveClipMotionSteps,
  readAllClipKeyframesFromHtml,
  readAllClipMotionStepMetasFromHtml,
  type ClipKeyframeProperty,
  type ClipMotionStep,
  type ClipMotionStepMeta,
} from "./hyperframes/keyframes";

export type ID = string;

/** Saved ElevenLabs voice for reuse */
export interface SavedVoice {
  id: ID;
  voiceId: string;
  name: string;
  createdAt: number;
}

/** A single viseme keyframe on a lip-sync track: time (s) → mouth shape. */
export type VisemeEntry = { t: number; v: MouthViseme };

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
  /**
   * Canonical lip-sync data for audio assets used as character voices. Owned by
   * the asset (not the character clip) so a voice can be reattached without
   * regenerating the timing. Character clips reference this via `lipSyncAudioId`.
   */
  visemes?: VisemeEntry[];
  voiceLine?: VoiceLineMeta;
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
  /** Editor lock: a locked part ignores canvas clicks/drags (still selectable from the list). */
  locked?: boolean;
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

export type CharacterAngle = HeadDirection;

export interface CharacterAngleTransformOverride {
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  depth?: number;
  visible?: boolean;
}

export interface CharacterBone {
  id: ID;
  name: string;
  role: PartRole | "root";
  side?: CharacterPart["side"];
  parentId?: ID;
  /** Local rest position relative to parent bone, in character canvas pixels. */
  x: number;
  y: number;
  rotation: number;
  length?: number;
  /** Parallax depth override for content driven by this bone. */
  depth?: number;
  angleOverrides?: Partial<Record<CharacterAngle, CharacterAngleTransformOverride>>;
}

export interface CharacterSlotBinding {
  slotId: ID;
  boneId: ID;
  /** Local attachment position relative to the bound bone, in character canvas pixels. */
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  depth: number;
  /** Active variant part for this binding, mostly used by discrete angle states. */
  partId?: ID;
  angleOverrides?: Partial<
    Record<
      CharacterAngle,
      CharacterAngleTransformOverride & {
        boneId?: ID;
        partId?: ID;
      }
    >
  >;
}

/**
 * A layer's movement limits relative to its attach-to parent. The layer is carried by its parent
 * (FK), and `reach`/`rotReach` cap how far it may additionally drift/twist on its own. Both are
 * authored in the parent's frame so they ride along with the parent. Used as guides for generated
 * motion; manual posing may exceed them.
 */
export interface CharacterReach {
  id: ID;
  slotId: ID;
  /**
   * Movement reach: an organic polygon (the outline traced by sweeping the layer to its extremes),
   * as offsets from the layer's rest position. Undefined = unlimited drift.
   */
  reach?: { x: number; y: number }[];
  /** Rotation reach: how far the layer may twist from rest, in degrees (min ≤ 0 ≤ max). */
  rotReach?: { min: number; max: number };
}

export interface CharacterRig {
  version: 1;
  activeAngle: CharacterAngle;
  bones: CharacterBone[];
  slotBindings: CharacterSlotBinding[];
  drawOrder: ID[];
  reaches: CharacterReach[];
  /** Reserved shape for future mesh/control-point binding support. */
  mesh?: {
    version: 1;
    controlBindings: Array<{
      id: ID;
      boneId: ID;
      x: number;
      y: number;
      weight: number;
    }>;
  };
}

/** Pose parameters for one generated mouth viseme. All values 0..1 unless noted. */
export interface MouthPose {
  open: number; // 0=closed → 1=max jaw drop
  wide: number; // 0=neutral → 1=stretched (E-shape); negative = narrower
  round: number; // 0=neutral → 1=maximum pucker (O/U/WQ)
  smile: number; // 0=neutral → 1=corners lifted
  teeth: number; // 0=hidden → 1=fully visible
  tongue: number; // 0=hidden → 1=fully visible
  fvBite: number; // 0=normal → 1=upper teeth on lower lip (FV)
}

/** Generated SVG mouth slot stored on the character. Drives lip sync via GSAP tweens. */
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

/** Placement for generated fallback mouth shapes when no custom mouth variants exist. */
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
  /** True FK skeleton, slot attachments, draw order, host constraints, and angle metadata. */
  rig?: CharacterRig;
  /** Optional head variants for head-turn animations. */
  headVariants?: HeadVariant[];
  /** Where generated fallback lip-sync mouth shapes should appear. */
  fallbackMouth?: FallbackMouthAnchor;
  /** Optional generated SVG mouth slot used when explicitly selected or when no mouth variants exist. */
  mouthRig?: MouthRig;
  /** Preferred mouth slot render strategy. Defaults to uploaded/generated variants when present. */
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
  /** Rig V1 target. Defaults to "slot" for older part/slot tracks. */
  target?: "slot" | "bone" | "camera";
  /** Exact bone target when `target` is "bone". */
  boneId?: ID;
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
  /** Rig V1 target. Defaults to "slot" for older part/slot overrides. */
  target?: "slot" | "bone";
  /** Exact bone target when `target` is "bone". */
  boneId?: ID;
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
  /**
   * Layers (slotIds and/or part roles) this movement is allowed to push past the character's
   * authored reach — the per-movement "allow out of bounds" escape hatch. Empty = fully clamped.
   */
  allowOutOfBounds?: ID[];
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

/** The canonical HyperFrames project.
 *  rootHtml is index.html; compositionHtml holds sub-composition HTML keyed by comp id. */
export interface HyperFramesProject {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  assets: HFAsset[];
  /** Content of index.html — the root composition. */
  rootHtml: string;
  /** Sub-composition HTML strings keyed by composition id (e.g. "comp_<clipId>"). */
  compositionHtml: Record<string, string>;
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

export type NativeClipKind = "image" | "audio" | "video" | "text" | "composition";

export type CompositionKind = "ai-block" | "registry-block" | "character" | "user-composition";

export interface VoiceLineMeta {
  text: string;
  source?: "elevenlabs-tts" | "audio-file";
  voiceId?: string;
  voiceName?: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  audioName?: string;
}

/** A speech placed on a character: references the voice asset + a start offset (s). */
export interface CharacterSpeech {
  id: ID;
  audioId: ID;
  /** Start time in seconds within the character clip. */
  start: number;
  /** Playback volume, 0–1 (default 1). */
  volume?: number;
  /** In-point into the source audio in seconds (trim start; default 0). */
  mediaStartTime?: number;
  /** Trimmed playback length in seconds (default = full source duration). */
  duration?: number;
}

export interface CharacterClipMeta {
  characterId: ID;
  poses: Record<string, string>;
  motions?: AppliedMotion[];
  /** Speech clips placed along the character's duration (canonical). */
  speeches?: CharacterSpeech[];
  /**
   * @deprecated Display cache / legacy fallback. Canonical lip-sync data lives on
   * the audio `MediaAsset` (`visemes`/`voiceLine`), keyed by `lipSyncAudioId`.
   */
  visemes?: VisemeEntry[];
  autoBlink?: boolean;
  /** @deprecated Single-voice reference; migrated to `speeches` by `characterSpeeches`. */
  lipSyncAudioId?: ID;
  /** Display cache of the attached voice's metadata; canonical copy is on the asset. */
  voiceLine?: VoiceLineMeta;
}

/**
 * Canonical list of a character's speeches. Migrates a legacy single
 * `lipSyncAudioId` to one speech at start 0 so old projects keep working.
 */
export function characterSpeeches(meta: CharacterClipMeta | undefined): CharacterSpeech[] {
  if (!meta) return [];
  if (meta.speeches && meta.speeches.length > 0) return meta.speeches;
  if (meta.lipSyncAudioId) {
    return [{ id: `speech-${meta.lipSyncAudioId}`, audioId: meta.lipSyncAudioId, start: 0 }];
  }
  return [];
}

/** Per-clip authoring state — character clips generate native sub-compositions. */
export interface ClipEditorMeta {
  // Display / editor UI
  name?: string;
  kind?: NativeClipKind;
  compositionKind?: CompositionKind;
  uiTrackIndex?: number; // which editor track (0-based, maps to editorMeta.tracks[i])
  uiLaneIndex?: number; // which lane within the track
  // Composition clips
  compositionId?: string;
  // Character sub-composition metadata
  character?: CharacterClipMeta;
  // Media clips — id in Dexie mediaBlobs for blob copy on export
  mediaId?: string;
  /** Editor lock: a locked clip ignores canvas clicks/drags (still selectable from the layer list). */
  locked?: boolean;
}

export type { ClipKeyframeProperty, ClipMotionStep, ClipMotionStepMeta };

export interface ClipKeyframeSelection {
  clipId: string;
  keyframeId: string;
  property: ClipKeyframeProperty;
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
  kind: NativeClipKind;
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
  /** Editor lock (per-clip OR inherited from a locked track). Excludes the clip from canvas hit-testing. */
  locked: boolean;
  keyframes: Keyframe[];
  motionStepMetas: ClipMotionStepMeta[];
  motionSteps: ClipMotionStep[];
  // Text-specific
  content?: string;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  fitToBounds?: boolean;
  // Composition-specific
  compositionId?: string;
  compositionKind?: CompositionKind;
  character?: CharacterClipMeta;
  // Media-specific
  mediaId?: string;
  /** Audio/video playback volume, 0–1 (default 1). */
  volume?: number;
  /** In-point: where playback starts within the source (seconds, default 0). */
  mediaStartTime?: number;
  /** Natural length of the source media (seconds); bounds trimming. */
  sourceDuration?: number;
}

export type CharacterCompositionClip = EditorClip & {
  kind: "composition";
  compositionKind: "character";
  compositionId: string;
  character: CharacterClipMeta;
};

export function isCharacterCompositionClip(
  clip: EditorClip | null | undefined,
): clip is CharacterCompositionClip {
  return (
    clip?.kind === "composition" &&
    clip.compositionKind === "character" &&
    typeof clip.compositionId === "string" &&
    !!clip.character?.characterId
  );
}

/** Derive the flat editor view of all clips from the canonical HF + editorMeta. */
export function deriveEditorClips(project: Project): EditorClip[] {
  if (!project.hf.rootHtml) return [];
  const { elements } = parseStudioHtml(project.hf.rootHtml);
  const keyframesByClipId = readAllClipKeyframesFromHtml(project.hf.rootHtml);
  const motionStepMetasByClipId = readAllClipMotionStepMetasFromHtml(project.hf.rootHtml);
  return elements.map((el: TimelineElement) => {
    const meta = project.editorMeta.clips[el.id] ?? {};
    const compositionId =
      "compositionId" in el && typeof el.compositionId === "string"
        ? el.compositionId
        : meta.compositionId;
    const kind: EditorClip["kind"] =
      meta.kind ??
      (el.type === "composition"
        ? "composition"
        : el.type === "audio"
          ? "audio"
          : el.type === "video"
            ? "video"
            : el.type === "text"
              ? "text"
              : "image");
    const scale = el.scale ?? 1;
    const mediaEl = el as {
      sourceWidth?: number;
      sourceHeight?: number;
      volume?: number;
      mediaStartTime?: number;
      sourceDuration?: number;
    };
    const studioEl = el as TimelineElement & { rotation?: number };
    const textEl = el as {
      content?: string;
      color?: string;
      fontSize?: number;
      fontFamily?: string;
      fontWeight?: number;
      fitToBounds?: boolean;
    };
    const width = (mediaEl.sourceWidth ?? 0) * scale;
    const height = (mediaEl.sourceHeight ?? 0) * scale;

    const keyframes = keyframesByClipId.get(el.id) ?? [];
    const motionStepMetas = motionStepMetasByClipId.get(el.id) ?? [];
    const trackIndex = meta.uiTrackIndex ?? 0;
    // Lock cascades: a clip is locked if it's locked directly or its track is locked.
    const locked = !!meta.locked || !!project.editorMeta.tracks[trackIndex]?.locked;
    const clip = {
      id: el.id,
      name: meta.name ?? el.name ?? "",
      kind,
      start: el.startTime,
      duration: el.duration,
      trackIndex,
      laneIndex: meta.uiLaneIndex ?? 0,
      x: el.x ?? 0,
      y: el.y ?? 0,
      width,
      height,
      rotation: studioEl.rotation ?? 0,
      opacity: el.opacity ?? 1,
      zIndex: el.zIndex,
      locked,
      keyframes,
      motionStepMetas,
      motionSteps: [],
      content: textEl.content,
      color: textEl.color,
      fontSize: textEl.fontSize,
      fontFamily: textEl.fontFamily,
      fontWeight: textEl.fontWeight,
      fitToBounds: textEl.fitToBounds,
      compositionId,
      compositionKind: meta.compositionKind,
      character: meta.character,
      mediaId: meta.mediaId,
      volume: mediaEl.volume ?? 1,
      mediaStartTime: mediaEl.mediaStartTime ?? 0,
      sourceDuration: mediaEl.sourceDuration,
    } satisfies EditorClip;

    return {
      ...clip,
      motionSteps: deriveClipMotionSteps(clip, motionStepMetas),
    };
  });
}

// ─── Editor command types ─────────────────────────────────────────────────────

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
  /** Audio/video playback volume, 0–1 (default 1). */
  volume?: number;
  /** In-point: where playback starts within the source (seconds, default 0). */
  mediaStartTime?: number;
  /** Natural length of the source media (seconds); bounds trimming. */
  sourceDuration?: number;
}

export interface TextClip extends BaseClip {
  kind: "text";
  content: string;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  fitToBounds?: boolean;
}

export interface CompositionClip extends BaseClip {
  kind: "composition";
  compositionId?: ID;
  compositionKind?: CompositionKind;
  compositionHtml?: string;
  character?: CharacterClipMeta;
}

export type AnyClip = MediaClip | TextClip | CompositionClip;

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
