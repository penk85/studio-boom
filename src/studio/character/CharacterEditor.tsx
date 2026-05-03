import { useEffect, useRef, useState, type SVGAttributes } from "react";
import { MouthCreator, RigPreview } from "./MouthCreator";
import { RIG_STYLES } from "./mouth-libraries";
import { clamp } from "./mouth-morph";
import {
  ArrowDown,
  ArrowUp,
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
import { Link, useNavigate } from "@tanstack/react-router";
import { db, importMediaFile, uid } from "../db";
import { useMediaUrl } from "../hooks/useMediaUrl";
import {
  createBlankCharacter,
  defaultMotionBehaviorForRole,
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
  CharacterPart,
  CharacterPartBounds,
  CharacterPreset,
  EyeState,
  ID,
  MouthRig,
  MouthViseme,
  PartMotionBehavior,
  PartManifest,
  PartRole,
} from "../types";

interface Props {
  characterId: string;
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

type EditorMode = "select" | "pivot" | "bounds-rect" | "bounds-ellipse";
type EditorBoundsMode = "frame" | "art";

export function CharacterEditor({ characterId }: Props) {
  const navigate = useNavigate();
  const [doc, setDoc] = useState<CharacterPreset | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<ID | null>(null);
  const [rigSelected, setRigSelected] = useState(false);
  const [scale, setScale] = useState(0.7);
  const [mode, setMode] = useState<EditorMode>("select");
  const [boundsMode, setBoundsMode] = useState<EditorBoundsMode>("frame");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [, setPreviewTick] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [rigPreview, setRigPreview] = useState<{
    visemes: MouthViseme[];
    startedAt: number;
    durationMs: number;
  } | null>(null);
  const [rigAudioViseme, setRigAudioViseme] = useState<MouthViseme>("rest");
  const [rigAudioPlaying, setRigAudioPlaying] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const rigAudioCtxRef = useRef<AudioContext | null>(null);
  const rigRafRef = useRef<number | null>(null);
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
      }
      setDoc(normalizeCharacterSlots(row));
    })();
  }, [characterId]);

  useEffect(() => {
    if (!doc) return;
    const t = window.setTimeout(() => void saveCharacter(doc), 450);
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
    const t = window.setTimeout(() => setPreview(null), preview.durationMs);
    const interval = window.setInterval(() => setPreviewTick((n) => n + 1), 50);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(interval);
    };
  }, [preview]);

  useEffect(() => {
    if (!rigPreview) return;
    const t = window.setTimeout(() => setRigPreview(null), rigPreview.durationMs);
    const interval = window.setInterval(() => setPreviewTick((n) => n + 1), 50);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(interval);
    };
  }, [rigPreview]);

  if (!doc) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        Loading character…
      </div>
    );
  }

  const updateDoc = (patch: Partial<CharacterPreset>) =>
    setDoc((d) => (d ? { ...d, ...patch, updatedAt: Date.now() } : d));

  const updatePart = (id: ID, patch: Partial<CharacterPart>) =>
    setDoc((d) =>
      d
        ? {
            ...d,
            parts: d.parts.map((p) =>
              p.id === id ? normalizePartPatch({ ...p, ...patch }, patch) : p,
            ),
            updatedAt: Date.now(),
          }
        : d,
    );

  const addPart = (part: CharacterPart) => {
    setDoc((d) => (d ? { ...d, parts: [...d.parts, part], updatedAt: Date.now() } : d));
    setSelectedPartId(part.id);
  };

  const removePart = (id: ID) => {
    setDoc((d) =>
      d
        ? {
            ...d,
            parts: d.parts
              .filter((p) => p.id !== id)
              .map((p) => (p.parentId === id ? { ...p, parentId: undefined } : p)),
            updatedAt: Date.now(),
          }
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
    setRigSelected(false);
  };
  const selectRig = () => {
    setSelectedPartId(null);
    setRigSelected(true);
  };
  const updateRigPlacement = (placement: NonNullable<typeof doc.mouthRig>["placement"]) => {
    if (!doc.mouthRig) return;
    updateDoc({ mouthRig: { ...doc.mouthRig, placement } });
  };

  const playRigAudio = async (file: File) => {
    if (rigRafRef.current) cancelAnimationFrame(rigRafRef.current);
    await rigAudioCtxRef.current?.close();
    rigAudioCtxRef.current = null;
    setRigAudioPlaying(false);
    setRigAudioViseme("rest");

    const arrayBuffer = await file.arrayBuffer();
    const ctx = new AudioContext();
    rigAudioCtxRef.current = ctx;
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const data = new Uint8Array(analyser.frequencyBinCount);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    source.start();
    setRigAudioPlaying(true);

    const tick = () => {
      analyser.getByteFrequencyData(data);
      const mean = data.reduce((s, v) => s + v, 0) / data.length;
      let v: MouthViseme = "rest";
      if (mean > 55) v = "A";
      else if (mean > 38) v = "E";
      else if (mean > 22) v = "O";
      else if (mean > 10) v = "MBP";
      setRigAudioViseme(v);
      rigRafRef.current = requestAnimationFrame(tick);
    };
    rigRafRef.current = requestAnimationFrame(tick);

    source.onended = () => {
      if (rigRafRef.current) cancelAnimationFrame(rigRafRef.current);
      setRigAudioPlaying(false);
      setRigAudioViseme("rest");
      void ctx.close();
    };
  };

  const rigCurrentViseme: MouthViseme = (() => {
    if (rigAudioPlaying) return rigAudioViseme;
    if (!rigPreview) return "rest";
    const elapsed = Date.now() - rigPreview.startedAt;
    const t = Math.min(1, elapsed / rigPreview.durationMs);
    const idx = Math.floor(t * rigPreview.visemes.length * 1.1) % rigPreview.visemes.length;
    return rigPreview.visemes[idx] ?? "rest";
  })();
  const exportData = JSON.stringify(normalizeCharacterSlots(doc), null, 2);
  const manifest = normalizePartManifest(doc.manifest);
  const effectiveMouthMode: "rig" | "images" = doc.mouthStyle ?? (doc.mouthRig ? "rig" : "images");
  const previewParentPart =
    preview?.targetRole === "head"
      ? orderedParts.find((part) => part.id === preview.targetPartId)
      : undefined;
  const visibleEditorParts = orderedParts
    .filter((part) => roleEnabledByManifest(part.role, manifest))
    .filter((part) => !(part.role === "mouth" && effectiveMouthMode === "rig"));
  const selectedEditorPart = selectedPart
    ? visibleEditorParts.find((part) => part.id === selectedPart.id)
    : null;

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
    const originalPivot = pivotForPart(part);
    const move = (ev: PointerEvent) => {
      const dx = Math.round((ev.clientX - sx) / scale);
      const dy = Math.round((ev.clientY - sy) / scale);
      updatePart(part.id, {
        x: ox + dx,
        y: oy + dy,
        pivot: { x: originalPivot.x + dx, y: originalPivot.y + dy },
      });
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
      setRigSelected(false);
      return;
    }
    startCanvasPartDrag(e, picked, point);
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border bg-panel px-4 py-2">
        <Link to="/" className="rounded border border-border px-2 py-1 text-xs hover:bg-panel-2">
          ← Studio
        </Link>
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
              setDoc(saved);
              navigate({ to: "/" });
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
          <UploadSlots
            onImport={importSvg}
            parts={doc.parts}
            manifest={manifest}
            mouthRig={doc.mouthRig}
            mouthStyle={doc.mouthStyle}
            onSaveRig={(rig) => updateDoc({ mouthRig: rig })}
            onSetMouthStyle={(style) => updateDoc({ mouthStyle: style })}
          />
          <LayerList
            parts={orderedParts.filter(
              (p) => !(p.role === "mouth" && effectiveMouthMode === "rig"),
            )}
            selectedId={selectedPartId}
            onSelect={selectPart}
            onChange={updatePart}
            onRemove={removePart}
            mouthRig={effectiveMouthMode === "rig" ? doc.mouthRig : undefined}
            rigSelected={rigSelected}
            onSelectRig={selectRig}
            onChangeRigZIndex={(z) =>
              doc.mouthRig &&
              updateDoc({
                mouthRig: { ...doc.mouthRig, placement: { ...doc.mouthRig.placement, zIndex: z } },
              })
            }
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
            className="relative bg-[oklch(0.11_0.01_260)] shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)] outline outline-1 outline-border"
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
              {doc.mouthRig && effectiveMouthMode === "rig" && (
                <RigPlacementLayer
                  key="mouth-rig"
                  rig={doc.mouthRig}
                  selected={rigSelected}
                  scale={scale}
                  currentViseme={rigCurrentViseme}
                  onSelect={selectRig}
                  onChange={updateRigPlacement}
                />
              )}
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
            onCanvasChange={(patch) => updateDoc(patch)}
            rigSelected={rigSelected}
            onRigChange={(rig) => updateDoc({ mouthRig: rig })}
            onRigPreview={(visemes) =>
              setRigPreview({ visemes, startedAt: Date.now(), durationMs: 1400 })
            }
            onRigAudioFile={playRigAudio}
            rigAudioPlaying={rigAudioPlaying}
          />
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
  mouthRig,
  mouthStyle,
  onSaveRig,
  onSetMouthStyle,
}: {
  onImport: (file: File, options?: ImportOptions) => void;
  parts: CharacterPart[];
  manifest: PartManifest;
  mouthRig: MouthRig | undefined;
  mouthStyle: CharacterPreset["mouthStyle"];
  onSaveRig: (rig: MouthRig) => void;
  onSetMouthStyle: (style: CharacterPreset["mouthStyle"]) => void;
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
          <div className="mb-1 font-semibold uppercase tracking-wider text-muted-foreground">
            Eye States
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
      {manifest.hasMouth && (
        <MouthShapeSetup
          parts={parts}
          mouthRig={mouthRig}
          mouthStyle={mouthStyle}
          onSaveRig={onSaveRig}
          onSetMouthStyle={onSetMouthStyle}
          onImport={onImport}
        />
      )}
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
  mouthRig,
  mouthStyle,
  onSaveRig,
  onSetMouthStyle,
  onImport,
}: {
  parts: CharacterPart[];
  mouthRig: MouthRig | undefined;
  mouthStyle: CharacterPreset["mouthStyle"];
  onSaveRig: (rig: MouthRig) => void;
  onSetMouthStyle: (style: CharacterPreset["mouthStyle"]) => void;
  onImport: (file: File, options?: ImportOptions) => void;
}) {
  const [designerOpen, setDesignerOpen] = useState(false);
  // "rig" is the default mode when a rig exists; "images" is the legacy/custom path.
  const effectiveMode: "rig" | "images" = mouthStyle ?? (mouthRig ? "rig" : "images");

  return (
    <div className="rounded border border-border bg-panel-2 p-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold uppercase tracking-wider text-muted-foreground">
          Mouth Shapes
        </span>
        {/* Mode toggle */}
        <div className="flex rounded border border-border text-[10px]">
          <button
            type="button"
            onClick={() => onSetMouthStyle("rig")}
            className={`rounded-l px-2 py-0.5 ${effectiveMode === "rig" ? "bg-primary text-primary-foreground" : "hover:bg-panel"}`}
          >
            Rig
          </button>
          <button
            type="button"
            onClick={() => onSetMouthStyle("images")}
            className={`rounded-r border-l border-border px-2 py-0.5 ${effectiveMode === "images" ? "bg-primary text-primary-foreground" : "hover:bg-panel"}`}
          >
            Images
          </button>
        </div>
      </div>

      {effectiveMode === "rig" ? (
        <>
          <button
            type="button"
            onClick={() => setDesignerOpen(true)}
            className="mb-2 w-full rounded border border-primary bg-primary/10 px-2 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/20"
          >
            {mouthRig ? `Rig: ${mouthRig.styleId} — Edit…` : "Choose mouth style…"}
          </button>
          <MouthCreator
            isOpen={designerOpen}
            onClose={() => setDesignerOpen(false)}
            initialRig={mouthRig}
            onSave={(rig) => {
              onSaveRig(rig);
              setDesignerOpen(false);
            }}
          />
        </>
      ) : (
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
      )}
    </div>
  );
}

