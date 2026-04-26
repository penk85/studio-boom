// CharacterEditor — full-screen editor for a CharacterPreset.
// Three panes: parts list (left), live canvas (center), part inspector (right).
import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db, importMediaFile } from "../db";
import { useMediaUrl } from "../hooks/useMediaUrl";
import {
  createBlankCharacter,
  groupParts,
  makePart,
  roleLabel,
  saveCharacter,
} from "./character-utils";
import type {
  CharacterPart,
  CharacterPreset,
  EyeState,
  HeadDirection,
  HeadVariant,
  MouthViseme,
  ParallaxConfig,
  PartManifest,
  PartRole,
} from "../types";
import { PresetRecorder } from "../presets/PresetRecorder";

const ALL_ROLES: PartRole[] = [
  "head", "body", "armL", "armR", "legL", "legR",
  "eye", "brow", "mouth", "extra",
];

const VISEMES: MouthViseme[] = ["rest", "A", "E", "I", "O", "U", "MBP", "FV", "L"];
const EYE_STATES: EyeState[] = ["open", "half", "closed"];

interface Props {
  characterId: string;
}

export function CharacterEditor({ characterId }: Props) {
  const navigate = useNavigate();
  const [doc, setDoc] = useState<CharacterPreset | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [onionSkin, setOnionSkin] = useState(true);
  const [scale, setScale] = useState(0.7);
  const [recorderOpen, setRecorderOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Load or create
  useEffect(() => {
    (async () => {
      let row = await db.characters.get(characterId);
      if (!row) {
        row = createBlankCharacter();
        row.id = characterId;
        await db.characters.put(row);
      }
      setDoc(row);
    })();
  }, [characterId]);

  // Fit to container
  useEffect(() => {
    if (!doc) return;
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth - 64;
      const h = el.clientHeight - 64;
      setScale(Math.max(0.1, Math.min(w / doc.canvasWidth, h / doc.canvasHeight, 1.5)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc]);

  // Debounced save
  useEffect(() => {
    if (!doc) return;
    const t = setTimeout(() => { void saveCharacter(doc); }, 400);
    return () => clearTimeout(t);
  }, [doc]);

  if (!doc) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        Loading character…
      </div>
    );
  }

  const update = (patch: Partial<CharacterPreset>) =>
    setDoc((d) => (d ? { ...d, ...patch } : d));

  const updatePart = (id: string, patch: Partial<CharacterPart>) =>
    setDoc((d) => (d ? { ...d, parts: d.parts.map((p) => (p.id === id ? { ...p, ...patch } : p)) } : d));

  const removePart = (id: string) =>
    setDoc((d) => (d ? { ...d, parts: d.parts.filter((p) => p.id !== id) } : d));

  const addPart = (part: CharacterPart) =>
    setDoc((d) => (d ? { ...d, parts: [...d.parts, part] } : d));

  const selectedPart = doc.parts.find((p) => p.id === selectedPartId) ?? null;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border bg-panel px-4 py-2">
        <Link to="/" className="rounded border border-border px-2 py-1 text-xs hover:bg-panel-2">
          ← Back to Studio
        </Link>
        <input
          value={doc.name}
          onChange={(e) => update({ name: e.target.value })}
          className="rounded border border-transparent bg-transparent px-2 py-1 text-sm font-semibold hover:border-border focus:border-primary focus:outline-none"
        />
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={onionSkin} onChange={(e) => setOnionSkin(e.target.checked)} />
            Onion skin
          </label>
          <button
            onClick={() => setRecorderOpen(true)}
            className="rounded border border-border px-2 py-1 text-xs hover:bg-panel-2"
            title="Record a new action preset by posing the character"
          >
            + Record preset
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
        <aside className="w-64 shrink-0 overflow-auto border-r border-border bg-panel p-3 text-xs">
          <ManifestEditor manifest={doc.manifest} onChange={(m) => update({ manifest: m })} />
          <PartsList
            parts={doc.parts}
            selectedId={selectedPartId}
            onSelect={setSelectedPartId}
            onAdd={addPart}
            onUpdate={updatePart}
            onRemove={removePart}
            manifest={doc.manifest}
            headVariants={doc.headVariants ?? []}
            onHeadVariantsChange={(v) => update({ headVariants: v })}
          />
        </aside>

        <main ref={wrapRef} className="relative flex min-w-0 flex-1 items-center justify-center bg-stage-bg p-8">
          <div
            className="relative shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)] outline outline-1 outline-border"
            style={{
              width: doc.canvasWidth * scale,
              height: doc.canvasHeight * scale,
              background: "oklch(0.12 0.015 270)",
            }}
            onClick={() => setSelectedPartId(null)}
          >
            <div
              className="absolute left-0 top-0 origin-top-left"
              style={{
                width: doc.canvasWidth,
                height: doc.canvasHeight,
                transform: `scale(${scale})`,
              }}
            >
              {doc.parts
                .slice()
                .sort((a, b) => a.zIndex - b.zIndex)
                .map((p) => (
                  <PartLayer
                    key={p.id}
                    part={p}
                    selected={p.id === selectedPartId}
                    scale={scale}
                    onionSkin={onionSkin}
                    onSelect={() => setSelectedPartId(p.id)}
                    onChange={(patch) => updatePart(p.id, patch)}
                  />
                ))}
            </div>
          </div>
          <div className="pointer-events-none absolute bottom-2 right-3 rounded bg-panel/80 px-2 py-1 text-[10px] text-muted-foreground">
            {doc.canvasWidth}×{doc.canvasHeight} · {Math.round(scale * 100)}%
          </div>
        </main>

        <aside className="w-72 shrink-0 overflow-auto border-l border-border bg-panel p-3 text-xs">
          {selectedPart ? (
            <PartInspector
              part={selectedPart}
              onChange={(patch) => updatePart(selectedPart.id, patch)}
              onRemove={() => { removePart(selectedPart.id); setSelectedPartId(null); }}
            />
          ) : (
            <div className="text-muted-foreground">
              Select a part to edit transform, anchor, depth, and z-index. Drag-reorder parts on the left to change z-index.
            </div>
          )}
          <div className="mt-6 border-t border-border pt-3">
            <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">Canvas</div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Width">
                <NumberInput value={doc.canvasWidth} onChange={(v) => update({ canvasWidth: Math.max(64, v) })} />
              </Field>
              <Field label="Height">
                <NumberInput value={doc.canvasHeight} onChange={(v) => update({ canvasHeight: Math.max(64, v) })} />
              </Field>
            </div>
          </div>

          <ParallaxEditor
            cfg={doc.parallax}
            onChange={(p) => update({ parallax: p })}
          />

          {/* Head Variants moved into the Head part group on the left. */}
        </aside>
      </div>

      {recorderOpen && (
        <PresetRecorder
          character={doc}
          onClose={() => setRecorderOpen(false)}
        />
      )}
    </div>
  );
}

