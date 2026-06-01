// Dexie database — local-first storage for projects, characters,
// motion presets, and media blobs. Everything stays in the browser.
import Dexie, { type Table } from "dexie";
import type {
  MotionPreset,
  CharacterPreset,
  MediaAsset,
  MediaBlobRow,
  Project,
  SavedVoice,
  VisemeEntry,
  VoiceLineMeta,
} from "./types";

class StudioDB extends Dexie {
  projects!: Table<Project, string>;
  characters!: Table<CharacterPreset, string>;
  motionPresets!: Table<MotionPreset, string>;
  media!: Table<MediaAsset, string>;
  mediaBlobs!: Table<MediaBlobRow, string>;
  savedVoices!: Table<SavedVoice, string>;

  constructor() {
    super("hyperframes-studio");
    this.version(8).stores({
      projects: "id, name, updatedAt",
      characters: "id, name, updatedAt",
      motionPresets: "id, name, category, createdAt",
      media: "id, name, kind, createdAt",
      mediaBlobs: "id",
      savedVoices: "id, voiceId, name, createdAt",
      movements: null,
    });
  }
}

export const db = new StudioDB();

export const uid = () => {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `e${uuid}`;
};

/** Get a Blob URL for a media asset, caching by id. */
const blobUrlCache = new Map<string, string>();
export async function getMediaUrl(id: string): Promise<string | null> {
  if (blobUrlCache.has(id)) return blobUrlCache.get(id)!;
  const row = await db.mediaBlobs.get(id);
  if (!row) return null;
  const url = URL.createObjectURL(row.blob);
  blobUrlCache.set(id, url);
  return url;
}
export function revokeMediaUrl(id: string) {
  const u = blobUrlCache.get(id);
  if (u) {
    URL.revokeObjectURL(u);
    blobUrlCache.delete(id);
  }
}

