import { useEffect, useRef, useState, type SVGAttributes } from "react";
import { MouthCreator, RigPreview } from "./MouthCreator";
import { RIG_STYLES } from "./mouth-libraries";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  Eye,
  EyeOff,
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
  defaultMovementForRole,
  makePart,
  normalizeCharacterSlots,
  normalizePartManifest,
  roleEnabledByManifest,
  roleLabel,
  saveCharacter,
} from "./character-utils";
import { MOUTH_VISEMES, MOUTH_VISEME_DESCRIPTIONS } from "../lipsync/viseme-schema";
import {
  clamp,
  fmt,
  parseSvgPath,
  parseViewBox,
  resolvePoint,
  type PathCommand,
} from "./mouth-morph";
import type {
  CharacterPart,
  CharacterPartBounds,
  CharacterPreset,
  EyeState,
  ID,
  MouthRig,
  MouthViseme,
  MovementPresetKind,
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

const MOVEMENT_OPTIONS: Array<{ value: MovementPresetKind; label: string }> = [
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

export function CharacterEditor({ characterId }: Props) {
  const navigate = useNavigate();
  const [doc, setDoc] = useState<CharacterPreset | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<ID | null>(null);
  const [rigSelected, setRigSelected] = useState(false);
  const [scale, setScale] = useState(0.7);
  const [mode, setMode] = useState<EditorMode>("select");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [, setPreviewTick] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [rigPreview, setRigPreview] = useState<{ visemes: MouthViseme[]; startedAt: number; durationMs: number } | null>(null);
  const [rigAudioViseme, setRigAudioViseme] = useState<MouthViseme>("rest");
  const [rigAudioPlaying, setRigAudioPlaying] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rigAudioCtxRef = useRef<AudioContext | null>(null);
  const rigRafRef = useRef<number | null>(null);

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
        ...fitted,
        ...options.placement,
        zIndex: options.zIndex ?? maxZ(doc.parts) + 1,
        movement: defaultMovementForRole(role, viseme),
      });
      addPart(part);
      setStatus(`${file.name} added`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not import SVG.");
    }
  };

  const selectedPart = doc.parts.find((p) => p.id === selectedPartId) ?? null;
  const orderedParts = doc.parts.slice().sort((a, b) => a.zIndex - b.zIndex);

  const selectPart = (id: ID) => { setSelectedPartId(id); setRigSelected(false); };
  const selectRig = () => { setSelectedPartId(null); setRigSelected(true); };
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
            parts={orderedParts.filter((p) => !(p.role === "mouth" && effectiveMouthMode === "rig"))}
            selectedId={selectedPartId}
            onSelect={selectPart}
            onChange={updatePart}
            onRemove={removePart}
            mouthRig={effectiveMouthMode === "rig" ? doc.mouthRig : undefined}
            rigSelected={rigSelected}
            onSelectRig={selectRig}
            onChangeRigZIndex={(z) => doc.mouthRig && updateDoc({ mouthRig: { ...doc.mouthRig, placement: { ...doc.mouthRig.placement, zIndex: z } } })}
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
              className="absolute left-0 top-0 origin-top-left"
              style={{
                width: doc.canvasWidth,
                height: doc.canvasHeight,
                transform: `scale(${scale})`,
              }}
            >
              {orderedParts
                .filter((part) => roleEnabledByManifest(part.role, manifest))
                .filter((part) => !(part.role === "mouth" && effectiveMouthMode === "rig"))
                .map((part) => (
                  <PartLayer
                    key={part.id}
                    part={part}
                    selected={part.id === selectedPartId}
                    scale={scale}
                    mode={mode}
                    preview={preview}
                    previewParentPart={previewParentPart}
                    onSelect={() => selectPart(part.id)}
                    onChange={(patch) => updatePart(part.id, patch)}
                    onModeDone={() => setMode("select")}
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
            onModeChange={setMode}
            onChange={updatePart}
            onRemove={removePart}
            onDuplicate={duplicatePart}
            onPreview={setPreview}
            onCanvasChange={(patch) => updateDoc(patch)}
            rigSelected={rigSelected}
            onRigChange={(rig) => updateDoc({ mouthRig: rig })}
            onRigPreview={(visemes) => setRigPreview({ visemes, startedAt: Date.now(), durationMs: 1400 })}
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
            onSave={(rig) => { onSaveRig(rig); setDesignerOpen(false); }}
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
              rigSelected ? "border-primary bg-primary/15" : "border-border bg-panel-2 hover:bg-panel"
            }`}
          >
            <span className="min-w-0 flex-1 truncate font-medium">
              Mouth rig
              <span className="ml-1 font-normal text-muted-foreground">{mouthRig.styleId}</span>
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onChangeRigZIndex?.(mouthRig.placement.zIndex + 1); }}
              className="rounded p-1 text-muted-foreground hover:text-foreground" title="Bring forward"
            ><ArrowUp size={14} /></button>
            <button
              onClick={(e) => { e.stopPropagation(); onChangeRigZIndex?.(mouthRig.placement.zIndex - 1); }}
              className="rounded p-1 text-muted-foreground hover:text-foreground" title="Send backward"
            ><ArrowDown size={14} /></button>
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
  onModeChange,
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
  onModeChange: (mode: EditorMode) => void;
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
    const setP = (patch: Partial<typeof p>) => onRigChange({ ...rig, placement: { ...p, ...patch } });
    return (
      <div className="space-y-4">
        <CanvasControls doc={doc} onChange={onCanvasChange} />
        <section className="rounded border border-border bg-panel-2 p-3">
          <div className="mb-3 font-medium">Mouth Rig — {rig.styleId}</div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="X"><input type="number" value={p.x} onChange={(e) => setP({ x: Number(e.target.value) })} className="w-full rounded border border-border bg-background px-2 py-1" /></Field>
            <Field label="Y"><input type="number" value={p.y} onChange={(e) => setP({ y: Number(e.target.value) })} className="w-full rounded border border-border bg-background px-2 py-1" /></Field>
            <Field label="Width"><input type="number" value={p.width} onChange={(e) => setP({ width: Number(e.target.value) })} className="w-full rounded border border-border bg-background px-2 py-1" /></Field>
            <Field label="Height"><input type="number" value={p.height} onChange={(e) => setP({ height: Number(e.target.value) })} className="w-full rounded border border-border bg-background px-2 py-1" /></Field>
            <Field label="Z-index"><input type="number" value={p.zIndex} onChange={(e) => setP({ zIndex: Number(e.target.value) })} className="w-full rounded border border-border bg-background px-2 py-1" /></Field>
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
                  movement: defaultMovementForRole(e.target.value as PartRole, part.viseme),
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
          <Field label="Movement">
            <select
              value={part.movement ?? "none"}
              onChange={(e) =>
                onChange(part.id, { movement: e.target.value as MovementPresetKind })
              }
              className="w-full rounded border border-border bg-background px-2 py-1"
            >
              {MOVEMENT_OPTIONS.map((item) => (
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
            value={Math.round(part.pivot?.x ?? part.x + part.width / 2)}
            onChange={(x) =>
              onChange(part.id, { pivot: { x, y: part.pivot?.y ?? part.y + part.height / 2 } })
            }
          />
          <NumberField
            label="Pivot Y"
            value={Math.round(part.pivot?.y ?? part.y + part.height / 2)}
            onChange={(y) =>
              onChange(part.id, { pivot: { x: part.pivot?.x ?? part.x + part.width / 2, y } })
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
    const sx = e.clientX, sy = e.clientY;
    const ox = p.x, oy = p.y;
    const move = (ev: PointerEvent) => onChange({ ...p, x: Math.round(ox + (ev.clientX - sx) / scale), y: Math.round(oy + (ev.clientY - sy) / scale) });
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const resize = (corner: ResizeCorner) => (e: React.PointerEvent) => {
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY;
    const { x: ox, y: oy, width: ow, height: oh } = p;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / scale;
      const dy = (ev.clientY - sy) / scale;
      const width = Math.max(20, corner.includes("e") ? ow + dx : ow - dx);
      const height = Math.max(12, corner.includes("s") ? oh + dy : oh - dy);
      onChange({ ...p, width: Math.round(width), height: Math.round(height), x: Math.round(corner.includes("w") ? ox + (ow - width) : ox), y: Math.round(corner.includes("n") ? oy + (oh - height) : oy) });
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
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
  scale,
  mode,
  preview,
  previewParentPart,
  onSelect,
  onChange,
  onModeDone,
}: {
  part: CharacterPart;
  selected: boolean;
  scale: number;
  mode: EditorMode;
  preview: PreviewState | null;
  previewParentPart?: CharacterPart;
  onSelect: () => void;
  onChange: (patch: Partial<CharacterPart>) => void;
  onModeDone: () => void;
}) {
  const url = useMediaUrl(part.mediaId);
  const layerRef = useRef<HTMLDivElement>(null);
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
  const pivot = part.pivot ?? { x: part.x + part.width / 2, y: part.y + part.height / 2 };

  const startDrag = (e: React.PointerEvent) => {
    e.stopPropagation();
    onSelect();
    if (e.button !== 0) return;
    if (mode === "pivot") {
      const rect = layerRef.current?.getBoundingClientRect();
      const localX = rect ? (e.clientX - rect.left) / scale : part.width / 2;
      const localY = rect ? (e.clientY - rect.top) / scale : part.height / 2;
      onChange({
        pivot: {
          x: Math.round(localX + part.x),
          y: Math.round(localY + part.y),
        },
      });
      onModeDone();
      return;
    }
    if (mode.startsWith("bounds")) {
      onChange({
        bounds: {
          type: mode === "bounds-ellipse" ? "ellipse" : "rect",
          x: Math.round(part.x - part.width * 0.08),
          y: Math.round(part.y - part.height * 0.08),
          width: Math.round(part.width * 1.16),
          height: Math.round(part.height * 1.16),
        },
      });
      onModeDone();
      return;
    }
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = part.x;
    const oy = part.y;
    const originalPivot = pivot;
    const move = (ev: PointerEvent) => {
      const dx = Math.round((ev.clientX - sx) / scale);
      const dy = Math.round((ev.clientY - sy) / scale);
      onChange({
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

  const resize = (corner: ResizeCorner) => (e: React.PointerEvent) => {
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const ow = part.width;
    const oh = part.height;
    const ox = part.x;
    const oy = part.y;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / scale;
      const dy = (ev.clientY - sy) / scale;
      const width = Math.max(8, corner.includes("e") ? ow + dx : ow - dx);
      const height = Math.max(8, corner.includes("s") ? oh + dy : oh - dy);
      onChange({
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

  const rotate = (e: React.PointerEvent) => {
    e.stopPropagation();
    const el = layerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const start = Math.atan2(e.clientY - cy, e.clientX - cx);
    const base = part.rotation;
    const move = (ev: PointerEvent) => {
      const now = Math.atan2(ev.clientY - cy, ev.clientX - cx);
      onChange({ rotation: Math.round(base + ((now - start) * 180) / Math.PI) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <>
      {part.bounds && <BoundsOverlay bounds={part.bounds} zIndex={part.zIndex - 1} />}
      <div
        ref={layerRef}
        onPointerDown={startDrag}
        className={`absolute select-none outline outline-offset-0 ${
          selected
            ? "outline-2 outline-primary"
            : "outline-1 outline-transparent hover:outline-accent/70"
        }`}
        style={{
          left: part.x + previewTransform.dx,
          top: part.y + previewTransform.dy,
          width: part.width,
          height: part.height,
          zIndex: part.zIndex,
          opacity,
          cursor: mode === "select" ? "move" : "crosshair",
          transform: `rotate(${part.rotation + previewTransform.rotation}deg) scale(${previewTransform.scale}, ${previewTransform.scaleY ?? previewTransform.scale})`,
          transformOrigin: `${((pivot.x - part.x) / part.width) * 100}% ${((pivot.y - part.y) / part.height) * 100}%`,
        }}
      >
        {url && (
          <img
            src={url}
            alt={part.name}
            draggable={false}
            className="h-full w-full object-contain"
          />
        )}
        {selected && (
          <>
            <ResizeHandle corner="nw" onResize={resize} />
            <ResizeHandle corner="ne" onResize={resize} />
            <ResizeHandle corner="sw" onResize={resize} />
            <ResizeHandle corner="se" onResize={resize} />
            <button
              onPointerDown={rotate}
              className="absolute left-1/2 top-0 flex h-6 w-6 -translate-x-1/2 -translate-y-9 items-center justify-center rounded-full border border-primary bg-background text-primary"
              title="Rotate"
            >
              <RotateCw size={14} />
            </button>
            <div
              className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background"
              style={{ left: pivot.x - part.x, top: pivot.y - part.y }}
            />
          </>
        )}
      </div>
    </>
  );
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

interface EditableMouthPoint {
  id: string;
  x: number;
  y: number;
  commandIndex: number;
  valueIndex: number;
  role: "anchor" | "control";
}

interface EditableMouthPath {
  path: string;
  viewBox: string;
  points: EditableMouthPoint[];
}

function MouthPointHandles({
  editable,
  part,
  scale,
  onChange,
}: {
  editable: EditableMouthPath;
  part: CharacterPart;
  scale: number;
  onChange: (path: string) => void;
}) {
  const box = parseViewBox(editable.viewBox);
  const toLocal = (point: { x: number; y: number }) => ({
    x: ((point.x - box.x) / Math.max(1, box.width)) * part.width,
    y: ((point.y - box.y) / Math.max(1, box.height)) * part.height,
  });

  return (
    <>
      {editable.points.map((point) => {
        const local = toLocal(point);
        return (
          <div
            key={point.id}
            onPointerDown={(e) => {
              e.stopPropagation();
              const sx = e.clientX;
              const sy = e.clientY;
              const move = (ev: PointerEvent) => {
                const dx = (ev.clientX - sx) / scale;
                const dy = (ev.clientY - sy) / scale;
                const nextX = point.x + (dx / Math.max(1, part.width)) * box.width;
                const nextY = point.y + (dy / Math.max(1, part.height)) * box.height;
                const nextPath = updateEditableMouthPoint(editable.path, point, nextX, nextY);
                onChange(nextPath);
              };
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
            className={`absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border ${
              point.role === "anchor" ? "border-primary bg-primary" : "border-background bg-accent"
            }`}
            style={{ left: local.x, top: local.y }}
            title={point.role === "anchor" ? "Anchor point" : "Control point"}
          />
        );
      })}
    </>
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
  if (part.role === "eye" || (part.role === "custom" && part.movement === "blink"))
    out.push({ kind: "blink", label: "Test Blink" });
  if (part.role === "mouth" || (part.role === "custom" && part.movement === "lipSync"))
    out.push({ kind: "talk", label: "Test Talk" });
  if (part.role === "arm") out.push({ kind: "wave", label: "Test Wave" });
  if (part.role === "leg" || part.role === "foot") out.push({ kind: "kick", label: "Test Kick" });
  if (part.role === "custom" && part.movement === "rotate")
    out.push({ kind: "wave", label: "Test Wave" });
  if (part.role === "head") out.push({ kind: "nod", label: "Test Nod" });
  if (part.role === "hair" || (part.role === "custom" && part.movement === "bounce"))
    out.push({ kind: "bounce", label: "Test Bounce" });
  if (part.role === "eyebrow" || (part.role === "custom" && part.movement === "raise"))
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

async function readSvgMorphMetadata(file: File, parts: CharacterPart[]) {
  const text = await file.text();
  const svgMatch = text.match(/<svg\b([^>]*)>/i);
  const pathMatch = text.match(/<path\b([^>]*)>/i);
  const svgAttrs = parseSvgAttributes(svgMatch?.[1] ?? "");
  const pathAttrs = parseSvgAttributes(pathMatch?.[1] ?? "");
  const viewBox = svgAttrs.viewBox ?? inferViewBoxFromSvgAttrs(svgAttrs);
  const primaryPath =
    pathAttrs.d || extractSupportedShapePath(text, viewBox) || createGenericRestMouthPath(viewBox);
  const commandCount = primaryPath ? (primaryPath.match(/[a-z]/gi) ?? []).length : 0;
  const rest = parts.find((p) => p.role === "mouth" && p.viseme === "rest");
  return {
    primaryPath,
    viewBox,
    fill: pathAttrs.fill ?? extractSupportedShapeStyles(text).fill,
    stroke: pathAttrs.stroke ?? extractSupportedShapeStyles(text).stroke,
    strokeWidth: pathAttrs["stroke-width"] ?? extractSupportedShapeStyles(text).strokeWidth,
    strokeLinecap: pathAttrs["stroke-linecap"] ?? extractSupportedShapeStyles(text).strokeLinecap,
    strokeLinejoin:
      pathAttrs["stroke-linejoin"] ?? extractSupportedShapeStyles(text).strokeLinejoin,
    commandCount,
    compatibleWithRest: rest?.morph?.commandCount
      ? rest.morph.commandCount === commandCount
      : undefined,
  };
}

function parseSvgAttributes(input: string) {
  const attrs: Record<string, string> = {};
  for (const match of input.matchAll(/([:\w-]+)=["']([^"']*)["']/g)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function inferViewBoxFromSvgAttrs(attrs: Record<string, string>) {
  const width = parseSvgLength(attrs.width, 100);
  const height = parseSvgLength(attrs.height, 60);
  return `0 0 ${fmt(width)} ${fmt(height)}`;
}

function parseSvgLength(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const match = value.match(/[-+]?(?:\d*\.\d+|\d+\.?)/);
  return match ? Number(match[0]) : fallback;
}

function extractSupportedShapeStyles(text: string) {
  const tagMatch = text.match(/<(ellipse|circle|rect|polygon|polyline|line)\b([^>]*)>/i);
  const attrs = parseSvgAttributes(tagMatch?.[2] ?? "");
  return {
    fill: attrs.fill,
    stroke: attrs.stroke,
    strokeWidth: attrs["stroke-width"],
    strokeLinecap: attrs["stroke-linecap"],
    strokeLinejoin: attrs["stroke-linejoin"],
  };
}

function extractSupportedShapePath(text: string, viewBox: string) {
  const ellipseMatch = text.match(/<ellipse\b([^>]*)>/i);
  if (ellipseMatch) {
    const attrs = parseSvgAttributes(ellipseMatch[1]);
    return ellipseToPath(
      parseSvgLength(attrs.cx, 50),
      parseSvgLength(attrs.cy, 30),
      parseSvgLength(attrs.rx, 34),
      parseSvgLength(attrs.ry, 12),
    );
  }

  const circleMatch = text.match(/<circle\b([^>]*)>/i);
  if (circleMatch) {
    const attrs = parseSvgAttributes(circleMatch[1]);
    const r = parseSvgLength(attrs.r, 12);
    return ellipseToPath(parseSvgLength(attrs.cx, 50), parseSvgLength(attrs.cy, 30), r, r);
  }

  const rectMatch = text.match(/<rect\b([^>]*)>/i);
  if (rectMatch) {
    const attrs = parseSvgAttributes(rectMatch[1]);
    return rectToPath(
      parseSvgLength(attrs.x, 12),
      parseSvgLength(attrs.y, 18),
      parseSvgLength(attrs.width, 76),
      parseSvgLength(attrs.height, 24),
      parseSvgLength(attrs.rx, 0),
      parseSvgLength(attrs.ry, parseSvgLength(attrs.rx, 0)),
    );
  }

  const polygonMatch = text.match(/<polygon\b([^>]*)>/i);
  if (polygonMatch) {
    const attrs = parseSvgAttributes(polygonMatch[1]);
    return pointsElementToPath(attrs.points, true);
  }

  const polylineMatch = text.match(/<polyline\b([^>]*)>/i);
  if (polylineMatch) {
    const attrs = parseSvgAttributes(polylineMatch[1]);
    return pointsElementToPath(attrs.points, false);
  }

  const lineMatch = text.match(/<line\b([^>]*)>/i);
  if (lineMatch) {
    const attrs = parseSvgAttributes(lineMatch[1]);
    return lineToMouthPath(
      parseSvgLength(attrs.x1, 18),
      parseSvgLength(attrs.y1, 30),
      parseSvgLength(attrs.x2, 82),
      parseSvgLength(attrs.y2, 30),
      viewBox,
    );
  }

  return null;
}

function ellipseToPath(cx: number, cy: number, rx: number, ry: number) {
  return [
    `M ${fmt(cx - rx)} ${fmt(cy)}`,
    `A ${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx + rx)} ${fmt(cy)}`,
    `A ${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx - rx)} ${fmt(cy)}`,
    "Z",
  ].join(" ");
}

function rectToPath(x: number, y: number, width: number, height: number, rx: number, ry: number) {
  const safeRx = clamp(rx, 0, width / 2);
  const safeRy = clamp(ry, 0, height / 2);
  if (safeRx <= 0 && safeRy <= 0) {
    return [
      `M ${fmt(x)} ${fmt(y)}`,
      `L ${fmt(x + width)} ${fmt(y)}`,
      `L ${fmt(x + width)} ${fmt(y + height)}`,
      `L ${fmt(x)} ${fmt(y + height)}`,
      "Z",
    ].join(" ");
  }

  return [
    `M ${fmt(x + safeRx)} ${fmt(y)}`,
    `L ${fmt(x + width - safeRx)} ${fmt(y)}`,
    `A ${fmt(safeRx)} ${fmt(safeRy)} 0 0 1 ${fmt(x + width)} ${fmt(y + safeRy)}`,
    `L ${fmt(x + width)} ${fmt(y + height - safeRy)}`,
    `A ${fmt(safeRx)} ${fmt(safeRy)} 0 0 1 ${fmt(x + width - safeRx)} ${fmt(y + height)}`,
    `L ${fmt(x + safeRx)} ${fmt(y + height)}`,
    `A ${fmt(safeRx)} ${fmt(safeRy)} 0 0 1 ${fmt(x)} ${fmt(y + height - safeRy)}`,
    `L ${fmt(x)} ${fmt(y + safeRy)}`,
    `A ${fmt(safeRx)} ${fmt(safeRy)} 0 0 1 ${fmt(x + safeRx)} ${fmt(y)}`,
    "Z",
  ].join(" ");
}

function pointsElementToPath(points: string | undefined, closed: boolean) {
  if (!points) return null;
  const nums = points.match(/[-+]?(?:\d*\.\d+|\d+\.?)/g)?.map(Number) ?? [];
  if (nums.length < 4) return null;
  const pairs: Array<{ x: number; y: number }> = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pairs.push({ x: nums[i], y: nums[i + 1] });
  }
  if (pairs.length < 2) return null;
  return [
    `M ${fmt(pairs[0].x)} ${fmt(pairs[0].y)}`,
    ...pairs.slice(1).map((pair) => `L ${fmt(pair.x)} ${fmt(pair.y)}`),
    closed ? "Z" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function lineToMouthPath(x1: number, y1: number, x2: number, y2: number, viewBox: string) {
  const box = parseViewBox(viewBox);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / length;
  const ny = dx / length;
  const thickness = Math.max(3, Math.min(box.height * 0.18, 8));
  const ox = nx * thickness;
  const oy = ny * thickness;
  return [
    `M ${fmt(x1 + ox)} ${fmt(y1 + oy)}`,
    `L ${fmt(x2 + ox)} ${fmt(y2 + oy)}`,
    `L ${fmt(x2 - ox)} ${fmt(y2 - oy)}`,
    `L ${fmt(x1 - ox)} ${fmt(y1 - oy)}`,
    "Z",
  ].join(" ");
}

function createGenericRestMouthPath(viewBox: string) {
  const box = parseViewBox(viewBox);
  const left = box.x + box.width * 0.16;
  const right = box.x + box.width * 0.84;
  const cx = box.x + box.width / 2;
  const top = box.y + box.height * 0.36;
  const bottom = box.y + box.height * 0.64;
  const upperControlY = box.y + box.height * 0.24;
  const lowerControlY = box.y + box.height * 0.76;
  const innerLeft = box.x + box.width * 0.38;
  const innerRight = box.x + box.width * 0.62;
  return [
    `M ${fmt(left)} ${fmt((top + bottom) / 2)}`,
    `C ${fmt(box.x + box.width * 0.26)} ${fmt(upperControlY)} ${fmt(innerLeft)} ${fmt(top)} ${fmt(cx)} ${fmt(top)}`,
    `C ${fmt(innerRight)} ${fmt(top)} ${fmt(box.x + box.width * 0.74)} ${fmt(upperControlY)} ${fmt(right)} ${fmt((top + bottom) / 2)}`,
    `C ${fmt(box.x + box.width * 0.74)} ${fmt(lowerControlY)} ${fmt(innerRight)} ${fmt(bottom)} ${fmt(cx)} ${fmt(bottom)}`,
    `C ${fmt(innerLeft)} ${fmt(bottom)} ${fmt(box.x + box.width * 0.26)} ${fmt(lowerControlY)} ${fmt(left)} ${fmt((top + bottom) / 2)}`,
    "Z",
  ].join(" ");
}

function buildEditableMouthPath(path: string, viewBox = "0 0 100 60"): EditableMouthPath {
  const commands = absolutizePathCommands(path);
  const points: EditableMouthPoint[] = [];
  commands.forEach((command, commandIndex) => {
    const pairs = pointIndicesForCommand(command.cmd);
    pairs.forEach(([xIndex, yIndex], pairIndex) => {
      points.push({
        id: `${commandIndex}:${xIndex}`,
        x: command.values[xIndex],
        y: command.values[yIndex],
        commandIndex,
        valueIndex: xIndex,
        role:
          pairIndex === pairs.length - 1 &&
          (command.cmd === "M" ||
            command.cmd === "L" ||
            command.cmd === "T" ||
            command.cmd === "S" ||
            command.cmd === "Q" ||
            command.cmd === "C" ||
            command.cmd === "A")
            ? "anchor"
            : "control",
      });
    });
  });
  return {
    path: serializePathCommands(commands),
    viewBox,
    points,
  };
}

function updateEditableMouthPoint(
  path: string,
  point: EditableMouthPoint,
  nextX: number,
  nextY: number,
) {
  const commands = parseSvgPath(path).map((command) => ({
    ...command,
    values: [...command.values],
  }));
  const command = commands[point.commandIndex];
  if (!command) return path;
  command.values[point.valueIndex] = nextX;
  command.values[point.valueIndex + 1] = nextY;
  return serializePathCommands(commands);
}







function absolutizePathCommands(path: string): PathCommand[] {
  const commands = parseSvgPath(path);
  const out: PathCommand[] = [];
  const state = { x: 0, y: 0, subpathX: 0, subpathY: 0 };
  for (const command of commands) {
    const upper = command.cmd.toUpperCase();
    const relative = command.cmd !== upper;
    switch (upper) {
      case "M":
      case "L":
      case "T": {
        const point = resolvePoint(command.values[0], command.values[1], relative, state);
        out.push({ cmd: upper, values: [point.x, point.y] });
        state.x = point.x;
        state.y = point.y;
        if (upper === "M") {
          state.subpathX = point.x;
          state.subpathY = point.y;
        }
        break;
      }
      case "H": {
        const point = resolvePoint(command.values[0], 0, relative, state, true, false);
        out.push({ cmd: "L", values: [point.x, state.y] });
        state.x = point.x;
        break;
      }
      case "V": {
        const point = resolvePoint(0, command.values[0], relative, state, false, true);
        out.push({ cmd: "L", values: [state.x, point.y] });
        state.y = point.y;
        break;
      }
      case "C": {
        const p1 = resolvePoint(command.values[0], command.values[1], relative, state);
        const p2 = resolvePoint(command.values[2], command.values[3], relative, state);
        const p = resolvePoint(command.values[4], command.values[5], relative, state);
        out.push({ cmd: "C", values: [p1.x, p1.y, p2.x, p2.y, p.x, p.y] });
        state.x = p.x;
        state.y = p.y;
        break;
      }
      case "S":
      case "Q": {
        const p1 = resolvePoint(command.values[0], command.values[1], relative, state);
        const p = resolvePoint(command.values[2], command.values[3], relative, state);
        out.push({ cmd: upper, values: [p1.x, p1.y, p.x, p.y] });
        state.x = p.x;
        state.y = p.y;
        break;
      }
      case "A": {
        const p = resolvePoint(command.values[5], command.values[6], relative, state);
        out.push({
          cmd: "A",
          values: [
            command.values[0],
            command.values[1],
            command.values[2],
            command.values[3],
            command.values[4],
            p.x,
            p.y,
          ],
        });
        state.x = p.x;
        state.y = p.y;
        break;
      }
      case "Z":
        out.push({ cmd: "Z", values: [] });
        state.x = state.subpathX;
        state.y = state.subpathY;
        break;
    }
  }
  return out;
}

function pointIndicesForCommand(cmd: string): Array<[number, number]> {
  switch (cmd) {
    case "M":
    case "L":
    case "T":
      return [[0, 1]];
    case "Q":
    case "S":
      return [
        [0, 1],
        [2, 3],
      ];
    case "C":
      return [
        [0, 1],
        [2, 3],
        [4, 5],
      ];
    case "A":
      return [[5, 6]];
    default:
      return [];
  }
}

function serializePathCommands(commands: PathCommand[]) {
  return commands
    .map((command) =>
      command.values.length > 0
        ? `${command.cmd} ${command.values.map((value) => fmt(value)).join(" ")}`
        : command.cmd,
    )
    .join(" ");
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
    patch.height !== undefined
      ? (part.pivot ?? { x: part.x + part.width / 2, y: part.y + part.height / 2 })
      : part.pivot;
  const anchorX = pivot ? clamp((pivot.x - part.x) / Math.max(1, part.width), 0, 1) : part.anchorX;
  const anchorY = pivot ? clamp((pivot.y - part.y) / Math.max(1, part.height), 0, 1) : part.anchorY;
  return {
    ...part,
    anchorX,
    anchorY,
    pivot,
    movement: part.movement ?? defaultMovementForRole(part.role, part.viseme),
  };
}

