// PresetRecorder — visual pose-and-capture flow for building action presets.
import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Lock, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { db, uid } from "../db";
import { useMediaUrl } from "../hooks/useMediaUrl";
import {
  listCharacterSlots,
  pickActivePartForSlot,
  roleEnabledByManifest,
} from "../character/character-utils";
import { localAlphaBounds, pivotForPart } from "../character/alpha-bounds";
import { expandKeyposesWithAnticipation } from "./apply";
import type {
  ActionCategory,
  ActionPreset,
  CharacterPart,
  CharacterPreset,
  ColorTint,
  PartRole,
  RecordedKeypose,
  RecordedPartOverride,
} from "../types";

const CATEGORIES: { value: ActionCategory; label: string }[] = [
  { value: "expression", label: "Expression" },
  { value: "gesture", label: "Gesture" },
  { value: "full-body", label: "Full body" },
  { value: "camera", label: "Camera" },
  { value: "headTurn", label: "Head turn" },
  { value: "custom", label: "Custom" },
];

const EASE_OPTIONS = [
  { label: "Linear", value: "linear" },
  { label: "Smooth", value: "easeInOut" },
  { label: "Ease In", value: "easeIn" },
  { label: "Ease Out", value: "easeOut" },
  { label: "Snappy", value: "snappy" },
  { label: "Overshoot", value: "overshoot" },
  { label: "Bounce", value: "bounce" },
  { label: "Elastic", value: "elastic" },
  { label: "Hold", value: "hold" },
];

const ROLE_GROUPS: { title: string; roles: PartRole[] }[] = [
  { title: "Face", roles: ["eye", "eyebrow", "mouth"] },
  { title: "Body", roles: ["head", "body", "arm", "hand", "leg", "foot"] },
  { title: "Other", roles: ["hair", "accessory", "static", "custom"] },
];

const DEFAULT_TINT: ColorTint = { r: 255, g: 80, b: 80, a: 0.35, blendMode: "multiply" };

type CharacterSlot = ReturnType<typeof listCharacterSlots>[number];

interface RecorderPartState {
  slotId: string;
  dx: number;
  dy: number;
  scale: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  colorTint?: ColorTint;
}

interface SelectPopover {
  x: number;
  y: number;
  slots: CharacterSlot[];
}

