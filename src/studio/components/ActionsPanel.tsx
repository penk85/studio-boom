// Actions panel — apply / configure action presets on a CharacterClip.
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "../db";
import { useStudio } from "../store";
import { ensurePresetsSeeded } from "../presets/seed";
import type { ActionPreset, AppliedAction, CharacterClip } from "../types";

export function ActionsPanel({ clip }: { clip: CharacterClip }) {
  const update = useStudio((s) => s.updateClip);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    void ensurePresetsSeeded();
  }, []);
  const presets = useLiveQuery(() => db.movements.toArray(), []) ?? [];
  const presetMap = new Map(presets.map((p) => [p.id, p] as const));

  const actions = clip.actions ?? [];

  const addAction = (preset: ActionPreset) => {
    const a: AppliedAction = {
      id: uid(),
      presetId: preset.id,
      offset: 0,
      intensity: 1,
    };
    update(clip.id, { actions: [...actions, a] } as Partial<CharacterClip>);
    setPicking(false);
  };

  const updateAction = (id: string, patch: Partial<AppliedAction>) => {
    update(clip.id, {
      actions: actions.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    } as Partial<CharacterClip>);
  };

  const removeAction = (id: string) => {
    update(clip.id, { actions: actions.filter((a) => a.id !== id) } as Partial<CharacterClip>);
  };

  return (
    <div className="rounded border border-border bg-panel-2 p-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold uppercase tracking-wider text-muted-foreground">
          Actions
        </span>
        <button
          onClick={() => setPicking((v) => !v)}
          className="rounded bg-primary/30 px-2 py-0.5 text-[10px] text-foreground hover:bg-primary/50"
        >
          {picking ? "Cancel" : "+ Apply"}
        </button>
      </div>

      {picking && (
        <div className="mb-2 max-h-48 overflow-auto rounded border border-border bg-panel">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => addAction(p)}
              className="block w-full border-b border-border px-2 py-1.5 text-left text-[11px] hover:bg-panel-2"
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate text-foreground">{p.name}</span>
                <span className="text-[10px] text-muted-foreground">{p.category}</span>
              </div>
            </button>
          ))}
          {presets.length === 0 && (
            <div className="p-2 text-[11px] text-muted-foreground">No presets.</div>
          )}
        </div>
      )}

      <ul className="space-y-1.5">
        {actions.map((a) => {
          const preset = presetMap.get(a.presetId);
          return (
            <li key={a.id} className="rounded border border-border bg-panel p-2">
              <div className="mb-1 flex items-center gap-2">
                <span className="flex-1 truncate text-foreground">
                  {preset?.name ?? "Unknown preset"}
                </span>
                <span className="text-[10px] text-muted-foreground">{preset?.category}</span>
                <button onClick={() => removeAction(a.id)} className="text-[10px] text-destructive">
                  ✕
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1 text-[10px]">
                <label>
                  <span className="block text-muted-foreground">Offset</span>
                  <input
                    type="number"
                    step={0.1}
                    value={a.offset}
                    onChange={(e) => updateAction(a.id, { offset: Number(e.target.value) })}
                    className="w-full rounded border border-border bg-input px-1"
                  />
                </label>
                <label>
                  <span className="block text-muted-foreground">Duration</span>
                  <input
                    type="number"
                    step={0.1}
                    value={a.duration ?? preset?.duration ?? 1}
                    onChange={(e) => updateAction(a.id, { duration: Number(e.target.value) })}
                    className="w-full rounded border border-border bg-input px-1"
                  />
                </label>
                <label>
                  <span className="block text-muted-foreground">Intensity</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={a.intensity}
                    onChange={(e) => updateAction(a.id, { intensity: Number(e.target.value) })}
                    className="w-full"
                  />
                </label>
              </div>
            </li>
          );
        })}
        {actions.length === 0 && (
          <li className="rounded border border-dashed border-border p-2 text-center text-[11px] text-muted-foreground">
            No actions applied. Click + Apply to add an expression, gesture or camera move.
          </li>
        )}
      </ul>
    </div>
  );
}
