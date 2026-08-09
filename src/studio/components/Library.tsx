// Library panel — Media, Text, Characters (with editor), and Actions.
import { useLiveQuery } from "dexie-react-hooks";
import { db, deleteMediaIfUnused, importMediaFile, uid } from "../db";
import { useStudio } from "../store";
import type { CharacterPreset, MediaAsset, TextClip } from "../types";
import { deriveEditorClips, isCharacterCompositionClip } from "../types";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMediaUrl } from "../hooks/useMediaUrl";
import { buildSceneEditingProject } from "../scenes";
import {
  createBlankCharacter,
  roleEnabledByManifest,
  variantKeyForPart,
} from "../character/character-utils";
import { deleteCharacterRecord, saveCharacter } from "../character/character-persistence";
import {
  thumbnailFrameMatrix,
  thumbnailBoundsForFrames,
  type CharacterThumbnailFrame,
} from "./character-thumbnail-bounds";
import { matrixToCss } from "../character/geometry";
import {
  createPresetCharacter,
  ensureStarterCharacterSeeded,
  STARTER_CHARACTER_ID,
} from "../character/starter";
import type { PresenterVariant } from "../character/presenter";
import { defaultPoseForCharacter } from "../character/pose-presets";
import { ensureMotionPresetsSeeded } from "../presets/seed";
import { useConfirm, useNotify } from "./ConfirmDialog";
import { TEXT_BLOCKS, writeLibraryDragItem } from "../library-items";
import {
  buildCharacterRuntime,
  resolveRuntimeSlotPart,
  runtimePartPlacement,
} from "../character/runtime";