export function PresetRecorder({
  character,
  onClose,
  initialPreset,
}: {
  character: CharacterPreset;
  onClose: () => void;
  initialPreset?: ActionPreset;
}) {
  const [name, setName] = useState(initialPreset?.name ?? "New preset");
  const [category, setCategory] = useState<ActionCategory>(initialPreset?.category ?? "expression");
  const [duration, setDuration] = useState(initialPreset?.duration ?? 1);
  const [time, setTime] = useState(0);
  const [keyposes, setKeyposes] = useState<RecordedKeypose[]>(
    initialPreset?.keyposes ? [...initialPreset.keyposes] : [],
  );
  const [overrides, setOverrides] = useState<Map<string, RecorderPartState>>(new Map());
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [fitScale, setFitScale] = useState(0.5);
  const [previewMode, setPreviewMode] = useState<"fit" | "export">("fit");
  const [selectPopover, setSelectPopover] = useState<SelectPopover | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const lastPickRef = useRef<{ x: number; y: number; key: string; index: number } | null>(null);

  const slots = useMemo(
    () =>
      listCharacterSlots(character.parts).filter((slot) =>
        roleEnabledByManifest(slot.role, character.manifest),
      ),
    [character.parts, character.manifest],
  );

  useEffect(() => {
    if (!selectedSlotId && slots.length > 0) setSelectedSlotId(slots[0].id);
  }, [selectedSlotId, slots]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth - 32;
      const h = el.clientHeight - 32;
      setFitScale(
        Math.max(0.1, Math.min(w / character.canvasWidth, h / character.canvasHeight, 1)),
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [character.canvasWidth, character.canvasHeight]);

  useEffect(() => {
    const interp = sampleKeyposesAtTime(keyposes, time);
    const next = new Map<string, RecorderPartState>();
    for (const ov of interp.values()) {
      const slot = ov.slotId
        ? slots.find((s) => s.id === ov.slotId)
        : slots.find((s) => s.role === ov.partRole);
      if (!slot) continue;
      next.set(slot.id, {
        slotId: slot.id,
        dx: ov.dx ?? 0,
        dy: ov.dy ?? 0,
        scale: ov.scale ?? 1,
        scaleX: ov.scaleX ?? 1,
        scaleY: ov.scaleY ?? 1,
        rotation: ov.rotation ?? 0,
        opacity: ov.opacity ?? 1,
        colorTint: ov.colorTint,
      });
    }
    setOverrides(next);
  }, [time, keyposes, slots]);

  const displayScale = previewMode === "export" ? 1 : fitScale;
  const selectedSlot = slots.find((slot) => slot.id === selectedSlotId) ?? null;
  const selectedPart = selectedSlot ? (activePartForSlot(selectedSlot) ?? null) : null;
  const selectedOverride = selectedSlotId
    ? (overrides.get(selectedSlotId) ?? defaultOverride(selectedSlotId))
    : null;

  const updateOverride = (slotId: string, patch: Partial<RecorderPartState>) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      const cur = next.get(slotId) ?? defaultOverride(slotId);
      next.set(slotId, { ...cur, ...patch });
      return next;
    });
  };

  const clearOverride = (slotId: string) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.delete(slotId);
      return next;
    });
  };

  const slotsAtPoint = (clientX: number, clientY: number) => {
    const rect = planeRef.current?.getBoundingClientRect();
    if (!rect) return [];
    const x = (clientX - rect.left) / displayScale;
    const y = (clientY - rect.top) / displayScale;
    return slots
      .filter((slot) => {
        const part = activePartForSlot(slot);
        if (!part?.visible) return false;
        const bounds = transformedBounds(part, overrides.get(slot.id));
        return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
      })
      .sort((a, b) => (activePartForSlot(b)?.zIndex ?? 0) - (activePartForSlot(a)?.zIndex ?? 0));
  };

  const selectAtPoint = (clientX: number, clientY: number, altKey: boolean) => {
    const candidates = slotsAtPoint(clientX, clientY);
    if (candidates.length === 0) return;
    if (altKey) {
      setSelectPopover({ x: clientX, y: clientY, slots: candidates });
      return;
    }
    const key = candidates.map((slot) => slot.id).join("|");
    const last = lastPickRef.current;
    const samePoint =
      last && last.key === key && Math.hypot(clientX - last.x, clientY - last.y) < 6;
    const index = samePoint ? (last.index + 1) % candidates.length : 0;
    lastPickRef.current = { x: clientX, y: clientY, key, index };
    setSelectedSlotId(candidates[index].id);
    setSelectPopover(null);
  };

  const captureKeypose = () => {
    const parts: RecordedPartOverride[] = [];
    for (const ov of overrides.values()) {
      const slot = slots.find((s) => s.id === ov.slotId);
      if (!slot || !isDirtyOverride(ov)) continue;
      const part: RecordedPartOverride = { partRole: slot.role, slotId: slot.id };
      if (ov.dx !== 0) part.dx = ov.dx;
      if (ov.dy !== 0) part.dy = ov.dy;
      if (ov.scale !== 1) part.scale = ov.scale;
      if (ov.scaleX !== 1) part.scaleX = ov.scaleX;
      if (ov.scaleY !== 1) part.scaleY = ov.scaleY;
      if (ov.rotation !== 0) part.rotation = ov.rotation;
      if (ov.opacity !== 1) part.opacity = ov.opacity;
      if (ov.colorTint && ov.colorTint.a > 0) part.colorTint = ov.colorTint;
      parts.push(part);
    }
    const existing = keyposes.find((k) => Math.abs(k.t - time) <= 0.001);
    const kp: RecordedKeypose = {
      t: round(time, 2),
      parts,
      ease: existing?.ease ?? "easeInOut",
      anticipation: existing?.anticipation,
    };
    setKeyposes((prev) => {
      const filtered = prev.filter((k) => Math.abs(k.t - kp.t) > 0.001);
      return [...filtered, kp].sort((a, b) => a.t - b.t);
    });
  };

  const updateKeypose = (t: number, patch: Partial<RecordedKeypose>) => {
    setKeyposes((prev) =>
      prev.map((kp) => (Math.abs(kp.t - t) <= 0.001 ? { ...kp, ...patch } : kp)),
    );
  };

  const removeKeypose = (t: number) =>
    setKeyposes((prev) => prev.filter((k) => Math.abs(k.t - t) > 0.001));

  const save = async () => {
    if (keyposes.length === 0) {
      alert("Capture at least one pose before saving.");
      return;
    }
    const preset: ActionPreset = {
      id: initialPreset?.id ?? uid(),
      name: name.trim() || "Untitled preset",
      category,
      duration: Math.max(0.1, duration),
      loop: initialPreset?.loop ?? false,
      tracks: initialPreset?.tracks ?? [],
      keyposes: keyposes.sort((a, b) => a.t - b.t),
      builtin: false,
      createdAt: initialPreset?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    await db.movements.put(preset);
    onClose();
  };

  function activePartForSlot(slot: CharacterSlot) {
    return pickActivePartForSlot(slot, {
      viseme: slot.role === "mouth" ? "rest" : undefined,
      eyeState: slot.role === "eye" ? "open" : undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-background/90 p-6">
      <div className="flex w-full max-w-7xl flex-col overflow-hidden rounded-lg border border-border bg-panel">
        <header className="flex items-center gap-3 border-b border-border bg-panel-2 px-4 py-2">
          <span className="text-sm font-semibold">
            {initialPreset ? "Edit Preset" : "Record Preset"}
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Preset name"
            className="rounded border border-border bg-input px-2 py-1 text-xs"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as ActionCategory)}
            className="rounded border border-border bg-input px-2 py-1 text-xs"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Duration
            <input
              type="number"
              step={0.1}
              min={0.1}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-16 rounded border border-border bg-input px-1 py-0.5"
            />
            s
          </label>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex overflow-hidden rounded border border-border text-[10px]">
              <button
                onClick={() => setPreviewMode("fit")}
                className={`flex items-center gap-1 px-2 py-1 ${
                  previewMode === "fit" ? "bg-primary/25 text-foreground" : "text-muted-foreground"
                }`}
              >
                <Minimize2 size={12} />
                Editor zoom
              </button>
              <button
                onClick={() => setPreviewMode("export")}
                className={`flex items-center gap-1 border-l border-border px-2 py-1 ${
                  previewMode === "export"
                    ? "bg-primary/25 text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                <Maximize2 size={12} />
                Export size
              </button>
            </div>
            <button
              onClick={onClose}
              className="rounded border border-border px-2 py-1 text-xs hover:bg-panel"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              {initialPreset ? "Update preset" : "Save preset"}
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className="w-44 shrink-0 overflow-auto border-r border-border bg-panel p-2 text-xs">
            <PartList
              slots={slots}
              selectedSlotId={selectedSlotId}
              overrides={overrides}
              activePartForSlot={activePartForSlot}
              onSelect={setSelectedSlotId}
            />
          </aside>

          <main
            ref={wrapRef}
            className="relative flex min-w-0 flex-1 items-center justify-center overflow-auto bg-stage-bg p-4"
            onPointerDown={() => setSelectPopover(null)}
          >
            <div
              className="relative shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)] outline outline-1 outline-border"
              style={{
                width: character.canvasWidth * displayScale,
                height: character.canvasHeight * displayScale,
                background: "oklch(0.12 0.015 270)",
              }}
            >
              <div
                ref={planeRef}
                className="absolute left-0 top-0 origin-top-left"
                style={{
                  width: character.canvasWidth,
                  height: character.canvasHeight,
                  transform: `scale(${displayScale})`,
                }}
              >
                {slots.map((slot) => {
                  const part = activePartForSlot(slot);
                  if (!part) return null;
                  return (
                    <PoseLayer
                      key={slot.id}
                      part={part}
                      override={overrides.get(slot.id)}
                      selected={slot.id === selectedSlotId}
                      stageScale={displayScale}
                      onSelectAtPoint={selectAtPoint}
                      onSelect={() => {
                        setSelectedSlotId(slot.id);
                        setSelectPopover(null);
                      }}
                      onChange={(patch) => updateOverride(slot.id, patch)}
                    />
                  );
                })}
                {selectedPart && selectedOverride && (
                  <SelectionHandles
                    part={selectedPart}
                    override={selectedOverride}
                    scale={displayScale}
                    planeRef={planeRef}
                    onChange={(patch) => updateOverride(selectedOverride.slotId, patch)}
                  />
                )}
              </div>
            </div>
            {selectPopover && (
              <div
                className="fixed z-[60] min-w-36 rounded border border-border bg-panel p-1 text-xs shadow-xl"
                style={{ left: selectPopover.x + 8, top: selectPopover.y + 8 }}
              >
                {selectPopover.slots.map((slot) => (
                  <button
                    key={slot.id}
                    onClick={() => {
                      setSelectedSlotId(slot.id);
                      setSelectPopover(null);
                    }}
                    className="block w-full rounded px-2 py-1 text-left hover:bg-primary/20"
                  >
                    {slot.name ?? activePartForSlot(slot)?.name ?? slot.role}
                  </button>
                ))}
              </div>
            )}
          </main>

          <aside className="w-72 shrink-0 overflow-auto border-l border-border bg-panel p-3 text-xs">
            <PropertiesPanel
              slot={selectedSlot}
              part={selectedPart}
              override={selectedOverride}
              onChange={(patch) => selectedSlotId && updateOverride(selectedSlotId, patch)}
              onResetAll={() => selectedSlotId && clearOverride(selectedSlotId)}
            />

            <div className="mt-4 border-t border-border pt-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold uppercase tracking-wider text-muted-foreground">
                  Time
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {time.toFixed(2)}s / {duration.toFixed(2)}s
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={duration}
                step={0.05}
                value={time}
                onChange={(e) => setTime(Number(e.target.value))}
                className="w-full"
              />
              <button
                onClick={captureKeypose}
                className="mt-2 w-full rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
              >
                Capture pose at {time.toFixed(2)}s
              </button>
            </div>

            <div className="mt-4">
              <div className="mb-1 font-semibold uppercase tracking-wider text-muted-foreground">
                Captured poses
              </div>
              {keyposes.length === 0 && (
                <div className="rounded border border-dashed border-border p-2 text-center text-[10px] text-muted-foreground">
                  No poses yet.
                </div>
              )}
              <ul className="space-y-1">
                {keyposes.map((k) => (
                  <li
                    key={k.t}
                    className={`rounded border border-border p-2 ${
                      Math.abs(k.t - time) < 0.05 ? "bg-primary/20" : "bg-panel-2"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <button onClick={() => setTime(k.t)} className="flex-1 text-left">
                        {k.t.toFixed(2)}s · {k.parts.length} parts
                      </button>
                      <button
                        onClick={() => removeKeypose(k.t)}
                        className="text-[10px] text-destructive"
                      >
                        Remove
                      </button>
                    </div>
                    <select
                      value={k.ease ?? "easeInOut"}
                      onChange={(e) => updateKeypose(k.t, { ease: e.target.value })}
                      className="mt-2 w-full rounded border border-border bg-input px-1 py-0.5 text-[10px]"
                    >
                      {EASE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[10px] text-muted-foreground">
                        Anticipation
                      </summary>
                      <label className="mt-2 flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!!k.anticipation}
                          onChange={(e) =>
                            updateKeypose(k.t, {
                              anticipation: e.target.checked
                                ? { amount: 0.25, duration: 0.12 }
                                : undefined,
                            })
                          }
                        />
                        Enabled
                      </label>
                      {k.anticipation && (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <NumberInput
                            label="Amount"
                            value={k.anticipation.amount}
                            min={0}
                            max={1}
                            step={0.05}
                            onChange={(value) =>
                              updateKeypose(k.t, {
                                anticipation: { ...k.anticipation!, amount: value },
                              })
                            }
                          />
                          <NumberInput
                            label="Duration"
                            value={k.anticipation.duration}
                            min={0}
                            max={duration}
                            step={0.01}
                            onChange={(value) =>
                              updateKeypose(k.t, {
                                anticipation: { ...k.anticipation!, duration: value },
                              })
                            }
                          />
                        </div>
                      )}
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function PartList({
  slots,
  selectedSlotId,
  overrides,
  activePartForSlot,
  onSelect,
}: {
  slots: CharacterSlot[];
  selectedSlotId: string | null;
  overrides: Map<string, RecorderPartState>;
  activePartForSlot: (slot: CharacterSlot) => CharacterPart | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      {ROLE_GROUPS.map((group) => {
        const groupSlots = slots.filter((slot) => group.roles.includes(slot.role));
        if (groupSlots.length === 0) return null;
        return (
          <section key={group.title}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.title}
            </div>
            <div className="space-y-1">
              {groupSlots.map((slot) => {
                const part = activePartForSlot(slot);
                const dirty = isDirtyOverride(overrides.get(slot.id));
                return (
                  <button
                    key={slot.id}
                    onClick={() => onSelect(slot.id)}
                    className={`flex w-full items-center gap-1 rounded px-1.5 py-1 text-left ${
                      selectedSlotId === slot.id
                        ? "bg-primary/20 text-foreground"
                        : "text-muted-foreground hover:bg-panel-2 hover:text-foreground"
                    }`}
                  >
                    <span className="w-2">{dirty ? "•" : ""}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {slot.name ?? part?.name ?? roleLabel(slot.role)}
                    </span>
                    <span className="rounded bg-background/60 px-1 text-[9px]">{slot.role}</span>
                    <Lock size={10} className="opacity-45" />
                    {part?.visible === false ? (
                      <EyeOff size={10} className="opacity-45" />
                    ) : (
                      <Eye size={10} className="opacity-45" />
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function PropertiesPanel({
  slot,
  part,
  override,
  onChange,
  onResetAll,
}: {
  slot: CharacterSlot | null;
  part: CharacterPart | null;
  override: RecorderPartState | null;
  onChange: (patch: Partial<RecorderPartState>) => void;
  onResetAll: () => void;
}) {
  if (!slot || !part || !override) {
    return (
      <div className="rounded border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">
        Select a part.
      </div>
    );
  }
  const tint = override.colorTint;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground">{slot.name ?? part.name}</div>
          <div className="text-[10px] text-muted-foreground">{slot.role}</div>
        </div>
        <button
          onClick={onResetAll}
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] hover:bg-panel-2"
        >
          <RotateCcw size={11} />
          Reset all
        </button>
      </div>

      <div className="space-y-2">
        <PropertyRow
          label="X"
          value={override.dx}
          min={-300}
          max={300}
          step={1}
          rest={0}
          onChange={(value) => onChange({ dx: value })}
        />
        <PropertyRow
          label="Y"
          value={override.dy}
          min={-300}
          max={300}
          step={1}
          rest={0}
          onChange={(value) => onChange({ dy: value })}
        />
        <PropertyRow
          label="Scale"
          value={override.scale}
          min={0.1}
          max={3}
          step={0.01}
          rest={1}
          onChange={(value) => onChange({ scale: value })}
        />
        <PropertyRow
          label="Squash X"
          value={override.scaleX}
          min={0.1}
          max={3}
          step={0.01}
          rest={1}
          onChange={(value) => onChange({ scaleX: value })}
        />
        <PropertyRow
          label="Stretch Y"
          value={override.scaleY}
          min={0.1}
          max={3}
          step={0.01}
          rest={1}
          onChange={(value) => onChange({ scaleY: value })}
        />
        <PropertyRow
          label="Rotation"
          value={override.rotation}
          min={-180}
          max={180}
          step={1}
          rest={0}
          onChange={(value) => onChange({ rotation: value })}
        />
        <PropertyRow
          label="Opacity"
          value={override.opacity}
          min={0}
          max={1}
          step={0.01}
          rest={1}
          onChange={(value) => onChange({ opacity: value })}
        />
      </div>

      <div className="mt-3 rounded border border-border bg-panel-2 p-2">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-medium text-muted-foreground">Tint</span>
          <button
            onClick={() => onChange({ colorTint: undefined })}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            Reset
          </button>
        </div>
        <div className="grid grid-cols-[48px_1fr] items-center gap-2">
          <input
            type="color"
            value={rgbToHex(tint ?? DEFAULT_TINT)}
            onChange={(e) =>
              onChange({
                colorTint: {
                  ...hexToRgb(e.target.value),
                  a: tint?.a ?? DEFAULT_TINT.a,
                  blendMode: tint?.blendMode ?? DEFAULT_TINT.blendMode,
                },
              })
            }
            className="h-8 w-12 rounded border border-border bg-input"
          />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={tint?.a ?? 0}
            onChange={(e) =>
              onChange({
                colorTint: {
                  ...(tint ?? DEFAULT_TINT),
                  a: Number(e.target.value),
                },
              })
            }
            className="w-full"
          />
        </div>
        <label className="mt-2 block">
          <span className="mb-1 block text-[10px] text-muted-foreground">Blend</span>
          <select
            value={tint?.blendMode ?? "multiply"}
            onChange={(e) =>
              onChange({
                colorTint: {
                  ...(tint ?? DEFAULT_TINT),
                  blendMode: e.target.value as ColorTint["blendMode"],
                },
              })
            }
            className="w-full rounded border border-border bg-input px-1 py-0.5"
          >
            <option value="normal">Normal</option>
            <option value="multiply">Multiply</option>
            <option value="screen">Screen</option>
          </select>
        </label>
      </div>
    </div>
  );
}

function PropertyRow({
  label,
  value,
  min,
  max,
  step,
  rest,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  rest: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid grid-cols-[64px_1fr_56px_22px] items-center gap-2 text-[10px]">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded border border-border bg-input px-1 py-0.5"
      />
      <button
        type="button"
        onClick={() => onChange(rest)}
        className="rounded border border-border px-1 py-0.5 hover:bg-panel-2"
      >
        <RotateCcw size={10} />
      </button>
    </label>
  );
}

function PoseLayer({
  part,
  override,
  selected,
  stageScale,
  onSelect,
  onSelectAtPoint,
  onChange,
}: {
  part: CharacterPart;
  override?: RecorderPartState;
  selected: boolean;
  stageScale: number;
  onSelect: () => void;
  onSelectAtPoint: (clientX: number, clientY: number, altKey: boolean) => void;
  onChange: (patch: Partial<RecorderPartState>) => void;
}) {
  const url = useMediaUrl(part.mediaId);
  const ov = override ?? defaultOverride(part.slotId);
  const dirty = isDirtyOverride(override);
  const alphaRect = localAlphaBounds(part);
  const pivot = pivotForPart(part);

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    if (e.altKey) {
      onSelectAtPoint(e.clientX, e.clientY, true);
      return;
    }
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = ov.dx;
    const oy = ov.dy;
    let dragging = selected;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dist = Math.hypot(ev.clientX - sx, ev.clientY - sy);
      if (!dragging && dist > 4) {
        dragging = true;
        onSelect();
      }
      if (!dragging) return;
      moved = true;
      onChange({
        dx: Math.round(ox + (ev.clientX - sx) / stageScale),
        dy: Math.round(oy + (ev.clientY - sy) / stageScale),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) onSelectAtPoint(sx, sy, false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (!part.visible) return null;
  return (
    <div
      className="absolute select-none"
      style={{
        left: part.x + ov.dx,
        top: part.y + ov.dy,
        width: part.width,
        height: part.height,
        opacity: ov.opacity,
        transform: `rotate(${part.rotation + ov.rotation}deg) scale(${ov.scale * ov.scaleX}, ${
          ov.scale * ov.scaleY
        })`,
        transformOrigin: `${((pivot.x - part.x) / part.width) * 100}% ${
          ((pivot.y - part.y) / part.height) * 100
        }%`,
        zIndex: part.zIndex,
        pointerEvents: "none",
      }}
      title={part.name}
    >
      {url && (
        <img
          src={url}
          alt={part.name}
          draggable={false}
          className="pointer-events-none h-full w-full object-contain"
        />
      )}
      {ov.colorTint && ov.colorTint.a > 0 && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundColor: `rgba(${ov.colorTint.r}, ${ov.colorTint.g}, ${ov.colorTint.b}, ${ov.colorTint.a})`,
            mixBlendMode: ov.colorTint.blendMode ?? "multiply",
          }}
        />
      )}
      <div
        onPointerDown={onPointerDown}
        className={`absolute outline outline-offset-0 ${
          selected
            ? "outline-2 outline-primary"
            : dirty
              ? "outline-1 outline-primary/70"
              : "outline-1 outline-transparent hover:outline-accent/60"
        }`}
        style={{
          left: alphaRect.x,
          top: alphaRect.y,
          width: alphaRect.width,
          height: alphaRect.height,
          cursor: selected ? "move" : "pointer",
          pointerEvents: "auto",
        }}
      />
    </div>
  );
}

function SelectionHandles({
  part,
  override,
  scale,
  planeRef,
  onChange,
}: {
  part: CharacterPart;
  override: RecorderPartState;
  scale: number;
  planeRef: React.RefObject<HTMLDivElement | null>;
  onChange: (patch: Partial<RecorderPartState>) => void;
}) {
  const startRotate = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const rect = planeRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pivot = pivotForPart(part);
    const pivotX = rect.left + (pivot.x + override.dx) * scale;
    const pivotY = rect.top + (pivot.y + override.dy) * scale;
    const startAngle = Math.atan2(e.clientY - pivotY, e.clientX - pivotX) * (180 / Math.PI);
    const startRot = override.rotation;
    const move = (ev: PointerEvent) => {
      const angle = Math.atan2(ev.clientY - pivotY, ev.clientX - pivotX) * (180 / Math.PI);
      onChange({ rotation: round(startRot + angle - startAngle, 1) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startScale = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const rect = planeRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pivot = pivotForPart(part);
    const pivotX = rect.left + (pivot.x + override.dx) * scale;
    const pivotY = rect.top + (pivot.y + override.dy) * scale;
    const startDist = Math.hypot(e.clientX - pivotX, e.clientY - pivotY);
    const startScaleValue = override.scale;
    const move = (ev: PointerEvent) => {
      const dist = Math.hypot(ev.clientX - pivotX, ev.clientY - pivotY);
      if (startDist < 1) return;
      onChange({ scale: round(Math.max(0.1, startScaleValue * (dist / startDist)), 2) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const alphaRect = localAlphaBounds(part);
  const pivot = pivotForPart(part);
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: part.x + override.dx,
        top: part.y + override.dy,
        width: part.width,
        height: part.height,
        transform: `rotate(${part.rotation + override.rotation}deg) scale(${
          override.scale * override.scaleX
        }, ${override.scale * override.scaleY})`,
        transformOrigin: `${((pivot.x - part.x) / part.width) * 100}% ${
          ((pivot.y - part.y) / part.height) * 100
        }%`,
        zIndex: 9999,
      }}
    >
      <div
        className="absolute border border-primary"
        style={{
          left: alphaRect.x,
          top: alphaRect.y,
          width: alphaRect.width,
          height: alphaRect.height,
        }}
      >
        <button
          onPointerDown={startRotate}
          className="pointer-events-auto absolute left-1/2 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full border border-white bg-primary"
          style={{ top: -20 }}
          title="Rotate"
        />
        <button
          onPointerDown={startScale}
          className="pointer-events-auto absolute -bottom-2 -right-2 h-4 w-4 rounded-sm border border-white bg-accent"
          title="Scale"
        />
      </div>
    </div>
  );
}

function NumberInput({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      <span className="block text-[10px] text-muted-foreground">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded border border-border bg-input px-1 py-0.5"
      />
    </label>
  );
}

function sampleKeyposesAtTime(
  keyposes: RecordedKeypose[],
  t: number,
): Map<string, RecordedPartOverride> {
  const out = new Map<string, RecordedPartOverride>();
  if (keyposes.length === 0) return out;
  const sorted = expandKeyposesWithAnticipation(keyposes);
  let a = sorted[0];
  let b = sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1].t >= t) {
      a = sorted[i];
      b = sorted[i + 1];
      break;
    }
  }
  const span = Math.max(0.0001, b.t - a.t);
  const raw = Math.max(0, Math.min(1, (t - a.t) / span));
  const u = easeValue(b.ease ?? a.ease, raw);
  const targets = new Set<string>();
  for (const p of a.parts) targets.add(recordedTargetKey(p));
  for (const p of b.parts) targets.add(recordedTargetKey(p));
  for (const target of targets) {
    const pa = a.parts.find((p) => recordedTargetKey(p) === target);
    const pb = b.parts.find((p) => recordedTargetKey(p) === target);
    const src = pa ?? pb;
    if (!src) continue;
    const lerp = (av?: number, bv?: number, def = 0) => {
      if (av === undefined && bv === undefined) return def;
      if (av === undefined) return (bv as number) * u + def * (1 - u);
      if (bv === undefined) return av * (1 - u) + def * u;
      return av + (bv - av) * u;
    };
    out.set(target, {
      partRole: src.partRole,
      slotId: src.slotId,
      dx: lerp(pa?.dx, pb?.dx, 0),
      dy: lerp(pa?.dy, pb?.dy, 0),
      scale: lerp(pa?.scale, pb?.scale, 1),
      scaleX: lerp(pa?.scaleX, pb?.scaleX, 1),
      scaleY: lerp(pa?.scaleY, pb?.scaleY, 1),
      rotation: lerp(pa?.rotation, pb?.rotation, 0),
      opacity:
        pa?.opacity === undefined && pb?.opacity === undefined
          ? undefined
          : lerp(pa?.opacity, pb?.opacity, 1),
      colorTint: lerpTint(pa?.colorTint, pb?.colorTint, u),
    });
  }
  return out;
}

function defaultOverride(slotId: string): RecorderPartState {
  return { slotId, dx: 0, dy: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
}

function isDirtyOverride(override: RecorderPartState | undefined) {
  if (!override) return false;
  return (
    override.dx !== 0 ||
    override.dy !== 0 ||
    override.scale !== 1 ||
    override.scaleX !== 1 ||
    override.scaleY !== 1 ||
    override.rotation !== 0 ||
    override.opacity !== 1 ||
    !!(override.colorTint && override.colorTint.a > 0)
  );
}

function transformedBounds(part: CharacterPart, override: RecorderPartState | undefined) {
  const ov = override ?? defaultOverride(part.slotId);
  const alphaRect = localAlphaBounds(part);
  const pivot = pivotForPart(part);
  const pivotLocalX = pivot.x - part.x;
  const pivotLocalY = pivot.y - part.y;
  const scaleX = ov.scale * ov.scaleX;
  const scaleY = ov.scale * ov.scaleY;
  const left = part.x + ov.dx + pivotLocalX + (alphaRect.x - pivotLocalX) * scaleX;
  const top = part.y + ov.dy + pivotLocalY + (alphaRect.y - pivotLocalY) * scaleY;
  const width = alphaRect.width * scaleX;
  const height = alphaRect.height * scaleY;
  return { left, top, right: left + width, bottom: top + height };
}

function lerpTint(
  a: ColorTint | undefined,
  b: ColorTint | undefined,
  u: number,
): ColorTint | undefined {
  if (!a && !b) return undefined;
  const left = a ?? { ...(b as ColorTint), a: 0 };
  const right = b ?? { ...(a as ColorTint), a: 0 };
  return {
    r: left.r + (right.r - left.r) * u,
    g: left.g + (right.g - left.g) * u,
    b: left.b + (right.b - left.b) * u,
    a: left.a + (right.a - left.a) * u,
    blendMode: (u >= 0.5 ? right.blendMode : left.blendMode) ?? right.blendMode ?? left.blendMode,
  };
}

function recordedTargetKey(part: RecordedPartOverride) {
  return part.slotId ?? part.partRole;
}

function roleLabel(role: PartRole) {
  return role
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function rgbToHex(tint: ColorTint) {
  const toHex = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(tint.r)}${toHex(tint.g)}${toHex(tint.b)}`;
}

function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function easeValue(name: string | undefined, x: number) {
  switch (name) {
    case "linear":
      return x;
    case "easeIn":
      return x * x;
    case "easeOut":
      return 1 - Math.pow(1 - x, 2);
    case "snappy":
      return 1 - Math.pow(1 - x, 4);
    case "overshoot": {
      const c = 1.70158;
      return (c + 1) * x * x * x - c * x * x;
    }
    case "bounce": {
      const n1 = 7.5625;
      const d1 = 2.75;
      if (x < 1 / d1) return n1 * x * x;
      if (x < 2 / d1) return n1 * Math.pow(x - 1.5 / d1, 2) + 0.75;
      if (x < 2.5 / d1) return n1 * Math.pow(x - 2.25 / d1, 2) + 0.9375;
      return n1 * Math.pow(x - 2.625 / d1, 2) + 0.984375;
    }
    case "elastic":
      return x === 0
        ? 0
        : x === 1
          ? 1
          : -Math.pow(2, 10 * x - 10) * Math.sin((x * 10 - 10.75) * ((2 * Math.PI) / 3));
    case "hold":
      return x < 1 ? 0 : 1;
    case "easeInOut":
    default:
      return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  }
}

function round(n: number, digits: number) {
  const k = Math.pow(10, digits);
  return Math.round(n * k) / k;
}
