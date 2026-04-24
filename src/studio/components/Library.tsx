// Library panel — tabs for media (backgrounds/images, audio, video) + characters/movements (placeholders for later phases).
// Drag/click adds items to the timeline at the playhead.
import { useLiveQuery } from "dexie-react-hooks";
import { db, deleteMedia, importMediaFile } from "../db";
import { useStudio } from "../store";
import type { MediaAsset } from "../types";
import { useRef, useState } from "react";
import { useMediaUrl } from "../hooks/useMediaUrl";

const TABS = [
  { id: "media", label: "Media" },
  { id: "characters", label: "Characters" },
  { id: "movements", label: "Movements" },
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
        {tab === "characters" && <ComingSoon what="Characters" desc="Build reusable puppet rigs with mouth shapes, eyes, body, and limbs." />}
        {tab === "movements" && <ComingSoon what="Movement presets" desc="Author reusable animations and drop them onto any character." />}
        {tab === "blocks" && <ComingSoon what="Hyperframes blocks" desc="Drop-in titles, lower-thirds, and transitions from the Hyperframes catalog." />}
      </div>
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
