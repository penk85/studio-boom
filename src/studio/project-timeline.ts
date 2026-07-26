// Pure projection between editor timeline metadata and canonical HyperFrames elements.
import type { TimelineElement } from "@hyperframes/core";
import type { AnyClip, ClipEditorMeta, EditorClip, Project } from "./types";
import { deriveEditorClips } from "./types";
import { parseStudioHtml, type StudioTimelineElement } from "./hyperframes/html";
import { normalizeProjectRootHtml } from "./hyperframes/project-source";
import type { ClipKeyframeDisplayValues } from "./hyperframes/keyframes";

export function renderTrackIndexFor(uiTrackIndex = 0, uiLaneIndex = 0): number {
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
    ...clips.map((clip) => clip.trackIndex),
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

export function buildTimelineElement(
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
    volume: clip.volume,
    mediaStartTime: clip.mediaStartTime,
    sourceDuration: clip.sourceDuration,
  };
}

export function buildElementUpdates(patch: Partial<AnyClip>): Partial<StudioTimelineElement> {
  const updates: Partial<StudioTimelineElement> = {};

  if (patch.start !== undefined) updates.startTime = patch.start;
  if (patch.duration !== undefined) updates.duration = patch.duration;
  if (patch.x !== undefined) updates.x = patch.x;
  if (patch.y !== undefined) updates.y = patch.y;
  if (patch.zIndex !== undefined) updates.zIndex = patch.zIndex;
  if (patch.opacity !== undefined) updates.opacity = patch.opacity;
  if (patch.rotation !== undefined) updates.rotation = patch.rotation;
  if (patch.scaleX !== undefined) updates.scaleX = patch.scaleX;
  if (patch.scaleY !== undefined) updates.scaleY = patch.scaleY;
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.width !== undefined) updates.sourceWidth = patch.width;
  if (patch.height !== undefined) updates.sourceHeight = patch.height;
  if ("volume" in patch && patch.volume !== undefined) updates.volume = patch.volume;
  if ("mediaStartTime" in patch && patch.mediaStartTime !== undefined) {
    updates.mediaStartTime = patch.mediaStartTime;
  }
  if ("sourceDuration" in patch && patch.sourceDuration !== undefined) {
    updates.sourceDuration = patch.sourceDuration;
  }
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

export type LayerPlacement = "forward" | "backward" | "front" | "back";

export function resolveLayerAssignments(
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

export function hasDisplayValuePatch(patch: ClipKeyframeDisplayValues): boolean {
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
