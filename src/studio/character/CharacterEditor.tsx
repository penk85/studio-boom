// CharacterEditor — full-screen editor for a CharacterPreset.
// Three panes: parts list (left), live canvas (center), part inspector (right).
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, RotateCw } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { db, importMediaFile } from "../db";
import { useMediaUrl } from "../hooks/useMediaUrl";
import {
  createBlankCharacter,
  defaultFallbackMouthAnchor,
  defaultSlotIdForRole,
  groupParts,
  makePart,
  normalizeCharacterSlots,
  roleLabel,
  saveCharacter,
} from "./character-utils";
import type {
  CharacterPart,
  CharacterPreset,
  EyeState,
  FallbackMouthAnchor,
  HeadDirection,
  HeadVariant,
  MouthViseme,
  ParallaxConfig,
  PartManifest,
  PartRole,
} from "../types";
import { PresetRecorder } from "../presets/PresetRecorder";

const ROLE_SECTIONS: { title: string; roles: PartRole[] }[] = [
  { title: "Head", roles: ["head"] },
  { title: "Body", roles: ["body"] },
  { title: "Face", roles: ["eye", "eyeL", "eyeR", "brow", "browL", "browR", "mouth"] },
  { title: "Limbs", roles: ["armL", "armR", "legL", "legR"] },
  { title: "Extras", roles: ["extra"] },
];

const VISEMES: MouthViseme[] = ["rest", "A", "E", "I", "O", "U", "MBP", "FV", "L"];
const EYE_STATES: EyeState[] = ["open", "half", "closed", "wink"];

const HEAD_DIRECTIONS: { dir: HeadDirection; label: string }[] = [
  { dir: "front", label: "Front" },
  { dir: "3qL", label: "¾ Left" },
  { dir: "3qR", label: "¾ Right" },
  { dir: "sideL", label: "Side Left" },
  { dir: "sideR", label: "Side Right" },
];

