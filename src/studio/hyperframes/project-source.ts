// Pure project-source operations for scenes and nested HyperFrames compositions.
import type {
  ClipEditorMeta,
  EditorClip,
  HyperFramesProject,
  Project,
  ProjectEditorMeta,
} from "../types";
import { deriveEditorClips } from "../types";
import { uid } from "../db";
import { defaultCharacterCompositionId } from "../character/composition";
import {
  DEFAULT_SCENE_DURATION,
  buildSceneEditingProject,
  getProjectScene,
  sceneCompositionId,
} from "../scenes";
import { syncRootKeyframesHtml } from "./keyframes";
import { normalizeNativeHyperframesHtml } from "./native";
import { updateStudioElementInHtml } from "./html";
import {
  validateCompositionSourceHtml,
  type CompositionSourceValidation,
} from "./composition-source";
import { createRootCompositionHtml, updateRootCompositionHtml } from "./root-composition";

export function normalizeProjectRootHtml(hf: HyperFramesProject, html: string): string {
  return syncRootKeyframesHtml(
    normalizeNativeHyperframesHtml(html, {
      width: hf.width,
      height: hf.height,
    }),
  );
}

export function getEditingProject(state: {
  project: Project | null;
  activeSceneId: string | null;
}): Project | null {
  return state.project ? buildSceneEditingProject(state.project, state.activeSceneId) : null;
}

export function commitEditingRootHtml(
  project: Project,
  activeSceneId: string | null,
  html: string,
): Project {
  const scene = getProjectScene(project, activeSceneId);
  const normalized = normalizeProjectRootHtml(project.hf, html);
  if (!scene) {
    return {
      ...project,
      hf: {
        ...project.hf,
        rootHtml: normalized,
      },
      updatedAt: Date.now(),
    };
  }

  return {
    ...project,
    hf: {
      ...project.hf,
      compositionHtml: {
        ...project.hf.compositionHtml,
        [scene.compositionId]: normalized,
      },
    },
    updatedAt: Date.now(),
  };
}

export function syncSceneTimeline(
  project: Project,
  scenes: NonNullable<ProjectEditorMeta["scenes"]>,
): Project {
  const rootClips = deriveEditorClips(project);
  const clipById = new Map(rootClips.map((clip) => [clip.id, clip] as const));
  let rootHtml = project.hf.rootHtml;
  const compositionHtml = { ...project.hf.compositionHtml };
  let start = 0;

  scenes.forEach((scene, index) => {
    const clip = clipById.get(scene.id);
    const duration = Math.max(0.2, clip?.duration ?? DEFAULT_SCENE_DURATION);
    rootHtml = updateStudioElementInHtml(rootHtml, scene.id, {
      startTime: start,
      duration,
      zIndex: index,
      renderTrackIndex: 0,
      x: 0,
      y: 0,
      sourceWidth: project.hf.width,
      sourceHeight: project.hf.height,
    });
    const source =
      compositionHtml[scene.compositionId] ??
      createRootCompositionHtml(scene.compositionId, duration, project.hf.width, project.hf.height);
    compositionHtml[scene.compositionId] = updateRootCompositionHtml(source, {
      duration,
      width: project.hf.width,
      height: project.hf.height,
    });
    start += duration;
  });

  const duration = Math.max(0.2, start);
  rootHtml = updateRootCompositionHtml(rootHtml, {
    duration,
    width: project.hf.width,
    height: project.hf.height,
  });

  return {
    ...project,
    hf: {
      ...project.hf,
      duration,
      rootHtml: normalizeProjectRootHtml(project.hf, rootHtml),
      compositionHtml,
    },
    editorMeta: {
      ...project.editorMeta,
      scenes,
    },
    updatedAt: Date.now(),
  };
}

