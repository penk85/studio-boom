// Motion panel — apply/configure reusable motion presets on a character composition clip.
import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { usePlayerStore } from "@hyperframes/studio";
import { db, uid } from "../db";
import { useStudio } from "../store";
import { ensureMotionPresetsSeeded } from "../presets/seed";
import { MotionPresetRecorder } from "../presets/MotionPresetRecorder";
import {
  EXCLUSIVE_MOTION_CATEGORIES,
  resolveExclusiveMotionOverlaps,
} from "../presets/motion-scheduling";
import type {
  AppliedMotion,
  CharacterCompositionClip,
  CharacterPreset,
  CompositionClip,
  MotionCategory,
  MotionPreset,
} from "../types";

const CATEGORY_TABS: { id: MotionCategory | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "expression", label: "Expression" },
  { id: "gesture", label: "Body gesture" },
  { id: "full-body", label: "Full body" },
  { id: "camera", label: "Camera move" },
  { id: "headTurn", label: "Head turn" },
  { id: "custom", label: "Custom" },
];

const CATEGORY_COLORS: Record<MotionCategory, string> = {
  expression: "bg-sky-500/70 border-sky-300/80",
  gesture: "bg-emerald-500/70 border-emerald-300/80",
  "full-body": "bg-amber-500/75 border-amber-300/80",
  camera: "bg-violet-500/70 border-violet-300/80",
  headTurn: "bg-fuchsia-500/70 border-fuchsia-300/80",
  custom: "bg-slate-400/70 border-slate-200/80",
};

