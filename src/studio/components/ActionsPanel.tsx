// Actions panel — apply / configure action presets on a CharacterClip.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "../db";
import { useStudio } from "../store";
import { ensurePresetsSeeded } from "../presets/seed";
import { PresetRecorder } from "../presets/PresetRecorder";
import { generateLoopOccurrences } from "../presets/apply";
import type {
  ActionCategory,
  ActionPreset,
  AppliedAction,
  CharacterClip,
  CharacterPreset,
} from "../types";

const CATEGORY_TABS: { id: ActionCategory | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "expression", label: "Expression" },
  { id: "gesture", label: "Gesture" },
  { id: "full-body", label: "Full body" },
  { id: "camera", label: "Camera" },
  { id: "headTurn", label: "Head turn" },
  { id: "custom", label: "Custom" },
];

const CATEGORY_COLORS: Record<ActionCategory, string> = {
  expression: "bg-sky-500/70 border-sky-300/80",
  gesture: "bg-emerald-500/70 border-emerald-300/80",
  "full-body": "bg-amber-500/75 border-amber-300/80",
  camera: "bg-violet-500/70 border-violet-300/80",
  headTurn: "bg-fuchsia-500/70 border-fuchsia-300/80",
  custom: "bg-slate-400/70 border-slate-200/80",
};

const RULER_HEIGHT = 22;
const ROW_HEIGHT = 24;
const LABEL_WIDTH = 58;

