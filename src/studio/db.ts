// Dexie database — local-first storage for projects, characters,
// movement presets, and media blobs. Everything stays in the browser.
import Dexie, { type Table } from "dexie";
import type { ActionPreset, CharacterPreset, MediaAsset, MediaBlobRow, Project } from "./types";

class StudioDB extends Dexie {
  projects!: Table<Project, string>;
  characters!: Table<CharacterPreset, string>;
  /** Note: kept the table name `movements` for back-compat with v1 data;
   *  it now stores ActionPreset records (movements + expressions). */
  movements!: Table<ActionPreset, string>;
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
    // v2: same indexes, added `category` index on movements.
    this.version(2)
      .stores({
        projects: "id, name, updatedAt",
        characters: "id, name, updatedAt",
        movements: "id, name, category, createdAt",
        media: "id, name, kind, createdAt",
        mediaBlobs: "id",
      })
      .upgrade(async (tx) => {
        const table = tx.table<ActionPreset>("movements");
        const all = await table.toArray();
        for (const row of all) {
          const legacy = row as ActionPreset & { keyframes?: unknown };
          if (Array.isArray(legacy.keyframes) && !row.tracks) {
            const kfs = legacy.keyframes as Array<{
              t: number;
              x?: number;
              y?: number;
              scale?: number;
              rotation?: number;
              opacity?: number;
              ease?: string;
              poses?: Record<string, string>;
            }>;
            const dur = Math.max(0.1, ...kfs.map((k) => k.t || 0));
            const norm = kfs.map((k) => ({
              t: dur > 0 ? Math.min(1, Math.max(0, k.t / dur)) : 0,
              dx: k.x,
              dy: k.y,
              scale: k.scale,
              rotation: k.rotation,
              opacity: k.opacity,
              ease: k.ease,
            }));
            await table.put({
              ...row,
              category: "custom",
              loop: false,
              tracks: [{ partRole: "extra", keyframes: norm }],
              keyframes: undefined,
              updatedAt: row.createdAt ?? Date.now(),
            });
          }
        }
      });
    // v3: migrate CharacterPreset.parallaxEnabled → ParallaxConfig object;
    // ensure headVariants exists.
    this.version(3)
      .stores({
        projects: "id, name, updatedAt",
        characters: "id, name, updatedAt",
        movements: "id, name, category, createdAt",
        media: "id, name, kind, createdAt",
        mediaBlobs: "id",
      })
      .upgrade(async (tx) => {
        const table = tx.table<CharacterPreset>("characters");
        const all = await table.toArray();
        for (const row of all) {
          const legacy = row as CharacterPreset & { parallaxEnabled?: boolean };
          if (!row.parallax) {
            const enabled = legacy.parallaxEnabled !== false;
            await table.put({
              ...row,
              parallax: {
                onCamera: enabled,
                onClip: enabled,
                intensity: 0.15,
              },
              headVariants: row.headVariants ?? [],
              parallaxEnabled: undefined,
              updatedAt: Date.now(),
            });
          }
        }
      });
    // v4: add stable part slot ids so actions can target exact rig layers.
    this.version(4)
      .stores({
        projects: "id, name, updatedAt",
        characters: "id, name, updatedAt",
        movements: "id, name, category, createdAt",
        media: "id, name, kind, createdAt",
        mediaBlobs: "id",
      })
      .upgrade(async (tx) => {
        const table = tx.table<CharacterPreset>("characters");
        const all = await table.toArray();
        for (const row of all) {
          const parts = row.parts.map((part) => {
            const slotId = part.slotId ?? slotIdForPart(part.role, part.id);
            return {
              ...part,
              slotId,
              slotName: part.slotName ?? roleLabelForSlot(part.role),
            };
          });
          await table.put({ ...row, parts, updatedAt: Date.now() });
        }
      });
  }
}

export const db = new StudioDB();

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

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

function slotIdForPart(role: CharacterPreset["parts"][number]["role"], partId: string) {
  return role === "extra" ? `extra:${partId}` : `role:${role}`;
}

function roleLabelForSlot(role: CharacterPreset["parts"][number]["role"]) {
  switch (role) {
    case "head":
      return "Head";
    case "body":
      return "Body";
    case "armL":
      return "Left Arm";
    case "armR":
      return "Right Arm";
    case "legL":
      return "Left Leg";
    case "legR":
      return "Right Leg";
    case "eye":
      return "Eyes";
    case "eyeL":
      return "Left Eye";
    case "eyeR":
      return "Right Eye";
    case "brow":
      return "Brows";
    case "browL":
      return "Left Brow";
    case "browR":
      return "Right Brow";
    case "mouth":
      return "Mouth";
    case "extra":
      return "Extra";
  }
}
