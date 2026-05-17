import { deleteMediaIfUnused, importMediaFile } from "../db";
import type { CompositionClip } from "../types";
import { deriveEditorClips, isCharacterCompositionClip } from "../types";
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
  if (!isCharacterCompositionClip(clip)) {
    throw new Error("Clip is not a character clip");
  }

  const result = await generateTtsWithTimestamps({
    text: args.text,
    voiceId: args.voiceId,
    modelId: args.modelId,
    stability: args.stability,
    similarityBoost: args.similarityBoost,
  });

  // Persist audio as a MediaAsset
  const blob = base64ToBlob(result.audioBase64, result.mimeType);
  const filename = `voice-${clip.name || "line"}-${Date.now()}.mp3`;
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

  const staleMediaIds = new Set<string>();
  if (clip.character.lipSyncAudioId && clip.character.lipSyncAudioId !== asset.id) {
    staleMediaIds.add(clip.character.lipSyncAudioId);
  }

  useStudio.getState().updateClip(clip.id, {
    character: {
      ...clip.character,
      lipSyncAudioId: asset.id,
      visemes,
      voiceLine: {
        text: args.text,
        voiceId: args.voiceId,
        modelId: args.modelId ?? "eleven_multilingual_v2",
        stability: args.stability ?? 0.5,
        similarityBoost: args.similarityBoost ?? 0.75,
      },
    },
    duration: Math.max(clip.duration, audioDuration),
  } as Partial<CompositionClip>);

  useStudio.getState().selectClip(clip.id);

  await useStudio.getState().saveProject();
  await Promise.all(
    Array.from(staleMediaIds).map((id) => deleteMediaIfUnused(id, { internalOnly: true })),
  );
  return { asset, visemes, audioDuration };
}