/** Probe a file for natural dimensions / duration before insert. */
async function probeFile(file: File, kind: MediaAsset["kind"]) {
  if (kind === "image") {
    return new Promise<{ width: number; height: number }>((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        resolve({ width: 0, height: 0 });
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  }
  if (kind === "audio" || kind === "video") {
    return new Promise<{ width?: number; height?: number; duration: number }>((resolve) => {
      const url = URL.createObjectURL(file);
      const el = document.createElement(
        kind === "audio" ? "audio" : "video",
      ) as HTMLMediaElement & { videoWidth?: number; videoHeight?: number };
      el.preload = "metadata";
      el.onloadedmetadata = () => {
        resolve({
          duration: isFinite(el.duration) ? el.duration : 0,
          width: (el as HTMLVideoElement).videoWidth,
          height: (el as HTMLVideoElement).videoHeight,
        });
        URL.revokeObjectURL(url);
      };
      el.onerror = () => {
        resolve({ duration: 0 });
        URL.revokeObjectURL(url);
      };
      el.src = url;
    });
  }
  return {};
}

export async function importMediaFile(
  file: File,
  opts: { scope?: MediaAsset["scope"] } = {},
): Promise<MediaAsset> {
  if (opts.scope === "character-part") {
    const looksSvg = file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
    if (!looksSvg) {
      throw new Error("Character parts must be SVG files.");
    }
  }
  const kind: MediaAsset["kind"] = file.type.startsWith("image/")
    ? "image"
    : file.type.startsWith("audio/")
      ? "audio"
      : "video";
  const probe = await probeFile(file, kind);
  const asset: MediaAsset = {
    id: uid(),
    name: file.name.replace(/\.[^/.]+$/, ""),
    filename: file.name,
    kind,
    scope: opts.scope ?? "library",
    mimeType: file.type || "application/octet-stream",
    createdAt: Date.now(),
    ...probe,
  };
  await db.transaction("rw", db.media, db.mediaBlobs, async () => {
    await db.media.add(asset);
    await db.mediaBlobs.add({ id: asset.id, blob: file });
  });
  return asset;
}

export async function deleteMedia(id: string) {
  revokeMediaUrl(id);
  await db.transaction("rw", db.media, db.mediaBlobs, async () => {
    await db.media.delete(id);
    await db.mediaBlobs.delete(id);
  });
}

/**
 * Persist canonical lip-sync data on an audio asset so it can be reattached to
 * any character without regenerating timing. Returns the updated asset (or null
 * if the asset no longer exists).
 */
export async function setMediaVoiceData(
  id: string,
  data: { visemes?: VisemeEntry[]; voiceLine?: VoiceLineMeta },
): Promise<MediaAsset | null> {
  await db.media.update(id, { visemes: data.visemes, voiceLine: data.voiceLine });
  return (await db.media.get(id)) ?? null;
}

export type MediaUsageKind = "project-asset" | "character-part" | "head-variant";

export interface MediaUsage {
  mediaId: string;
  kind: MediaUsageKind;
  ownerId: string;
  ownerName: string;
  detail?: string;
}

export function mediaIdsForCharacter(character: CharacterPreset | null | undefined): Set<string> {
  const ids = new Set<string>();
  if (!character) return ids;
  for (const part of character.parts) ids.add(part.mediaId);
  for (const variant of character.headVariants ?? []) ids.add(variant.mediaId);
  return ids;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isCurrentProjectShape(project: unknown): project is Project {
  if (!isRecord(project) || !isRecord(project.hf) || !isRecord(project.editorMeta)) {
    return false;
  }
  const clipsValue = project.editorMeta.clips;
  if (
    typeof project.id !== "string" ||
    typeof project.name !== "string" ||
    !Array.isArray(project.hf.assets) ||
    typeof project.hf.rootHtml !== "string" ||
    !isRecord(project.hf.compositionHtml) ||
    !Array.isArray(project.editorMeta.tracks) ||
    !isRecord(clipsValue)
  ) {
    return false;
  }

  for (const meta of Object.values(clipsValue)) {
    if (!isRecord(meta)) return false;
    if (meta.kind === "character") return false;
    if (
      "characterId" in meta ||
      "linkedCharacterClipId" in meta ||
      "motions" in meta ||
      "visemes" in meta ||
      "poses" in meta ||
      "autoBlink" in meta ||
      "lipSyncAudioId" in meta ||
      "voiceLine" in meta
    ) {
      return false;
    }
  }

  return true;
}

export function collectProjectMediaUsages(project: Project, onlyMediaId?: string): MediaUsage[] {
  const usages: MediaUsage[] = [];
  const push = (mediaId: string | undefined, usage: Omit<MediaUsage, "mediaId">) => {
    if (!mediaId || (onlyMediaId && mediaId !== onlyMediaId)) return;
    usages.push({ mediaId, ...usage });
  };

  for (const asset of project.hf.assets) {
    push(asset.id, {
      kind: "project-asset",
      ownerId: project.id,
      ownerName: project.name,
      detail: asset.filename || asset.id,
    });
  }
  return usages;
}

function collectCharacterMediaUsages(
  character: CharacterPreset,
  onlyMediaId?: string,
): MediaUsage[] {
  const usages: MediaUsage[] = [];
  const push = (mediaId: string | undefined, usage: Omit<MediaUsage, "mediaId">) => {
    if (!mediaId || (onlyMediaId && mediaId !== onlyMediaId)) return;
    usages.push({ mediaId, ...usage });
  };

  for (const part of character.parts) {
    push(part.mediaId, {
      kind: "character-part",
      ownerId: character.id,
      ownerName: character.name,
      detail: part.name,
    });
  }
  for (const variant of character.headVariants ?? []) {
    push(variant.mediaId, {
      kind: "head-variant",
      ownerId: character.id,
      ownerName: character.name,
      detail: variant.direction,
    });
  }
  return usages;
}

interface MediaUsageOptions {
  extraProjects?: Project[];
  extraCharacters?: CharacterPreset[];
}

export async function getMediaUsages(
  mediaId: string,
  opts: MediaUsageOptions = {},
): Promise<MediaUsage[]> {
  const [projects, characters] = await Promise.all([
    db.projects.toArray(),
    db.characters.toArray(),
  ]);
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const characterMap = new Map(characters.map((character) => [character.id, character]));
  for (const project of opts.extraProjects ?? []) projectMap.set(project.id, project);
  for (const character of opts.extraCharacters ?? []) characterMap.set(character.id, character);

  return [
    ...Array.from(projectMap.values()).flatMap((project) =>
      collectProjectMediaUsages(project, mediaId),
    ),
    ...Array.from(characterMap.values()).flatMap((character) =>
      collectCharacterMediaUsages(character, mediaId),
    ),
  ];
}

export async function deleteMediaIfUnused(
  id: string,
  opts: { internalOnly?: boolean } & MediaUsageOptions = {},
): Promise<{ deleted: boolean; usages: MediaUsage[]; skipped?: "library" | "missing" }> {
  const asset = await db.media.get(id);
  if (!asset) return { deleted: false, usages: [], skipped: "missing" };
  if (opts.internalOnly && (asset.scope ?? "library") === "library") {
    return { deleted: false, usages: [], skipped: "library" };
  }

  const usages = await getMediaUsages(id, opts);
  if (usages.length > 0) return { deleted: false, usages };

  await deleteMedia(id);
  return { deleted: true, usages: [] };
}

export async function garbageCollectUnusedInternalMedia(
  opts: { includeLibrary?: boolean; minAgeMs?: number } = {},
): Promise<{ deletedIds: string[] }> {
  const includeLibrary = opts.includeLibrary ?? false;
  const minAgeMs = opts.minAgeMs ?? 5 * 60 * 1000;
  const cutoff = Date.now() - minAgeMs;
  const [assets, projects, characters] = await Promise.all([
    db.media.toArray(),
    db.projects.toArray(),
    db.characters.toArray(),
  ]);
  const usedIds = new Set<string>();
  for (const project of projects) {
    for (const usage of collectProjectMediaUsages(project)) usedIds.add(usage.mediaId);
  }
  for (const character of characters) {
    for (const usage of collectCharacterMediaUsages(character)) usedIds.add(usage.mediaId);
  }

  const deletedIds: string[] = [];
  for (const asset of assets) {
    const scope = asset.scope ?? "library";
    if (!includeLibrary && scope === "library") continue;
    if (usedIds.has(asset.id)) continue;
    if (asset.createdAt > cutoff) continue;
    await deleteMedia(asset.id);
    deletedIds.push(asset.id);
  }
  return { deletedIds };
}

/** Save a custom ElevenLabs voice for reuse */
export async function saveVoice(voiceId: string, name: string): Promise<SavedVoice> {
  const existing = await db.savedVoices.where("voiceId").equals(voiceId).first();
  if (existing) {
    const updated: SavedVoice = {
      ...existing,
      name: name.trim() || existing.name || voiceId,
      createdAt: Date.now(),
    };
    await db.savedVoices.put(updated);
    return updated;
  }
  const voice: SavedVoice = {
    id: uid(),
    voiceId,
    name: name.trim() || voiceId,
    createdAt: Date.now(),
  };
  await db.savedVoices.add(voice);
  return voice;
}

/** Get all saved voices, most recent first */
export async function getSavedVoices(): Promise<SavedVoice[]> {
  return db.savedVoices.orderBy("createdAt").reverse().toArray();
}

/** Delete a saved voice */
export async function deleteSavedVoice(id: string) {
  await db.savedVoices.delete(id);
}
