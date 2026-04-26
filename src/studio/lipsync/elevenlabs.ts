// Client-side helper: generate ElevenLabs voice + lip sync for a character clip.
// Stores the MP3 as a MediaAsset, attaches viseme keyframes to the clip,
// and drops a synced audio clip on the Audio track.
import { db, importMediaFile, uid } from "../db";
import type { CharacterClip, MediaClip, Project, Track } from "../types";
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

function audioTrackIndex(project: Project): number {
  const i = project.tracks.findIndex((t: Track) => t.kind === "audio");
  return i >= 0 ? i : 0;
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
  const project = state.project;
  if (!project) throw new Error("No project loaded");
  const clip = project.clips.find((c) => c.id === args.clipId);
  if (!clip || clip.kind !== "character") {
    throw new Error("Clip is not a character clip");
  }
  const charClip = clip as CharacterClip;

  const result = await generateTtsWithTimestamps({
    data: {
      text: args.text,
      voiceId: args.voiceId,
      modelId: args.modelId,
      stability: args.stability,
      similarityBoost: args.similarityBoost,
    },
  });

  // Persist audio as a MediaAsset
  const blob = base64ToBlob(result.audioBase64, result.mimeType);
  const filename = `voice-${charClip.name || "line"}-${Date.now()}.mp3`;
  const file = new File([blob], filename, { type: result.mimeType });
  const asset = await importMediaFile(file, { scope: "generated-audio" });

  // Build viseme track
  const visemes = alignmentToVisemes(result.alignment);

  // Determine duration from alignment
  const ends = result.alignment.character_end_times_seconds;
  const audioDuration = Math.max(
    asset.duration ?? 0,
    ends.length ? ends[ends.length - 1] + 0.1 : 0,
  );

  // Update the character clip
  state.updateClip(charClip.id, {
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

  // Drop an audio clip on the Audio track aligned to the character clip's start.
  // Remove any prior auto-generated audio clip associated with this character.
  const proj = useStudio.getState().project!;
  const stale = proj.clips.find(
    (c) =>
      c.kind === "audio" &&
      ((c as MediaClip).linkedCharacterClipId === charClip.id ||
        (!!charClip.lipSyncAudioId && c.mediaId === charClip.lipSyncAudioId) ||
        c.name === `🎙 ${charClip.name}`),
  );
  if (stale) state.removeClip(stale.id);

  const audioClip: MediaClip = {
    id: uid(),
    kind: "audio",
    mediaId: asset.id,
    name: `🎙 ${charClip.name}`,
    trackIndex: audioTrackIndex(proj),
    start: charClip.start,
    duration: audioDuration,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    opacity: 1,
    zIndex: proj.clips.length,
    linkedCharacterClipId: charClip.id,
  };
  state.addClip(audioClip);
  state.selectClip(charClip.id);

  await db.projects.put(useStudio.getState().project!);
  return { asset, visemes, audioDuration };
}
