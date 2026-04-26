// PresetRecorder — visual pose-and-capture flow for building action presets.
// No dopesheet, no curve editor. The user drags parts on a stage,
// captures snapshots at chosen times, and saves the result as an ActionPreset
// with `keyposes`. The composer interpolates between captured poses at runtime.
import { useEffect, useMemo, useRef, useState } from "react";
import { db, uid } from "../db";
import { useMediaUrl } from "../hooks/useMediaUrl";
import { listCharacterSlots, pickActivePartForSlot } from "../character/character-utils";
import type {
  ActionCategory,
  ActionPreset,
  CharacterPart,
  CharacterPreset,
  RecordedKeypose,
  RecordedPartOverride,
} from "../types";

const CATEGORIES: { value: ActionCategory; label: string; hint: string }[] = [
  { value: "expression", label: "Expression", hint: "Face: brows, eyes, mouth" },
  { value: "gesture", label: "Gesture", hint: "Arms, hands, head movements" },
  { value: "full-body", label: "Full body", hint: "Body, legs, jumps, idle" },
  { value: "camera", label: "Camera", hint: "Pan, zoom, shake" },
  { value: "headTurn", label: "Head turn", hint: "Swap between head variants" },
];

interface RecorderPartState {
  slotId: string;
  /** Live x/y/scale/rotation overrides relative to rest. */
  dx: number;
  dy: number;
  scale: number;
  rotation: number;
}

