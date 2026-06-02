// Editor state — project, selection, zoom. Playback owned by @hyperframes/studio.
// Persistence to Dexie happens via explicit save calls (autosave debounced).
import { create } from "zustand";
import { removeElementFromHtml } from "@hyperframes/core";
import type { TimelineElement } from "@hyperframes/core";
import { db, deleteMediaIfUnused, isCurrentProjectShape, uid } from "./db";
import type {
  AnyClip,
  CharacterClipMeta,
  CompositionClip,
  CharacterPreset,
  ClipKeyframeProperty,
  ClipKeyframeSelection,
  ClipEditorMeta,
  EditorClip,
  HyperFramesProject,
  MediaAsset,
  MediaClip,
  MotionPreset,
  Project,
  ProjectEditorMeta,
  TextClip,
  Track,
  TrackKind,
  TrackMeta,
} from "./types";
import { characterSpeeches, deriveEditorClips, isCharacterCompositionClip } from "./types";
import { pruneHfAssets, registerHfAsset } from "./hyperframes/assets";
import {
  addStudioElementToHtml,
  parseStudioHtml,
  updateStudioElementInHtml,
  type StudioTimelineElement,
} from "./hyperframes/html";
import { normalizeNativeHyperframesHtml } from "./hyperframes/native";
import {
  addMotionCheckpointToClip,
  addMotionStepToClip,
  moveMotionCheckpoint,
  moveMotionStep,
  moveKeyframeProperty,
  removeMotionCheckpoint,
  removeMotionStep,
  removeKeyframeProperty,
  renameMotionStep,
  setMotionStepPathStyle,
  setClipMotionModelInRootHtml,
  setClipKeyframesInRootHtml,
  storedValuesFromDisplayValues,
  syncRootKeyframesHtml,
  updateKeyframeProperty,
  upsertKeyframeProperty,
  type ClipKeyframeDisplayValues,
  type ClipMotionEndpoint,
} from "./hyperframes/keyframes";
import {
  validateCompositionSourceHtml,
  type CompositionSourceValidation,
} from "./hyperframes/composition-source";
import {
  createRootCompositionHtml,
  updateRootCompositionHtml,
} from "./hyperframes/root-composition";
import {
  buildCharacterCompositionHtml,
  characterAssetIds,
  defaultCharacterCompositionId,
  type ResolvedSpeech,
} from "./character/composition";

// ─── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_TRACKS: TrackMeta[] = [
  { id: uid(), name: "Characters", kind: "character", lanes: 1 },
  { id: uid(), name: "Overlay", kind: "overlay", lanes: 1 },
  { id: uid(), name: "Background", kind: "background", lanes: 1 },
  { id: uid(), name: "Audio", kind: "audio", lanes: 1 },
];

// ─── Public helpers ───────────────────────────────────────────────────────────

/** Find the lowest free lane in a track at the given time range, or return a new lane index. */
export function pickFreeLane(
  clips: Array<{ trackIndex: number; laneIndex?: number; start: number; duration: number }>,
  trackIndex: number,
  start: number,
  duration: number,
  maxLanes: number,
): number {
  const end = start + duration;
  for (let lane = 0; lane < Math.max(1, maxLanes); lane++) {
    const conflict = clips.some((c) => {
      if (c.trackIndex !== trackIndex) return false;
      if ((c.laneIndex ?? 0) !== lane) return false;
      const cEnd = c.start + c.duration;
      return c.start < end && cEnd > start;
    });
    if (!conflict) return lane;
  }
  return maxLanes;
}

