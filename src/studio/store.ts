// Editor state — project, selection, zoom. Playback owned by @hyperframes/studio.
// Persistence to Dexie happens via explicit save calls (autosave debounced).
import { create } from "zustand";
import { addElementToHtml, removeElementFromHtml, updateElementInHtml } from "@hyperframes/core";
import type { TimelineElement } from "@hyperframes/core";
import { db, deleteMediaIfUnused, isCurrentProjectShape, uid } from "./db";
import type {
  AnyClip,
  CharacterClip,
  CharacterPreset,
  ClipEditorMeta,
  HyperFramesProject,
  MediaAsset,
  MediaClip,
  MotionPreset,
  Project,
  ProjectEditorMeta,
  Track,
  TrackKind,
  TrackMeta,
} from "./types";
import { deriveEditorClips } from "./types";
import { pruneHfAssets, registerHfAsset } from "./hyperframes/assets";
import { parseStudioHtml } from "./hyperframes/html";
import { normalizeNativeHyperframesHtml } from "./hyperframes/native";
import {
  createRootCompositionHtml,
  updateRootCompositionHtml,
} from "./hyperframes/root-composition";

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
    if (meta.lipSyncAudioId) ids.add(meta.lipSyncAudioId);
    if (meta.characterId) {
      const character = characters.get(meta.characterId);
      for (const part of character?.parts ?? []) ids.add(part.mediaId);
      for (const variant of character?.headVariants ?? []) ids.add(variant.mediaId);
    }
  }
  return ids;
}

function refreshProjectAssets(
  project: Project,
  characters: Map<string, CharacterPreset>,
  mediaAssets: Map<string, MediaAsset>,
): Project {
  let hf = project.hf;

  for (const meta of Object.values(project.editorMeta.clips)) {
    if (meta.mediaId) hf = registerHfAsset(hf, mediaAssets.get(meta.mediaId));
    if (meta.kind === "character" && meta.characterId) {
      const character = characters.get(meta.characterId);
      for (const part of character?.parts ?? []) {
        hf = registerHfAsset(hf, mediaAssets.get(part.mediaId));
      }
      for (const variant of character?.headVariants ?? []) {
        hf = registerHfAsset(hf, mediaAssets.get(variant.mediaId));
      }
    }
    if (meta.lipSyncAudioId) hf = registerHfAsset(hf, mediaAssets.get(meta.lipSyncAudioId));
  }

  return hf !== project.hf ? { ...project, hf, updatedAt: Date.now() } : project;
}

function normalizeProjectRootHtml(hf: HyperFramesProject, html: string): string {
  return normalizeNativeHyperframesHtml(html, {
    width: hf.width,
    height: hf.height,
  });
}

function buildTimelineElement(clip: AnyClip, zIndex: number): TimelineElement {
  if (clip.kind === "character") {
    return {
      id: clip.id,
      type: "composition",
      name: clip.name,
      startTime: clip.start,
      duration: clip.duration,
      zIndex,
      x: clip.x,
      y: clip.y,
      src: `compositions/comp_${clip.id}.html`,
      compositionId: `comp_${clip.id}`,
      sourceWidth: clip.width,
      sourceHeight: clip.height,
    };
  }

  return {
    id: clip.id,
    type: clip.kind,
    name: clip.name,
    startTime: clip.start,
    duration: clip.duration,
    zIndex,
    x: clip.x,
    y: clip.y,
    src: `asset:${clip.mediaId}`,
    sourceWidth: clip.width,
    sourceHeight: clip.height,
    opacity: clip.opacity,
  };
}

function buildElementUpdates(patch: Partial<AnyClip>): Partial<TimelineElement> {
  const updates: Partial<TimelineElement> = {};

  if (patch.start !== undefined) updates.startTime = patch.start;
  if (patch.duration !== undefined) updates.duration = patch.duration;
  if (patch.x !== undefined) updates.x = patch.x;
  if (patch.y !== undefined) updates.y = patch.y;
  if (patch.zIndex !== undefined) updates.zIndex = patch.zIndex;
  if (patch.opacity !== undefined) updates.opacity = patch.opacity;
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.width !== undefined) updates.sourceWidth = patch.width;
  if (patch.height !== undefined) updates.sourceHeight = patch.height;

  return updates;
}

// ─── Store ────────────────────────────────────────────────────────────────────

type ModalState = null | { type: "character-editor"; characterId: string } | { type: "presets" };

interface StudioState {
  project: Project | null;
  tracks: TrackMeta[];

  // Preloaded reference data (for character editor, asset gallery)
  characters: Map<string, CharacterPreset>;
  motionPresets: Map<string, MotionPreset>;
  mediaAssets: Map<string, MediaAsset>;

  selectedClipId: string | null;
  zoom: number;

  currentModal: ModalState;
  openModal: (modal: Exclude<ModalState, null>) => void;
  closeModal: () => void;

  loadProject: (id: string) => Promise<void>;
  newProject: () => Promise<void>;
  saveProject: () => Promise<void>;