function LayerList({
  parts,
  selectedId,
  onSelect,
  onChange,
  onRemove,
  mouthRig,
  rigSelected,
  onSelectRig,
  onChangeRigZIndex,
}: {
  parts: CharacterPart[];
  selectedId: ID | null;
  onSelect: (id: ID) => void;
  onChange: (id: ID, patch: Partial<CharacterPart>) => void;
  onRemove: (id: ID) => void;
  mouthRig?: MouthRig;
  rigSelected?: boolean;
  onSelectRig?: () => void;
  onChangeRigZIndex?: (z: number) => void;
}) {
  return (
    <div className="mt-4">
      <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
        Layers
      </div>
      <ul className="space-y-1">
        {mouthRig && (
          <li
            onClick={onSelectRig}
            className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 ${
              rigSelected
                ? "border-primary bg-primary/15"
                : "border-border bg-panel-2 hover:bg-panel"
            }`}
          >
            <span className="min-w-0 flex-1 truncate font-medium">
              Mouth rig
              <span className="ml-1 font-normal text-muted-foreground">{mouthRig.styleId}</span>
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onChangeRigZIndex?.(mouthRig.placement.zIndex + 1);
              }}
              className="rounded p-1 text-muted-foreground hover:text-foreground"
              title="Bring forward"
            >
              <ArrowUp size={14} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onChangeRigZIndex?.(mouthRig.placement.zIndex - 1);
              }}
              className="rounded p-1 text-muted-foreground hover:text-foreground"
              title="Send backward"
            >
              <ArrowDown size={14} />
            </button>
          </li>
        )}
        {parts
          .slice()
          .reverse()
          .map((part) => (
            <li
              key={part.id}
              onClick={() => onSelect(part.id)}
              className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 ${
                part.id === selectedId
                  ? "border-primary bg-primary/15"
                  : "border-border bg-panel-2 hover:bg-panel"
              }`}
            >
              <span className="min-w-0 flex-1 truncate">
                {part.slotName ?? part.name}
                <span className="ml-1 text-[10px] text-muted-foreground">
                  {roleLabel(part.role)}
                </span>
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(part.id, { visible: !part.visible });
                }}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
                title={part.visible ? "Hide" : "Show"}
              >
                {part.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(part.id, { zIndex: part.zIndex + 1 });
                }}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
                title="Bring forward"
              >
                <ArrowUp size={14} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(part.id, { zIndex: part.zIndex - 1 });
                }}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
                title="Send backward"
              >
                <ArrowDown size={14} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(part.id);
                }}
                className="rounded p-1 text-destructive"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
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
  onCanvasChange,
  rigSelected,
  onRigChange,
  onRigPreview,
  onRigAudioFile,
  rigAudioPlaying,
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
  onCanvasChange: (patch: Partial<CharacterPreset>) => void;
  rigSelected: boolean;
  onRigChange: (rig: MouthRig) => void;
  onRigPreview: (visemes: MouthViseme[]) => void;
  onRigAudioFile: (file: File) => void;
  rigAudioPlaying: boolean;
}) {
  if (rigSelected && doc.mouthRig) {
    const rig = doc.mouthRig;
    const p = rig.placement;
    const setP = (patch: Partial<typeof p>) =>
      onRigChange({ ...rig, placement: { ...p, ...patch } });
    return (
      <div className="space-y-4">
        <CanvasControls doc={doc} onChange={onCanvasChange} />
        <section className="rounded border border-border bg-panel-2 p-3">
          <div className="mb-3 font-medium">Mouth Rig — {rig.styleId}</div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="X">
              <input
                type="number"
                value={p.x}
                onChange={(e) => setP({ x: Number(e.target.value) })}
                className="w-full rounded border border-border bg-background px-2 py-1"
              />
            </Field>
            <Field label="Y">
              <input
                type="number"
                value={p.y}
                onChange={(e) => setP({ y: Number(e.target.value) })}
                className="w-full rounded border border-border bg-background px-2 py-1"
              />
            </Field>
            <Field label="Width">
              <input
                type="number"
                value={p.width}
                onChange={(e) => setP({ width: Number(e.target.value) })}
                className="w-full rounded border border-border bg-background px-2 py-1"
              />
            </Field>
            <Field label="Height">
              <input
                type="number"
                value={p.height}
                onChange={(e) => setP({ height: Number(e.target.value) })}
                className="w-full rounded border border-border bg-background px-2 py-1"
              />
            </Field>
            <Field label="Z-index">
              <input
                type="number"
                value={p.zIndex}
                onChange={(e) => setP({ zIndex: Number(e.target.value) })}
                className="w-full rounded border border-border bg-background px-2 py-1"
              />
            </Field>
          </div>
        </section>
        <section className="rounded border border-border bg-panel-2 p-3">
          <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
            Test Talk
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2">
            {SAMPLE_WORDS.map((word) => (
              <button
                key={word}
                type="button"
                onClick={() => onRigPreview(wordToVisemes(word))}
                className="rounded border border-border px-2 py-1 hover:bg-panel"
              >
                {word}
              </button>
            ))}
          </div>
          <div className="mb-1 text-[10px] text-muted-foreground">Or test with audio:</div>
          <label
            className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-[11px] ${
              rigAudioPlaying
                ? "border-primary bg-primary/10 text-primary"
                : "border-border hover:bg-panel"
            }`}
          >
            <Upload size={13} />
            {rigAudioPlaying ? "Playing…" : "Load audio file"}
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onRigAudioFile(file);
                if (e.target) e.target.value = "";
              }}
            />
          </label>
        </section>
      </div>
    );
  }

  if (!part) {
    return (
      <div className="space-y-4">
        <CanvasControls doc={doc} onChange={onCanvasChange} />
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
      <CanvasControls doc={doc} onChange={onCanvasChange} />
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
          <Field label="Rig behavior">
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
            label="Layer"
            value={part.zIndex}
            onChange={(zIndex) => onChange(part.id, { zIndex })}
          />
        </div>
      </section>

      <section className="rounded border border-border bg-panel-2 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-semibold uppercase tracking-wider text-muted-foreground">
            Rig Helpers
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
      </div>
    </section>
  );
}

function RigPlacementLayer({
  rig,
  selected,
  scale,
  currentViseme = "rest",
  onSelect,
  onChange,
}: {
  rig: MouthRig;
  selected: boolean;
  scale: number;
  currentViseme?: MouthViseme;
  onSelect: () => void;
  onChange: (placement: MouthRig["placement"]) => void;
}) {
  const rigStyle = RIG_STYLES.find((s) => s.id === rig.styleId) ?? RIG_STYLES[0];
  const { placement: p } = rig;

  const startDrag = (e: React.PointerEvent) => {
    e.stopPropagation();
    onSelect();
    if (e.button !== 0) return;
    const sx = e.clientX,
      sy = e.clientY;
    const ox = p.x,
      oy = p.y;
    const move = (ev: PointerEvent) =>
      onChange({
        ...p,
        x: Math.round(ox + (ev.clientX - sx) / scale),
        y: Math.round(oy + (ev.clientY - sy) / scale),
      });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const resize = (corner: ResizeCorner) => (e: React.PointerEvent) => {
    e.stopPropagation();
    const sx = e.clientX,
      sy = e.clientY;
    const { x: ox, y: oy, width: ow, height: oh } = p;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / scale;
      const dy = (ev.clientY - sy) / scale;
      const width = Math.max(20, corner.includes("e") ? ow + dx : ow - dx);
      const height = Math.max(12, corner.includes("s") ? oh + dy : oh - dy);
      onChange({
        ...p,
        width: Math.round(width),
        height: Math.round(height),
        x: Math.round(corner.includes("w") ? ox + (ow - width) : ox),
        y: Math.round(corner.includes("n") ? oy + (oh - height) : oy),
      });
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
      onPointerDown={startDrag}
      className={`absolute cursor-move select-none outline outline-offset-0 ${selected ? "outline-2 outline-primary" : "outline-1 outline-transparent hover:outline-accent/70"}`}
      style={{ left: p.x, top: p.y, width: p.width, height: p.height, zIndex: p.zIndex }}
    >
      <RigPreview
        style={rigStyle}
        pose={rig.poses[currentViseme] ?? rig.poses.rest}
        colors={rig}
        widthScale={rig.widthScale}
        upperCurve={rig.upperCurve}
        lowerCurve={rig.lowerCurve}
      />
      {selected && (
        <>
          <ResizeHandle corner="nw" onResize={resize} />
          <ResizeHandle corner="ne" onResize={resize} />
          <ResizeHandle corner="sw" onResize={resize} />
          <ResizeHandle corner="se" onResize={resize} />
        </>
      )}
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

function ResizeHandle({
  corner,
  onResize,
}: {
  corner: ResizeCorner;
  onResize: (corner: ResizeCorner) => (e: React.PointerEvent) => void;
}) {
  const vertical = corner.includes("n") ? "-top-1.5" : "-bottom-1.5";
  const horizontal = corner.includes("w") ? "-left-1.5" : "-right-1.5";
  const cursor = corner === "nw" || corner === "se" ? "cursor-nwse-resize" : "cursor-nesw-resize";
  return (
    <div
      onPointerDown={onResize(corner)}
      className={`absolute ${vertical} ${horizontal} h-3.5 w-3.5 rounded-sm border border-background bg-primary ${cursor}`}
    />
  );
}

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
    const visemes = preview.visemes ?? ["rest", "A", "E", "O", "MBP"];
    const idx = Math.floor(t * visemes.length * 1.1) % visemes.length;
    const active = visemes[idx];
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