export function createBlankProject(name = "Untitled Movie"): Project {
  const now = Date.now();
  const projectId = uid();
  const tracks = createDefaultTracks();
  const rootHtml = createRootCompositionHtml(projectId, 30);
  const hf: HyperFramesProject = {
    id: projectId,
    name,
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 30,
    assets: [],
    rootHtml,
    compositionHtml: {},
  };
  return {
    id: projectId,
    name,
    createdAt: now,
    updatedAt: now,
    hf,
    editorMeta: { tracks, clips: {} },
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function createDefaultTracks(): TrackMeta[] {
  return DEFAULT_TRACKS.map((t) => ({ ...t, id: uid() }));
}

function collectReferencedAssetIds(
  clipsMeta: Record<string, ClipEditorMeta>,
  characters: Map<string, CharacterPreset>,
): Set<string> {
  const ids = new Set<string>();
  for (const meta of Object.values(clipsMeta)) {
    if (meta.mediaId) ids.add(meta.mediaId);
    if (meta.character) {
      const character = characters.get(meta.character.characterId);
      for (const id of characterAssetIds(character, meta.character)) ids.add(id);
    }
  }
  return ids;
}

function pruneCandidateHfAssets(
  hf: HyperFramesProject,
  candidateIds: Set<string>,
  referencedIds: Set<string>,
): HyperFramesProject {
  if (candidateIds.size === 0) return hf;
  const assets = hf.assets.filter((asset) => {
    if (!candidateIds.has(asset.id)) return true;
    return referencedIds.has(asset.id);
  });
  return assets.length === hf.assets.length ? hf : { ...hf, assets };
}

function registerCharacterAssets(
  hf: HyperFramesProject,
  character: CharacterPreset | undefined,
  characterMeta: CharacterClipMeta | undefined,
  mediaAssets: Map<string, MediaAsset>,
): HyperFramesProject {
  let nextHf = hf;
  for (const assetId of characterAssetIds(character, characterMeta)) {
    nextHf = registerHfAsset(nextHf, mediaAssets.get(assetId));
  }
  return nextHf;
}

function refreshProjectAssets(
  project: Project,
  characters: Map<string, CharacterPreset>,
  mediaAssets: Map<string, MediaAsset>,
): Project {
  let hf = project.hf;

  for (const meta of Object.values(project.editorMeta.clips)) {
    if (meta.mediaId) hf = registerHfAsset(hf, mediaAssets.get(meta.mediaId));
    if (meta.compositionKind === "character" && meta.character) {
      hf = registerCharacterAssets(
        hf,
        characters.get(meta.character.characterId),
        meta.character,
        mediaAssets,
      );
    }
  }

  return hf !== project.hf ? { ...project, hf, updatedAt: Date.now() } : project;
}

function normalizeProjectRootHtml(hf: HyperFramesProject, html: string): string {
  return syncRootKeyframesHtml(
    normalizeNativeHyperframesHtml(html, {
      width: hf.width,
      height: hf.height,
    }),
  );
}

type ValidCompositionSource = CompositionSourceValidation & {
  ok: true;
  html: string;
  compositionId: string;
};

function assertValidCompositionSourceHtml(
  html: string,
  defaults: {
    compositionId: string;
    duration: number;
    width: number;
    height: number;
  },
  options: { expectedCompositionId?: string } = {},
): ValidCompositionSource {
  const result = validateCompositionSourceHtml(html, defaults);
  const errors = [...result.errors];
  const compositionId = result.compositionId ?? defaults.compositionId;

  if (
    options.expectedCompositionId &&
    compositionId &&
    compositionId !== options.expectedCompositionId
  ) {
    errors.push(
      `Composition source id "${compositionId}" does not match selected composition "${options.expectedCompositionId}".`,
    );
  }

  if (!result.ok || !result.html || !compositionId || errors.length > 0) {
    throw new Error(
      `Composition source is invalid:\n${errors.map((error) => `- ${error}`).join("\n")}`,
    );
  }

  return {
    ...result,
    ok: true,
    html: result.html,
    compositionId,
  };
}

function normalizeCharacterClipMeta(meta: CharacterClipMeta): CharacterClipMeta {
  return {
    ...meta,
    poses: meta.poses ?? {},
  };
}

function isCharacterMeta(meta: ClipEditorMeta | undefined): meta is ClipEditorMeta & {
  kind: "composition";
  compositionKind: "character";
  compositionId: string;
  character: CharacterClipMeta;
} {
  return (
    meta?.kind === "composition" &&
    meta.compositionKind === "character" &&
    typeof meta.compositionId === "string" &&
    !!meta.character?.characterId
  );
}

/**
 * Resolve a character's speeches against their audio assets for the composition
 * builder: each speech carries its start plus the asset-owned visemes + duration
 * (so reattaching a voice never regenerates timing). The legacy single-voice clip
 * falls back to its own clip-level visemes when the asset has none.
 */
function resolveSpeechesForBuild(
  characterMeta: CharacterClipMeta,
  mediaAssets: Map<string, MediaAsset>,
): ResolvedSpeech[] {
  return characterSpeeches(characterMeta).map((speech) => {
    const asset = mediaAssets.get(speech.audioId);
    const legacyVisemes =
      speech.audioId === characterMeta.lipSyncAudioId ? (characterMeta.visemes ?? []) : [];
    return {
      audioId: speech.audioId,
      start: speech.start,
      duration: asset?.duration ?? 0,
      visemes: asset?.visemes ?? legacyVisemes,
      volume: speech.volume,
    };
  });
}

function rebuildCharacterCompositionInProject(
  project: Project,
  clipId: string,
  characters: Map<string, CharacterPreset>,
  mediaAssets: Map<string, MediaAsset>,
  motionPresets: Map<string, MotionPreset>,
): Project {
  const meta = project.editorMeta.clips[clipId];
  if (!isCharacterMeta(meta)) return project;
  const clip = deriveEditorClips(project).find((candidate) => candidate.id === clipId);
  if (!clip) return project;
  const character = characters.get(meta.character.characterId);
  if (!character) return project;

  const html = buildCharacterCompositionHtml({
    compositionId: meta.compositionId,
    clipId,
    duration: clip.duration,
    width: clip.width || project.hf.width,
    height: clip.height || project.hf.height,
    character,
    meta: meta.character,
    speeches: resolveSpeechesForBuild(meta.character, mediaAssets),
    motionPresets,
  });
  let hf: HyperFramesProject = {
    ...project.hf,
    compositionHtml: {
      ...project.hf.compositionHtml,
      [meta.compositionId]: html,
    },
  };
  hf = registerCharacterAssets(hf, character, meta.character, mediaAssets);
  return { ...project, hf, updatedAt: Date.now() };
}

function rebuildCharacterCompositions(
  project: Project,
  characters: Map<string, CharacterPreset>,
  mediaAssets: Map<string, MediaAsset>,
  motionPresets: Map<string, MotionPreset>,
  filterCharacterId?: string,
): Project {
  let nextProject = project;
  for (const [clipId, meta] of Object.entries(project.editorMeta.clips)) {
    if (!isCharacterMeta(meta)) continue;
    if (filterCharacterId && meta.character.characterId !== filterCharacterId) continue;
    nextProject = rebuildCharacterCompositionInProject(
      nextProject,
      clipId,
      characters,
      mediaAssets,
      motionPresets,
    );
  }
  return refreshProjectAssets(nextProject, characters, mediaAssets);
}

function renderTrackIndexFor(uiTrackIndex = 0, uiLaneIndex = 0): number {
  return Math.max(0, uiTrackIndex) * 1000 + Math.max(0, uiLaneIndex);
}

function repairProjectTimelineLanes(project: Project): Project {
  const clips = deriveEditorClips(project).sort(
    (a, b) =>
      a.trackIndex - b.trackIndex ||
      a.laneIndex - b.laneIndex ||
      a.start - b.start ||
      a.id.localeCompare(b.id),
  );
  if (clips.length === 0) return project;

  const nextClipMeta: Record<string, ClipEditorMeta> = { ...project.editorMeta.clips };
  const nextLaneCounts = new Map<number, number>();
  let changed = false;

  const maxTrackIndex = Math.max(
    project.editorMeta.tracks.length - 1,
    ...clips.map((c) => c.trackIndex),
  );
  for (let trackIndex = 0; trackIndex <= maxTrackIndex; trackIndex += 1) {
    const trackClips = clips.filter((clip) => clip.trackIndex === trackIndex);
    if (trackClips.length === 0) continue;

    const laneSchedules: Array<Array<{ start: number; end: number }>> = [];
    for (const clip of trackClips) {
      const preferredLane = Math.max(0, clip.laneIndex ?? 0);
      const laneIndex = firstNonOverlappingLane(
        laneSchedules,
        preferredLane,
        clip.start,
        clip.start + clip.duration,
      );
      laneSchedules[laneIndex] ??= [];
      laneSchedules[laneIndex]!.push({ start: clip.start, end: clip.start + clip.duration });

      const existingMeta = nextClipMeta[clip.id] ?? {};
      if (
        existingMeta.uiTrackIndex !== trackIndex ||
        (existingMeta.uiLaneIndex ?? 0) !== laneIndex
      ) {
        nextClipMeta[clip.id] = {
          ...existingMeta,
          uiTrackIndex: trackIndex,
          uiLaneIndex: laneIndex,
        };
        changed = true;
      }
    }
    nextLaneCounts.set(trackIndex, Math.max(1, laneSchedules.length));
  }

  const nextTracks = project.editorMeta.tracks.map((track, trackIndex) => {
    const laneCount = nextLaneCounts.get(trackIndex);
    if (laneCount === undefined || (track.lanes ?? 1) >= laneCount) return track;
    changed = true;
    return { ...track, lanes: laneCount };
  });

  if (!changed) return project;
  return {
    ...project,
    editorMeta: {
      ...project.editorMeta,
      clips: nextClipMeta,
      tracks: nextTracks,
    },
  };
}

function firstNonOverlappingLane(
  laneSchedules: Array<Array<{ start: number; end: number }>>,
  preferredLane: number,
  start: number,
  end: number,
): number {
  if (preferredLane >= laneSchedules.length) return preferredLane;
  for (let lane = preferredLane; lane < laneSchedules.length; lane += 1) {
    if (!laneHasOverlap(laneSchedules[lane] ?? [], start, end)) return lane;
  }
  return laneSchedules.length;
}

function laneHasOverlap(
  scheduled: Array<{ start: number; end: number }>,
  start: number,
  end: number,
): boolean {
  return scheduled.some((clip) => clip.start < end && clip.end > start);
}

export function syncProjectRenderTrackIndices(project: Project): Project {
  if (!project.hf.rootHtml || typeof DOMParser === "undefined") return project;

  project = repairProjectClipMetadataFromHtml(project);
  project = repairProjectTimelineLanes(project);
  const doc = new DOMParser().parseFromString(project.hf.rootHtml, "text/html");
  let changed = false;

  for (const [clipId, meta] of Object.entries(project.editorMeta.clips)) {
    const el = doc.getElementById(clipId);
    if (!el) continue;
    const renderTrackIndex = renderTrackIndexFor(meta.uiTrackIndex ?? 0, meta.uiLaneIndex ?? 0);
    const nextValue = String(renderTrackIndex);
    if (el.getAttribute("data-track-index") !== nextValue) {
      el.setAttribute("data-track-index", nextValue);
      changed = true;
    }
  }

  const normalizedRootHtml = normalizeProjectRootHtml(
    project.hf,
    "<!DOCTYPE html>\n" + doc.documentElement.outerHTML,
  );
  if (!changed && normalizedRootHtml === project.hf.rootHtml) return project;
  return {
    ...project,
    hf: {
      ...project.hf,
      rootHtml: normalizedRootHtml,
    },
  };
}

function repairProjectClipMetadataFromHtml(project: Project): Project {
  const { elements } = parseStudioHtml(project.hf.rootHtml);
  if (elements.length === 0) return project;

  const nextClipsMeta: Record<string, ClipEditorMeta> = { ...project.editorMeta.clips };
  let changed = false;

  for (const element of elements) {
    const canonicalKind = clipKindForTimelineElement(element);
    const existingMeta = nextClipsMeta[element.id] ?? {};
    let nextMeta = existingMeta;

    if (nextMeta.kind !== canonicalKind) {
      nextMeta = { ...nextMeta, kind: canonicalKind };
      changed = true;
    }

    if (canonicalKind === "composition") {
      const compositionId =
        "compositionId" in element && typeof element.compositionId === "string"
          ? element.compositionId
          : undefined;
      if (compositionId && nextMeta.compositionId !== compositionId) {
        nextMeta = { ...nextMeta, compositionId };
        changed = true;
      }
      if (!nextMeta.compositionKind) {
        nextMeta = { ...nextMeta, compositionKind: "user-composition" };
        changed = true;
      }
    }

    if (nextMeta !== existingMeta) nextClipsMeta[element.id] = nextMeta;
  }

  if (!changed) return project;
  return {
    ...project,
    editorMeta: {
      ...project.editorMeta,
      clips: nextClipsMeta,
    },
  };
}

function clipKindForTimelineElement(element: TimelineElement): NonNullable<ClipEditorMeta["kind"]> {
  if (element.type === "composition") return "composition";
  if (element.type === "audio") return "audio";
  if (element.type === "video") return "video";
  if (element.type === "text") return "text";
  return "image";
}

function buildTimelineElement(
  clip: AnyClip,
  zIndex: number,
  renderTrackIndex: number,
): StudioTimelineElement {
  if (clip.kind === "composition") {
    const compositionId = clip.compositionId ?? `comp_${clip.id}`;
    return {
      id: clip.id,
      type: "composition",
      name: clip.name,
      startTime: clip.start,
      duration: clip.duration,
      zIndex,
      renderTrackIndex,
      x: clip.x,
      y: clip.y,
      src: `compositions/${compositionId}.html`,
      compositionId,
      sourceWidth: clip.width,
      sourceHeight: clip.height,
      rotation: clip.rotation,
      opacity: clip.opacity,
    };
  }

  if (clip.kind === "text") {
    return {
      id: clip.id,
      type: "text",
      name: clip.name,
      content: clip.content,
      startTime: clip.start,
      duration: clip.duration,
      zIndex,
      renderTrackIndex,
      x: clip.x,
      y: clip.y,
      sourceWidth: clip.width,
      sourceHeight: clip.height,
      rotation: clip.rotation,
      opacity: clip.opacity,
      color: clip.color,
      fontSize: clip.fontSize,
      fontFamily: clip.fontFamily,
      fontWeight: clip.fontWeight,
      fitToBounds: clip.fitToBounds,
    };
  }

  return {
    id: clip.id,
    type: clip.kind,
    name: clip.name,
    startTime: clip.start,
    duration: clip.duration,
    zIndex,
    renderTrackIndex,
    x: clip.x,
    y: clip.y,
    src: `asset:${clip.mediaId}`,
    sourceWidth: clip.width,
    sourceHeight: clip.height,
    rotation: clip.rotation,
    opacity: clip.opacity,
  };
}

function buildElementUpdates(patch: Partial<AnyClip>): Partial<StudioTimelineElement> {
  const updates: Partial<StudioTimelineElement> = {};

  if (patch.start !== undefined) updates.startTime = patch.start;
  if (patch.duration !== undefined) updates.duration = patch.duration;
  if (patch.x !== undefined) updates.x = patch.x;
  if (patch.y !== undefined) updates.y = patch.y;
  if (patch.zIndex !== undefined) updates.zIndex = patch.zIndex;
  if (patch.opacity !== undefined) updates.opacity = patch.opacity;
  if (patch.rotation !== undefined) updates.rotation = patch.rotation;
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.width !== undefined) updates.sourceWidth = patch.width;
  if (patch.height !== undefined) updates.sourceHeight = patch.height;
  if ("volume" in patch && patch.volume !== undefined) updates.volume = patch.volume;
  if ("content" in patch && patch.content !== undefined) updates.content = patch.content;
  if ("color" in patch && patch.color !== undefined) updates.color = patch.color;
  if ("fontSize" in patch && patch.fontSize !== undefined) updates.fontSize = patch.fontSize;
  if ("fontFamily" in patch && patch.fontFamily !== undefined) {
    updates.fontFamily = patch.fontFamily;
  }
  if ("fontWeight" in patch && patch.fontWeight !== undefined) {
    updates.fontWeight = patch.fontWeight;
  }
  if ("fitToBounds" in patch && patch.fitToBounds !== undefined) {
    updates.fitToBounds = patch.fitToBounds;
  }

  return updates;
}

type LayerPlacement = "forward" | "backward" | "front" | "back";

function resolveLayerAssignments(
  project: Project,
  clipId: string,
  placement: LayerPlacement,
): Map<string, number> | null {
  const orderedClips = deriveEditorClips(project)
    .filter(isVisualLayerClip)
    .sort((a, b) => a.zIndex - b.zIndex || a.start - b.start || a.id.localeCompare(b.id));
  const currentIndex = orderedClips.findIndex((clip) => clip.id === clipId);
  if (currentIndex < 0) return null;

  const nextIndex = resolveNextLayerIndex(currentIndex, orderedClips.length, placement);
  if (nextIndex === currentIndex) return null;

  const [clip] = orderedClips.splice(currentIndex, 1);
  if (!clip) return null;
  orderedClips.splice(nextIndex, 0, clip);

  const assignments = new Map<string, number>();
  let changed = false;
  orderedClips.forEach((orderedClip, zIndex) => {
    assignments.set(orderedClip.id, zIndex);
    if (orderedClip.zIndex !== zIndex) changed = true;
  });

  return changed ? assignments : null;
}

function isVisualLayerClip(clip: EditorClip): boolean {
  return clip.kind !== "audio";
}

function hasDisplayValuePatch(patch: ClipKeyframeValuePatch): boolean {
  return (
    patch.x !== undefined ||
    patch.y !== undefined ||
    patch.scale !== undefined ||
    patch.rotation !== undefined ||
    patch.opacity !== undefined
  );
}

function resolveNextLayerIndex(
  currentIndex: number,
  layerCount: number,
  placement: LayerPlacement,
): number {
  switch (placement) {
    case "front":
      return layerCount - 1;
    case "back":
      return 0;
    case "forward":
      return Math.min(layerCount - 1, currentIndex + 1);
    case "backward":
      return Math.max(0, currentIndex - 1);
  }
}

// ─── Store ────────────────────────────────────────────────────────────────────

type ModalState = null | { type: "character-editor"; characterId: string } | { type: "presets" };

interface HistoryEntry {
  project: Project;
  selectedClipId: string | null;
  selectedKeyframe: ClipKeyframeSelection | null;
}

export interface ProjectMutationOptions {
  history?: boolean;
}

export type SaveStatus = "saved" | "saving" | "error";

export type ClipKeyframeValuePatch = ClipKeyframeDisplayValues & {
  ease?: string;
};

interface StudioState {
  project: Project | null;
  tracks: TrackMeta[];

  // Preloaded reference data (for character editor, asset gallery)
  characters: Map<string, CharacterPreset>;
  motionPresets: Map<string, MotionPreset>;
  mediaAssets: Map<string, MediaAsset>;

  selectedClipId: string | null;
  selectedKeyframe: ClipKeyframeSelection | null;
  zoom: number;
  historyPast: HistoryEntry[];
  historyFuture: HistoryEntry[];
  saveStatus: SaveStatus;
  lastSavedAt: number | null;
  saveError: string | null;

  currentModal: ModalState;
  openModal: (modal: Exclude<ModalState, null>) => void;
  closeModal: () => void;

  loadProject: (id: string) => Promise<void>;
  newProject: () => Promise<void>;
  saveProject: (expectedGeneration?: number) => Promise<void>;

  selectClip: (id: string | null) => void;
  selectKeyframe: (selection: ClipKeyframeSelection | null) => void;
  checkpointHistory: () => void;
  undo: () => void;
  redo: () => void;

  addClip: (clip: AnyClip) => void;
  updateClip: (id: string, patch: Partial<AnyClip>, options?: ProjectMutationOptions) => void;
  /** Append an existing audio asset (library voice) as a new speech on a character
   *  clip, after the last one. Lip-sync data is reused from the asset — no regen. */
  attachVoiceToCharacter: (clipId: string, audioId: string) => void;
  /** Move a speech to a new start time (s) within the character clip. */
  moveSpeech: (
    clipId: string,
    speechId: string,
    start: number,
    options?: ProjectMutationOptions,
  ) => void;
  /** Set a speech's playback volume (0–1). */
  setSpeechVolume: (clipId: string, speechId: string, volume: number) => void;
  /** Remove a speech from a character clip (keeps the audio in the library). */
  removeSpeech: (clipId: string, speechId: string) => void;
  /** Rebuild every character clip whose speeches reference this audio asset (used
   *  after the asset's visemes change). */
  rebuildClipsUsingAudio: (audioId: string) => void;
  removeClip: (id: string) => void;
  bringClipForward: (id: string) => void;
  sendClipBackward: (id: string) => void;
  bringClipToFront: (id: string) => void;
  sendClipToBack: (id: string) => void;
  upsertClipKeyframe: (
    clipId: string,
    property: ClipKeyframeProperty,
    time: number,
    values: ClipKeyframeValuePatch,
    options?: ProjectMutationOptions,
  ) => string | null;
  updateClipKeyframe: (
    selection: ClipKeyframeSelection,
    patch: ClipKeyframeValuePatch,
    options?: ProjectMutationOptions,
  ) => void;
  moveClipKeyframe: (
    selection: ClipKeyframeSelection,
    time: number,
    options?: ProjectMutationOptions,
  ) => void;
  removeClipKeyframe: (selection: ClipKeyframeSelection, options?: ProjectMutationOptions) => void;
  addClipMotionStep: (
    clipId: string,
    time: number,
    options?: ProjectMutationOptions,
  ) => ClipKeyframeSelection | null;
  addClipMotionCheckpoint: (
    clipId: string,
    motionId: string,
    time: number,
    options?: ProjectMutationOptions,
  ) => ClipKeyframeSelection | null;
  moveClipMotionCheckpoint: (
    clipId: string,
    motionId: string,
    checkpointId: string,
    time: number,
    options?: ProjectMutationOptions,
  ) => ClipKeyframeSelection | null;
  removeClipMotionCheckpoint: (
    clipId: string,
    motionId: string,
    checkpointId: string,
    options?: ProjectMutationOptions,
  ) => void;
  moveClipMotionStep: (
    clipId: string,
    motionId: string,
    patch: { startTime?: number; endTime?: number; selectEndpoint?: ClipMotionEndpoint },
    options?: ProjectMutationOptions,
  ) => ClipKeyframeSelection | null;
  renameClipMotionStep: (
    clipId: string,
    motionId: string,
    name: string,
    options?: ProjectMutationOptions,
  ) => void;
  setClipMotionStepPathStyle: (
    clipId: string,
    motionId: string,
    pathStyle: "linear" | "smooth",
    options?: ProjectMutationOptions,
  ) => void;
  removeClipMotionStep: (
    clipId: string,
    motionId: string,
    options?: ProjectMutationOptions,
  ) => void;

  /** Directly replace rootHtml (used by Stage's useElementPicker onSyncFiles). */
  updateRootHtml: (html: string, options?: ProjectMutationOptions) => void;
  updateCompositionHtml: (
    compositionId: string,
    html: string,
    options?: ProjectMutationOptions,
  ) => void;
  repairTimelineLanes: () => boolean;

  addMediaToTimeline: (asset: MediaAsset, trackIndex?: number, insertAtTime?: number) => void;
  registerMediaAsset: (asset: MediaAsset) => void;
  syncMediaAssets: (assets: MediaAsset[]) => void;
  registerCharacterPreset: (character: CharacterPreset) => void;
  unregisterCharacterPreset: (id: string) => void;
  syncCharacterPresets: (characters: CharacterPreset[]) => void;
  registerMotionPreset: (preset: MotionPreset) => void;
  syncMotionPresets: (presets: MotionPreset[]) => void;

  addLane: (trackIndex: number) => void;
  removeLane: (trackIndex: number, laneIndex: number) => void;

  setProjectMeta: (
    patch: Partial<Pick<HyperFramesProject, "name" | "width" | "height" | "fps" | "duration">>,
    options?: ProjectMutationOptions,
  ) => void;
  setZoom: (z: number) => void;
}

const HISTORY_LIMIT = 50;
let saveTimer: number | undefined;
let saveGeneration = 0;
const scheduleSave = (get: () => StudioState, set: (partial: Partial<StudioState>) => void) => {
  if (typeof window === "undefined") return;
  saveGeneration += 1;
  const generation = saveGeneration;
  set({ saveStatus: "saving", saveError: null });
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void get().saveProject(generation);
  }, 500);
};