function ManifestEditor({ manifest, onChange }: { manifest: PartManifest; onChange: (m: PartManifest) => void }) {
  const items: { key: keyof PartManifest; label: string }[] = [
    { key: "hasHead", label: "Head" },
    { key: "hasBody", label: "Body" },
    { key: "hasArms", label: "Arms" },
    { key: "hasLegs", label: "Legs" },
    { key: "hasEyes", label: "Eyes" },
    { key: "hasBrows", label: "Brows" },
    { key: "hasMouth", label: "Mouth" },
  ];
  return (
    <div className="mb-3 rounded border border-border bg-panel-2 p-2">
      <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">Has parts</div>
      <div className="grid grid-cols-2 gap-1">
        {items.map((it) => (
          <label key={it.key} className="flex items-center gap-1.5 text-[11px]">
            <input
              type="checkbox"
              checked={manifest[it.key]}
              onChange={(e) => onChange({ ...manifest, [it.key]: e.target.checked })}
            />
            {it.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function PartsList({
  parts, selectedId, onSelect, onAdd, onUpdate, onRemove, manifest,
  headVariants, onHeadVariantsChange,
}: {
  parts: CharacterPart[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (p: CharacterPart) => void;
  onUpdate: (id: string, patch: Partial<CharacterPart>) => void;
  onRemove: (id: string) => void;
  manifest: PartManifest;
  headVariants: HeadVariant[];
  onHeadVariantsChange: (v: HeadVariant[]) => void;
}) {
  const grouped = useMemo(() => groupParts(parts), [parts]);
  const visibleRoles: PartRole[] = ALL_ROLES.filter((r) => {
    if (r === "head") return manifest.hasHead;
    if (r === "body") return manifest.hasBody;
    if (r === "armL" || r === "armR") return manifest.hasArms;
    if (r === "legL" || r === "legR") return manifest.hasLegs;
    if (r === "eye" || r === "eyeL" || r === "eyeR") return manifest.hasEyes;
    if (r === "brow" || r === "browL" || r === "browR") return manifest.hasBrows;
    if (r === "mouth") return manifest.hasMouth;
    return true;
  });

  return (
    <div className="space-y-2">
      <div className="font-semibold uppercase tracking-wider text-muted-foreground">Parts</div>
      {visibleRoles.map((role) => (
        <RoleGroup
          key={role}
          role={role}
          variants={grouped.get(role) ?? []}
          selectedId={selectedId}
          onSelect={onSelect}
          onAdd={onAdd}
          onUpdate={onUpdate}
          onRemove={onRemove}
          headVariants={role === "head" ? headVariants : undefined}
          onHeadVariantsChange={role === "head" ? onHeadVariantsChange : undefined}
        />
      ))}
    </div>
  );
}

function RoleGroup({
  role, variants, selectedId, onSelect, onAdd, onUpdate, onRemove,
  headVariants, onHeadVariantsChange,
}: {
  role: PartRole;
  variants: CharacterPart[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (p: CharacterPart) => void;
  onUpdate: (id: string, patch: Partial<CharacterPart>) => void;
  onRemove: (id: string) => void;
  headVariants?: HeadVariant[];
  onHeadVariantsChange?: (v: HeadVariant[]) => void;
}) {
  return (
    <div className="rounded border border-border bg-panel-2">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span className="font-medium text-foreground">{roleLabel(role)}</span>
        <span className="text-[10px] text-muted-foreground">({variants.length})</span>
        <UploadVariantButton role={role} onAdd={onAdd} existing={variants} />
      </div>
      <ul>
        {variants.map((p) => (
          <li
            key={p.id}
            onClick={() => onSelect(p.id)}
            className={`flex cursor-pointer items-center gap-2 border-t border-border px-2 py-1 text-[11px] ${
              p.id === selectedId ? "bg-primary/20 text-foreground" : "text-muted-foreground hover:bg-panel"
            }`}
          >
            <span className="flex-1 truncate">
              {variantLabel(p)}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onUpdate(p.id, { visible: !p.visible }); }}
              className="rounded p-1 text-muted-foreground hover:text-foreground"
              title={p.visible ? "Hide" : "Show"}
              aria-label={p.visible ? "Hide part" : "Show part"}
            >
              {p.visible ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(p.id); }}
              className="rounded px-1 text-[10px] text-destructive"
              title="Remove"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      {role === "head" && headVariants && onHeadVariantsChange && (
        <HeadTurnVariants variants={headVariants} onChange={onHeadVariantsChange} />
      )}
    </div>
  );
}

/** Nested head-turn variants (front, ¾, side directions) shown inside the Head group. */
function HeadTurnVariants({
  variants, onChange,
}: { variants: HeadVariant[]; onChange: (v: HeadVariant[]) => void }) {
  const upload = async (dir: HeadDirection, file: File) => {
    const asset = await importMediaFile(file);
    const next = variants.filter((v) => v.direction !== dir);
    next.push({ direction: dir, mediaId: asset.id });
    onChange(next);
  };
  const remove = (dir: HeadDirection) =>
    onChange(variants.filter((v) => v.direction !== dir));

  return (
    <div className="border-t border-border p-2">
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        Variants — turn directions
      </div>
      <div className="space-y-1">
        {HEAD_DIRECTIONS.map(({ dir, label }) => {
          const v = variants.find((x) => x.direction === dir);
          return (
            <HeadVariantSlot
              key={dir}
              dir={dir}
              label={label}
              variant={v}
              onUpload={(f) => upload(dir, f)}
              onRemove={() => remove(dir)}
            />
          );
        })}
      </div>
    </div>
  );
}

function variantLabel(p: CharacterPart): string {
  if (p.viseme) return `mouth ${p.viseme}`;
  if (p.eyeState) return `eye ${p.eyeState}`;
  if (p.pose) return p.pose;
  return p.name;
}

function UploadVariantButton({
  role, onAdd, existing,
}: { role: PartRole; onAdd: (p: CharacterPart) => void; existing: CharacterPart[] }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        onClick={() => inputRef.current?.click()}
        className="ml-auto rounded bg-primary/30 px-2 py-0.5 text-[10px] hover:bg-primary/50"
        title="Upload image"
      >
        + add
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const asset = await importMediaFile(f);
          const part = makePart(role, asset.id, {
            name: asset.name,
            x: 100,
            y: 100,
            width: asset.width || 200,
            height: asset.height || 200,
            zIndex: existing.length,
          });
          // Auto-tag mouth viseme / eye state by guessing the next missing one.
          if (role === "mouth") {
            const used = new Set(existing.map((p) => p.viseme));
            part.viseme = (VISEMES.find((v) => !used.has(v)) ?? "rest");
          }
          if (role === "eye") {
            const used = new Set(existing.map((p) => p.eyeState));
            part.eyeState = (EYE_STATES.find((s) => !used.has(s)) ?? "open");
          }
          onAdd(part);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
    </>
  );
}

function PartLayer({
  part, selected, scale, onionSkin, onChange,
}: {
  part: CharacterPart;
  selected: boolean;
  scale: number;
  onionSkin: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<CharacterPart>) => void;
}) {
  const url = useMediaUrl(part.mediaId);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!selected) return; // Canvas is locked unless this part is the active one.
    e.stopPropagation();
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY;
    const ox = part.x, oy = part.y;
    const move = (ev: PointerEvent) => {
      onChange({
        x: Math.round(ox + (ev.clientX - sx) / scale),
        y: Math.round(oy + (ev.clientY - sy) / scale),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onResize = (e: React.PointerEvent) => {
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY;
    const ow = part.width, oh = part.height;
    const ratio = ow / Math.max(1, oh);
    const move = (ev: PointerEvent) => {
      const dw = (ev.clientX - sx) / scale;
      const dh = (ev.clientY - sy) / scale;
      let nw = Math.max(8, ow + dw);
      let nh = Math.max(8, oh + dh);
      if (ev.shiftKey) nh = nw / ratio;
      onChange({ width: Math.round(nw), height: Math.round(nh) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (!part.visible && !selected) return null;
  const opacity = part.visible ? 1 : 0.3;
  const skin = !selected && onionSkin && (part.pose || part.viseme || part.eyeState) ? 0.4 : opacity;

  return (
    <div
      onPointerDown={onPointerDown}
      className={`absolute select-none ${selected ? "outline-2 outline-primary" : "outline-1 outline-transparent"} outline outline-offset-0`}
      style={{
        left: part.x,
        top: part.y,
        width: part.width,
        height: part.height,
        transform: `rotate(${part.rotation}deg)`,
        transformOrigin: `${part.anchorX * 100}% ${part.anchorY * 100}%`,
        zIndex: part.zIndex,
        opacity: skin,
        // Locked unless this is the currently selected part — selection is list-only.
        pointerEvents: selected ? "auto" : "none",
        cursor: selected ? "move" : "default",
      }}
    >
      {url && <img src={url} alt={part.name} draggable={false} className="h-full w-full object-contain" />}
      {selected && (
        <>
          <div onPointerDown={onResize} className="absolute -bottom-1 -right-1 h-3 w-3 cursor-se-resize rounded-sm bg-primary" />
          <div
            className="pointer-events-none absolute -ml-1.5 -mt-1.5 h-3 w-3 rounded-full border-2 border-primary bg-background"
            style={{ left: `${part.anchorX * 100}%`, top: `${part.anchorY * 100}%` }}
            title="Anchor / pivot"
          />
        </>
      )}
    </div>
  );
}

function PartInspector({
  part, onChange, onRemove,
}: {
  part: CharacterPart;
  onChange: (patch: Partial<CharacterPart>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-3">
      <Field label="Name">
        <input
          value={part.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="w-full rounded border border-border bg-input px-2 py-1"
        />
      </Field>
      {part.role === "mouth" && (
        <Field label="Viseme">
          <select
            value={part.viseme ?? "rest"}
            onChange={(e) => onChange({ viseme: e.target.value as MouthViseme })}
            className="w-full rounded border border-border bg-input px-2 py-1"
          >
            {VISEMES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
      )}
      {(part.role === "eye" || part.role === "eyeL" || part.role === "eyeR") && (
        <Field label="Eye state">
          <select
            value={part.eyeState ?? "open"}
            onChange={(e) => onChange({ eyeState: e.target.value as EyeState })}
            className="w-full rounded border border-border bg-input px-2 py-1"
          >
            {EYE_STATES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
      )}
      <Field label="Pose / variant tag">
        <input
          value={part.pose ?? ""}
          onChange={(e) => onChange({ pose: e.target.value || undefined })}
          placeholder="e.g. idle / walk / raised"
          className="w-full rounded border border-border bg-input px-2 py-1"
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="X"><NumberInput value={part.x} onChange={(v) => onChange({ x: v })} /></Field>
        <Field label="Y"><NumberInput value={part.y} onChange={(v) => onChange({ y: v })} /></Field>
        <Field label="Width"><NumberInput value={part.width} onChange={(v) => onChange({ width: Math.max(8, v) })} /></Field>
        <Field label="Height"><NumberInput value={part.height} onChange={(v) => onChange({ height: Math.max(8, v) })} /></Field>
        <Field label="Rotation°"><NumberInput value={part.rotation} onChange={(v) => onChange({ rotation: v })} /></Field>
        <Field label="Z-Index"><NumberInput value={part.zIndex} onChange={(v) => onChange({ zIndex: v })} /></Field>
        <Field label="Anchor X (0-1)">
          <input type="range" min={0} max={1} step={0.05} value={part.anchorX} onChange={(e) => onChange({ anchorX: Number(e.target.value) })} className="w-full" />
        </Field>
        <Field label="Anchor Y (0-1)">
          <input type="range" min={0} max={1} step={0.05} value={part.anchorY} onChange={(e) => onChange({ anchorY: Number(e.target.value) })} className="w-full" />
        </Field>
        <Field label={`Depth (${part.depth.toFixed(2)})`}>
          <input type="range" min={-1} max={1} step={0.05} value={part.depth} onChange={(e) => onChange({ depth: Number(e.target.value) })} className="w-full" />
        </Field>
        <Field label="Visible">
          <input type="checkbox" checked={part.visible} onChange={(e) => onChange({ visible: e.target.checked })} />
        </Field>
      </div>
      <button
        onClick={onRemove}
        className="w-full rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:opacity-90"
      >
        Remove part
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function NumberInput({ value, onChange, step = 1 }: { value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full rounded border border-border bg-input px-2 py-1"
    />
  );
}


// ParallaxEditor — per-character parallax controls.
function ParallaxEditor({ cfg, onChange }: { cfg: ParallaxConfig; onChange: (c: ParallaxConfig) => void }) {
  return (
    <div className="mt-6 border-t border-border pt-3">
      <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">Parallax</div>
      <div className="space-y-1.5">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={cfg.onCamera} onChange={(e) => onChange({ ...cfg, onCamera: e.target.checked })} />
          On camera moves
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={cfg.onClip} onChange={(e) => onChange({ ...cfg, onClip: e.target.checked })} />
          On character movement
        </label>
        <Field label={`Intensity (${cfg.intensity.toFixed(2)})`}>
          <input
            type="range" min={0} max={1} step={0.05} value={cfg.intensity}
            onChange={(e) => onChange({ ...cfg, intensity: Number(e.target.value) })}
            className="w-full"
          />
        </Field>
      </div>
    </div>
  );
}

const HEAD_DIRECTIONS: { dir: HeadDirection; label: string }[] = [
  { dir: "front", label: "Front" },
  { dir: "3qL", label: "¾ Left" },
  { dir: "3qR", label: "¾ Right" },
  { dir: "sideL", label: "Side Left" },
  { dir: "sideR", label: "Side Right" },
];

function HeadVariantsEditor({
  doc, onChange,
}: { doc: CharacterPreset; onChange: (vars: HeadVariant[]) => void }) {
  const variants = doc.headVariants ?? [];
  const upload = async (dir: HeadDirection, file: File) => {
    const asset = await importMediaFile(file);
    const next = variants.filter((v) => v.direction !== dir);
    next.push({ direction: dir, mediaId: asset.id });
    onChange(next);
  };
  const remove = (dir: HeadDirection) => onChange(variants.filter((v) => v.direction !== dir));

  return (
    <div className="mt-6 border-t border-border pt-3">
      <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">Head Variants</div>
      <div className="mb-2 text-[10px] text-muted-foreground">
        Upload alternate head images for head-turn presets. Front falls back to the regular head part.
      </div>
      <div className="space-y-1.5">
        {HEAD_DIRECTIONS.map(({ dir, label }) => {
          const v = variants.find((x) => x.direction === dir);
          return <HeadVariantSlot key={dir} dir={dir} label={label} variant={v} onUpload={(f) => upload(dir, f)} onRemove={() => remove(dir)} />;
        })}
      </div>
    </div>
  );
}

function HeadVariantSlot({
  label, variant, onUpload, onRemove,
}: {
  dir: HeadDirection;
  label: string;
  variant?: HeadVariant;
  onUpload: (f: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const url = useMediaUrl(variant?.mediaId);
  return (
    <div className="flex items-center gap-2 rounded border border-border bg-panel-2 p-1.5">
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded bg-input">
        {url
          ? <img src={url} alt={label} className="h-full w-full object-contain" />
          : <div className="flex h-full w-full items-center justify-center text-[9px] text-muted-foreground">—</div>}
      </div>
      <span className="flex-1 text-[11px]">{label}</span>
      <button onClick={() => inputRef.current?.click()} className="rounded bg-primary/30 px-2 py-0.5 text-[10px] hover:bg-primary/50">
        {variant ? "Replace" : "Upload"}
      </button>
      {variant && (
        <button onClick={onRemove} className="rounded px-1 text-[10px] text-destructive">✕</button>
      )}
      <input
        ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); if (inputRef.current) inputRef.current.value = ""; }}
      />
    </div>
  );
}

// Re-export hook so character editor route can rely on live character list.
export function useAllCharacters() {
  return useLiveQuery(() => db.characters.orderBy("updatedAt").reverse().toArray(), []) ?? [];
}
