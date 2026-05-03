// Editor state — current project, playhead, selection, transport.
// Persistence to Dexie happens via explicit save calls (autosave debounced).
import { create } from "zustand";
import { db, deleteMediaIfUnused, uid } from "./db";
import type { AnyClip, CharacterClip, MediaAsset, MediaClip, Project, Track } from "./types";

const DEFAULT_TRACKS: Track[] = [
  { id: uid(), name: "Characters", kind: "character", lanes: 1 },
  { id: uid(), name: "Overlay", kind: "overlay", lanes: 1 },
  { id: uid(), name: "Background", kind: "background", lanes: 1 },
  { id: uid(), name: "Audio", kind: "audio", lanes: 1 },
];

const TRACK_KIND_ORDER: Record<Track["kind"], number> = {
  character: 0,
  overlay: 1,
  background: 2,
  audio: 3,
};

/** Find the lowest free lane in a track at the given time range, or return a new lane index. */
export function pickFreeLane(
  clips: AnyClip[],
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
  // No free lane within current count → return next lane (caller will grow track).
  return maxLanes;
}

export function createBlankProject(name = "Untitled Movie"): Project {
  const now = Date.now();
  return {
    id: uid(),
    name,
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 30,
    tracks: DEFAULT_TRACKS.map((t) => ({ ...t, id: uid() })),
    clips: [],
    createdAt: now,
    updatedAt: now,
  };
}

interface StudioState {
  project: Project | null;
  playhead: number;
  playing: boolean;
  selectedClipId: string | null;
  zoom: number; // pixels per second on timeline

  // lifecycle
  loadProject: (id: string) => Promise<void>;
  newProject: () => Promise<void>;
  saveProject: () => Promise<void>;

  // transport
  setPlayhead: (t: number) => void;
  togglePlay: () => void;
  setPlaying: (p: boolean) => void;

  // selection
  selectClip: (id: string | null) => void;

  // clip ops
  addClip: (clip: AnyClip) => void;
  updateClip: (id: string, patch: Partial<AnyClip>) => void;
  removeClip: (id: string) => void;

  addMediaToTimeline: (asset: MediaAsset, trackIndex?: number) => void;

  // track lanes
  addLane: (trackIndex: number) => void;
  removeLane: (trackIndex: number, laneIndex: number) => void;
  normalizeTrackOrder: () => void;

  // project meta
  setProjectMeta: (
    patch: Partial<Pick<Project, "name" | "width" | "height" | "fps" | "duration">>,
  ) => void;
  setZoom: (z: number) => void;
}

const trackIndexFor = (project: Project, kind: Track["kind"]) =>
  Math.max(
    0,
    project.tracks.findIndex((t) => t.kind === kind),
  );

export function normalizeProjectTrackOrder(project: Project): Project {
  const ordered = project.tracks
    .map((track, oldIndex) => ({ track, oldIndex }))
    .sort(
      (a, b) =>
        TRACK_KIND_ORDER[a.track.kind] - TRACK_KIND_ORDER[b.track.kind] || a.oldIndex - b.oldIndex,
    );
  const changed = ordered.some((entry, newIndex) => entry.oldIndex !== newIndex);
  if (!changed) return project;
  const indexMap = new Map(ordered.map((entry, newIndex) => [entry.oldIndex, newIndex] as const));
  return {
    ...project,
    tracks: ordered.map((entry) => entry.track),
    clips: project.clips.map((clip) => ({
      ...clip,
      trackIndex: indexMap.get(clip.trackIndex) ?? clip.trackIndex,
    })),
    updatedAt: Date.now(),
  };
}

function isSpeechLinkedToCharacter(clip: AnyClip, character: CharacterClip) {
  return (
    clip.kind === "audio" &&
    ((clip as MediaClip).linkedCharacterClipId === character.id ||
      (!!character.lipSyncAudioId && clip.mediaId === character.lipSyncAudioId))
  );
}

