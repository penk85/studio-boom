// Assembles and downloads a HyperFrames-compliant ZIP package from a project.
// Reads from project.hf (Layer 2) only — pure serialization, no computation.
// Blobs are fetched from Dexie by the IDs already in hf.assets.
import JSZip from "jszip";
import { db } from "../db";
import type { Project } from "../types";
import { buildMainHtml } from "./html-builder";
import { buildCompositionHtml } from "./composition-builder";
import { validateHfProject } from "./bake";
import gsapRaw from "gsap/dist/gsap.min.js?raw";

// ─── MIME → extension mapping ─────────────────────────────────────────────────

function extFromAsset(filename: string, mimeType: string): string {
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

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Builds a HyperFrames-compliant ZIP and triggers a browser download.
 * Reads project.hf (Layer 2) only — does not touch project.editorMeta.
 * hf.assets is the canonical asset registry; no graph traversal is done here.
 */
export async function exportProject(project: Project): Promise<void> {
  const { hf } = project;

  // ── Staleness guard ─────────────────────────────────────────────────────
  for (const composition of hf.compositions) {
    if (composition.dirty) {
      throw new Error(
        `Composition "${composition.id}" (clip "${composition.sourceClipId}") is dirty — ` +
          `this is a bug in a store action. Save and re-open the project, or contact support.`,
      );
    }
  }

  // ── Asset closure check ─────────────────────────────────────────────────
  validateHfProject(hf);

  // ── Build mediaExtMap from hf.assets ────────────────────────────────────
  const mediaExtMap = new Map<string, string>();
  for (const asset of hf.assets) {
    mediaExtMap.set(asset.id, extFromAsset(asset.filename, asset.mimeType));
  }

  // ── Fetch blobs for exactly the IDs in hf.assets ────────────────────────
  const assetIds = hf.assets.map((a) => a.id);
  const mediaBlobs = await db.mediaBlobs.where("id").anyOf(assetIds).toArray();
  const blobMap = new Map(mediaBlobs.map((b) => [b.id, b.blob]));

  // ── Assemble ZIP ─────────────────────────────────────────────────────────
  const zip = new JSZip();

  zip.file("index.html", buildMainHtml(hf, mediaExtMap));
  zip.file("gsap.min.js", gsapRaw);

  for (const asset of hf.assets) {
    const blob = blobMap.get(asset.id);
    if (!blob) continue;
    const ext = mediaExtMap.get(asset.id) ?? "";
    zip.file(`assets/${asset.id}${ext}`, blob);
  }

  for (const composition of hf.compositions) {
    const html = buildCompositionHtml(composition, mediaExtMap);
    zip.file(`compositions/${composition.id}.html`, html);
  }

  // ── Download ─────────────────────────────────────────────────────────────
  const zipBlob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(zipBlob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download =
    `${hf.name.replace(/[^a-z0-9\-_ ]/gi, "")}.zip`.trim() || "export.zip";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
