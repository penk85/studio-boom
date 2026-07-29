// Pure Timeline clip projection, composition-outline, and lane helpers.

import {
  extractCompositionOutline,
  type CompositionOutlineItem,
} from "../hyperframes/composition-outline";
import { validateCompositionSourceHtmlSync } from "../hyperframes/composition-source";
import type { AnyClip, EditorClip, Project } from "../types";
import { isCharacterCompositionClip } from "../types";
import type { ProjectTimelineClip } from "../scenes";
import { TRACK_HEIGHT } from "./timeline-constants";

export function buildCompositionSourceErrors(
  project: Project,
  clips: EditorClip[],
): Map<string, string[]> {
  const errorsByClipId = new Map<string, string[]>();
  for (const clip of clips) {
    if (clip.kind !== "composition" || !clip.compositionId) continue;
    const source = project.hf.compositionHtml[clip.compositionId];
    if (!source) {
      errorsByClipId.set(clip.id, [`Missing source for composition "${clip.compositionId}".`]);
      continue;
    }
    const result = validateCompositionSourceHtmlSync(source, {
      compositionId: clip.compositionId,
      duration: clip.duration,
      width: clip.width || project.hf.width,
      height: clip.height || project.hf.height,
      isSubComposition: true,
    });
    if (!result.ok) errorsByClipId.set(clip.id, result.errors);
  }
  return errorsByClipId;
}

export function buildCompositionOutlines(
  project: Project,
  clips: EditorClip[],
): Map<string, CompositionOutlineItem[]> {
  const outlines = new Map<string, CompositionOutlineItem[]>();
  for (const clip of clips) {
    if (clip.kind !== "composition" || isCharacterCompositionClip(clip) || !clip.compositionId) {
      continue;
    }
    const source = project.hf.compositionHtml[clip.compositionId];
    if (!source) continue;
    const outline = extractCompositionOutline(source, {
      compositionId: clip.compositionId,
      duration: clip.duration,
    });
    if (outline.length > 0) outlines.set(clip.id, outline);
  }
  return outlines;
}

export function toSceneLocalClipPatch(
  clip: ProjectTimelineClip,
  patch: Partial<AnyClip>,
): Partial<AnyClip> {
  if (!clip.sceneId || patch.start === undefined) return patch;
  return {
    ...patch,
    start: Math.max(0, patch.start - clip.sceneStart),
  };
}

export function isKeyframeEditableClip(clip: EditorClip): boolean {
  return clip.kind !== "audio";
}

export function nearestLaneIndex(laneTops: number[], y: number) {
  if (laneTops.length === 0) return 0;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  laneTops.forEach((top, index) => {
    const distance = Math.abs(y - (top + TRACK_HEIGHT / 2));
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });
  return bestIndex;
}
