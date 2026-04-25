import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/studio/db";
import { ensurePresetsSeeded } from "@/studio/presets/seed";
import type { ActionCategory } from "@/studio/types";

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
  useEffect(() => {
    setMounted(true);
    void ensurePresetsSeeded();
  }, []);
  const presets = useLiveQuery(() => db.movements.orderBy("createdAt").toArray(), []) ?? [];
  if (!mounted) return null;
  const filtered = cat === "all" ? presets : presets.filter((p) => p.category === cat);

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <header className="mb-6 flex items-center gap-3">
        <Link to="/" className="rounded border border-border px-2 py-1 text-xs hover:bg-panel-2">← Studio</Link>
        <h1 className="text-2xl font-semibold">Action Presets</h1>
        <p className="ml-3 text-xs text-muted-foreground">Reusable expressions, gestures, full-body and camera moves. Apply to any character clip.</p>
      </header>

      <div className="mb-4 flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setCat(c.id)}
            className={`rounded-full border px-3 py-1 text-xs ${
              cat === c.id ? "border-primary bg-primary/20 text-foreground" : "border-border text-muted-foreground hover:text-foreground"
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
              <span className="font-medium">{p.name}</span>
              {p.builtin && <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase text-secondary-foreground">built-in</span>}
            </div>
            <div className="text-[11px] text-muted-foreground">{p.category} · {p.duration}s · {p.tracks.length} track{p.tracks.length !== 1 ? "s" : ""}{p.loop ? " · loops" : ""}</div>
            {p.description && <p className="mt-2 text-[11px] text-muted-foreground">{p.description}</p>}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full rounded border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No presets in this category yet.
          </div>
        )}
      </div>
      <p className="mt-6 text-[11px] text-muted-foreground">
        Authoring custom presets in the visual editor is coming next. For now, built-ins cover most expressions and gestures, and you can apply multiple presets per clip from the Inspector.
      </p>
    </main>
  );
}
