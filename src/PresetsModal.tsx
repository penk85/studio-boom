import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/studio/db";
import { ACTION_CATEGORY_TABS } from "@/studio/presets/action-terminology";
import { ensureMotionPresetsSeeded } from "@/studio/presets/seed";
import { MotionPresetRecorder } from "@/studio/presets/MotionPresetRecorder";
import type { CharacterPreset, MotionCategory, MotionPreset } from "@/studio/types";

export function PresetsModal({ onClose }: { onClose: () => void }) {
  const [cat, setCat] = useState<MotionCategory | "all">("all");
  const [selectedCharId, setSelectedCharId] = useState<string>("");
  const [recorder, setRecorder] = useState<{
    character: CharacterPreset;
    preset?: MotionPreset;
  } | null>(null);

  useEffect(() => {
    void ensureMotionPresetsSeeded();
  }, []);

  const presets = useLiveQuery(() => db.motionPresets.orderBy("createdAt").toArray(), []) ?? [];
  const queriedCharacters = useLiveQuery(() => db.characters.orderBy("name").toArray(), []);
  const characters = useMemo(() => queriedCharacters ?? [], [queriedCharacters]);

  useEffect(() => {
    if (!selectedCharId && characters.length > 0) {
      setSelectedCharId(characters[0].id);
    }
  }, [characters, selectedCharId]);

  const filtered = cat === "all" ? presets : presets.filter((p) => p.category === cat);
  const selectedChar = characters.find((c) => c.id === selectedCharId);

  const openRecorder = (preset?: MotionPreset) => {
    if (!selectedChar) return;
    setRecorder({ character: selectedChar, preset });
  };

  if (recorder) {
    return (
      <div className="fixed inset-0 z-50 bg-background">
        <MotionPresetRecorder
          character={recorder.character}
          initialPreset={recorder.preset}
          onClose={() => setRecorder(null)}
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-background overflow-auto">
      <main className="min-h-screen p-6 text-foreground">
        <header className="mb-6 flex items-center gap-3 flex-wrap">
          <button
            onClick={onClose}
            className="rounded border border-border px-2 py-1 text-xs hover:bg-panel-2"
          >
            ← Studio
          </button>
          <h1 className="text-2xl font-semibold">Actions &amp; Expressions</h1>
          <p className="ml-3 text-xs text-muted-foreground">
            Reusable actions, expressions, head turns, and camera cues.
          </p>
          <div className="ml-auto flex items-center gap-2">
            {characters.length > 0 ? (
              <select
                value={selectedCharId}
                onChange={(e) => setSelectedCharId(e.target.value)}
                className="rounded border border-border bg-input px-2 py-1 text-xs"
              >
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs text-muted-foreground">No characters yet</span>
            )}
            <button
              onClick={() => openRecorder()}
              disabled={!selectedChar}
              className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              + New action
            </button>
          </div>
        </header>

        <div className="mb-4 flex flex-wrap gap-2">
          {ACTION_CATEGORY_TABS.map((c) => (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              className={`rounded-full border px-3 py-1 text-xs ${
                cat === c.id
                  ? "border-primary bg-primary/20 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {filtered.map((p) => (
            <div key={p.id} className="rounded-lg border border-border bg-panel p-3">
              <div className="mb-1 flex items-center gap-2">
                <span className="flex-1 font-medium">{p.name}</span>
                {p.builtin && (
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-ui-sm uppercase text-secondary-foreground">
                    built-in
                  </span>
                )}
                <button
                  onClick={() => openRecorder(p)}
                  disabled={!selectedChar}
                  className="text-ui-sm text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  {p.builtin ? "Customize" : "Edit"}
                </button>
              </div>
              <div className="text-ui-sm text-muted-foreground">
                {p.category} · {p.duration}s{p.loop ? " · loops" : ""}
              </div>
              {p.description && (
                <p className="mt-2 text-ui-sm text-muted-foreground">{p.description}</p>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full rounded border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No actions in this category yet.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