export function PresetRecorder({
  character,
  onClose,
  initialKeypose,
}: {
  character: CharacterPreset;
  onClose: () => void;
  initialKeypose?: RecordedKeypose;
}) {
  const [name, setName] = useState("New preset");
  const [category, setCategory] = useState<ActionCategory>("expression");
  const [duration, setDuration] = useState(1);
  const [time, setTime] = useState(0);
  const [keyposes, setKeyposes] = useState<RecordedKeypose[]>(
    initialKeypose ? [initialKeypose] : [],
  );
  // Live pose overrides per part (relative to rest)
  const [overrides, setOverrides] = useState<Map<string, RecorderPartState>>(new Map());
  const [scale, setScale] = useState(0.5);
  const wrapRef = useRef<HTMLDivElement>(null);
  const slots = useMemo(() => listCharacterSlots(character.parts), [character.parts]);

  // Fit
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth - 32;
      const h = el.clientHeight - 32;
      setScale(Math.max(0.1, Math.min(w / character.canvasWidth, h / character.canvasHeight, 1)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [character.canvasWidth, character.canvasHeight]);

  // When time changes, snap overrides to interpolated keypose so the user
  // sees what's currently in the preset at this time before they edit.
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
        rotation: ov.rotation ?? 0,
      });
    }
    setOverrides(next);
  }, [time, keyposes, slots]);

  const updateOverride = (slotId: string, patch: Partial<RecorderPartState>) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      const cur = next.get(slotId) ?? { slotId, dx: 0, dy: 0, scale: 1, rotation: 0 };
      next.set(slotId, { ...cur, ...patch });
      return next;
    });
  };

  const captureKeypose = () => {
    const parts: RecordedPartOverride[] = [];
    for (const ov of overrides.values()) {
      const slot = slots.find((s) => s.id === ov.slotId);
      if (!slot) continue;
      // Only capture if there's an actual delta
      if (ov.dx === 0 && ov.dy === 0 && ov.scale === 1 && ov.rotation === 0) continue;
      parts.push({
        partRole: slot.role,
        slotId: slot.id,
        dx: ov.dx,
        dy: ov.dy,
        scale: ov.scale,
        rotation: ov.rotation,
      });
    }
    const kp: RecordedKeypose = { t: round(time, 2), parts, ease: "easeInOut" };
    setKeyposes((prev) => {
      const filtered = prev.filter((k) => Math.abs(k.t - kp.t) > 0.001);
      return [...filtered, kp].sort((a, b) => a.t - b.t);
    });
  };

  const removeKeypose = (t: number) =>
    setKeyposes((prev) => prev.filter((k) => Math.abs(k.t - t) > 0.001));

  const save = async () => {
    if (keyposes.length === 0) {
      alert("Capture at least one pose before saving.");
      return;
    }
    const preset: ActionPreset = {
      id: uid(),
      name: name.trim() || "Untitled preset",
      category,
      duration: Math.max(0.1, duration),
      loop: false,
      tracks: [],
      keyposes: keyposes.sort((a, b) => a.t - b.t),
      builtin: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.movements.put(preset);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-background/90 p-6">
      <div className="flex w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-panel">
        <header className="flex items-center gap-3 border-b border-border bg-panel-2 px-4 py-2">
          <span className="text-sm font-semibold">Record Preset</span>
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
              Save preset
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <main
            ref={wrapRef}
            className="relative flex min-w-0 flex-1 items-center justify-center bg-stage-bg p-4"
          >
            <div
              className="relative shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)] outline outline-1 outline-border"
              style={{
                width: character.canvasWidth * scale,
                height: character.canvasHeight * scale,
                background: "oklch(0.12 0.015 270)",
              }}
            >
              <div
                className="absolute left-0 top-0 origin-top-left"
                style={{
                  width: character.canvasWidth,
                  height: character.canvasHeight,
                  transform: `scale(${scale})`,
                }}
              >
                {slots.map((slot) => {
                  const part = pickActivePartForSlot(slot, {
                    viseme: slot.role === "mouth" ? "rest" : undefined,
                    eyeState: slot.role.startsWith("eye") ? "open" : undefined,
                  });
                  if (!part) return null;
                  return (
                    <PoseLayer
                      key={slot.id}
                      part={part}
                      override={overrides.get(slot.id)}
                      scale={scale}
                      onChange={(patch) => updateOverride(slot.id, patch)}
                    />
                  );
                })}
              </div>
            </div>
          </main>

          <aside className="w-72 shrink-0 overflow-auto border-l border-border bg-panel p-3 text-xs">
            <div className="mb-3 text-[11px] text-muted-foreground">
              <strong>How it works:</strong> Drag parts to pose them. Click <em>Capture pose</em>.
              Move the time slider, repose, capture again. Save when done. The preset interpolates
              smoothly between captures.
            </div>

            <div className="mb-3">
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
                ⏺ Capture pose at {time.toFixed(2)}s
              </button>
            </div>

            <div className="mb-3">
              <div className="mb-1 font-semibold uppercase tracking-wider text-muted-foreground">
                Captured poses
              </div>
              {keyposes.length === 0 && (
                <div className="rounded border border-dashed border-border p-2 text-center text-[10px] text-muted-foreground">
                  No poses yet. Pose the character and click capture.
                </div>
              )}
              <ul className="space-y-1">
                {keyposes.map((k) => (
                  <li
                    key={k.t}
                    className={`flex items-center gap-2 rounded border border-border px-2 py-1 ${
                      Math.abs(k.t - time) < 0.05 ? "bg-primary/20" : "bg-panel-2"
                    }`}
                  >
                    <button onClick={() => setTime(k.t)} className="flex-1 text-left">
                      {k.t.toFixed(2)}s · {k.parts.length} parts
                    </button>
                    <button
                      onClick={() => removeKeypose(k.t)}
                      className="text-[10px] text-destructive"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded border border-border bg-panel-2 p-2 text-[10px] text-muted-foreground">
              <strong>Tip:</strong> Only parts you change get captured. To layer this preset with
              others (e.g. add "Surprised" on top of "Wave"), only pose the parts that matter.
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function PoseLayer({
  part,
  override,
  scale,
  onChange,
}: {
  part: CharacterPart;
  override?: RecorderPartState;
  scale: number;
  onChange: (patch: Partial<RecorderPartState>) => void;
}) {
  const url = useMediaUrl(part.mediaId);
  const dx = override?.dx ?? 0;
  const dy = override?.dy ?? 0;
  const sc = override?.scale ?? 1;
  const rot = override?.rotation ?? 0;

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const sx = e.clientX,
      sy = e.clientY;
    const ox = dx,
      oy = dy;
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

  if (!part.visible) return null;
  const dirty = dx !== 0 || dy !== 0 || sc !== 1 || rot !== 0;

  return (
    <div
      onPointerDown={onPointerDown}
      className={`absolute select-none outline outline-offset-0 ${dirty ? "outline-2 outline-primary" : "outline-1 outline-transparent hover:outline-accent/60"}`}
      style={{
        left: part.x + dx,
        top: part.y + dy,
        width: part.width,
        height: part.height,
        transform: `rotate(${part.rotation + rot}deg) scale(${sc})`,
        transformOrigin: `${part.anchorX * 100}% ${part.anchorY * 100}%`,
        zIndex: part.zIndex,
        cursor: "move",
      }}
      title={`${part.role} — drag to pose`}
    >
      {url && (
        <img
          src={url}
          alt={part.name}
          draggable={false}
          className="h-full w-full object-contain pointer-events-none"
        />
      )}
    </div>
  );
}

/** Sample interpolated overrides at time t for the recorder UI. */
function sampleKeyposesAtTime(
  keyposes: RecordedKeypose[],
  t: number,
): Map<string, RecordedPartOverride> {
  const out = new Map<string, RecordedPartOverride>();
  if (keyposes.length === 0) return out;
  const sorted = [...keyposes].sort((a, b) => a.t - b.t);
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
  const u = Math.max(0, Math.min(1, (t - a.t) / span));
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
      rotation: lerp(pa?.rotation, pb?.rotation, 0),
    });
  }
  return out;
}

function recordedTargetKey(part: RecordedPartOverride) {
  return part.slotId ?? part.partRole;
}

function round(n: number, digits: number) {
  const k = Math.pow(10, digits);
  return Math.round(n * k) / k;
}