function applyClipLayerMove(
  id: string,
  placement: LayerPlacement,
  get: () => StudioState,
  set: (partial: Partial<StudioState>) => void,
): void {
  const p = get().project;
  if (!p) return;

  const assignments = resolveLayerAssignments(p, id, placement);
  if (!assignments) return;

  get().checkpointHistory();

  let rootHtml = p.hf.rootHtml;
  for (const [clipId, zIndex] of assignments) {
    rootHtml = updateStudioElementInHtml(rootHtml, clipId, { zIndex });
  }

  const newProject: Project = {
    ...p,
    hf: { ...p.hf, rootHtml: normalizeProjectRootHtml(p.hf, rootHtml) },
    updatedAt: Date.now(),
  };
  set({ project: newProject });
  scheduleSave(get, set);
}

const trackIndexFor = (tracks: TrackMeta[], kind: TrackKind) =>
  Math.max(
    0,
    tracks.findIndex((t) => t.kind === kind),
  );

function cloneProject(project: Project): Project {
  return JSON.parse(JSON.stringify(project)) as Project;
}

function createHistoryEntry(state: StudioState): HistoryEntry | null {
  if (!state.project) return null;
  return {
    project: cloneProject(state.project),
    selectedClipId: state.selectedClipId,
    selectedKeyframe: state.selectedKeyframe,
  };
}

