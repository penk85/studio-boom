// Editor state — project, selection, zoom. Playback owned by @hyperframes/studio.
// Persistence to Dexie happens via explicit save calls (autosave debounced).
import { create } from "zustand";
import { removeElementFromHtml } from "@hyperframes/core";
import { db, deleteMediaIfUnused, requireCurrentProjectShape, revokeAllMediaUrls, uid } from "./db";
import type {
  AnyClip,
  CompositionClip,
  ClipKeyframeSelection,
  ClipEditorMeta,
  HyperFramesProject,
  MediaClip,
  Project,
  ProjectEditorMeta,
  TextClip,
  Track,
  TrackKind,
  TrackMeta,
} from "./types";
import { characterSpeeches, deriveEditorClips, isCharacterCompositionClip } from "./types";
import { pruneHfAssets, registerHfAsset } from "./hyperframes/assets";
import { addStudioElementToHtml, updateStudioElementInHtml } from "./hyperframes/html";
import { projectEditLock } from "./project-lock";
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
  updateKeyframeProperty,
  upsertKeyframeProperty,
} from "./hyperframes/keyframes";
import {
  createRootCompositionHtml,
  updateRootCompositionHtml,
} from "./hyperframes/root-composition";
import {
  DEFAULT_SCENE_DURATION,
  buildSceneEditingProject,
  deriveProjectScenes,
  getProjectScene,
  sceneCompositionId,
} from "./scenes";
import {
  buildCharacterCompositionHtml,
  defaultCharacterCompositionId,
} from "./character/composition";
import {
  characterCompositionPatchRequiresRebuild,
  findEditorClipByCompositionId,
  isCharacterMeta,
  normalizeCharacterClipMeta,
  rebuildCharacterCompositionInProject,
  rebuildCharacterCompositions,
  resolveSpeechesForBuild,
} from "./character/project-compositions";
import {
  collectReferencedAssetIds,
  pruneCandidateHfAssets,
  refreshProjectAssets,
  registerCharacterAssets,
} from "./project-assets";
import {
  assertValidCompositionSourceHtml,
  cloneSceneSource,
  collectCompositionTreeRefs,
  commitEditingRootHtml,
  getEditingProject,
  normalizeProjectRootHtml,
  syncSceneTimeline,
  type ValidCompositionSource,
} from "./hyperframes/project-source";
import { cloneProject } from "./project-utils";
import {
  buildElementUpdates,
  buildTimelineElement,
  hasDisplayValuePatch,
  renderTrackIndexFor,
  resolveLayerAssignments,
  syncProjectRenderTrackIndices,
  type LayerPlacement,
} from "./project-timeline";
import type {
  ClipKeyframeValuePatch,
  HistoryEntry,
  ProjectMutationOptions,
  StudioState,
} from "./store-types";

export { characterCompositionPatchRequiresRebuild } from "./character/project-compositions";
export { syncProjectRenderTrackIndices } from "./project-timeline";
export type {
  ClipKeyframeValuePatch,
  ProjectMutationOptions,
  SaveStatus,
  StudioState,
} from "./store-types";

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
  const sceneId = uid();
  const compositionId = sceneCompositionId(sceneId);
  const tracks = createDefaultTracks();
  const duration = DEFAULT_SCENE_DURATION;
  const baseRootHtml = createRootCompositionHtml(projectId, duration);
  const sceneHtml = createRootCompositionHtml(compositionId, duration);
  const hf: HyperFramesProject = {
    id: projectId,
    name,
    width: 1920,
    height: 1080,
    fps: 30,
    duration,
    assets: [],
    rootHtml: baseRootHtml,
    compositionHtml: {
      [compositionId]: sceneHtml,
    },
  };
  const sceneElement = buildTimelineElement(
    {
      id: sceneId,
      kind: "composition",
      compositionKind: "scene",
      compositionId,
      name: "Scene",
      trackIndex: 0,
      laneIndex: 0,
      start: 0,
      duration,
      x: 0,
      y: 0,
      width: hf.width,
      height: hf.height,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
    },
    0,
    0,
  );
  const { html: rootWithScene, id: insertedSceneId } = addStudioElementToHtml(
    hf.rootHtml,
    sceneElement,
  );
  hf.rootHtml = normalizeProjectRootHtml(hf, rootWithScene);
  return {
    id: projectId,
    name,
    createdAt: now,
    updatedAt: now,
    hf,
    editorMeta: {
      tracks,
      clips: {
        [insertedSceneId]: {
          kind: "composition",
          compositionKind: "scene",
          compositionId,
          uiTrackIndex: 0,
          uiLaneIndex: 0,
        },
      },
      scenes: [{ id: insertedSceneId, compositionId }],
    },
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function createDefaultTracks(): TrackMeta[] {
  return DEFAULT_TRACKS.map((t) => ({ ...t, id: uid() }));
}

// ─── Store ────────────────────────────────────────────────────────────────────

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
  const state = get();
  const p = state.project;
  const editingProject = getEditingProject(state);
  if (!p || !editingProject) return;

  const assignments = resolveLayerAssignments(editingProject, id, placement);
  if (!assignments) return;

  get().checkpointHistory();

  let rootHtml = editingProject.hf.rootHtml;
  for (const [clipId, zIndex] of assignments) {
    rootHtml = updateStudioElementInHtml(rootHtml, clipId, { zIndex });
  }

  const newProject = commitEditingRootHtml(p, state.activeSceneId, rootHtml);
  set({ project: newProject });
  scheduleSave(get, set);
}

