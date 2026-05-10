import { describe, expect, it } from "vitest";
import { collectProjectMediaUsages, isCurrentProjectShape } from "../db";
import type { Project } from "../types";

describe("isCurrentProjectShape", () => {
  it("rejects incompatible old project rows at the load guard boundary", () => {
    const oldProject = {
      id: "old-project",
      name: "Old Project",
      clips: [{ id: "legacy-clip", mediaId: "legacy-media" }],
    };

    expect(isCurrentProjectShape(oldProject)).toBe(false);
  });
});

describe("collectProjectMediaUsages", () => {
  it("collects project media from the canonical HF asset registry", () => {
    const project = {
      id: "project-1",
      name: "Project",
      createdAt: 0,
      updatedAt: 0,
      hf: {
        id: "project-1",
        name: "Project",
        width: 1920,
        height: 1080,
        fps: 30,
        duration: 5,
        assets: [
          {
            id: "image-media",
            filename: "image.png",
            mimeType: "image/png",
            kind: "image",
          },
          {
            id: "voice-media",
            filename: "voice.mp3",
            mimeType: "audio/mpeg",
            kind: "audio",
          },
        ],
        rootHtml: `<img id="image-clip" src="asset:image-media" /><audio id="audio" src="asset:voice-media"></audio>`,
        compositionHtml: {},
      },
      editorMeta: {
        tracks: [],
        clips: {
          "image-clip": { kind: "image", name: "Image" },
          "char-clip": {
            kind: "character",
            name: "Character",
            lipSyncAudioId: "voice-media",
          },
        },
      },
    } satisfies Project;

    expect(collectProjectMediaUsages(project).map((usage) => usage.mediaId)).toEqual([
      "image-media",
      "voice-media",
    ]);
  });
});
