// Voice & Lip Sync panel - visible when a character clip is selected.
// Generates or imports speech audio, then applies character-timed visemes.
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { RefreshCw, Save, Trash2, Upload, X } from "lucide-react";
import type { CharacterCompositionClip, CompositionClip, MouthViseme, SavedVoice } from "../types";
import { useStudio } from "../store";
import { db, deleteMediaIfUnused, deleteSavedVoice, getSavedVoices, saveVoice } from "../db";
import {
  DEFAULT_VOICE_ID,
  ELEVENLABS_MODELS,
  ELEVENLABS_VOICES,
  type ElevenLabsVoiceOption,
} from "../lipsync/voices";
import {
  alignAttachedAudioLipSyncForClip,
  applyAudioLipSyncForClip,
  generateLipSyncForClip,
} from "../lipsync/elevenlabs";
import { listElevenLabsVoices } from "../lipsync/tts.functions";
import { MOUTH_VISEMES, MOUTH_VISEME_DESCRIPTIONS } from "../lipsync/viseme-schema";

export function VoiceLipSyncPanel({ clip }: { clip: CharacterCompositionClip }) {
  const update = useStudio((s) => s.updateClip);
  const saveProject = useStudio((s) => s.saveProject);
  const initial = clip.character.voiceLine;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initial?.text ?? "");
  const [voiceId, setVoiceId] = useState(initial?.voiceId ?? DEFAULT_VOICE_ID);
  const [modelId, setModelId] = useState(initial?.modelId ?? "eleven_multilingual_v2");
  const [stability, setStability] = useState(initial?.stability ?? 0.5);
  const [similarity, setSimilarity] = useState(initial?.similarityBoost ?? 0.75);
  const [accountVoices, setAccountVoices] = useState<ElevenLabsVoiceOption[]>([]);
  const [voicesBusy, setVoicesBusy] = useState(false);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [draggingAudio, setDraggingAudio] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const character = useLiveQuery(
    () => db.characters.get(clip.character.characterId),
    [clip.character.characterId],
  );
  const queriedSavedVoices = useLiveQuery(() => getSavedVoices(), []);
  const savedVoices = useMemo(() => queriedSavedVoices ?? [], [queriedSavedVoices]);

  useEffect(() => {
    setText(initial?.text ?? "");
    setVoiceId(initial?.voiceId ?? DEFAULT_VOICE_ID);
    setModelId(initial?.modelId ?? "eleven_multilingual_v2");
    setStability(initial?.stability ?? 0.5);
    setSimilarity(initial?.similarityBoost ?? 0.75);
    setError(null);
    setNotice(null);
  }, [clip.id, initial]);

  const loadVoices = useCallback(async () => {
    setVoicesBusy(true);
    setVoicesError(null);
    try {
      const voices = await listElevenLabsVoices();
      setAccountVoices(voices);
    } catch (e) {
      setVoicesError(e instanceof Error ? e.message : String(e));
    } finally {
      setVoicesBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadVoices();
  }, [loadVoices]);

  const voiceOptions = useMemo(
    () =>
      mergeVoiceOptions(accountVoices.length > 0 ? accountVoices : ELEVENLABS_VOICES, savedVoices),
    [accountVoices, savedVoices],
  );
  const selectedVoice = voiceOptions.find((voice) => voice.id === voiceId) ?? voiceOptions[0];

  useEffect(() => {
    if (!selectedVoice) return;
    if (!voiceOptions.some((voice) => voice.id === voiceId)) setVoiceId(selectedVoice.id);
  }, [selectedVoice, voiceId, voiceOptions]);

  const visemeCount = clip.character.visemes?.length ?? 0;
  const audioName = clip.character.voiceLine?.audioName;
  const hasAttachedAudio = Boolean(clip.character.lipSyncAudioId);
  const availableMouthShapes = useMemo(() => {
    const shapes = new Set<MouthViseme>();
    for (const part of character?.parts ?? []) {
      if (part.role === "mouth" && part.viseme) shapes.add(part.viseme);
    }
    return shapes;
  }, [character?.parts]);

  const onGenerate = async () => {
    setError(null);
    setNotice(null);
    setBusyLabel("Generating voice");
    try {
      const voice = selectedVoice ?? voiceOptions[0];
      if (!voice) throw new Error("No ElevenLabs voice is selected");
      const result = await generateLipSyncForClip({
        clipId: clip.id,
        text: text.trim(),
        voiceId: voice.id,
        voiceName: voice.name,
        modelId,
        stability,
        similarityBoost: similarity,
      });
      setNotice(
        `Saved "${result.asset.name}" to the studio library and attached ${result.visemes.length} viseme keys.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyLabel(null);
    }
  };

  const onAudioFiles = async (files: FileList | File[] | null) => {
    const file = Array.from(files ?? []).find((candidate) => candidate.type.startsWith("audio/"));
    if (!file) return;
    setError(null);
    setNotice(null);
    setBusyLabel(text.trim() ? "Aligning audio" : "Importing audio");
    try {
      const result = await applyAudioLipSyncForClip({
        clipId: clip.id,
        file,
        transcript: text,
      });
      setNotice(
        result.alignmentError
          ? `Saved "${result.asset.name}" to the studio library and attached it. Timing was not created: ${result.alignmentError}`
          : result.visemes?.length
            ? `Saved "${result.asset.name}" to the studio library and attached ${result.visemes.length} viseme keys.`
            : `Saved "${result.asset.name}" to the studio library and attached it. Add a transcript to create lip sync timing.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyLabel(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onAlignAttachedAudio = async () => {
    setError(null);
    setNotice(null);
    setBusyLabel("Creating lip sync");
    try {
      const result = await alignAttachedAudioLipSyncForClip({
        clipId: clip.id,
        transcript: text,
      });
      setNotice(
        `Assigned ${result.visemes.length} viseme keys to "${result.asset.name}" from the transcript.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyLabel(null);
    }
  };

  const onClear = async () => {
    const mediaIds = new Set<string>();
    if (clip.character.lipSyncAudioId) mediaIds.add(clip.character.lipSyncAudioId);
    update(clip.id, {
      character: {
        ...clip.character,
        visemes: undefined,
        lipSyncAudioId: undefined,
        voiceLine: undefined,
      },
    } as Partial<CompositionClip>);
    await saveProject();
    await Promise.all(
      Array.from(mediaIds).map((id) => deleteMediaIfUnused(id, { internalOnly: true })),
    );
    setNotice("Removed speech from this character clip.");
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDraggingAudio(true);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDraggingAudio(false);
    void onAudioFiles(event.dataTransfer.files);
  };

  return (
    <div className="space-y-3 rounded border border-border bg-panel-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Voice & Lip Sync
        </span>
        {visemeCount > 0 && (
          <span className="text-[10px] text-primary">{visemeCount} viseme keys</span>
        )}
      </div>

      {audioName && (
        <div className="flex items-center justify-between gap-2 rounded border border-border bg-panel px-2 py-1.5">
          <div className="min-w-0">
            <div className="truncate text-[11px] text-muted-foreground">{audioName}</div>
            {visemeCount === 0 && (
              <div className="text-[10px] text-amber-100">No lip sync timing yet</div>
            )}
          </div>
          <button
            type="button"
            onClick={onClear}
            className="rounded p-1 text-muted-foreground hover:bg-panel-2 hover:text-destructive"
            title="Remove speech from this clip"
          >
            <X size={14} />
          </button>
        </div>
      )}

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
                  title={`${available ? "Available for lip sync" : "Missing mouth variant"}\n${MOUTH_VISEME_DESCRIPTIONS[shape]}`}
                >
                  {shape}
                </span>
              );
            })}
          </div>
          {availableMouthShapes.size === 0 && (
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              Default generated mouth shapes will be used near the character&apos;s mouth.
            </p>
          )}
        </div>
      )}

      <label className="block">
        <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
          Line / transcript
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="What should this character say?"
          className="w-full rounded border border-border bg-input px-2 py-1 text-foreground"
        />
      </label>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
            ElevenLabs voice
          </span>
          <select
            value={selectedVoice?.id ?? ""}
            onChange={(e) => setVoiceId(e.target.value)}
            className="w-full rounded border border-border bg-input px-2 py-1 text-foreground"
          >
            {voiceOptions.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {formatVoiceLabel(voice)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void loadVoices()}
          disabled={voicesBusy}
          className="mt-5 flex h-8 w-8 items-center justify-center rounded border border-border text-muted-foreground hover:bg-panel disabled:opacity-50"
          title="Refresh ElevenLabs voices"
        >
          <RefreshCw size={14} className={voicesBusy ? "animate-spin" : ""} />
        </button>
      </div>

      {voicesError && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-100">
          {voicesError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
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
        <PinnedVoiceControls
          savedVoices={savedVoices}
          selectedVoice={selectedVoice}
          onSelect={setVoiceId}
        />
      </div>

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

      <div
        onDragOver={onDragOver}
        onDragLeave={() => setDraggingAudio(false)}
        onDrop={onDrop}
        className={`rounded border border-dashed px-3 py-3 text-center text-[11px] ${
          draggingAudio
            ? "border-primary bg-primary/10 text-foreground"
            : "border-border bg-panel text-muted-foreground"
        }`}
      >
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!!busyLabel}
          className="inline-flex items-center gap-1.5 rounded border border-border bg-panel-2 px-2 py-1 text-xs text-foreground hover:bg-panel disabled:opacity-50"
        >
          <Upload size={14} />
          Drop or choose audio
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => void onAudioFiles(e.target.files)}
        />
        <div className="mt-1">
          {text.trim()
            ? "Uses the line above as the transcript for timing."
            : "Adds audio now; add a transcript afterward to create timing."}
        </div>
      </div>

      {error && (
        <div className="rounded bg-destructive/20 px-2 py-1 text-[11px] text-destructive-foreground">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] text-primary">
          {notice}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onGenerate}
          disabled={!!busyLabel || !text.trim() || !selectedVoice}
          className="flex-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {busyLabel ??
            (visemeCount > 0 ? "Regenerate voice + lip sync" : "Generate voice + lip sync")}
        </button>
        {visemeCount > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="rounded border border-border px-3 py-1.5 text-xs hover:bg-panel"
          >
            Clear
          </button>
        )}
      </div>
      {hasAttachedAudio && (
        <button
          type="button"
          onClick={onAlignAttachedAudio}
          disabled={!!busyLabel || !text.trim()}
          className="w-full rounded border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-panel disabled:cursor-not-allowed disabled:opacity-50"
        >
          {visemeCount > 0
            ? "Re-align lip sync from transcript"
            : "Create lip sync from transcript"}
        </button>
      )}
    </div>
  );
}

function PinnedVoiceControls({
  savedVoices,
  selectedVoice,
  onSelect,
}: {
  savedVoices: SavedVoice[];
  selectedVoice: ElevenLabsVoiceOption | undefined;
  onSelect: (voiceId: string) => void;
}) {
  const selectedSaved = selectedVoice
    ? savedVoices.find((voice) => voice.voiceId === selectedVoice.id)
    : undefined;
  return (
    <div className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
        Pinned
      </span>
      <div className="flex gap-1">
        <select
          value={selectedSaved?.voiceId ?? ""}
          onChange={(e) => {
            if (e.target.value) onSelect(e.target.value);
          }}
          className="min-w-0 flex-1 rounded border border-border bg-input px-2 py-1 text-foreground"
        >
          <option value="">None</option>
          {savedVoices.map((voice) => (
            <option key={voice.id} value={voice.voiceId}>
              {voice.name}
            </option>
          ))}
        </select>
        {selectedVoice && !selectedSaved && (
          <button
            type="button"
            onClick={() => void saveVoice(selectedVoice.id, selectedVoice.name)}
            className="flex h-8 w-8 items-center justify-center rounded border border-border text-muted-foreground hover:bg-panel"
            title="Pin selected voice"
          >
            <Save size={14} />
          </button>
        )}
        {selectedSaved && (
          <button
            type="button"
            onClick={() => void deleteSavedVoice(selectedSaved.id)}
            className="flex h-8 w-8 items-center justify-center rounded border border-border text-muted-foreground hover:bg-panel hover:text-destructive"
            title="Unpin selected voice"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function mergeVoiceOptions(
  voices: ElevenLabsVoiceOption[],
  savedVoices: SavedVoice[],
): ElevenLabsVoiceOption[] {
  const byId = new Map<string, ElevenLabsVoiceOption>();
  for (const voice of voices) byId.set(voice.id, voice);
  for (const voice of savedVoices) {
    if (!byId.has(voice.voiceId)) {
      byId.set(voice.voiceId, { id: voice.voiceId, name: voice.name, category: "pinned" });
    }
  }
  return Array.from(byId.values());
}

function formatVoiceLabel(voice: ElevenLabsVoiceOption): string {
  const details = [voice.category, voice.labels?.accent, voice.labels?.gender].filter(Boolean);
  return details.length > 0 ? `${voice.name} (${details.join(", ")})` : voice.name;
}
