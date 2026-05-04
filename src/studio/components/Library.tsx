// Library panel — Media, Characters (with editor), Motion Presets, Blocks (later).
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "@tanstack/react-router";
import { db, deleteMediaIfUnused, importMediaFile, mediaIdsForCharacter, uid } from "../db";
import { useStudio } from "../store";
import type { CharacterClip, CharacterPart, CharacterPreset, MediaAsset } from "../types";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMediaUrl } from "../hooks/useMediaUrl";
import {
  createBlankCharacter,
  listCharacterSlots,
  pickActivePartForSlot,
  roleEnabledByManifest,
} from "../character/character-utils";
import { ensureStarterCharacterSeeded } from "../character/starter";
import { ensureMotionPresetsSeeded } from "../presets/seed";

const TABS = [
  { id: "media", label: "Media" },
  { id: "characters", label: "Characters" },
  { id: "presets", label: "Motion presets" },
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
  const clips = useStudio((s) => s.clips);
  const tracks = useStudio((s) => s.tracks);
  const playhead = useStudio((s) => s.playhead);
  const addClip = useStudio((s) => s.addClip);
  const characters =
    useLiveQuery(() => db.characters.orderBy("updatedAt").reverse().toArray(), []) ?? [];

  useEffect(() => {
    void ensureStarterCharacterSeeded();
  }, []);

  const newCharacter = async () => {
    const c = createBlankCharacter();
    await db.characters.put(c);
    // Open editor in a new tab so the studio state isn't lost.
    window.open(`/character/${c.id}`, "_blank");
  };

  const placeOnTimeline = (
    characterId: string,
    name: string,
    canvasWidth = 600,
    canvasHeight = 900,
  ) => {
    if (!project) return;
    const trackIndex = Math.max(
      0,
      tracks.findIndex((t) => t.kind === "character"),
    );
    const aspect = canvasWidth / Math.max(1, canvasHeight);
    const maxW = Math.round(project.hf.width * 0.42);
    const maxH = Math.round(project.hf.height * 0.68);
    let h = maxH;
    let w = Math.round(h * aspect);
    if (w > maxW) {
      w = maxW;
      h = Math.round(w / Math.max(0.1, aspect));
    }
    const clip: CharacterClip = {
      id: uid(),
      kind: "character",
      characterId,
      name,
      trackIndex,
      start: playhead,
      duration: 4,
      x: Math.round((project.hf.width - w) / 2),
      y: Math.round((project.hf.height - h) / 2),
      width: w,
      height: h,
      rotation: 0,
      opacity: 1,
      zIndex: clips.length,
      poses: {},
      autoBlink: true,
    };
    addClip(clip);
  };

  const placePlaceholder = () => placeOnTimeline("stub", "Voice Character");

  const deleteCharacter = async (id: string) => {
    if (!confirm("Delete this character? Clips referencing it will keep playing as placeholders."))
      return;
    const character = await db.characters.get(id);
    const mediaIds = Array.from(mediaIdsForCharacter(character));
    await db.characters.delete(id);
    await Promise.all(
      mediaIds.map((mediaId) =>
        deleteMediaIfUnused(mediaId, {
          internalOnly: true,
          extraProjects: project ? [project] : undefined,
        }),
      ),
    );
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
          No characters yet. Click "+ New character" to upload parts (head, mouth shapes, eyes,
          body, arms, legs), align them on the canvas, and save a reusable rig.
        </div>
      )}

      <ul className="space-y-2">
        {characters.map((c) => (
          <li key={c.id} className="rounded border border-border bg-panel-2 p-2">
            <div className="mb-2 flex gap-2">
              <CharacterThumbnail character={c} />
              <div className="min-w-0 flex-1">
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
                <div className="text-[10px] text-muted-foreground">
                  {c.parts.length} part{c.parts.length !== 1 ? "s" : ""} · {c.canvasWidth}×
                  {c.canvasHeight}
                  {c.parallaxEnabled ? " · parallax" : ""}
                </div>
              </div>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => placeOnTimeline(c.id, c.name, c.canvasWidth, c.canvasHeight)}
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

function CharacterThumbnail({ character }: { character: CharacterPreset }) {
  const slots = useMemo(
    () =>
      listCharacterSlots(character.parts).filter((slot) =>
        roleEnabledByManifest(slot.role, character.manifest),
      ),
    [character.parts, character.manifest],
  );
  const previewParts = useMemo(
    () =>
      slots
        .map((slot) =>
          pickActivePartForSlot(slot, {
            pose: slot.role === "head" || slot.role === "body" ? "front" : undefined,
            viseme: slot.role === "mouth" ? "rest" : undefined,
            eyeState: slot.role === "eye" ? "open" : undefined,
          }),
        )
        .filter((part): part is CharacterPart => Boolean(part))
        .sort((a, b) => a.zIndex - b.zIndex),
    [slots],
  );
  const boxWidth = 56;
  const boxHeight = 72;
  const scale = Math.min(boxWidth / character.canvasWidth, boxHeight / character.canvasHeight);

  return (
    <div className="flex h-[72px] w-[56px] shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-stage-bg">
      <div
        className="relative origin-center"
        style={{
          width: character.canvasWidth,
          height: character.canvasHeight,
          transform: `scale(${scale})`,
        }}
      >
        {previewParts.map((part) => (
          <CharacterThumbnailPart key={part.id} part={part} />
        ))}
      </div>
    </div>
  );
}

function CharacterThumbnailPart({ part }: { part: CharacterPart }) {
  const url = useMediaUrl(part.mediaId);
  if (!url) return null;
  return (
    <img
      src={url}
      alt={part.name}
      draggable={false}
      className="absolute h-full w-full object-contain"
      style={{
        left: part.x,
        top: part.y,
        width: part.width,
        height: part.height,
        zIndex: part.zIndex,
        transform: `rotate(${part.rotation}deg)`,
        transformOrigin: `${part.anchorX * 100}% ${part.anchorY * 100}%`,
        pointerEvents: "none",
      }}
    />
  );
}

function PresetsTab() {
  useEffect(() => {
    void ensureMotionPresetsSeeded();
  }, []);
  const presets = useLiveQuery(() => db.motionPresets.orderBy("category").toArray(), []) ?? [];

  const grouped = new Map<string, typeof presets>();
  for (const p of presets) {
    const arr = grouped.get(p.category) ?? [];
    arr.push(p);
    grouped.set(p.category, arr);
  }

  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="rounded border border-border bg-panel-2 p-2 text-muted-foreground">
        Apply these to a character clip from the Inspector. Built-ins cover expressions
        ("Surprised", "Happy"), gestures ("Wave", "Nod"), full-body ("Idle bob", "Jump") and camera
        moves.
      </div>
      <Link
        to="/presets"
        className="block w-full rounded border border-border bg-panel-2 px-2 py-1.5 text-center hover:bg-panel"
      >
        Browse all motion presets →
      </Link>
      {Array.from(grouped.entries()).map(([cat, items]) => (
        <div key={cat}>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            {cat}
          </div>
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
  const allItems = useLiveQuery(() => db.media.orderBy("createdAt").reverse().toArray(), []) ?? [];
  const characters = useLiveQuery(() => db.characters.toArray(), []);
  const project = useStudio((s) => s.project);
  const clips = useStudio((s) => s.clips);
  const inputRef = useRef<HTMLInputElement>(null);
  const addMedia = useStudio((s) => s.addMediaToTimeline);

  const internalMediaIds = useMemo(() => {
    const ids = new Set<string>();
    for (const character of characters ?? []) {
      for (const part of character.parts) ids.add(part.mediaId);
      for (const variant of character.headVariants ?? []) ids.add(variant.mediaId);
    }
    for (const clip of clips) {
      if (clip.kind === "character" && clip.lipSyncAudioId) ids.add(clip.lipSyncAudioId);
    }
    return ids;
  }, [characters, clips]);

  const items = allItems.filter(
    (asset) => (asset.scope ?? "library") === "library" && !internalMediaIds.has(asset.id),
  );

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      try {
        await importMediaFile(f);
      } catch (e) {
        console.error(e);
      }
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
          <MediaTile
            key={m.id}
            asset={m}
            onAdd={() => addMedia(m)}
            onDelete={async () => {
              const result = await deleteMediaIfUnused(m.id, {
                extraProjects: project ? [project] : undefined,
              });
              if (result.deleted) return;
              if (result.usages.length === 0) return;
              const usageList = result.usages
                .slice(0, 5)
                .map((usage) => `${usage.ownerName}${usage.detail ? ` — ${usage.detail}` : ""}`)
                .join("\n");
              alert(
                `This media is still being used and was not deleted.\n\nRemove it from these places first:\n${usageList}`,
              );
            }}
          />
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

function MediaTile({
  asset,
  onAdd,
  onDelete,
}: {
  asset: MediaAsset;
  onAdd: () => void;
  onDelete: () => void | Promise<void>;
}) {
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
          {asset.kind === "audio" && <span className="text-2xl">🎵</span>}
        </div>
        <div className="px-2 py-1.5 text-left">
          <div className="truncate text-[11px] font-medium text-foreground">{asset.name}</div>
          <div className="text-[10px] text-muted-foreground">{asset.kind}</div>
        </div>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          void onDelete();
        }}
        className="absolute right-1 top-1 hidden rounded bg-black/60 px-1.5 text-[10px] text-foreground hover:bg-destructive group-hover:block"
        title="Delete"
      >
        ✕
      </button>
    </div>
  );
}
