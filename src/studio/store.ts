// Editor state — project, selection, zoom. Playback owned by @hyperframes/studio.
// Persistence to Dexie happens via explicit save calls (autosave debounced).
import { create } from "zustand";
import { removeElementFromHtml } from "@hyperframes/core";
import type { TimelineElement } from "@hyperframes/core";
import { db, deleteMediaIfUnused, isCurrentProjectShape, uid } from "./db";
import type {
  AnyClip,
  CharacterClip,
  CompositionClip,
  CharacterPreset,
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
import { deriveEditorClips } from "./types";
import { pruneHfAssets, registerHfAsset } from "./hyperframes/assets";
import {
  addStudioElementToHtml,
  parseStudioHtml,
  updateStudioElementInHtml,
  type StudioTimelineElement,
} from "./hyperframes/html";
import { normalizeNativeHyperframesHtml } from "./hyperframes/native";
import { validateCompositionSourceHtml } from "./hyperframes/composition-source";
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

function assertValidCompositionHtml(
  html: string,
  defaults: {
    compositionId: string;
    duration: number;
    width: number;
    height: number;
  },
): string {
  const result = validateCompositionSourceHtml(html, defaults);
  if (!result.ok || !result.html) {
    throw new Error(
      `Composition source is invalid:\n${result.errors.map((error) => `- ${error}`).join("\n")}`,
    );
  }
  return result.html;
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

  const maxTrackIndex = Math.max(project.editorMeta.tracks.length - 1, ...clips.map((c) => c.trackIndex));
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

  if (!changed) return project;
  return {
    ...project,
    hf: {
      ...project.hf,
      rootHtml: normalizeProjectRootHtml(
        project.hf,
        "<!DOCTYPE html>\n" + doc.documentElement.outerHTML,
      ),
    },
  };
}

function buildTimelineElement(
  clip: AnyClip,
  zIndex: number,
  renderTrackIndex: number,
): StudioTimelineElement {
  if (clip.kind === "character") {
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
      src: `compositions/comp_${clip.id}.html`,
      compositionId: `comp_${clip.id}`,
      sourceWidth: clip.width,
      sourceHeight: clip.height,
      rotation: clip.rotation,
    };
  }

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
}

export interface ProjectMutationOptions {
  history?: boolean;
}

interface StudioState {
  project: Project | null;
  tracks: TrackMeta[];

  // Preloaded reference data (for character editor, asset gallery)
  characters: Map<string, CharacterPreset>;
  motionPresets: Map<string, MotionPreset>;
  mediaAssets: Map<string, MediaAsset>;

  selectedClipId: string | null;
  zoom: number;
  historyPast: HistoryEntry[];
  historyFuture: HistoryEntry[];

  currentModal: ModalState;
  openModal: (modal: Exclude<ModalState, null>) => void;
  closeModal: () => void;

  loadProject: (id: string) => Promise<void>;
  newProject: () => Promise<void>;
  saveProject: () => Promise<void>;

  selectClip: (id: string | null) => void;
  checkpointHistory: () => void;
  undo: () => void;
  redo: () => void;