function isLinkedSpeechAudioClip(clip: AnyClip) {
  return clip.kind === "audio" && !!(clip as MediaClip).linkedCharacterClipId;
}

let saveTimer: number | undefined;
const scheduleSave = (get: () => StudioState) => {
  if (typeof window === "undefined") return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void get().saveProject();
  }, 500);
};

export const useStudio = create<StudioState>((set, get) => ({
  project: null,
  playhead: 0,
  playing: false,
  selectedClipId: null,
  zoom: 60,

  async loadProject(id) {
    const project = await db.projects.get(id);
    if (project) {
      const normalized = normalizeProjectTrackOrder(project);
      if (normalized !== project) await db.projects.put(normalized);
      set({ project: normalized, playhead: 0, selectedClipId: null });
    }
  },
  async newProject() {
    const project = createBlankProject();
    await db.projects.put(project);
    set({ project, playhead: 0, selectedClipId: null });
  },
  async saveProject() {
    const p = get().project;
    if (!p) return;
    const updated = { ...p, updatedAt: Date.now() };
    await db.projects.put(updated);
  },

  setPlayhead(t) {
    const p = get().project;
    const max = p?.duration ?? 0;
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
    const p = get().project;
    if (!p) return;
    let project = p;
    let nextClip = clip;
    // Auto-assign laneIndex if not already set on the clip.
    if (clip.laneIndex === undefined) {
      const track = project.tracks[clip.trackIndex];
      const maxLanes = track?.lanes ?? 1;
      const lane = pickFreeLane(
        project.clips,
        clip.trackIndex,
        clip.start,
        clip.duration,
        maxLanes,
      );
      // Grow the track if no existing lane was free.
      if (lane >= maxLanes) {
        const tracks = project.tracks.map((t, i) =>
          i === clip.trackIndex ? { ...t, lanes: lane + 1 } : t,
        );
        project = { ...project, tracks };
      }
      nextClip = { ...clip, laneIndex: lane };
    }
    set({
      project: { ...project, clips: [...project.clips, nextClip], updatedAt: Date.now() },
      selectedClipId: nextClip.id,
    });
    scheduleSave(get);
  },
  updateClip(id, patch) {
    const p = get().project;
    if (!p) return;
    const existing = p.clips.find((c) => c.id === id);
    if (existing?.kind === "audio" && (existing as MediaClip).linkedCharacterClipId) {
      const {
        start: _start,
        duration: _duration,
        trackIndex: _trackIndex,
        laneIndex: _laneIndex,
        ...safePatch
      } = patch as Partial<MediaClip>;
      patch = safePatch as Partial<AnyClip>;
    }
    const startDelta =
      existing && patch.start !== undefined ? patch.start - existing.start : undefined;
    set({
      project: {
        ...p,
        clips: p.clips.map((c) =>
          c.id === id
            ? ({ ...c, ...patch } as AnyClip)
            : existing?.kind === "character" &&
                startDelta !== undefined &&
                c.kind === "audio" &&
                isSpeechLinkedToCharacter(c, existing as CharacterClip)
              ? ({
                  ...c,
                  start: Math.max(0, c.start + startDelta),
                  linkedCharacterClipId: existing.id,
                } as AnyClip)
              : c,
        ),
        updatedAt: Date.now(),
      },
    });
    scheduleSave(get);
  },
  removeClip(id) {
    const p = get().project;
    if (!p) return;
    const existing = p.clips.find((c) => c.id === id);
    const shouldRemove = (clip: AnyClip) =>
      clip.id === id ||
      (existing?.kind === "character" &&
        isSpeechLinkedToCharacter(clip, existing as CharacterClip));
    const selectedClipId = get().selectedClipId;
    const selectedWasRemoved = p.clips.some(
      (clip) => clip.id === selectedClipId && shouldRemove(clip),
    );
    const removedMediaIds = new Set(
      p.clips
        .filter(shouldRemove)
        .flatMap((clip) =>
          clip.kind === "audio"
            ? [(clip as MediaClip).mediaId]
            : clip.kind === "character" && clip.lipSyncAudioId
              ? [clip.lipSyncAudioId]
              : [],
        ),
    );
    set({
      project: { ...p, clips: p.clips.filter((c) => !shouldRemove(c)), updatedAt: Date.now() },
      selectedClipId: selectedWasRemoved ? null : selectedClipId,
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
    const p = get().project;
    if (!p) return;
    const playhead = get().playhead;
    let kindForTrack: Track["kind"] = "overlay";
    if (asset.kind === "audio") kindForTrack = "audio";
    else if (asset.kind === "image" || asset.kind === "video") {
      // default backgrounds when full-frame, otherwise overlay
      kindForTrack = "overlay";
    }
    const ti = trackIndex ?? trackIndexFor(p, kindForTrack);
    const dur = asset.duration && asset.duration > 0 ? asset.duration : 4;
    const naturalW = asset.width ?? 0;
    const naturalH = asset.height ?? 0;
    const isAudio = asset.kind === "audio";
    const w = isAudio ? 0 : naturalW || p.width;
    const h = isAudio ? 0 : naturalH || p.height;
    // Fit inside stage while preserving aspect for non-full media.
    let cw = w,
      ch = h;
    if (!isAudio && (cw > p.width || ch > p.height)) {
      const r = Math.min(p.width / cw, p.height / ch);
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
      x: isAudio ? 0 : Math.round((p.width - cw) / 2),
      y: isAudio ? 0 : Math.round((p.height - ch) / 2),
      width: cw,
      height: ch,
      rotation: 0,
      opacity: 1,
      zIndex: p.clips.length,
    };
    get().addClip(clip);
  },

  addLane(trackIndex) {
    const p = get().project;
    if (!p) return;
    const tracks = p.tracks.map((t, i) =>
      i === trackIndex ? { ...t, lanes: (t.lanes ?? 1) + 1 } : t,
    );
    set({ project: { ...p, tracks, updatedAt: Date.now() } });
    scheduleSave(get);
  },
  removeLane(trackIndex, laneIndex) {
    const p = get().project;
    if (!p) return;
    const track = p.tracks[trackIndex];
    const laneCount = Math.max(1, track?.lanes ?? 1);
    if (!track || laneCount <= 1) return;
    const laneHasClips = p.clips.some(
      (clip) =>
        clip.trackIndex === trackIndex &&
        (clip.laneIndex ?? 0) === laneIndex &&
        !isLinkedSpeechAudioClip(clip),
    );
    if (laneHasClips) return;
    const tracks = p.tracks.map((t, i) =>
      i === trackIndex ? { ...t, lanes: Math.max(1, laneCount - 1) } : t,
    );
    const clips = p.clips.map((clip) => {
      if (clip.trackIndex !== trackIndex) return clip;
      const currentLane = clip.laneIndex ?? 0;
      if (isLinkedSpeechAudioClip(clip) && currentLane === laneIndex) {
        return { ...clip, laneIndex: Math.max(0, laneIndex - 1) } as AnyClip;
      }
      if (currentLane > laneIndex) return { ...clip, laneIndex: currentLane - 1 } as AnyClip;
      return clip;
    });
    set({ project: { ...p, tracks, clips, updatedAt: Date.now() } });
    scheduleSave(get);
  },
  normalizeTrackOrder() {
    const p = get().project;
    if (!p) return;
    const normalized = normalizeProjectTrackOrder(p);
    if (normalized === p) return;
    set({ project: normalized });
    scheduleSave(get);
  },

  setProjectMeta(patch) {
    const p = get().project;
    if (!p) return;
    set({ project: { ...p, ...patch, updatedAt: Date.now() } });
    scheduleSave(get);
  },
  setZoom(z) {
    set({ zoom: Math.max(10, Math.min(400, z)) });
  },
}));

export type { StudioState };
export type CharacterClipT = CharacterClip;
