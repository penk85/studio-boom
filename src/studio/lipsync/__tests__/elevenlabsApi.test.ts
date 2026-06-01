import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forcedAlignAudioWithText,
  generateTtsWithTimestamps,
  listElevenLabsVoices,
} from "../tts.functions";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ElevenLabs API helpers", () => {
  it("loads account voices by name", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            voices: [
              {
                voice_id: "voice-b",
                name: "Zara",
                category: "generated",
                labels: { accent: "US", gender: "female" },
              },
              {
                voice_id: "voice-a",
                name: "Alex",
                category: "professional",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const voices = await listElevenLabsVoices();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/elevenlabs/voices",
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: "application/json" }),
      }),
    );
    expect(voices.map((voice) => voice.name)).toEqual(["Alex", "Zara"]);
    expect(voices[1]).toMatchObject({
      id: "voice-b",
      category: "generated",
      labels: { accent: "US", gender: "female" },
    });
  });

  it("converts forced alignment characters into the viseme alignment shape", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            characters: [
              { text: "h", start: 0, end: 0.05 },
              { text: "i", start: 0.05, end: 0.14 },
            ],
            loss: 0.01,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const file = new File([new Uint8Array([1, 2, 3])], "speech.wav", { type: "audio/wav" });

    const result = await forcedAlignAudioWithText({ file, text: "hi" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/elevenlabs/forced-alignment",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Accept: "application/json" }),
      }),
    );
    const formData = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(formData.get("text")).toBe("hi");
    expect(formData.get("file")).toBe(file);
    expect(result.alignment).toEqual({
      characters: ["h", "i"],
      character_start_times_seconds: [0, 0.05],
      character_end_times_seconds: [0.05, 0.14],
    });
  });

  it("generates timestamped speech through the local proxy", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            audio_base64: "abc123",
            alignment: {
              characters: ["o", "k"],
              character_start_times_seconds: [0, 0.04],
              character_end_times_seconds: [0.04, 0.1],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateTtsWithTimestamps({
      text: "ok",
      voiceId: "voice/with/slash",
      modelId: "eleven_multilingual_v2",
      stability: 0.4,
      similarityBoost: 0.8,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/elevenlabs/text-to-speech/voice%2Fwith%2Fslash/with-timestamps",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Accept: "application/json" }),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      text: "ok",
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.4,
        similarity_boost: 0.8,
      },
    });
    expect(result.audioBase64).toBe("abc123");
  });
});
