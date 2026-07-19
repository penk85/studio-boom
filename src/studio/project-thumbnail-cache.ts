import type { Project } from "./types";

const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

export function getProjectThumbnailCacheKey(project: Project): string {
  let hash = FNV_OFFSET_BASIS;
  hash = hashText(hash, String(project.hf.width));
  hash = hashText(hash, String(project.hf.height));
  hash = hashText(hash, String(project.hf.fps));
  hash = hashText(hash, String(project.hf.duration));
  hash = hashText(hash, project.hf.rootHtml);

  for (const [compositionId, html] of Object.entries(project.hf.compositionHtml).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    hash = hashText(hash, compositionId);
    hash = hashText(hash, html);
  }

  for (const asset of [...project.hf.assets].sort((a, b) => a.id.localeCompare(b.id))) {
    hash = hashText(hash, asset.id);
    hash = hashText(hash, asset.kind ?? "");
    hash = hashText(hash, asset.mimeType ?? "");
    hash = hashText(hash, asset.filename ?? "");
  }

  return `${project.hf.width}x${project.hf.height}:${(hash >>> 0).toString(36)}`;
}

function hashText(seed: number, text: string): number {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}