export function cloneSceneSource(
  project: Project,
  sourceCompositionId: string,
  targetCompositionId: string,
): {
  html: string;
  compositionHtml: Record<string, string>;
  clips: Record<string, ClipEditorMeta>;
} {
  const source =
    project.hf.compositionHtml[sourceCompositionId] ??
    createRootCompositionHtml(
      targetCompositionId,
      DEFAULT_SCENE_DURATION,
      project.hf.width,
      project.hf.height,
    );
  if (typeof DOMParser === "undefined") {
    return {
      html: source.split(sourceCompositionId).join(targetCompositionId),
      compositionHtml: {},
      clips: {},
    };
  }

  const doc = new DOMParser().parseFromString(source, "text/html");
  doc.documentElement.setAttribute("data-composition-id", targetCompositionId);
  const stage = doc.getElementById("stage");
  if (stage?.getAttribute("data-composition-id")) {
    stage.setAttribute("data-composition-id", targetCompositionId);
  }

  const idMap = new Map<string, string>();
  const compositionIdMap = new Map<string, string>([[sourceCompositionId, targetCompositionId]]);
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[id]"))) {
    if (el.id === "stage") continue;
    const oldId = el.id;
    const newId = uid();
    idMap.set(oldId, newId);
    el.id = newId;

    const nestedCompositionId = el.getAttribute("data-composition-id");
    if (nestedCompositionId && nestedCompositionId !== sourceCompositionId) {
      const nextCompositionId = clonedCompositionIdForClip(project.editorMeta.clips[oldId], newId);
      compositionIdMap.set(nestedCompositionId, nextCompositionId);
      el.setAttribute("data-composition-id", nextCompositionId);
      if (el.hasAttribute("data-composition-src")) {
        el.setAttribute("data-composition-src", `compositions/${nextCompositionId}.html`);
      }
      const iframe = el.querySelector<HTMLIFrameElement>("iframe[src]");
      if (iframe) iframe.setAttribute("src", `compositions/${nextCompositionId}.html`);
    }
  }

  let html = "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
  html = rewriteSourceIds(html, idMap, compositionIdMap);

  const compositionHtml: Record<string, string> = {};
  for (const [fromCompositionId, toCompositionId] of compositionIdMap) {
    if (fromCompositionId === sourceCompositionId) continue;
    const nestedSource = project.hf.compositionHtml[fromCompositionId];
    if (!nestedSource) continue;
    compositionHtml[toCompositionId] = rewriteSourceIds(
      nestedSource.split(fromCompositionId).join(toCompositionId),
      idMap,
      compositionIdMap,
    );
  }

  const clips: Record<string, ClipEditorMeta> = {};
  for (const [fromId, toId] of idMap) {
    const meta = project.editorMeta.clips[fromId];
    if (!meta) continue;
    const nextCompositionId = meta.compositionId
      ? (compositionIdMap.get(meta.compositionId) ?? meta.compositionId)
      : undefined;
    clips[toId] = {
      ...meta,
      ...(nextCompositionId ? { compositionId: nextCompositionId } : {}),
    };
  }

  return { html, compositionHtml, clips };
}

function clonedCompositionIdForClip(meta: ClipEditorMeta | undefined, clipId: string): string {
  if (meta?.compositionKind === "character") return defaultCharacterCompositionId(clipId);
  if (meta?.compositionKind === "scene") return sceneCompositionId(clipId);
  return `comp_${clipId}`;
}

function rewriteSourceIds(
  source: string,
  idMap: Map<string, string>,
  compositionIdMap: Map<string, string>,
): string {
  let next = source;
  for (const [from, to] of [...compositionIdMap, ...idMap]) {
    next = next.split(from).join(to);
  }
  return next;
}

function deriveCompositionEditorClips(project: Project, compositionId: string): EditorClip[] {
  const rootHtml = project.hf.compositionHtml[compositionId];
  if (!rootHtml) return [];
  return deriveEditorClips({
    ...project,
    hf: {
      ...project.hf,
      id: compositionId,
      rootHtml,
    },
    editorMeta: {
      ...project.editorMeta,
      scenes: [],
    },
  });
}

export interface CompositionTreeRefs {
  compositionIds: Set<string>;
  clipIds: Set<string>;
  mediaIds: Set<string>;
}

export function collectCompositionTreeRefs(
  project: Project,
  compositionId: string,
  refs: CompositionTreeRefs = {
    compositionIds: new Set(),
    clipIds: new Set(),
    mediaIds: new Set(),
  },
): CompositionTreeRefs {
  if (refs.compositionIds.has(compositionId)) return refs;
  refs.compositionIds.add(compositionId);

  for (const clip of deriveCompositionEditorClips(project, compositionId)) {
    refs.clipIds.add(clip.id);
    const meta = project.editorMeta.clips[clip.id];
    if (meta?.mediaId) refs.mediaIds.add(meta.mediaId);
    if (clip.mediaId) refs.mediaIds.add(clip.mediaId);
    if (clip.kind === "composition" && clip.compositionId) {
      collectCompositionTreeRefs(project, clip.compositionId, refs);
    }
  }

  return refs;
}

export type ValidCompositionSource = CompositionSourceValidation & {
  ok: true;
  html: string;
  compositionId: string;
};

export function assertValidCompositionSourceHtml(
  html: string,
  defaults: {
    compositionId: string;
    duration: number;
    width: number;
    height: number;
  },
  options: { expectedCompositionId?: string } = {},
): ValidCompositionSource {
  const result = validateCompositionSourceHtml(html, { ...defaults, isSubComposition: true });
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
