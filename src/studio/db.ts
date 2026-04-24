// Dexie database — local-first storage for projects, characters,
// movement presets, and media blobs. Everything stays in the browser.
import Dexie, { type Table } from "dexie";
import type {
  CharacterPreset,
  MediaAsset,
  MediaBlobRow,
  MovementPreset,
  Project,
} from "./types";

class StudioDB extends Dexie {
  projects!: Table<Project, string>;
  characters!: Table<CharacterPreset, string>;
  movements!: Table<MovementPreset, string>;
  media!: Table<MediaAsset, string>;
  mediaBlobs!: Table<MediaBlobRow, string>;

  constructor() {
    super("hyperframes-studio");
    this.version(1).stores({
      projects: "id, name, updatedAt",
      characters: "id, name, updatedAt",
      movements: "id, name, createdAt",
      media: "id, name, kind, createdAt",
      mediaBlobs: "id",
    });
  }
}

export const db = new StudioDB();

export const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36));

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
    return new Promise<{ width?: number; height?: number; duration: number }>(
      (resolve) => {
        const url = URL.createObjectURL(file);
        const el = document.createElement(kind === "audio" ? "audio" : "video") as
          HTMLMediaElement & { videoWidth?: number; videoHeight?: number };
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
      },
    );
  }
  return {};
}

export async function importMediaFile(file: File): Promise<MediaAsset> {
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
