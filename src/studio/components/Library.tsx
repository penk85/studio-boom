// Library panel — Media, Characters (with editor), Motion Presets, Blocks (later).
import { useLiveQuery } from "dexie-react-hooks";
import { db, deleteMediaIfUnused, importMediaFile, mediaIdsForCharacter, uid } from "../db";
import { useStudio } from "../store";
import type { CharacterPreset, CompositionClip, MediaAsset, TextClip } from "../types";
import { deriveEditorClips, isCharacterCompositionClip } from "../types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMediaUrl } from "../hooks/useMediaUrl";
import {
  buildCompositionRepairPrompt,
  validateCompositionSourceHtml,
} from "../hyperframes/composition-source";
import { buildCompositionPreviewProject } from "../hyperframes/composition-preview-project";
import {
  createBlankCharacter,
  roleEnabledByManifest,
  variantKeyForPart,
} from "../character/character-utils";
import {
  thumbnailFrameMatrix,
  thumbnailBoundsForFrames,
  type CharacterThumbnailFrame,
} from "./character-thumbnail-bounds";
import { matrixToCss } from "../character/geometry";
import { ensureStarterCharacterSeeded } from "../character/starter";
import { defaultPoseForCharacter } from "../character/pose-presets";
import { ensureMotionPresetsSeeded } from "../presets/seed";
import { HyperFramesPreviewPanel } from "./HyperFramesPreviewPanel";
import {
  buildCharacterRuntime,
  resolveRuntimeSlotPart,
  runtimePartPlacement,
} from "../character/runtime";

