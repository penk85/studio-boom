import { describe, expect, it } from "vitest";
import {
  collectCharacterMediaUsages,
  collectProjectMediaUsages,
  isCurrentProjectShape,
  requireCurrentProjectShape,
} from "../db";
import type { CharacterPreset, Project } from "../types";

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

  it("fails incompatible loads with a recovery-safe message", () => {
    expect(() => requireCurrentProjectShape({ id: "legacy" }, "legacy")).toThrow(
      /stored project was preserved/i,
    );
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

describe("collectCharacterMediaUsages", () => {
  it("counts rich variant-package artwork as character-owned media", () => {
    const character = {
      id: "character-1",
      name: "Actor",
      canvasWidth: 600,
      canvasHeight: 900,
      angles: ["front"],
      parts: [],
      manifest: {
        hasHead: true,
        hasBody: true,
        hasArms: true,
        hasHands: true,
        hasLegs: true,
        hasFeet: true,
        hasEyes: true,
        hasIrises: true,
        hasBrows: true,
        hasNose: true,
        hasMouth: true,
        hasHair: true,
        hasAccessories: true,
      },
      parallax: { onCamera: true, onClip: true, intensity: 0.15 },
      variantPackages: [
        {
          id: "variant:bent-arm",
          slotId: "slot:right-arm",
          displayName: "Bent arm",
          artwork: {
            layers: [
              { id: "upper-arm-layer", mediaId: "upper-arm-media", name: "Upper arm" },
              { id: "forearm-layer", mediaId: "forearm-media", name: "Forearm" },
            ],
          },
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    } satisfies CharacterPreset;

    expect(collectCharacterMediaUsages(character)).toEqual([
      {
        mediaId: "upper-arm-media",
        kind: "variant-package-artwork",
        ownerId: "character-1",
        ownerName: "Actor",
        detail: "Upper arm",
      },
      {
        mediaId: "forearm-media",
        kind: "variant-package-artwork",
        ownerId: "character-1",
        ownerName: "Actor",
        detail: "Forearm",
      },
    ]);
  });
});
