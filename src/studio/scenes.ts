import { deriveEditorClips, type EditorClip, type Project, type SceneMeta } from "./types";

export const DEFAULT_SCENE_DURATION = 5;

export interface ProjectScene extends SceneMeta {
  index: number;
  start: number;
  duration: number;
  contentEnd: number;
  contentOverflow: number;
  clip: EditorClip;
}

export interface ProjectTimelineClip extends EditorClip {
  /** Scene that owns this clip. Null means the clip lives on the root project timeline. */
  sceneId: string | null;
  sceneIndex: number | null;
  /** Absolute project time where the owning scene starts. */
  sceneStart: number;
  /** Clip start inside its owning scene composition. */
  localStart: number;
}

export function sceneCompositionId(sceneId: string): string {
  return `comp_${sceneId}`;
}

export function isSceneClip(clip: EditorClip | null | undefined): boolean {
  return clip?.kind === "composition" && clip.compositionKind === "scene";
}

export function deriveProjectScenes(project: Project): ProjectScene[] {
  const clips = deriveEditorClips(project);
  const clipById = new Map(clips.map((clip) => [clip.id, clip] as const));
  const explicitScenes = (project.editorMeta.scenes ?? [])
    .map((scene, index): ProjectScene | null => {
      const clip = clipById.get(scene.id);
      if (!clip || !isSceneClip(clip) || !scene.compositionId) return null;
      const contentEnd = deriveSceneContentEnd(project, scene.compositionId);
      return {
        ...scene,
        index,
        start: clip.start,
        duration: clip.duration,
        contentEnd,
        contentOverflow: Math.max(0, contentEnd - clip.duration),
        clip,
      };
    })
    .filter((scene): scene is ProjectScene => scene !== null);

  if (explicitScenes.length > 0) return explicitScenes;

  return clips
    .filter((clip) => isSceneClip(clip) && clip.compositionId)
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
    .map((clip, index) => {
      const contentEnd = deriveSceneContentEnd(project, clip.compositionId!);
      return {
        id: clip.id,
        compositionId: clip.compositionId!,
        index,
        start: clip.start,
        duration: clip.duration,
        contentEnd,
        contentOverflow: Math.max(0, contentEnd - clip.duration),
        clip,
      };
    });
}

export function deriveSceneContentEnd(project: Project, compositionId: string): number {
  const rootHtml = project.hf.compositionHtml[compositionId];
  if (!rootHtml) return 0;
  const sceneProject = buildCompositionProject(project, compositionId, rootHtml);
  return deriveEditorClips(sceneProject).reduce(
    (end, clip) => Math.max(end, clip.start + clip.duration),
    0,
  );
}

export function deriveProjectTimelineClips(project: Project): ProjectTimelineClip[] {
  const scenes = deriveProjectScenes(project);
  const rootClips = deriveEditorClips(project)
    .filter((clip) => !isSceneClip(clip))
    .map(
      (clip): ProjectTimelineClip => ({
        ...clip,
        sceneId: null,
        sceneIndex: null,
        sceneStart: 0,
        localStart: clip.start,
      }),
    );

  const sceneClips = scenes.flatMap((scene) => {
    const rootHtml = project.hf.compositionHtml[scene.compositionId];
    if (!rootHtml) return [];
    const sceneProject = buildCompositionProject(project, scene.compositionId, rootHtml);
    return deriveEditorClips(sceneProject).map(
      (clip): ProjectTimelineClip => ({
        ...clip,
        start: scene.start + clip.start,
        sceneId: scene.id,
        sceneIndex: scene.index,
        sceneStart: scene.start,
        localStart: clip.start,
      }),
    );
  });

  return [...rootClips, ...sceneClips].sort(
    (a, b) =>
      a.trackIndex - b.trackIndex ||
      (a.laneIndex ?? 0) - (b.laneIndex ?? 0) ||
      a.start - b.start ||
      a.id.localeCompare(b.id),
  );
}

export function getProjectScene(project: Project, sceneId: string | null): ProjectScene | null {
  if (!sceneId) return null;
  return deriveProjectScenes(project).find((scene) => scene.id === sceneId) ?? null;
}

export function buildSceneEditingProject(project: Project, sceneId: string | null): Project {
  const scene = getProjectScene(project, sceneId);
  if (!scene) return project;
  const rootHtml = project.hf.compositionHtml[scene.compositionId];
  if (!rootHtml) return project;
  return {
    ...project,
    hf: {
      ...project.hf,
      id: scene.compositionId,
      name: scene.name ?? `Scene ${scene.index + 1}`,
      duration: scene.duration,
      rootHtml,
    },
  };
}

function buildCompositionProject(
  project: Project,
  compositionId: string,
  rootHtml: string,
): Project {
  return {
    ...project,
    hf: {
      ...project.hf,
      id: compositionId,
      name: compositionId,
      rootHtml,
    },
    editorMeta: {
      ...project.editorMeta,
      scenes: [],
    },
  };
}
