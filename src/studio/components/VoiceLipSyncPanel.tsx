// Voice & Lip Sync panel - visible when a character clip is selected.
// Generates or imports speech audio, then applies character-timed visemes.
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ChevronDown,
  ChevronRight,
  Pause,
  Play,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import type { CharacterCompositionClip, CompositionClip, SavedVoice } from "../types";
import { useStudio } from "../store";
import { db, deleteSavedVoice, getMediaUrl, getSavedVoices, saveVoice } from "../db";
import {
  DEFAULT_VOICE_ID,
  ELEVENLABS_MODELS,
  ELEVENLABS_VOICES,
  type ElevenLabsVoiceOption,
} from "../lipsync/voices";
import {
  alignVoiceForClip,
  applyAudioLipSyncForClip,
  generateLipSyncForClip,
} from "../lipsync/elevenlabs";
import { listElevenLabsVoices } from "../lipsync/tts.functions";
import { characterSpeeches } from "../types";

export function VoiceLipSyncPanel({ clip }: { clip: CharacterCompositionClip }) {
  const attachVoice = useStudio((s) => s.attachVoiceToCharacter);
  const moveSpeech = useStudio((s) => s.moveSpeech);
  const removeSpeech = useStudio((s) => s.removeSpeech);
  const setSpeechVolume = useStudio((s) => s.setSpeechVolume);
  const selectedSpeechId = useStudio((s) => s.selectedSpeechId);
  const selectSpeech = useStudio((s) => s.selectSpeech);
  const saveProject = useStudio((s) => s.saveProject);
  const queriedAudio = useLiveQuery(() => db.media.where("kind").equals("audio").toArray(), []);
  const audioAssets = useMemo(
    () => (queriedAudio ?? []).slice().sort((a, b) => b.createdAt - a.createdAt),
    [queriedAudio],
  );
  const speeches = useMemo(() => characterSpeeches(clip.character), [clip.character]);
  const selectedSpeech = useMemo(
    () => speeches.find((s) => s.id === selectedSpeechId) ?? speeches[0] ?? null,
    [speeches, selectedSpeechId],
  );
  const selectedAsset = useMemo(
    () => (selectedSpeech ? audioAssets.find((a) => a.id === selectedSpeech.audioId) : undefined),
    [audioAssets, selectedSpeech],
  );
  const initial = selectedAsset?.voiceLine ?? clip.character.voiceLine;
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Three scoped transcript inputs: TTS line, the attached voice's lip-sync
  // transcript, and the upload transcript — each with its own button.
  const [ttsText, setTtsText] = useState("");
  const [voiceText, setVoiceText] = useState(initial?.text ?? "");
  const [uploadText, setUploadText] = useState("");
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
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewRef = useRef<HTMLAudioElement>(null);
  const queriedSavedVoices = useLiveQuery(() => getSavedVoices(), []);
  const savedVoices = useMemo(() => queriedSavedVoices ?? [], [queriedSavedVoices]);

  useEffect(() => {
    setVoiceText(initial?.text ?? "");
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

  // Lip-sync data is owned by the audio asset of the selected speech.
  const visemeCount = selectedAsset?.visemes?.length ?? 0;

  const onGenerate = async () => {
    setError(null);
    setNotice(null);
    setBusyLabel("Generating voice");
    try {
      const voice = selectedVoice ?? voiceOptions[0];
      if (!voice) throw new Error("No ElevenLabs voice is selected");
      const result = await generateLipSyncForClip({
        clipId: clip.id,
        text: ttsText.trim(),
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
    setBusyLabel(uploadText.trim() ? "Aligning audio" : "Importing audio");
    try {
      const result = await applyAudioLipSyncForClip({
        clipId: clip.id,
        file,
        transcript: uploadText,
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

  const onGenerateLipSync = async () => {
    if (!selectedSpeech) return;
    setError(null);
    setNotice(null);
    setBusyLabel("Creating lip sync");
    try {
      const result = await alignVoiceForClip({
        clipId: clip.id,
        audioId: selectedSpeech.audioId,
        transcript: voiceText,
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

  const onRemoveSpeech = async (speechId: string) => {
    setError(null);
    setNotice(null);
    removeSpeech(clip.id, speechId);
    await saveProject();
    setNotice("Removed the voice from this character. It stays in your library to reuse.");
  };

  const onAttachVoice = async (audioId: string) => {
    setError(null);
    setNotice(null);
    attachVoice(clip.id, audioId);
    await saveProject();
    const asset = audioAssets.find((a) => a.id === audioId);
    setNotice(
      asset?.visemes?.length
        ? `Added "${asset.name}" with ${asset.visemes.length} viseme keys.`
        : `Added "${asset?.name ?? "audio"}". Add a transcript to create lip sync timing.`,
    );
  };

  const togglePreview = async (audioId: string) => {
    const el = previewRef.current;
    if (!el) return;
    if (previewId === audioId) {
      el.pause();
      setPreviewId(null);
      return;
    }
    const url = await getMediaUrl(audioId);
    if (!url) return;
    el.src = url;
    setPreviewId(audioId);
    try {
      await el.play();
    } catch {
      setPreviewId(null);
    }
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
        <span className="text-ui-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Voice & Lip Sync
        </span>
        {visemeCount > 0 && (
          <span className="text-ui-sm text-primary">{visemeCount} viseme keys</span>
        )}
      </div>

      {speeches.length > 0 && (
        <div className="rounded border border-border bg-panel p-2">
          <div className="mb-1 text-ui-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Voices on this character
          </div>
          <ul className="space-y-1">
            {speeches.map((speech) => {
              const asset = audioAssets.find((a) => a.id === speech.audioId);
              const playing = previewId === speech.audioId;
              const isSelected = selectedSpeech?.id === speech.id;
              const ready = (asset?.visemes?.length ?? 0) > 0;
              return (
                <li
                  key={speech.id}
                  className={`flex items-center gap-1 rounded border px-1.5 py-1 ${
                    isSelected ? "border-primary bg-primary/15" : "border-border bg-panel-2"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void togglePreview(speech.audioId)}
                    title={playing ? "Pause" : "Play"}
                    aria-label={playing ? "Pause preview" : "Play preview"}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-panel hover:text-foreground"
                  >
                    {playing ? <Pause size={12} /> : <Play size={12} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => selectSpeech(speech.id)}
                    title="Edit lip sync"
                    className="min-w-0 flex-1 truncate text-left text-ui-sm text-foreground"
                  >
                    {asset?.name ?? "Voice"}
                  </button>
                  <label className="flex shrink-0 items-center gap-1 text-ui-sm text-muted-foreground">
                    start
                    <SpeechStartInput
                      speechId={speech.id}
                      value={speech.start}
                      onCommit={(start) => moveSpeech(clip.id, speech.id, start)}
                    />
                    s
                  </label>
                  {ready && (
                    <span
                      className="shrink-0 text-ui-sm text-primary"
                      title={`${asset?.visemes?.length} viseme keys`}
                    >
                      ♪
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => void onRemoveSpeech(speech.id)}
                    title="Remove voice (keeps it in your library)"
                    aria-label="Remove voice"
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                  >
                    <X size={12} />
                  </button>
                </li>
              );
            })}
          </ul>
          {selectedSpeech && (
            <div className="mt-2 border-t border-border pt-2">
              <label className="mb-2 flex items-center gap-2 text-ui-sm text-muted-foreground">
                <Volume2 size={12} className="shrink-0" />
                <span className="shrink-0">Volume</span>
                <SpeechVolumeInput
                  speechId={selectedSpeech.id}
                  value={selectedSpeech.volume ?? 1}
                  onCommit={(volume) => setSpeechVolume(clip.id, selectedSpeech.id, volume)}
                />
              </label>
              <div className="mb-1 text-ui-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Lip sync — {selectedAsset?.name ?? "voice"}
              </div>
              <textarea
                value={voiceText}
                onChange={(e) => setVoiceText(e.target.value)}
                rows={2}
                placeholder="Transcript of what this voice says…"
                className="w-full rounded border border-border bg-input px-2 py-1 text-foreground"
              />
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-ui-sm text-muted-foreground">
                  {visemeCount > 0 ? `${visemeCount} viseme keys` : "No timing yet"}
                </span>
                <button
                  type="button"
                  onClick={onGenerateLipSync}
                  disabled={!!busyLabel || !voiceText.trim()}
                  className="rounded bg-primary px-2 py-1 text-ui-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {visemeCount > 0 ? "Re-generate lip sync" : "Generate lip sync"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="rounded bg-destructive/20 px-2 py-1 text-ui-sm text-destructive-foreground">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded border border-primary/40 bg-primary/10 px-2 py-1 text-ui-sm text-primary">
          {notice}
        </div>
      )}

      <audio ref={previewRef} className="hidden" onEnded={() => setPreviewId(null)} />

      <div className="rounded border border-border">
        <button
          type="button"
          onClick={() => setLibraryOpen((v) => !v)}
          className="flex w-full items-center gap-1 px-2 py-1.5"
        >
          {libraryOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="flex-1 text-left text-ui-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Voice library
          </span>
          <span className="text-ui-sm text-muted-foreground">{audioAssets.length}</span>
        </button>
        {libraryOpen && (
          <div className="px-2 pb-2">
            {audioAssets.length === 0 ? (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="w-full rounded border border-dashed border-border bg-panel px-2 py-2 text-left text-ui-sm text-muted-foreground hover:text-foreground"
              >
                No voices yet. Open “Create a new voice” below to generate or upload one.
              </button>
            ) : (
              <ul className="max-h-44 space-y-1 overflow-auto">
                {audioAssets.map((asset) => {
                  const inUse = speeches.some((s) => s.audioId === asset.id);
                  const ready = (asset.visemes?.length ?? 0) > 0;
                  const playing = previewId === asset.id;
                  return (
                    <li
                      key={asset.id}
                      className={`flex items-center gap-1.5 rounded border px-1.5 py-1 ${
                        inUse ? "border-primary/40 bg-primary/5" : "border-border bg-panel"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => void togglePreview(asset.id)}
                        title={playing ? "Pause" : "Play"}
                        aria-label={playing ? "Pause preview" : "Play preview"}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-panel-2 hover:text-foreground"
                      >
                        {playing ? <Pause size={12} /> : <Play size={12} />}
                      </button>
                      <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground">
                        {asset.name}
                      </span>
                      {asset.duration ? (
                        <span className="shrink-0 text-ui-sm text-muted-foreground">
                          {asset.duration.toFixed(1)}s
                        </span>
                      ) : null}
                      {ready && (
                        <span
                          className="shrink-0 text-ui-sm text-primary"
                          title={`${asset.visemes?.length} viseme keys`}
                        >
                          ♪
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => void onAttachVoice(asset.id)}
                        disabled={!!busyLabel}
                        title={inUse ? "Add another instance of this voice" : "Add this voice"}
                        className="shrink-0 rounded border border-border px-2 py-0.5 text-ui-sm hover:bg-panel-2 disabled:opacity-50"
                      >
                        Add
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="rounded border border-border">
        <button
          type="button"
          onClick={() => setCreateOpen((v) => !v)}
          className="flex w-full items-center gap-1 px-2 py-1.5"
        >
          {createOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="flex-1 text-left text-ui-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Create a new voice
          </span>
        </button>
        {createOpen && (
          <div className="space-y-3 px-2 pb-2">
            <div className="space-y-2">
              <div className="text-ui-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Text to speech
              </div>
              <textarea
                value={ttsText}
                onChange={(e) => setTtsText(e.target.value)}
                rows={3}
                placeholder="What should this character say?"
                className="w-full rounded border border-border bg-input px-2 py-1 text-foreground"
              />

              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <label className="block">
                  <span className="mb-1 block text-ui-sm uppercase tracking-wider text-muted-foreground">
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
                <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-ui-sm text-amber-100">
                  {voicesError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-ui-sm uppercase tracking-wider text-muted-foreground">
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
                  <span className="mb-1 block text-ui-sm uppercase tracking-wider text-muted-foreground">
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
                  <span className="mb-1 block text-ui-sm uppercase tracking-wider text-muted-foreground">
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

              <button
                type="button"
                onClick={onGenerate}
                disabled={!!busyLabel || !ttsText.trim() || !selectedVoice}
                className="w-full rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {busyLabel === "Generating voice" ? busyLabel : "Generate voice"}
              </button>
            </div>

            <div className="space-y-2 border-t border-border pt-3">
              <div className="text-ui-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Upload audio
              </div>
              <div
                onDragOver={onDragOver}
                onDragLeave={() => setDraggingAudio(false)}
                onDrop={onDrop}
                className={`rounded border border-dashed px-3 py-3 text-center text-ui-sm ${
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
              </div>
              <label className="block">
                <span className="mb-1 block text-ui-sm uppercase tracking-wider text-muted-foreground">
                  Transcript (optional)
                </span>
                <textarea
                  value={uploadText}
                  onChange={(e) => setUploadText(e.target.value)}
                  rows={2}
                  placeholder="Add a transcript to create lip-sync timing on upload…"
                  className="w-full rounded border border-border bg-input px-2 py-1 text-foreground"
                />
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SpeechStartInput({
  speechId,
  value,
  onCommit,
}: {
  speechId: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const formattedValue = String(Math.round(value * 100) / 100);
  const [draft, setDraft] = useState(formattedValue);

  useEffect(() => {
    setDraft(formattedValue);
  }, [formattedValue, speechId]);

  const commit = (nextDraft: string) => {
    const trimmed = nextDraft.trim();
    const parsed = Number(trimmed);
    if (trimmed === "" || !Number.isFinite(parsed)) {
      setDraft(formattedValue);
      return;
    }
    if (parsed !== value) onCommit(parsed);
  };

  return (
    <input
      type="number"
      min={0}
      step={0.1}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => commit(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.currentTarget.value = formattedValue;
          setDraft(formattedValue);
          event.currentTarget.blur();
        } else if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
      className="w-12 rounded border border-border bg-input px-1 py-0.5 text-right text-foreground"
    />
  );
}

function SpeechVolumeInput({
  speechId,
  value,
  onCommit,
}: {
  speechId: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const committedValueRef = useRef(value);

  useEffect(() => {
    setDraft(value);
    committedValueRef.current = value;
  }, [speechId, value]);

  const commit = (nextValue: number) => {
    if (nextValue === committedValueRef.current) return;
    committedValueRef.current = nextValue;
    onCommit(nextValue);
  };

  return (
    <>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={draft}
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={(event) => commit(Number(event.currentTarget.value))}
        onPointerCancel={(event) => commit(Number(event.currentTarget.value))}
        onKeyUp={(event) => commit(Number(event.currentTarget.value))}
        onBlur={(event) => commit(Number(event.currentTarget.value))}
        className="flex-1"
      />
      <span className="w-8 shrink-0 text-right text-foreground">{Math.round(draft * 100)}%</span>
    </>
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
      <span className="mb-1 block text-ui-sm uppercase tracking-wider text-muted-foreground">
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
