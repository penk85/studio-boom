import { describe, expect, it } from "vitest";
import { collectProjectMediaUsages, isCurrentProjectShape } from "../db";
import type { Project } from "../types";

describe("isCurrentProjectShape", () => {
  it("rejects non-current project rows at the load guard boundary", () => {
    const incompatibleProject = {
      id: "incompatible-project",
      name: "Incompatible Project",
      clips: [{ id: "clip", mediaId: "media" }],
    };

    expect(isCurrentProjectShape(incompatibleProject)).toBe(false);
  });

  it("rejects legacy flat character clip metadata", () => {
    const legacyProject = {
      id: "legacy-character-project",
      name: "Legacy Character Project",
      hf: {
        assets: [],
        rootHtml: "<html></html>",
        compositionHtml: {},
      },
      editorMeta: {
        tracks: [],
        clips: {
          "char-1": {
            kind: "character",
            characterId: "actor",
            lipSyncAudioId: "voice-media",
          },
        },
      },
    };

    expect(isCurrentProjectShape(legacyProject)).toBe(false);
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
            kind: "composition",
            compositionKind: "character",
            compositionId: "char-clip",
            name: "Character",
            character: {
              characterId: "character-1",
              poses: {},
              lipSyncAudioId: "voice-media",
            },
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
