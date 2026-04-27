// Voice & Lip Sync panel — visible when a character clip is selected.
// Generates ElevenLabs TTS + character timestamps and applies as visemes.
import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { CharacterClip, MediaClip, MouthViseme, SavedVoice } from "../types";
import { useStudio } from "../store";
import { db, deleteMediaIfUnused, getSavedVoices, saveVoice, deleteSavedVoice } from "../db";
import { ELEVENLABS_VOICES, ELEVENLABS_MODELS, DEFAULT_VOICE_ID } from "../lipsync/voices";
import { generateLipSyncForClip } from "../lipsync/elevenlabs";
import { MOUTH_VISEMES, MOUTH_VISEME_DESCRIPTIONS } from "../lipsync/viseme-schema";

export function VoiceLipSyncPanel({ clip }: { clip: CharacterClip }) {
  const project = useStudio((s) => s.project);
  const update = useStudio((s) => s.updateClip);
  const removeClip = useStudio((s) => s.removeClip);
  const saveProject = useStudio((s) => s.saveProject);
  const initial = clip.voiceLine;
  const [text, setText] = useState(initial?.text ?? "");
  const [voiceId, setVoiceId] = useState(initial?.voiceId ?? DEFAULT_VOICE_ID);
  const [customId, setCustomId] = useState("");
  const [customName, setCustomName] = useState("");
  const [modelId, setModelId] = useState(initial?.modelId ?? "eleven_multilingual_v2");
  const [stability, setStability] = useState(initial?.stability ?? 0.5);
  const [similarity, setSimilarity] = useState(initial?.similarityBoost ?? 0.75);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const character = useLiveQuery(() => db.characters.get(clip.characterId), [clip.characterId]);
  const savedVoices = useLiveQuery(() => getSavedVoices(), []) ?? [];

  const visemeCount = clip.visemes?.length ?? 0;
  const availableMouthShapes = useMemo(() => {
    const shapes = new Set<MouthViseme>();
    for (const part of character?.parts ?? []) {
      if (part.role === "mouth" && part.viseme) shapes.add(part.viseme);
    }
    return shapes;
  }, [character?.parts]);

  const onGenerate = async () => {
    setError(null);
    setBusy(true);
    try {
      const finalVoice = customId.trim() || voiceId;
      await generateLipSyncForClip({
        clipId: clip.id,
        text: text.trim(),
        voiceId: finalVoice,
        modelId,
        stability,
        similarityBoost: similarity,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    const speechClips =
      project?.clips.filter(
        (c) =>
          c.kind === "audio" &&
          ((c as MediaClip).linkedCharacterClipId === clip.id ||
            (!!clip.lipSyncAudioId && c.mediaId === clip.lipSyncAudioId)),
      ) ?? [];
    const mediaIds = new Set(speechClips.map((speechClip) => (speechClip as MediaClip).mediaId));
    if (clip.lipSyncAudioId) mediaIds.add(clip.lipSyncAudioId);
    for (const speechClip of speechClips) removeClip(speechClip.id);
    update(clip.id, {
      visemes: undefined,
      lipSyncAudioId: undefined,
      voiceLine: undefined,
    } as Partial<CharacterClip>);
    await saveProject();
    await Promise.all(
      Array.from(mediaIds).map((id) => deleteMediaIfUnused(id, { internalOnly: true })),
    );
  };

  return (
    <div className="space-y-3 rounded border border-border bg-panel-2 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Voice & Lip Sync
        </span>
        {visemeCount > 0 && (
          <span className="text-[10px] text-primary">{visemeCount} viseme keys</span>
        )}
      </div>

      {character && (
        <div className="rounded border border-border bg-panel p-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Mouth shapes
          </div>
          <div className="flex flex-wrap gap-1">
            {MOUTH_VISEMES.map((shape) => {
              const available = availableMouthShapes.has(shape);
              return (
                <span
                  key={shape}
                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                    available
                      ? "bg-primary/25 text-foreground"
                      : "border border-border text-muted-foreground"
                  }`}
                  title={`${available ? "Available for lip sync" : "Missing mouth image"}\n${MOUTH_VISEME_DESCRIPTIONS[shape]}`}
                >
                  {shape}
                </span>
              );
            })}
          </div>
          {availableMouthShapes.size === 0 && (
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              No custom mouth shapes yet. Playback will use default generated shapes near the
              character&apos;s mouth.
            </p>
          )}
        </div>
      )}

      <label className="block">
        <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
          Line
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="What should this character say?"
          className="w-full rounded border border-border bg-input px-2 py-1 text-foreground"
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
            Voice
          </span>
          <select
            value={voiceId}
            onChange={(e) => setVoiceId(e.target.value)}
            disabled={!!customId.trim()}
            className="w-full rounded border border-border bg-input px-2 py-1 text-foreground"
          >
            {ELEVENLABS_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
            Model
          </span>
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="w-full rounded border border-border bg-input px-2 py-1 text-foreground"
          >
            {ELEVENLABS_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {savedVoices.length > 0 && (
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
            Saved Voices
          </span>
          <select
            value={customId && savedVoices.some((v) => v.voiceId === customId) ? customId : ""}
            onChange={(e) => {
              const selected = savedVoices.find((v) => v.voiceId === e.target.value);
              if (selected) {
                setCustomId(selected.voiceId);
                setCustomName(selected.name);
              }
            }}
            className="w-full rounded border border-border bg-input px-2 py-1 text-foreground"
          >
            <option value="">Select a saved voice...</option>
            {savedVoices.map((v) => (
              <option key={v.id} value={v.voiceId}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="block">
        <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
          Custom voice ID (optional)
        </span>
        <div className="flex gap-2">
          <input
            value={customId}
            onChange={(e) => setCustomId(e.target.value)}
            placeholder="paste any ElevenLabs voice_id"
            className="flex-1 rounded border border-border bg-input px-2 py-1 font-mono text-foreground"
          />
          {customId.trim() && (
            <button
              onClick={async () => {
                if (!customId.trim()) return;
                const name = customName.trim() || `Voice ${customId.slice(0, 8)}`;
                await saveVoice(customId.trim(), name);
                setCustomName("");
              }}
              className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90"
              title="Save this voice for later"
            >
              Save
            </button>
          )}
        </div>
        {customId.trim() && (
          <div className="mt-1 flex gap-2">
            <input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="Voice name (optional)"
              className="flex-1 rounded border border-border bg-input px-2 py-1 text-[10px] text-foreground"
            />
            {savedVoices.some((v) => v.voiceId === customId.trim()) && (
              <button
                onClick={async () => {
                  const existing = savedVoices.find((v) => v.voiceId === customId.trim());
                  if (existing) {
                    await deleteSavedVoice(existing.id);
                    setCustomId("");
                    setCustomName("");
                  }
                }}
                className="rounded border border-destructive px-2 py-1 text-[10px] text-destructive hover:bg-destructive/20"
                title="Remove from saved voices"
              >
                Remove
              </button>
            )}
          </div>
        )}
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
            Stability {stability.toFixed(2)}
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={stability}
            onChange={(e) => setStability(Number(e.target.value))}
            className="w-full"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
            Similarity {similarity.toFixed(2)}
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={similarity}
            onChange={(e) => setSimilarity(Number(e.target.value))}
            className="w-full"
          />
        </label>
      </div>

      {error && (
        <div className="rounded bg-destructive/20 px-2 py-1 text-[11px] text-destructive-foreground">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onGenerate}
          disabled={busy || !text.trim()}
          className="flex-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {busy
            ? "Generating…"
            : visemeCount > 0
              ? "Regenerate voice + lip sync"
              : "Generate voice + lip sync"}
        </button>
        {visemeCount > 0 && (
          <button
            onClick={onClear}
            className="rounded border border-border px-3 py-1.5 text-xs hover:bg-panel"
          >
            Clear
          </button>
        )}
      </div>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Powered by ElevenLabs. Mouth shapes are derived from the per-character audio timestamps and
        applied to the character&apos;s mouth parts during playback.
      </p>
    </div>
  );
}
