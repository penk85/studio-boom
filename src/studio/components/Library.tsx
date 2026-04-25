// Library panel — Media, Characters (with editor), Action Presets, Blocks (later).
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "@tanstack/react-router";
import { db, deleteMedia, importMediaFile, uid } from "../db";
import { useStudio } from "../store";
import type { CharacterClip, MediaAsset } from "../types";
import { useEffect, useRef, useState } from "react";
import { useMediaUrl } from "../hooks/useMediaUrl";
import { createBlankCharacter } from "../character/character-utils";
import { ensurePresetsSeeded } from "../presets/seed";

const TABS = [
  { id: "media", label: "Media" },
  { id: "characters", label: "Characters" },
  { id: "presets", label: "Actions" },
  { id: "blocks", label: "Blocks" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function Library() {
  const [tab, setTab] = useState<TabId>("media");
  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 px-2 py-2 text-xs font-medium ${
              tab === t.id
                ? "border-b-2 border-primary bg-panel-2 text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "media" && <MediaTab />}
        {tab === "characters" && <CharactersTab />}
        {tab === "presets" && <PresetsTab />}
        {tab === "blocks" && (
          <ComingSoon
            what="Hyperframes blocks"
            desc="Drop-in titles, lower-thirds, and transitions from the Hyperframes catalog."
          />
        )}
      </div>
    </div>
  );
}

function CharactersTab() {
  const project = useStudio((s) => s.project);
  const playhead = useStudio((s) => s.playhead);
  const addClip = useStudio((s) => s.addClip);
  const characters = useLiveQuery(() => db.characters.orderBy("updatedAt").reverse().toArray(), []) ?? [];

  const newCharacter = async () => {
    const c = createBlankCharacter();
    await db.characters.put(c);
    // Open editor in a new tab so the studio state isn't lost.
    window.open(`/character/${c.id}`, "_blank");
  };

  const placeOnTimeline = (characterId: string, name: string) => {
    if (!project) return;
    const trackIndex = Math.max(0, project.tracks.findIndex((t) => t.kind === "character"));
    const w = Math.round(project.width * 0.3);
    const h = Math.round(project.height * 0.6);
    const clip: CharacterClip = {
      id: uid(),
      kind: "character",
      characterId,
      name,
      trackIndex,
      start: playhead,
      duration: 4,
      x: Math.round((project.width - w) / 2),
      y: Math.round((project.height - h) / 2),
      width: w,
      height: h,
      rotation: 0,
      opacity: 1,
      zIndex: project.clips.length,
      poses: {},
    };
    addClip(clip);
  };

  const placePlaceholder = () => placeOnTimeline("stub", "Voice Character");

  const deleteCharacter = async (id: string) => {
    if (!confirm("Delete this character? Clips referencing it will keep playing as placeholders.")) return;
    await db.characters.delete(id);
  };

  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="flex gap-2">
        <button
          onClick={newCharacter}
          className="flex-1 rounded bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90"
        >
          + New character
        </button>
        <button
          onClick={placePlaceholder}
          disabled={!project}
          title="Drop a stub character clip on the timeline"
          className="rounded border border-border px-2 py-2 text-[11px] text-foreground hover:bg-panel-2 disabled:opacity-50"
        >
          Stub
        </button>
      </div>

      {characters.length === 0 && (
        <div className="rounded border border-dashed border-border bg-panel-2 p-3 text-muted-foreground">
          No characters yet. Click "+ New character" to upload parts (head, mouth shapes, eyes, body, arms, legs), align them on the canvas, and save a reusable rig.
        </div>
      )}

      <ul className="space-y-2">
        {characters.map((c) => (
          <li key={c.id} className="rounded border border-border bg-panel-2 p-2">
            <div className="mb-1 flex items-center gap-2">
              <span className="flex-1 truncate font-medium text-foreground">{c.name}</span>
              <button
                onClick={() => deleteCharacter(c.id)}
                className="text-[10px] text-destructive"
                title="Delete character"
              >
                ✕
              </button>
            </div>
            <div className="mb-2 text-[10px] text-muted-foreground">
              {c.parts.length} part{c.parts.length !== 1 ? "s" : ""} · {c.canvasWidth}×{c.canvasHeight}{c.parallaxEnabled ? " · parallax" : ""}
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => placeOnTimeline(c.id, c.name)}
                disabled={!project}
                className="flex-1 rounded bg-primary/30 px-2 py-1 text-[11px] hover:bg-primary/50 disabled:opacity-50"
              >
                Add to scene
              </button>
              <Link
                to="/character/$id"
                params={{ id: c.id }}
                className="rounded border border-border px-2 py-1 text-[11px] hover:bg-panel"
              >
                Edit
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PresetsTab() {
  useEffect(() => { void ensurePresetsSeeded(); }, []);
  const presets = useLiveQuery(() => db.movements.orderBy("category").toArray(), []) ?? [];

  const grouped = new Map<string, typeof presets>();
  for (const p of presets) {
    const arr = grouped.get(p.category) ?? [];
    arr.push(p);
    grouped.set(p.category, arr);
  }

  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="rounded border border-border bg-panel-2 p-2 text-muted-foreground">
        Apply these to a character clip from the Inspector. Built-ins cover expressions ("Surprised", "Happy"), gestures ("Wave", "Nod"), full-body ("Idle bob", "Jump") and camera moves.
      </div>
      <Link
        to="/presets"
        className="block w-full rounded border border-border bg-panel-2 px-2 py-1.5 text-center hover:bg-panel"
      >
        Browse all presets →
      </Link>
      {Array.from(grouped.entries()).map(([cat, items]) => (
        <div key={cat}>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{cat}</div>
          <ul className="space-y-1">
            {items.map((p) => (
              <li key={p.id} className="rounded border border-border bg-panel-2 px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-foreground">{p.name}</span>
                  <span className="text-[10px] text-muted-foreground">{p.duration}s</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ComingSoon({ what, desc }: { what: string; desc: string }) {
  return (
    <div className="p-4 text-xs text-muted-foreground">
      <div className="mb-1 font-medium text-foreground">{what} — coming next</div>
      <p>{desc}</p>
    </div>
  );
}

function MediaTab() {
  const items = useLiveQuery(() => db.media.orderBy("createdAt").reverse().toArray(), []) ?? [];
  const inputRef = useRef<HTMLInputElement>(null);
  const addMedia = useStudio((s) => s.addMediaToTimeline);

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      try { await importMediaFile(f); } catch (e) { console.error(e); }
    }
  };

  return (
    <div className="p-3">
      <button
        onClick={() => inputRef.current?.click()}
        className="mb-3 w-full rounded-md border border-dashed border-border bg-panel-2 py-3 text-xs text-muted-foreground hover:border-primary hover:text-foreground"
      >
        + Upload images, audio, or video
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,audio/*,video/*"
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />
      <div className="grid grid-cols-2 gap-2">
        {items.map((m) => (
          <MediaTile key={m.id} asset={m} onAdd={() => addMedia(m)} onDelete={() => deleteMedia(m.id)} />
        ))}
        {items.length === 0 && (
          <div className="col-span-2 text-center text-xs text-muted-foreground">
            No media yet. Upload to start building.
          </div>
        )}
      </div>
    </div>
  );
}

function MediaTile({ asset, onAdd, onDelete }: { asset: MediaAsset; onAdd: () => void; onDelete: () => void }) {
  const url = useMediaUrl(asset.id);
  return (
    <div className="group relative overflow-hidden rounded-md border border-border bg-panel-2">
      <button onClick={onAdd} className="block w-full" title="Add to timeline">
        <div className="flex aspect-video items-center justify-center bg-stage-bg">
          {asset.kind === "image" && url && (
            <img src={url} alt={asset.name} className="h-full w-full object-cover" />
          )}
          {asset.kind === "video" && url && (
            <video src={url} className="h-full w-full object-cover" muted />
          )}
          {asset.kind === "audio" && (
            <span className="text-2xl">🎵</span>
          )}
        </div>
        <div className="px-2 py-1.5 text-left">
          <div className="truncate text-[11px] font-medium text-foreground">{asset.name}</div>
          <div className="text-[10px] text-muted-foreground">{asset.kind}</div>
        </div>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="absolute right-1 top-1 hidden rounded bg-black/60 px-1.5 text-[10px] text-foreground hover:bg-destructive group-hover:block"
        title="Delete"
      >
        ✕
      </button>
    </div>
  );
}
