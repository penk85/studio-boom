// Public Zustand state and action contract, separated from the store implementation.
import type {
  AnyClip,
  CharacterPreset,
  ClipKeyframeProperty,
  ClipKeyframeSelection,
  HyperFramesProject,
  MediaAsset,
  MotionPreset,
  Project,
  TrackMeta,
} from "./types";
import type { ClipKeyframeDisplayValues, ClipMotionEndpoint } from "./hyperframes/keyframes";
import type { ClipPlacement, LibraryDragItem } from "./library-items";

export type ModalState =
  | null
  | { type: "character-editor"; characterId: string }
  | { type: "presets" };

export interface HistoryEntry {
  project: Project;
  selectedClipId: string | null;
  selectedClipIds: string[];
  selectedKeyframe: ClipKeyframeSelection | null;
  activeSceneId: string | null;
}

export interface ProjectMutationOptions {
  history?: boolean;
}

export interface RootHtmlMutationOptions extends ProjectMutationOptions {
  /**
   * Which document the HTML belongs to.
   *
   * `"editing"` (default) writes into the active scene's composition, matching
   * the scene-scoped editing model. `"film"` writes the project root even when a
   * scene is active — the Stage always previews the whole film, so in-iframe
   * edits synced back from the picker are always film-root edits.
   */
  scope?: "editing" | "film";
}

export type SaveStatus = "saved" | "saving" | "error";

export type ClipKeyframeValuePatch = ClipKeyframeDisplayValues & {
  ease?: string;
};

export interface StudioState {
  project: Project | null;
  tracks: TrackMeta[];

  characters: Map<string, CharacterPreset>;
  motionPresets: Map<string, MotionPreset>;
  mediaAssets: Map<string, MediaAsset>;

  /** The primary/active clip — drives the single-clip Inspector and legacy single-select UI. */
  selectedClipId: string | null;
  /** The full multi-selection set. Always contains selectedClipId when non-empty. */
  selectedClipIds: string[];
  selectedKeyframe: ClipKeyframeSelection | null;
  activeSceneId: string | null;
  selectedSpeechId: string | null;
  speechFocusRequest: number;
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
  closeProject: () => Promise<void>;
  refreshCharacterCompositions: (options?: ProjectMutationOptions) => Project | null;

  selectClip: (id: string | null) => void;
  selectClips: (ids: string[]) => void;
  toggleClipInSelection: (id: string) => void;
  clearSelection: () => void;
  setActiveScene: (sceneId: string | null) => void;
  selectKeyframe: (selection: ClipKeyframeSelection | null) => void;
  selectSpeech: (speechId: string | null) => void;
  openSpeechSettings: (clipId: string, speechId: string) => void;
  checkpointHistory: () => void;
  undo: () => void;
  redo: () => void;

  addClip: (clip: AnyClip) => Promise<void>;
  addScene: () => void;
  duplicateScene: (sceneId: string) => void;
  removeScene: (sceneId: string) => void;
  moveScene: (sceneId: string, toIndex: number) => void;
  resizeScene: (sceneId: string, duration: number, options?: ProjectMutationOptions) => void;
  updateClip: (id: string, patch: Partial<AnyClip>, options?: ProjectMutationOptions) => void;
  attachVoiceToCharacter: (clipId: string, audioId: string) => void;
  moveSpeech: (
    clipId: string,
    speechId: string,
    start: number,
    options?: ProjectMutationOptions,
  ) => void;
  setSpeechVolume: (
    clipId: string,
    speechId: string,
    volume: number,
    options?: ProjectMutationOptions,
  ) => void;
  trimSpeech: (
    clipId: string,
    speechId: string,
    patch: { start?: number; mediaStartTime?: number; duration?: number },
    options?: ProjectMutationOptions,
  ) => void;
  removeSpeech: (clipId: string, speechId: string) => void;
  rebuildClipsUsingAudio: (audioId: string) => void;
  removeClip: (id: string) => void;
  bringClipForward: (id: string) => void;
  sendClipBackward: (id: string) => void;
  bringClipToFront: (id: string) => void;
  sendClipToBack: (id: string) => void;
  toggleClipLock: (id: string) => void;
  setTrackLock: (trackIndex: number, locked: boolean) => void;
  isClipLocked: (id: string) => boolean;
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

  updateRootHtml: (html: string, options?: RootHtmlMutationOptions) => void;
  /**
   * Applies a named Move (Fade in, Pop, Slow zoom…) to a clip. Writes ordinary
   * Move data, so the result is editable point-by-point afterwards.
   */
  applyEffectPreset: (
    clipId: string,
    presetId: string,
    options?: ProjectMutationOptions,
  ) => ClipKeyframeSelection | null;
  /**
   * Places a Library entry (media, text block, or character) on the timeline.
   * One path for both the Library's buttons and drag-and-drop, so a dropped clip
   * and a clicked clip are built identically. Resolves to the new clip's id so
   * callers can act on exactly what they added, or null if nothing was placed.
   */
  addLibraryItem: (item: LibraryDragItem, placement?: ClipPlacement) => Promise<string | null>;
  updateCompositionHtml: (
    compositionId: string,
    html: string,
    options?: ProjectMutationOptions,
  ) => Promise<void>;
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
  setZoom: (zoom: number) => void;
}