const TABS = [
  { id: "media", label: "Media" },
  { id: "text", label: "Text" },
  { id: "characters", label: "Characters" },
  { id: "presets", label: "Motion presets" },
  { id: "blocks", label: "Blocks" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function Library() {
  const [tab, setTab] = useState<TabId>("media");
  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="border-b border-border bg-panel p-2">
        <div className="grid grid-cols-3 gap-1 rounded-md bg-panel-2 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`min-w-0 rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                tab === t.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-panel hover:text-foreground"
              }`}
              title={t.label}
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
        {tab === "blocks" && <BlocksTab />}
      </div>
    </div>
  );
}

const TEXT_BLOCKS = [
  {
    id: "title",
    label: "Title",
    content: "Add a title",
    widthFactor: 0.62,
    heightFactor: 0.16,
    yFactor: 0.18,
    fontSize: 88,
    fontWeight: 800,
  },
  {
    id: "caption",
    label: "Caption",
    content: "Add caption text",
    widthFactor: 0.54,
    heightFactor: 0.1,
    yFactor: 0.78,
    fontSize: 42,
    fontWeight: 600,
  },
  {
    id: "lower-third",
    label: "Lower third",
    content: "Speaker name",
    widthFactor: 0.38,
    heightFactor: 0.11,
    yFactor: 0.68,
    fontSize: 38,
    fontWeight: 700,
  },
] as const;

function TextTab() {
  const project = useStudio((s) => s.project);
  const clips = useMemo(() => (project ? deriveEditorClips(project) : []), [project]);
  const tracks = useStudio((s) => s.tracks);
  const addClip = useStudio((s) => s.addClip);

  const addTextBlock = (preset: (typeof TEXT_BLOCKS)[number]) => {
    if (!project) return;
    const trackIndex = Math.max(
      0,
      tracks.findIndex((t) => t.kind === "overlay"),
    );
    const width = Math.round(project.hf.width * preset.widthFactor);
    const height = Math.round(project.hf.height * preset.heightFactor);
    const clip: TextClip = {
      id: uid(),
      kind: "text",
      name: preset.label,
      content: preset.content,
      trackIndex,
      start: 0,
      duration: 4,
      x: Math.round((project.hf.width - width) / 2),
      y: Math.round(project.hf.height * preset.yFactor),
      width,
      height,
      rotation: 0,
      opacity: 1,
      zIndex: clips.filter((clip) => clip.kind !== "audio").length,
      color: "#111827",
      fontSize: preset.fontSize,
      fontFamily: "Inter",
      fontWeight: preset.fontWeight,
      fitToBounds: false,
    };
    addClip(clip);
  };

  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="grid grid-cols-1 gap-2">
        {TEXT_BLOCKS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => addTextBlock(preset)}
            disabled={!project}
            className="rounded border border-border bg-panel-2 p-3 text-left hover:border-primary hover:bg-panel disabled:cursor-not-allowed disabled:opacity-50"
          >
            <div className="font-medium text-foreground">{preset.label}</div>
            <div className="mt-1 truncate text-[11px] text-muted-foreground">{preset.content}</div>
          </button>
        ))}
      </div>
      <div className="rounded border border-border bg-panel-2 p-2 text-[11px] leading-relaxed text-muted-foreground">
        Select a text block after adding it to edit copy, color, and type styling in the Inspector.
      </div>
    </div>
  );
}

function CharactersTab() {
  const project = useStudio((s) => s.project);
  const clips = useMemo(() => (project ? deriveEditorClips(project) : []), [project]);
  const tracks = useStudio((s) => s.tracks);
  const addClip = useStudio((s) => s.addClip);
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

  const newCharacter = async () => {
    const c = createBlankCharacter();
    await db.characters.put(c);
    registerCharacterPreset(c);
    openModal({ type: "character-editor", characterId: c.id });
  };

  const placeOnTimeline = (
    characterId: string,
    name: string,
    canvasWidth = 600,
    canvasHeight = 900,
    character?: CharacterPreset,
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
    const clip: CompositionClip = {
      id: uid(),
      kind: "composition",
      compositionKind: "character",
      character: {
        characterId,
        // Characters start in their default pose — a non-pose doesn't make sense.
        poses: character ? defaultPoseForCharacter(character) : {},
        autoBlink: true,
      },
      name,
      trackIndex,
      start: 0,
      duration: 4,
      x: Math.round((project.hf.width - w) / 2),
      y: Math.round((project.hf.height - h) / 2),
      width: w,
      height: h,
      rotation: 0,
      opacity: 1,
      zIndex: clips.length,
    };
    addClip(clip);
  };

  const placePlaceholder = () => placeOnTimeline("stub", "Voice Character");

  const deleteCharacter = async (id: string) => {
    const references = clips.filter(
      (clip) => isCharacterCompositionClip(clip) && clip.character.characterId === id,
    );
    const message =
      references.length > 0
        ? [
            `This character is used by ${references.length} timeline clip${
              references.length === 1 ? "" : "s"
            }.`,
            "",
            references
              .slice(0, 5)
              .map((clip) => `- ${clip.name || clip.id}`)
              .join("\n"),
            references.length > 5 ? `...and ${references.length - 5} more.` : "",
            "",
            "Deleting it removes the reusable rig from the library. Existing timeline clips will keep their generated source, but they cannot refresh from this character preset until you replace or recreate it.",
            "",
            "Delete this character anyway?",
          ]
            .filter(Boolean)
            .join("\n")
        : "Delete this character from the library?";
    if (!confirm(message)) return;
    const character = await db.characters.get(id);
    const mediaIds = Array.from(mediaIdsForCharacter(character));
    await db.characters.delete(id);
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
            <div className="mb-2 flex gap-3">
              <CharacterThumbnail character={c} />
              <div className="min-w-0 flex-1 py-1">
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
                onClick={() => {
                  registerCharacterPreset(c);
                  placeOnTimeline(c.id, c.name, c.canvasWidth, c.canvasHeight, c);
                }}
                disabled={!project}
                className="flex-1 rounded bg-primary/30 px-2 py-1 text-[11px] hover:bg-primary/50 disabled:opacity-50"
              >
                Add to scene
              </button>
              <button
                onClick={() => openModal({ type: "character-editor", characterId: c.id })}
                className="rounded border border-border px-2 py-1 text-[11px] hover:bg-panel"
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
        Apply these to a character clip from the Inspector. Built-ins cover expressions
        ("Surprised", "Happy"), gestures ("Wave", "Nod"), full-body ("Idle bob", "Jump") and camera
        moves.
      </div>
      <button
        onClick={() => useStudio.getState().openModal({ type: "presets" })}
        className="block w-full rounded border border-border bg-panel-2 px-2 py-1.5 text-center hover:bg-panel"
      >
        Browse all motion presets →
      </button>
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

function BlocksTab() {
  const project = useStudio((s) => s.project);
  const clips = useMemo(() => (project ? deriveEditorClips(project) : []), [project]);
  const tracks = useStudio((s) => s.tracks);
  const addClip = useStudio((s) => s.addClip);
  const [source, setSource] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [validated, setValidated] = useState<ReturnType<
    typeof validateCompositionSourceHtml
  > | null>(null);
  const [previewProject, setPreviewProject] = useState<ReturnType<
    typeof buildCompositionPreviewProject
  > | null>(null);
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const canPreviewBlock = Boolean(
    project && source.trim() && validated?.ok && validated.html && validated.compositionId,
  );
  const canAddBlock = Boolean(
    project &&
    source.trim() &&
    validated?.ok &&
    validated.html &&
    validated.compositionId &&
    previewStatus === "ready",
  );
  const previewWidth = validated?.width ?? project?.hf.width ?? 1920;
  const previewHeight = validated?.height ?? project?.hf.height ?? 1080;

  const validateSource = () => {
    if (!project) return null;
    const result = validateCompositionSourceHtml(source, {
      compositionId: `ai_block_${Date.now()}`,
      duration: 4,
      width: project.hf.width,
      height: project.hf.height,
    });
    setErrors(result.errors);
    setValidated(result);
    setPreviewProject(null);
    setPreviewStatus("idle");
    return result;
  };

  const previewBlock = () => {
    if (!project || !validated?.ok || !validated.html) return;
    setPreviewStatus("loading");
    setPreviewProject(buildCompositionPreviewProject(project, validated));
  };

  const handlePreviewStatusChange = useCallback(
    (status: "idle" | "loading" | "ready" | "error") => setPreviewStatus(status),
    [],
  );

  const addBlock = () => {
    if (!project) return;
    const result = validated;
    if (!result?.ok || !result.compositionId || !result.html) return;

    const trackIndex = Math.max(
      0,
      tracks.findIndex((t) => t.kind === "overlay"),
    );
    const width = result.width ?? project.hf.width;
    const height = result.height ?? project.hf.height;

    try {
      addClip({
        id: uid(),
        kind: "composition",
        compositionId: result.compositionId,
        compositionKind: "ai-block",
        compositionHtml: result.html,
        name: result.compositionId,
        trackIndex,
        start: 0,
        duration: result.duration ?? 4,
        x: Math.round((project.hf.width - width) / 2),
        y: Math.round((project.hf.height - height) / 2),
        width,
        height,
        rotation: 0,
        opacity: 1,
        zIndex: clips.filter((clip) => clip.kind !== "audio").length,
      });
      setSource("");
      setValidated(null);
      setPreviewProject(null);
      setPreviewStatus("idle");
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)]);
      setValidated(null);
      setPreviewProject(null);
      setPreviewStatus("idle");
    }
  };

  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="rounded border border-border bg-panel-2 p-2 text-[11px] leading-relaxed text-muted-foreground">
        Paste a self-contained HyperFrames composition. Studio stores it in project.hf and adds one
        composition clip to the timeline.
      </div>
      <textarea
        value={source}
        onChange={(event) => {
          setSource(event.target.value);
          if (errors.length > 0) setErrors([]);
          setValidated(null);
          setPreviewProject(null);
          setPreviewStatus("idle");
        }}
        rows={12}
        spellCheck={false}
        placeholder='<html data-composition-id="ai-title" ...>'
        className="w-full resize-y rounded border border-border bg-input px-2 py-2 font-mono text-[11px] leading-relaxed text-foreground"
      />
      {errors.length > 0 && (
        <div className="rounded border border-destructive/60 bg-destructive/10 p-2 text-[11px] text-destructive-foreground">
          <div className="mb-1 font-medium">Validation failed</div>
          <ul className="list-inside list-disc space-y-0.5">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard?.writeText(buildCompositionRepairPrompt(errors, source))
            }
            className="mt-2 rounded border border-destructive/60 px-2 py-1 text-[10px] hover:bg-destructive/20"
          >
            Copy repair prompt
          </button>
        </div>
      )}
      {validated?.ok && (
        <div className="rounded border border-primary/50 bg-primary/10 px-2 py-1 text-[11px] text-foreground">
          Source is valid. Preview it before adding it to the timeline.
        </div>
      )}
      {previewProject && (
        <HyperFramesPreviewPanel
          project={previewProject}
          width={previewWidth}
          height={previewHeight}
          seekTime={Math.min((validated?.duration ?? 4) * 0.35, 1)}
          title="Sandboxed HyperFrames block preview"
          onStatusChange={handlePreviewStatusChange}
        />
      )}
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={validateSource}
          disabled={!project || !source.trim()}
          className="flex-1 rounded border border-border px-2 py-1.5 text-xs text-foreground hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Validate
        </button>
        <button
          type="button"
          onClick={previewBlock}
          disabled={!canPreviewBlock}
          className="rounded border border-border px-2 py-1.5 text-xs text-foreground hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Preview
        </button>
        <button
          type="button"
          onClick={addBlock}
          disabled={!canAddBlock}
          className="flex-1 rounded bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Add block
        </button>
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
  const addMedia = useStudio((s) => s.addMediaToTimeline);
  const registerMediaAsset = useStudio((s) => s.registerMediaAsset);
  const syncMediaAssets = useStudio((s) => s.syncMediaAssets);

  useEffect(() => {
    if (!queriedItems) return;
    syncMediaAssets(allItems);
  }, [allItems, queriedItems, syncMediaAssets]);

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
              className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
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
