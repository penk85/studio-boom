import { uid } from "./db";
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
      rootHtml: retargetRootCompositionId(clone.hf.rootHtml, previousRootId, id),
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

function cloneProject(project: Project): Project {
  return JSON.parse(JSON.stringify(project)) as Project;
}

function retargetRootCompositionId(html: string, previousId: string, nextId: string): string {
  if (!html || previousId === nextId) return html;
  const previousLiteral = JSON.stringify(previousId);
  const nextLiteral = JSON.stringify(nextId);

  if (typeof DOMParser === "undefined") {
    return html.split(previousLiteral).join(nextLiteral);
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const element of doc.querySelectorAll("[data-composition-id]")) {
    if (element.getAttribute("data-composition-id") === previousId) {
      element.setAttribute("data-composition-id", nextId);
    }
  }

  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`
    .split(previousLiteral)
    .join(nextLiteral);
}