const BODY_DIRECTIONS = HEAD_DIRECTIONS;

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
  const [showFallbackMouth, setShowFallbackMouth] = useState(false);
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
      setDoc(normalizeCharacterSlots(row));
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
    const t = setTimeout(() => {
      void saveCharacter(doc);
    }, 400);
    return () => clearTimeout(t);
  }, [doc]);

  // Keyboard shortcuts for layer ordering
  useEffect(() => {
    if (!selectedPartId) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "]") {
        setDoc((d) => d ? { ...d, parts: d.parts.map((p) => p.id === selectedPartId ? { ...p, zIndex: p.zIndex + 1 } : p) } : d);
      } else if (e.key === "[") {
        setDoc((d) => d ? { ...d, parts: d.parts.map((p) => p.id === selectedPartId ? { ...p, zIndex: Math.max(0, p.zIndex - 1) } : p) } : d);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selectedPartId]);

  if (!doc) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        Loading character…
      </div>
    );
  }

  const update = (patch: Partial<CharacterPreset>) => setDoc((d) => (d ? { ...d, ...patch } : d));

  const updatePart = (id: string, patch: Partial<CharacterPart>) =>
    setDoc((d) =>
      d ? { ...d, parts: d.parts.map((p) => (p.id === id ? { ...p, ...patch } : p)) } : d,
    );

  const updateFallbackMouth = (patch: Partial<FallbackMouthAnchor>) =>
    setDoc((d) =>
      d
        ? {
            ...d,
            fallbackMouth: {
              ...(d.fallbackMouth ?? defaultFallbackMouthAnchor(d.canvasWidth, d.canvasHeight)),
              ...patch,
            },
          }
        : d,
    );

  const removePart = (id: string) =>
    setDoc((d) => (d ? { ...d, parts: d.parts.filter((p) => p.id !== id) } : d));

  const addPart = (part: CharacterPart) => {
    setDoc((d) => (d ? { ...d, parts: [...d.parts, part] } : d));
    setSelectedPartId(part.id);
  };

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
            <input
              type="checkbox"
              checked={onionSkin}
              onChange={(e) => setOnionSkin(e.target.checked)}
            />
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
            canvasWidth={doc.canvasWidth}
            canvasHeight={doc.canvasHeight}
          />
        </aside>

        <main
          ref={wrapRef}
          className="relative flex min-w-0 flex-1 items-center justify-center bg-stage-bg p-8"
        >
          <div
            className="relative shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)] outline outline-1 outline-border"
            style={{
              width: doc.canvasWidth * scale,
              height: doc.canvasHeight * scale,
              background: "oklch(0.12 0.015 270)",
            }}
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
              {showFallbackMouth && (
                <FallbackMouthMarker
                  anchor={
                    doc.fallbackMouth ??
                    defaultFallbackMouthAnchor(doc.canvasWidth, doc.canvasHeight)
                  }
                  scale={scale}
                  onChange={updateFallbackMouth}
                />
              )}
            </div>
          </div>
          {selectedPart && (
            <div className="pointer-events-none absolute left-3 top-3 rounded border border-border bg-panel/90 px-2.5 py-1.5 text-xs shadow-[var(--shadow-panel)]">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Active layer
              </div>
              <div className="font-medium text-foreground">
                {roleLabel(selectedPart.role)} · {variantLabel(selectedPart)}
              </div>
            </div>
          )}
          <div className="pointer-events-none absolute bottom-2 right-3 rounded bg-panel/80 px-2 py-1 text-[10px] text-muted-foreground">
            {doc.canvasWidth}×{doc.canvasHeight} · {Math.round(scale * 100)}%
          </div>
        </main>

        <aside className="w-72 shrink-0 overflow-auto border-l border-border bg-panel p-3 text-xs">
          {selectedPart ? (
            <PartInspector
              part={selectedPart}
              onChange={(patch) => updatePart(selectedPart.id, patch)}
              onRemove={() => {
                removePart(selectedPart.id);
                setSelectedPartId(null);
              }}
            />
          ) : (
            <div className="text-muted-foreground">
              Select a part to edit transform, anchor, depth, and z-index. Drag-reorder parts on the
              left to change z-index.
            </div>
          )}
          <div className="mt-6 border-t border-border pt-3">
            <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
              Canvas
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Width">
                <NumberInput
                  value={doc.canvasWidth}
                  onChange={(v) => update({ canvasWidth: Math.max(64, v) })}
                />
              </Field>
              <Field label="Height">
                <NumberInput
                  value={doc.canvasHeight}
                  onChange={(v) => update({ canvasHeight: Math.max(64, v) })}
                />
              </Field>
            </div>
          </div>

          <FallbackMouthEditor
            anchor={
              doc.fallbackMouth ?? defaultFallbackMouthAnchor(doc.canvasWidth, doc.canvasHeight)
            }
            visible={showFallbackMouth}
            onVisibleChange={setShowFallbackMouth}
            onChange={updateFallbackMouth}
          />

          <ParallaxEditor cfg={doc.parallax} onChange={(p) => update({ parallax: p })} />

          {/* Head Variants moved into the Head part group on the left. */}
        </aside>
      </div>

      {recorderOpen && <PresetRecorder character={doc} onClose={() => setRecorderOpen(false)} />}
    </div>
  );
}

