// Browser client for local HyperFrames CLI rendering.
// The browser builds the real project files, then the Vite dev server writes
// them to a temporary project directory and runs `hyperframes render`.
// This path consumes project.hf only; it must not compile from editorMeta.
import type { Project } from "../types";
import { buildHyperframesProjectFiles } from "./project-files";

export interface RenderProjectResult {
  url: string;
  log: string;
}

export async function renderProjectToMp4(project: Project): Promise<RenderProjectResult> {
  const files = await buildHyperframesProjectFiles(project);
  const form = new FormData();

  form.append("projectName", project.hf.name);
  for (const file of files.textFiles) {
    form.append("file", new Blob([file.contents], { type: file.mimeType }), file.path);
  }
  for (const file of files.binaryFiles) {
    form.append("file", file.blob, file.path);
  }

  const response = await fetch("/api/hyperframes/render", {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const result = (await response.json()) as RenderProjectResult;
  downloadResult(result.url, `${project.hf.name || "studio-boom"}.mp4`);
  return result;
}

function downloadResult(url: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeDownloadName(filename);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

function safeDownloadName(filename: string): string {
  const cleaned = filename.replace(/[^a-z0-9\-_. ]/gi, "").trim();
  return cleaned || "studio-boom.mp4";
}
