// Keeps the canonical HyperFrames asset manifest aligned with project clip metadata.
import type {
  CharacterClipMeta,
  CharacterPreset,
  ClipEditorMeta,
  HyperFramesProject,
  MediaAsset,
  Project,
} from "./types";
import { characterAssetIds } from "./character/composition";
import { registerHfAsset } from "./hyperframes/assets";

export function collectReferencedAssetIds(
  clipsMeta: Record<string, ClipEditorMeta>,
  characters: Map<string, CharacterPreset>,
): Set<string> {
  const ids = new Set<string>();
  for (const meta of Object.values(clipsMeta)) {
    if (meta.mediaId) ids.add(meta.mediaId);
    if (meta.character) {
      const character = characters.get(meta.character.characterId);
      for (const id of characterAssetIds(character, meta.character)) ids.add(id);
    }
  }
  return ids;
}

export function pruneCandidateHfAssets(
  hf: HyperFramesProject,
  candidateIds: Set<string>,
  referencedIds: Set<string>,
): HyperFramesProject {
  if (candidateIds.size === 0) return hf;
  const assets = hf.assets.filter((asset) => {
    if (!candidateIds.has(asset.id)) return true;
    return referencedIds.has(asset.id);
  });
  return assets.length === hf.assets.length ? hf : { ...hf, assets };
}

export function registerCharacterAssets(
  hf: HyperFramesProject,
  character: CharacterPreset | undefined,
  characterMeta: CharacterClipMeta | undefined,
  mediaAssets: Map<string, MediaAsset>,
): HyperFramesProject {
  let nextHf = hf;
  for (const assetId of characterAssetIds(character, characterMeta)) {
    nextHf = registerHfAsset(nextHf, mediaAssets.get(assetId));
  }
  return nextHf;
}

export function refreshProjectAssets(
  project: Project,
  characters: Map<string, CharacterPreset>,
  mediaAssets: Map<string, MediaAsset>,
): Project {
  let hf = project.hf;

  for (const meta of Object.values(project.editorMeta.clips)) {
    if (meta.mediaId) hf = registerHfAsset(hf, mediaAssets.get(meta.mediaId));
    if (meta.compositionKind === "character" && meta.character) {
      hf = registerCharacterAssets(
        hf,
        characters.get(meta.character.characterId),
        meta.character,
        mediaAssets,
      );
    }
  }

  return hf !== project.hf ? { ...project, hf, updatedAt: Date.now() } : project;
}
