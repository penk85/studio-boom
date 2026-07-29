import { uid } from "./db";
import { retargetCompositionIdInHtml } from "./hyperframes/html";
import { cloneProject } from "./project-utils";
import type { Project } from "./types";

interface DuplicateProjectOptions {
  id?: string;
  name?: string;
  now?: number;
}

export function createDuplicatedProject(
  project: Project,
  options: DuplicateProjectOptions = {},
): Project {
  const id = options.id ?? uid();
  const now = options.now ?? Date.now();
  const name = options.name ?? `${project.name} Copy`;
  const clone = cloneProject(project);
  const previousRootId = clone.hf.id || clone.id;

  return {
    ...clone,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    hf: {
      ...clone.hf,
      id,
      name,
      rootHtml: retargetCompositionIdInHtml(clone.hf.rootHtml, previousRootId, id),
    },
  };
}

export function createUniqueProjectName(baseName: string, existingNames: Iterable<string>): string {
  const trimmedBase = baseName.trim() || "Untitled Movie";
  const names = new Set(Array.from(existingNames, (name) => name.trim().toLowerCase()));
  if (!names.has(trimmedBase.toLowerCase())) return trimmedBase;

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${trimmedBase} ${index}`;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }

  return `${trimmedBase} ${Date.now()}`;
}
