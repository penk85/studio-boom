// ElevenLabs Text-to-Speech with character-level timestamps.
// Returns the MP3 (base64) and per-character alignment used to drive lip sync.
import type { ElevenLabsVoiceOption } from "./voices";

export interface TtsTimestampsResult {
  audioBase64: string;
  mimeType: string;
  alignment: {
    characters: string[];
    character_start_times_seconds: number[];
    character_end_times_seconds: number[];
  };
}

export interface ForcedAlignmentResult {
  alignment: TtsTimestampsResult["alignment"];
  loss?: number;
}

interface ElevenLabsVoiceResponse {
  voices?: Array<{
    voice_id?: string;
    name?: string;
    category?: string;
    description?: string;
    preview_url?: string;
    labels?: Record<string, string>;
    is_owner?: boolean;
  }>;
}

interface ForcedAlignmentResponse {
  characters?: Array<{
    text?: string;
    start?: number | null;
    end?: number | null;
  }>;
  loss?: number;
}

export async function listElevenLabsVoices(): Promise<ElevenLabsVoiceOption[]> {
  const res = await fetch("/api/elevenlabs/voices", {
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs voices failed [${res.status}]: ${body.slice(0, 400)}`);
  }

  const json = (await res.json()) as ElevenLabsVoiceResponse;
  return (json.voices ?? [])
    .filter((voice) => voice.voice_id && voice.name)
    .map((voice) => ({
      id: voice.voice_id!,
      name: voice.name!,
      category: voice.category,
      description: voice.description,
      previewUrl: voice.preview_url,
      labels: voice.labels,
      isOwner: voice.is_owner,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function generateTtsWithTimestamps(input: {
  text: string;
  voiceId: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
}): Promise<TtsTimestampsResult> {
  if (!input?.text?.trim()) throw new Error("text is required");
  if (!input?.voiceId?.trim()) throw new Error("voiceId is required");
  if (input.text.length > 5000) throw new Error("text too long (max 5000 chars)");

  const modelId = input.modelId ?? "eleven_multilingual_v2";
  const stability = input.stability ?? 0.5;
  const similarityBoost = input.similarityBoost ?? 0.75;

  const url = `/api/elevenlabs/text-to-speech/${encodeURIComponent(input.voiceId)}/with-timestamps`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      text: input.text,
      model_id: modelId,
      voice_settings: {
        stability,
        similarity_boost: similarityBoost,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs TTS failed [${res.status}]: ${body.slice(0, 400)}`);
  }

  const json = (await res.json()) as {
    audio_base64: string;
    alignment: TtsTimestampsResult["alignment"];
  };

  if (!json?.audio_base64 || !json?.alignment) {
    throw new Error("ElevenLabs response missing audio or alignment");
  }

  return {
    audioBase64: json.audio_base64,
    mimeType: "audio/mpeg",
    alignment: json.alignment,
  };
}

export async function forcedAlignAudioWithText(input: {
  file: File;
  text: string;
}): Promise<ForcedAlignmentResult> {
  if (!input.file.type.startsWith("audio/")) throw new Error("Audio file is required");
  if (!input.text.trim()) throw new Error("Transcript text is required for alignment");

  const form = new FormData();
  form.append("file", input.file);
  form.append("text", input.text.trim());

  const res = await fetch("/api/elevenlabs/forced-alignment", {
    method: "POST",
    headers: {
      Accept: "application/json",
    },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs forced alignment failed [${res.status}]: ${body.slice(0, 400)}`);
  }

  const json = (await res.json()) as ForcedAlignmentResponse;
  const characters = json.characters ?? [];
  if (characters.length === 0) {
    throw new Error("ElevenLabs forced alignment returned no character timings");
  }

  const starts: number[] = [];
  const ends: number[] = [];
  const text: string[] = [];
  let previousEnd = 0;
  for (const character of characters) {
    const start = Number.isFinite(character.start) ? Number(character.start) : previousEnd;
    const end = Number.isFinite(character.end) ? Number(character.end) : start;
    text.push(character.text ?? "");
    starts.push(start);
    ends.push(end);
    previousEnd = end;
  }

  return {
    alignment: {
      characters: text,
      character_start_times_seconds: starts,
      character_end_times_seconds: ends,
    },
    loss: json.loss,
  };
}
