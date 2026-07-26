// Rebuilds canonical character compositions from project metadata and library data.
import type {
  AnyClip,
  CharacterClipMeta,
  CharacterPreset,
  ClipEditorMeta,
  EditorClip,
  HyperFramesProject,
  MediaAsset,
  MotionPreset,
  Project,
} from "../types";
import { characterSpeeches, deriveEditorClips } from "../types";
import { buildSceneEditingProject, deriveProjectScenes } from "../scenes";
import { refreshProjectAssets, registerCharacterAssets } from "../project-assets";
import { buildCharacterCompositionHtml, type ResolvedSpeech } from "./composition";
import { CharacterPinRigError } from "./rig-v2";

/** Remove retired renderer metadata before a character clip is persisted or rebuilt. */
export function normalizeCharacterClipMeta(meta: CharacterClipMeta): CharacterClipMeta {
  const { renderer: _legacyRenderer, ...rest } = meta;
  return {
    ...rest,
    poses: meta.poses ?? {},
  };
}

export function isCharacterMeta(meta: ClipEditorMeta | undefined): meta is ClipEditorMeta & {
  kind: "composition";
  compositionKind: "character";
  compositionId: string;
  character: CharacterClipMeta;
} {
  return (
    meta?.kind === "composition" &&
    meta.compositionKind === "character" &&
    typeof meta.compositionId === "string" &&
    !!meta.character?.characterId
  );
}

/**
 * Resolve a character's placed speeches against reusable audio asset timing.
 * Legacy single-voice clips fall back to clip-level visemes when necessary.
 */
export function resolveSpeechesForBuild(
  characterMeta: CharacterClipMeta,
  mediaAssets: Map<string, MediaAsset>,
): ResolvedSpeech[] {
  return characterSpeeches(characterMeta).map((speech) => {
    const asset = mediaAssets.get(speech.audioId);
    const legacyVisemes =
      speech.audioId === characterMeta.lipSyncAudioId ? (characterMeta.visemes ?? []) : [];
    const sourceDuration = asset?.duration ?? 0;
    return {
      audioId: speech.audioId,
      start: speech.start,
      duration: speech.duration ?? sourceDuration,
      visemes: asset?.visemes ?? legacyVisemes,
      volume: speech.volume,
      mediaStartTime: speech.mediaStartTime,
    };
  });
}

export function rebuildCharacterCompositionInProject(
  project: Project,
  clipId: string,
  characters: Map<string, CharacterPreset>,
  mediaAssets: Map<string, MediaAsset>,
  motionPresets: Map<string, MotionPreset>,
): Project {
  const meta = project.editorMeta.clips[clipId];
  if (!isCharacterMeta(meta)) return project;
  const clip = findEditorClipInProject(project, clipId);
  if (!clip) return project;
  const character = characters.get(meta.character.characterId);
  if (!character) return project;

  const characterMeta = normalizeCharacterClipMeta(meta.character);
  let html: string;
  try {
    html = buildCharacterCompositionHtml({
      compositionId: meta.compositionId,
      clipId,
      duration: clip.duration,
      width: clip.width || project.hf.width,
      height: clip.height || project.hf.height,
      character,
      meta: characterMeta,
      speeches: resolveSpeechesForBuild(characterMeta, mediaAssets),
      mediaAssets,
      motionPresets,
    });
  } catch (error) {
    if (!(error instanceof CharacterPinRigError)) throw error;
    console.warn("Skipped character composition rebuild because the rig is incomplete", {
      clipId,
      characterId: character.id,
      issues: error.issues,
    });
    return project;
  }
  let hf: HyperFramesProject =
    project.hf.compositionHtml[meta.compositionId] === html
      ? project.hf
      : {
          ...project.hf,
          compositionHtml: {
            ...project.hf.compositionHtml,
            [meta.compositionId]: html,
          },
        };
  hf = registerCharacterAssets(hf, character, meta.character, mediaAssets);
  if (hf === project.hf) return project;
  return { ...project, hf, updatedAt: Date.now() };
}

export function findEditorClipInProject(project: Project, clipId: string): EditorClip | undefined {
  const rootClip = deriveEditorClips(project).find((candidate) => candidate.id === clipId);
  if (rootClip) return rootClip;
  for (const scene of deriveProjectScenes(project)) {
    const sceneProject = buildSceneEditingProject(project, scene.id);
    const clip = deriveEditorClips(sceneProject).find((candidate) => candidate.id === clipId);
    if (clip) return clip;
  }
  return undefined;
}

export function findEditorClipByCompositionId(
  project: Project,
  compositionId: string,
): EditorClip | undefined {
  const rootClip = deriveEditorClips(project).find(
    (candidate) => candidate.compositionId === compositionId,
  );
  if (rootClip) return rootClip;
  for (const scene of deriveProjectScenes(project)) {
    const sceneProject = buildSceneEditingProject(project, scene.id);
    const clip = deriveEditorClips(sceneProject).find(
      (candidate) => candidate.compositionId === compositionId,
    );
    if (clip) return clip;
  }
  return undefined;
}

export function rebuildCharacterCompositions(
  project: Project,
  characters: Map<string, CharacterPreset>,
  mediaAssets: Map<string, MediaAsset>,
  motionPresets: Map<string, MotionPreset>,
  filterCharacterId?: string,
): Project {
  let nextProject = project;
  for (const [clipId, meta] of Object.entries(project.editorMeta.clips)) {
    if (!isCharacterMeta(meta)) continue;
    if (filterCharacterId && meta.character.characterId !== filterCharacterId) continue;
    nextProject = rebuildCharacterCompositionInProject(
      nextProject,
      clipId,
      characters,
      mediaAssets,
      motionPresets,
    );
  }
  return refreshProjectAssets(nextProject, characters, mediaAssets);
}

/** Whether a generic clip patch changes inputs embedded in a character composition. */
export function characterCompositionPatchRequiresRebuild(patch: Partial<AnyClip>): boolean {
  return (
    "character" in patch ||
    "compositionId" in patch ||
    "compositionKind" in patch ||
    patch.kind !== undefined ||
    patch.duration !== undefined ||
    patch.width !== undefined ||
    patch.height !== undefined
  );
}