function trimHistory(entries: HistoryEntry[]): HistoryEntry[] {
  return entries.slice(-HISTORY_LIMIT);
}

function restoreHistoryProject(entry: HistoryEntry): Project {
  return { ...cloneProject(entry.project), updatedAt: Date.now() };
}

export const useStudio = create<StudioState>((set, get) => ({
  project: null,
  tracks: [],
  characters: new Map(),
  motionPresets: new Map(),
  mediaAssets: new Map(),
  selectedClipId: null,
  selectedKeyframe: null,
  zoom: 60,
  historyPast: [],
  historyFuture: [],
  saveStatus: "saved",
  lastSavedAt: null,
  saveError: null,
  currentModal: null,
  openModal(modal) {
    set({ currentModal: modal });
  },
  closeModal() {
    set({ currentModal: null });
  },

  async loadProject(id) {
    const storedProject = (await db.projects.get(id)) as unknown;
    if (!storedProject) return;
    if (!isCurrentProjectShape(storedProject)) {
      await db.projects.delete(id);
      await db.projectThumbnails.delete(id);
      await get().newProject();
      return;
    }

    const [allCharacters, allPresets, allMedia] = await Promise.all([
      db.characters.toArray(),
      db.motionPresets.toArray(),
      db.media.toArray(),
    ]);
    const characters = new Map(allCharacters.map((c) => [c.id, c]));
    const motionPresets = new Map(allPresets.map((p) => [p.id, p]));
    const mediaAssets = new Map(allMedia.map((m) => [m.id, m]));

    let project = rebuildCharacterCompositions(
      syncProjectRenderTrackIndices(storedProject),
      characters,
      mediaAssets,
      motionPresets,
    );
    if (project !== storedProject) {
      project = { ...project, updatedAt: Date.now() };
      await db.projects.put(project);
    }
    set({
      project,
      tracks: project.editorMeta.tracks,
      characters,
      motionPresets,
      mediaAssets,
      selectedClipId: null,
      selectedKeyframe: null,
      historyPast: [],
      historyFuture: [],
      saveStatus: "saved",
      lastSavedAt: Date.now(),
      saveError: null,
    });
  },

  async newProject() {
    const project = createBlankProject();
    await db.projects.put(project);
    set({
      project,
      tracks: project.editorMeta.tracks,
      characters: new Map(),
      motionPresets: new Map(),
      mediaAssets: new Map(),
      selectedClipId: null,
      selectedKeyframe: null,
      historyPast: [],
      historyFuture: [],
      saveStatus: "saved",
      lastSavedAt: Date.now(),
      saveError: null,
    });
  },

  async saveProject(expectedGeneration) {
    const p = get().project;
    if (!p) return;
    const generation = expectedGeneration ?? saveGeneration;
    if (expectedGeneration === undefined) clearTimeout(saveTimer);
    set({ saveStatus: "saving", saveError: null });
    const updated = { ...p, updatedAt: Date.now() };
    try {
      await db.projects.put(updated);
      const current = get().project;
      const hasNewerEdits = saveGeneration !== generation;
      set({
        project: current === p ? updated : current,
        saveStatus: hasNewerEdits ? "saving" : "saved",
        lastSavedAt: Date.now(),
        saveError: null,
      });
    } catch (error) {
      if (saveGeneration === generation) {
        set({
          saveStatus: "error",
          saveError: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
  },

  selectClip(id) {
    set({
      selectedClipId: id,
      selectedKeyframe: null,
    });
  },

  selectKeyframe(selection) {
    set({
      selectedKeyframe: selection,
      selectedClipId: selection?.clipId ?? get().selectedClipId,
    });
  },

  checkpointHistory() {
    const state = get();
    const entry = createHistoryEntry(state);
    if (!entry) return;
    set({
      historyPast: trimHistory([...state.historyPast, entry]),
      historyFuture: [],
    });
  },

  undo() {
    const state = get();
    const current = createHistoryEntry(state);
    const previous = state.historyPast.at(-1);
    if (!current || !previous) return;

    const project = restoreHistoryProject(previous);
    set({
      project,
      tracks: project.editorMeta.tracks,
      selectedClipId: previous.selectedClipId,
      selectedKeyframe: previous.selectedKeyframe,
      historyPast: state.historyPast.slice(0, -1),
      historyFuture: trimHistory([...state.historyFuture, current]),
    });
    scheduleSave(get, set);
  },

  redo() {
    const state = get();
    const current = createHistoryEntry(state);
    const next = state.historyFuture.at(-1);
    if (!current || !next) return;

    const project = restoreHistoryProject(next);
    set({
      project,
      tracks: project.editorMeta.tracks,
      selectedClipId: next.selectedClipId,
      selectedKeyframe: next.selectedKeyframe,
      historyPast: trimHistory([...state.historyPast, current]),
      historyFuture: state.historyFuture.slice(0, -1),
    });
    scheduleSave(get, set);
  },

  addClip(clip) {
    const state = get();
    const p = state.project;
    if (!p) return;

    let validatedCompositionSource: ValidCompositionSource | null = null;
    if (
      clip.kind === "composition" &&
      clip.compositionKind !== "character" &&
      clip.compositionHtml !== undefined
    ) {
      const compositionId = clip.compositionId ?? `comp_${clip.id}`;
      validatedCompositionSource = assertValidCompositionSourceHtml(
        clip.compositionHtml,
        {
          compositionId,
          duration: clip.duration,
          width: clip.width || p.hf.width,
          height: clip.height || p.hf.height,
        },
        clip.compositionId ? { expectedCompositionId: clip.compositionId } : {},
      );
    }

    get().checkpointHistory();

    const currentClips = deriveEditorClips(p);

    // Lane auto-assignment
    let nextClip = clip;
    if (clip.laneIndex === undefined) {
      const track = p.editorMeta.tracks[clip.trackIndex];
      const maxLanes = track?.lanes ?? 1;
      const lane = pickFreeLane(currentClips, clip.trackIndex, clip.start, clip.duration, maxLanes);
      if (lane >= maxLanes) {
        const newTracks = p.editorMeta.tracks.map((t, i) =>
          i === clip.trackIndex ? { ...t, lanes: lane + 1 } : t,
        );
        const editorMeta: ProjectEditorMeta = { ...p.editorMeta, tracks: newTracks };
        set({ project: { ...p, editorMeta }, tracks: newTracks });
      }
      nextClip = { ...clip, laneIndex: lane };
    }

    const currentProject = get().project!;
    const zIndex = nextClip.zIndex !== undefined ? nextClip.zIndex : currentClips.length;

    const compositionHtml = { ...currentProject.hf.compositionHtml };

    const meta: ClipEditorMeta = {
      name: nextClip.name,
      kind: nextClip.kind as ClipEditorMeta["kind"],
      uiTrackIndex: nextClip.trackIndex,
      uiLaneIndex: nextClip.laneIndex ?? 0,
    };

    let hf = currentProject.hf;

    if (nextClip.kind === "composition") {
      const compositionClip = nextClip as CompositionClip;
      const compositionId =
        compositionClip.compositionId ??
        (compositionClip.compositionKind === "character"
          ? defaultCharacterCompositionId(compositionClip.id)
          : (validatedCompositionSource?.compositionId ?? `comp_${compositionClip.id}`));
      meta.compositionId = compositionId;
      meta.compositionKind = compositionClip.compositionKind ?? "user-composition";
      nextClip = { ...compositionClip, compositionId };

      if (meta.compositionKind === "character") {
        if (!compositionClip.character?.characterId) {
          throw new Error("Character composition clips require character metadata.");
        }
        meta.character = normalizeCharacterClipMeta(compositionClip.character);
        const character = state.characters.get(meta.character.characterId);
        if (!character) {
          throw new Error(`Character preset "${meta.character.characterId}" is not available.`);
        }
        compositionHtml[compositionId] = buildCharacterCompositionHtml({
          compositionId,
          clipId: compositionClip.id,
          duration: compositionClip.duration,
          width: compositionClip.width || currentProject.hf.width,
          height: compositionClip.height || currentProject.hf.height,
          character,
          meta: meta.character,
          speeches: resolveSpeechesForBuild(meta.character, state.mediaAssets),
          motionPresets: state.motionPresets,
        });
        hf = registerCharacterAssets(hf, character, meta.character, state.mediaAssets);
      } else if (compositionClip.compositionHtml !== undefined) {
        const source =
          validatedCompositionSource ??
          assertValidCompositionSourceHtml(
            compositionClip.compositionHtml,
            {
              compositionId,
              duration: compositionClip.duration,
              width: compositionClip.width || currentProject.hf.width,
              height: compositionClip.height || currentProject.hf.height,
            },
            { expectedCompositionId: compositionId },
          );
        compositionHtml[compositionId] = source.html;
      }
    } else if (nextClip.kind === "text") {
      const textClip = nextClip as TextClip;
      meta.kind = "text";
      meta.name = textClip.name;
    } else {
      const mediaClip = nextClip as MediaClip;
      meta.mediaId = mediaClip.mediaId;

      hf = registerHfAsset(hf, state.mediaAssets.get(mediaClip.mediaId));
    }

    const renderTrackIndex = renderTrackIndexFor(nextClip.trackIndex, nextClip.laneIndex ?? 0);
    const { html: nextRootHtml, id: insertedId } = addStudioElementToHtml(
      hf.rootHtml,
      buildTimelineElement(nextClip, zIndex, renderTrackIndex),
    );
    const nextClipsMeta = { ...currentProject.editorMeta.clips, [insertedId]: meta };
    const rootHtml = normalizeProjectRootHtml(hf, nextRootHtml);

    hf = { ...hf, rootHtml, compositionHtml };

    const editorMeta: ProjectEditorMeta = {
      ...currentProject.editorMeta,
      clips: nextClipsMeta,
    };
    const newProject: Project = syncProjectRenderTrackIndices({
      ...currentProject,
      hf,
      editorMeta,
      updatedAt: Date.now(),
    });
    set({
      project: newProject,
      tracks: newProject.editorMeta.tracks,
      selectedClipId: insertedId,
      selectedKeyframe: null,
    });
    scheduleSave(get, set);
  },

  updateClip(id, patch, options) {
    const state = get();
    const p = state.project;
    if (!p) return;
    if (options?.history !== false) get().checkpointHistory();

    const existingMeta = p.editorMeta.clips[id] ?? {};
    const previousAudioIds = new Set(
      characterSpeeches(existingMeta.character).map((speech) => speech.audioId),
    );

    const newMeta = { ...existingMeta };

    if (patch.name !== undefined) newMeta.name = patch.name;
    if (patch.kind !== undefined) newMeta.kind = patch.kind as ClipEditorMeta["kind"];
    if (patch.trackIndex !== undefined) newMeta.uiTrackIndex = patch.trackIndex;
    if (patch.laneIndex !== undefined) newMeta.uiLaneIndex = patch.laneIndex;

    const elementUpdates = buildElementUpdates(patch);
    if (patch.trackIndex !== undefined || patch.laneIndex !== undefined) {
      elementUpdates.renderTrackIndex = renderTrackIndexFor(
        newMeta.uiTrackIndex ?? 0,
        newMeta.uiLaneIndex ?? 0,
      );
    }

    const rootHtml = updateStudioElementInHtml(p.hf.rootHtml, id, elementUpdates);

    if (patch.kind === "composition" || existingMeta.kind === "composition") {
      const compositionPatch = patch as Partial<CompositionClip>;
      if ("compositionId" in compositionPatch)
        newMeta.compositionId = compositionPatch.compositionId;
      if ("compositionKind" in compositionPatch) {
        newMeta.compositionKind = compositionPatch.compositionKind;
      }
      if ("character" in compositionPatch) {
        newMeta.character = compositionPatch.character
          ? normalizeCharacterClipMeta({
              ...(newMeta.character ?? {
                characterId: compositionPatch.character.characterId,
                poses: {},
              }),
              ...compositionPatch.character,
              poses: compositionPatch.character.poses ?? newMeta.character?.poses ?? {},
            })
          : undefined;
      }
    }
    const removedCharacterAudioIds = new Set<string>();
    const nextAudioIds = new Set(
      characterSpeeches(newMeta.character).map((speech) => speech.audioId),
    );
    for (const audioId of previousAudioIds) {
      if (!nextAudioIds.has(audioId)) removedCharacterAudioIds.add(audioId);
    }

    const editorMeta: ProjectEditorMeta = {
      ...p.editorMeta,
      clips: { ...p.editorMeta.clips, [id]: newMeta },
    };
    let newProject: Project = syncProjectRenderTrackIndices({
      ...p,
      hf: { ...p.hf, rootHtml: normalizeProjectRootHtml(p.hf, rootHtml) },
      editorMeta,
      updatedAt: Date.now(),
    });
    newProject = rebuildCharacterCompositionInProject(
      newProject,
      id,
      state.characters,
      state.mediaAssets,
      state.motionPresets,
    );
    if (removedCharacterAudioIds.size > 0) {
      newProject = {
        ...newProject,
        hf: pruneCandidateHfAssets(
          newProject.hf,
          removedCharacterAudioIds,
          collectReferencedAssetIds(newProject.editorMeta.clips, state.characters),
        ),
      };
    }
    set({ project: newProject, tracks: newProject.editorMeta.tracks });
    scheduleSave(get, set);
  },

  attachVoiceToCharacter(clipId, audioId) {
    const state = get();
    if (!state.project) return;
    const clip = deriveEditorClips(state.project).find((candidate) => candidate.id === clipId);
    if (!isCharacterCompositionClip(clip)) return;
    const asset = state.mediaAssets.get(audioId);
    if (!asset || asset.kind !== "audio") return;
    // Append a speech after the last one ends (clamped to the clip). Reuses
    // updateClip, which rebuilds the sub-composition (visemes hydrate from the
    // asset — no regeneration) and manifest-prunes any newly-unreferenced audio.
    const existing = characterSpeeches(clip.character);
    const lastEnd = existing.reduce(
      (max, speech) =>
        Math.max(max, speech.start + (state.mediaAssets.get(speech.audioId)?.duration ?? 0)),
      0,
    );
    const start = Math.max(0, Math.min(clip.duration, lastEnd));
    const speeches = [...existing, { id: uid(), audioId, start }];
    get().updateClip(clipId, {
      character: {
        ...clip.character,
        speeches,
        lipSyncAudioId: undefined,
        visemes: undefined,
        voiceLine: asset.voiceLine ?? { text: "", source: "audio-file", audioName: asset.name },
      },
      duration: Math.max(clip.duration, start + (asset.duration ?? 0)),
    } as Partial<CompositionClip>);
    get().selectClip(clipId);
  },

  moveSpeech(clipId, speechId, start, options) {
    const state = get();
    if (!state.project) return;
    const clip = deriveEditorClips(state.project).find((candidate) => candidate.id === clipId);
    if (!isCharacterCompositionClip(clip)) return;
    const clamped = Math.max(0, Math.min(clip.duration, start));
    const speeches = characterSpeeches(clip.character).map((speech) =>
      speech.id === speechId ? { ...speech, start: clamped } : speech,
    );
    get().updateClip(
      clipId,
      {
        character: { ...clip.character, speeches, lipSyncAudioId: undefined },
      } as Partial<CompositionClip>,
      options,
    );
  },

  setSpeechVolume(clipId, speechId, volume) {
    const state = get();
    if (!state.project) return;
    const clip = deriveEditorClips(state.project).find((candidate) => candidate.id === clipId);
    if (!isCharacterCompositionClip(clip)) return;
    const clamped = Math.max(0, Math.min(1, volume));
    const speeches = characterSpeeches(clip.character).map((speech) =>
      speech.id === speechId ? { ...speech, volume: clamped } : speech,
    );
    get().updateClip(clipId, {
      character: { ...clip.character, speeches, lipSyncAudioId: undefined },
    } as Partial<CompositionClip>);
  },

  removeSpeech(clipId, speechId) {
    const state = get();
    if (!state.project) return;
    const clip = deriveEditorClips(state.project).find((candidate) => candidate.id === clipId);
    if (!isCharacterCompositionClip(clip)) return;
    const speeches = characterSpeeches(clip.character).filter((speech) => speech.id !== speechId);
    // Keep the audio blob (reusable voice); updateClip manifest-prunes the now
    // unreferenced asset from the export manifest only.
    get().updateClip(clipId, {
      character: { ...clip.character, speeches, lipSyncAudioId: undefined },
    } as Partial<CompositionClip>);
  },

  rebuildClipsUsingAudio(audioId) {
    const state = get();
    if (!state.project) return;
    let project = state.project;
    for (const [clipId, meta] of Object.entries(project.editorMeta.clips)) {
      if (!isCharacterMeta(meta)) continue;
      if (!characterSpeeches(meta.character).some((speech) => speech.audioId === audioId)) continue;
      project = rebuildCharacterCompositionInProject(
        project,
        clipId,
        state.characters,
        state.mediaAssets,
        state.motionPresets,
      );
    }
    if (project !== state.project) {
      set({ project: { ...project, updatedAt: Date.now() }, tracks: project.editorMeta.tracks });
      scheduleSave(get, set);
    }
  },

  repairTimelineLanes() {
    const p = get().project;
    if (!p) return false;
    const repaired = syncProjectRenderTrackIndices(p);
    if (repaired === p) return false;
    const newProject = { ...repaired, updatedAt: Date.now() };
    set({ project: newProject, tracks: newProject.editorMeta.tracks });
    scheduleSave(get, set);
    return true;
  },

  removeClip(id) {
    const state = get();
    const p = state.project;
    if (!p) return;
    get().checkpointHistory();

    const existingMeta = p.editorMeta.clips[id];

    const newClipsMeta = Object.fromEntries(
      Object.entries(p.editorMeta.clips).filter(([clipId]) => clipId !== id),
    );
    let rootHtml = removeElementFromHtml(p.hf.rootHtml, id);
    rootHtml = normalizeProjectRootHtml(p.hf, rootHtml);

    const compositionHtml = { ...p.hf.compositionHtml };
    if (existingMeta?.kind === "composition") {
      delete compositionHtml[existingMeta.compositionId ?? `comp_${id}`];
    }

    const referencedIds = collectReferencedAssetIds(newClipsMeta, state.characters);
    const newHf = pruneHfAssets({ ...p.hf, rootHtml, compositionHtml }, referencedIds);

    const newProject: Project = {
      ...p,
      hf: newHf,
      editorMeta: { ...p.editorMeta, clips: newClipsMeta },
      updatedAt: Date.now(),
    };

    set({
      project: newProject,
      selectedClipId: state.selectedClipId === id ? null : state.selectedClipId,
      selectedKeyframe: state.selectedKeyframe?.clipId === id ? null : state.selectedKeyframe,
    });
    scheduleSave(get, set);

    if (typeof window !== "undefined") {
      const removedMediaIds = new Set<string>();
      if (existingMeta?.mediaId) removedMediaIds.add(existingMeta.mediaId);
      // Character voices stay in the library as reusable assets; only the manifest
      // entry is pruned above (pruneHfAssets). Don't delete their blobs here.

      if (removedMediaIds.size > 0) {
        window.setTimeout(() => {
          void get()
            .saveProject()
            .then(() =>
              Promise.all(
                Array.from(removedMediaIds).map((mediaId) =>
                  deleteMediaIfUnused(mediaId, { internalOnly: true }),
                ),
              ),
            );
        }, 0);
      }
    }
  },

  bringClipForward(id) {
    applyClipLayerMove(id, "forward", get, set);
  },

  sendClipBackward(id) {
    applyClipLayerMove(id, "backward", get, set);
  },

  bringClipToFront(id) {
    applyClipLayerMove(id, "front", get, set);
  },

  sendClipToBack(id) {
    applyClipLayerMove(id, "back", get, set);
  },

  upsertClipKeyframe(clipId, property, time, values, options) {
    const state = get();
    const p = state.project;
    if (!p) return null;
    const clip = deriveEditorClips(p).find((candidate) => candidate.id === clipId);
    if (!clip || clip.kind === "audio") return null;
    if (options?.history !== false) get().checkpointHistory();

    const result = upsertKeyframeProperty(clip.keyframes, {
      property,
      time,
      duration: clip.duration,
      values: storedValuesFromDisplayValues(clip, property, values),
      ease: values.ease,
      createId: uid,
    });
    if (!result.keyframeId) return null;

    const rootHtml = setClipKeyframesInRootHtml(p.hf.rootHtml, clipId, result.keyframes);
    const selectedKeyframe: ClipKeyframeSelection = {
      clipId,
      keyframeId: result.keyframeId,
      property,
    };
    set({
      project: {
        ...p,
        hf: { ...p.hf, rootHtml: normalizeProjectRootHtml(p.hf, rootHtml) },
        updatedAt: Date.now(),
      },
      selectedClipId: clipId,
      selectedKeyframe,
    });
    scheduleSave(get, set);
    return result.keyframeId;
  },

  updateClipKeyframe(selection, patch, options) {
    const state = get();
    const p = state.project;
    if (!p) return;
    const clip = deriveEditorClips(p).find((candidate) => candidate.id === selection.clipId);
    if (!clip || clip.kind === "audio") return;
    if (options?.history !== false) get().checkpointHistory();

    const result = updateKeyframeProperty(clip.keyframes, {
      keyframeId: selection.keyframeId,
      property: selection.property,
      duration: clip.duration,
      values: hasDisplayValuePatch(patch)
        ? storedValuesFromDisplayValues(clip, selection.property, patch)
        : undefined,
      ease: patch.ease,
    });
    if (!result.keyframeId) return;

    const rootHtml = setClipKeyframesInRootHtml(p.hf.rootHtml, selection.clipId, result.keyframes);
    set({
      project: {
        ...p,
        hf: { ...p.hf, rootHtml: normalizeProjectRootHtml(p.hf, rootHtml) },
        updatedAt: Date.now(),
      },
      selectedClipId: selection.clipId,
      selectedKeyframe: selection,
    });
    scheduleSave(get, set);
  },

  moveClipKeyframe(selection, time, options) {
    const state = get();
    const p = state.project;
    if (!p) return;
    const clip = deriveEditorClips(p).find((candidate) => candidate.id === selection.clipId);
    if (!clip || clip.kind === "audio") return;
    if (options?.history !== false) get().checkpointHistory();

    const result = moveKeyframeProperty(clip.keyframes, {
      keyframeId: selection.keyframeId,
      property: selection.property,
      time,
      duration: clip.duration,
    });
    if (!result.keyframeId) return;

    const rootHtml = setClipKeyframesInRootHtml(p.hf.rootHtml, selection.clipId, result.keyframes);
    const selectedKeyframe: ClipKeyframeSelection = {
      ...selection,
      keyframeId: result.keyframeId,
    };
    set({
      project: {
        ...p,
        hf: { ...p.hf, rootHtml: normalizeProjectRootHtml(p.hf, rootHtml) },
        updatedAt: Date.now(),
      },
      selectedClipId: selection.clipId,
      selectedKeyframe,
    });
    scheduleSave(get, set);
  },

  removeClipKeyframe(selection, options) {
    const state = get();
    const p = state.project;
    if (!p) return;
    const clip = deriveEditorClips(p).find((candidate) => candidate.id === selection.clipId);
    if (!clip || clip.kind === "audio") return;
    if (options?.history !== false) get().checkpointHistory();

    const keyframes = removeKeyframeProperty(
      clip.keyframes,
      selection.keyframeId,
      selection.property,
    );
    const rootHtml = setClipKeyframesInRootHtml(p.hf.rootHtml, selection.clipId, keyframes);
    set({
      project: {
        ...p,
        hf: { ...p.hf, rootHtml: normalizeProjectRootHtml(p.hf, rootHtml) },
        updatedAt: Date.now(),
      },
      selectedKeyframe: null,
    });
    scheduleSave(get, set);
  },

  addClipMotionStep(clipId, time, options) {
    const state = get();
    const p = state.project;
    if (!p) return null;
    const clip = deriveEditorClips(p).find((candidate) => candidate.id === clipId);
    if (!clip || clip.kind === "audio") return null;
    if (options?.history !== false) get().checkpointHistory();

    const result = addMotionStepToClip(clip, {
      time,
      createId: uid,
    });
    if (!result.selection) return null;

    const rootHtml = setClipMotionModelInRootHtml(
      p.hf.rootHtml,
      clipId,
      result.keyframes,
      result.motionSteps,
    );
    const selectedKeyframe: ClipKeyframeSelection = {
      clipId,
      keyframeId: result.selection.keyframeId,
      property: result.selection.property,
    };
    set({
      project: {
        ...p,
        hf: { ...p.hf, rootHtml: normalizeProjectRootHtml(p.hf, rootHtml) },
        updatedAt: Date.now(),
      },
      selectedClipId: clipId,
      selectedKeyframe,
    });
    scheduleSave(get, set);
    return selectedKeyframe;
  },

  addClipMotionCheckpoint(clipId, motionId, time, options) {
    const state = get();
    const p = state.project;
    if (!p) return null;
    const clip = deriveEditorClips(p).find((candidate) => candidate.id === clipId);
    if (!clip || clip.kind === "audio") return null;
    if (options?.history !== false) get().checkpointHistory();

    const result = addMotionCheckpointToClip(clip, {
      motionId,
      time,
      createId: uid,
    });
    if (!result.selection) return null;

    const rootHtml = setClipMotionModelInRootHtml(
      p.hf.rootHtml,
      clipId,
      result.keyframes,
      result.motionSteps,
    );
    const selectedKeyframe: ClipKeyframeSelection = {
      clipId,
      keyframeId: result.selection.keyframeId,
      property: result.selection.property,
    };
    set({
      project: {
        ...p,
        hf: { ...p.hf, rootHtml: normalizeProjectRootHtml(p.hf, rootHtml) },
        updatedAt: Date.now(),
      },
      selectedClipId: clipId,
      selectedKeyframe,
    });
    scheduleSave(get, set);
    return selectedKeyframe;
  },

  moveClipMotionStep(clipId, motionId, patch, options) {
    const state = get();
    const p = state.project;
    if (!p) return null;
    const clip = deriveEditorClips(p).find((candidate) => candidate.id === clipId);
    if (!clip || clip.kind === "audio") return null;
    if (options?.history !== false) get().checkpointHistory();

    const result = moveMotionStep(clip, { motionId, ...patch });
    if (!result.selection) return null;

    const rootHtml = setClipMotionModelInRootHtml(
      p.hf.rootHtml,
      clipId,
      result.keyframes,
      result.motionSteps,
    );
    const selectedKeyframe: ClipKeyframeSelection = {
      clipId,
      keyframeId: result.selection.keyframeId,
      property: result.selection.property,
    };
    set({
      project: {
        ...p,
        hf: { ...p.hf, rootHtml: normalizeProjectRootHtml(p.hf, rootHtml) },
        updatedAt: Date.now(),
      },
      selectedClipId: clipId,
      selectedKeyframe,
    });
    scheduleSave(get, set);
    return selectedKeyframe;
  },

  moveClipMotionCheckpoint(clipId, motionId, checkpointId, time, options) {
    const state = get();
    const p = state.project;
    if (!p) return null;
    const clip = deriveEditorClips(p).find((candidate) => candidate.id === clipId);
    if (!clip || clip.kind === "audio") return null;
    if (options?.history !== false) get().checkpointHistory();

    const result = moveMotionCheckpoint(clip, { motionId, checkpointId, time });
    if (!result.selection) return null;

    const rootHtml = setClipMotionModelInRootHtml(
      p.hf.rootHtml,
      clipId,
      result.keyframes,
      result.motionSteps,
    );
    const selectedKeyframe: ClipKeyframeSelection = {
      clipId,
      keyframeId: result.selection.keyframeId,
      property: result.selection.property,
    };
    set({
      project: {
        ...p,
        hf: { ...p.hf, rootHtml: normalizeProjectRootHtml(p.hf, rootHtml) },
        updatedAt: Date.now(),
      },
      selectedClipId: clipId,
      selectedKeyframe,
    });
    scheduleSave(get, set);
    return selectedKeyframe;
  },

  renameClipMotionStep(clipId, motionId, name, options) {
    const state = get();
    const p = state.project;
    if (!p) return;
    const clip = deriveEditorClips(p).find((candidate) => candidate.id === clipId);
    if (!clip || clip.kind === "audio") return;
    if (options?.history !== false) get().checkpointHistory();

    const motionSteps = renameMotionStep(clip, motionId, name);
    const rootHtml = setClipMotionModelInRootHtml(
      p.hf.rootHtml,
      clipId,
      clip.keyframes,
      motionSteps,
    );
    set({
      project: {
        ...p,
        hf: { ...p.hf, rootHtml: normalizeProjectRootHtml(p.hf, rootHtml) },
        updatedAt: Date.now(),
      },
      selectedClipId: clipId,
    });
    scheduleSave(get, set);
  },

  setClipMotionStepPathStyle(clipId, motionId, pathStyle, options) {
    const state = get();
    const p = state.project;
    if (!p) return;
    const clip = deriveEditorClips(p).find((candidate) => candidate.id === clipId);
    if (!clip || clip.kind === "audio") return;
    if (options?.history !== false) get().checkpointHistory();

    const motionSteps = setMotionStepPathStyle(clip, motionId, pathStyle);
    const rootHtml = setClipMotionModelInRootHtml(
      p.hf.rootHtml,
      clipId,
      clip.keyframes,
      motionSteps,
    );
    set({
      project: {
        ...p,
        hf: { ...p.hf, rootHtml: normalizeProjectRootHtml(p.hf, rootHtml) },
        updatedAt: Date.now(),
      },
      selectedClipId: clipId,
    });
    scheduleSave(get, set);
  },

  removeClipMotionStep(clipId, motionId, options) {
    const state = get();
    const p = state.project;
    if (!p) return;
    const clip = deriveEditorClips(p).find((candidate) => candidate.id === clipId);
    if (!clip || clip.kind === "audio") return;
    if (options?.history !== false) get().checkpointHistory();

    const result = removeMotionStep(clip, motionId);
    const rootHtml = setClipMotionModelInRootHtml(
      p.hf.rootHtml,
      clipId,
      result.keyframes,
      result.motionSteps,
    );
    set({
      project: {
        ...p,
        hf: { ...p.hf, rootHtml: normalizeProjectRootHtml(p.hf, rootHtml) },
        updatedAt: Date.now(),
      },
      selectedClipId: clipId,
      selectedKeyframe: null,
    });
    scheduleSave(get, set);
  },

  removeClipMotionCheckpoint(clipId, motionId, checkpointId, options) {
    const state = get();
    const p = state.project;
    if (!p) return;
    const clip = deriveEditorClips(p).find((candidate) => candidate.id === clipId);
    if (!clip || clip.kind === "audio") return;
    if (options?.history !== false) get().checkpointHistory();

    const result = removeMotionCheckpoint(clip, motionId, checkpointId);
    const rootHtml = setClipMotionModelInRootHtml(
      p.hf.rootHtml,
      clipId,
      result.keyframes,
      result.motionSteps,
    );
    set({
      project: {
        ...p,
        hf: { ...p.hf, rootHtml: normalizeProjectRootHtml(p.hf, rootHtml) },
        updatedAt: Date.now(),
      },
      selectedClipId: clipId,
      selectedKeyframe: null,
    });
    scheduleSave(get, set);
  },

  updateRootHtml(html, options) {
    const p = get().project;
    if (!p) return;
    if (options?.history !== false) get().checkpointHistory();
    set({
      project: {
        ...p,
        hf: {
          ...p.hf,
          rootHtml: normalizeProjectRootHtml(p.hf, html),
        },
        updatedAt: Date.now(),
      },
    });
    scheduleSave(get, set);
  },

  updateCompositionHtml(compositionId, html, options) {
    const p = get().project;
    if (!p) return;
    const clip = deriveEditorClips(p).find(
      (candidate) => candidate.compositionId === compositionId,
    );
    const source = assertValidCompositionSourceHtml(
      html,
      {
        compositionId,
        duration: clip?.duration ?? p.hf.duration,
        width: clip?.width || p.hf.width,
        height: clip?.height || p.hf.height,
      },
      { expectedCompositionId: compositionId },
    );
    if (options?.history !== false) get().checkpointHistory();
    set({
      project: {
        ...p,
        hf: {
          ...p.hf,
          compositionHtml: {
            ...p.hf.compositionHtml,
            [compositionId]: source.html,
          },
        },
        updatedAt: Date.now(),
      },
    });
    scheduleSave(get, set);
  },

  addMediaToTimeline(asset, trackIndex, insertAtTime = 0) {
    const state = get();
    const p = state.project;
    if (!p) return;
    get().registerMediaAsset(asset);
    let kindForTrack: TrackKind = "overlay";
    if (asset.kind === "audio") kindForTrack = "audio";
    const ti = trackIndex ?? trackIndexFor(p.editorMeta.tracks, kindForTrack);
    const dur = asset.duration && asset.duration > 0 ? asset.duration : 4;
    const naturalW = asset.width ?? 0;
    const naturalH = asset.height ?? 0;
    const isAudio = asset.kind === "audio";
    const stageW = p.hf.width;
    const stageH = p.hf.height;
    let cw = isAudio ? 0 : naturalW || stageW;
    let ch = isAudio ? 0 : naturalH || stageH;
    if (!isAudio && (cw > stageW || ch > stageH)) {
      const r = Math.min(stageW / cw, stageH / ch);
      cw = Math.round(cw * r);
      ch = Math.round(ch * r);
    }
    const currentClips = deriveEditorClips(get().project!);
    const clip: MediaClip = {
      id: uid(),
      kind: asset.kind,
      mediaId: asset.id,
      name: asset.name,
      trackIndex: ti,
      start: insertAtTime,
      duration: dur,
      x: isAudio ? 0 : Math.round((stageW - cw) / 2),
      y: isAudio ? 0 : Math.round((stageH - ch) / 2),
      width: cw,
      height: ch,
      rotation: 0,
      opacity: 1,
      zIndex: currentClips.length,
    };
    get().addClip(clip);
  },

  registerMediaAsset(asset) {
    const state = get();
    const mediaAssets = new Map(state.mediaAssets);
    mediaAssets.set(asset.id, asset);
    const project = state.project
      ? refreshProjectAssets(state.project, state.characters, mediaAssets)
      : null;
    set({ mediaAssets, project });
    if (project && project !== state.project) scheduleSave(get, set);
  },

  syncMediaAssets(assets) {
    const state = get();
    const mediaAssets = new Map(state.mediaAssets);
    let changed = false;
    const incomingIds = new Set(assets.map((a) => a.id));

    for (const asset of assets) {
      const existing = mediaAssets.get(asset.id);
      if (
        !existing ||
        existing.createdAt !== asset.createdAt ||
        existing.filename !== asset.filename ||
        existing.mimeType !== asset.mimeType
      ) {
        mediaAssets.set(asset.id, asset);
        changed = true;
      }
    }
    for (const id of Array.from(mediaAssets.keys())) {
      if (!incomingIds.has(id)) {
        mediaAssets.delete(id);
        changed = true;
      }
    }

    if (!changed) return;
    const project = state.project
      ? refreshProjectAssets(state.project, state.characters, mediaAssets)
      : null;
    set({ mediaAssets, project });
    if (project && project !== state.project) scheduleSave(get, set);
  },

  registerCharacterPreset(character) {
    const state = get();
    const characters = new Map(state.characters);
    characters.set(character.id, character);
    const project = state.project
      ? rebuildCharacterCompositions(
          state.project,
          characters,
          state.mediaAssets,
          state.motionPresets,
          character.id,
        )
      : null;
    set({ characters, project });
    if (project && project !== state.project) scheduleSave(get, set);
  },

  unregisterCharacterPreset(id) {
    const state = get();
    if (!state.characters.has(id)) return;
    const characters = new Map(state.characters);
    characters.delete(id);
    set({ characters });
  },

  syncCharacterPresets(charactersList) {
    const state = get();
    const characters = new Map(state.characters);
    const incomingIds = new Set(charactersList.map((c) => c.id));
    let changed = false;

    for (const character of charactersList) {
      const existing = characters.get(character.id);
      if (!existing || existing.updatedAt !== character.updatedAt) {
        characters.set(character.id, character);
        changed = true;
      }
    }
    for (const id of Array.from(characters.keys())) {
      if (!incomingIds.has(id)) {
        characters.delete(id);
        changed = true;
      }
    }
    if (changed) {
      const project = state.project
        ? rebuildCharacterCompositions(
            state.project,
            characters,
            state.mediaAssets,
            state.motionPresets,
          )
        : null;
      set({ characters, project });
      if (project && project !== state.project) scheduleSave(get, set);
    }
  },

  registerMotionPreset(preset) {
    const state = get();
    const motionPresets = new Map(state.motionPresets);
    motionPresets.set(preset.id, preset);
    const project = state.project
      ? rebuildCharacterCompositions(
          state.project,
          state.characters,
          state.mediaAssets,
          motionPresets,
        )
      : null;
    set({ motionPresets, project });
    if (project && project !== state.project) scheduleSave(get, set);
  },

  syncMotionPresets(presets) {
    const state = get();
    const motionPresets = new Map(state.motionPresets);
    const incomingIds = new Set(presets.map((p) => p.id));
    let changed = false;

    for (const preset of presets) {
      const existing = motionPresets.get(preset.id);
      if (!existing || existing.updatedAt !== preset.updatedAt) {
        motionPresets.set(preset.id, preset);
        changed = true;
      }
    }
    for (const id of Array.from(motionPresets.keys())) {
      if (!incomingIds.has(id)) {
        motionPresets.delete(id);
        changed = true;
      }
    }
    if (changed) {
      const project = state.project
        ? rebuildCharacterCompositions(
            state.project,
            state.characters,
            state.mediaAssets,
            motionPresets,
          )
        : null;
      set({ motionPresets, project });
      if (project && project !== state.project) scheduleSave(get, set);
    }
  },

  addLane(trackIndex) {
    const p = get().project;
    if (!p) return;
    get().checkpointHistory();
    const newTracks = p.editorMeta.tracks.map((t, i) =>
      i === trackIndex ? { ...t, lanes: (t.lanes ?? 1) + 1 } : t,
    );
    const editorMeta = { ...p.editorMeta, tracks: newTracks };
    const newProject: Project = { ...p, editorMeta, updatedAt: Date.now() };
    set({ project: newProject, tracks: newTracks });
    scheduleSave(get, set);
  },

  removeLane(trackIndex, laneIndex) {
    const state = get();
    const p = state.project;
    if (!p) return;
    const track = p.editorMeta.tracks[trackIndex];
    const laneCount = Math.max(1, track?.lanes ?? 1);
    if (!track || laneCount <= 1) return;

    const currentClips = deriveEditorClips(p);
    const laneHasClips = currentClips.some(
      (c) => c.trackIndex === trackIndex && (c.laneIndex ?? 0) === laneIndex,
    );
    if (laneHasClips) return;
    get().checkpointHistory();

    const newTracks = p.editorMeta.tracks.map((t, i) =>
      i === trackIndex ? { ...t, lanes: Math.max(1, laneCount - 1) } : t,
    );
    const newClipsMeta = Object.fromEntries(
      Object.entries(p.editorMeta.clips).map(([clipId, meta]) => {
        if (meta.uiTrackIndex !== trackIndex) return [clipId, meta];
        const currentLane = meta.uiLaneIndex ?? 0;
        if (currentLane > laneIndex) return [clipId, { ...meta, uiLaneIndex: currentLane - 1 }];
        return [clipId, meta];
      }),
    );

    const editorMeta = { ...p.editorMeta, tracks: newTracks, clips: newClipsMeta };
    const newProject: Project = { ...p, editorMeta, updatedAt: Date.now() };
    set({ project: newProject, tracks: newTracks });
    scheduleSave(get, set);
  },

  setProjectMeta(patch, options) {
    const p = get().project;
    if (!p) return;
    if (options?.history !== false) get().checkpointHistory();

    let newHf = { ...p.hf, ...patch };
    if (patch.duration !== undefined || patch.width !== undefined || patch.height !== undefined) {
      newHf = {
        ...newHf,
        rootHtml: updateRootCompositionHtml(p.hf.rootHtml, patch),
      };
    }
    const newProject: Project = {
      ...p,
      name: patch.name ?? p.name,
      hf: newHf,
      updatedAt: Date.now(),
    };
    set({ project: newProject });
    scheduleSave(get, set);
  },

  setZoom(z) {
    set({ zoom: Math.max(10, Math.min(400, z)) });
  },
}));

export type { StudioState };

// Re-export Track for files that still import it from store
export type { Track };
