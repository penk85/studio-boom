import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/studio/db";
import { ensurePresetsSeeded } from "@/studio/presets/seed";
import { PresetRecorder } from "@/studio/presets/PresetRecorder";
import type { ActionCategory, ActionPreset, CharacterPreset } from "@/studio/types";

export const Route = createFileRoute("/presets")({
  head: () => ({
    meta: [
      { title: "Action Presets — Hyperframes Studio" },
      { name: "description", content: "Reusable expressions, gestures, and camera moves." },
    ],
  }),
  component: PresetsRoute,
});

const CATEGORIES: { id: ActionCategory | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "expression", label: "Expressions" },
  { id: "gesture", label: "Gestures" },
  { id: "full-body", label: "Full body" },
  { id: "camera", label: "Camera" },
  { id: "custom", label: "Custom" },
];

function PresetsRoute() {
  const [mounted, setMounted] = useState(false);
  const [cat, setCat] = useState<ActionCategory | "all">("all");
  const [selectedCharId, setSelectedCharId] = useState<string>("");
  const [recorder, setRecorder] = useState<{ character: CharacterPreset; preset?: ActionPreset } | null>(null);

  useEffect(() => {
    setMounted(true);
    void ensurePresetsSeeded();
  }, []);

  const presets = useLiveQuery(() => db.movements.orderBy("createdAt").toArray(), []) ?? [];
  const characters = useLiveQuery(() => db.characters.orderBy("name").toArray(), []) ?? [];

  // Auto-select first character
  useEffect(() => {
    if (!selectedCharId && characters.length > 0) {
      setSelectedCharId(characters[0].id);
    }
  }, [characters, selectedCharId]);

  if (!mounted) return null;

  const filtered = cat === "all" ? presets : presets.filter((p) => p.category === cat);
  const selectedChar = characters.find((c) => c.id === selectedCharId);

  const openRecorder = (preset?: ActionPreset) => {
    if (!selectedChar) return;
    setRecorder({ character: selectedChar, preset });
  };

  if (recorder) {
    return (
      <PresetRecorder
        character={recorder.character}
        initialPreset={recorder.preset}
        onClose={() => setRecorder(null)}
      />
    );
  }

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <header className="mb-6 flex items-center gap-3 flex-wrap">
        <Link to="/" className="rounded border border-border px-2 py-1 text-xs hover:bg-panel-2">
          ← Studio
        </Link>
        <h1 className="text-2xl font-semibold">Action Presets</h1>
        <p className="ml-3 text-xs text-muted-foreground">
          Reusable expressions, gestures, full-body and camera moves.
        </p>
        <div className="ml-auto flex items-center gap-2">
          {characters.length > 0 ? (
            <select
              value={selectedCharId}
              onChange={(e) => setSelectedCharId(e.target.value)}
              className="rounded border border-border bg-input px-2 py-1 text-xs"
            >
              {characters.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
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
            + New preset
          </button>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
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
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase text-secondary-foreground">
                  built-in
                </span>
              )}
              {!p.builtin && (
                <button
                  onClick={() => openRecorder(p)}
                  disabled={!selectedChar}
                  className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  Edit
                </button>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {p.category} · {p.duration}s
              {p.loop ? " · loops" : ""}
            </div>
            {p.description && (
              <p className="mt-2 text-[11px] text-muted-foreground">{p.description}</p>
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full rounded border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No presets in this category yet.
          </div>
        )}
      </div>
    </main>
  );
}
