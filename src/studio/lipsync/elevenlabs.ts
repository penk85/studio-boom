// Legacy character lip-sync helper.
// This originally generated voice audio plus viseme metadata for the character
// baking path. It is isolated until the character refactor decides whether to
// reuse it as authoring metadata or remove it.
import { deleteMediaIfUnused, importMediaFile } from "../db";
import type { CharacterClip } from "../types";
import { deriveEditorClips } from "../types";
import { useStudio } from "../store";
import { generateTtsWithTimestamps } from "./tts.functions";
import { alignmentToVisemes } from "./visemeMap";

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export interface GenerateLipSyncArgs {
  clipId: string;
  text: string;
  voiceId: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
}

export async function generateLipSyncForClip(args: GenerateLipSyncArgs) {
  const state = useStudio.getState();
  if (!state.project) throw new Error("No project loaded");
  const clip = state.project
    ? deriveEditorClips(state.project).find((c) => c.id === args.clipId)
    : undefined;
  if (!clip || clip.kind !== "character") {
    throw new Error("Clip is not a character clip");
  }
  const charClip = clip as unknown as CharacterClip;

  const result = await generateTtsWithTimestamps({
    text: args.text,
    voiceId: args.voiceId,
    modelId: args.modelId,
    stability: args.stability,
    similarityBoost: args.similarityBoost,
  });

  // Persist audio as a MediaAsset
  const blob = base64ToBlob(result.audioBase64, result.mimeType);
  const filename = `voice-${charClip.name || "line"}-${Date.now()}.mp3`;
  const file = new File([blob], filename, { type: result.mimeType });
  const asset = await importMediaFile(file, { scope: "generated-audio" });
  useStudio.getState().registerMediaAsset(asset);

  // Build viseme track
  const visemes = alignmentToVisemes(result.alignment);

  // Determine duration from alignment
  const ends = result.alignment.character_end_times_seconds;
  const audioDuration = Math.max(
    asset.duration ?? 0,
    ends.length ? ends[ends.length - 1] + 0.1 : 0,
  );

  // Remove stale generated-audio clips from earlier voice generations.
  const { project: currentProject } = useStudio.getState();
  const currentClips = currentProject ? deriveEditorClips(currentProject) : [];
  const bakedAudioClipId = `audio_${charClip.id}`;
  const staleEditorAudioClips = currentClips.filter(
    (c) =>
      c.kind === "audio" &&
      c.id !== bakedAudioClipId &&
      (c.linkedCharacterClipId === charClip.id ||
        (!!charClip.lipSyncAudioId && c.mediaId === charClip.lipSyncAudioId) ||
        c.name === `🎙 ${charClip.name}`),
  );
  const staleMediaIds = new Set(
    staleEditorAudioClips
      .map((c) => c.mediaId)
      .filter((id): id is string => !!id && id !== asset.id),
  );
  if (charClip.lipSyncAudioId && charClip.lipSyncAudioId !== asset.id) {
    staleMediaIds.add(charClip.lipSyncAudioId);
  }
  for (const stale of staleEditorAudioClips) {
    useStudio.getState().removeClip(stale.id);
  }

  // Store voice/lip-sync authoring data on the character clip. The native
  // character composition work will move this into renderable HF HTML directly.
  useStudio.getState().updateClip(charClip.id, {
    lipSyncAudioId: asset.id,
    visemes,
    voiceLine: {
      text: args.text,
      voiceId: args.voiceId,
      modelId: args.modelId ?? "eleven_multilingual_v2",
      stability: args.stability ?? 0.5,
      similarityBoost: args.similarityBoost ?? 0.75,
    },
    duration: Math.max(charClip.duration, audioDuration),
  } as Partial<CharacterClip>);

  useStudio.getState().selectClip(charClip.id);

  await useStudio.getState().saveProject();
  await Promise.all(
    Array.from(staleMediaIds).map((id) => deleteMediaIfUnused(id, { internalOnly: true })),
  );
  return { asset, visemes, audioDuration };
}