  addClip: (clip: AnyClip) => void;
  updateClip: (id: string, patch: Partial<AnyClip>, options?: ProjectMutationOptions) => void;
  removeClip: (id: string) => void;
  bringClipForward: (id: string) => void;
  sendClipBackward: (id: string) => void;
  bringClipToFront: (id: string) => void;
  sendClipToBack: (id: string) => void;

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
const scheduleSave = (get: () => StudioState) => {
  if (typeof window === "undefined") return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void get().saveProject();
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
  scheduleSave(get);
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
  zoom: 60,
  historyPast: [],
  historyFuture: [],
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

    let project = syncProjectRenderTrackIndices(storedProject);
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
      historyPast: [],
      historyFuture: [],
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
      historyPast: [],
      historyFuture: [],
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
      historyPast: state.historyPast.slice(0, -1),
      historyFuture: trimHistory([...state.historyFuture, current]),
    });
    scheduleSave(get);
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
      historyPast: trimHistory([...state.historyPast, current]),
      historyFuture: state.historyFuture.slice(0, -1),
    });
    scheduleSave(get);
  },

  addClip(clip) {
    const state = get();
    const p = state.project;
    if (!p) return;

    if (clip.kind === "composition" && clip.compositionHtml !== undefined) {
      const compositionId = clip.compositionId ?? `comp_${clip.id}`;
      assertValidCompositionHtml(clip.compositionHtml, {
        compositionId,
        duration: clip.duration,
        width: clip.width || p.hf.width,
        height: clip.height || p.hf.height,
      });
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

    if (nextClip.kind === "character") {
      const charClip = nextClip as CharacterClip;
      meta.characterId = charClip.characterId;
      meta.compositionKind = "character";
      meta.poses = charClip.poses;
      meta.visemes = charClip.visemes;
      meta.motions = charClip.motions;
      meta.autoBlink = charClip.autoBlink;
    } else if (nextClip.kind === "composition") {
      const compositionClip = nextClip as CompositionClip;
      const compositionId = compositionClip.compositionId ?? `comp_${compositionClip.id}`;
      meta.compositionId = compositionId;
      meta.compositionKind = compositionClip.compositionKind ?? "user-composition";
      if (compositionClip.compositionHtml !== undefined) {
        compositionHtml[compositionId] = assertValidCompositionHtml(compositionClip.compositionHtml, {
          compositionId,
          duration: compositionClip.duration,
          width: compositionClip.width || currentProject.hf.width,
          height: compositionClip.height || currentProject.hf.height,
        });
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
    });
    scheduleSave(get);
  },

  updateClip(id, patch, options) {
    const state = get();
    const p = state.project;
    if (!p) return;
    if (options?.history !== false) get().checkpointHistory();

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

    let rootHtml = updateStudioElementInHtml(p.hf.rootHtml, id, elementUpdates);

    if (patch.start !== undefined) {
      const { elements } = parseStudioHtml(p.hf.rootHtml);
      const audioClipId = `audio_${id}`;
      const mainEl = elements.find((element) => element.id === id);
      const audioEl = elements.find((element) => element.id === audioClipId);
      if (mainEl && audioEl) {
        const startDelta = patch.start - mainEl.startTime;
        rootHtml = updateStudioElementInHtml(rootHtml, audioClipId, {
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

    if (patch.kind === "composition" || existingMeta.kind === "composition") {
      const compositionPatch = patch as Partial<CompositionClip>;
      if ("compositionId" in compositionPatch)
        newMeta.compositionId = compositionPatch.compositionId;
      if ("compositionKind" in compositionPatch) {
        newMeta.compositionKind = compositionPatch.compositionKind;
      }
    }

    const editorMeta: ProjectEditorMeta = {
      ...p.editorMeta,
      clips: { ...p.editorMeta.clips, [id]: newMeta },
    };
    const newProject: Project = syncProjectRenderTrackIndices({
      ...p,
      hf: { ...p.hf, rootHtml: normalizeProjectRootHtml(p.hf, rootHtml) },
      editorMeta,
      updatedAt: Date.now(),
    });
    set({ project: newProject, tracks: newProject.editorMeta.tracks });
    scheduleSave(get);
  },

  repairTimelineLanes() {
    const p = get().project;
    if (!p) return false;
    const repaired = syncProjectRenderTrackIndices(p);
    if (repaired === p) return false;
    const newProject = { ...repaired, updatedAt: Date.now() };
    set({ project: newProject, tracks: newProject.editorMeta.tracks });
    scheduleSave(get);
    return true;
  },

  removeClip(id) {
    const state = get();
    const p = state.project;
    if (!p) return;
    get().checkpointHistory();

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
    if (existingMeta?.kind === "character" || existingMeta?.kind === "composition") {
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

  updateRootHtml(html, options) {
    const p = get().project;
    if (!p) return;
    if (options?.history !== false) get().checkpointHistory();
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

  updateCompositionHtml(compositionId, html, options) {
    const p = get().project;
    if (!p) return;
    const clip = deriveEditorClips(p).find((candidate) => candidate.compositionId === compositionId);
    const normalizedHtml = assertValidCompositionHtml(html, {
      compositionId,
      duration: clip?.duration ?? p.hf.duration,
      width: clip?.width || p.hf.width,
      height: clip?.height || p.hf.height,
    });
    if (options?.history !== false) get().checkpointHistory();
    set({
      project: {
        ...p,
        hf: {
          ...p.hf,
          compositionHtml: {
            ...p.hf.compositionHtml,
            [compositionId]: normalizedHtml,
          },
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
    get().checkpointHistory();
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
    get().checkpointHistory();

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
