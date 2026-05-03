// MotionPresetRecorder — visual pose-and-capture flow for reusable motion presets.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Crosshair,
  Eye,
  EyeOff,
  Lock,
  Maximize2,
  Minimize2,
  Move,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Scaling,
  SkipBack,
} from "lucide-react";
import { db, uid } from "../db";
import { useMediaUrl } from "../hooks/useMediaUrl";
import {
  listCharacterSlots,
  pickActivePartForSlot,
  roleEnabledByManifest,
} from "../character/character-utils";
import { localAlphaBounds, pivotForPart } from "../character/alpha-bounds";
import { faceTurnMotionForPart } from "../character/face-turn";
import { expandKeyposesWithAnticipation } from "./apply";
import type {
  CharacterPart,
  CharacterPreset,
  MotionCategory,
  MotionKeyframe,
  MotionPreset,
  MotionTrack,
  PartRole,
  RecordedKeypose,
  RecordedPartOverride,
} from "../types";

const CATEGORIES: { value: MotionCategory; label: string }[] = [
  { value: "expression", label: "Expression" },
  { value: "gesture", label: "Body gesture" },
  { value: "full-body", label: "Full body" },
  { value: "camera", label: "Camera move" },
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

type CharacterSlot = ReturnType<typeof listCharacterSlots>[number];

interface RecorderPartState {
  slotId: string;
  poseSwap?: string;
  dx: number;
  dy: number;
  scale: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
  skewY: number;
  rotation: number;
  originX: number;
  originY: number;
  opacity: number;
}

interface SelectPopover {
  x: number;
  y: number;
  slots: CharacterSlot[];
}

export function MotionPresetRecorder({
  character,
  onClose,
  initialPreset,
  onSaved,
  copyOnSave,
}: {
  character: CharacterPreset;
  onClose: () => void;
  initialPreset?: MotionPreset;
  onSaved?: (preset: MotionPreset) => void;
  copyOnSave?: boolean;
}) {
  const slots = useMemo(
    () =>
      listCharacterSlots(character.parts).filter((slot) =>
        roleEnabledByManifest(slot.role, character.manifest),
      ),
    [character.parts, character.manifest],
  );
  const [name, setName] = useState(
    initialPreset && (initialPreset.builtin || copyOnSave)
      ? customPresetName(initialPreset.name)
      : (initialPreset?.name ?? "New motion preset"),
  );
  const [category, setCategory] = useState<MotionCategory>(initialPreset?.category ?? "expression");
  const [duration, setDuration] = useState(initialPreset?.duration ?? 1);
  const [time, setTime] = useState(0);
  const [keyposes, setKeyposes] = useState<RecordedKeypose[]>(() =>
    initialKeyposesForPreset(initialPreset, slots),
  );
  const [overrides, setOverrides] = useState<Map<string, RecorderPartState>>(new Map());
  const [faceTurnX, setFaceTurnX] = useState(initialPreset?.keyposes?.[0]?.faceTurnX ?? 0);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [fitScale, setFitScale] = useState(0.5);
  const [previewMode, setPreviewMode] = useState<"fit" | "export">("fit");
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [selectPopover, setSelectPopover] = useState<SelectPopover | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const lastPickRef = useRef<{ x: number; y: number; key: string; index: number } | null>(null);

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
    if (!previewPlaying) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const maxTime = Math.max(0.1, duration);
      const dt = Math.max(0, (now - last) / 1000);
      last = now;
      setTime((current) => {
        const next = current + dt;
        return next >= maxTime ? next % maxTime : next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, previewPlaying]);

  useEffect(() => {
    setTime((current) => Math.min(current, Math.max(0.1, duration)));
  }, [duration]);

  useEffect(() => {
    const interp = sampleKeyposesAtTime(keyposes, time);
    const next = new Map<string, RecorderPartState>();
    for (const ov of interp.parts.values()) {
      const slot = ov.slotId
        ? slots.find((s) => s.id === ov.slotId)
        : slots.find((s) => s.role === ov.partRole);
      if (!slot) continue;
      const part = activePartForSlot(slot, ov.poseSwap);
      next.set(slot.id, {
        ...defaultOverride(slot.id, part),
        poseSwap: ov.poseSwap,
        dx: ov.dx ?? 0,
        dy: ov.dy ?? 0,
        scale: ov.scale ?? 1,
        scaleX: ov.scaleX ?? 1,
        scaleY: ov.scaleY ?? 1,
        skewX: ov.skewX ?? 0,
        skewY: ov.skewY ?? 0,
        rotation: ov.rotation ?? 0,
        originX: ov.originX ?? part?.anchorX ?? 0.5,
        originY: ov.originY ?? part?.anchorY ?? 0.5,
        opacity: ov.opacity ?? 1,
      });
    }
    setOverrides(next);
    setFaceTurnX(interp.faceTurnX);
  }, [time, keyposes, slots]);

  const displayScale = previewMode === "export" ? 1 : fitScale;
  const selectedSlot = slots.find((slot) => slot.id === selectedSlotId) ?? null;
  const selectedOverrideFromMap = selectedSlotId ? overrides.get(selectedSlotId) : undefined;
  const selectedPart = selectedSlot
    ? (activePartForSlot(selectedSlot, selectedOverrideFromMap?.poseSwap) ?? null)
    : null;
  const selectedOverride = selectedSlotId
    ? (selectedOverrideFromMap ?? defaultOverride(selectedSlotId, selectedPart ?? undefined))
    : null;

  const updateOverride = (slotId: string, patch: Partial<RecorderPartState>) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      const slot = slots.find((item) => item.id === slotId);
      const cur = next.get(slotId);
      const curPart = slot ? activePartForSlot(slot, cur?.poseSwap) : undefined;
      const base = cur ?? defaultOverride(slotId, curPart);
      next.set(slotId, { ...base, ...patch });
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
        const part = activePartForSlot(slot, overrides.get(slot.id)?.poseSwap);
        if (!part?.visible) return false;
        const bounds = transformedBounds(
          part,
          overrides.get(slot.id),
          faceTurnX,
          character.canvasWidth,
        );
        return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
      })
      .sort(
        (a, b) =>
          (activePartForSlot(b, overrides.get(b.id)?.poseSwap)?.zIndex ?? 0) -
          (activePartForSlot(a, overrides.get(a.id)?.poseSwap)?.zIndex ?? 0),
      );
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
      const activePart = slot ? activePartForSlot(slot, ov.poseSwap) : undefined;
      if (!slot || !isDirtyOverride(ov, activePart)) continue;
      const part: RecordedPartOverride = { partRole: slot.role, slotId: slot.id };
      if (ov.poseSwap) part.poseSwap = ov.poseSwap;
      if (ov.dx !== 0) part.dx = ov.dx;
      if (ov.dy !== 0) part.dy = ov.dy;
      if (ov.scale !== 1) part.scale = ov.scale;
      if (ov.scaleX !== 1) part.scaleX = ov.scaleX;
      if (ov.scaleY !== 1) part.scaleY = ov.scaleY;
      if (ov.skewX !== 0) part.skewX = ov.skewX;
      if (ov.skewY !== 0) part.skewY = ov.skewY;
      if (ov.rotation !== 0) part.rotation = ov.rotation;
      if (ov.originX !== (activePart?.anchorX ?? 0.5)) part.originX = ov.originX;
      if (ov.originY !== (activePart?.anchorY ?? 0.5)) part.originY = ov.originY;
      if (ov.opacity !== 1) part.opacity = ov.opacity;
      parts.push(part);
    }
    const existing = keyposes.find((k) => Math.abs(k.t - time) <= 0.001);
    const kp: RecordedKeypose = {
      t: round(time, 2),
      parts,
      faceTurnX: faceTurnX === 0 ? undefined : faceTurnX,
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
    const now = Date.now();
    const savingCopy = !!initialPreset && (!!initialPreset.builtin || !!copyOnSave);
    const preset: MotionPreset = {
      id: savingCopy ? uid() : (initialPreset?.id ?? uid()),
      name: name.trim() || "Untitled motion preset",
      category,
      duration: Math.max(0.1, duration),
      loop: initialPreset?.loop ?? false,
      tracks: [],
      keyposes: cloneKeyposes(keyposes).sort((a, b) => a.t - b.t),
      builtin: false,
      createdAt: savingCopy ? now : (initialPreset?.createdAt ?? now),
      updatedAt: now,
    };
    await db.motionPresets.put(preset);
    onSaved?.(preset);
    onClose();
  };

  function activePartForSlot(slot: CharacterSlot, poseSwap?: string) {
    return pickActivePartForSlot(slot, {
      pose: poseSwap,
      viseme: slot.role === "mouth" ? (poseSwap ?? "rest") : undefined,
      eyeState: slot.role === "eye" ? (poseSwap ?? "open") : undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-background/90 p-6">
      <div className="flex w-full max-w-7xl flex-col overflow-hidden rounded-lg border border-border bg-panel">
        <header className="flex items-center gap-3 border-b border-border bg-panel-2 px-4 py-2">
          <span className="text-sm font-semibold">
            {initialPreset ? `Edit ${editorTitle(category)}` : `Create ${editorTitle(category)}`}
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Motion preset name"
            className="rounded border border-border bg-input px-2 py-1 text-xs"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as MotionCategory)}
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
              onChange={(e) => setDuration(Math.max(0.1, Number(e.target.value) || 0.1))}
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
              {initialPreset?.builtin || copyOnSave
                ? "Save custom preset"
                : initialPreset
                  ? "Update motion preset"
                  : "Save motion preset"}
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
              onToggleHidden={(slotId) => {
                const slot = slots.find((item) => item.id === slotId);
                const part = slot
                  ? activePartForSlot(slot, overrides.get(slotId)?.poseSwap)
                  : undefined;
                const current = overrides.get(slotId) ?? defaultOverride(slotId, part);
                updateOverride(slotId, { opacity: current.opacity <= 0.01 ? 1 : 0 });
              }}
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
                  const part = activePartForSlot(slot, overrides.get(slot.id)?.poseSwap);
                  if (!part) return null;
                  return (
                    <PoseLayer
                      key={slot.id}
                      part={part}
                      override={overrides.get(slot.id)}
                      selected={slot.id === selectedSlotId}
                      stageScale={displayScale}
                      faceTurnX={faceTurnX}
                      canvasWidth={character.canvasWidth}
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
                    faceTurnX={faceTurnX}
                    canvasWidth={character.canvasWidth}
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
              advancedOpen={advancedOpen}
              onAdvancedOpenChange={setAdvancedOpen}
              onChange={(patch) => selectedSlotId && updateOverride(selectedSlotId, patch)}
              onResetAll={() => selectedSlotId && clearOverride(selectedSlotId)}
            />

            <div className="mt-4 rounded border border-border bg-panel-2 p-3">
              <div className="mb-2 font-semibold uppercase tracking-wider text-muted-foreground">
                Face Turn
              </div>
              <PropertyRow
                label="Turn X"
                value={faceTurnX}
                min={-1}
                max={1}
                step={0.01}
                rest={0}
                onChange={setFaceTurnX}
              />
            </div>

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
              <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewPlaying((playing) => !playing)}
                  className="flex items-center justify-center gap-1 rounded border border-border bg-panel-2 px-2 py-1 text-xs hover:bg-panel"
                >
                  {previewPlaying ? <Pause size={12} /> : <Play size={12} />}
                  {previewPlaying ? "Pause preview" : "Play preview"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTime(0);
                    setPreviewPlaying(true);
                  }}
                  className="flex items-center justify-center rounded border border-border bg-panel-2 px-2 py-1 hover:bg-panel"
                  title="Restart preview"
                >
                  <SkipBack size={12} />
                </button>
              </div>
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
  onToggleHidden,
}: {
  slots: CharacterSlot[];
  selectedSlotId: string | null;
  overrides: Map<string, RecorderPartState>;
  activePartForSlot: (slot: CharacterSlot) => CharacterPart | undefined;
  onSelect: (id: string) => void;
  onToggleHidden: (id: string) => void;
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
                const override = overrides.get(slot.id);
                const dirty = isDirtyOverride(override, part);
                const hidden = (override?.opacity ?? 1) <= 0.01 || part?.visible === false;
                return (
                  <div
                    key={slot.id}
                    className={`flex w-full items-center gap-1 rounded ${
                      selectedSlotId === slot.id
                        ? "bg-primary/20 text-foreground"
                        : "text-muted-foreground hover:bg-panel-2 hover:text-foreground"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(slot.id)}
                      className="flex min-w-0 flex-1 items-center gap-1 px-1.5 py-1 text-left"
                    >
                      <span className="w-2">{dirty ? "•" : ""}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {slot.name ?? part?.name ?? roleLabel(slot.role)}
                      </span>
                      <span className="rounded bg-background/60 px-1 text-[9px]">{slot.role}</span>
                      <Lock size={10} className="opacity-45" />
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleHidden(slot.id);
                      }}
                      className={`mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-background/70 ${
                        hidden ? "text-muted-foreground" : "text-foreground"
                      }`}
                      title={hidden ? "Show layer in motion" : "Hide layer in motion"}
                    >
                      {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  </div>
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
  advancedOpen,
  onAdvancedOpenChange,
  onChange,
  onResetAll,
}: {
  slot: CharacterSlot | null;
  part: CharacterPart | null;
  override: RecorderPartState | null;
  advancedOpen: boolean;
  onAdvancedOpenChange: (open: boolean) => void;
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
  const variantOptions = variantOptionsForSlot(slot);
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
        {variantOptions.length > 1 && (
          <label className="grid grid-cols-[64px_1fr] items-center gap-2 text-[10px]">
            <span className="text-muted-foreground">Variant</span>
            <select
              value={override.poseSwap ?? ""}
              onChange={(e) => onChange({ poseSwap: e.target.value || undefined })}
              className="w-full rounded border border-border bg-input px-2 py-1"
            >
              {variantOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
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
          label="Size"
          value={override.scale}
          min={0.1}
          max={3}
          step={0.01}
          rest={1}
          onChange={(value) => onChange({ scale: value })}
        />
        <PropertyRow
          label="Width"
          value={override.scaleX}
          min={0.1}
          max={3}
          step={0.01}
          rest={1}
          onChange={(value) => onChange({ scaleX: value })}
        />
        <PropertyRow
          label="Height"
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
      </div>

      <button
        type="button"
        onClick={() => onAdvancedOpenChange(!advancedOpen)}
        className="mt-3 flex w-full items-center justify-between rounded border border-border px-2 py-1 text-left text-[11px] hover:bg-panel-2"
      >
        <span>Advanced transforms</span>
        <span className="text-muted-foreground">{advancedOpen ? "Hide" : "Show"}</span>
      </button>
      {advancedOpen && (
        <div className="mt-2 space-y-2 rounded border border-border bg-panel-2 p-2">
          <PropertyRow
            label="Skew X"
            value={override.skewX}
            min={-45}
            max={45}
            step={1}
            rest={0}
            onChange={(value) => onChange({ skewX: value })}
          />
          <PropertyRow
            label="Skew Y"
            value={override.skewY}
            min={-45}
            max={45}
            step={1}
            rest={0}
            onChange={(value) => onChange({ skewY: value })}
          />
          <PropertyRow
            label="Pivot X"
            value={override.originX}
            min={-0.5}
            max={1.5}
            step={0.01}
            rest={part.anchorX}
            onChange={(value) => onChange({ originX: value })}
          />
          <PropertyRow
            label="Pivot Y"
            value={override.originY}
            min={-0.5}
            max={1.5}
            step={0.01}
            rest={part.anchorY}
            onChange={(value) => onChange({ originY: value })}
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
      )}
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
  faceTurnX,
  canvasWidth,
  onSelect,
  onSelectAtPoint,
  onChange,
}: {
  part: CharacterPart;
  override?: RecorderPartState;
  selected: boolean;
  stageScale: number;
  faceTurnX: number;
  canvasWidth: number;
  onSelect: () => void;
  onSelectAtPoint: (clientX: number, clientY: number, altKey: boolean) => void;
  onChange: (patch: Partial<RecorderPartState>) => void;
}) {
  const url = useMediaUrl(part.mediaId);
  const ov = override ?? defaultOverride(part.slotId, part);
  const turn = faceTurnMotionForPart(part, faceTurnX, canvasWidth);
  const alphaRect = localAlphaBounds(part);

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
        left: part.x + ov.dx + turn.dx,
        top: part.y + ov.dy + turn.dy,
        width: part.width,
        height: part.height,
        opacity: ov.opacity,
        transform: `rotate(${part.rotation + ov.rotation + turn.rotation}deg) scale(${
          ov.scale * ov.scaleX * turn.scaleX
        }, ${ov.scale * ov.scaleY * turn.scaleY}) skew(${ov.skewX + turn.skewX}deg, ${
          ov.skewY + turn.skewY
        }deg)`,
        transformOrigin: `${ov.originX * 100}% ${ov.originY * 100}%`,
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
      <div
        onPointerDown={onPointerDown}
        className={`absolute ${selected ? "outline outline-1 outline-primary/80" : ""}`}
        style={{
          left: alphaRect.x,
          top: alphaRect.y,
          width: alphaRect.width,
          height: alphaRect.height,
          cursor: "pointer",
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
  faceTurnX,
  canvasWidth,
  planeRef,
  onChange,
}: {
  part: CharacterPart;
  override: RecorderPartState;
  scale: number;
  faceTurnX: number;
  canvasWidth: number;
  planeRef: React.RefObject<HTMLDivElement | null>;
  onChange: (patch: Partial<RecorderPartState>) => void;
}) {
  const alphaRect = localAlphaBounds(part);
  const turn = faceTurnMotionForPart(part, faceTurnX, canvasWidth);
  const handleSize = 24 / Math.max(0.0001, scale);
  const gap = 18 / Math.max(0.0001, scale);
  const pivotLocal = { x: override.originX * part.width, y: override.originY * part.height };

  const startMove = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = override.dx;
    const oy = override.dy;
    const move = (ev: PointerEvent) => {
      onChange({
        dx: Math.round(ox + (ev.clientX - sx) / scale),
        dy: Math.round(oy + (ev.clientY - sy) / scale),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startRotate = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const rect = planeRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pivotX = rect.left + (part.x + override.dx + turn.dx + pivotLocal.x) * scale;
    const pivotY = rect.top + (part.y + override.dy + turn.dy + pivotLocal.y) * scale;
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
    const pivotX = rect.left + (part.x + override.dx + turn.dx + pivotLocal.x) * scale;
    const pivotY = rect.top + (part.y + override.dy + turn.dy + pivotLocal.y) * scale;
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

  const startPivot = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const rect = planeRef.current?.getBoundingClientRect();
    if (!rect) return;
    const move = (ev: PointerEvent) => {
      const canvasX = (ev.clientX - rect.left) / scale;
      const canvasY = (ev.clientY - rect.top) / scale;
      onChange({
        originX: round((canvasX - part.x - override.dx - turn.dx) / Math.max(1, part.width), 3),
        originY: round((canvasY - part.y - override.dy - turn.dy) / Math.max(1, part.height), 3),
      });
    };
    move(e.nativeEvent);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: part.x + override.dx + turn.dx,
        top: part.y + override.dy + turn.dy,
        width: part.width,
        height: part.height,
        transform: `rotate(${part.rotation + override.rotation + turn.rotation}deg) scale(${
          override.scale * override.scaleX * turn.scaleX
        }, ${override.scale * override.scaleY * turn.scaleY}) skew(${
          override.skewX + turn.skewX
        }deg, ${override.skewY + turn.skewY}deg)`,
        transformOrigin: `${override.originX * 100}% ${override.originY * 100}%`,
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
      />
      <button
        type="button"
        onPointerDown={startMove}
        className="pointer-events-auto absolute flex items-center justify-center rounded border border-background bg-panel text-foreground shadow"
        style={{
          left: alphaRect.x - gap,
          top: alphaRect.y - gap,
          width: handleSize,
          height: handleSize,
          transform: "translate(-50%, -50%)",
        }}
        title="Move"
      >
        <Move size={Math.max(12, handleSize * 0.55)} />
      </button>
      <button
        type="button"
        onPointerDown={startRotate}
        className="pointer-events-auto absolute flex items-center justify-center rounded-full border border-background bg-primary text-primary-foreground shadow"
        style={{
          left: alphaRect.x + alphaRect.width / 2,
          top: alphaRect.y - gap,
          width: handleSize,
          height: handleSize,
          transform: "translate(-50%, -50%)",
        }}
        title="Rotate"
      >
        <RotateCw size={Math.max(12, handleSize * 0.55)} />
      </button>
      <button
        type="button"
        onPointerDown={startScale}
        className="pointer-events-auto absolute flex items-center justify-center rounded border border-background bg-accent text-accent-foreground shadow"
        style={{
          left: alphaRect.x + alphaRect.width + gap,
          top: alphaRect.y + alphaRect.height + gap,
          width: handleSize,
          height: handleSize,
          transform: "translate(-50%, -50%)",
        }}
        title="Scale"
      >
        <Scaling size={Math.max(12, handleSize * 0.55)} />
      </button>
      <button
        type="button"
        onPointerDown={startPivot}
        className="pointer-events-auto absolute flex items-center justify-center rounded-full border border-background bg-panel text-foreground shadow"
        style={{
          left: alphaRect.x - gap,
          top: alphaRect.y + alphaRect.height + gap,
          width: handleSize,
          height: handleSize,
          transform: "translate(-50%, -50%)",
        }}
        title="Set pivot"
      >
        <Crosshair size={Math.max(12, handleSize * 0.55)} />
      </button>
      <div
        className="absolute rounded-full border border-primary bg-background/80"
        style={{
          left: pivotLocal.x,
          top: pivotLocal.y,
          width: Math.max(8, handleSize * 0.4),
          height: Math.max(8, handleSize * 0.4),
          transform: "translate(-50%, -50%)",
        }}
      />
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

const MOTION_VALUE_KEYS = [
  "dx",
  "dy",
  "scale",
  "scaleX",
  "scaleY",
  "skewX",
  "skewY",
  "rotation",
  "originX",
  "originY",
  "opacity",
] as const;

type MotionValueKey = (typeof MOTION_VALUE_KEYS)[number];

const MOTION_VALUE_DEFAULTS: Record<MotionValueKey, number> = {
  dx: 0,
  dy: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  skewX: 0,
  skewY: 0,
  rotation: 0,
  originX: 0.5,
  originY: 0.5,
  opacity: 1,
};

function initialKeyposesForPreset(
  preset: MotionPreset | undefined,
  slots: CharacterSlot[],
): RecordedKeypose[] {
  if (!preset) return [];
  if (preset.keyposes?.length) return cloneKeyposes(preset.keyposes);
  return keyposesFromTracks(preset, slots);
}

function customPresetName(name: string) {
  return /\bcustom$/i.test(name.trim()) ? name : `${name} custom`;
}

function editorTitle(category: MotionCategory) {
  switch (category) {
    case "expression":
      return "Expression Editor";
    case "gesture":
      return "Body Gesture Editor";
    case "full-body":
      return "Full Body Motion Editor";
    case "camera":
      return "Camera Motion Editor";
    case "headTurn":
      return "Head Turn Editor";
    case "custom":
      return "Custom Motion Editor";
  }
}

function cloneKeyposes(keyposes: RecordedKeypose[]): RecordedKeypose[] {
  return keyposes.map((keypose) => ({
    ...keypose,
    parts: keypose.parts.map((part) => ({ ...part })),
    camera: keypose.camera ? { ...keypose.camera } : undefined,
    anticipation: keypose.anticipation ? { ...keypose.anticipation } : undefined,
  }));
}

function keyposesFromTracks(preset: MotionPreset, slots: CharacterSlot[]): RecordedKeypose[] {
  const tracks = preset.tracks ?? [];
  if (tracks.length === 0) return [];
  const duration = Math.max(0.1, preset.duration);
  const normalizedTimes = new Set<number>([0, 1]);
  for (const track of tracks) {
    for (const keyframe of track.keyframes) {
      normalizedTimes.add(round(Math.max(0, Math.min(1, keyframe.t)), 4));
    }
  }
  return Array.from(normalizedTimes)
    .sort((a, b) => a - b)
    .map((tNorm) => {
      const parts: RecordedPartOverride[] = [];
      let camera: RecordedKeypose["camera"];
      for (const track of tracks) {
        const sample = sampleMotionTrack(track, tNorm);
        const keys = usedMotionValueKeys(track);
        if (track.partRole === "__camera") {
          camera = {
            dx: sample.dx,
            dy: sample.dy,
            zoom: sample.scale,
          };
          continue;
        }
        for (const slot of slotsForTrack(track, slots)) {
          parts.push(recordedOverrideFromMotionTrack(track, slot, sample, keys));
        }
      }
      return {
        t: round(tNorm * duration, 3),
        parts,
        camera,
      };
    });
}

function slotsForTrack(track: MotionTrack, slots: CharacterSlot[]) {
  if (track.slotId) return slots.filter((slot) => slot.id === track.slotId);
  return slots.filter((slot) => slot.role === track.partRole);
}

function usedMotionValueKeys(track: MotionTrack): MotionValueKey[] {
  return MOTION_VALUE_KEYS.filter((key) =>
    track.keyframes.some((keyframe) => keyframe[key] !== undefined),
  );
}

function recordedOverrideFromMotionTrack(
  track: MotionTrack,
  slot: CharacterSlot,
  sample: Partial<Record<MotionValueKey, number>>,
  keys: MotionValueKey[],
): RecordedPartOverride {
  const out: RecordedPartOverride = { partRole: slot.role, slotId: slot.id };
  if (track.poseSwap) out.poseSwap = track.poseSwap;
  const writable = out as RecordedPartOverride & Partial<Record<MotionValueKey, number>>;
  for (const key of keys) {
    const value = sample[key];
    if (value !== undefined) writable[key] = round(value, 4);
  }
  return out;
}

function sampleMotionTrack(
  track: MotionTrack,
  tNorm: number,
): Partial<Record<MotionValueKey, number>> {
  const sorted = [...track.keyframes].sort((a, b) => a.t - b.t);
  if (sorted.length === 0) return {};
  if (sorted.length === 1) return sampleSingleMotionKeyframe(sorted[0]);
  let a = sorted[0];
  let b = sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1].t >= tNorm) {
      a = sorted[i];
      b = sorted[i + 1];
      break;
    }
  }
  const span = Math.max(0.0001, b.t - a.t);
  const u = easeValue(b.ease ?? a.ease, Math.max(0, Math.min(1, (tNorm - a.t) / span)));
  const out: Partial<Record<MotionValueKey, number>> = {};
  for (const key of MOTION_VALUE_KEYS) {
    const av = a[key];
    const bv = b[key];
    if (av === undefined && bv === undefined) continue;
    if (av === undefined) out[key] = bv;
    else if (bv === undefined) out[key] = av;
    else out[key] = av + (bv - av) * u;
  }
  return out;
}

function sampleSingleMotionKeyframe(
  keyframe: MotionKeyframe,
): Partial<Record<MotionValueKey, number>> {
  const out: Partial<Record<MotionValueKey, number>> = {};
  for (const key of MOTION_VALUE_KEYS) {
    const value = keyframe[key] ?? MOTION_VALUE_DEFAULTS[key];
    if (keyframe[key] !== undefined) out[key] = value;
  }
  return out;
}

function sampleKeyposesAtTime(
  keyposes: RecordedKeypose[],
  t: number,
): { parts: Map<string, RecordedPartOverride>; faceTurnX: number } {
  const out = new Map<string, RecordedPartOverride>();
  if (keyposes.length === 0) return { parts: out, faceTurnX: 0 };
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
  const lerp = (av?: number, bv?: number, def = 0) => {
    if (av === undefined && bv === undefined) return def;
    if (av === undefined) return (bv as number) * u + def * (1 - u);
    if (bv === undefined) return av * (1 - u) + def * u;
    return av + (bv - av) * u;
  };
  const targets = new Set<string>();
  for (const p of a.parts) targets.add(recordedTargetKey(p));
  for (const p of b.parts) targets.add(recordedTargetKey(p));
  for (const target of targets) {
    const pa = a.parts.find((p) => recordedTargetKey(p) === target);
    const pb = b.parts.find((p) => recordedTargetKey(p) === target);
    const src = pa ?? pb;
    if (!src) continue;
    out.set(target, {
      partRole: src.partRole,
      slotId: src.slotId,
      dx: lerp(pa?.dx, pb?.dx, 0),
      dy: lerp(pa?.dy, pb?.dy, 0),
      scale: lerp(pa?.scale, pb?.scale, 1),
      scaleX: lerp(pa?.scaleX, pb?.scaleX, 1),
      scaleY: lerp(pa?.scaleY, pb?.scaleY, 1),
      skewX: lerp(pa?.skewX, pb?.skewX, 0),
      skewY: lerp(pa?.skewY, pb?.skewY, 0),
      rotation: lerp(pa?.rotation, pb?.rotation, 0),
      originX:
        pa?.originX === undefined && pb?.originX === undefined
          ? undefined
          : lerp(pa?.originX, pb?.originX, 0.5),
      originY:
        pa?.originY === undefined && pb?.originY === undefined
          ? undefined
          : lerp(pa?.originY, pb?.originY, 0.5),
      opacity:
        pa?.opacity === undefined && pb?.opacity === undefined
          ? undefined
          : lerp(pa?.opacity, pb?.opacity, 1),
      poseSwap: (u >= 0.5 ? pb?.poseSwap : pa?.poseSwap) ?? pa?.poseSwap ?? pb?.poseSwap,
    });
  }
  return { parts: out, faceTurnX: lerp(a.faceTurnX, b.faceTurnX, 0) };
}

function defaultOverride(slotId: string, part?: CharacterPart): RecorderPartState {
  return {
    slotId,
    dx: 0,
    dy: 0,
    scale: 1,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
    skewY: 0,
    rotation: 0,
    originX: part?.anchorX ?? 0.5,
    originY: part?.anchorY ?? 0.5,
    opacity: 1,
  };
}

function isDirtyOverride(override: RecorderPartState | undefined, part?: CharacterPart) {
  if (!override) return false;
  const rest = defaultOverride(override.slotId, part);
  return (
    override.poseSwap !== undefined ||
    override.dx !== 0 ||
    override.dy !== 0 ||
    override.scale !== 1 ||
    override.scaleX !== 1 ||
    override.scaleY !== 1 ||
    override.skewX !== 0 ||
    override.skewY !== 0 ||
    override.rotation !== 0 ||
    override.originX !== rest.originX ||
    override.originY !== rest.originY ||
    override.opacity !== 1
  );
}

function variantOptionsForSlot(slot: CharacterSlot) {
  const variants = new Map<string, string>();
  for (const part of slot.parts) {
    const value =
      slot.role === "mouth"
        ? (part.viseme ?? part.pose)
        : slot.role === "eye"
          ? (part.eyeState ?? part.pose)
          : part.pose;
    if (!value) continue;
    variants.set(value, variantLabel(slot.role, value));
  }
  if (variants.size === 0) return [];
  const defaultValue = slot.role === "eye" ? "open" : slot.role === "mouth" ? "rest" : undefined;
  return [
    {
      value: "",
      label: defaultValue ? `Default (${variantLabel(slot.role, defaultValue)})` : "Default",
    },
    ...Array.from(variants, ([value, label]) => ({ value, label })),
  ];
}

function variantLabel(role: PartRole, value: string) {
  if (role === "mouth" && value === "O") return "Round / O";
  if (role === "mouth" && value === "MBP") return "Closed / MBP";
  if (role === "mouth" && value === "FV") return "Teeth / FV";
  if (role === "mouth" && value === "WQ") return "Pucker / WQ";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function transformedBounds(
  part: CharacterPart,
  override: RecorderPartState | undefined,
  faceTurnX: number,
  canvasWidth: number,
) {
  const ov = override ?? defaultOverride(part.slotId, part);
  const turn = faceTurnMotionForPart(part, faceTurnX, canvasWidth);
  const alphaRect = localAlphaBounds(part);
  const pivot = pivotForPart(part);
  const pivotLocalX = pivot.x - part.x;
  const pivotLocalY = pivot.y - part.y;
  const scaleX = ov.scale * ov.scaleX * turn.scaleX;
  const scaleY = ov.scale * ov.scaleY * turn.scaleY;
  const left = part.x + ov.dx + turn.dx + pivotLocalX + (alphaRect.x - pivotLocalX) * scaleX;
  const top = part.y + ov.dy + turn.dy + pivotLocalY + (alphaRect.y - pivotLocalY) * scaleY;
  const width = alphaRect.width * scaleX;
  const height = alphaRect.height * scaleY;
  return { left, top, right: left + width, bottom: top + height };
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
