# Phase 2A — ElevenLabs voice + lip sync (revised)

You're switching from generic phoneme analysis to ElevenLabs as the sole audio source. We'll use their **TTS-with-timestamps** API, which returns the MP3 plus per-character start/end times. That gives us exact viseme timing without any client-side ML.

## What changes vs the original plan

- **No ffmpeg.wasm / WASM phoneme model** — removed.
- **No microphone or "bring your own audio" lip sync** — only ElevenLabs-generated audio drives mouths.
- A character clip's "voice" is a **TTS line**: text + voiceId + settings → produces an audio asset + a viseme track in one step.

## Flow

```text
User selects character clip
  → opens "Voice" panel in Inspector
  → types line, picks ElevenLabs voice + model
  → "Generate"
       → server function calls /v1/text-to-speech/{voiceId}/with-timestamps
       → returns { audio_base64, alignment: { characters[], character_start_times_seconds[], character_end_times_seconds[] } }
  → client stores MP3 as a MediaAsset (in IndexedDB)
  → maps each character → viseme (rest/A/E/I/O/U/MBP/FV/L) using a letter→viseme table
  → collapses adjacent identical visemes, snaps to fps grid
  → writes clip.lipSyncAudioId + clip.visemes[]
  → audio clip auto-added to the Audio track aligned to the character clip
```

At playback time, the Stage already swaps mouth parts based on the active viseme at `playhead - clip.start`. Same logic feeds the Hyperframes export.

## Letter → viseme mapping (English)

| Letters | Viseme |
|---|---|
| a | A |
| e, i, y | E / I |
| o | O |
| u, w | U |
| m, b, p | MBP |
| f, v | FV |
| l | L |
| space, punctuation, silence gap >120ms | rest |
| everything else (consonants s, t, d, n, k, g, r, z, h…) | nearest preceding vowel, else rest |

Pluggable so users can extend per-language later.

## Pieces to build

1. **Server function** `src/server/elevenlabs-tts.ts`
   - `generateTtsWithTimestamps({ text, voiceId, modelId, voiceSettings })`
   - Calls `POST https://api.elevenlabs.io/v1/text-to-speech/{voiceId}/with-timestamps`
   - Reads `ELEVENLABS_API_KEY` from runtime secrets
   - Returns `{ audioBase64, mimeType: "audio/mpeg", alignment }`

2. **Client helpers** `src/studio/lipsync/`
   - `visemeMap.ts` — letter→viseme table + `mapAlignmentToVisemes(alignment, fps)`
   - `elevenlabs.ts` — wraps the server function call, decodes base64 → Blob, imports as MediaAsset, attaches to clip

3. **Voices list** `src/studio/lipsync/voices.ts`
   - Hard-coded curated list from the ElevenLabs voice ID catalog (Roger, Sarah, Laura, George, etc.) so the user gets a dropdown without an extra API call. "Custom voice ID" input for anything else.

4. **Inspector panel** — new "Voice & Lip Sync" section visible when a character clip is selected:
   - Textarea (line text)
   - Voice dropdown (curated) + custom ID field
   - Model: `eleven_multilingual_v2` (default) / `eleven_turbo_v2_5`
   - Stability / similarity sliders (sane defaults)
   - "Generate voice + lip sync" button → loading → success
   - Shows current line, voice, viseme count; "Regenerate" / "Clear" actions

5. **Secret onboarding**
   - On first generate, if `ELEVENLABS_API_KEY` is missing, prompt the user with instructions and an `add_secret` request. No key shipped in code.

6. **Stage rendering** — already swaps `mouth` parts by viseme; just confirm it reads `clip.visemes` correctly and falls back to `rest`.

## Out of scope for this phase (future)

- Multi-line / multi-clip voice scripts (one line per clip for now)
- Voice cloning UI (user can paste a custom voice ID)
- Word-level highlighting / captions track (the alignment data supports it; we'll add later)
- Streaming TTS (we use the non-stream timestamp endpoint because we need the full alignment payload)

## Files touched / created

- create `src/server/elevenlabs-tts.ts`
- create `src/studio/lipsync/visemeMap.ts`
- create `src/studio/lipsync/elevenlabs.ts`
- create `src/studio/lipsync/voices.ts`
- edit `src/studio/components/Inspector.tsx` (add Voice & Lip Sync panel)
- edit `src/studio/types.ts` (add `voiceLine?: { text, voiceId, modelId, settings }` to `CharacterClip`)
- edit `src/studio/store.ts` (action: `setClipVoiceLine`, `applyLipSyncResult`)

## Confirm before I build

1. **API key**: I'll request `ELEVENLABS_API_KEY` as a runtime secret on first use. OK?
2. **Audio placement**: when lip sync generates, should the resulting MP3 auto-drop on the Audio track aligned to the character clip's start, with the character clip resized to match audio duration? (Recommended — matches Toon Boom workflow.)
3. **Curated voice list**: use the ~20 standard ElevenLabs voices I have on hand (Roger, Sarah, George, etc.) plus a "custom voice ID" input?