  selectClip: (id: string | null) => void;

  addClip: (clip: AnyClip) => void;
  updateClip: (id: string, patch: Partial<AnyClip>) => void;
  removeClip: (id: string) => void;

  /** Directly replace rootHtml (used by Stage's useElementPicker onSyncFiles). */
  updateRootHtml: (html: string) => void;

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
  ) => void;
  setZoom: (z: number) => void;
}

let saveTimer: number | undefined;
const scheduleSave = (get: () => StudioState) => {
  if (typeof window === "undefined") return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void get().saveProject();
  }, 500);
};

const trackIndexFor = (tracks: TrackMeta[], kind: TrackKind) =>
  Math.max(
    0,
    tracks.findIndex((t) => t.kind === kind),
  );

export const useStudio = create<StudioState>((set, get) => ({
  project: null,
  tracks: [],
  characters: new Map(),
  motionPresets: new Map(),
  mediaAssets: new Map(),
  selectedClipId: null,
  zoom: 60,
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

    set({
      project: storedProject,
      tracks: storedProject.editorMeta.tracks,
      characters,
      motionPresets,
      mediaAssets,
      selectedClipId: null,
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
    });
  },

  async saveProject() {
    const p = get().project;
    if (!p) return;
    const updated = { ...p, updatedAt: Date.now() };
    await db.projects.put(updated);
  },

  selectClip(id) {
    set({ selectedClipId: id });
  },

  addClip(clip) {
    const state = get();
    const p = state.project;
    if (!p) return;

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

    if (nextClip.kind === "character") {
      const charClip = nextClip as CharacterClip;
      meta.characterId = charClip.characterId;
      meta.poses = charClip.poses;
      meta.visemes = charClip.visemes;
      meta.motions = charClip.motions;
      meta.autoBlink = charClip.autoBlink;
    } else {
      const mediaClip = nextClip as MediaClip;
      meta.mediaId = mediaClip.mediaId;

      hf = registerHfAsset(hf, state.mediaAssets.get(mediaClip.mediaId));
    }

    const { html: nextRootHtml, id: insertedId } = addElementToHtml(
      hf.rootHtml,
      buildTimelineElement(nextClip, zIndex),
    );
    const nextClipsMeta = { ...currentProject.editorMeta.clips, [insertedId]: meta };
    const rootHtml = normalizeProjectRootHtml(hf, nextRootHtml);

    hf = { ...hf, rootHtml, compositionHtml };

    const editorMeta: ProjectEditorMeta = {
      ...currentProject.editorMeta,
      clips: nextClipsMeta,
    };
    const newProject: Project = { ...currentProject, hf, editorMeta, updatedAt: Date.now() };
    set({
      project: newProject,
      tracks: newProject.editorMeta.tracks,
      selectedClipId: insertedId,
    });
    scheduleSave(get);
  },

  updateClip(id, patch) {
    const state = get();
    const p = state.project;
    if (!p) return;

    const existingMeta = p.editorMeta.clips[id] ?? {};

    // Linked audio clips cannot have their timing changed independently
    const isLinkedAudio = existingMeta.linkedCharacterClipId !== undefined;
    if (isLinkedAudio) {
      const {
        start: _s,
        duration: _d,
        trackIndex: _ti,
        laneIndex: _li,
        ...safePatch
      } = patch as Partial<MediaClip>;
      patch = safePatch as Partial<AnyClip>;
    }

    const newMeta = { ...existingMeta };

    if (patch.name !== undefined) newMeta.name = patch.name;
    if (patch.trackIndex !== undefined) newMeta.uiTrackIndex = patch.trackIndex;
    if (patch.laneIndex !== undefined) newMeta.uiLaneIndex = patch.laneIndex;

    let rootHtml = updateElementInHtml(p.hf.rootHtml, id, buildElementUpdates(patch));

    if (patch.start !== undefined) {
      const { elements } = parseStudioHtml(p.hf.rootHtml);
      const audioClipId = `audio_${id}`;
      const mainEl = elements.find((element) => element.id === id);
      const audioEl = elements.find((element) => element.id === audioClipId);
      if (mainEl && audioEl) {
        const startDelta = patch.start - mainEl.startTime;
        rootHtml = updateElementInHtml(rootHtml, audioClipId, {
          startTime: Math.max(0, audioEl.startTime + startDelta),
        });
      }
    }

    if (patch.kind === "character" || existingMeta.kind === "character") {
      const charPatch = patch as Partial<CharacterClip>;
      if ("poses" in charPatch) newMeta.poses = charPatch.poses;
      if ("motions" in charPatch) newMeta.motions = charPatch.motions;
      if ("visemes" in charPatch) newMeta.visemes = charPatch.visemes;
      if ("autoBlink" in charPatch) newMeta.autoBlink = charPatch.autoBlink;
      if ("lipSyncAudioId" in charPatch) newMeta.lipSyncAudioId = charPatch.lipSyncAudioId;
      if ("voiceLine" in charPatch) newMeta.voiceLine = charPatch.voiceLine;
    }

    const editorMeta: ProjectEditorMeta = {
      ...p.editorMeta,
      clips: { ...p.editorMeta.clips, [id]: newMeta },
    };
    const newProject: Project = {
      ...p,
      hf: { ...p.hf, rootHtml: normalizeProjectRootHtml(p.hf, rootHtml) },
      editorMeta,
      updatedAt: Date.now(),
    };
    set({ project: newProject });
    scheduleSave(get);
  },

  removeClip(id) {
    const state = get();
    const p = state.project;
    if (!p) return;

    const existingMeta = p.editorMeta.clips[id];
    const audioSiblingId = `audio_${id}`;
    const idsToRemove = new Set([id, audioSiblingId]);

    const newClipsMeta = Object.fromEntries(
      Object.entries(p.editorMeta.clips).filter(([clipId]) => !idsToRemove.has(clipId)),
    );
    let rootHtml = p.hf.rootHtml;
    for (const clipId of idsToRemove) {
      rootHtml = removeElementFromHtml(rootHtml, clipId);
    }
    rootHtml = normalizeProjectRootHtml(p.hf, rootHtml);

    const compositionHtml = { ...p.hf.compositionHtml };
    if (existingMeta?.kind === "character") {
      delete compositionHtml[`comp_${id}`];
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
      selectedClipId: idsToRemove.has(state.selectedClipId ?? "") ? null : state.selectedClipId,
    });
    scheduleSave(get);

    if (typeof window !== "undefined") {
      const removedMediaIds = new Set<string>();
      if (existingMeta?.mediaId) removedMediaIds.add(existingMeta.mediaId);
      if (existingMeta?.lipSyncAudioId) removedMediaIds.add(existingMeta.lipSyncAudioId);
      const audioMeta = p.editorMeta.clips[audioSiblingId];
      if (audioMeta?.mediaId) removedMediaIds.add(audioMeta.mediaId);

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

  updateRootHtml(html) {
    const p = get().project;
    if (!p) return;
    set({
      project: {
        ...p,
        hf: {
          ...p.hf,
          rootHtml: normalizeNativeHyperframesHtml(html, {
            width: p.hf.width,
            height: p.hf.height,
          }),
        },
        updatedAt: Date.now(),
      },
    });
    scheduleSave(get);
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
    if (project && project !== state.project) scheduleSave(get);
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
    if (project && project !== state.project) scheduleSave(get);
  },

  registerCharacterPreset(character) {
    const state = get();
    const characters = new Map(state.characters);
    characters.set(character.id, character);
    set({ characters });
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
    if (changed) set({ characters });
  },

  registerMotionPreset(preset) {
    const state = get();
    const motionPresets = new Map(state.motionPresets);
    motionPresets.set(preset.id, preset);
    set({ motionPresets });
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
    if (changed) set({ motionPresets });
  },

  addLane(trackIndex) {
    const p = get().project;
    if (!p) return;
    const newTracks = p.editorMeta.tracks.map((t, i) =>
      i === trackIndex ? { ...t, lanes: (t.lanes ?? 1) + 1 } : t,
    );
    const editorMeta = { ...p.editorMeta, tracks: newTracks };
    const newProject: Project = { ...p, editorMeta, updatedAt: Date.now() };
    set({ project: newProject, tracks: newTracks });
    scheduleSave(get);
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
      (c) =>
        c.trackIndex === trackIndex && (c.laneIndex ?? 0) === laneIndex && !c.linkedCharacterClipId,
    );
    if (laneHasClips) return;

    const newTracks = p.editorMeta.tracks.map((t, i) =>
      i === trackIndex ? { ...t, lanes: Math.max(1, laneCount - 1) } : t,
    );
    const newClipsMeta = Object.fromEntries(
      Object.entries(p.editorMeta.clips).map(([clipId, meta]) => {
        if (meta.uiTrackIndex !== trackIndex) return [clipId, meta];
        const currentLane = meta.uiLaneIndex ?? 0;
        if (meta.linkedCharacterClipId && currentLane === laneIndex)
          return [clipId, { ...meta, uiLaneIndex: Math.max(0, laneIndex - 1) }];
        if (currentLane > laneIndex) return [clipId, { ...meta, uiLaneIndex: currentLane - 1 }];
        return [clipId, meta];
      }),
    );

    const editorMeta = { ...p.editorMeta, tracks: newTracks, clips: newClipsMeta };
    const newProject: Project = { ...p, editorMeta, updatedAt: Date.now() };
    set({ project: newProject, tracks: newTracks });
    scheduleSave(get);
  },

  setProjectMeta(patch) {
    const p = get().project;
    if (!p) return;

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
    scheduleSave(get);
  },

  setZoom(z) {
    set({ zoom: Math.max(10, Math.min(400, z)) });
  },
}));

export type { StudioState };
export type CharacterClipT = CharacterClip;

// Re-export Track for files that still import it from store
export type { Track };
