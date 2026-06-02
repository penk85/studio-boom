import { describe, expect, it } from "vitest";
import { createDuplicatedProject, createUniqueProjectName } from "../project-actions";
import type { Project } from "../types";

function makeProject(): Project {
  return {
    id: "project-a",
    name: "Launch Clip",
    createdAt: 1,
    updatedAt: 2,
    hf: {
      id: "project-a",
      name: "Launch Clip",
      width: 1920,
      height: 1080,
      fps: 30,
      duration: 10,
      assets: [{ id: "media-1", filename: "image.png", mimeType: "image/png", kind: "image" }],
      rootHtml: `<!DOCTYPE html>
<html data-composition-id="project-a"><body><div id="stage" data-composition-id="project-a"></div><script>window.__timelines = {"project-a": tl};</script></body></html>`,
      compositionHtml: {
        "comp-1": "<html><body>Nested</body></html>",
      },
    },
    editorMeta: {
      tracks: [],
      clips: {
        "clip-1": { kind: "image", mediaId: "media-1", name: "Image" },
      },
    },
  };
}

describe("project actions", () => {
  it("duplicates a project with a fresh project id while preserving clip/media references", () => {
    const duplicate = createDuplicatedProject(makeProject(), {
      id: "project-b",
      name: "Launch Clip Copy",
      now: 3,
    });

    expect(duplicate.id).toBe("project-b");
    expect(duplicate.name).toBe("Launch Clip Copy");
    expect(duplicate.hf.id).toBe("project-b");
    expect(duplicate.hf.rootHtml).toContain('data-composition-id="project-b"');
    expect(duplicate.hf.rootHtml).toContain('"project-b"');
    expect(duplicate.hf.assets[0]?.id).toBe("media-1");
    expect(duplicate.editorMeta.clips["clip-1"]?.mediaId).toBe("media-1");
  });

  it("creates a unique copy name", () => {
    expect(createUniqueProjectName("Launch Clip Copy", ["Launch Clip Copy"])).toBe(
      "Launch Clip Copy 2",
    );
  });
});
