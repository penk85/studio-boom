// Builds the real HyperFrames project file tree from project.hf for MP4 rendering.
// This is an adapter for the HyperFrames CLI, not a second render model.
import gsapRaw from "gsap/dist/gsap.min.js?raw";
import { db } from "../db";
import type { HFAsset, Project } from "../types";
import { validateHfProject } from "../hyperframes/validate";
import { normalizeNativeHyperframesHtml } from "../hyperframes/native";

export interface HyperframesTextFile {
  path: string;
  contents: string;
  mimeType: string;
}

export interface HyperframesBinaryFile {
  path: string;
  blob: Blob;
  mimeType: string;
}

export interface HyperframesProjectFiles {
  textFiles: HyperframesTextFile[];
  binaryFiles: HyperframesBinaryFile[];
}

export function extFromAsset(filename: string, mimeType: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot !== -1) return filename.slice(dot).toLowerCase();
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/mp4": ".m4a",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
  };
  return map[mimeType] ?? "";
}

export function resolvePackagedAssetRefs(
  html: string,
  assets: HFAsset[],
  assetPrefix: "assets" | "../assets",
): string {
  const assetPathById = new Map(
    assets.map((asset) => [
      asset.id,
      `${assetPrefix}/${asset.id}${extFromAsset(asset.filename, asset.mimeType)}`,
    ]),
  );

  return html.replace(/asset:([a-zA-Z0-9_-]+)/g, (match, assetId: string) => {
    return assetPathById.get(assetId) ?? match;
  });
}

export async function buildHyperframesProjectFiles(
  project: Project,
): Promise<HyperframesProjectFiles> {
  const { hf } = project;

  validateHfProject(hf);

  const mediaExtMap = new Map<string, string>();
  for (const asset of hf.assets) {
    mediaExtMap.set(asset.id, extFromAsset(asset.filename, asset.mimeType));
  }

  const assetIds = hf.assets.map((asset) => asset.id);
  const mediaBlobs =
    assetIds.length > 0 ? await db.mediaBlobs.where("id").anyOf(assetIds).toArray() : [];
  const blobMap = new Map(mediaBlobs.map((row) => [row.id, row.blob]));
  assertExportBlobsPresent(hf.assets, blobMap);

  const compositionTextFiles: HyperframesTextFile[] = Object.entries(hf.compositionHtml).map(
    ([id, html]) => ({
      path: `compositions/${id}.html`,
      contents: resolvePackagedAssetRefs(
        normalizeNativeHyperframesHtml(html),
        hf.assets,
        "../assets",
      ),
      mimeType: "text/html",
    }),
  );

  return {
    textFiles: [
      {
        path: "index.html",
        contents: resolvePackagedAssetRefs(
          normalizeNativeHyperframesHtml(hf.rootHtml, { width: hf.width, height: hf.height }),
          hf.assets,
          "assets",
        ),
        mimeType: "text/html",
      },
      { path: "gsap.min.js", contents: gsapRaw, mimeType: "text/javascript" },
      ...compositionTextFiles,
    ],
    binaryFiles: hf.assets.map((asset) => {
      const ext = mediaExtMap.get(asset.id) ?? "";
      return {
        path: `assets/${asset.id}${ext}`,
        blob: blobMap.get(asset.id)!,
        mimeType: asset.mimeType,
      };
    }),
  };
}

export function assertExportBlobsPresent(assets: HFAsset[], blobMap: Map<string, Blob>): void {
  const missing = assets.filter((asset) => !blobMap.has(asset.id));
  if (missing.length === 0) return;

  throw new Error(
    `Export is missing media blobs:\n${missing
      .map((asset) => `- ${asset.id}${asset.filename ? ` (${asset.filename})` : ""}`)
      .join("\n")}`,
  );
}
