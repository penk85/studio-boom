import { useEffect, useRef, useState } from "react";
import { EYE_PRESETS, MOUTH_PRESETS, generatePresetBlob } from "./presets";
import { clamp } from "./mouth-morph";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
  MousePointer2,
  RotateCw,
  Trash2,
  Upload,
} from "lucide-react";
import { db, importMediaFile, uid } from "../db";
import { useMediaUrl } from "../hooks/useMediaUrl";
import { useStudio } from "../store";
import {
  createBlankCharacter,
  defaultMotionBehaviorForRole,
  getPartSlotId,
  makePart,
  normalizeCharacterSlots,
  normalizePartManifest,
  roleEnabledByManifest,
  roleLabel,
  saveCharacter,
} from "./character-utils";
import {
  alphaMaskContains,
  alphaCenterForPart,
  createAlphaHitMaskFromBlob,
  editorControlBounds,
  editorSelectionBounds,
  localAlphaBounds,
  measureAlphaBoundsFromBlob,
  pivotForPart,
  pointInEditorHitBounds,
  type AlphaHitMask,
} from "./alpha-bounds";
import { MOUTH_VISEMES, MOUTH_VISEME_DESCRIPTIONS } from "../lipsync/viseme-schema";
import type {
  CharacterAngle,
  CharacterPart,
  CharacterPartBounds,
  CharacterPreset,
  CharacterRig,
  EyeState,
  ID,
  MouthViseme,
  PartMotionBehavior,
  PartManifest,
  PartRole,
} from "../types";
import {
  CHARACTER_ANGLES,
  bindSlotPartToAngle,
  buildDefaultRig,
  characterRigPrompt,
  clampHostedPartPosition,
  computeBoneWorldTransforms,
  moveBone,
  moveBoneForSlot,
  movePartAndDescendants,
  moveSlotBinding,
  moveSlotParts,
  normalizeCharacterRig,
  resolveSlotBinding,
  setBoneDepth,
  setSlotDepth,
  slotIdsForBoneSubtree,
  validateCharacterRig,
} from "./rig";

interface Props {
  characterId: string;
  onClose: () => void;
}

const CANVAS_PRESETS = [
  { label: "Portrait", width: 600, height: 900 },
  { label: "Square", width: 1000, height: 1000 },
  { label: "Landscape", width: 1280, height: 720 },
  { label: "Custom", width: 900, height: 900 },
];

const SLOT_DEFS: Array<{ label: string; role: PartRole; side?: CharacterPart["side"] }> = [
  { label: "Head", role: "head" },
  { label: "Body", role: "body" },
  { label: "Left Eye", role: "eye", side: "left" },
  { label: "Right Eye", role: "eye", side: "right" },
  { label: "Left Eyebrow", role: "eyebrow", side: "left" },
  { label: "Right Eyebrow", role: "eyebrow", side: "right" },
  { label: "Left Arm", role: "arm", side: "left" },
  { label: "Right Arm", role: "arm", side: "right" },
  { label: "Left Hand", role: "hand", side: "left" },
  { label: "Right Hand", role: "hand", side: "right" },
  { label: "Left Leg", role: "leg", side: "left" },
  { label: "Right Leg", role: "leg", side: "right" },
  { label: "Left Foot", role: "foot", side: "left" },
  { label: "Right Foot", role: "foot", side: "right" },
  { label: "Hair Back", role: "hair", side: "back" },
  { label: "Hair Front", role: "hair", side: "front" },
  { label: "Accessory", role: "accessory" },
];

const ROLE_OPTIONS: PartRole[] = [
  "head",
  "body",
  "eye",
  "eyebrow",
  "mouth",
  "arm",
  "hand",
  "leg",
  "foot",
  "hair",
  "accessory",
  "static",
  "custom",
];

const MOTION_BEHAVIOR_OPTIONS: Array<{ value: PartMotionBehavior; label: string }> = [
  { value: "none", label: "None" },
  { value: "blink", label: "Blink" },
  { value: "rotate", label: "Rotate" },
  { value: "raise", label: "Raise" },
  { value: "lipSync", label: "Lip Sync" },
  { value: "bounce", label: "Bounce" },
];

const SAMPLE_WORDS = ["Hello", "Shalom", "Mommy", "Welcome"];
const EYE_STATES: EyeState[] = ["open", "half", "closed", "wink"];