const trackIndexFor = (tracks: TrackMeta[], kind: TrackKind) =>
  Math.max(
    0,
    tracks.findIndex((t) => t.kind === kind),
  );

function createHistoryEntry(state: StudioState): HistoryEntry | null {
  if (!state.project) return null;
  return {
    project: cloneProject(state.project),
    selectedClipId: state.selectedClipId,
    selectedClipIds: state.selectedClipIds,
    selectedKeyframe: state.selectedKeyframe,
    activeSceneId: state.activeSceneId,
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
  selectedClipIds: [],
  selectedKeyframe: null,
  activeSceneId: null,
  selectedSpeechId: null,
  speechFocusRequest: 0,
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
    const alreadyOwned = projectEditLock.owns(id);
    await projectEditLock.acquire(id);
    try {
      const storedProject = (await db.projects.get(id)) as unknown;
      if (!storedProject) throw new Error(`Project "${id}" was not found.`);
      const currentProject = requireCurrentProjectShape(storedProject, id);

      const [allCharacters, allPresets, allMedia] = await Promise.all([
        db.characters.toArray(),
        db.motionPresets.toArray(),
        db.media.toArray(),
      ]);
      const characters = new Map(allCharacters.map((c) => [c.id, c]));
      const motionPresets = new Map(allPresets.map((p) => [p.id, p]));
      const mediaAssets = new Map(allMedia.map((m) => [m.id, m]));

      let project = rebuildCharacterCompositions(
        syncProjectRenderTrackIndices(currentProject),
        characters,
        mediaAssets,
        motionPresets,
      );
      if (project !== currentProject) {
        project = { ...project, updatedAt: Date.now() };
        await db.projects.put(project);
      }
      set({
        project,
        tracks: project.editorMeta.tracks,
        characters,
        motionPresets,
        mediaAssets,
        activeSceneId: deriveProjectScenes(project)[0]?.id ?? null,
        selectedClipId: null,
        selectedClipIds: [],
        selectedKeyframe: null,
        selectedSpeechId: null,
        historyPast: [],
        historyFuture: [],
        saveStatus: "saved",
        lastSavedAt: Date.now(),
        saveError: null,
      });
    } catch (error) {
      if (!alreadyOwned) await projectEditLock.release(id);
      throw error;
    }
  },

  async newProject() {
    const project = createBlankProject();
    await projectEditLock.acquire(project.id);
    try {
      await db.projects.put(project);
      set({
        project,
        tracks: project.editorMeta.tracks,
        characters: new Map(),
        motionPresets: new Map(),
        mediaAssets: new Map(),
        activeSceneId: deriveProjectScenes(project)[0]?.id ?? null,
        selectedClipId: null,
        selectedClipIds: [],
        selectedKeyframe: null,
        selectedSpeechId: null,
        historyPast: [],
        historyFuture: [],
        saveStatus: "saved",
        lastSavedAt: Date.now(),
        saveError: null,
      });
    } catch (error) {
      await projectEditLock.release(project.id);
      throw error;
    }
  },

  async saveProject(expectedGeneration) {
    const p = get().project;
    if (!p) return;
    projectEditLock.assertCanWrite(p.id);
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

  async closeProject() {
    const projectId = get().project?.id;
    if (!projectId) return;
    await get().saveProject();
    await projectEditLock.release(projectId);
    revokeAllMediaUrls();
    set({
      project: null,
      tracks: [],
      characters: new Map(),
      motionPresets: new Map(),
      mediaAssets: new Map(),
      selectedClipId: null,
      selectedClipIds: [],
      selectedKeyframe: null,
      activeSceneId: null,
      selectedSpeechId: null,
      historyPast: [],
      historyFuture: [],
      saveStatus: "saved",
      saveError: null,
      currentModal: null,
    });
  },

  refreshCharacterCompositions(options) {
    const state = get();
    if (!state.project) return null;
    const project = rebuildCharacterCompositions(
      state.project,
      state.characters,
      state.mediaAssets,
      state.motionPresets,
    );
    if (project === state.project) return state.project;
    if (options?.history !== false) get().checkpointHistory();
    set({ project, tracks: project.editorMeta.tracks });
    scheduleSave(get, set);
    return project;
  },

  selectClip(id) {
    // A plain select replaces the whole multi-selection with this single clip.
    set({
      selectedClipId: id,
      selectedClipIds: id ? [id] : [],
      selectedKeyframe: null,
    });
  },

  selectClips(ids) {
    const unique = Array.from(new Set(ids));
    set({
      selectedClipIds: unique,
      selectedClipId: unique.length > 0 ? unique[unique.length - 1]! : null,
      selectedKeyframe: null,
    });
  },

  toggleClipInSelection(id) {
    set((state) => {
      const present = state.selectedClipIds.includes(id);
      const nextIds = present
        ? state.selectedClipIds.filter((clipId) => clipId !== id)
        : [...state.selectedClipIds, id];
      return {
        selectedClipIds: nextIds,
        // Primary follows the just-added clip, or falls back to the last remaining one.
        selectedClipId: present ? (nextIds[nextIds.length - 1] ?? null) : id,
        selectedKeyframe: null,
      };
    });
  },

  clearSelection() {
    set({ selectedClipId: null, selectedClipIds: [], selectedKeyframe: null });
  },

  setActiveScene(sceneId) {
    const p = get().project;
    const validSceneId = sceneId && p ? (getProjectScene(p, sceneId)?.id ?? null) : null;
    set({
      activeSceneId: validSceneId,
      selectedClipId: null,
      selectedClipIds: [],
      selectedKeyframe: null,
      selectedSpeechId: null,
    });
  },

  selectSpeech(speechId) {
    set({ selectedSpeechId: speechId });
  },

  openSpeechSettings(clipId, speechId) {
    set((state) => ({
      selectedClipId: clipId,
      selectedKeyframe: null,
      selectedSpeechId: speechId,
      speechFocusRequest: state.speechFocusRequest + 1,
    }));
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
      activeSceneId: previous.activeSceneId,
      selectedClipId: previous.selectedClipId,
      selectedClipIds:
        previous.selectedClipIds ?? (previous.selectedClipId ? [previous.selectedClipId] : []),
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
      activeSceneId: next.activeSceneId,
      selectedClipId: next.selectedClipId,
      selectedClipIds: next.selectedClipIds ?? (next.selectedClipId ? [next.selectedClipId] : []),
      selectedKeyframe: next.selectedKeyframe,
      historyPast: trimHistory([...state.historyPast, current]),
      historyFuture: state.historyFuture.slice(0, -1),
    });
    scheduleSave(get, set);
  },

  async addClip(clip) {
    const state = get();
    const p = state.project;
    const initialActiveSceneId = state.activeSceneId;
    const targetSceneId =
      state.activeSceneId ??
      (clip.kind !== "audio" && !(clip.kind === "composition" && clip.compositionKind === "scene")
        ? p
          ? (deriveProjectScenes(p).at(0)?.id ?? null)
          : null
        : null);
    const editingProject = p ? buildSceneEditingProject(p, targetSceneId) : null;
    if (!p || !editingProject) return;

    let validatedCompositionSource: ValidCompositionSource | null = null;
    if (
      clip.kind === "composition" &&
      clip.compositionKind !== "character" &&
      clip.compositionHtml !== undefined
    ) {
      const compositionId = clip.compositionId ?? `comp_${clip.id}`;
      validatedCompositionSource = await assertValidCompositionSourceHtml(
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

    // HyperFrames 0.7 validation is asynchronous. Never commit a validated clip
    // against a project or scene that changed while the linter was running.
    if (get().project !== p || get().activeSceneId !== initialActiveSceneId) return;

    get().checkpointHistory();

    const currentClips = deriveEditorClips(editingProject);

    // Lane auto-assignment
    let nextClip = clip;
    if (clip.laneIndex === undefined) {
      const track = editingProject.editorMeta.tracks[clip.trackIndex];
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

    const currentState = get();
    const currentProject = currentState.project!;
    const targetProject = getEditingProject(currentState) ?? currentProject;
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
        const character = currentState.characters.get(meta.character.characterId);
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
          speeches: resolveSpeechesForBuild(meta.character, currentState.mediaAssets),
          mediaAssets: currentState.mediaAssets,
          motionPresets: currentState.motionPresets,
        });
        hf = registerCharacterAssets(hf, character, meta.character, currentState.mediaAssets);
      } else if (compositionClip.compositionHtml !== undefined) {
        const source =
          validatedCompositionSource ??
          (await assertValidCompositionSourceHtml(
            compositionClip.compositionHtml,
            {
              compositionId,
              duration: compositionClip.duration,
              width: compositionClip.width || currentProject.hf.width,
              height: compositionClip.height || currentProject.hf.height,
            },
            { expectedCompositionId: compositionId },
          ));
        compositionHtml[compositionId] = source.html;
      }
    } else if (nextClip.kind === "text") {
      const textClip = nextClip as TextClip;
      meta.kind = "text";
      meta.name = textClip.name;
    } else {
      const mediaClip = nextClip as MediaClip;
      meta.mediaId = mediaClip.mediaId;

      hf = registerHfAsset(hf, currentState.mediaAssets.get(mediaClip.mediaId));
    }

    const renderTrackIndex = renderTrackIndexFor(nextClip.trackIndex, nextClip.laneIndex ?? 0);
    const { html: nextRootHtml, id: insertedId } = addStudioElementToHtml(
      targetProject.hf.rootHtml,
      buildTimelineElement(nextClip, zIndex, renderTrackIndex),
    );
    const nextClipsMeta = { ...currentProject.editorMeta.clips, [insertedId]: meta };
    const rootHtml = normalizeProjectRootHtml(hf, nextRootHtml);

    hf = { ...hf, compositionHtml };

    const editorMeta: ProjectEditorMeta = {
      ...currentProject.editorMeta,
      clips: nextClipsMeta,
    };
    const newProject: Project = syncProjectRenderTrackIndices(
      commitEditingRootHtml(
        {
          ...currentProject,
          hf,
          editorMeta,
          updatedAt: Date.now(),
        },
        targetSceneId,
        rootHtml,
      ),
    );
    set({
      project: newProject,
      tracks: newProject.editorMeta.tracks,
      activeSceneId: targetSceneId ?? get().activeSceneId,
      selectedClipId: insertedId,
      selectedKeyframe: null,
    });
    scheduleSave(get, set);
  },

  addScene() {
    const p = get().project;
    if (!p) return;
    get().checkpointHistory();

    const sceneId = uid();
    const compositionId = sceneCompositionId(sceneId);
    const duration = DEFAULT_SCENE_DURATION;
    const scenes = deriveProjectScenes(p);
    const start = scenes.reduce((sum, scene) => sum + scene.duration, 0);
    const sceneElement = buildTimelineElement(
      {
        id: sceneId,
        kind: "composition",
        compositionKind: "scene",
        compositionId,
        name: "Scene",
        trackIndex: 0,
        laneIndex: 0,
        start,
        duration,
        x: 0,
        y: 0,
        width: p.hf.width,
        height: p.hf.height,
        rotation: 0,
        opacity: 1,
        zIndex: scenes.length,
      },
      scenes.length,
      0,
    );
    const { html, id } = addStudioElementToHtml(p.hf.rootHtml, sceneElement);
    const nextScenes = [...(p.editorMeta.scenes ?? []), { id, compositionId }];
    const project = syncSceneTimeline(
      {
        ...p,
        hf: {
          ...p.hf,
          rootHtml: normalizeProjectRootHtml(p.hf, html),
          compositionHtml: {
            ...p.hf.compositionHtml,
            [compositionId]: createRootCompositionHtml(
              compositionId,
              duration,
              p.hf.width,
              p.hf.height,
            ),
          },
        },
        editorMeta: {
          ...p.editorMeta,
          clips: {
            ...p.editorMeta.clips,
            [id]: {
              kind: "composition",
              compositionKind: "scene",
              compositionId,
              uiTrackIndex: 0,
              uiLaneIndex: 0,
            },
          },
          scenes: nextScenes,
        },
      },
      nextScenes,
    );
    set({
      project,
      tracks: project.editorMeta.tracks,
      activeSceneId: id,
      selectedClipId: null,
      selectedKeyframe: null,
    });
    scheduleSave(get, set);
  },

  duplicateScene(sceneId) {
    const p = get().project;
    if (!p) return;
    const scenes = deriveProjectScenes(p);
    const scene = scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) return;
    get().checkpointHistory();

    const nextSceneId = uid();
    const compositionId = sceneCompositionId(nextSceneId);
    const cloned = cloneSceneSource(p, scene.compositionId, compositionId);
    const sceneElement = buildTimelineElement(
      {
        id: nextSceneId,
        kind: "composition",
        compositionKind: "scene",
        compositionId,
        name: "Scene",
        trackIndex: 0,
        laneIndex: 0,
        start: scene.start + scene.duration,
        duration: scene.duration,
        x: 0,
        y: 0,
        width: p.hf.width,
        height: p.hf.height,
        rotation: 0,
        opacity: 1,
        zIndex: scene.index + 1,
      },
      scene.index + 1,
      0,
    );
    const { html, id } = addStudioElementToHtml(p.hf.rootHtml, sceneElement);
    const nextSceneMeta = { id, compositionId };
    const nextScenes = [...(p.editorMeta.scenes ?? [])];
    nextScenes.splice(scene.index + 1, 0, nextSceneMeta);
    const project = syncSceneTimeline(
      {
        ...p,
        hf: {
          ...p.hf,
          rootHtml: normalizeProjectRootHtml(p.hf, html),
          compositionHtml: {
            ...p.hf.compositionHtml,
            [compositionId]: cloned.html,
            ...cloned.compositionHtml,
          },
        },
        editorMeta: {
          ...p.editorMeta,
          clips: {
            ...p.editorMeta.clips,
            ...cloned.clips,
            [id]: {
              kind: "composition",
              compositionKind: "scene",
              compositionId,
              uiTrackIndex: 0,
              uiLaneIndex: 0,
            },
          },
          scenes: nextScenes,
        },
      },
      nextScenes,
    );
    set({
      project,
      tracks: project.editorMeta.tracks,
      activeSceneId: id,
      selectedClipId: null,
      selectedKeyframe: null,
    });
    scheduleSave(get, set);
  },

  removeScene(sceneId) {
    const state = get();
    const p = state.project;
    if (!p) return;
    const scenes = deriveProjectScenes(p);
    const scene = scenes.find((candidate) => candidate.id === sceneId);
    if (!scene || scenes.length <= 1) return;
    get().checkpointHistory();

    const nextSceneMetas = (p.editorMeta.scenes ?? [])
      .filter((candidate) => candidate.id !== scene.id)
      .map((candidate) => ({ ...candidate }));
    const removedRefs = collectCompositionTreeRefs(p, scene.compositionId);
    removedRefs.clipIds.add(scene.id);

    const newClipsMeta = Object.fromEntries(
      Object.entries(p.editorMeta.clips).filter(([clipId]) => !removedRefs.clipIds.has(clipId)),
    );
    const remainingCompositionIds = new Set(
      [
        ...nextSceneMetas.map((candidate) => candidate.compositionId),
        ...Object.values(newClipsMeta)
          .map((meta) => meta.compositionId)
          .filter((compositionId): compositionId is string => typeof compositionId === "string"),
      ].filter(Boolean),
    );
    const compositionHtml = { ...p.hf.compositionHtml };
    for (const compositionId of removedRefs.compositionIds) {
      if (!remainingCompositionIds.has(compositionId)) delete compositionHtml[compositionId];
    }

    const rootHtml = normalizeProjectRootHtml(p.hf, removeElementFromHtml(p.hf.rootHtml, scene.id));
    const projectWithScenes = syncSceneTimeline(
      {
        ...p,
        hf: {
          ...p.hf,
          rootHtml,
          compositionHtml,
        },
        editorMeta: {
          ...p.editorMeta,
          clips: newClipsMeta,
          scenes: nextSceneMetas,
        },
        updatedAt: Date.now(),
      },
      nextSceneMetas,
    );
    const referencedIds = collectReferencedAssetIds(newClipsMeta, state.characters);
    const project: Project = {
      ...projectWithScenes,
      hf: pruneHfAssets(projectWithScenes.hf, referencedIds),
      updatedAt: Date.now(),
    };
    const nextScenes = deriveProjectScenes(project);
    const fallbackScene =
      nextScenes[Math.min(scene.index, nextScenes.length - 1)] ?? nextScenes.at(-1) ?? null;

    set({
      project,
      tracks: project.editorMeta.tracks,
      activeSceneId:
        state.activeSceneId === scene.id ? (fallbackScene?.id ?? null) : state.activeSceneId,
      selectedClipId: removedRefs.clipIds.has(state.selectedClipId ?? "")
        ? null
        : state.selectedClipId,
      selectedKeyframe: removedRefs.clipIds.has(state.selectedKeyframe?.clipId ?? "")
        ? null
        : state.selectedKeyframe,
    });
    scheduleSave(get, set);

    if (typeof window !== "undefined" && removedRefs.mediaIds.size > 0) {
      window.setTimeout(() => {
        void get()
          .saveProject()
          .then(() =>
            Promise.all(
              Array.from(removedRefs.mediaIds).map((mediaId) =>
                deleteMediaIfUnused(mediaId, { internalOnly: true }),
              ),
            ),
          );
      }, 0);
    }
  },

  moveScene(sceneId, toIndex) {
    const p = get().project;
    if (!p) return;
    const scenes = [...(p.editorMeta.scenes ?? [])];
    const fromIndex = scenes.findIndex((scene) => scene.id === sceneId);
    if (fromIndex < 0) return;
    const targetIndex = Math.max(0, Math.min(scenes.length - 1, toIndex));
    if (fromIndex === targetIndex) return;
    get().checkpointHistory();

    const [scene] = scenes.splice(fromIndex, 1);
    if (!scene) return;
    scenes.splice(targetIndex, 0, scene);
    const project = syncSceneTimeline(p, scenes);
    set({ project, tracks: project.editorMeta.tracks });
    scheduleSave(get, set);
  },

  resizeScene(sceneId, duration, options) {
    const p = get().project;
    if (!p) return;
    const scene = getProjectScene(p, sceneId);
    if (!scene) return;
    if (options?.history !== false) get().checkpointHistory();

    const rootHtml = updateStudioElementInHtml(p.hf.rootHtml, scene.id, {
      duration: Math.max(0.2, duration),
    });
    const project = syncSceneTimeline(
      {
        ...p,
        hf: {
          ...p.hf,
          rootHtml: normalizeProjectRootHtml(p.hf, rootHtml),
        },
      },
      p.editorMeta.scenes ?? [],
    );
    set({ project, tracks: project.editorMeta.tracks });
    scheduleSave(get, set);
  },

  updateClip(id, patch, options) {
    const state = get();
    const p = state.project;
    const editingProject = getEditingProject(state);
    if (!p || !editingProject) return;
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

    const rootHtml = updateStudioElementInHtml(editingProject.hf.rootHtml, id, elementUpdates);

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
    let newProject: Project = commitEditingRootHtml(
      {
        ...p,
        editorMeta,
        updatedAt: Date.now(),
      },
      state.activeSceneId,
      rootHtml,
    );
    if (
      patch.start !== undefined ||
      patch.duration !== undefined ||
      patch.trackIndex !== undefined ||
      patch.laneIndex !== undefined
    ) {
      newProject = syncProjectRenderTrackIndices(newProject);
    }
    if (isCharacterMeta(newMeta) && characterCompositionPatchRequiresRebuild(patch)) {
      newProject = rebuildCharacterCompositionInProject(
        newProject,
        id,
        state.characters,
        state.mediaAssets,
        state.motionPresets,
      );
    }
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
    const editingProject = getEditingProject(state);
    if (!state.project || !editingProject) return;
    const clip = deriveEditorClips(editingProject).find((candidate) => candidate.id === clipId);
    if (!isCharacterCompositionClip(clip)) return;
    const asset = state.mediaAssets.get(audioId);
    if (!asset || asset.kind !== "audio") return;
    // Append a speech after the last one ends (clamped to the clip). Reuses
    // updateClip, which rebuilds the sub-composition (visemes hydrate from the
    // asset — no regeneration) and manifest-prunes any newly-unreferenced audio.
    const existing = characterSpeeches(clip.character);
    const lastEnd = existing.reduce(
      (max, speech) =>
        Math.max(
          max,
          speech.start + (speech.duration ?? state.mediaAssets.get(speech.audioId)?.duration ?? 0),
        ),
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
    const editingProject = getEditingProject(state);
    if (!state.project || !editingProject) return;
    const clip = deriveEditorClips(editingProject).find((candidate) => candidate.id === clipId);
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

  setSpeechVolume(clipId, speechId, volume, options) {
    const state = get();
    const editingProject = getEditingProject(state);
    if (!state.project || !editingProject) return;
    const clip = deriveEditorClips(editingProject).find((candidate) => candidate.id === clipId);
    if (!isCharacterCompositionClip(clip)) return;
    const clamped = Math.max(0, Math.min(1, volume));
    const speeches = characterSpeeches(clip.character).map((speech) =>
      speech.id === speechId ? { ...speech, volume: clamped } : speech,
    );
    get().updateClip(
      clipId,
      {
        character: { ...clip.character, speeches, lipSyncAudioId: undefined },
      } as Partial<CompositionClip>,
      options,
    );
  },

  trimSpeech(clipId, speechId, patch, options) {
    const state = get();
    const editingProject = getEditingProject(state);
    if (!state.project || !editingProject) return;
    const clip = deriveEditorClips(editingProject).find((candidate) => candidate.id === clipId);
    if (!isCharacterCompositionClip(clip)) return;
    const speeches = characterSpeeches(clip.character).map((speech) => {
      if (speech.id !== speechId) return speech;
      const asset = state.mediaAssets.get(speech.audioId);
      const source = asset?.duration && asset.duration > 0 ? asset.duration : undefined;
      const next = { ...speech };
      if (patch.start !== undefined) {
        next.start = Math.max(0, Math.min(clip.duration, patch.start));
      }
      if (patch.mediaStartTime !== undefined) {
        const max =
          source !== undefined ? Math.max(0, source - 0.1) : Math.max(0, patch.mediaStartTime);
        next.mediaStartTime = Math.max(0, Math.min(max, patch.mediaStartTime));
      }
      if (patch.duration !== undefined) {
        const ms = next.mediaStartTime ?? 0;
        const maxBySource = source !== undefined ? source - ms : Infinity;
        const maxByClip = clip.duration - (next.start ?? 0);
        const max = Math.min(maxBySource, maxByClip);
        next.duration = Math.max(0.1, Math.min(max, patch.duration));
      }
      return next;
    });
    get().updateClip(
      clipId,
      {
        character: { ...clip.character, speeches, lipSyncAudioId: undefined },
      } as Partial<CompositionClip>,
      options,
    );
  },

  removeSpeech(clipId, speechId) {
    const state = get();
    const editingProject = getEditingProject(state);
    if (!state.project || !editingProject) return;
    const clip = deriveEditorClips(editingProject).find((candidate) => candidate.id === clipId);
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
    const editingProject = getEditingProject(state);
    if (!p || !editingProject) return;
    get().checkpointHistory();

    const existingMeta = p.editorMeta.clips[id];

    const newClipsMeta = Object.fromEntries(
      Object.entries(p.editorMeta.clips).filter(([clipId]) => clipId !== id),
    );
    let rootHtml = removeElementFromHtml(editingProject.hf.rootHtml, id);
    rootHtml = normalizeProjectRootHtml(p.hf, rootHtml);

    const compositionHtml = { ...p.hf.compositionHtml };
    if (existingMeta?.kind === "composition") {
      delete compositionHtml[existingMeta.compositionId ?? `comp_${id}`];
    }

    const projectWithHtml = commitEditingRootHtml(
      {
        ...p,
        hf: { ...p.hf, compositionHtml },
        editorMeta: { ...p.editorMeta, clips: newClipsMeta },
        updatedAt: Date.now(),
      },
      state.activeSceneId,
      rootHtml,
    );
    const referencedIds = collectReferencedAssetIds(newClipsMeta, state.characters);

    const newProject: Project = {
      ...projectWithHtml,
      hf: pruneHfAssets(projectWithHtml.hf, referencedIds),
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

  toggleClipLock(id) {
    const p = get().project;
    if (!p) return;
    get().checkpointHistory();
    const existingMeta = p.editorMeta.clips[id] ?? {};
    const newMeta = { ...existingMeta, locked: !existingMeta.locked };
    const newProject: Project = {
      ...p,
      editorMeta: { ...p.editorMeta, clips: { ...p.editorMeta.clips, [id]: newMeta } },
      updatedAt: Date.now(),
    };
    set({ project: newProject });
    scheduleSave(get, set);
  },

  setTrackLock(trackIndex, locked) {
    const p = get().project;
    if (!p || !p.editorMeta.tracks[trackIndex]) return;
    get().checkpointHistory();
    const tracks = p.editorMeta.tracks.map((track, index) =>
      index === trackIndex ? { ...track, locked } : track,
    );
    const newProject: Project = {
      ...p,
      editorMeta: { ...p.editorMeta, tracks },
      updatedAt: Date.now(),
    };
    set({ project: newProject, tracks });
    scheduleSave(get, set);
  },

  isClipLocked(id) {
    const p = get().project;
    if (!p) return false;
    const meta = p.editorMeta.clips[id];
    if (meta?.locked) return true;
    const trackIndex = meta?.uiTrackIndex ?? 0;
    return !!p.editorMeta.tracks[trackIndex]?.locked;
  },

  upsertClipKeyframe(clipId, property, time, values, options) {
    const state = get();
    const p = state.project;
    const editingProject = getEditingProject(state);
    if (!p || !editingProject) return null;
    const clip = deriveEditorClips(editingProject).find((candidate) => candidate.id === clipId);
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

    const rootHtml = setClipKeyframesInRootHtml(
      editingProject.hf.rootHtml,
      clipId,
      result.keyframes,
    );
    const selectedKeyframe: ClipKeyframeSelection = {
      clipId,
      keyframeId: result.keyframeId,
      property,
    };
    set({
      project: commitEditingRootHtml(p, state.activeSceneId, rootHtml),
      selectedClipId: clipId,
      selectedKeyframe,
    });
    scheduleSave(get, set);
    return result.keyframeId;
  },

  updateClipKeyframe(selection, patch, options) {
    const state = get();
    const p = state.project;
    const editingProject = getEditingProject(state);
    if (!p || !editingProject) return;
    const clip = deriveEditorClips(editingProject).find(
      (candidate) => candidate.id === selection.clipId,
    );
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

    const rootHtml = setClipKeyframesInRootHtml(
      editingProject.hf.rootHtml,
      selection.clipId,
      result.keyframes,
    );
    set({
      project: commitEditingRootHtml(p, state.activeSceneId, rootHtml),
      selectedClipId: selection.clipId,
      selectedKeyframe: selection,
    });
    scheduleSave(get, set);
  },

  moveClipKeyframe(selection, time, options) {
    const state = get();
    const p = state.project;
    const editingProject = getEditingProject(state);
    if (!p || !editingProject) return;
    const clip = deriveEditorClips(editingProject).find(
      (candidate) => candidate.id === selection.clipId,
    );
    if (!clip || clip.kind === "audio") return;
    if (options?.history !== false) get().checkpointHistory();

    const result = moveKeyframeProperty(clip.keyframes, {
      keyframeId: selection.keyframeId,
      property: selection.property,
      time,
      duration: clip.duration,
    });
    if (!result.keyframeId) return;

    const rootHtml = setClipKeyframesInRootHtml(
      editingProject.hf.rootHtml,
      selection.clipId,
      result.keyframes,
    );
    const selectedKeyframe: ClipKeyframeSelection = {
      ...selection,
      keyframeId: result.keyframeId,
    };
    set({
      project: commitEditingRootHtml(p, state.activeSceneId, rootHtml),
      selectedClipId: selection.clipId,
      selectedKeyframe,
    });
    scheduleSave(get, set);
  },

  removeClipKeyframe(selection, options) {
    const state = get();
    const p = state.project;
    const editingProject = getEditingProject(state);
    if (!p || !editingProject) return;
    const clip = deriveEditorClips(editingProject).find(
      (candidate) => candidate.id === selection.clipId,
    );
    if (!clip || clip.kind === "audio") return;
    if (options?.history !== false) get().checkpointHistory();

    const keyframes = removeKeyframeProperty(
      clip.keyframes,
      selection.keyframeId,
      selection.property,
    );
    const rootHtml = setClipKeyframesInRootHtml(
      editingProject.hf.rootHtml,
      selection.clipId,
      keyframes,
    );
    set({
      project: commitEditingRootHtml(p, state.activeSceneId, rootHtml),
      selectedKeyframe: null,
    });
    scheduleSave(get, set);
  },

  addClipMotionStep(clipId, time, options) {
    const state = get();
    const p = state.project;
    const editingProject = getEditingProject(state);
    if (!p || !editingProject) return null;
    const clip = deriveEditorClips(editingProject).find((candidate) => candidate.id === clipId);
    if (!clip || clip.kind === "audio") return null;
    if (options?.history !== false) get().checkpointHistory();

    const result = addMotionStepToClip(clip, {
      time,
      createId: uid,
    });
    if (!result.selection) return null;

    const rootHtml = setClipMotionModelInRootHtml(
      editingProject.hf.rootHtml,
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
      project: commitEditingRootHtml(p, state.activeSceneId, rootHtml),
      selectedClipId: clipId,
      selectedKeyframe,
    });
    scheduleSave(get, set);
    return selectedKeyframe;
  },

  addClipMotionCheckpoint(clipId, motionId, time, options) {
    const state = get();
    const p = state.project;
    const editingProject = getEditingProject(state);
    if (!p || !editingProject) return null;
    const clip = deriveEditorClips(editingProject).find((candidate) => candidate.id === clipId);
    if (!clip || clip.kind === "audio") return null;
    if (options?.history !== false) get().checkpointHistory();

    const result = addMotionCheckpointToClip(clip, {
      motionId,
      time,
      createId: uid,
    });
    if (!result.selection) return null;

    const rootHtml = setClipMotionModelInRootHtml(
      editingProject.hf.rootHtml,
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
      project: commitEditingRootHtml(p, state.activeSceneId, rootHtml),
      selectedClipId: clipId,
      selectedKeyframe,
    });
    scheduleSave(get, set);
    return selectedKeyframe;
  },

  moveClipMotionStep(clipId, motionId, patch, options) {
    const state = get();
    const p = state.project;
    const editingProject = getEditingProject(state);
    if (!p || !editingProject) return null;
    const clip = deriveEditorClips(editingProject).find((candidate) => candidate.id === clipId);
    if (!clip || clip.kind === "audio") return null;
    if (options?.history !== false) get().checkpointHistory();

    const result = moveMotionStep(clip, { motionId, ...patch });
    if (!result.selection) return null;

    const rootHtml = setClipMotionModelInRootHtml(
      editingProject.hf.rootHtml,
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
      project: commitEditingRootHtml(p, state.activeSceneId, rootHtml),
      selectedClipId: clipId,
      selectedKeyframe,
    });
    scheduleSave(get, set);
    return selectedKeyframe;
  },

  moveClipMotionCheckpoint(clipId, motionId, checkpointId, time, options) {
    const state = get();
    const p = state.project;
    const editingProject = getEditingProject(state);
    if (!p || !editingProject) return null;
    const clip = deriveEditorClips(editingProject).find((candidate) => candidate.id === clipId);
    if (!clip || clip.kind === "audio") return null;
    if (options?.history !== false) get().checkpointHistory();

    const result = moveMotionCheckpoint(clip, { motionId, checkpointId, time });
    if (!result.selection) return null;

    const rootHtml = setClipMotionModelInRootHtml(
      editingProject.hf.rootHtml,
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
      project: commitEditingRootHtml(p, state.activeSceneId, rootHtml),
      selectedClipId: clipId,
      selectedKeyframe,
    });
    scheduleSave(get, set);
    return selectedKeyframe;
  },

  renameClipMotionStep(clipId, motionId, name, options) {
    const state = get();
    const p = state.project;
    const editingProject = getEditingProject(state);
    if (!p || !editingProject) return;
    const clip = deriveEditorClips(editingProject).find((candidate) => candidate.id === clipId);
    if (!clip || clip.kind === "audio") return;
    if (options?.history !== false) get().checkpointHistory();

    const motionSteps = renameMotionStep(clip, motionId, name);
    const rootHtml = setClipMotionModelInRootHtml(
      editingProject.hf.rootHtml,
      clipId,
      clip.keyframes,
      motionSteps,
    );
    set({
      project: commitEditingRootHtml(p, state.activeSceneId, rootHtml),
      selectedClipId: clipId,
    });
    scheduleSave(get, set);
  },

  setClipMotionStepPathStyle(clipId, motionId, pathStyle, options) {
    const state = get();
    const p = state.project;
    const editingProject = getEditingProject(state);
    if (!p || !editingProject) return;
    const clip = deriveEditorClips(editingProject).find((candidate) => candidate.id === clipId);
    if (!clip || clip.kind === "audio") return;
    if (options?.history !== false) get().checkpointHistory();

    const motionSteps = setMotionStepPathStyle(clip, motionId, pathStyle);
    const rootHtml = setClipMotionModelInRootHtml(
      editingProject.hf.rootHtml,
      clipId,
      clip.keyframes,
      motionSteps,
    );
    set({
      project: commitEditingRootHtml(p, state.activeSceneId, rootHtml),
      selectedClipId: clipId,
    });
    scheduleSave(get, set);
  },

  removeClipMotionStep(clipId, motionId, options) {
    const state = get();
    const p = state.project;
    const editingProject = getEditingProject(state);
    if (!p || !editingProject) return;
    const clip = deriveEditorClips(editingProject).find((candidate) => candidate.id === clipId);
    if (!clip || clip.kind === "audio") return;
    if (options?.history !== false) get().checkpointHistory();

    const result = removeMotionStep(clip, motionId);
    const rootHtml = setClipMotionModelInRootHtml(
      editingProject.hf.rootHtml,
      clipId,
      result.keyframes,
      result.motionSteps,
    );
    set({
      project: commitEditingRootHtml(p, state.activeSceneId, rootHtml),
      selectedClipId: clipId,
      selectedKeyframe: null,
    });
    scheduleSave(get, set);
  },

  removeClipMotionCheckpoint(clipId, motionId, checkpointId, options) {
    const state = get();
    const p = state.project;
    const editingProject = getEditingProject(state);
    if (!p || !editingProject) return;
    const clip = deriveEditorClips(editingProject).find((candidate) => candidate.id === clipId);
    if (!clip || clip.kind === "audio") return;
    if (options?.history !== false) get().checkpointHistory();

    const result = removeMotionCheckpoint(clip, motionId, checkpointId);
    const rootHtml = setClipMotionModelInRootHtml(
      editingProject.hf.rootHtml,
      clipId,
      result.keyframes,
      result.motionSteps,
    );
    set({
      project: commitEditingRootHtml(p, state.activeSceneId, rootHtml),
      selectedClipId: clipId,
      selectedKeyframe: null,
    });
    scheduleSave(get, set);
  },

  updateRootHtml(html, options) {
    const state = get();
    const p = state.project;
    if (!p) return;
    if (options?.history !== false) get().checkpointHistory();
    set({
      project: commitEditingRootHtml(p, state.activeSceneId, html),
    });
    scheduleSave(get, set);
  },

  async updateCompositionHtml(compositionId, html, options) {
    const p = get().project;
    if (!p) return;
    const clip = findEditorClipByCompositionId(p, compositionId);
    const source = await assertValidCompositionSourceHtml(
      html,
      {
        compositionId,
        duration: clip?.duration ?? p.hf.duration,
        width: clip?.width || p.hf.width,
        height: clip?.height || p.hf.height,
      },
      { expectedCompositionId: compositionId },
    );
    // Do not overwrite a newer project edit while source validation is pending.
    if (get().project !== p) return;
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
    const editingProject = getEditingProject(state);
    if (!p || !editingProject) return;
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
    const currentClips = deriveEditorClips(editingProject);
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
      mediaStartTime: 0,
      sourceDuration: asset.duration && asset.duration > 0 ? asset.duration : undefined,
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
    const editingProject = getEditingProject(state);
    if (!p || !editingProject) return;
    const track = p.editorMeta.tracks[trackIndex];
    const laneCount = Math.max(1, track?.lanes ?? 1);
    if (!track || laneCount <= 1) return;

    const currentClips = deriveEditorClips(editingProject);
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

// Re-export Track for files that still import it from store
export type { Track };
