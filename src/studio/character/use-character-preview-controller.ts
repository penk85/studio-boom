// Character Editor preview timing plus cancellable Web Audio mouth-test lifecycle.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { ID, MouthViseme } from "../types";
import type { PreviewState } from "./character-editor-preview";

interface MouthPreviewPlayback {
  slotId: ID;
  targetPartId: ID;
  url: string;
  scriptedVisemes?: MouthViseme[];
}

interface PreviewControllerOptions {
  onError: (message: string) => void;
}

interface AudioLifecycle {
  generation: number;
  abort: AbortController | null;
  context: AudioContext | null;
  source: AudioBufferSourceNode | null;
  raf: number | null;
}

export function scriptedVisemeAtTime(
  visemes: MouthViseme[],
  elapsedMs: number,
  durationMs: number,
): MouthViseme {
  if (visemes.length === 0) return "rest";
  const progress = Math.max(0, Math.min(1, elapsedMs / Math.max(1, durationMs)));
  const index = Math.min(visemes.length - 1, Math.floor(progress * visemes.length));
  return visemes[index] ?? "rest";
}

export function amplitudeViseme(data: Uint8Array): MouthViseme {
  if (data.length === 0) return "rest";
  const mean = data.reduce((sum, value) => sum + value, 0) / data.length;
  if (mean > 55) return "A";
  if (mean > 38) return "E";
  if (mean > 22) return "O";
  if (mean > 10) return "MBP";
  return "rest";
}

export function useCharacterPreviewController({ onError }: PreviewControllerOptions): {
  preview: PreviewState | null;
  setPreview: Dispatch<SetStateAction<PreviewState | null>>;
  previewTick: number;
  mouthTestPlaying: boolean;
  playMouthClip: (playback: MouthPreviewPlayback) => Promise<void>;
  stopMouthTestAudio: () => void;
} {
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewTick, setPreviewTick] = useState(0);
  const [mouthTestPlaying, setMouthTestPlaying] = useState(false);
  const onErrorRef = useRef(onError);
  const audioRef = useRef<AudioLifecycle>({
    generation: 0,
    abort: null,
    context: null,
    source: null,
    raf: null,
  });

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!preview || preview.audioDriven) return;
    const timeout = window.setTimeout(() => setPreview(null), preview.durationMs);
    const interval = window.setInterval(() => setPreviewTick((tick) => tick + 1), 50);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [preview]);

  const stopAudioResources = useCallback((updateState: boolean) => {
    const audio = audioRef.current;
    audio.generation += 1;
    audio.abort?.abort();
    audio.abort = null;
    if (audio.raf !== null) cancelAnimationFrame(audio.raf);
    audio.raf = null;
    if (audio.source) {
      audio.source.onended = null;
      try {
        audio.source.stop();
      } catch {
        // The source may already have ended; its resources still need releasing.
      }
    }
    audio.source = null;
    void audio.context?.close();
    audio.context = null;
    if (updateState) {
      setMouthTestPlaying(false);
      setPreview(null);
    }
  }, []);

  const stopMouthTestAudio = useCallback(() => {
    stopAudioResources(true);
  }, [stopAudioResources]);

  useEffect(
    () => () => {
      stopAudioResources(false);
    },
    [stopAudioResources],
  );

  const playMouthClip = useCallback(
    async ({ slotId, targetPartId, url, scriptedVisemes }: MouthPreviewPlayback): Promise<void> => {
      stopAudioResources(true);
      const audio = audioRef.current;
      const generation = audio.generation;
      const abort = new AbortController();
      audio.abort = abort;
      try {
        const response = await fetch(url, { signal: abort.signal });
        if (!response.ok) throw new Error(`Could not load test audio (${response.status}).`);
        const encoded = await response.arrayBuffer();
        if (audio.generation !== generation || abort.signal.aborted) return;

        const context = new AudioContext();
        if (audio.generation !== generation || abort.signal.aborted) {
          void context.close();
          return;
        }
        audio.context = context;
        const audioBuffer = await context.decodeAudioData(encoded);
        if (audio.generation !== generation || abort.signal.aborted) {
          void context.close();
          return;
        }

        const durationMs = audioBuffer.duration * 1000;
        const source = context.createBufferSource();
        source.buffer = audioBuffer;
        audio.source = source;
        let analyser: AnalyserNode | null = null;
        let frequencyData: Uint8Array<ArrayBuffer> | null = null;
        if (scriptedVisemes) {
          source.connect(context.destination);
        } else {
          analyser = context.createAnalyser();
          analyser.fftSize = 256;
          frequencyData = new Uint8Array(analyser.frequencyBinCount);
          source.connect(analyser);
          analyser.connect(context.destination);
        }

        const startedAt = Date.now();
        source.onended = () => {
          if (audio.generation === generation) stopAudioResources(true);
        };
        source.start();
        setMouthTestPlaying(true);
        setPreview({
          kind: "talk",
          targetPartId,
          targetSlotId: slotId,
          targetRole: "mouth",
          startedAt,
          durationMs,
          audioDriven: true,
          forcedViseme: "rest",
        });

        const tick = () => {
          if (audio.generation !== generation) return;
          let viseme: MouthViseme = "rest";
          if (scriptedVisemes) {
            viseme = scriptedVisemeAtTime(scriptedVisemes, Date.now() - startedAt, durationMs);
          } else if (analyser && frequencyData) {
            analyser.getByteFrequencyData(frequencyData);
            viseme = amplitudeViseme(frequencyData);
          }
          setPreview((current) =>
            current?.audioDriven ? { ...current, forcedViseme: viseme } : current,
          );
          audio.raf = requestAnimationFrame(tick);
        };
        audio.raf = requestAnimationFrame(tick);
      } catch (error) {
        if (audio.generation !== generation || abort.signal.aborted) return;
        stopAudioResources(true);
        onErrorRef.current(error instanceof Error ? error.message : "Could not play test audio.");
      }
    },
    [stopAudioResources],
  );

  return {
    preview,
    setPreview,
    previewTick,
    mouthTestPlaying,
    playMouthClip,
    stopMouthTestAudio,
  };
}