// Lip-sync test clips: drop audio files into ./lipsync-samples and they appear
// automatically as test buttons on the mouth group inspector. (Vite glob — no
// manifest to edit.)
const LIPSYNC_SAMPLES = Object.entries(
  import.meta.glob("./lipsync-samples/*.{mp3,wav,m4a,ogg,aac}", {
    eager: true,
    query: "?url",
    import: "default",
  }) as Record<string, string>,
)
  .map(([path, url]) => ({
    name:
      path
        .split("/")
        .pop()
        ?.replace(/\.[^.]+$/, "") ?? "clip",
    url,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

type EditorMode = "select" | "pivot" | "bounds-rect" | "bounds-ellipse";
type EditorBoundsMode = "frame" | "art";

export function CharacterEditor({ characterId, onClose }: Props) {
  const [doc, setDoc] = useState<CharacterPreset | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<ID | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<ID | null>(null);
  const [selectedBoneId, setSelectedBoneId] = useState<ID | null>(null);
  const [scale, setScale] = useState(0.7);
  const [mode, setMode] = useState<EditorMode>("select");
  const [boundsMode, setBoundsMode] = useState<EditorBoundsMode>("frame");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [, setPreviewTick] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [mouthTestPlaying, setMouthTestPlaying] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const mouthAudioCtxRef = useRef<AudioContext | null>(null);
  const mouthAudioRafRef = useRef<number | null>(null);
  const alphaBackfillRef = useRef<Set<string>>(new Set());
  const alphaMaskRef = useRef<Map<string, AlphaHitMask>>(new Map());
  const alphaMaskLoadingRef = useRef<Set<string>>(new Set());
  const [, setAlphaMaskTick] = useState(0);

  useEffect(() => {
    (async () => {
      let row = await db.characters.get(characterId);
      if (!row) {
        row = createBlankCharacter();
        row.id = characterId;
        await db.characters.put(row);
        useStudio.getState().registerCharacterPreset(row);
      }
      const normalized = normalizeCharacterSlots(row);
      setDoc({ ...normalized, rig: normalizeCharacterRig(normalized) });
    })();
  }, [characterId]);

  useEffect(() => {
    if (!doc) return;
    const t = window.setTimeout(() => {
      void saveCharacter(doc).then((saved) => {
        useStudio.getState().registerCharacterPreset(saved);
      });
    }, 450);
    return () => window.clearTimeout(t);
  }, [doc]);

  useEffect(() => {
    if (!doc || !wrapRef.current) return;
    const ro = new ResizeObserver(() => {
      const el = wrapRef.current;
      if (!el) return;
      const w = el.clientWidth - 64;
      const h = el.clientHeight - 64;
      setScale(Math.max(0.12, Math.min(w / doc.canvasWidth, h / doc.canvasHeight, 1.4)));
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [doc]);

  useEffect(() => {
    if (!doc) return;
    const missing = doc.parts.filter(
      (part) => !part.alphaBounds && !alphaBackfillRef.current.has(part.id),
    );
    if (missing.length === 0) return;
    for (const part of missing) alphaBackfillRef.current.add(part.id);
    let alive = true;
    void (async () => {
      const measured = await Promise.all(
        missing.map(async (part) => {
          const [blobRow, media] = await Promise.all([
            db.mediaBlobs.get(part.mediaId),
            db.media.get(part.mediaId),
          ]);
          if (!blobRow?.blob) return null;
          const alphaBounds = await measureAlphaBoundsFromBlob(
            blobRow.blob,
            media?.width ?? part.width,
            media?.height ?? part.height,
          );
          return { id: part.id, alphaBounds };
        }),
      );
      const patches = measured.filter(Boolean) as NonNullable<(typeof measured)[number]>[];
      if (!alive || patches.length === 0) return;
      setDoc((current) => {
        if (!current) return current;
        const patchMap = new Map(patches.map((patch) => [patch.id, patch.alphaBounds] as const));
        return {
          ...current,
          parts: current.parts.map((part) => {
            const alphaBounds = patchMap.get(part.id);
            if (!alphaBounds || part.alphaBounds) return part;
            return normalizePartPatch({ ...part, alphaBounds }, { alphaBounds });
          }),
          updatedAt: Date.now(),
        };
      });
    })();
    return () => {
      alive = false;
    };
  }, [doc]);

  useEffect(() => {
    if (!doc) return;
    const missingMasks = doc.parts.filter(
      (part) => !alphaMaskRef.current.has(part.id) && !alphaMaskLoadingRef.current.has(part.id),
    );
    if (missingMasks.length === 0) return;
    for (const part of missingMasks) alphaMaskLoadingRef.current.add(part.id);
    let alive = true;
    void (async () => {
      const masks = await Promise.all(
        missingMasks.map(async (part) => {
          const [blobRow, media] = await Promise.all([
            db.mediaBlobs.get(part.mediaId),
            db.media.get(part.mediaId),
          ]);
          if (!blobRow?.blob) return null;
          const mask = await createAlphaHitMaskFromBlob(
            blobRow.blob,
            media?.width ?? part.width,
            media?.height ?? part.height,
          );
          return mask ? { id: part.id, mask } : null;
        }),
      );
      if (!alive) return;
      for (const item of masks) {
        if (item) alphaMaskRef.current.set(item.id, item.mask);
      }
      setAlphaMaskTick((tick) => tick + 1);
    })();
    return () => {
      alive = false;
    };
  }, [doc]);

  useEffect(() => {
    if (!preview) return;
    // Audio-driven tests update the preview each frame and clear it on playback end.
    if (preview.audioDriven) return;
    const t = window.setTimeout(() => setPreview(null), preview.durationMs);
    const interval = window.setInterval(() => setPreviewTick((n) => n + 1), 50);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(interval);
    };
  }, [preview]);

  if (!doc) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        Loading character…
      </div>
    );
  }

  const withRig = (character: CharacterPreset, preserveRig = false): CharacterPreset => ({
    ...character,
    rig: preserveRig ? normalizeCharacterRig(character) : buildDefaultRig(character),
  });

  const updateDoc = (patch: Partial<CharacterPreset>) =>
    setDoc((d) => (d ? withRig({ ...d, ...patch, updatedAt: Date.now() }, "rig" in patch) : d));

  const updatePart = (id: ID, patch: Partial<CharacterPart>) =>
    setDoc((d) =>
      d
        ? withRig({
            ...d,
            parts: d.parts.map((p) =>
              p.id === id ? normalizePartPatch({ ...p, ...patch }, patch) : p,
            ),
            updatedAt: Date.now(),
          })
        : d,
    );

  const addPart = (part: CharacterPart) => {
    setDoc((d) => (d ? withRig({ ...d, parts: [...d.parts, part], updatedAt: Date.now() }) : d));
    setSelectedPartId(part.id);
  };

  const removePart = (id: ID) => {
    setDoc((d) =>
      d
        ? withRig({
            ...d,
            parts: d.parts
              .filter((p) => p.id !== id)
              .map((p) => (p.parentId === id ? { ...p, parentId: undefined } : p)),
            updatedAt: Date.now(),
          })
        : d,
    );
    if (selectedPartId === id) setSelectedPartId(null);
  };

  const duplicatePart = (part: CharacterPart) => {
    const nextId = uid();
    addPart({
      ...part,
      id: nextId,
      slotId: part.role === "custom" ? `custom:${nextId}` : `${part.slotId}:copy:${nextId}`,
      name: `${part.name} copy`,
      x: part.x + 24,
      y: part.y + 24,
      zIndex: maxZ(doc.parts) + 1,
      parentId: undefined,
    });
  };

  const importSvg = async (file: File, options: ImportOptions = {}) => {
    try {
      const asset = await importMediaFile(file, { scope: "character-part" });
      useStudio.getState().registerMediaAsset(asset);
      const role = options.role ?? detectRole(file.name);
      const side = options.side ?? detectSide(file.name);
      const viseme = options.viseme ?? (role === "mouth" ? detectViseme(file.name) : undefined);
      const eyeState = options.eyeState ?? (role === "eye" ? detectEyeState(file.name) : undefined);
      const fitted = fitAsset(asset.width, asset.height, doc.canvasWidth, doc.canvasHeight);
      const alphaBounds = await measureAlphaBoundsFromBlob(file, asset.width, asset.height);
      const id = uid();
      const label = options.label ?? asset.name;
      const part = makePart(role, asset.id, {
        id,
        name: label,
        slotId: options.slotId ?? slotIdForImport(role, label, viseme, id, side),
        slotName: label,
        side,
        viseme,
        eyeState,
        alphaBounds,
        ...fitted,
        ...options.placement,
        zIndex: options.zIndex ?? maxZ(doc.parts) + 1,
        motionBehavior: defaultMotionBehaviorForRole(role, viseme),
      });
      addPart(part);
      setStatus(`${file.name} added`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not import SVG.");
    }
  };

  const selectedPart = doc.parts.find((p) => p.id === selectedPartId) ?? null;
  const orderedParts = doc.parts.slice().sort((a, b) => a.zIndex - b.zIndex);

  const selectPart = (id: ID) => {
    setSelectedPartId(id);
    setSelectedSlotId(null);
    setSelectedBoneId(null);
  };
  const selectSlot = (slotId: ID) => {
    setSelectedSlotId(slotId);
    setSelectedPartId(null);
    setSelectedBoneId(null);
  };
  const selectBone = (boneId: ID) => {
    setSelectedBoneId(boneId);
    setSelectedPartId(null);
    setSelectedSlotId(null);
  };

  const partsInSlot = (slotId: ID) => doc.parts.filter((p) => getPartSlotId(p) === slotId);

  const toggleSlotVisible = (slotId: ID) => {
    const anyVisible = partsInSlot(slotId).some((p) => p.visible);
    setDoc((d) =>
      d
        ? withRig({
            ...d,
            parts: d.parts.map((p) =>
              getPartSlotId(p) === slotId ? { ...p, visible: !anyVisible } : p,
            ),
            updatedAt: Date.now(),
          })
        : d,
    );
  };

  const nudgeSlotZ = (slotId: ID, delta: number) => {
    setDoc((d) =>
      d
        ? withRig({
            ...d,
            parts: d.parts.map((p) =>
              getPartSlotId(p) === slotId ? { ...p, zIndex: p.zIndex + delta } : p,
            ),
            updatedAt: Date.now(),
          })
        : d,
    );
  };

  const removeSlot = (slotId: ID) => {
    setDoc((d) =>
      d
        ? withRig({
            ...d,
            parts: d.parts.filter((p) => getPartSlotId(p) !== slotId),
            updatedAt: Date.now(),
          })
        : d,
    );
    if (selectedSlotId === slotId) setSelectedSlotId(null);
  };

  // Commit a one-shot group move (used by the Inspector numeric fields).
  const applyGroupMove = (slotId: ID, dx: number, dy: number) => {
    setDoc((d) =>
      d
        ? withRig(
            {
              ...d,
              parts: moveSlotParts(d, slotId, dx, dy, { clampToHost: true }),
              rig: moveSlotBinding(normalizeCharacterRig(d), slotId, dx, dy),
              updatedAt: Date.now(),
            },
            true,
          )
        : d,
    );
  };

  // Commit a one-shot group scale around a fixed anchor corner.
  const applyGroupScale = (
    slotId: ID,
    anchor: { x: number; y: number },
    scaleX: number,
    scaleY: number,
  ) => {
    setDoc((d) =>
      d
        ? withRig({
            ...d,
            parts: d.parts.map((p) => {
              if (getPartSlotId(p) !== slotId) return p;
              const pivot = pivotForPart(p);
              return {
                ...p,
                x: Math.round(anchor.x + (p.x - anchor.x) * scaleX),
                y: Math.round(anchor.y + (p.y - anchor.y) * scaleY),
                width: Math.max(4, Math.round(p.width * scaleX)),
                height: Math.max(4, Math.round(p.height * scaleY)),
                pivot: {
                  x: Math.round(anchor.x + (pivot.x - anchor.x) * scaleX),
                  y: Math.round(anchor.y + (pivot.y - anchor.y) * scaleY),
                },
              };
            }),
            updatedAt: Date.now(),
          })
        : d,
    );
  };

  // Representative (rest) part of a mouth slot — used as the talk preview target.
  const mouthSlotRepId = (slotId: ID) => {
    const ps = partsInSlot(slotId);
    return (ps.find((p) => p.viseme === "rest") ?? ps[0])?.id ?? "";
  };

  // Find an audio clip attached to a sample word (file named after the word).
  const sampleForWord = (word: string) =>
    LIPSYNC_SAMPLES.find((s) => s.name.toLowerCase() === word.toLowerCase());

  // Word lip-sync test: play the attached clip (if any) with the word's scripted
  // visemes timed to it; otherwise fall back to a silent shape preview.
  const testMouthWord = (slotId: ID, word: string) => {
    const sample = sampleForWord(word);
    if (sample) {
      void playMouthClip(slotId, sample.url, wordToVisemes(word));
      return;
    }
    setPreview({
      kind: "talk",
      targetPartId: mouthSlotRepId(slotId),
      targetSlotId: slotId,
      targetRole: "mouth",
      startedAt: Date.now(),
      durationMs: 1300,
      visemes: wordToVisemes(word),
    });
  };

  const stopMouthTestAudio = () => {
    if (mouthAudioRafRef.current) cancelAnimationFrame(mouthAudioRafRef.current);
    mouthAudioRafRef.current = null;
    void mouthAudioCtxRef.current?.close();
    mouthAudioCtxRef.current = null;
    setMouthTestPlaying(false);
    setPreview(null);
  };

  // Play a clip and drive the mouth slot's visemes. With `scriptedVisemes` the
  // sequence is timed to the clip's duration (correct shapes synced to audio);
  // without it, the mouth is driven by live amplitude (rough, for arbitrary clips).
  const playMouthClip = async (slotId: ID, url: string, scriptedVisemes?: MouthViseme[]) => {
    stopMouthTestAudio();
    const repId = mouthSlotRepId(slotId);
    try {
      const buffer = await fetch(url).then((r) => r.arrayBuffer());
      const ctx = new AudioContext();
      mouthAudioCtxRef.current = ctx;
      const audioBuffer = await ctx.decodeAudioData(buffer);
      const durationMs = audioBuffer.duration * 1000;
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      let analyser: AnalyserNode | null = null;
      let data: Uint8Array<ArrayBuffer> | null = null;
      if (scriptedVisemes) {
        source.connect(ctx.destination);
      } else {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        data = new Uint8Array(analyser.frequencyBinCount);
        source.connect(analyser);
        analyser.connect(ctx.destination);
      }
      const startedAt = Date.now();
      source.start();
      setMouthTestPlaying(true);
      setPreview({
        kind: "talk",
        targetPartId: repId,
        targetSlotId: slotId,
        targetRole: "mouth",
        startedAt,
        durationMs,
        audioDriven: true,
        forcedViseme: "rest",
      });
      const tick = () => {
        let v: MouthViseme = "rest";
        if (scriptedVisemes) {
          const t = Math.min(1, (Date.now() - startedAt) / Math.max(1, durationMs));
          const idx = Math.min(scriptedVisemes.length - 1, Math.floor(t * scriptedVisemes.length));
          v = scriptedVisemes[idx] ?? "rest";
        } else if (analyser && data) {
          analyser.getByteFrequencyData(data);
          const mean = data.reduce((s, x) => s + x, 0) / data.length;
          if (mean > 55) v = "A";
          else if (mean > 38) v = "E";
          else if (mean > 22) v = "O";
          else if (mean > 10) v = "MBP";
        }
        setPreview((p) => (p && p.audioDriven ? { ...p, forcedViseme: v } : p));
        mouthAudioRafRef.current = requestAnimationFrame(tick);
      };
      mouthAudioRafRef.current = requestAnimationFrame(tick);
      source.onended = stopMouthTestAudio;
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not play test audio.");
      stopMouthTestAudio();
    }
  };

  const exportData = JSON.stringify(normalizeCharacterSlots(doc), null, 2);
  const manifest = normalizePartManifest(doc.manifest);
  const previewParentPart =
    preview?.targetRole === "head"
      ? orderedParts.find((part) => part.id === preview.targetPartId)
      : undefined;
  const visibleEditorParts = orderedParts.filter((part) =>
    roleEnabledByManifest(part.role, manifest),
  );
  const selectedEditorPart = selectedPart
    ? visibleEditorParts.find((part) => part.id === selectedPart.id)
    : null;
  const selectedSlotParts = selectedSlotId
    ? doc.parts.filter((part) => getPartSlotId(part) === selectedSlotId)
    : [];
  const selectedSlotBounds =
    selectedSlotParts.length > 0 ? unionFrameBounds(selectedSlotParts) : null;

  const canvasPointFromEvent = (e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    };
  };

  const localPointForPart = (part: CharacterPart, point: { x: number; y: number }) =>
    canvasPointToPartLocal(part, point, previewDelta(part, preview, previewParentPart));

  const pickPartAt = (point: { x: number; y: number }) => {
    const exact: CharacterPart[] = [];
    const padded: CharacterPart[] = [];
    const candidates = visibleEditorParts
      .filter((part) => part.visible || part.id === selectedPartId)
      .slice()
      .sort((a, b) => b.zIndex - a.zIndex);

    for (const part of candidates) {
      const transform = previewDelta(part, preview, previewParentPart);
      if (transform.opacity <= 0.05 && part.id !== selectedPartId) continue;
      const local = canvasPointToPartLocal(part, point, transform);
      if (boundsMode === "frame") {
        if (pointInEditorHitBounds(part, local, scale, boundsMode)) exact.push(part);
      } else if (alphaMaskContains(alphaMaskRef.current.get(part.id), part, local)) {
        exact.push(part);
      } else if (pointInEditorHitBounds(part, local, scale, boundsMode)) {
        padded.push(part);
      }
    }
    return exact[0] ?? padded[0] ?? null;
  };

  const startCanvasPartDrag = (
    e: React.PointerEvent,
    part: CharacterPart,
    point: { x: number; y: number },
  ) => {
    if (e.button !== 0) return;
    const localDown = localPointForPart(part, point);
    selectPart(part.id);

    if (mode === "pivot") {
      updatePart(part.id, {
        pivot: {
          x: Math.round(localDown.x + part.x),
          y: Math.round(localDown.y + part.y),
        },
      });
      setMode("select");
      return;
    }

    if (mode.startsWith("bounds")) {
      const bounds = editorSelectionBounds(part, boundsMode);
      updatePart(part.id, {
        bounds: {
          type: mode === "bounds-ellipse" ? "ellipse" : "rect",
          x: Math.round(part.x + bounds.x - bounds.width * 0.08),
          y: Math.round(part.y + bounds.y - bounds.height * 0.08),
          width: Math.round(bounds.width * 1.16),
          height: Math.round(bounds.height * 1.16),
        },
      });
      setMode("select");
      return;
    }

    const sx = e.clientX;
    const sy = e.clientY;
    const ox = part.x;
    const oy = part.y;
    const slotId = getPartSlotId(part);
    const rigSnapshot = normalizeCharacterRig(doc);
    const partSnapshot = new Map(
      doc.parts.map((snapshotPart) => {
        const pivot = pivotForPart(snapshotPart);
        return [snapshotPart.id, { x: snapshotPart.x, y: snapshotPart.y, pivot }] as const;
      }),
    );
    const movesBone = doc.parts.some((candidate) => candidate.parentId === part.id);
    const move = (ev: PointerEvent) => {
      const dx = Math.round((ev.clientX - sx) / scale);
      const dy = Math.round((ev.clientY - sy) / scale);
      setDoc((d) => {
        if (!d) return d;
        const clamped = clampHostedPartPosition(d, slotId, { x: ox + dx, y: oy + dy });
        const appliedDx = clamped.x - ox;
        const appliedDy = clamped.y - oy;
        const snapshotParts = d.parts.map((currentPart) => {
          const snapshotPart = partSnapshot.get(currentPart.id);
          if (!snapshotPart) return currentPart;
          return {
            ...currentPart,
            x: snapshotPart.x,
            y: snapshotPart.y,
            pivot: snapshotPart.pivot,
          };
        });
        const parts = movesBone
          ? movePartAndDescendants(snapshotParts, part.id, appliedDx, appliedDy)
          : moveSlotParts({ ...d, parts: snapshotParts }, slotId, appliedDx, appliedDy, {
              clampToHost: true,
            });
        const rig = movesBone
          ? moveBoneForSlot(rigSnapshot, slotId, appliedDx, appliedDy)
          : moveSlotBinding(rigSnapshot, slotId, appliedDx, appliedDy);
        return withRig({ ...d, parts, rig, updatedAt: Date.now() }, true);
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Drag every variant in a slot together by the same canvas delta.
  const startGroupDrag = (e: React.PointerEvent, slotId: ID) => {
    if (e.button !== 0) return;
    const snapshot = new Map(
      partsInSlot(slotId).map((p) => {
        const pivot = pivotForPart(p);
        return [p.id, { x: p.x, y: p.y, pivot }] as const;
      }),
    );
    const sx = e.clientX;
    const sy = e.clientY;
    const rigSnapshot = normalizeCharacterRig(doc);
    const move = (ev: PointerEvent) => {
      const dx = Math.round((ev.clientX - sx) / scale);
      const dy = Math.round((ev.clientY - sy) / scale);
      setDoc((d) =>
        d
          ? withRig(
              {
                ...d,
                parts: moveSlotParts(
                  {
                    ...d,
                    parts: d.parts.map((p) => {
                      const s = snapshot.get(p.id);
                      if (!s) return p;
                      return { ...p, x: s.x, y: s.y, pivot: s.pivot };
                    }),
                  },
                  slotId,
                  dx,
                  dy,
                  { clampToHost: true },
                ),
                rig: moveSlotBinding(rigSnapshot, slotId, dx, dy),
                updatedAt: Date.now(),
              },
              true,
            )
          : d,
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startBoneDrag = (e: React.PointerEvent, boneId: ID) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    selectBone(boneId);
    const sx = e.clientX;
    const sy = e.clientY;
    const rigSnapshot = normalizeCharacterRig(doc);
    const slotIds = slotIdsForBoneSubtree(rigSnapshot, boneId);
    const snapshot = doc.parts.map((part) => ({
      id: part.id,
      x: part.x,
      y: part.y,
      pivot: pivotForPart(part),
    }));
    const move = (ev: PointerEvent) => {
      const dx = Math.round((ev.clientX - sx) / scale);
      const dy = Math.round((ev.clientY - sy) / scale);
      setDoc((d) =>
        d
          ? withRig(
              {
                ...d,
                parts: moveSlotSetFromSnapshot(d.parts, snapshot, slotIds, dx, dy),
                rig: moveBone(rigSnapshot, boneId, dx, dy),
                updatedAt: Date.now(),
              },
              true,
            )
          : d,
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Resize a whole slot from a corner, scaling every variant around the
  // opposite (fixed) corner of the group's union bounds.
  const startGroupResize = (e: React.PointerEvent, slotId: ID, corner: ResizeCorner) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const parts = partsInSlot(slotId);
    const box = unionFrameBounds(parts);
    const anchor = {
      x: corner.includes("w") ? box.x + box.width : box.x,
      y: corner.includes("n") ? box.y + box.height : box.y,
    };
    const snapshot = parts.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
      pivot: pivotForPart(p),
    }));
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / scale;
      const dy = (ev.clientY - sy) / scale;
      const movingX = corner.includes("w") ? box.x + dx : box.x + box.width + dx;
      const movingY = corner.includes("n") ? box.y + dy : box.y + box.height + dy;
      const scaleX = Math.max(8, Math.abs(anchor.x - movingX)) / Math.max(1, box.width);
      const scaleY = Math.max(8, Math.abs(anchor.y - movingY)) / Math.max(1, box.height);
      setDoc((d) =>
        d
          ? withRig({
              ...d,
              parts: d.parts.map((p) => {
                const s = snapshot.find((q) => q.id === p.id);
                if (!s) return p;
                return {
                  ...p,
                  x: Math.round(anchor.x + (s.x - anchor.x) * scaleX),
                  y: Math.round(anchor.y + (s.y - anchor.y) * scaleY),
                  width: Math.max(4, Math.round(s.width * scaleX)),
                  height: Math.max(4, Math.round(s.height * scaleY)),
                  pivot: {
                    x: Math.round(anchor.x + (s.pivot.x - anchor.x) * scaleX),
                    y: Math.round(anchor.y + (s.pivot.y - anchor.y) * scaleY),
                  },
                };
              }),
              updatedAt: Date.now(),
            })
          : d,
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const handleCanvasPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const point = canvasPointFromEvent(e);
    if (!point) return;
    const picked = pickPartAt(point);
    if (!picked) {
      setSelectedPartId(null);
      setSelectedSlotId(null);
      setSelectedBoneId(null);
      return;
    }
    if (mode === "select") {
      const slotId = getPartSlotId(picked);
      // Keep editing a single variant if one of this slot is already picked.
      const editingVariant =
        selectedPart && !selectedSlotId && getPartSlotId(selectedPart) === slotId;
      if (!editingVariant && partsInSlot(slotId).length > 1) {
        selectSlot(slotId);
        startGroupDrag(e, slotId);
        return;
      }
    }
    startCanvasPartDrag(e, picked, point);
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border bg-panel px-4 py-2">
        <button
          onClick={onClose}
          className="rounded border border-border px-2 py-1 text-xs hover:bg-panel-2"
        >
          ← Studio
        </button>
        <input
          value={doc.name}
          onChange={(e) => updateDoc({ name: e.target.value })}
          className="min-w-0 rounded border border-transparent bg-transparent px-2 py-1 text-sm font-semibold hover:border-border focus:border-primary focus:outline-none"
        />
        <div className="ml-auto flex items-center gap-2">
          {CANVAS_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => updateDoc({ canvasWidth: preset.width, canvasHeight: preset.height })}
              className="rounded border border-border px-2 py-1 text-xs hover:bg-panel-2"
            >
              {preset.label}
            </button>
          ))}
          <button
            onClick={() => navigator.clipboard?.writeText(exportData)}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-panel-2"
            title="Copy structured character data"
          >
            <Download size={13} />
            Export
          </button>
          <button
            onClick={async () => {
              const saved = await saveCharacter(doc);
              useStudio.getState().registerCharacterPreset(saved);
              setDoc(saved);
              onClose();
            }}
            className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            Save & close
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-72 shrink-0 overflow-auto border-r border-border bg-panel p-3 text-xs">
          <StructureEditor
            manifest={manifest}
            onChange={(nextManifest) => updateDoc({ manifest: nextManifest })}
          />
          <UploadSlots onImport={importSvg} parts={doc.parts} manifest={manifest} />
          <LayerList
            parts={orderedParts}
            selectedId={selectedPartId}
            selectedSlotId={selectedSlotId}
            onSelect={selectPart}
            onSelectSlot={selectSlot}
            onChange={updatePart}
            onRemove={removePart}
            onToggleSlotVisible={toggleSlotVisible}
            onNudgeSlotZ={nudgeSlotZ}
            onRemoveSlot={removeSlot}
          />
        </aside>

        <main
          ref={wrapRef}
          className="relative flex min-w-0 flex-1 items-center justify-center bg-stage-bg p-8"
          onDrop={(e) => {
            e.preventDefault();
            Array.from(e.dataTransfer.files)
              .filter((file) => file.name.toLowerCase().endsWith(".svg"))
              .forEach((file) => void importSvg(file));
          }}
          onDragOver={(e) => e.preventDefault()}
        >
          <div
            className="relative bg-white shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)] outline outline-1 outline-border"
            style={{ width: doc.canvasWidth * scale, height: doc.canvasHeight * scale }}
          >
            <div
              ref={canvasRef}
              data-editor-canvas
              onPointerDown={handleCanvasPointerDown}
              className="absolute left-0 top-0 origin-top-left"
              style={{
                width: doc.canvasWidth,
                height: doc.canvasHeight,
                transform: `scale(${scale})`,
              }}
            >
              {visibleEditorParts.map((part) => (
                <PartLayer
                  key={part.id}
                  part={part}
                  selected={part.id === selectedPartId}
                  preview={preview}
                  previewParentPart={previewParentPart}
                />
              ))}
              <RigBonesOverlay
                doc={doc}
                selectedBoneId={selectedBoneId}
                scale={scale}
                onSelectBone={selectBone}
                onStartBoneDrag={startBoneDrag}
              />
              {selectedEditorPart && (
                <PartControlsOverlay
                  part={selectedEditorPart}
                  canvasWidth={doc.canvasWidth}
                  canvasHeight={doc.canvasHeight}
                  scale={scale}
                  boundsMode={boundsMode}
                  onBoundsModeChange={setBoundsMode}
                  preview={preview}
                  previewParentPart={previewParentPart}
                  onChange={(patch) => updatePart(selectedEditorPart.id, patch)}
                />
              )}
              {selectedSlotId && selectedSlotBounds && (
                <GroupControlsOverlay
                  bounds={selectedSlotBounds}
                  scale={scale}
                  onStartMove={(e) => startGroupDrag(e, selectedSlotId)}
                  onStartResize={(e, corner) => startGroupResize(e, selectedSlotId, corner)}
                />
              )}
            </div>
          </div>
          <div className="pointer-events-none absolute bottom-2 right-3 rounded bg-panel/80 px-2 py-1 text-[10px] text-muted-foreground">
            {doc.canvasWidth}×{doc.canvasHeight} · {Math.round(scale * 100)}%
          </div>
          {status && (
            <div className="absolute left-4 top-4 rounded border border-border bg-panel/95 px-3 py-2 text-xs shadow-[var(--shadow-panel)]">
              {status}
            </div>
          )}
        </main>

        <aside className="w-80 shrink-0 overflow-auto border-l border-border bg-panel p-3 text-xs">
          <div className="space-y-4">
            <CanvasControls doc={doc} onChange={(patch) => updateDoc(patch)} />
            <RigPanel
              doc={doc}
              selectedBoneId={selectedBoneId}
              selectedSlotId={selectedSlotId ?? (selectedPart ? getPartSlotId(selectedPart) : null)}
              selectedPart={selectedPart}
              onSelectBone={selectBone}
              onRigChange={(rig) => updateDoc({ rig })}
            />
            <RigAssistant doc={doc} onChange={(patch) => updateDoc(patch)} />
            {selectedSlotId && selectedSlotBounds ? (
              <GroupInspector
                doc={doc}
                slotId={selectedSlotId}
                parts={selectedSlotParts}
                bounds={selectedSlotBounds}
                onMove={(dx, dy) => applyGroupMove(selectedSlotId, dx, dy)}
                onScale={(anchor, sx, sy) => applyGroupScale(selectedSlotId, anchor, sx, sy)}
                onSelectPart={selectPart}
                lipSyncSamples={LIPSYNC_SAMPLES}
                mouthTestPlaying={mouthTestPlaying}
                onTestWord={(word) => testMouthWord(selectedSlotId, word)}
                onTestAudio={(url) => void playMouthClip(selectedSlotId, url)}
                onStopTestAudio={stopMouthTestAudio}
              />
            ) : (
              <Inspector
                doc={doc}
                part={selectedPart}
                mode={mode}
                boundsMode={boundsMode}
                onModeChange={setMode}
                onBoundsModeChange={setBoundsMode}
                onChange={updatePart}
                onRemove={removePart}
                onDuplicate={duplicatePart}
                onPreview={setPreview}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

interface ImportOptions {
  role?: PartRole;
  side?: CharacterPart["side"];
  viseme?: MouthViseme;
  eyeState?: EyeState;
  label?: string;
  slotId?: string;
  placement?: Partial<Pick<CharacterPart, "x" | "y" | "width" | "height" | "rotation" | "pivot">>;
  zIndex?: number;
}

const STRUCTURE_OPTIONS: Array<{ key: keyof PartManifest; label: string }> = [
  { key: "hasHead", label: "Head" },
  { key: "hasBody", label: "Body" },
  { key: "hasArms", label: "Arms" },
  { key: "hasHands", label: "Hands" },
  { key: "hasLegs", label: "Legs" },
  { key: "hasFeet", label: "Feet" },
  { key: "hasEyes", label: "Eyes" },
  { key: "hasBrows", label: "Eyebrows" },
  { key: "hasMouth", label: "Mouth" },
  { key: "hasHair", label: "Hair" },
  { key: "hasAccessories", label: "Accessories" },
];

function StructureEditor({
  manifest,
  onChange,
}: {
  manifest: PartManifest;
  onChange: (manifest: PartManifest) => void;
}) {
  return (
    <div className="mb-3 rounded border border-border bg-panel-2 p-2">
      <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
        Character Structure
      </div>
      <div className="grid grid-cols-2 gap-1">
        {STRUCTURE_OPTIONS.map((item) => (
          <label key={item.key} className="flex items-center gap-1.5 text-[11px]">
            <input
              type="checkbox"
              checked={manifest[item.key]}
              onChange={(e) => onChange({ ...manifest, [item.key]: e.target.checked })}
            />
            {item.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function UploadSlots({
  onImport,
  parts,
  manifest,
}: {
  onImport: (file: File, options?: ImportOptions) => void;
  parts: CharacterPart[];
  manifest: PartManifest;
}) {
  return (
    <div className="space-y-3">
      <div>
        <div className="font-semibold uppercase tracking-wider text-muted-foreground">
          SVG Parts
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          Drop SVGs on the canvas or upload into a slot.
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {SLOT_DEFS.filter(
          (slot) => slot.role !== "eye" && roleEnabledByManifest(slot.role, manifest),
        ).map((slot) => (
          <SlotUpload
            key={`${slot.label}-${slot.role}`}
            label={slot.label}
            filled={parts.some((p) => p.slotName === slot.label)}
            onUpload={(file) =>
              onImport(file, {
                role: slot.role,
                side: slot.side,
                label: slot.label,
                slotId: `slot:${slug(slot.label)}`,
              })
            }
          />
        ))}
        <SlotUpload
          label="+ Custom"
          filled={false}
          onUpload={(file) =>
            onImport(file, { role: "custom", label: file.name.replace(/\.svg$/i, "") })
          }
        />
      </div>
      {manifest.hasEyes && (
        <div className="rounded border border-border bg-panel-2 p-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold uppercase tracking-wider text-muted-foreground">
              Eye States
            </span>
            <span className="text-[10px] text-muted-foreground">(optional)</span>
          </div>
          <EyePresetSelector onImport={onImport} />
          <div className="text-[10px] text-muted-foreground mb-2">
            Or upload eye state variants:
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {(["left", "right"] as const).flatMap((side) =>
              EYE_STATES.map((eyeState) => {
                const label = `${side === "left" ? "Left" : "Right"} ${eyeState}`;
                return (
                  <SlotUpload
                    key={`${side}-${eyeState}`}
                    compact
                    label={label}
                    filled={parts.some(
                      (p) => p.role === "eye" && p.side === side && p.eyeState === eyeState,
                    )}
                    onUpload={(file) =>
                      onImport(file, {
                        role: "eye",
                        side,
                        eyeState,
                        label,
                        slotId: `slot:${side}-eye`,
                        zIndex: 50,
                      })
                    }
                  />
                );
              }),
            )}
          </div>
        </div>
      )}
      {manifest.hasMouth && <MouthShapeSetup parts={parts} onImport={onImport} />}
    </div>
  );
}

function SlotUpload({
  label,
  filled,
  compact,
  onUpload,
}: {
  label: string;
  filled: boolean;
  compact?: boolean;
  onUpload: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        onClick={() => inputRef.current?.click()}
        className={`flex items-center justify-between gap-2 rounded border px-2 text-left hover:bg-panel ${
          compact ? "py-1" : "py-2"
        } ${filled ? "border-primary/60 bg-primary/10" : "border-border bg-panel-2"}`}
      >
        <span className="truncate">{label}</span>
        <Upload size={13} className="shrink-0 text-muted-foreground" />
      </button>
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        accept=".svg,image/svg+xml"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
    </>
  );
}

function MouthShapeSetup({
  parts,
  onImport,
}: {
  parts: CharacterPart[];
  onImport: (file: File, options?: ImportOptions) => void;
}) {
  return (
    <div className="rounded border border-border bg-panel-2 p-2">
      <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
        Mouth Shapes
      </div>
      <MouthPresetSelector onImport={onImport} />
      <div className="mb-2 text-[10px] text-muted-foreground">Or upload mouth shape variants:</div>
      <div className="grid grid-cols-2 gap-1.5">
        {MOUTH_VISEMES.map((viseme) => {
          const part = parts.find((p) => p.role === "mouth" && p.viseme === viseme);
          return (
            <SlotUpload
              key={viseme}
              compact
              label={viseme}
              filled={Boolean(part)}
              onUpload={(file) =>
                onImport(file, {
                  role: "mouth",
                  viseme,
                  label: `Mouth ${viseme}`,
                  slotId: "role:mouth",
                  zIndex: 60,
                })
              }
            />
          );
        })}
      </div>
    </div>
  );
}

const VISEME_ORDER: MouthViseme[] = ["rest", "A", "E", "O", "U", "MBP", "FV", "L", "WQ", "Smile"];
const EYE_STATE_ORDER: EyeState[] = ["open", "half", "closed", "wink"];

function variantLabel(part: CharacterPart) {
  if (part.role === "mouth" && part.viseme) return part.viseme;
  if (part.role === "eye" && part.eyeState) return part.eyeState;
  return part.name;
}

function orderVariants(parts: CharacterPart[]) {
  return parts.slice().sort((a, b) => {
    if (a.role === "mouth" && b.role === "mouth") {
      return VISEME_ORDER.indexOf(a.viseme ?? "rest") - VISEME_ORDER.indexOf(b.viseme ?? "rest");
    }
    if (a.role === "eye" && b.role === "eye") {
      return (
        EYE_STATE_ORDER.indexOf(a.eyeState ?? "open") -
        EYE_STATE_ORDER.indexOf(b.eyeState ?? "open")
      );
    }
    return a.zIndex - b.zIndex;
  });
}

function LayerPartRow({
  part,
  selected,
  indented,
  onSelect,
  onChange,
  onRemove,
}: {
  part: CharacterPart;
  selected: boolean;
  indented?: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<CharacterPart>) => void;
  onRemove: () => void;
}) {
  return (
    <li
      onClick={onSelect}
      className={`flex cursor-pointer items-center gap-1 rounded border px-2 py-1.5 ${
        indented ? "ml-3" : ""
      } ${selected ? "border-primary bg-primary/15" : "border-border bg-panel-2 hover:bg-panel"}`}
    >
      <span className="min-w-0 flex-1 truncate">
        {indented ? variantLabel(part) : (part.slotName ?? part.name)}
        {!indented && (
          <span className="ml-1 text-[10px] text-muted-foreground">{roleLabel(part.role)}</span>
        )}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onChange({ visible: !part.visible });
        }}
        className="rounded p-1 text-muted-foreground hover:text-foreground"
        title={part.visible ? "Hide" : "Show"}
      >
        {part.visible ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onChange({ zIndex: part.zIndex + 1 });
        }}
        className="rounded p-1 text-muted-foreground hover:text-foreground"
        title="Bring forward"
      >
        <ArrowUp size={14} />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onChange({ zIndex: part.zIndex - 1 });
        }}
        className="rounded p-1 text-muted-foreground hover:text-foreground"
        title="Send backward"
      >
        <ArrowDown size={14} />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="rounded p-1 text-destructive"
        title="Delete"
      >
        <Trash2 size={14} />
      </button>
    </li>
  );
}

function LayerList({
  parts,
  selectedId,
  selectedSlotId,
  onSelect,
  onSelectSlot,
  onChange,
  onRemove,
  onToggleSlotVisible,
  onNudgeSlotZ,
  onRemoveSlot,
}: {
  parts: CharacterPart[];
  selectedId: ID | null;
  selectedSlotId: ID | null;
  onSelect: (id: ID) => void;
  onSelectSlot: (slotId: ID) => void;
  onChange: (id: ID, patch: Partial<CharacterPart>) => void;
  onRemove: (id: ID) => void;
  onToggleSlotVisible: (slotId: ID) => void;
  onNudgeSlotZ: (slotId: ID, delta: number) => void;
  onRemoveSlot: (slotId: ID) => void;
}) {
  const [expanded, setExpanded] = useState<Set<ID>>(new Set());

  const groups = new Map<ID, CharacterPart[]>();
  for (const part of parts) {
    const slotId = getPartSlotId(part);
    const arr = groups.get(slotId) ?? [];
    arr.push(part);
    groups.set(slotId, arr);
  }
  const groupList = Array.from(groups.entries())
    .map(([slotId, slotParts]) => ({
      slotId,
      slotParts,
      topZ: Math.max(...slotParts.map((p) => p.zIndex)),
      name: slotParts[0].slotName ?? roleLabel(slotParts[0].role),
    }))
    .sort((a, b) => b.topZ - a.topZ);

  const toggleExpanded = (slotId: ID) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(slotId)) next.delete(slotId);
      else next.add(slotId);
      return next;
    });

  return (
    <div className="mt-4">
      <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
        Layers
      </div>
      <ul className="space-y-1">
        {groupList.map(({ slotId, slotParts, name }) => {
          // Single-variant slots stay as flat rows.
          if (slotParts.length === 1) {
            const part = slotParts[0];
            return (
              <LayerPartRow
                key={part.id}
                part={part}
                selected={part.id === selectedId}
                onSelect={() => onSelect(part.id)}
                onChange={(patch) => onChange(part.id, patch)}
                onRemove={() => onRemove(part.id)}
              />
            );
          }
          // Multi-variant slots render a collapsible group.
          const isOpen = expanded.has(slotId);
          const anyVisible = slotParts.some((p) => p.visible);
          return (
            <li key={slotId} className="space-y-1">
              <div
                onClick={() => onSelectSlot(slotId)}
                className={`flex cursor-pointer items-center gap-1 rounded border px-2 py-1.5 ${
                  slotId === selectedSlotId
                    ? "border-primary bg-primary/15"
                    : "border-border bg-panel-2 hover:bg-panel"
                }`}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpanded(slotId);
                  }}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                  title={isOpen ? "Collapse" : "Expand"}
                >
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {name}
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                    {slotParts.length} parts
                  </span>
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSlotVisible(slotId);
                  }}
                  className="rounded p-1 text-muted-foreground hover:text-foreground"
                  title={anyVisible ? "Hide all" : "Show all"}
                >
                  {anyVisible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onNudgeSlotZ(slotId, 1);
                  }}
                  className="rounded p-1 text-muted-foreground hover:text-foreground"
                  title="Bring all forward"
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onNudgeSlotZ(slotId, -1);
                  }}
                  className="rounded p-1 text-muted-foreground hover:text-foreground"
                  title="Send all backward"
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveSlot(slotId);
                  }}
                  className="rounded p-1 text-destructive"
                  title="Delete group"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {isOpen && (
                <ul className="space-y-1">
                  {orderVariants(slotParts).map((part) => (
                    <LayerPartRow
                      key={part.id}
                      part={part}
                      selected={part.id === selectedId}
                      indented
                      onSelect={() => onSelect(part.id)}
                      onChange={(patch) => onChange(part.id, patch)}
                      onRemove={() => onRemove(part.id)}
                    />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Inspector({
  doc,
  part,
  mode,
  boundsMode,
  onModeChange,
  onBoundsModeChange,
  onChange,
  onRemove,
  onDuplicate,
  onPreview,
}: {
  doc: CharacterPreset;
  part: CharacterPart | null;
  mode: EditorMode;
  boundsMode: EditorBoundsMode;
  onModeChange: (mode: EditorMode) => void;
  onBoundsModeChange: (mode: EditorBoundsMode) => void;
  onChange: (id: ID, patch: Partial<CharacterPart>) => void;
  onRemove: (id: ID) => void;
  onDuplicate: (part: CharacterPart) => void;
  onPreview: (preview: PreviewState) => void;
}) {
  if (!part) {
    return (
      <div className="space-y-4">
        <div className="rounded border border-dashed border-border p-3 text-center text-muted-foreground">
          Select a part on the canvas or in the layer list.
        </div>
      </div>
    );
  }

  const parentOptions = doc.parts.filter((p) => p.id !== part.id);
  const previewButtons = previewLabels(part);

  return (
    <div className="space-y-4">
      <section className="rounded border border-border bg-panel-2 p-3">
        <div className="mb-3 flex items-center gap-2">
          <input
            value={part.name}
            onChange={(e) => onChange(part.id, { name: e.target.value, slotName: e.target.value })}
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-medium"
          />
          <button
            onClick={() => onDuplicate(part)}
            className="rounded border border-border p-1.5"
            title="Duplicate"
          >
            <Copy size={14} />
          </button>
          <button
            onClick={() => onRemove(part.id)}
            className="rounded border border-border p-1.5 text-destructive"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Role">
            <select
              value={part.role}
              onChange={(e) =>
                onChange(part.id, {
                  role: e.target.value as PartRole,
                  motionBehavior: defaultMotionBehaviorForRole(
                    e.target.value as PartRole,
                    part.viseme,
                  ),
                })
              }
              className="w-full rounded border border-border bg-background px-2 py-1"
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {roleLabel(role)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Motion behavior">
            <select
              value={part.motionBehavior ?? "none"}
              onChange={(e) =>
                onChange(part.id, { motionBehavior: e.target.value as PartMotionBehavior })
              }
              className="w-full rounded border border-border bg-background px-2 py-1"
            >
              {MOTION_BEHAVIOR_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
          {part.role === "mouth" && (
            <Field label="Mouth">
              <select
                value={part.viseme ?? "rest"}
                onChange={(e) => onChange(part.id, { viseme: e.target.value as MouthViseme })}
                className="w-full rounded border border-border bg-background px-2 py-1"
                title={MOUTH_VISEME_DESCRIPTIONS[part.viseme ?? "rest"]}
              >
                {MOUTH_VISEMES.map((viseme) => (
                  <option key={viseme} value={viseme}>
                    {viseme}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Attach To">
            <select
              value={part.parentId ?? ""}
              onChange={(e) => onChange(part.id, { parentId: e.target.value || undefined })}
              className="w-full rounded border border-border bg-background px-2 py-1"
            >
              <option value="">None</option>
              {parentOptions.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.slotName ?? candidate.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section className="rounded border border-border bg-panel-2 p-3">
        <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
          Transform
        </div>
        <div className="mb-3 grid grid-cols-2 gap-1 rounded border border-border bg-background p-1">
          <button
            type="button"
            onClick={() => onBoundsModeChange("frame")}
            className={`flex items-center justify-center gap-1 rounded px-2 py-1 ${
              boundsMode === "frame" ? "bg-primary text-primary-foreground" : "hover:bg-panel"
            }`}
            title="Use the full transparent registration frame for editor controls"
          >
            <Maximize2 size={12} />
            Frame
          </button>
          <button
            type="button"
            onClick={() => onBoundsModeChange("art")}
            className={`flex items-center justify-center gap-1 rounded px-2 py-1 ${
              boundsMode === "art" ? "bg-primary text-primary-foreground" : "hover:bg-panel"
            }`}
            title="Use the visible non-transparent art bounds for editor controls"
          >
            <Minimize2 size={12} />
            Art
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="X" value={part.x} onChange={(x) => onChange(part.id, { x })} />
          <NumberField label="Y" value={part.y} onChange={(y) => onChange(part.id, { y })} />
          <NumberField
            label="Width"
            value={part.width}
            onChange={(width) => onChange(part.id, { width })}
          />
          <NumberField
            label="Height"
            value={part.height}
            onChange={(height) => onChange(part.id, { height })}
          />
          <NumberField
            label="Rotate"
            value={part.rotation}
            onChange={(rotation) => onChange(part.id, { rotation })}
          />
          <NumberField
            label="Draw Order"
            value={part.zIndex}
            onChange={(zIndex) => onChange(part.id, { zIndex })}
          />
          <NumberField
            label="Depth (2.5D)"
            value={part.depth}
            onChange={(depth) => onChange(part.id, { depth })}
          />
        </div>
      </section>

      <section className="rounded border border-border bg-panel-2 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-semibold uppercase tracking-wider text-muted-foreground">
            Motion Helpers
          </span>
          <button
            onClick={() => onModeChange(mode === "select" ? "pivot" : "select")}
            className={`flex items-center gap-1 rounded border px-2 py-1 ${
              mode === "pivot" ? "border-primary bg-primary/15" : "border-border"
            }`}
          >
            <MousePointer2 size={13} />
            Set Pivot
          </button>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <NumberField
            label="Pivot X"
            value={Math.round((part.pivot ?? alphaCenterForPart(part)).x)}
            onChange={(x) =>
              onChange(part.id, { pivot: { x, y: (part.pivot ?? alphaCenterForPart(part)).y } })
            }
          />
          <NumberField
            label="Pivot Y"
            value={Math.round((part.pivot ?? alphaCenterForPart(part)).y)}
            onChange={(y) =>
              onChange(part.id, { pivot: { x: (part.pivot ?? alphaCenterForPart(part)).x, y } })
            }
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onModeChange(mode === "bounds-rect" ? "select" : "bounds-rect")}
            className={`flex-1 rounded border px-2 py-1 ${mode === "bounds-rect" ? "border-primary bg-primary/15" : "border-border"}`}
          >
            Rect Area
          </button>
          <button
            onClick={() => onModeChange(mode === "bounds-ellipse" ? "select" : "bounds-ellipse")}
            className={`flex-1 rounded border px-2 py-1 ${mode === "bounds-ellipse" ? "border-primary bg-primary/15" : "border-border"}`}
          >
            Ellipse Area
          </button>
        </div>
        {part.bounds && (
          <button
            onClick={() => onChange(part.id, { bounds: undefined })}
            className="mt-2 text-[11px] text-destructive"
          >
            Clear allowed area
          </button>
        )}
      </section>

      {part.role === "mouth" && (
        <section className="rounded border border-border bg-panel-2 p-3">
          <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
            Test Talk
          </div>
          <div className="grid grid-cols-2 gap-2">
            {SAMPLE_WORDS.map((word) => (
              <button
                key={word}
                onClick={() =>
                  onPreview({
                    kind: "talk",
                    targetPartId: part.id,
                    targetSlotId: part.slotId,
                    targetRole: part.role,
                    startedAt: Date.now(),
                    durationMs: 1300,
                    visemes: wordToVisemes(word),
                  })
                }
                className="rounded border border-border px-2 py-1 hover:bg-panel"
              >
                {word}
              </button>
            ))}
          </div>
        </section>
      )}

      {previewButtons.length > 0 && (
        <section className="rounded border border-border bg-panel-2 p-3">
          <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
            Preview
          </div>
          <div className="flex flex-wrap gap-2">
            {previewButtons.map((item) => (
              <button
                key={item.kind}
                onClick={() =>
                  onPreview({
                    kind: item.kind,
                    targetPartId: part.id,
                    targetSlotId: part.slotId,
                    targetRole: part.role,
                    startedAt: Date.now(),
                    durationMs: 1200,
                  })
                }
                className="rounded border border-border px-2 py-1 hover:bg-panel"
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function CanvasControls({
  doc,
  onChange,
}: {
  doc: CharacterPreset;
  onChange: (patch: Partial<CharacterPreset>) => void;
}) {
  const rig = normalizeCharacterRig(doc);
  return (
    <section className="rounded border border-border bg-panel-2 p-3">
      <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
        Canvas
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Width"
          value={doc.canvasWidth}
          onChange={(canvasWidth) => onChange({ canvasWidth })}
        />
        <NumberField
          label="Height"
          value={doc.canvasHeight}
          onChange={(canvasHeight) => onChange({ canvasHeight })}
        />
        <Field label="Angle">
          <select
            value={rig.activeAngle}
            onChange={(e) =>
              onChange({ rig: { ...rig, activeAngle: e.target.value as CharacterAngle } })
            }
            className="w-full rounded border border-border bg-background px-2 py-1"
          >
            {CHARACTER_ANGLES.map((angle) => (
              <option key={angle} value={angle}>
                {angle}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </section>
  );
}

function RigAssistant({
  doc,
  onChange,
}: {
  doc: CharacterPreset;
  onChange: (patch: Partial<CharacterPreset>) => void;
}) {
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const rig = normalizeCharacterRig(doc);

  const copyPrompt = () => {
    void navigator.clipboard?.writeText(characterRigPrompt(doc));
    setMessage("Prompt copied.");
  };

  const applyDraft = () => {
    try {
      const parsed = JSON.parse(draft) as CharacterRig | { rig?: CharacterRig };
      const candidate = "rig" in parsed && parsed.rig ? parsed.rig : (parsed as CharacterRig);
      const validation = validateCharacterRig(candidate);
      if (!validation.ok) {
        setMessage(validation.errors.join(" "));
        return;
      }
      onChange({ rig: candidate });
      setMessage("Rig applied.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not parse rig JSON.");
    }
  };

  return (
    <section className="rounded border border-border bg-panel-2 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-wider text-muted-foreground">
          Rig Assistant
        </span>
        <span className="text-[10px] text-muted-foreground">{rig.bones.length} bones</span>
      </div>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onChange({ rig: buildDefaultRig(doc) })}
          className="rounded border border-border px-2 py-1 hover:bg-panel"
        >
          Rebuild
        </button>
        <button
          type="button"
          onClick={copyPrompt}
          className="rounded border border-border px-2 py-1 hover:bg-panel"
        >
          Copy AI prompt
        </button>
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Paste reviewed CharacterRig JSON"
        className="h-20 w-full resize-none rounded border border-border bg-background px-2 py-1 font-mono text-[10px]"
      />
      <button
        type="button"
        onClick={applyDraft}
        className="mt-2 w-full rounded border border-border px-2 py-1 hover:bg-panel"
      >
        Validate & apply
      </button>
      {message && <div className="mt-2 text-[10px] text-muted-foreground">{message}</div>}
    </section>
  );
}

function RigPanel({
  doc,
  selectedBoneId,
  selectedSlotId,
  selectedPart,
  onSelectBone,
  onRigChange,
}: {
  doc: CharacterPreset;
  selectedBoneId: ID | null;
  selectedSlotId: ID | null;
  selectedPart: CharacterPart | null;
  onSelectBone: (boneId: ID) => void;
  onRigChange: (rig: CharacterRig) => void;
}) {
  const rig = normalizeCharacterRig(doc);
  const selectedBone = rig.bones.find((bone) => bone.id === selectedBoneId) ?? null;
  const selectedBinding = selectedSlotId ? resolveSlotBinding(rig, selectedSlotId) : undefined;
  const activeAngle = rig.activeAngle;
  const bindSelectedPart = () => {
    if (!selectedPart) return;
    onRigChange(bindSlotPartToAngle(rig, getPartSlotId(selectedPart), selectedPart.id));
  };

  return (
    <section className="rounded border border-border bg-panel-2 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-wider text-muted-foreground">Rig</span>
        <span className="text-[10px] text-muted-foreground">{rig.bones.length} bones</span>
      </div>
      <div className="mb-3 max-h-28 space-y-1 overflow-auto">
        {rig.bones.map((bone) => (
          <button
            key={bone.id}
            type="button"
            onClick={() => onSelectBone(bone.id)}
            className={`flex w-full items-center justify-between gap-2 rounded border px-2 py-1 text-left hover:bg-panel ${
              bone.id === selectedBoneId ? "border-primary bg-primary/15" : "border-border"
            }`}
          >
            <span className="truncate">{bone.name}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">{bone.role}</span>
          </button>
        ))}
      </div>
      {selectedBone && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <NumberField
            label="Bone X"
            value={selectedBone.angleOverrides?.[activeAngle]?.x ?? selectedBone.x}
            onChange={(x) =>
              onRigChange({
                ...rig,
                bones: rig.bones.map((bone) =>
                  bone.id === selectedBone.id ? { ...bone, x } : bone,
                ),
              })
            }
          />
          <NumberField
            label="Bone Y"
            value={selectedBone.angleOverrides?.[activeAngle]?.y ?? selectedBone.y}
            onChange={(y) =>
              onRigChange({
                ...rig,
                bones: rig.bones.map((bone) =>
                  bone.id === selectedBone.id ? { ...bone, y } : bone,
                ),
              })
            }
          />
          <NumberField
            label="Bone Rot"
            value={selectedBone.angleOverrides?.[activeAngle]?.rotation ?? selectedBone.rotation}
            onChange={(rotation) =>
              onRigChange({
                ...rig,
                bones: rig.bones.map((bone) =>
                  bone.id === selectedBone.id ? { ...bone, rotation } : bone,
                ),
              })
            }
          />
          <NumberField
            label="Bone Depth"
            value={selectedBone.angleOverrides?.[activeAngle]?.depth ?? selectedBone.depth ?? 0}
            onChange={(depth) => onRigChange(setBoneDepth(rig, selectedBone.id, depth))}
          />
        </div>
      )}
      {selectedBinding && (
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Slot Depth"
            value={selectedBinding.effectiveDepth}
            onChange={(depth) => onRigChange(setSlotDepth(rig, selectedBinding.slotId, depth))}
          />
          <Field label="Angle Part">
            <button
              type="button"
              disabled={!selectedPart}
              onClick={bindSelectedPart}
              className="w-full rounded border border-border px-2 py-1 disabled:opacity-50"
            >
              Use selected
            </button>
          </Field>
        </div>
      )}
    </section>
  );
}

function RigBonesOverlay({
  doc,
  selectedBoneId,
  scale,
  onSelectBone,
  onStartBoneDrag,
}: {
  doc: CharacterPreset;
  selectedBoneId: ID | null;
  scale: number;
  onSelectBone: (boneId: ID) => void;
  onStartBoneDrag: (e: React.PointerEvent, boneId: ID) => void;
}) {
  const rig = normalizeCharacterRig(doc);
  const world = computeBoneWorldTransforms(rig);
  const radius = Math.max(6, 8 / Math.max(0.0001, scale));
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={doc.canvasWidth}
      height={doc.canvasHeight}
      style={{ zIndex: 12000 }}
    >
      {rig.bones.map((bone) => {
        const point = world.get(bone.id);
        const parent = bone.parentId ? world.get(bone.parentId) : undefined;
        if (!point || !parent) return null;
        return (
          <line
            key={`${bone.id}:link`}
            x1={parent.x}
            y1={parent.y}
            x2={point.x}
            y2={point.y}
            stroke="rgba(56, 189, 248, 0.72)"
            strokeWidth={Math.max(1.5, 2 / Math.max(0.0001, scale))}
          />
        );
      })}
      {rig.bones.map((bone) => {
        const point = world.get(bone.id);
        if (!point) return null;
        const selected = bone.id === selectedBoneId;
        return (
          <g
            key={bone.id}
            role="button"
            tabIndex={0}
            aria-label={`Select ${bone.name} bone`}
            className="pointer-events-auto cursor-move"
            onClick={(e) => {
              e.stopPropagation();
              onSelectBone(bone.id);
            }}
            onPointerDown={(e) => onStartBoneDrag(e, bone.id)}
          >
            <circle
              cx={point.x}
              cy={point.y}
              r={radius}
              fill={selected ? "#facc15" : "#38bdf8"}
              stroke="#0f172a"
              strokeWidth={Math.max(1, 1.5 / Math.max(0.0001, scale))}
            />
            <text
              x={point.x + radius + 3}
              y={point.y - radius - 3}
              fill="#0f172a"
              stroke="rgba(255,255,255,0.82)"
              strokeWidth={3}
              paintOrder="stroke"
              fontSize={Math.max(10, 11 / Math.max(0.0001, scale))}
            >
              {bone.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Axis-aligned move/resize box for a whole slot group (eyes / mouth visemes). */
function GroupControlsOverlay({
  bounds,
  scale,
  onStartMove,
  onStartResize,
}: {
  bounds: { x: number; y: number; width: number; height: number };
  scale: number;
  onStartMove: (e: React.PointerEvent) => void;
  onStartResize: (e: React.PointerEvent, corner: ResizeCorner) => void;
}) {
  const handleSize = 14 / Math.max(0.0001, scale);
  const corners: ResizeCorner[] = ["nw", "ne", "sw", "se"];
  const cornerPos: Record<ResizeCorner, { x: number; y: number }> = {
    nw: { x: 0, y: 0 },
    ne: { x: bounds.width, y: 0 },
    sw: { x: 0, y: bounds.height },
    se: { x: bounds.width, y: bounds.height },
  };
  return (
    <div
      className="absolute"
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        zIndex: 10000,
      }}
    >
      <div
        onPointerDown={(e) => {
          e.stopPropagation();
          onStartMove(e);
        }}
        className="absolute inset-0 cursor-move border-2 border-dashed border-primary"
        style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.4)" }}
      />
      {corners.map((corner) => (
        <button
          key={corner}
          type="button"
          aria-label={`Resize group from ${corner}`}
          onPointerDown={(e) => {
            e.stopPropagation();
            onStartResize(e, corner);
          }}
          className={`absolute rounded-sm border border-background bg-primary shadow-[0_1px_4px_rgba(0,0,0,0.35)] ${resizeCursor(corner)}`}
          style={{
            left: cornerPos[corner].x,
            top: cornerPos[corner].y,
            width: handleSize,
            height: handleSize,
            transform: "translate(-50%, -50%)",
          }}
        />
      ))}
    </div>
  );
}

/** Inspector panel shown when a whole slot group is selected. */
function GroupInspector({
  doc,
  slotId,
  parts,
  bounds,
  onMove,
  onScale,
  onSelectPart,
  lipSyncSamples,
  mouthTestPlaying,
  onTestWord,
  onTestAudio,
  onStopTestAudio,
}: {
  doc: CharacterPreset;
  slotId: ID;
  parts: CharacterPart[];
  bounds: { x: number; y: number; width: number; height: number };
  onMove: (dx: number, dy: number) => void;
  onScale: (anchor: { x: number; y: number }, scaleX: number, scaleY: number) => void;
  onSelectPart: (id: ID) => void;
  lipSyncSamples: Array<{ name: string; url: string }>;
  mouthTestPlaying: boolean;
  onTestWord: (word: string) => void;
  onTestAudio: (url: string) => void;
  onStopTestAudio: () => void;
}) {
  const name = parts[0]?.slotName ?? roleLabel(parts[0]?.role ?? "custom");
  const isMouth = parts[0]?.role === "mouth";
  const wordNames = SAMPLE_WORDS.map((w) => w.toLowerCase());
  const wordHasAudio = (word: string) =>
    lipSyncSamples.some((s) => s.name.toLowerCase() === word.toLowerCase());
  // Clips not attached to a sample word are offered as standalone amplitude tests.
  const otherSamples = lipSyncSamples.filter((s) => !wordNames.includes(s.name.toLowerCase()));
  return (
    <div className="space-y-4">
      <section className="rounded border border-primary/50 bg-primary/10 p-3">
        <div className="mb-1 font-medium">{name} group</div>
        <div className="mb-3 text-[11px] text-muted-foreground">
          Move or resize all {parts.length} variants together. Edit one frame by selecting it below.
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="X"
            value={Math.round(bounds.x)}
            onChange={(x) => onMove(x - bounds.x, 0)}
          />
          <NumberField
            label="Y"
            value={Math.round(bounds.y)}
            onChange={(y) => onMove(0, y - bounds.y)}
          />
          <NumberField
            label="Width"
            value={Math.round(bounds.width)}
            onChange={(w) =>
              onScale({ x: bounds.x, y: bounds.y }, Math.max(8, w) / Math.max(1, bounds.width), 1)
            }
          />
          <NumberField
            label="Height"
            value={Math.round(bounds.height)}
            onChange={(h) =>
              onScale({ x: bounds.x, y: bounds.y }, 1, Math.max(8, h) / Math.max(1, bounds.height))
            }
          />
        </div>
      </section>
      {isMouth && (
        <section className="rounded border border-border bg-panel-2 p-3">
          <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
            Test Lip Sync
          </div>
          <div className="mb-2 grid grid-cols-2 gap-2">
            {SAMPLE_WORDS.map((word) => {
              const hasAudio = wordHasAudio(word);
              return (
                <button
                  key={word}
                  type="button"
                  onClick={() => onTestWord(word)}
                  className="flex items-center justify-center gap-1 rounded border border-border px-2 py-1 hover:bg-panel"
                  title={
                    hasAudio ? `Play "${word}" with audio` : `${word} (silent — no clip attached)`
                  }
                >
                  {word}
                  {hasAudio && <span className="text-[9px] text-primary">♪</span>}
                </button>
              );
            })}
          </div>
          {otherSamples.length > 0 && (
            <>
              <div className="mb-1 text-[10px] text-muted-foreground">Or test with a clip:</div>
              <div className="grid grid-cols-2 gap-1">
                {otherSamples.map((sample) => (
                  <button
                    key={sample.url}
                    type="button"
                    onClick={() => (mouthTestPlaying ? onStopTestAudio() : onTestAudio(sample.url))}
                    className="truncate rounded border border-border bg-background px-2 py-1 text-[10px] hover:bg-panel"
                    title={sample.name}
                  >
                    ▶ {sample.name}
                  </button>
                ))}
              </div>
            </>
          )}
          {mouthTestPlaying && (
            <button
              type="button"
              onClick={onStopTestAudio}
              className="mt-2 w-full rounded border border-primary bg-primary/10 px-2 py-1 text-[10px] text-primary"
            >
              ■ Stop
            </button>
          )}
          {lipSyncSamples.length === 0 && (
            <div className="mt-2 rounded border border-dashed border-border p-2 text-[10px] text-muted-foreground">
              Drop audio into <code>src/studio/character/lipsync-samples/</code>. Name a file after
              a word above (e.g. <code>mommy.mp3</code>) to attach it to that button; other clips
              appear here as standalone tests.
            </div>
          )}
        </section>
      )}
      <section className="rounded border border-border bg-panel-2 p-3">
        <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
          Variants
        </div>
        <div className="grid grid-cols-3 gap-1">
          {orderVariants(parts).map((part) => (
            <button
              key={part.id}
              type="button"
              onClick={() => onSelectPart(part.id)}
              className="truncate rounded border border-border bg-background px-2 py-1 text-[10px] hover:bg-panel"
              title={`Edit ${variantLabel(part)}`}
            >
              {variantLabel(part)}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function PartLayer({
  part,
  selected,
  preview,
  previewParentPart,
}: {
  part: CharacterPart;
  selected: boolean;
  preview: PreviewState | null;
  previewParentPart?: CharacterPart;
}) {
  const url = useMediaUrl(part.mediaId);
  const previewingTalk = preview?.kind === "talk";
  const previewingBlink = preview?.kind === "blink" && preview.targetSlotId === part.slotId;
  if (
    part.role === "eye" &&
    part.eyeState &&
    part.eyeState !== "open" &&
    !selected &&
    !previewingBlink
  ) {
    return null;
  }
  if (
    part.role === "mouth" &&
    part.viseme &&
    part.viseme !== "rest" &&
    !selected &&
    !previewingTalk
  ) {
    return null;
  }
  if (!part.visible && !selected) return null;

  const previewTransform = previewDelta(part, preview, previewParentPart);
  const opacity = part.visible ? previewTransform.opacity : 0.28;
  const pivot = pivotForPart(part);

  return (
    <>
      {part.bounds && <BoundsOverlay bounds={part.bounds} zIndex={part.zIndex - 1} />}
      <div
        className="absolute select-none"
        style={{
          left: part.x + previewTransform.dx,
          top: part.y + previewTransform.dy,
          width: part.width,
          height: part.height,
          zIndex: part.zIndex,
          opacity,
          pointerEvents: "none",
          transform: `rotate(${part.rotation + previewTransform.rotation}deg) scale(${previewTransform.scale}, ${previewTransform.scaleY ?? previewTransform.scale})`,
          transformOrigin: `${((pivot.x - part.x) / part.width) * 100}% ${((pivot.y - part.y) / part.height) * 100}%`,
        }}
      >
        {url && (
          <img
            src={url}
            alt={part.name}
            draggable={false}
            className="pointer-events-none h-full w-full object-contain"
          />
        )}
      </div>
    </>
  );
}

function PartControlsOverlay({
  part,
  canvasWidth,
  canvasHeight,
  scale,
  boundsMode,
  onBoundsModeChange,
  preview,
  previewParentPart,
  onChange,
}: {
  part: CharacterPart;
  canvasWidth: number;
  canvasHeight: number;
  scale: number;
  boundsMode: EditorBoundsMode;
  onBoundsModeChange: (mode: EditorBoundsMode) => void;
  preview: PreviewState | null;
  previewParentPart?: CharacterPart;
  onChange: (patch: Partial<CharacterPart>) => void;
}) {
  const previewTransform = previewDelta(part, preview, previewParentPart);
  const pivot = pivotForPart(part);
  const selection = editorSelectionBounds(part, boundsMode);
  const control = editorControlBounds(part, scale, boundsMode);
  const alpha = localAlphaBounds(part);
  const viewportScale = Math.max(0.0001, scale);
  const handleSize = 14 / viewportScale;
  const rotateSize = 24 / viewportScale;
  const toggleSize = 22 / viewportScale;
  const pivotSize = 10 / viewportScale;
  const margin = 12 / viewportScale;
  const origin = {
    x: part.x + previewTransform.dx,
    y: part.y + previewTransform.dy,
  };
  const handlePositions = controlHandlePositions(
    part,
    control,
    previewTransform,
    canvasWidth,
    canvasHeight,
    margin,
  );
  const rotatePosition = rotateHandlePosition(
    part,
    control,
    previewTransform,
    canvasWidth,
    canvasHeight,
    margin,
  );
  const togglePosition = clampLocalPointToCanvas(
    part,
    { x: control.x - margin * 1.8, y: control.y - margin * 1.8 },
    previewTransform,
    canvasWidth,
    canvasHeight,
    margin,
  );

  const resize = (corner: ResizeCorner) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const move = (ev: PointerEvent) => {
      const delta = pointerDeltaToPartLocalDelta(
        ev.clientX - startX,
        ev.clientY - startY,
        scale,
        part,
        previewTransform,
      );
      onChange(resizePartFromLocalBounds(part, selection, corner, delta.x, delta.y));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const rotate = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.button !== 0) return;
    const canvas = e.currentTarget.closest("[data-editor-canvas]") as HTMLDivElement | null;
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return;
    const pivotScreen = {
      x: rect.left + (pivot.x + previewTransform.dx) * scale,
      y: rect.top + (pivot.y + previewTransform.dy) * scale,
    };
    const startAngle = Math.atan2(e.clientY - pivotScreen.y, e.clientX - pivotScreen.x);
    const baseRotation = part.rotation;
    const move = (ev: PointerEvent) => {
      const nextAngle = Math.atan2(ev.clientY - pivotScreen.y, ev.clientX - pivotScreen.x);
      const deltaDeg = ((nextAngle - startAngle) * 180) / Math.PI;
      onChange({ rotation: Math.round(baseRotation + deltaDeg) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      className="pointer-events-none absolute select-none"
      style={{
        left: origin.x,
        top: origin.y,
        width: part.width,
        height: part.height,
        zIndex: 10000,
        transform: `rotate(${part.rotation + previewTransform.rotation}deg) scale(${previewTransform.scale}, ${previewTransform.scaleY ?? previewTransform.scale})`,
        transformOrigin: `${((pivot.x - part.x) / part.width) * 100}% ${((pivot.y - part.y) / part.height) * 100}%`,
      }}
    >
      <div
        className="absolute border border-primary"
        style={{
          left: selection.x,
          top: selection.y,
          width: selection.width,
          height: selection.height,
          boxShadow: "0 0 0 1px rgba(255,255,255,0.45)",
        }}
      />
      {boundsMode === "frame" && part.alphaBounds && (
        <div
          className="absolute border border-dashed border-primary/60"
          style={{
            left: alpha.x,
            top: alpha.y,
            width: alpha.width,
            height: alpha.height,
          }}
        />
      )}
      {(["nw", "ne", "sw", "se"] as ResizeCorner[]).map((corner) => (
        <button
          key={corner}
          type="button"
          aria-label={`Resize ${part.name} from ${corner}`}
          onPointerDown={resize(corner)}
          className={`pointer-events-auto absolute rounded-sm border border-background bg-primary shadow-[0_1px_4px_rgba(0,0,0,0.35)] ${resizeCursor(corner)}`}
          style={{
            left: handlePositions[corner].x,
            top: handlePositions[corner].y,
            width: handleSize,
            height: handleSize,
            transform: "translate(-50%, -50%)",
          }}
        />
      ))}
      <button
        type="button"
        aria-label={`Rotate ${part.name}`}
        onPointerDown={rotate}
        className="pointer-events-auto absolute flex items-center justify-center rounded-full border border-background bg-primary text-primary-foreground shadow-[0_1px_5px_rgba(0,0,0,0.35)]"
        style={{
          left: rotatePosition.x,
          top: rotatePosition.y,
          width: rotateSize,
          height: rotateSize,
          transform: "translate(-50%, -50%)",
        }}
      >
        <RotateCw size={Math.max(10, rotateSize * 0.55)} strokeWidth={2.25} />
      </button>
      <button
        type="button"
        aria-label={
          boundsMode === "frame"
            ? `Use visible art bounds for ${part.name}`
            : `Use full registration bounds for ${part.name}`
        }
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onBoundsModeChange(boundsMode === "frame" ? "art" : "frame");
        }}
        className="pointer-events-auto absolute flex items-center justify-center rounded border border-background bg-panel text-foreground shadow-[0_1px_5px_rgba(0,0,0,0.35)]"
        style={{
          left: togglePosition.x,
          top: togglePosition.y,
          width: toggleSize,
          height: toggleSize,
          transform: "translate(-50%, -50%)",
        }}
        title={boundsMode === "frame" ? "Switch to art bounds" : "Switch to full frame bounds"}
      >
        {boundsMode === "frame" ? (
          <Minimize2 size={Math.max(10, toggleSize * 0.55)} />
        ) : (
          <Maximize2 size={Math.max(10, toggleSize * 0.55)} />
        )}
      </button>
      <div
        className="absolute rounded-full border-2 border-primary bg-background"
        style={{
          left: pivot.x - part.x,
          top: pivot.y - part.y,
          width: Math.max(8, pivotSize),
          height: Math.max(8, pivotSize),
          transform: "translate(-50%, -50%)",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.45)",
        }}
      />
    </div>
  );
}

function canvasPointToPartLocal(
  part: CharacterPart,
  canvasPoint: { x: number; y: number },
  previewTransform: ReturnType<typeof previewDelta>,
) {
  const pivot = pivotForPart(part);
  const pivotLocal = { x: pivot.x - part.x, y: pivot.y - part.y };
  const pivotCanvas = {
    x: part.x + previewTransform.dx + pivotLocal.x,
    y: part.y + previewTransform.dy + pivotLocal.y,
  };
  const angle = -(((part.rotation + previewTransform.rotation) * Math.PI) / 180);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const relX = canvasPoint.x - pivotCanvas.x;
  const relY = canvasPoint.y - pivotCanvas.y;
  const unrotatedX = relX * cos - relY * sin;
  const unrotatedY = relX * sin + relY * cos;
  return {
    x: pivotLocal.x + unrotatedX / Math.max(0.0001, previewTransform.scale),
    y:
      pivotLocal.y +
      unrotatedY / Math.max(0.0001, previewTransform.scaleY ?? previewTransform.scale),
  };
}

function partLocalPointToCanvas(
  part: CharacterPart,
  localPoint: { x: number; y: number },
  previewTransform: ReturnType<typeof previewDelta>,
) {
  const pivot = pivotForPart(part);
  const pivotLocal = { x: pivot.x - part.x, y: pivot.y - part.y };
  const pivotCanvas = {
    x: part.x + previewTransform.dx + pivotLocal.x,
    y: part.y + previewTransform.dy + pivotLocal.y,
  };
  const angle = ((part.rotation + previewTransform.rotation) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const relX = (localPoint.x - pivotLocal.x) * previewTransform.scale;
  const relY = (localPoint.y - pivotLocal.y) * (previewTransform.scaleY ?? previewTransform.scale);
  return {
    x: pivotCanvas.x + relX * cos - relY * sin,
    y: pivotCanvas.y + relX * sin + relY * cos,
  };
}

function pointerDeltaToPartLocalDelta(
  screenDx: number,
  screenDy: number,
  viewportScale: number,
  part: CharacterPart,
  previewTransform: ReturnType<typeof previewDelta>,
) {
  const canvasDx = screenDx / Math.max(0.0001, viewportScale);
  const canvasDy = screenDy / Math.max(0.0001, viewportScale);
  const angle = -(((part.rotation + previewTransform.rotation) * Math.PI) / 180);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const unrotatedX = canvasDx * cos - canvasDy * sin;
  const unrotatedY = canvasDx * sin + canvasDy * cos;
  return {
    x: unrotatedX / Math.max(0.0001, previewTransform.scale),
    y: unrotatedY / Math.max(0.0001, previewTransform.scaleY ?? previewTransform.scale),
  };
}

function controlHandlePositions(
  part: CharacterPart,
  control: ReturnType<typeof editorControlBounds>,
  previewTransform: ReturnType<typeof previewDelta>,
  canvasWidth: number,
  canvasHeight: number,
  margin: number,
): Record<ResizeCorner, { x: number; y: number }> {
  const clampLocal = (point: { x: number; y: number }) =>
    clampLocalPointToCanvas(part, point, previewTransform, canvasWidth, canvasHeight, margin);
  return {
    nw: clampLocal({ x: control.x, y: control.y }),
    ne: clampLocal({ x: control.x + control.width, y: control.y }),
    sw: clampLocal({ x: control.x, y: control.y + control.height }),
    se: clampLocal({ x: control.x + control.width, y: control.y + control.height }),
  };
}

function rotateHandlePosition(
  part: CharacterPart,
  control: ReturnType<typeof editorControlBounds>,
  previewTransform: ReturnType<typeof previewDelta>,
  canvasWidth: number,
  canvasHeight: number,
  margin: number,
) {
  const gap = margin * 2.4;
  const candidates = [
    { x: control.x + control.width / 2, y: control.y - gap },
    { x: control.x + control.width / 2, y: control.y + control.height + gap },
    { x: control.x - gap, y: control.y + control.height / 2 },
    { x: control.x + control.width + gap, y: control.y + control.height / 2 },
  ];
  const best =
    candidates
      .map((localPoint) => {
        const canvasPoint = partLocalPointToCanvas(part, localPoint, previewTransform);
        const overflow =
          Math.max(0, margin - canvasPoint.x) +
          Math.max(0, canvasPoint.x - (canvasWidth - margin)) +
          Math.max(0, margin - canvasPoint.y) +
          Math.max(0, canvasPoint.y - (canvasHeight - margin));
        const breathingRoom = Math.min(
          Math.abs(canvasPoint.x - margin),
          Math.abs(canvasWidth - margin - canvasPoint.x),
          Math.abs(canvasPoint.y - margin),
          Math.abs(canvasHeight - margin - canvasPoint.y),
        );
        return { localPoint, overflow, breathingRoom };
      })
      .sort((a, b) => a.overflow - b.overflow || b.breathingRoom - a.breathingRoom)[0]
      ?.localPoint ?? candidates[0];

  return clampLocalPointToCanvas(part, best, previewTransform, canvasWidth, canvasHeight, margin);
}

function resizeCursor(corner: ResizeCorner) {
  return corner === "nw" || corner === "se" ? "cursor-nwse-resize" : "cursor-nesw-resize";
}

function clampLocalPointToCanvas(
  part: CharacterPart,
  localPoint: { x: number; y: number },
  previewTransform: ReturnType<typeof previewDelta>,
  canvasWidth: number,
  canvasHeight: number,
  margin: number,
) {
  const canvasPoint = partLocalPointToCanvas(part, localPoint, previewTransform);
  const clampedCanvasPoint = {
    x: clamp(canvasPoint.x, margin, canvasWidth - margin),
    y: clamp(canvasPoint.y, margin, canvasHeight - margin),
  };
  return canvasPointToPartLocal(part, clampedCanvasPoint, previewTransform);
}

function resizePartFromLocalBounds(
  part: CharacterPart,
  bounds: { x: number; y: number; width: number; height: number },
  corner: ResizeCorner,
  dx: number,
  dy: number,
): Partial<CharacterPart> {
  const fractionX = bounds.x / Math.max(1, part.width);
  const fractionY = bounds.y / Math.max(1, part.height);
  const fractionWidth = bounds.width / Math.max(1, part.width);
  const fractionHeight = bounds.height / Math.max(1, part.height);

  const visibleLeft = part.x + bounds.x;
  const visibleTop = part.y + bounds.y;
  const visibleRight = visibleLeft + bounds.width;
  const visibleBottom = visibleTop + bounds.height;

  const nextVisibleLeft = corner.includes("w") ? visibleLeft + dx : visibleLeft;
  const nextVisibleTop = corner.includes("n") ? visibleTop + dy : visibleTop;
  const nextVisibleRight = corner.includes("e") ? visibleRight + dx : visibleRight;
  const nextVisibleBottom = corner.includes("s") ? visibleBottom + dy : visibleBottom;

  const nextVisibleWidth = Math.max(4, nextVisibleRight - nextVisibleLeft);
  const nextVisibleHeight = Math.max(4, nextVisibleBottom - nextVisibleTop);
  const width = Math.max(8, nextVisibleWidth / Math.max(0.0001, fractionWidth));
  const height = Math.max(8, nextVisibleHeight / Math.max(0.0001, fractionHeight));

  return {
    x: Math.round(nextVisibleLeft - fractionX * width),
    y: Math.round(nextVisibleTop - fractionY * height),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function BoundsOverlay({ bounds, zIndex }: { bounds: CharacterPartBounds; zIndex: number }) {
  return (
    <div
      className="pointer-events-none absolute border border-dashed border-primary/70 bg-primary/10"
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        borderRadius: bounds.type === "ellipse" ? "9999px" : 4,
        zIndex,
      }}
    />
  );
}

type ResizeCorner = "nw" | "ne" | "sw" | "se";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded border border-border bg-background px-2 py-1"
      />
    </Field>
  );
}

interface PreviewState {
  kind: "blink" | "talk" | "wave" | "kick" | "nod" | "bounce" | "raise";
  targetPartId: string;
  targetSlotId: string;
  targetRole: PartRole;
  startedAt: number;
  durationMs: number;
  visemes?: MouthViseme[];
  /** When set, "talk" shows exactly this viseme (live audio-driven test). */
  forcedViseme?: MouthViseme;
  /** Audio drives the preview frame-by-frame; lifetime is managed by playback. */
  audioDriven?: boolean;
}

function previewLabels(part: CharacterPart): Array<{ kind: PreviewState["kind"]; label: string }> {
  const out: Array<{ kind: PreviewState["kind"]; label: string }> = [];
  if (part.role === "eye" || (part.role === "custom" && part.motionBehavior === "blink"))
    out.push({ kind: "blink", label: "Test Blink" });
  if (part.role === "mouth" || (part.role === "custom" && part.motionBehavior === "lipSync"))
    out.push({ kind: "talk", label: "Test Talk" });
  if (part.role === "arm") out.push({ kind: "wave", label: "Test Wave" });
  if (part.role === "leg" || part.role === "foot") out.push({ kind: "kick", label: "Test Kick" });
  if (part.role === "custom" && part.motionBehavior === "rotate")
    out.push({ kind: "wave", label: "Test Wave" });
  if (part.role === "head") out.push({ kind: "nod", label: "Test Nod" });
  if (part.role === "hair" || (part.role === "custom" && part.motionBehavior === "bounce"))
    out.push({ kind: "bounce", label: "Test Bounce" });
  if (part.role === "eyebrow" || (part.role === "custom" && part.motionBehavior === "raise"))
    out.push({ kind: "raise", label: "Test Raise" });
  return out;
}

function editorPartPivot(part: CharacterPart) {
  return (
    part.pivot ?? {
      x: part.x + part.width * part.anchorX,
      y: part.y + part.height * part.anchorY,
    }
  );
}

function editorTransformPointAroundPivot(
  point: { x: number; y: number },
  pivot: { x: number; y: number },
  motion: { dx: number; dy: number; scale: number; rotation: number },
) {
  const radians = (motion.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const relX = (point.x - pivot.x) * motion.scale;
  const relY = (point.y - pivot.y) * motion.scale;
  return {
    x: pivot.x + motion.dx + relX * cos - relY * sin,
    y: pivot.y + motion.dy + relX * sin + relY * cos,
  };
}

function previewDelta(
  part: CharacterPart,
  preview: PreviewState | null,
  previewParentPart?: CharacterPart,
) {
  if (!preview) return { dx: 0, dy: 0, rotation: 0, scale: 1, scaleY: 1, opacity: 1 };
  const targetsPart = part.id === preview.targetPartId || part.slotId === preview.targetSlotId;
  const elapsed = Date.now() - preview.startedAt;
  const t = Math.min(1, elapsed / preview.durationMs);
  const wave = Math.sin(t * Math.PI * 2);
  if (
    !targetsPart &&
    preview.kind === "nod" &&
    preview.targetRole === "head" &&
    previewParentPart &&
    (part.role === "eye" ||
      part.role === "eyebrow" ||
      part.role === "mouth" ||
      part.role === "hair")
  ) {
    const motion = { dx: 0, dy: Math.round(Math.abs(wave) * 8), rotation: wave * 3, scale: 1 };
    const childPivot = editorPartPivot(part);
    const transformedPivot = editorTransformPointAroundPivot(
      childPivot,
      editorPartPivot(previewParentPart),
      motion,
    );
    return {
      dx: transformedPivot.x - childPivot.x,
      dy: transformedPivot.y - childPivot.y,
      rotation: motion.rotation,
      scale: 1,
      scaleY: 1,
      opacity: 1,
    };
  }
  if (!targetsPart) return { dx: 0, dy: 0, rotation: 0, scale: 1, scaleY: 1, opacity: 1 };
  if (preview.kind === "blink" && part.role === "eye") {
    const closedMoment = t > 0.35 && t < 0.55;
    if (part.eyeState) {
      const shouldShow =
        (closedMoment && part.eyeState === "closed") || (!closedMoment && part.eyeState === "open");
      return { dx: 0, dy: 0, rotation: 0, scale: 1, scaleY: 1, opacity: shouldShow ? 1 : 0 };
    }
    return { dx: 0, dy: 0, rotation: 0, scale: 1, scaleY: closedMoment ? 0.12 : 1, opacity: 1 };
  }
  if (preview.kind === "wave" && part.role === "arm") {
    return { dx: 0, dy: 0, rotation: wave * 18, scale: 1, opacity: 1 };
  }
  if (preview.kind === "kick" && (part.role === "leg" || part.role === "foot")) {
    return {
      dx: Math.round(Math.abs(wave) * 10),
      dy: 0,
      rotation: wave * 12,
      scale: 1,
      opacity: 1,
    };
  }
  if (preview.kind === "nod" && part.role === "head") {
    return { dx: 0, dy: Math.round(Math.abs(wave) * 8), rotation: wave * 3, scale: 1, opacity: 1 };
  }
  if (preview.kind === "bounce" && part.role === "hair") {
    return { dx: 0, dy: Math.round(wave * 6), rotation: wave * 2, scale: 1, opacity: 1 };
  }
  if (preview.kind === "raise" && part.role === "eyebrow") {
    return { dx: 0, dy: Math.round(-Math.abs(wave) * 12), rotation: 0, scale: 1, opacity: 1 };
  }
  if (preview.kind === "talk" && part.role === "mouth") {
    const active =
      preview.forcedViseme ??
      (() => {
        const visemes = preview.visemes ?? ["rest", "A", "E", "O", "MBP"];
        const idx = Math.floor(t * visemes.length * 1.1) % visemes.length;
        return visemes[idx];
      })();
    return {
      dx: 0,
      dy: 0,
      rotation: 0,
      scale: 1,
      opacity: !part.viseme || part.viseme === active ? 1 : 0,
    };
  }
  return { dx: 0, dy: 0, rotation: 0, scale: 1, opacity: 1 };
}

function wordToVisemes(word: string): MouthViseme[] {
  const map: Record<string, MouthViseme> = {
    a: "A",
    e: "E",
    i: "E",
    o: "O",
    u: "U",
    m: "MBP",
    b: "MBP",
    p: "MBP",
    f: "FV",
    v: "FV",
    l: "L",
    w: "WQ",
    q: "WQ",
  };
  return [
    "rest",
    ...word
      .toLowerCase()
      .split("")
      .map((ch) => map[ch] ?? "E"),
    "rest",
  ];
}

function fitAsset(width = 0, height = 0, canvasWidth: number, canvasHeight: number) {
  const sourceWidth = width > 0 ? width : 240;
  const sourceHeight = height > 0 ? height : 240;
  const ratio = Math.min(1, (canvasWidth * 0.7) / sourceWidth, (canvasHeight * 0.7) / sourceHeight);
  const w = Math.max(16, Math.round(sourceWidth * ratio));
  const h = Math.max(16, Math.round(sourceHeight * ratio));
  return {
    x: Math.round((canvasWidth - w) / 2),
    y: Math.round((canvasHeight - h) / 2),
    width: w,
    height: h,
  };
}

function detectRole(filename: string): PartRole {
  const name = filename.toLowerCase();
  if (name.includes("head")) return "head";
  if (name.includes("body") || name.includes("torso")) return "body";
  if (name.includes("eye") && !name.includes("brow")) return "eye";
  if (name.includes("brow") || name.includes("eyebrow")) return "eyebrow";
  if (name.includes("mouth") || name.includes("viseme") || name.includes("lip")) return "mouth";
  if (name.includes("hand")) return "hand";
  if (name.includes("arm")) return "arm";
  if (name.includes("foot") || name.includes("feet")) return "foot";
  if (name.includes("leg")) return "leg";
  if (name.includes("hair")) return "hair";
  if (name.includes("hat") || name.includes("glasses") || name.includes("accessory"))
    return "accessory";
  return "custom";
}

function detectSide(filename: string): CharacterPart["side"] {
  const name = filename.toLowerCase();
  if (/(^|[_\-\s])left|_l\b|-l\b/.test(name)) return "left";
  if (/(^|[_\-\s])right|_r\b|-r\b/.test(name)) return "right";
  if (name.includes("front")) return "front";
  if (name.includes("back")) return "back";
  return undefined;
}

function detectViseme(filename: string): MouthViseme | undefined {
  const name = filename.toLowerCase();
  const found = MOUTH_VISEMES.find((v) => name.includes(v.toLowerCase()));
  if (found) return found;
  if (name.includes("rest")) return "rest";
  if (name.includes("smile")) return "Smile";
  return undefined;
}

function detectEyeState(filename: string): EyeState | undefined {
  const name = filename.toLowerCase();
  if (name.includes("closed") || name.includes("blink")) return "closed";
  if (name.includes("half")) return "half";
  if (name.includes("wink")) return "wink";
  if (name.includes("open")) return "open";
  return "open";
}

function slotIdForImport(
  role: PartRole,
  label: string,
  viseme: MouthViseme | undefined,
  id: ID,
  side: CharacterPart["side"],
) {
  if (role === "mouth") return "role:mouth";
  if (role === "eye" && (side === "left" || side === "right")) return `slot:${side}-eye`;
  if (role === "custom") return `custom:${id}`;
  return `slot:${slug(label || role)}${viseme ? `:${viseme}` : ""}`;
}

function slug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "part"
  );
}

function maxZ(parts: CharacterPart[]) {
  return parts.reduce((max, part) => Math.max(max, part.zIndex), 0);
}

/** Axis-aligned union of the parts' frame rectangles, in canvas space. */
function unionFrameBounds(parts: CharacterPart[]) {
  const minX = Math.min(...parts.map((p) => p.x));
  const minY = Math.min(...parts.map((p) => p.y));
  const maxX = Math.max(...parts.map((p) => p.x + p.width));
  const maxY = Math.max(...parts.map((p) => p.y + p.height));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function moveSlotSetFromSnapshot(
  parts: CharacterPart[],
  snapshot: Array<{ id: ID; x: number; y: number; pivot: { x: number; y: number } }>,
  slotIds: Set<ID>,
  dx: number,
  dy: number,
): CharacterPart[] {
  const snapshotById = new Map(snapshot.map((part) => [part.id, part]));
  return parts.map((part) => {
    if (!slotIds.has(getPartSlotId(part))) return part;
    const start = snapshotById.get(part.id);
    if (!start) return part;
    return {
      ...part,
      x: start.x + dx,
      y: start.y + dy,
      pivot: { x: start.pivot.x + dx, y: start.pivot.y + dy },
    };
  });
}

function normalizePartPatch(part: CharacterPart, patch: Partial<CharacterPart>): CharacterPart {
  const pivot =
    patch.x !== undefined ||
    patch.y !== undefined ||
    patch.width !== undefined ||
    patch.height !== undefined ||
    patch.alphaBounds !== undefined
      ? (part.pivot ?? alphaCenterForPart(part))
      : part.pivot;
  const anchorX = pivot ? clamp((pivot.x - part.x) / Math.max(1, part.width), 0, 1) : part.anchorX;
  const anchorY = pivot ? clamp((pivot.y - part.y) / Math.max(1, part.height), 0, 1) : part.anchorY;
  return {
    ...part,
    anchorX,
    anchorY,
    pivot,
    motionBehavior: part.motionBehavior ?? defaultMotionBehaviorForRole(part.role, part.viseme),
  };
}

const EYE_COLOR_PRESETS = [
  { label: "Black", value: "#1a1a1a" },
  { label: "Brown", value: "#6b4423" },
  { label: "Blue", value: "#1e40af" },
  { label: "Green", value: "#15803d" },
  { label: "Hazel", value: "#a67c52" },
] as const;

const MOUTH_COLOR_PRESETS = [
  { label: "Pink", value: "#e88a9a" },
  { label: "Rose", value: "#d05d6e" },
  { label: "Red", value: "#c0392b" },
  { label: "Deep red", value: "#8b2230" },
  { label: "Dark gray", value: "#4a4146" },
] as const;

function EyePresetSelector({
  onImport,
}: {
  onImport: (file: File, options?: ImportOptions) => void;
}) {
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState("#1a1a1a");
  const [customColor, setCustomColor] = useState("#1a1a1a");

  const handleApply = async () => {
    if (!selectedPreset) return;
    const preset = EYE_PRESETS.find((p) => p.id === selectedPreset);
    if (!preset) return;

    const color = customColor;
    const eyeStates: EyeState[] = ["open", "half", "closed", "wink"];

    for (const side of ["left", "right"] as const) {
      for (const eyeState of eyeStates) {
        const svg = preset.generateForState(eyeState, color);
        const file = await generatePresetBlob(svg, `eye-${side}-${eyeState}.svg`);
        onImport(file, {
          role: "eye",
          side,
          eyeState,
          label: `${side === "left" ? "Left" : "Right"} ${eyeState}`,
          slotId: `slot:${side}-eye`,
          zIndex: 50,
        });
      }
    }
    setSelectedPreset(null);
  };

  if (selectedPreset) {
    const preset = EYE_PRESETS.find((p) => p.id === selectedPreset);
    return (
      <div className="mb-3 rounded border border-primary/50 bg-primary/10 p-2">
        <div className="mb-2 text-[11px] font-medium">Configure {preset?.label} eyes</div>
        <div className="mb-2">
          <label className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">
            Color
          </label>
          <div className="flex gap-1 mb-2">
            {EYE_COLOR_PRESETS.map((color) => (
              <button
                key={color.value}
                type="button"
                onClick={() => {
                  setSelectedColor(color.value);
                  setCustomColor(color.value);
                }}
                className={`h-6 w-6 rounded border-2 ${
                  selectedColor === color.value ? "border-foreground" : "border-border"
                }`}
                style={{ backgroundColor: color.value }}
                title={color.label}
              />
            ))}
          </div>
          <div className="flex gap-1 items-center">
            <label className="text-[10px] text-muted-foreground">Custom:</label>
            <input
              type="color"
              value={customColor}
              onChange={(e) => {
                setCustomColor(e.target.value);
                setSelectedColor(e.target.value);
              }}
              className="h-6 w-10 cursor-pointer rounded border border-border"
            />
            <input
              type="text"
              value={customColor}
              onChange={(e) => {
                if (e.target.value.match(/^#[0-9a-f]{6}$/i)) {
                  setCustomColor(e.target.value);
                  setSelectedColor(e.target.value);
                }
              }}
              placeholder="#000000"
              className="text-[10px] rounded border border-border bg-background px-1 py-0.5 w-20"
            />
          </div>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={handleApply}
            className="flex-1 rounded bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:opacity-90"
          >
            Add all states
          </button>
          <button
            type="button"
            onClick={() => setSelectedPreset(null)}
            className="rounded border border-border px-2 py-1 text-[10px] hover:bg-panel"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3">
      <div className="mb-1 text-[10px] text-muted-foreground">Quick presets:</div>
      <div className="grid grid-cols-3 gap-1">
        {EYE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => {
              setSelectedPreset(preset.id);
              setCustomColor("#1a1a1a");
              setSelectedColor("#1a1a1a");
            }}
            className="rounded border border-border bg-panel px-2 py-1 text-[10px] hover:bg-primary/10"
            title={`Use ${preset.label} eye`}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function MouthPresetSelector({
  onImport,
}: {
  onImport: (file: File, options?: ImportOptions) => void;
}) {
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState("#c0392b");
  const [customColor, setCustomColor] = useState("#c0392b");

  const handleApply = async () => {
    if (!selectedPreset) return;
    const preset = MOUTH_PRESETS.find((p) => p.id === selectedPreset);
    if (!preset) return;

    const color = customColor;

    for (const viseme of MOUTH_VISEMES) {
      const svg = preset.generateForViseme(viseme, color);
      const file = await generatePresetBlob(svg, `mouth-${viseme}.svg`);
      onImport(file, {
        role: "mouth",
        viseme,
        label: `Mouth ${viseme}`,
        slotId: "role:mouth",
        zIndex: 60,
      });
    }
    setSelectedPreset(null);
  };

  if (selectedPreset) {
    const preset = MOUTH_PRESETS.find((p) => p.id === selectedPreset);
    return (
      <div className="mb-3 rounded border border-primary/50 bg-primary/10 p-2">
        <div className="mb-2 text-[11px] font-medium">Configure {preset?.label} mouth</div>
        <div className="mb-2">
          <label className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">
            Color
          </label>
          <div className="flex gap-1 mb-2">
            {MOUTH_COLOR_PRESETS.map((color) => (
              <button
                key={color.value}
                type="button"
                onClick={() => {
                  setSelectedColor(color.value);
                  setCustomColor(color.value);
                }}
                className={`h-6 w-6 rounded border-2 ${
                  selectedColor === color.value ? "border-foreground" : "border-border"
                }`}
                style={{ backgroundColor: color.value }}
                title={color.label}
              />
            ))}
          </div>
          <div className="flex gap-1 items-center">
            <label className="text-[10px] text-muted-foreground">Custom:</label>
            <input
              type="color"
              value={customColor}
              onChange={(e) => {
                setCustomColor(e.target.value);
                setSelectedColor(e.target.value);
              }}
              className="h-6 w-10 cursor-pointer rounded border border-border"
            />
            <input
              type="text"
              value={customColor}
              onChange={(e) => {
                if (e.target.value.match(/^#[0-9a-f]{6}$/i)) {
                  setCustomColor(e.target.value);
                  setSelectedColor(e.target.value);
                }
              }}
              placeholder="#000000"
              className="text-[10px] rounded border border-border bg-background px-1 py-0.5 w-20"
            />
          </div>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={handleApply}
            className="flex-1 rounded bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:opacity-90"
          >
            Add all visemes
          </button>
          <button
            type="button"
            onClick={() => setSelectedPreset(null)}
            className="rounded border border-border px-2 py-1 text-[10px] hover:bg-panel"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3">
      <div className="mb-1 text-[10px] text-muted-foreground">Quick presets:</div>
      <div className="grid grid-cols-2 gap-1">
        {MOUTH_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => {
              setSelectedPreset(preset.id);
              setCustomColor("#c0392b");
              setSelectedColor("#c0392b");
            }}
            className="rounded border border-border bg-panel px-2 py-1 text-[10px] hover:bg-primary/10"
            title={`Use ${preset.label} mouth`}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