export function MotionPanel({
  clip,
  character,
}: {
  clip: CharacterCompositionClip;
  character: CharacterPreset;
}) {
  const update = useStudio((s) => s.updateClip);
  const syncMotionPresets = useStudio((s) => s.syncMotionPresets);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const [picking, setPicking] = useState(false);
  const [filterCat, setFilterCat] = useState<MotionCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [recording, setRecording] = useState(false);
  const [editingPreset, setEditingPreset] = useState<MotionPreset | null>(null);
  const [editingMotionId, setEditingMotionId] = useState<string | null>(null);
  const [selectedMotionId, setSelectedMotionId] = useState<string | null>(null);

  useEffect(() => {
    void ensureMotionPresetsSeeded();
  }, []);
  const queriedPresets = useLiveQuery(() => db.motionPresets.toArray(), []);
  const presets = useMemo(() => queriedPresets ?? [], [queriedPresets]);
  const presetMap = useMemo(() => new Map(presets.map((p) => [p.id, p] as const)), [presets]);

  useEffect(() => {
    if (!queriedPresets) return;
    syncMotionPresets(presets);
  }, [presets, queriedPresets, syncMotionPresets]);

  const filteredPresets = presets.filter((p) => {
    if (filterCat !== "all" && p.category !== filterCat) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const appliedMotions = useMemo(() => clip.character.motions ?? [], [clip.character.motions]);
  const selectedMotion = appliedMotions.find((motion) => motion.id === selectedMotionId) ?? null;
  const selectedPreset = selectedMotion ? presetMap.get(selectedMotion.presetId) : undefined;
  const selectedIsExclusive =
    !!selectedPreset && EXCLUSIVE_MOTION_CATEGORIES.has(selectedPreset.category);

  useEffect(() => {
    if (selectedMotionId && !appliedMotions.some((motion) => motion.id === selectedMotionId)) {
      setSelectedMotionId(null);
    }
  }, [appliedMotions, selectedMotionId]);

  const addMotion = (preset: MotionPreset) => {
    const motion: AppliedMotion = {
      id: uid(),
      presetId: preset.id,
      offset: Math.max(0, Math.min(clip.duration, currentTime - clip.start)),
      intensity: 1,
      loop: EXCLUSIVE_MOTION_CATEGORIES.has(preset.category) ? false : preset.loop,
    };
    const motions = resolveExclusiveMotionOverlaps({
      motions: [...appliedMotions, motion],
      editedMotionId: motion.id,
      presetMap,
      clipDuration: clip.duration,
      createId: uid,
    });
    update(clip.id, { character: { ...clip.character, motions } } as Partial<CompositionClip>);
    setSelectedMotionId(motion.id);
    setPicking(false);
  };

  const updateMotion = (id: string, patch: Partial<AppliedMotion>) => {
    const nextMotions = appliedMotions.map((motion) =>
      motion.id === id ? { ...motion, ...patch } : motion,
    );
    const motions = resolveExclusiveMotionOverlaps({
      motions: nextMotions,
      editedMotionId: id,
      presetMap,
      clipDuration: clip.duration,
      createId: uid,
    });
    update(clip.id, { character: { ...clip.character, motions } } as Partial<CompositionClip>);
  };

  const removeMotion = (id: string) => {
    update(clip.id, {
      character: {
        ...clip.character,
        motions: appliedMotions.filter((motion) => motion.id !== id),
      },
    } as Partial<CompositionClip>);
    if (selectedMotionId === id) setSelectedMotionId(null);
  };

  const editPreset = (preset: MotionPreset, motionId: string | null = null) => {
    setEditingPreset(preset);
    setEditingMotionId(motionId);
    setRecording(false);
  };

  if (recording || editingPreset) {
    return (
      <MotionPresetRecorder
        character={character}
        initialPreset={editingPreset ?? undefined}
        copyOnSave={!!editingMotionId}
        onSaved={(preset) => {
          if (editingMotionId) updateMotion(editingMotionId, { presetId: preset.id });
        }}
        onClose={() => {
          setRecording(false);
          setEditingPreset(null);
          setEditingMotionId(null);
        }}
      />
    );
  }

  return (
    <div className="rounded border border-border bg-panel-2 p-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold uppercase tracking-wider text-muted-foreground">
          Applied motions
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setRecording(true);
              setEditingMotionId(null);
            }}
            className="rounded border border-border bg-panel px-2 py-0.5 text-[10px] text-foreground hover:bg-panel-2"
          >
            New motion preset
          </button>
          <button
            onClick={() => setPicking((v) => !v)}
            className="rounded bg-primary/30 px-2 py-0.5 text-[10px] text-foreground hover:bg-primary/50"
          >
            {picking ? "Cancel" : "+ Apply preset"}
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
              <div
                key={p.id}
                className="flex items-center gap-1 border-b border-border px-2 py-1.5 text-[11px]"
              >
                <button
                  onClick={() => addMotion(p)}
                  className="min-w-0 flex-1 text-left hover:text-foreground"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate text-foreground">{p.name}</span>
                    <span className="text-[10px] text-muted-foreground">{p.duration}s</span>
                    <span className="text-[10px] text-muted-foreground">{p.category}</span>
                  </div>
                </button>
                <button
                  onClick={() => editPreset(p)}
                  className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-panel-2 hover:text-foreground"
                >
                  Edit
                </button>
              </div>
            ))}
            {filteredPresets.length === 0 && (
              <div className="p-2 text-[11px] text-muted-foreground">No motion presets match.</div>
            )}
          </div>
        </div>
      )}

      <div className="rounded border border-border bg-panel p-2">
        <div className="space-y-1">
          {appliedMotions.length === 0 && (
            <div className="rounded border border-dashed border-border p-2 text-center text-[11px] text-muted-foreground">
              No motions applied.
            </div>
          )}

          {appliedMotions.map((motion) => {
            const preset = presetMap.get(motion.presetId);
            const color = preset ? CATEGORY_COLORS[preset.category] : CATEGORY_COLORS.custom;
            const selected = motion.id === selectedMotionId;
            return (
              <button
                key={motion.id}
                onClick={() => setSelectedMotionId(motion.id)}
                className={`flex w-full items-center gap-2 rounded border px-2 py-1 text-left text-[11px] ${
                  selected ? "border-primary bg-primary/15" : "border-border bg-panel-2"
                }`}
              >
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full border ${color}`} />
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {preset?.name ?? "Unknown motion"}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {formatSeconds(motion.offset)}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {formatSeconds(motion.duration ?? preset?.duration ?? 1)}
                </span>
              </button>
            );
          })}
        </div>

        {selectedMotion && selectedPreset && (
          <div className="mt-3 rounded border border-border bg-panel-2 p-2 text-[10px]">
            <div className="mb-2 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
                {selectedPreset.name}
              </span>
              <button
                onClick={() => editPreset(selectedPreset, selectedMotion.id)}
                className="text-muted-foreground hover:text-foreground"
              >
                Edit preset copy
              </button>
              <button onClick={() => removeMotion(selectedMotion.id)} className="text-destructive">
                Remove
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Offset"
                value={selectedMotion.offset}
                min={0}
                step={0.05}
                onChange={(value) => updateMotion(selectedMotion.id, { offset: value })}
              />
              <NumberField
                label="Duration"
                value={selectedMotion.duration ?? selectedPreset.duration}
                min={0.05}
                step={0.05}
                onChange={(value) => updateMotion(selectedMotion.id, { duration: value })}
              />
            </div>

            <label className="mt-2 block">
              <div className="mb-1 flex items-center justify-between text-muted-foreground">
                <span>Intensity</span>
                <span>{Math.round(selectedMotion.intensity * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={selectedMotion.intensity}
                onChange={(e) =>
                  updateMotion(selectedMotion.id, { intensity: Number(e.target.value) })
                }
                className="w-full"
              />
            </label>

            {!selectedIsExclusive && (
              <label className="mt-2 flex items-center gap-2 text-foreground">
                <input
                  type="checkbox"
                  checked={selectedMotion.loop ?? selectedPreset.loop}
                  onChange={(e) => updateMotion(selectedMotion.id, { loop: e.target.checked })}
                />
                Repeat this motion
              </label>
            )}

            {!selectedIsExclusive && (selectedMotion.loop ?? selectedPreset.loop) && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label>
                  <span className="block text-muted-foreground">Timing</span>
                  <select
                    value={selectedMotion.loopMode ?? "fixed"}
                    onChange={(e) =>
                      updateMotion(selectedMotion.id, {
                        loopMode: e.target.value as AppliedMotion["loopMode"],
                      })
                    }
                    className="w-full rounded border border-border bg-input px-1 py-0.5"
                  >
                    <option value="fixed">Fixed gap</option>
                    <option value="random">Random</option>
                  </select>
                </label>
                <NumberField
                  label={selectedMotion.loopMode === "random" ? "Min gap" : "Every"}
                  value={selectedMotion.loopGap ?? 0}
                  min={0}
                  step={0.05}
                  onChange={(value) => updateMotion(selectedMotion.id, { loopGap: value })}
                />
                {selectedMotion.loopMode === "random" && (
                  <NumberField
                    label="Max gap"
                    value={Math.max(
                      selectedMotion.loopGap ?? 0,
                      selectedMotion.loopGapMax ?? selectedMotion.loopGap ?? 0,
                    )}
                    min={selectedMotion.loopGap ?? 0}
                    step={0.05}
                    onChange={(value) => updateMotion(selectedMotion.id, { loopGapMax: value })}
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

function formatSeconds(value: number) {
  return `${round(value, 1).toFixed(1)}s`;
}

function round(n: number, digits: number) {
  const k = Math.pow(10, digits);
  return Math.round(n * k) / k;
}
