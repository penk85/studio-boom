import { db, importMediaFile, setMediaVoiceData } from "../db";
import type { CompositionClip, MediaAsset, VoiceLineMeta } from "../types";
import { deriveEditorClips, isCharacterCompositionClip } from "../types";
import { useStudio } from "../store";
import { forcedAlignAudioWithText, generateTtsWithTimestamps } from "./tts.functions";
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
  voiceName?: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
}

export interface ApplyAudioLipSyncArgs {
  clipId: string;
  file: File;
  transcript?: string;
}

export interface AlignVoiceForClipArgs {
  clipId: string;
  audioId: string;
  transcript: string;
}

export async function generateLipSyncForClip(args: GenerateLipSyncArgs) {
  if (!args.text.trim()) throw new Error("text is required");
  if (!args.voiceId.trim()) throw new Error("voiceId is required");

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
  const filename = speechFilename(clip.name || "line", "mp3");
  const file = new File([blob], filename, { type: result.mimeType });
  const asset = await importMediaFile(file);
  useStudio.getState().registerMediaAsset(asset);

  // Build viseme track
  const visemes = alignmentToVisemes(result.alignment);

  // Determine duration from alignment
  const ends = result.alignment.character_end_times_seconds;
  const audioDuration = Math.max(
    asset.duration ?? 0,
    ends.length ? ends[ends.length - 1] + 0.1 : 0,
  );

  const voiceLine: VoiceLineMeta = {
    source: "elevenlabs-tts",
    text: args.text,
    voiceId: args.voiceId,
    voiceName: args.voiceName,
    modelId: args.modelId ?? "eleven_multilingual_v2",
    stability: args.stability ?? 0.5,
    similarityBoost: args.similarityBoost ?? 0.75,
    audioName: asset.name,
  };
  // Canonical lip-sync data lives on the audio asset so the voice is reusable.
  const voiced = await setMediaVoiceData(asset.id, { visemes, voiceLine });
  if (voiced) useStudio.getState().registerMediaAsset(voiced);

  // Append it as a new speech after the last one on the character.
  useStudio.getState().attachVoiceToCharacter(clip.id, asset.id);
  await useStudio.getState().saveProject();
  return { asset, visemes, audioDuration };
}

export async function applyAudioLipSyncForClip(args: ApplyAudioLipSyncArgs) {
  if (!args.file.type.startsWith("audio/")) throw new Error("Please drop an audio file");

  const state = useStudio.getState();
  if (!state.project) throw new Error("No project loaded");
  const clip = state.project
    ? deriveEditorClips(state.project).find((c) => c.id === args.clipId)
    : undefined;
  if (!isCharacterCompositionClip(clip)) {
    throw new Error("Clip is not a character clip");
  }

  const asset = await importMediaFile(args.file);
  useStudio.getState().registerMediaAsset(asset);

  const transcript = args.transcript?.trim() ?? "";
  let alignment: GenerateTtsWithTimestampsAlignment | null = null;
  let alignmentError: string | undefined;
  if (transcript) {
    try {
      alignment = (await forcedAlignAudioWithText({ file: args.file, text: transcript })).alignment;
    } catch (e) {
      alignmentError = e instanceof Error ? e.message : String(e);
    }
  }
  const visemes = alignment ? alignmentToVisemes(alignment) : undefined;
  const audioDuration = durationFromAssetAndAlignment(asset, alignment);

  const voiceLine: VoiceLineMeta = {
    source: "audio-file",
    text: transcript,
    audioName: asset.name,
  };
  // Canonical lip-sync data lives on the audio asset so the voice is reusable.
  const voiced = await setMediaVoiceData(asset.id, { visemes, voiceLine });
  if (voiced) useStudio.getState().registerMediaAsset(voiced);

  // Append it as a new speech after the last one on the character.
  useStudio.getState().attachVoiceToCharacter(clip.id, asset.id);
  await useStudio.getState().saveProject();
  return { asset, visemes, audioDuration, alignmentError };
}

export async function alignVoiceForClip(args: AlignVoiceForClipArgs) {
  const transcript = args.transcript.trim();
  if (!transcript) throw new Error("Transcript text is required for lip sync");

  const [asset, row] = await Promise.all([
    db.media.get(args.audioId),
    db.mediaBlobs.get(args.audioId),
  ]);
  if (!asset || !row) throw new Error("Voice audio could not be found in the library");
  if (asset.kind !== "audio") throw new Error("Selected media is not an audio file");

  const file = new File([row.blob], asset.filename || `${asset.name}.mp3`, {
    type: asset.mimeType || row.blob.type || "audio/mpeg",
  });
  const alignment = (await forcedAlignAudioWithText({ file, text: transcript })).alignment;
  const visemes = alignmentToVisemes(alignment);
  const audioDuration = durationFromAssetAndAlignment(asset, alignment);

  const voiceLine: VoiceLineMeta = {
    ...(asset.voiceLine ?? {}),
    source: "audio-file",
    text: transcript,
    audioName: asset.name,
  };
  // Canonical lip-sync data is owned by the audio asset; rebuild the clips that use it.
  const voiced = await setMediaVoiceData(asset.id, { visemes, voiceLine });
  if (voiced) useStudio.getState().registerMediaAsset(voiced);
  useStudio.getState().rebuildClipsUsingAudio(asset.id);

  useStudio.getState().selectClip(args.clipId);
  await useStudio.getState().saveProject();
  return { asset, visemes, audioDuration };
}

function durationFromAssetAndAlignment(
  asset: MediaAsset,
  alignment: GenerateTtsWithTimestampsAlignment | null,
): number {
  const ends = alignment?.character_end_times_seconds ?? [];
  return Math.max(asset.duration ?? 0, ends.length ? ends[ends.length - 1] + 0.1 : 0);
}

type GenerateTtsWithTimestampsAlignment = Awaited<
  ReturnType<typeof generateTtsWithTimestamps>
>["alignment"];

function speechFilename(name: string, extension: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return `voice-${base || "line"}-${Date.now()}.${extension}`;
}
