import { describe, expect, it } from "vitest";
import { getProjectThumbnailCacheKey } from "../project-thumbnail-cache";
import type { Project } from "../types";

function makeProject(patch: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    name: "Project",
    createdAt: 1,
    updatedAt: 1,
    hf: {
      id: "project-1",
      name: "Project",
      width: 1920,
      height: 1080,
      fps: 30,
      duration: 5,
      assets: [],
      rootHtml: "<html><body><div>Frame</div></body></html>",
      compositionHtml: {},
    },
    editorMeta: {
      tracks: [],
      clips: {},
    },
    ...patch,
  };
}

describe("getProjectThumbnailCacheKey", () => {
  it("stays stable when only project timestamps change", () => {
    const project = makeProject();
    const updated = { ...project, updatedAt: 2 };

    expect(getProjectThumbnailCacheKey(updated)).toBe(getProjectThumbnailCacheKey(project));
  });

  it("changes when the renderable HyperFrames source changes", () => {
    const project = makeProject();
    const updated = {
      ...project,
      hf: {
        ...project.hf,
        rootHtml: "<html><body><div>Updated frame</div></body></html>",
      },
    };

    expect(getProjectThumbnailCacheKey(updated)).not.toBe(getProjectThumbnailCacheKey(project));
  });
});
