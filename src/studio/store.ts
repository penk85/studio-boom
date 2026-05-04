// Editor state — current project, playhead, selection, transport.
// Persistence to Dexie happens via explicit save calls (autosave debounced).
import { create } from "zustand";
import { db, deleteMediaIfUnused, uid } from "./db";
import type {
  AnyClip,
  CharacterClip,
  CharacterPreset,
  ClipEditorMeta,
  EditorClip,
  HFAttrs,
  HFClip,
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
import { bakeCharacterClip, syncClipToHF } from "./export/bake";

// ─── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_TRACKS: TrackMeta[] = [
  { id: uid(), name: "Characters", kind: "character", lanes: 1 },
  { id: uid(), name: "Overlay", kind: "overlay", lanes: 1 },
  { id: uid(), name: "Background", kind: "background", lanes: 1 },
  { id: uid(), name: "Audio", kind: "audio", lanes: 1 },
];

const TRACK_KIND_ORDER: Record<TrackKind, number> = {
  character: 0,
  overlay: 1,
  background: 2,
  audio: 3,
};

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
  const hf: HyperFramesProject = {
    id: projectId,
    name,
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 30,
    assets: [],
    clips: [],
    compositions: [],
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

export function normalizeProjectTrackOrder(project: Project): Project {
  const editorMeta = project.editorMeta ?? { tracks: createDefaultTracks(), clips: {} };
  const tracks = editorMeta.tracks.length > 0 ? editorMeta.tracks : createDefaultTracks();
  const needsShapeRepair = editorMeta !== project.editorMeta || tracks !== editorMeta.tracks;
  const ordered = tracks
    .map((track, oldIndex) => ({ track, oldIndex }))
    .sort(
      (a, b) =>
        TRACK_KIND_ORDER[a.track.kind] - TRACK_KIND_ORDER[b.track.kind] || a.oldIndex - b.oldIndex,
    );
  const changed = ordered.some((entry, newIndex) => entry.oldIndex !== newIndex);
  if (!changed && !needsShapeRepair) return project;
  const indexMap = new Map(ordered.map((entry, newIndex) => [entry.oldIndex, newIndex] as const));
  const newTracks = ordered.map((entry) => entry.track);
  // Remap uiTrackIndex in editorMeta.clips
  const newClipsMeta = Object.fromEntries(
    Object.entries(editorMeta.clips ?? {}).map(([clipId, meta]) => [
      clipId,
      meta.uiTrackIndex !== undefined
        ? { ...meta, uiTrackIndex: indexMap.get(meta.uiTrackIndex) ?? meta.uiTrackIndex }
        : meta,
    ]),
  );
  return {
    ...project,
    editorMeta: { ...editorMeta, tracks: newTracks, clips: newClipsMeta },
    updatedAt: Date.now(),
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function createDefaultTracks(): TrackMeta[] {
  return DEFAULT_TRACKS.map((t) => ({ ...t, id: uid() }));
}

/** Allocate a unique HF data-track-index for a new clip. Single point of track-index allocation. */
function allocateHfTrackIndex(hf: HyperFramesProject): number {
  let max = -1;
  for (const clip of hf.clips) {
    const ti = clip.attrs["data-track-index"] as number | undefined;
    if (typeof ti === "number" && ti > max) max = ti;
  }
  return max + 1;
}

function deriveFromProject(project: Project | null) {
  if (!project) return { clips: [] as EditorClip[], tracks: [] as TrackMeta[] };
  return {
    clips: deriveEditorClips(project),
    tracks: project.editorMeta.tracks,
  };
}

/** Convert AnyClip to HFClip + ClipEditorMeta for the new data model. */
function anyClipToHF(
  clip: AnyClip,
  hfTrackIndex: number,
): { hfClip: HFClip; meta: ClipEditorMeta } {
  const tag: HFClip["tag"] =
    clip.kind === "audio"
      ? "audio"
      : clip.kind === "video"
        ? "video"
        : clip.kind === "image"
          ? "img"
          : "div";

  const attrs: HFAttrs = {
    "data-start": clip.start,
    "data-duration": clip.duration,
    "data-track-index": hfTrackIndex,
  };
  if (clip.kind === "character") {
    attrs["data-composition-id"] = `comp_${clip.id}`;
    attrs["data-composition-src"] = `compositions/comp_${clip.id}.html`;
    attrs["data-width"] = clip.width;
    attrs["data-height"] = clip.height;
  }
  if (clip.opacity !== undefined && clip.opacity !== 1) {
    attrs["data-opacity"] = clip.opacity;
  }

  const style: Record<string, string | number> = {
    position: "absolute",
    left: clip.x,
    top: clip.y,
    width: clip.width,
    height: clip.height,
    "z-index": clip.zIndex,
    opacity: 0, // HF initial state: main timeline reveals clips at data-start
  };

  const hfClip: HFClip = {
    id: clip.id,
    tag,
    attrs,
    style,
    mediaId: clip.kind !== "character" ? (clip as MediaClip).mediaId : undefined,
  };

  const meta: ClipEditorMeta = {
    name: clip.name,
    kind: clip.kind as ClipEditorMeta["kind"],
    uiTrackIndex: clip.trackIndex,
    uiLaneIndex: clip.laneIndex ?? 0,
  };

  if (clip.kind === "character") {
    const charClip = clip as CharacterClip;
    meta.characterId = charClip.characterId;
    meta.poses = charClip.poses;
    meta.visemes = charClip.visemes;
    meta.motions = charClip.motions;
    meta.autoBlink = charClip.autoBlink;
    meta.lipSyncAudioId = charClip.lipSyncAudioId;
    meta.voiceLine = charClip.voiceLine;
  }

  return { hfClip, meta };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCurrentProjectShape(project: unknown): project is Project {
  if (!isRecord(project) || !isRecord(project.hf) || !isRecord(project.editorMeta)) {
    return false;
  }
  return (
    typeof project.id === "string" &&
    typeof project.name === "string" &&
    Array.isArray(project.hf.assets) &&
    Array.isArray(project.hf.clips) &&
    Array.isArray(project.hf.compositions) &&
    Array.isArray(project.editorMeta.tracks) &&
    isRecord(project.editorMeta.clips)
  );
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface StudioState {
  project: Project | null;
  clips: EditorClip[]; // derived: deriveEditorClips(project)
  tracks: TrackMeta[]; // derived: project.editorMeta.tracks

  // Preloaded at project open — enables synchronous baking
  characters: Map<string, CharacterPreset>;
  motionPresets: Map<string, MotionPreset>;
  mediaAssets: Map<string, MediaAsset>;

  playhead: number;
  playing: boolean;
  selectedClipId: string | null;
  zoom: number;

  loadProject: (id: string) => Promise<void>;
  newProject: () => Promise<void>;
  saveProject: () => Promise<void>;

  setPlayhead: (t: number) => void;
  togglePlay: () => void;
  setPlaying: (p: boolean) => void;

  selectClip: (id: string | null) => void;

  addClip: (clip: AnyClip) => void;
  updateClip: (id: string, patch: Partial<AnyClip>) => void;
  removeClip: (id: string) => void;

  addMediaToTimeline: (asset: MediaAsset, trackIndex?: number) => void;

  addLane: (trackIndex: number) => void;
  removeLane: (trackIndex: number, laneIndex: number) => void;
  normalizeTrackOrder: () => void;

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
  clips: [],
  tracks: [],
  characters: new Map(),
  motionPresets: new Map(),
  mediaAssets: new Map(),
  playhead: 0,
  playing: false,
  selectedClipId: null,
  zoom: 60,

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

    const normalized = normalizeProjectTrackOrder(storedProject);
    if (normalized !== storedProject) await db.projects.put(normalized);

    set({
      project: normalized,
      ...deriveFromProject(normalized),
      characters,
      motionPresets,
      mediaAssets,
      playhead: 0,
      selectedClipId: null,
    });
  },

  async newProject() {
    const project = createBlankProject();
    await db.projects.put(project);
    set({
      project,
      ...deriveFromProject(project),
      characters: new Map(),
      motionPresets: new Map(),
      mediaAssets: new Map(),
      playhead: 0,
      selectedClipId: null,
    });
  },

  async saveProject() {
    const p = get().project;
    if (!p) return;
    const updated = { ...p, updatedAt: Date.now() };
    await db.projects.put(updated);
  },

  setPlayhead(t) {
    const p = get().project;
    const max = p?.hf.duration ?? 0;
    set({ playhead: Math.max(0, Math.min(max, t)) });
  },
  togglePlay() {
    set((s) => ({ playing: !s.playing }));
  },
  setPlaying(p) {
    set({ playing: p });
  },

  selectClip(id) {
    set({ selectedClipId: id });
  },

  addClip(clip) {
    const state = get();
    const p = state.project;
    if (!p) return;

    // Lane auto-assignment using current derived clips
    let nextClip = clip;
    if (clip.laneIndex === undefined) {
      const track = p.editorMeta.tracks[clip.trackIndex];
      const maxLanes = track?.lanes ?? 1;
      const lane = pickFreeLane(state.clips, clip.trackIndex, clip.start, clip.duration, maxLanes);
      if (lane >= maxLanes) {
        const newTracks = p.editorMeta.tracks.map((t, i) =>
          i === clip.trackIndex ? { ...t, lanes: lane + 1 } : t,
        );
        const editorMeta: ProjectEditorMeta = { ...p.editorMeta, tracks: newTracks };
        const partialProject = { ...p, editorMeta };
        // rebuild state with new tracks before continuing
        set({ project: partialProject, tracks: newTracks });
      }
      nextClip = { ...clip, laneIndex: lane };
    }

    const currentProject = get().project!;
    const hfTrackIndex = allocateHfTrackIndex(currentProject.hf);
    const { hfClip, meta } = anyClipToHF(nextClip, hfTrackIndex);

    let hf = syncClipToHF(currentProject.hf, hfClip);

    // Bake character clips if character is preloaded
    if (nextClip.kind === "character") {
      const charClip = nextClip as CharacterClip;
      const character = state.characters.get(charClip.characterId);
      if (character) {
        hf = bakeCharacterClip(
          hf,
          nextClip.id,
          meta,
          character,
          state.motionPresets,
          state.mediaAssets,
        );
      }
    }

    const editorMeta: ProjectEditorMeta = {
      ...currentProject.editorMeta,
      clips: { ...currentProject.editorMeta.clips, [nextClip.id]: meta },
    };
    const newProject: Project = { ...currentProject, hf, editorMeta, updatedAt: Date.now() };
    set({ project: newProject, ...deriveFromProject(newProject), selectedClipId: nextClip.id });
    scheduleSave(get);
  },

  updateClip(id, patch) {
    const state = get();
    const p = state.project;
    if (!p) return;

    const existingHfClip = p.hf.clips.find((c) => c.id === id);
    const existingMeta = p.editorMeta.clips[id] ?? {};

    // Linked audio clips (audio_<charClipId>) cannot have their timing changed independently
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

    if (!existingHfClip) return;

    // Build updated HFClip
    const newAttrs = { ...existingHfClip.attrs };
    const newStyle = { ...existingHfClip.style };
    const newMeta = { ...existingMeta };
    let needsBake = false;

    if (patch.start !== undefined) newAttrs["data-start"] = patch.start;
    if (patch.duration !== undefined) newAttrs["data-duration"] = patch.duration;
    if (patch.x !== undefined) newStyle["left"] = patch.x;
    if (patch.y !== undefined) newStyle["top"] = patch.y;
    if (patch.width !== undefined) {
      newStyle["width"] = patch.width;
      if (existingMeta.kind === "character") {
        newAttrs["data-width"] = patch.width;
        needsBake = true;
      }
    }
    if (patch.height !== undefined) {
      newStyle["height"] = patch.height;
      if (existingMeta.kind === "character") {
        newAttrs["data-height"] = patch.height;
        needsBake = true;
      }
    }
    if (patch.zIndex !== undefined) newStyle["z-index"] = patch.zIndex;
    if (patch.opacity !== undefined) newAttrs["data-opacity"] = patch.opacity;
    if (patch.name !== undefined) newMeta.name = patch.name;
    if (patch.trackIndex !== undefined) newMeta.uiTrackIndex = patch.trackIndex;
    if (patch.laneIndex !== undefined) newMeta.uiLaneIndex = patch.laneIndex;

    if (patch.kind === "character" || existingMeta.kind === "character") {
      const charPatch = patch as Partial<CharacterClip>;
      if (charPatch.poses !== undefined) {
        newMeta.poses = charPatch.poses;
        needsBake = true;
      }
      if (charPatch.motions !== undefined) {
        newMeta.motions = charPatch.motions;
        needsBake = true;
      }
      if (charPatch.visemes !== undefined) {
        newMeta.visemes = charPatch.visemes;
        needsBake = true;
      }
      if (charPatch.autoBlink !== undefined) {
        newMeta.autoBlink = charPatch.autoBlink;
        needsBake = true;
      }
      if (charPatch.lipSyncAudioId !== undefined) {
        newMeta.lipSyncAudioId = charPatch.lipSyncAudioId;
        needsBake = true;
      }
      if (charPatch.voiceLine !== undefined) newMeta.voiceLine = charPatch.voiceLine;
    }

    const updatedHfClip: HFClip = { ...existingHfClip, attrs: newAttrs, style: newStyle };
    let hf = syncClipToHF(p.hf, updatedHfClip);

    // Propagate start changes to sibling audio clip
    if (patch.start !== undefined) {
      const audioClipId = `audio_${id}`;
      const audioHfClip = hf.clips.find((c) => c.id === audioClipId);
      if (audioHfClip) {
        const startDelta = patch.start - ((existingHfClip.attrs["data-start"] as number) ?? 0);
        const oldAudioStart = (audioHfClip.attrs["data-start"] as number) ?? 0;
        hf = syncClipToHF(hf, {
          ...audioHfClip,
          attrs: { ...audioHfClip.attrs, "data-start": Math.max(0, oldAudioStart + startDelta) },
        });
      }
    }

    // Bake if character authoring state changed
    if (needsBake && existingMeta.kind === "character" && existingMeta.characterId) {
      const character = state.characters.get(existingMeta.characterId);
      if (character) {
        hf = bakeCharacterClip(hf, id, newMeta, character, state.motionPresets, state.mediaAssets);
      }
    }

    const editorMeta: ProjectEditorMeta = {
      ...p.editorMeta,
      clips: { ...p.editorMeta.clips, [id]: newMeta },
    };
    const newProject: Project = { ...p, hf, editorMeta, updatedAt: Date.now() };
    set({ project: newProject, ...deriveFromProject(newProject) });
    scheduleSave(get);
  },

  removeClip(id) {
    const state = get();
    const p = state.project;
    if (!p) return;

    const existingMeta = p.editorMeta.clips[id];
    const audioSiblingId = `audio_${id}`;

    // Collect media IDs to potentially garbage-collect
    const removedMediaIds = new Set<string>();
    const hfClip = p.hf.clips.find((c) => c.id === id);
    if (hfClip?.mediaId) removedMediaIds.add(hfClip.mediaId);
    if (existingMeta?.lipSyncAudioId) removedMediaIds.add(existingMeta.lipSyncAudioId);

    const idsToRemove = new Set([id, audioSiblingId]);

    const newClips = p.hf.clips.filter((c) => !idsToRemove.has(c.id));
    const newCompositions = p.hf.compositions.filter((c) => c.sourceClipId !== id);
    const newHf: HyperFramesProject = { ...p.hf, clips: newClips, compositions: newCompositions };

    const newClipsMeta = Object.fromEntries(
      Object.entries(p.editorMeta.clips).filter(([clipId]) => !idsToRemove.has(clipId)),
    );

    const selectedClipId = state.selectedClipId;
    const newProject: Project = {
      ...p,
      hf: newHf,
      editorMeta: { ...p.editorMeta, clips: newClipsMeta },
      updatedAt: Date.now(),
    };

    set({
      project: newProject,
      ...deriveFromProject(newProject),
      selectedClipId: idsToRemove.has(selectedClipId ?? "") ? null : selectedClipId,
    });
    scheduleSave(get);

    if (removedMediaIds.size > 0 && typeof window !== "undefined") {
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
  },

  addMediaToTimeline(asset, trackIndex) {
    const state = get();
    const p = state.project;
    if (!p) return;
    const playhead = state.playhead;
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
    const clip: MediaClip = {
      id: uid(),
      kind: asset.kind,
      mediaId: asset.id,
      name: asset.name,
      trackIndex: ti,
      start: playhead,
      duration: dur,
      x: isAudio ? 0 : Math.round((stageW - cw) / 2),
      y: isAudio ? 0 : Math.round((stageH - ch) / 2),
      width: cw,
      height: ch,
      rotation: 0,
      opacity: 1,
      zIndex: state.clips.length,
    };
    get().addClip(clip);
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

    const laneHasClips = state.clips.some(
      (c) =>
        c.trackIndex === trackIndex && (c.laneIndex ?? 0) === laneIndex && !c.linkedCharacterClipId,
    );
    if (laneHasClips) return;

    const newTracks = p.editorMeta.tracks.map((t, i) =>
      i === trackIndex ? { ...t, lanes: Math.max(1, laneCount - 1) } : t,
    );

    // Remap clip laneIndex in editorMeta
    const newClipsMeta = Object.fromEntries(
      Object.entries(p.editorMeta.clips).map(([clipId, meta]) => {
        if (meta.uiTrackIndex !== trackIndex) return [clipId, meta];
        const currentLane = meta.uiLaneIndex ?? 0;
        if (meta.linkedCharacterClipId && currentLane === laneIndex) {
          return [clipId, { ...meta, uiLaneIndex: Math.max(0, laneIndex - 1) }];
        }
        if (currentLane > laneIndex) return [clipId, { ...meta, uiLaneIndex: currentLane - 1 }];
        return [clipId, meta];
      }),
    );

    const editorMeta = { ...p.editorMeta, tracks: newTracks, clips: newClipsMeta };
    const newProject: Project = { ...p, editorMeta, updatedAt: Date.now() };
    set({ project: newProject, ...deriveFromProject(newProject) });
    scheduleSave(get);
  },

  normalizeTrackOrder() {
    const p = get().project;
    if (!p) return;
    const normalized = normalizeProjectTrackOrder(p);
    if (normalized === p) return;
    set({ project: normalized, ...deriveFromProject(normalized) });
    scheduleSave(get);
  },

  setProjectMeta(patch) {
    const p = get().project;
    if (!p) return;
    const newHf = { ...p.hf, ...patch };
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
