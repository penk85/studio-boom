// Project persistence boundary for dashboard lifecycle operations and imports.
import { db, requireCurrentProjectShape } from "./db";
import { createDuplicatedProject } from "./project-actions";
import { projectEditLock } from "./project-lock";
import { getProjectThumbnailCacheKey } from "./project-thumbnail-cache";
import type { ImportedHyperframesProject } from "./project-import";
import type { Project } from "./types";

export { isCurrentProjectShape } from "./db";

export function listStoredProjects(): Promise<unknown[]> {
  return db.projects.orderBy("updatedAt").reverse().toArray();
}

export async function readStoredProject(projectId: string): Promise<Project> {
  const storedProject = (await db.projects.get(projectId)) as unknown;
  if (!storedProject) throw new Error(`Project "${projectId}" was not found.`);
  return requireCurrentProjectShape(storedProject, projectId);
}

export async function renameStoredProject(projectId: string, name: string): Promise<void> {
  await projectEditLock.runExclusive(projectId, async () => {
    const current = await readStoredProject(projectId);
    await db.projects.put({
      ...current,
      name,
      updatedAt: Date.now(),
      hf: { ...current.hf, name },
    });
  });
}

export async function duplicateStoredProject(projectId: string, name: string): Promise<void> {
  await projectEditLock.runExclusive(projectId, async () => {
    const current = await readStoredProject(projectId);
    const duplicate = createDuplicatedProject(current, { name });
    const sourceCacheKey = getProjectThumbnailCacheKey(current);
    const duplicateCacheKey = getProjectThumbnailCacheKey(duplicate);

    await db.transaction("rw", db.projects, db.projectThumbnails, async () => {
      await db.projects.add(duplicate);
      const cachedThumbnail = await db.projectThumbnails.get(projectId);
      if (cachedThumbnail?.cacheKey === sourceCacheKey) {
        await db.projectThumbnails.put({
          projectId: duplicate.id,
          cacheKey: duplicateCacheKey,
          blob: cachedThumbnail.blob,
          mimeType: cachedThumbnail.mimeType,
          generatedAt: Date.now(),
        });
      }
    });
  });
}

export async function deleteStoredProject(projectId: string): Promise<void> {
  await projectEditLock.runExclusive(projectId, async () => {
    await db.transaction("rw", db.projects, db.projectThumbnails, async () => {
      await db.projects.delete(projectId);
      await db.projectThumbnails.delete(projectId);
    });
  });
}

export async function persistImportedProject(imported: ImportedHyperframesProject): Promise<void> {
  await db.transaction("rw", db.projects, db.media, db.mediaBlobs, async () => {
    await db.projects.add(imported.project);
    if (imported.mediaFiles.length > 0) {
      await db.media.bulkAdd(imported.mediaFiles.map(({ asset }) => asset));
      await db.mediaBlobs.bulkAdd(imported.mediaFiles.map(({ mediaBlob }) => mediaBlob));
    }
  });
}

export async function readStoredProjectThumbnail(
  projectId: string,
  cacheKey: string,
): Promise<Blob | null> {
  const cached = await db.projectThumbnails.get(projectId);
  return cached?.cacheKey === cacheKey ? cached.blob : null;
}

export async function writeStoredProjectThumbnail(
  projectId: string,
  cacheKey: string,
  blob: Blob,
): Promise<void> {
  await db.projectThumbnails.put({
    projectId,
    cacheKey,
    blob,
    mimeType: blob.type || "image/png",
    generatedAt: Date.now(),
  });
}
