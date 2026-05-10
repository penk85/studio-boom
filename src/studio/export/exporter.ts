// Assembles and downloads a HyperFrames-compliant ZIP package from a project.
// Reads from project.hf (Layer 2) only — pure serialization, no computation.
// Blobs are fetched from Dexie by the IDs already in hf.assets.
import JSZip from "jszip";
import type { Project } from "../types";
import { buildHyperframesProjectFiles } from "./project-files";
export { assertExportBlobsPresent } from "./project-files";

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Builds a HyperFrames-compliant ZIP and triggers a browser download.
 * Reads project.hf (Layer 2) only — does not touch project.editorMeta.
 * hf.assets is the canonical asset registry; no graph traversal is done here.
 */
export async function exportProject(project: Project): Promise<void> {
  const files = await buildHyperframesProjectFiles(project);

  // ── Assemble ZIP ─────────────────────────────────────────────────────────
  const zip = new JSZip();

  for (const file of files.textFiles) {
    zip.file(file.path, file.contents);
  }
  for (const file of files.binaryFiles) {
    zip.file(file.path, file.blob);
  }

  // ── Download ─────────────────────────────────────────────────────────────
  const zipBlob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(zipBlob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${project.hf.name.replace(/[^a-z0-9\-_ ]/gi, "")}.zip`.trim() || "export.zip";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