function ManifestEditor({
  manifest,
  onChange,
}: {
  manifest: PartManifest;
  onChange: (m: PartManifest) => void;
}) {
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
      <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
        Has parts
      </div>
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
  parts,
  selectedId,
  onSelect,
  onAdd,
  onUpdate,
  onRemove,
  manifest,
  headVariants,
  onHeadVariantsChange,
  canvasWidth,
  canvasHeight,
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
  canvasWidth: number;
  canvasHeight: number;
}) {
  const grouped = useMemo(() => groupParts(parts), [parts]);
  const isRoleVisible = (r: PartRole) => {
    if (r === "head") return manifest.hasHead;
    if (r === "body") return manifest.hasBody;
    if (r === "armL" || r === "armR") return manifest.hasArms;
    if (r === "legL" || r === "legR") return manifest.hasLegs;
    if (r === "eye" || r === "eyeL" || r === "eyeR") return manifest.hasEyes;
    if (r === "brow" || r === "browL" || r === "browR") return manifest.hasBrows;
    if (r === "mouth") return manifest.hasMouth;
    return true;
  };

  return (
    <div className="space-y-2">
      <div className="font-semibold uppercase tracking-wider text-muted-foreground">Parts</div>
      {ROLE_SECTIONS.map((section) => {
        const roles = section.roles.filter(isRoleVisible);
        if (roles.length === 0) return null;
        return (
          <div key={section.title} className="space-y-1.5">
            <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {section.title}
            </div>
            {roles.map((role) => (
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
                canvasWidth={canvasWidth}
                canvasHeight={canvasHeight}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function RoleGroup({
  role,
  variants,
  selectedId,
  onSelect,
  onAdd,
  onUpdate,
  onRemove,
  headVariants,
  onHeadVariantsChange,
  canvasWidth,
  canvasHeight,
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
  canvasWidth: number;
  canvasHeight: number;
}) {
  const active = variants.some((p) => p.id === selectedId);
  return (
    <div
      className={`rounded border bg-panel-2 ${
        active ? "border-primary shadow-[0_0_0_1px_var(--color-primary)]" : "border-border"
      }`}
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span className="font-medium text-foreground">{roleLabel(role)}</span>
        <span className="text-[10px] text-muted-foreground">({variants.length})</span>
        {active && (
          <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-foreground">
            Active
          </span>
        )}
        <UploadVariantButton
          role={role}
          onAdd={onAdd}
          existing={variants}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
        />
      </div>
      <ul>
        {variants.map((p) => (
          <li
            key={p.id}
            onClick={() => onSelect(p.id)}
            className={`flex cursor-pointer items-center gap-2 border-t border-border px-2 py-1 text-[11px] ${
              p.id === selectedId
                ? "bg-primary/20 text-foreground"
                : "text-muted-foreground hover:bg-panel"
            }`}
          >
            <span className="flex-1 truncate">{variantLabel(p)}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUpdate(p.id, { visible: !p.visible });
              }}
              className="rounded p-1 text-muted-foreground hover:text-foreground"
              title={p.visible ? "Hide" : "Show"}
              aria-label={p.visible ? "Hide part" : "Show part"}
            >
              {p.visible ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove(p.id);
              }}
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
      {role === "body" && (
        <BodyDirectionVariants
          variants={variants}
          onAdd={onAdd}
          onUpdate={onUpdate}
          onRemove={onRemove}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
        />
      )}
    </div>
  );
}

/** Nested head-turn variants (front, ¾, side directions) shown inside the Head group. */
function HeadTurnVariants({
  variants,
  onChange,
}: {
  variants: HeadVariant[];
  onChange: (v: HeadVariant[]) => void;
}) {
  const upload = async (dir: HeadDirection, file: File) => {
    const asset = await importMediaFile(file, { scope: "character-part" });
    const next = variants.filter((v) => v.direction !== dir);
    next.push({ direction: dir, mediaId: asset.id });
    onChange(next);
  };
  const remove = (dir: HeadDirection) => onChange(variants.filter((v) => v.direction !== dir));

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

function BodyDirectionVariants({
  variants,
  onAdd,
  onUpdate,
  onRemove,
  canvasWidth,
  canvasHeight,
}: {
  variants: CharacterPart[];
  onAdd: (p: CharacterPart) => void;
  onUpdate: (id: string, patch: Partial<CharacterPart>) => void;
  onRemove: (id: string) => void;
  canvasWidth: number;
  canvasHeight: number;
}) {
  const upload = async (dir: HeadDirection, file: File) => {
    const asset = await importMediaFile(file, { scope: "character-part" });
    const fitted = fitAssetToCanvas(asset.width, asset.height, canvasWidth, canvasHeight);
    const existing = variants.find((p) => p.pose === dir);
    if (existing) {
      onUpdate(existing.id, { mediaId: asset.id, ...fitted });
      return;
    }
    const reusableSlotId = variants.find((p) => p.slotId)?.slotId ?? defaultSlotIdForRole("body");
    onAdd(
      makePart("body", asset.id, {
        name: `Body ${dir}`,
        slotId: reusableSlotId,
        slotName: variants.find((p) => p.slotName)?.slotName ?? roleLabel("body"),
        pose: dir,
        ...fitted,
        zIndex: variants[0]?.zIndex ?? defaultZIndexForRole("body"),
      }),
    );
  };

  return (
    <div className="border-t border-border p-2">
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        Variants — body directions
      </div>
      <div className="space-y-1">
        {BODY_DIRECTIONS.map(({ dir, label }) => {
          const variant = variants.find((p) => p.pose === dir);
          return (
            <BodyDirectionSlot
              key={dir}
              label={label}
              variant={variant}
              onUpload={(f) => upload(dir, f)}
              onRemove={() => variant && onRemove(variant.id)}
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

function defaultZIndexForRole(role: PartRole): number {
  switch (role) {
    case "legL":
    case "legR":
      return 5;
    case "body":
      return 10;
    case "armL":
    case "armR":
      return 20;
    case "head":
      return 30;
    case "eye":
    case "eyeL":
    case "eyeR":
    case "brow":
    case "browL":
    case "browR":
    case "mouth":
      return 40;
    case "extra":
      return 50;
  }
}

function fitAssetToCanvas(
  assetWidth: number | undefined,
  assetHeight: number | undefined,
  canvasWidth: number,
  canvasHeight: number,
) {
  const sourceWidth = assetWidth && assetWidth > 0 ? assetWidth : 200;
  const sourceHeight = assetHeight && assetHeight > 0 ? assetHeight : 200;
  const ratio = Math.min(1, canvasWidth / sourceWidth, canvasHeight / sourceHeight);
  const width = Math.max(8, Math.round(sourceWidth * ratio));
  const height = Math.max(8, Math.round(sourceHeight * ratio));
  return {
    width,
    height,
    x: Math.round((canvasWidth - width) / 2),
    y: Math.round((canvasHeight - height) / 2),
  };
}

function UploadVariantButton({
  role,
  onAdd,
  existing,
  canvasWidth,
  canvasHeight,
}: {
  role: PartRole;
  onAdd: (p: CharacterPart) => void;
  existing: CharacterPart[];
  canvasWidth: number;
  canvasHeight: number;
}) {
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
          const asset = await importMediaFile(f, { scope: "character-part" });
          const fitted = fitAssetToCanvas(asset.width, asset.height, canvasWidth, canvasHeight);
          const reusableSlotId = existing.find((p) => p.slotId)?.slotId;
          const part = makePart(role, asset.id, {
            name: asset.name,
            slotId: role === "extra" ? undefined : (reusableSlotId ?? defaultSlotIdForRole(role)),
            slotName: existing.find((p) => p.slotName)?.slotName ?? roleLabel(role),
            x: fitted.x,
            y: fitted.y,
            width: fitted.width,
            height: fitted.height,
            zIndex: existing[0]?.zIndex ?? defaultZIndexForRole(role),
          });
          // Auto-tag mouth viseme / eye state by guessing the next missing one.
          if (role === "mouth") {
            const used = new Set(existing.map((p) => p.viseme));
            part.viseme = VISEMES.find((v) => !used.has(v)) ?? "rest";
          }
          if (role === "eye") {
            const used = new Set(existing.map((p) => p.eyeState));
            part.eyeState = EYE_STATES.find((s) => !used.has(s)) ?? "open";
          }
          onAdd(part);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
    </>
  );
}

function PartLayer({
  part,
  selected,
  scale,
  onionSkin,
  onChange,
}: {
  part: CharacterPart;
  selected: boolean;
  scale: number;
  onionSkin: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<CharacterPart>) => void;
}) {
  const url = useMediaUrl(part.mediaId);
  const layerRef = useRef<HTMLDivElement>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!selected) return; // Canvas is locked unless this part is the active one.
    e.stopPropagation();
    if (e.button !== 0) return;
    const sx = e.clientX,
      sy = e.clientY;
    const ox = part.x,
      oy = part.y;
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

  const onResize = (corner: ResizeCorner) => (e: React.PointerEvent) => {
    e.stopPropagation();
    const sx = e.clientX,
      sy = e.clientY;
    const ow = part.width,
      oh = part.height;
    const ox = part.x,
      oy = part.y;
    const move = (ev: PointerEvent) => {
      const dw = (ev.clientX - sx) / scale;
      const dh = (ev.clientY - sy) / scale;
      let width = corner.includes("e") ? ow + dw : ow - dw;
      let height = corner.includes("s") ? oh + dh : oh - dh;
      width = Math.max(8, width);
      height = Math.max(8, height);
      const x = corner.includes("w") ? ox + (ow - width) : ox;
      const y = corner.includes("n") ? oy + (oh - height) : oy;
      onChange({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onRotate = (e: React.PointerEvent) => {
    e.stopPropagation();
    const el = layerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
    const startRotation = part.rotation;
    const move = (ev: PointerEvent) => {
      const angle = Math.atan2(ev.clientY - cy, ev.clientX - cx);
      const delta = ((angle - startAngle) * 180) / Math.PI;
      onChange({ rotation: Math.round(startRotation + delta) });
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
  const skin =
    !selected && onionSkin && (part.pose || part.viseme || part.eyeState) ? 0.4 : opacity;

  return (
    <div
      ref={layerRef}
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
      {url && (
        <img src={url} alt={part.name} draggable={false} className="h-full w-full object-contain" />
      )}
      {selected && (
        <>
          <ResizeHandle corner="nw" onResize={onResize} />
          <ResizeHandle corner="ne" onResize={onResize} />
          <ResizeHandle corner="sw" onResize={onResize} />
          <ResizeHandle corner="se" onResize={onResize} />
          <button
            type="button"
            onPointerDown={onRotate}
            className="absolute left-1/2 top-0 flex h-6 w-6 -translate-x-1/2 -translate-y-9 items-center justify-center rounded-full border border-primary bg-background text-primary shadow-[var(--shadow-panel)]"
            title="Rotate"
            aria-label="Rotate part"
          >
            <RotateCw size={14} />
          </button>
          <button
            type="button"
            onPointerDown={(e) => { e.stopPropagation(); onChange({ zIndex: part.zIndex + 1 }); }}
            className="absolute left-0 top-0 flex h-5 w-5 -translate-x-2 -translate-y-6 items-center justify-center rounded border border-primary bg-background text-primary shadow-[var(--shadow-panel)]"
            title="Bring forward (]"
            aria-label="Bring forward"
          >
            <ArrowUp size={12} />
          </button>
          <button
            type="button"
            onPointerDown={(e) => { e.stopPropagation(); onChange({ zIndex: part.zIndex - 1 }); }}
            className="absolute left-1/2 top-0 flex h-5 w-5 -translate-x-1/2 -translate-y-6 items-center justify-center rounded border border-primary bg-background text-primary shadow-[var(--shadow-panel)]"
            title="Send backward (["
            aria-label="Send backward"
          >
            <ArrowDown size={12} />
          </button>
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

function FallbackMouthMarker({
  anchor,
  scale,
  onChange,
}: {
  anchor: FallbackMouthAnchor;
  scale: number;
  onChange: (patch: Partial<FallbackMouthAnchor>) => void;
}) {
  const markerRef = useRef<HTMLDivElement>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = anchor.x;
    const oy = anchor.y;
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

  const onResize = (corner: ResizeCorner) => (e: React.PointerEvent) => {
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const ow = anchor.width;
    const oh = anchor.height;
    const ox = anchor.x;
    const oy = anchor.y;
    const move = (ev: PointerEvent) => {
      const dw = (ev.clientX - sx) / scale;
      const dh = (ev.clientY - sy) / scale;
      let width = corner.includes("e") ? ow + dw : ow - dw;
      let height = corner.includes("s") ? oh + dh : oh - dh;
      width = Math.max(12, width);
      height = Math.max(8, height);
      const x = corner.includes("w") ? ox + (ow - width) : ox;
      const y = corner.includes("n") ? oy + (oh - height) : oy;
      onChange({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onRotate = (e: React.PointerEvent) => {
    e.stopPropagation();
    const el = markerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
    const startRotation = anchor.rotation;
    const move = (ev: PointerEvent) => {
      const angle = Math.atan2(ev.clientY - cy, ev.clientX - cx);
      const delta = ((angle - startAngle) * 180) / Math.PI;
      onChange({ rotation: Math.round(startRotation + delta) });
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
      ref={markerRef}
      onPointerDown={onPointerDown}
      className="absolute select-none outline outline-2 outline-dashed outline-amber-300"
      style={{
        left: anchor.x,
        top: anchor.y,
        width: anchor.width,
        height: anchor.height,
        transform: `rotate(${anchor.rotation}deg)`,
        transformOrigin: `${anchor.anchorX * 100}% ${anchor.anchorY * 100}%`,
        zIndex: 10000,
        cursor: "move",
      }}
    >
      <svg viewBox="0 0 100 60" className="h-full w-full overflow-visible">
        <path
          d="M22 31c18 8 38 8 56 0"
          fill="none"
          stroke="#fbbf24"
          strokeWidth="8"
          strokeLinecap="round"
        />
      </svg>
      <div className="pointer-events-none absolute -top-7 left-0 rounded bg-amber-300 px-1.5 py-0.5 text-[10px] font-medium text-black">
        fallback mouth
      </div>
      <ResizeHandle corner="nw" onResize={onResize} />
      <ResizeHandle corner="ne" onResize={onResize} />
      <ResizeHandle corner="sw" onResize={onResize} />
      <ResizeHandle corner="se" onResize={onResize} />
      <button
        type="button"
        onPointerDown={onRotate}
        className="absolute left-1/2 top-0 flex h-6 w-6 -translate-x-1/2 -translate-y-9 items-center justify-center rounded-full border border-amber-300 bg-background text-amber-300 shadow-[var(--shadow-panel)]"
        title="Rotate fallback mouth"
        aria-label="Rotate fallback mouth"
      >
        <RotateCw size={14} />
      </button>
    </div>
  );
}

function FallbackMouthEditor({
  anchor,
  visible,
  onVisibleChange,
  onChange,
}: {
  anchor: FallbackMouthAnchor;
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
  onChange: (patch: Partial<FallbackMouthAnchor>) => void;
}) {
  return (
    <div className="mt-6 border-t border-border pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="font-semibold uppercase tracking-wider text-muted-foreground">
          Fallback mouth
        </div>
        <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <input
            type="checkbox"
            checked={visible}
            onChange={(e) => onVisibleChange(e.target.checked)}
          />
          Show marker
        </label>
      </div>
      <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
        Used by lip sync when this character has no custom mouth image for the active viseme. Turn
        on the marker, then drag it onto the character&apos;s mouth area.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="X">
          <NumberInput value={anchor.x} onChange={(v) => onChange({ x: v })} />
        </Field>
        <Field label="Y">
          <NumberInput value={anchor.y} onChange={(v) => onChange({ y: v })} />
        </Field>
        <Field label="Width">
          <NumberInput
            value={anchor.width}
            onChange={(v) => onChange({ width: Math.max(12, v) })}
          />
        </Field>
        <Field label="Height">
          <NumberInput
            value={anchor.height}
            onChange={(v) => onChange({ height: Math.max(8, v) })}
          />
        </Field>
        <Field label="Rotation°">
          <NumberInput value={anchor.rotation} onChange={(v) => onChange({ rotation: v })} />
        </Field>
        <Field label="Layer">
          <NumberInput value={anchor.zIndex} onChange={(v) => onChange({ zIndex: v })} />
        </Field>
      </div>
    </div>
  );
}

function PartInspector({
  part,
  onChange,
  onRemove,
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
      <Field label="Slot name">
        <input
          value={part.slotName ?? roleLabel(part.role)}
          onChange={(e) => onChange({ slotName: e.target.value || undefined })}
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
            {VISEMES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
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
            {EYE_STATES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
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
        <Field label="X">
          <NumberInput value={part.x} onChange={(v) => onChange({ x: v })} />
        </Field>
        <Field label="Y">
          <NumberInput value={part.y} onChange={(v) => onChange({ y: v })} />
        </Field>
        <Field label="Width">
          <NumberInput value={part.width} onChange={(v) => onChange({ width: Math.max(8, v) })} />
        </Field>
        <Field label="Height">
          <NumberInput value={part.height} onChange={(v) => onChange({ height: Math.max(8, v) })} />
        </Field>
        <Field label="Rotation°">
          <NumberInput value={part.rotation} onChange={(v) => onChange({ rotation: v })} />
        </Field>
        <Field label="Layer">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onChange({ zIndex: part.zIndex - 1 })}
              className="flex h-7 w-7 items-center justify-center rounded border border-border bg-input hover:bg-panel-2"
              title="Move behind"
              aria-label="Move layer behind"
            >
              <ArrowDown size={14} />
            </button>
            <NumberInput value={part.zIndex} onChange={(v) => onChange({ zIndex: v })} />
            <button
              type="button"
              onClick={() => onChange({ zIndex: part.zIndex + 1 })}
              className="flex h-7 w-7 items-center justify-center rounded border border-border bg-input hover:bg-panel-2"
              title="Move in front"
              aria-label="Move layer in front"
            >
              <ArrowUp size={14} />
            </button>
          </div>
        </Field>
        <Field label="Anchor X (0-1)">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={part.anchorX}
            onChange={(e) => onChange({ anchorX: Number(e.target.value) })}
            className="w-full"
          />
        </Field>
        <Field label="Anchor Y (0-1)">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={part.anchorY}
            onChange={(e) => onChange({ anchorY: Number(e.target.value) })}
            className="w-full"
          />
        </Field>
        <Field label={`Depth (${part.depth.toFixed(2)})`}>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={part.depth}
            onChange={(e) => onChange({ depth: Number(e.target.value) })}
            className="w-full"
          />
        </Field>
        <Field label="Visible">
          <input
            type="checkbox"
            checked={part.visible}
            onChange={(e) => onChange({ visible: e.target.checked })}
          />
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
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
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
function ParallaxEditor({
  cfg,
  onChange,
}: {
  cfg: ParallaxConfig;
  onChange: (c: ParallaxConfig) => void;
}) {
  return (
    <div className="mt-6 border-t border-border pt-3">
      <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
        Parallax
      </div>
      <div className="space-y-1.5">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={cfg.onCamera}
            onChange={(e) => onChange({ ...cfg, onCamera: e.target.checked })}
          />
          On camera moves
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={cfg.onClip}
            onChange={(e) => onChange({ ...cfg, onClip: e.target.checked })}
          />
          On character movement
        </label>
        <Field label={`Intensity (${cfg.intensity.toFixed(2)})`}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={cfg.intensity}
            onChange={(e) => onChange({ ...cfg, intensity: Number(e.target.value) })}
            className="w-full"
          />
        </Field>
      </div>
    </div>
  );
}

// HeadVariantsEditor removed — head-turn variants are now nested inside the
// Head part group via <HeadTurnVariants /> in PartsList.

function HeadVariantSlot({
  label,
  variant,
  onUpload,
  onRemove,
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
        {url ? (
          <img src={url} alt={label} className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[9px] text-muted-foreground">
            —
          </div>
        )}
      </div>
      <span className="flex-1 text-[11px]">{label}</span>
      <button
        onClick={() => inputRef.current?.click()}
        className="rounded bg-primary/30 px-2 py-0.5 text-[10px] hover:bg-primary/50"
      >
        {variant ? "Replace" : "Upload"}
      </button>
      {variant && (
        <button onClick={onRemove} className="rounded px-1 text-[10px] text-destructive">
          ✕
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
    </div>
  );
}

function BodyDirectionSlot({
  label,
  variant,
  onUpload,
  onRemove,
}: {
  label: string;
  variant?: CharacterPart;
  onUpload: (f: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const url = useMediaUrl(variant?.mediaId);
  return (
    <div className="flex items-center gap-2 rounded border border-border bg-panel-2 p-1.5">
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded bg-input">
        {url ? (
          <img src={url} alt={label} className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[9px] text-muted-foreground">
            —
          </div>
        )}
      </div>
      <span className="flex-1 text-[11px]">{label}</span>
      <button
        onClick={() => inputRef.current?.click()}
        className="rounded bg-primary/30 px-2 py-0.5 text-[10px] hover:bg-primary/50"
      >
        {variant ? "Replace" : "Upload"}
      </button>
      {variant && (
        <button onClick={onRemove} className="rounded px-1 text-[10px] text-destructive">
          ✕
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
    </div>
  );
}