const TABS = [
  { id: "media", label: "Media" },
  { id: "text", label: "Text" },
  { id: "characters", label: "Characters" },
  { id: "presets", label: "Actions" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function Library() {
  const [tab, setTab] = useState<TabId>("media");
  // Keep the store's media cache in sync with Dexie regardless of which tab is open. Characters
  // (and their part blobs) are seeded/edited from the Characters tab; without this, those blobs
  // would only reach the store after visiting the Media tab, so the stage couldn't resolve their
  // `asset:` refs when the character is placed.
  const syncMediaAssets = useStudio((s) => s.syncMediaAssets);
  const allMedia = useLiveQuery(() => db.media.toArray(), []);
  useEffect(() => {
    if (allMedia) syncMediaAssets(allMedia);
  }, [allMedia, syncMediaAssets]);
  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="border-b border-border bg-panel p-2">
        <div className="grid grid-cols-2 gap-1 rounded-md bg-panel-2 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`min-w-0 rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                tab === t.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-panel hover:text-foreground"
              }`}
            >
              <span className="block truncate">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "media" && <MediaTab />}
        {tab === "text" && <TextTab />}
        {tab === "characters" && <CharactersTab />}
        {tab === "presets" && <PresetsTab />}
      </div>
    </div>
  );
}

function TextTab() {
  const addLibraryItem = useStudio((s) => s.addLibraryItem);
  const project = useStudio((s) => s.project);

  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="grid grid-cols-1 gap-2">
        {TEXT_BLOCKS.map((block) => (
          <button
            key={block.id}
            type="button"
            draggable
            onDragStart={(event) =>
              writeLibraryDragItem(event.dataTransfer, { kind: "text", presetId: block.id })
            }
            onClick={() => void addLibraryItem({ kind: "text", presetId: block.id })}
            disabled={!project}
            className="cursor-grab rounded border border-border bg-panel-2 p-3 text-left hover:border-primary hover:bg-panel active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
          >
            <div className="font-medium text-foreground">{block.label}</div>
            <div className="mt-1 truncate text-ui-sm text-muted-foreground">{block.content}</div>
          </button>
        ))}
      </div>
      <div className="rounded border border-border bg-panel-2 p-2 text-ui-sm leading-relaxed text-muted-foreground">
        Drag onto the canvas to place it, or onto the timeline to set when it appears. Clicking adds
        it at the start.
      </div>
    </div>
  );
}

function CharactersTab() {
  const rootProject = useStudio((s) => s.project);
  const activeSceneId = useStudio((s) => s.activeSceneId);
  const project = useMemo(
    () => (rootProject ? buildSceneEditingProject(rootProject, activeSceneId) : null),
    [activeSceneId, rootProject],
  );
  const clips = useMemo(() => (project ? deriveEditorClips(project) : []), [project]);
  const addLibraryItem = useStudio((s) => s.addLibraryItem);
  const registerCharacterPreset = useStudio((s) => s.registerCharacterPreset);
  const unregisterCharacterPreset = useStudio((s) => s.unregisterCharacterPreset);
  const syncCharacterPresets = useStudio((s) => s.syncCharacterPresets);
  const queriedCharacters = useLiveQuery(
    () => db.characters.orderBy("updatedAt").reverse().toArray(),
    [],
  );
  const characters = useMemo(() => queriedCharacters ?? [], [queriedCharacters]);

  useEffect(() => {
    void ensureStarterCharacterSeeded();
  }, []);

  useEffect(() => {
    if (!queriedCharacters) return;
    syncCharacterPresets(characters);
  }, [characters, queriedCharacters, syncCharacterPresets]);

  const openModal = useStudio((s) => s.openModal);
  const confirm = useConfirm();
  const [addOpen, setAddOpen] = useState(false);
  const [placingStarter, setPlacingStarter] = useState(false);
  const [characterActionError, setCharacterActionError] = useState<string | null>(null);

  const newCharacter = async () => {
    const c = createBlankCharacter();
    const saved = await saveCharacter(c);
    registerCharacterPreset(saved);
    openModal({ type: "character-editor", characterId: c.id });
  };

  const [generatingPreset, setGeneratingPreset] = useState<PresenterVariant | null>(null);
  const newPresetCharacter = async (variant: PresenterVariant) => {
    if (generatingPreset) return;
    setGeneratingPreset(variant);
    try {
      const c = await createPresetCharacter(variant);
      registerCharacterPreset(c);
      openModal({ type: "character-editor", characterId: c.id });
    } catch (err) {
      console.error("Failed to generate preset character", err);
    } finally {
      setGeneratingPreset(null);
    }
  };

  const placeOnTimeline = async (character: CharacterPreset) => {
    if (!project) return;
    setCharacterActionError(null);
    try {
      registerCharacterPreset(character);
      await addLibraryItem({ kind: "character", characterId: character.id });
    } catch (error) {
      setCharacterActionError(error instanceof Error ? error.message : String(error));
    }
  };

  const placeStarterCharacter = async () => {
    if (!project || placingStarter) return;
    setPlacingStarter(true);
    setCharacterActionError(null);
    try {
      const starter =
        characters.find((character) => character.id === STARTER_CHARACTER_ID) ??
        (await ensureStarterCharacterSeeded());
      await placeOnTimeline(starter);
    } catch (error) {
      setCharacterActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPlacingStarter(false);
    }
  };

  const deleteCharacter = async (id: string) => {
    const references = clips.filter(
      (clip) => isCharacterCompositionClip(clip) && clip.character.characterId === id,
    );
    const usageLines =
      references.length > 0
        ? [
            `This character is used by ${references.length} timeline clip${
              references.length === 1 ? "" : "s"
            }: ${references
              .slice(0, 5)
              .map((clip) => clip.name || clip.id)
              .join(", ")}${references.length > 5 ? `, and ${references.length - 5} more` : ""}.`,
            "Those clips keep the artwork they already have, but they can no longer be refreshed from this character.",
          ]
        : ["This removes the reusable character from your library."];
    const confirmed = await confirm({
      title: "Delete this character?",
      body: usageLines,
      confirmLabel: "Delete character",
      destructive: true,
    });
    if (!confirmed) return;
    const mediaIds = Array.from(await deleteCharacterRecord(id));
    unregisterCharacterPreset(id);
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
      {/* One primary action. Three peer buttons ("New character" / "Starter" /
          "Generate preset: male|female") gave a newcomer no way to tell which one
          to press first, so the choices now live inside the one thing you click. */}
      <button
        type="button"
        onClick={() => setAddOpen((open) => !open)}
        aria-expanded={addOpen}
        className="w-full rounded bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90"
      >
        + Add a character
      </button>

      {addOpen && (
        <div className="space-y-1 rounded border border-border bg-panel-2 p-2">
          <AddCharacterChoice
            title="Use the ready-made presenter"
            detail="Fastest way to see something on the canvas."
            busy={placingStarter}
            disabled={!project}
            onClick={() => void placeStarterCharacter().then(() => setAddOpen(false))}
          />
          {(["male", "female"] as const).map((variant) => (
            <AddCharacterChoice
              key={variant}
              title={`Build a ${variant} presenter`}
              detail="Generates a rigged character you can restyle."
              busy={generatingPreset === variant}
              disabled={!!generatingPreset}
              onClick={() => void newPresetCharacter(variant)}
            />
          ))}
          <AddCharacterChoice
            title="Start from my own artwork"
            detail="Upload head, body, arms, and mouth shapes, then align them."
            onClick={() => void newCharacter()}
          />
        </div>
      )}

      {characterActionError && (
        <div
          role="alert"
          className="rounded border border-destructive/40 bg-destructive/10 p-2 text-ui-sm text-destructive"
        >
          Could not add the character: {characterActionError}
        </div>
      )}

      {characters.length === 0 && !addOpen && (
        <div className="rounded border border-dashed border-border bg-panel-2 p-3 text-muted-foreground">
          No characters yet. "Add a character" starts you with a ready-made presenter or your own
          artwork.
        </div>
      )}

      <ul className="space-y-2">
        {characters.map((c) => (
          <li key={c.id} className="rounded border border-border bg-panel-2 p-2">
            <div className="mb-2 flex gap-3">
              <CharacterThumbnail character={c} />
              <div className="min-w-0 flex-1 py-1">
                <div className="mb-1 flex items-center gap-2">
                  <span className="flex-1 truncate font-medium text-foreground">{c.name}</span>
                  <button
                    onClick={() => deleteCharacter(c.id)}
                    className="text-ui-sm text-destructive"
                    title="Delete character"
                  >
                    ✕
                  </button>
                </div>
                <div className="text-ui-sm text-muted-foreground">
                  {c.parts.length} part{c.parts.length !== 1 ? "s" : ""} · {c.canvasWidth}×
                  {c.canvasHeight}
                  {c.parallaxEnabled ? " · parallax" : ""}
                </div>
              </div>
            </div>
            <div className="flex gap-1">
              <button
                draggable
                onDragStart={(event) => {
                  registerCharacterPreset(c);
                  writeLibraryDragItem(event.dataTransfer, {
                    kind: "character",
                    characterId: c.id,
                  });
                }}
                onClick={() => void placeOnTimeline(c)}
                disabled={!project}
                title="Drag onto the canvas or the timeline, or click to add"
                className="flex-1 cursor-grab rounded bg-primary px-2 py-1 text-ui-sm font-medium text-primary-foreground hover:opacity-90 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add to scene
              </button>
              <button
                onClick={() => openModal({ type: "character-editor", characterId: c.id })}
                className="rounded border border-border px-2 py-1 text-ui-sm hover:bg-panel"
              >
                Edit
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AddCharacterChoice({
  title,
  detail,
  busy,
  disabled,
  onClick,
}: {
  title: string;
  detail: string;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="w-full rounded border border-border bg-panel px-2 py-2 text-left hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div className="font-medium text-foreground">{busy ? "Working…" : title}</div>
      <div className="mt-0.5 text-ui-sm text-muted-foreground">{detail}</div>
    </button>
  );
}

function CharacterThumbnail({ character }: { character: CharacterPreset }) {
  const boxWidth = 72;
  const boxHeight = 88;
  const previewFrames = useMemo(() => {
    const runtime = buildCharacterRuntime(character);
    return runtime.slots
      .filter((slot) => roleEnabledByManifest(slot.role, character.manifest))
      .map((slot): CharacterThumbnailFrame | null => {
        const defaultKey =
          slot.role === "mouth" ? "rest" : slot.role === "eye" ? "open" : undefined;
        const part = resolveRuntimeSlotPart(slot, runtime, defaultKey);
        if (!part || part.visible === false) return null;
        const placement = runtimePartPlacement(slot, part, runtime, {
          poseKey: defaultKey ?? variantKeyForPart(part),
        });
        return {
          part,
          x: placement.x,
          y: placement.y,
          rotation: placement.rotation,
          scaleX: placement.scaleX,
          scaleY: placement.scaleY,
          drawOrder: placement.drawOrder,
        };
      })
      .filter((frame): frame is CharacterThumbnailFrame => frame != null)
      .sort((a, b) => (a.drawOrder ?? a.part.zIndex) - (b.drawOrder ?? b.part.zIndex));
  }, [character]);
  const bounds = useMemo(
    () => thumbnailBoundsForFrames(previewFrames, character),
    [character, previewFrames],
  );
  const scale = Math.min(boxWidth / bounds.width, boxHeight / bounds.height);
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const offsetX = boxWidth / 2 - (bounds.x + bounds.width / 2) * safeScale;
  const offsetY = boxHeight / 2 - (bounds.y + bounds.height / 2) * safeScale;

  return (
    <div
      className="relative flex h-[88px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/60 bg-transparent"
      aria-label={`${character.name} preview`}
    >
      {previewFrames.length === 0 && <CharacterThumbnailFallback />}
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          width: character.canvasWidth,
          height: character.canvasHeight,
          transform: `matrix(${safeScale}, 0, 0, ${safeScale}, ${offsetX}, ${offsetY})`,
        }}
      >
        {previewFrames.map((frame) => (
          <CharacterThumbnailPart key={frame.part.id} frame={frame} />
        ))}
      </div>
    </div>
  );
}

function CharacterThumbnailFallback() {
  return (
    <svg viewBox="0 0 48 64" className="h-16 w-12 text-muted-foreground/60" aria-hidden="true">
      <circle cx="24" cy="16" r="11" fill="currentColor" opacity="0.72" />
      <path d="M13 54c1.8-14.2 6.2-22 11-22s9.2 7.8 11 22H13Z" fill="currentColor" opacity="0.42" />
      <path
        d="M10 39c3.6-5.2 8.2-7.8 14-7.8S34.4 33.8 38 39"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="4"
        opacity="0.32"
      />
    </svg>
  );
}

function CharacterThumbnailPart({ frame }: { frame: CharacterThumbnailFrame }) {
  const { part } = frame;
  const url = useMediaUrl(part.mediaId);
  if (!url) return null;
  return (
    <img
      src={url}
      alt={part.name}
      draggable={false}
      className="absolute object-contain"
      style={{
        left: 0,
        top: 0,
        width: part.width,
        height: part.height,
        zIndex: frame.drawOrder ?? part.zIndex,
        transform: matrixToCss(thumbnailFrameMatrix(frame)),
        transformOrigin: "0 0",
        pointerEvents: "none",
      }}
    />
  );
}

function PresetsTab() {
  const syncMotionPresets = useStudio((s) => s.syncMotionPresets);
  useEffect(() => {
    void ensureMotionPresetsSeeded();
  }, []);
  const queriedPresets = useLiveQuery(() => db.motionPresets.orderBy("category").toArray(), []);
  const presets = useMemo(() => queriedPresets ?? [], [queriedPresets]);

  useEffect(() => {
    if (!queriedPresets) return;
    syncMotionPresets(presets);
  }, [presets, queriedPresets, syncMotionPresets]);

  const grouped = new Map<string, typeof presets>();
  for (const p of presets) {
    const arr = grouped.get(p.category) ?? [];
    arr.push(p);
    grouped.set(p.category, arr);
  }

  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="rounded border border-border bg-panel-2 p-2 text-muted-foreground">
        Actions are what a character does — wave, nod, walk. Expressions are what its face does —
        happy, surprised. Select a character clip and open the Acting tab to add one.
      </div>
      <button
        onClick={() => useStudio.getState().openModal({ type: "presets" })}
        className="block w-full rounded border border-border bg-panel-2 px-2 py-1.5 text-center hover:bg-panel"
      >
        Browse all actions →
      </button>
      {Array.from(grouped.entries()).map(([cat, items]) => (
        <div key={cat}>
          <div className="mb-1 text-ui-sm uppercase tracking-wider text-muted-foreground">
            {cat}
          </div>
          <ul className="space-y-1">
            {items.map((p) => (
              <li key={p.id} className="rounded border border-border bg-panel-2 px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-foreground">{p.name}</span>
                  <span className="text-ui-sm text-muted-foreground">{p.duration}s</span>
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

type MediaKindFilter = "all" | "image" | "video" | "audio";

const MEDIA_KIND_FILTERS: { id: MediaKindFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "image", label: "Images" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
];

function MediaTab() {
  const queriedItems = useLiveQuery(() => db.media.orderBy("createdAt").reverse().toArray(), []);
  const allItems = useMemo(() => queriedItems ?? [], [queriedItems]);
  const characters = useLiveQuery(() => db.characters.toArray(), []);
  const project = useStudio((s) => s.project);
  const inputRef = useRef<HTMLInputElement>(null);
  const addLibraryItem = useStudio((s) => s.addLibraryItem);
  const registerMediaAsset = useStudio((s) => s.registerMediaAsset);
  const notify = useNotify();

  const internalMediaIds = useMemo(() => {
    const ids = new Set<string>();
    for (const character of characters ?? []) {
      for (const part of character.parts) ids.add(part.mediaId);
      for (const variant of character.headVariants ?? []) ids.add(variant.mediaId);
    }
    return ids;
  }, [characters]);

  const libraryItems = allItems.filter(
    (asset) => (asset.scope ?? "library") === "library" && !internalMediaIds.has(asset.id),
  );

  const [kindFilter, setKindFilter] = useState<MediaKindFilter>("all");
  const counts = useMemo(() => {
    const c = { all: libraryItems.length, image: 0, video: 0, audio: 0 };
    for (const asset of libraryItems) {
      if (asset.kind === "image") c.image += 1;
      else if (asset.kind === "video") c.video += 1;
      else if (asset.kind === "audio") c.audio += 1;
    }
    return c;
  }, [libraryItems]);
  const items =
    kindFilter === "all" ? libraryItems : libraryItems.filter((asset) => asset.kind === kindFilter);

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      try {
        const asset = await importMediaFile(f);
        registerMediaAsset(asset);
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
      <div className="mb-3 flex items-center gap-1">
        {MEDIA_KIND_FILTERS.map((f) => {
          const active = kindFilter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setKindFilter(f.id)}
              className={`flex-1 rounded px-2 py-1 text-ui-sm font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-panel-2 text-muted-foreground hover:text-foreground"
              }`}
              title={`${f.label} (${counts[f.id]})`}
            >
              {f.label}
              <span className={active ? "ml-1 opacity-80" : "ml-1 opacity-60"}>{counts[f.id]}</span>
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {items.map((m) => (
          <MediaTile
            key={m.id}
            asset={m}
            onAdd={() => void addLibraryItem({ kind: "media", mediaId: m.id })}
            onDelete={async () => {
              const result = await deleteMediaIfUnused(m.id, {
                extraProjects: project ? [project] : undefined,
              });
              if (result.deleted) return;
              if (result.usages.length === 0) return;
              void notify({
                title: "This file is still in use",
                body: [
                  "It was not deleted. Remove it from these places first:",
                  ...result.usages
                    .slice(0, 5)
                    .map(
                      (usage) => `${usage.ownerName}${usage.detail ? ` — ${usage.detail}` : ""}`,
                    ),
                ],
              });
            }}
          />
        ))}
        {items.length === 0 && (
          <div className="col-span-2 text-center text-xs text-muted-foreground">
            {libraryItems.length === 0
              ? "No media yet. Upload to start building."
              : `No ${kindFilter} files yet.`}
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
      <button
        draggable
        onDragStart={(event) =>
          writeLibraryDragItem(event.dataTransfer, { kind: "media", mediaId: asset.id })
        }
        onClick={onAdd}
        className="block w-full cursor-grab active:cursor-grabbing"
        title="Drag onto the canvas or the timeline, or click to add"
      >
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
          <div className="truncate text-ui-sm font-medium text-foreground">{asset.name}</div>
          <div className="text-ui-sm text-muted-foreground">{asset.kind}</div>
        </div>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          void onDelete();
        }}
        className="absolute right-1 top-1 hidden rounded bg-black/60 px-1.5 text-ui-sm text-foreground hover:bg-destructive group-hover:block"
        title="Delete"
      >
        ✕
      </button>
    </div>
  );
}