export function ActionsPanel({
  clip,
  character,
}: {
  clip: CharacterClip;
  character: CharacterPreset;
}) {
  const update = useStudio((s) => s.updateClip);
  const [picking, setPicking] = useState(false);
  const [filterCat, setFilterCat] = useState<ActionCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [recording, setRecording] = useState(false);
  const [editingPreset, setEditingPreset] = useState<ActionPreset | null>(null);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void ensurePresetsSeeded();
  }, []);
  const queriedPresets = useLiveQuery(() => db.movements.toArray(), []);
  const presets = useMemo(() => queriedPresets ?? [], [queriedPresets]);
  const presetMap = useMemo(() => new Map(presets.map((p) => [p.id, p] as const)), [presets]);

  const filteredPresets = presets.filter((p) => {
    if (filterCat !== "all" && p.category !== filterCat) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const actions = useMemo(() => clip.actions ?? [], [clip.actions]);
  const selectedAction = actions.find((a) => a.id === selectedActionId) ?? null;
  const selectedPreset = selectedAction ? presetMap.get(selectedAction.presetId) : undefined;

  useEffect(() => {
    if (selectedActionId && !actions.some((a) => a.id === selectedActionId)) {
      setSelectedActionId(null);
    }
  }, [actions, selectedActionId]);

  const addAction = (preset: ActionPreset) => {
    const a: AppliedAction = {
      id: uid(),
      presetId: preset.id,
      offset: 0,
      intensity: 1,
      loop: preset.loop,
    };
    update(clip.id, { actions: [...actions, a] } as Partial<CharacterClip>);
    setSelectedActionId(a.id);
    setPicking(false);
  };

  const updateAction = (id: string, patch: Partial<AppliedAction>) => {
    update(clip.id, {
      actions: actions.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    } as Partial<CharacterClip>);
  };

  const removeAction = (id: string) => {
    update(clip.id, { actions: actions.filter((a) => a.id !== id) } as Partial<CharacterClip>);
    if (selectedActionId === id) setSelectedActionId(null);
  };

  const timelineWidth = () => timelineRef.current?.getBoundingClientRect().width ?? 1;

  const startDrag = (e: React.PointerEvent, action: AppliedAction, mode: "move" | "resize") => {
    e.stopPropagation();
    if (e.button !== 0) return;
    setSelectedActionId(action.id);
    const startX = e.clientX;
    const startOffset = action.offset;
    const startDuration = action.duration ?? presetMap.get(action.presetId)?.duration ?? 1;
    const secondsPerPx = Math.max(0.001, clip.duration / timelineWidth());
    const move = (ev: PointerEvent) => {
      const delta = (ev.clientX - startX) * secondsPerPx;
      if (mode === "move") {
        updateAction(action.id, {
          offset: round(Math.max(0, Math.min(clip.duration, startOffset + delta)), 2),
        });
      } else {
        updateAction(action.id, { duration: round(Math.max(0.05, startDuration + delta), 2) });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (recording || editingPreset) {
    return (
      <PresetRecorder
        character={character}
        initialPreset={editingPreset ?? undefined}
        onClose={() => {
          setRecording(false);
          setEditingPreset(null);
        }}
      />
    );
  }

  const marks = [0, clip.duration / 4, clip.duration / 2, (clip.duration * 3) / 4, clip.duration];
  const sheetHeight = RULER_HEIGHT + Math.max(1, actions.length) * ROW_HEIGHT;

  return (
    <div className="rounded border border-border bg-panel-2 p-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold uppercase tracking-wider text-muted-foreground">
          Actions
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setRecording(true)}
            className="rounded border border-border bg-panel px-2 py-0.5 text-[10px] text-foreground hover:bg-panel-2"
          >
            Record new
          </button>
          <button
            onClick={() => setPicking((v) => !v)}
            className="rounded bg-primary/30 px-2 py-0.5 text-[10px] text-foreground hover:bg-primary/50"
          >
            {picking ? "Cancel" : "+ Apply"}
          </button>
        </div>
      </div>

      {picking && (
        <div className="mb-2 rounded border border-border bg-panel">
          <div className="flex flex-wrap gap-1 border-b border-border p-1.5">
            {CATEGORY_TABS.map((c) => (
              <button
                key={c.id}
                onClick={() => setFilterCat(c.id)}
                className={`rounded px-1.5 py-0.5 text-[10px] ${
                  filterCat === c.id
                    ? "bg-primary/30 text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="border-b border-border px-2 py-1">
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded border border-border bg-input px-2 py-0.5 text-[11px]"
            />
          </div>
          <div className="max-h-48 overflow-auto">
            {filteredPresets.map((p) => (
              <button
                key={p.id}
                onClick={() => addAction(p)}
                className="block w-full border-b border-border px-2 py-1.5 text-left text-[11px] hover:bg-panel-2"
              >
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-foreground">{p.name}</span>
                  <span className="text-[10px] text-muted-foreground">{p.duration}s</span>
                  <span className="text-[10px] text-muted-foreground">{p.category}</span>
                </div>
              </button>
            ))}
            {filteredPresets.length === 0 && (
              <div className="p-2 text-[11px] text-muted-foreground">No presets match.</div>
            )}
          </div>
        </div>
      )}

      <div className="rounded border border-border bg-panel p-2">
        <div className="relative" style={{ height: sheetHeight }}>
          <div
            ref={timelineRef}
            className="absolute right-0 top-0 h-full"
            style={{ left: LABEL_WIDTH }}
          >
            {marks.map((mark) => (
              <div
                key={mark}
                className="absolute top-0 h-full border-l border-border/70"
                style={{ left: `${percent(mark, clip.duration)}%` }}
              >
                <span className="absolute left-1 top-0 text-[9px] text-muted-foreground">
                  {formatSeconds(mark)}
                </span>
              </div>
            ))}
          </div>

          {actions.length === 0 && (
            <div
              className="absolute inset-x-0 flex items-center justify-center text-[11px] text-muted-foreground"
              style={{ top: RULER_HEIGHT, height: ROW_HEIGHT }}
            >
              No actions applied.
            </div>
          )}

          {actions.map((action, row) => {
            const preset = presetMap.get(action.presetId);
            const occurrences = preset
              ? generateLoopOccurrences(action, preset, clip.duration)
              : [{ start: action.offset, end: action.offset + (action.duration ?? 1) }];
            const color = preset ? CATEGORY_COLORS[preset.category] : CATEGORY_COLORS.custom;
            const selected = action.id === selectedActionId;
            return (
              <div
                key={action.id}
                className={`absolute left-0 right-0 ${selected ? "bg-primary/10" : ""}`}
                style={{ top: RULER_HEIGHT + row * ROW_HEIGHT, height: ROW_HEIGHT }}
              >
                <button
                  onClick={() => setSelectedActionId(action.id)}
                  className="absolute left-0 top-0 h-full truncate pr-2 text-left text-[10px] text-foreground"
                  style={{ width: LABEL_WIDTH }}
                  title={preset?.name ?? "Unknown preset"}
                >
                  {preset?.name ?? "Unknown"}
                </button>
                <div className="absolute right-0 top-1 h-4" style={{ left: LABEL_WIDTH }}>
                  {occurrences.map((occurrence, index) => {
                    const start = Math.max(0, occurrence.start);
                    const end = Math.min(clip.duration, occurrence.end);
                    if (end <= 0 || start >= clip.duration || end <= start) return null;
                    return (
                      <button
                        key={`${action.id}-${index}-${occurrence.start}`}
                        onPointerDown={(e) => startDrag(e, action, "move")}
                        onClick={() => setSelectedActionId(action.id)}
                        className={`absolute top-0 h-4 rounded border ${color} ${
                          index > 0 ? "opacity-55" : ""
                        } ${selected ? "ring-1 ring-primary-foreground" : ""}`}
                        style={{
                          left: `${percent(start, clip.duration)}%`,
                          width: `${Math.max(1.5, percent(end - start, clip.duration))}%`,
                        }}
                        title={`${preset?.name ?? "Action"} ${formatSeconds(start)}-${formatSeconds(end)}`}
                      >
                        {index === 0 && (
                          <span
                            onPointerDown={(e) => startDrag(e, action, "resize")}
                            className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize rounded-r bg-white/50"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {selectedAction && selectedPreset && (
          <div className="mt-3 rounded border border-border bg-panel-2 p-2 text-[10px]">
            <div className="mb-2 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
                {selectedPreset.name}
              </span>
              {!selectedPreset.builtin && (
                <button
                  onClick={() => setEditingPreset(selectedPreset)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Edit
                </button>
              )}
              <button onClick={() => removeAction(selectedAction.id)} className="text-destructive">
                Remove
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Offset"
                value={selectedAction.offset}
                min={0}
                step={0.05}
                onChange={(value) => updateAction(selectedAction.id, { offset: value })}
              />
              <NumberField
                label="Duration"
                value={selectedAction.duration ?? selectedPreset.duration}
                min={0.05}
                step={0.05}
                onChange={(value) => updateAction(selectedAction.id, { duration: value })}
              />
            </div>

            <label className="mt-2 block">
              <div className="mb-1 flex items-center justify-between text-muted-foreground">
                <span>Intensity</span>
                <span>{Math.round(selectedAction.intensity * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={selectedAction.intensity}
                onChange={(e) =>
                  updateAction(selectedAction.id, { intensity: Number(e.target.value) })
                }
                className="w-full"
              />
            </label>

            <label className="mt-2 flex items-center gap-2 text-foreground">
              <input
                type="checkbox"
                checked={selectedAction.loop ?? selectedPreset.loop}
                onChange={(e) => updateAction(selectedAction.id, { loop: e.target.checked })}
              />
              Repeat this action
            </label>

            {(selectedAction.loop ?? selectedPreset.loop) && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label>
                  <span className="block text-muted-foreground">Timing</span>
                  <select
                    value={selectedAction.loopMode ?? "fixed"}
                    onChange={(e) =>
                      updateAction(selectedAction.id, {
                        loopMode: e.target.value as AppliedAction["loopMode"],
                      })
                    }
                    className="w-full rounded border border-border bg-input px-1 py-0.5"
                  >
                    <option value="fixed">Fixed gap</option>
                    <option value="random">Random</option>
                  </select>
                </label>
                <NumberField
                  label={selectedAction.loopMode === "random" ? "Min gap" : "Every"}
                  value={selectedAction.loopGap ?? 0}
                  min={0}
                  step={0.05}
                  onChange={(value) => updateAction(selectedAction.id, { loopGap: value })}
                />
                {selectedAction.loopMode === "random" && (
                  <NumberField
                    label="Max gap"
                    value={Math.max(
                      selectedAction.loopGap ?? 0,
                      selectedAction.loopGapMax ?? selectedAction.loopGap ?? 0,
                    )}
                    min={selectedAction.loopGap ?? 0}
                    step={0.05}
                    onChange={(value) => updateAction(selectedAction.id, { loopGapMax: value })}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      <span className="block text-muted-foreground">{label}</span>
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded border border-border bg-input px-1 py-0.5"
      />
    </label>
  );
}

function percent(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (value / total) * 100));
}

function formatSeconds(value: number) {
  return `${round(value, 1).toFixed(1)}s`;
}

function round(n: number, digits: number) {
  const k = Math.pow(10, digits);
  return Math.round(n * k) / k;
}
