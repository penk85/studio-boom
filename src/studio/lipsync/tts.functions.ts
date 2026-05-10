// ElevenLabs Text-to-Speech with character-level timestamps.
// Returns the MP3 (base64) and per-character alignment used to drive lip sync.

export interface TtsTimestampsResult {
  audioBase64: string;
  mimeType: string;
  alignment: {
    characters: string[];
    character_start_times_seconds: number[];
    character_end_times_seconds: number[];
  };
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

  const apiKey = import.meta.env.VITE_ELEVENLABS_API_KEY as string | undefined;
  if (!apiKey) {
    throw new Error("VITE_ELEVENLABS_API_KEY is not configured");
  }

  const modelId = input.modelId ?? "eleven_multilingual_v2";
  const stability = input.stability ?? 0.5;
  const similarityBoost = input.similarityBoost ?? 0.75;

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
    input.voiceId,
  )}/with-timestamps?output_format=mp3_44100_128`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
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
