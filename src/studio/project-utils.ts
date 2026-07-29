// Pure project utilities shared by history and project-management actions.
import type { Project } from "./types";

/** Clone the JSON-shaped project snapshot used by history and duplication. */
export function cloneProject(project: Project): Project {
  return JSON.parse(JSON.stringify(project)) as Project;
}
