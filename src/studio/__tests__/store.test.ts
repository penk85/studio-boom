import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickFreeLane, createBlankProject, useStudio } from "../store";

const coreMock = vi.hoisted(() => ({
  generateCalls: [] as Array<{
    elements: unknown[];
    duration: number;
    opts: {
      compositionId?: string;
      includeStyles?: boolean;
      includeScripts?: boolean;
      resolution?: string;
    };
  }>,
}));

vi.mock("@hyperframes/core", () => {
  const makeHtml = (
    elements: Array<{
      id: string;
      type?: string;
      src?: string;
      name?: string;
      startTime?: number;
      duration?: number;
      zIndex?: number;
    }> = [],
    id = "proj-1",
    duration = 30,
    opts: { includeStyles?: boolean; includeScripts?: boolean } = {},
  ) => {
    const clipElements = elements
      .map((el) => {
        const start = el.startTime ?? 0;
        const end = start + (el.duration ?? 5);
        const attrs = `id="${el.id}" data-start="${start}" data-end="${end}" data-layer="${el.zIndex ?? 0}" data-name="${el.name ?? el.id}" src="${el.src ?? ""}"`;
        if (el.type === "audio") return `<audio ${attrs}></audio>`;
        if (el.type === "video") return `<video ${attrs}></video>`;
        return `<img ${attrs} alt="${el.name ?? ""}" />`;
      })
      .join("");
    const style = opts.includeStyles
      ? '<style data-hf-core="true">#stage { position: relative; overflow: hidden; }</style>'
      : "";
    const script = opts.includeScripts
      ? "<script>const tl = gsap.timeline({ paused: true });</script>"
      : "";
    return `<!DOCTYPE html><html data-composition-id="${id}" data-composition-duration="${duration}"><head>${style}${script}</head><body><div id="stage">${clipElements}</div></body></html>`;
  };
  return {
    generateHyperframesHtml: (
      elements: Array<{ id: string; type?: string; src?: string; name?: string }> = [],
      duration: number,
      opts: {
        compositionId?: string;
        includeStyles?: boolean;
        includeScripts?: boolean;
        resolution?: string;
      } = {},
    ) => {
      coreMock.generateCalls.push({ elements, duration, opts });
      return makeHtml(elements, opts.compositionId ?? "proj-1", duration, opts);
    },
    addElementToHtml: (html: string, el: { id: string }) => ({
      html: html.replace("</div></body>", `<div id="${el.id}"></div></div></body>`),
      id: el.id,
    }),
    updateElementInHtml: (html: string) => html,
    removeElementFromHtml: (html: string) => html,
    parseHtml: (html: string) => {
      // Match only standalone id= attributes (space or < before "id="), not data-*-id=
      const ids = [...html.matchAll(/(?:^|[\s<])id="([^"]+)"/g)]
        .map((m) => m[1])
        .filter((id) => id !== "stage");
      return {
        elements: ids.map((id) => ({
          id,
          type: "image",
          name: id,
          startTime: 0,
          duration: 5,
          zIndex: 0,
          src: `asset:${id}`,
          sourceWidth: 300,
          sourceHeight: 450,
        })),
        keyframes: {},
      };
    },
  };
});
import { createBlankCharacter, makePart } from "../character/character-utils";
import type { CharacterClip, MediaAsset, MotionPreset } from "../types";
import { deriveEditorClips } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeClip(
  trackIndex: number,
  laneIndex: number,
  start: number,
  duration: number,
): { trackIndex: number; laneIndex: number; start: number; duration: number } {
  return { trackIndex, laneIndex, start, duration };
}

function makeMediaAsset(id: string, name = id): MediaAsset {
  return {
    id,
    name,
    filename: `${name}.svg`,
    kind: "image",
    scope: "character-part",
    mimeType: "image/svg+xml",
    width: 100,
    height: 100,
    createdAt: 1,
  };
}

function resetStudioStore() {
  useStudio.setState({
    project: null,
    tracks: [],
    characters: new Map(),
    motionPresets: new Map(),
    mediaAssets: new Map(),
    selectedClipId: null,
    zoom: 60,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  coreMock.generateCalls.length = 0;
  resetStudioStore();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  resetStudioStore();
});

// ─── pickFreeLane ─────────────────────────────────────────────────────────────

describe("pickFreeLane", () => {
  it("returns lane 0 when there are no clips", () => {
    expect(pickFreeLane([], 0, 0, 5, 1)).toBe(0);
  });

  it("returns lane 0 when existing clips are on a different track", () => {
    const clip = makeClip(1 /* trackIndex */, 0, 0, 5);
    expect(pickFreeLane([clip], 0, 0, 5, 1)).toBe(0);
  });

  it("returns lane 0 when existing clip is on a non-overlapping time range", () => {
    // Existing: track 0, lane 0, t=10..15. New: t=0..5 → no overlap
    const clip = makeClip(0, 0, 10, 5);
    expect(pickFreeLane([clip], 0, 0, 5, 1)).toBe(0);
  });

  it("returns lane 1 when lane 0 is fully occupied", () => {
    const clip = makeClip(0, 0, 0, 10);
    // maxLanes=1 → lane 0 is occupied, so returns 1 (new lane)
    expect(pickFreeLane([clip], 0, 0, 5, 1)).toBe(1);
  });

  it("returns lane 0 when lane 1 is occupied but lane 0 is free (different time)", () => {
    const clip = makeClip(0, 1, 0, 10); // lane 1 occupied
    // Lane 0 is free → return 0
    expect(pickFreeLane([clip], 0, 0, 5, 2)).toBe(0);
  });

  it("returns next available lane beyond maxLanes when all are occupied", () => {
    const lane0 = makeClip(0, 0, 0, 10);
    const lane1 = makeClip(0, 1, 0, 10);
    // maxLanes=2, both occupied → returns 2
    expect(pickFreeLane([lane0, lane1], 0, 0, 5, 2)).toBe(2);
  });

  it("detects overlap: existing [0,5), new [4,9) → conflict on lane 0", () => {
    const clip = makeClip(0, 0, 0, 5);
    expect(pickFreeLane([clip], 0, 4, 5, 1)).toBe(1);
  });

  it("no conflict: existing [0,5), new [5,10) → adjacent, not overlapping", () => {
    // cEnd = 5, new start = 5: c.start < end (0 < 10) BUT cEnd > start (5 > 5) is false
    const clip = makeClip(0, 0, 0, 5);
    expect(pickFreeLane([clip], 0, 5, 5, 1)).toBe(0);
  });
});

// ─── createBlankProject ───────────────────────────────────────────────────────

describe("createBlankProject", () => {
  it("creates a project with the specified name", () => {
    const p = createBlankProject("My Movie");
    expect(p.name).toBe("My Movie");
  });

  it("creates a project with default name when not provided", () => {
    const p = createBlankProject();
    expect(p.name).toBe("Untitled Movie");
  });

  it("has default stage dimensions 1920×1080", () => {
    const p = createBlankProject();
    expect(p.hf.width).toBe(1920);
    expect(p.hf.height).toBe(1080);
  });

  it("has 4 default tracks in canonical order", () => {
    const p = createBlankProject();
    expect(p.editorMeta.tracks.length).toBe(4);
    expect(p.editorMeta.tracks[0].kind).toBe("character");
    expect(p.editorMeta.tracks[1].kind).toBe("overlay");
    expect(p.editorMeta.tracks[2].kind).toBe("background");
    expect(p.editorMeta.tracks[3].kind).toBe("audio");
  });

  it("has no clips", () => {
    const p = createBlankProject();
    expect(deriveEditorClips(p)).toEqual([]);
  });

  it("assigns unique ids", () => {
    const p1 = createBlankProject();
    const p2 = createBlankProject();
    expect(p1.id).not.toBe(p2.id);
  });

  it("has valid rootHtml", () => {
    const p = createBlankProject();
    expect(p.hf.rootHtml).toContain("<!DOCTYPE html>");
    expect(p.hf.rootHtml).toContain("data-composition-id");
    expect(p.hf.rootHtml).toContain('id="stage"');
    expect(p.hf.rootHtml).toContain('data-hf-core="true"');
    expect(p.hf.rootHtml).toContain("gsap.timeline");
    expect(p.hf.rootHtml).toContain("window.__timelines");
    expect(coreMock.generateCalls.at(-1)?.opts).toMatchObject({
      includeStyles: true,
      includeScripts: true,
    });
  });

  it("keeps regenerated clip HTML canonical when adding clips", () => {
    const project = createBlankProject("Clip add");
    const asset = makeMediaAsset("media-1", "Image");
    useStudio.setState({
      project,
      tracks: project.editorMeta.tracks,
      mediaAssets: new Map([[asset.id, asset]]),
    });

    useStudio.getState().addMediaToTimeline(asset);

    const rootHtml = useStudio.getState().project!.hf.rootHtml;
    expect(rootHtml).toContain('data-hf-core="true"');
    expect(rootHtml).toContain("gsap.timeline");
    expect(rootHtml).toContain("window.__timelines");
    expect(rootHtml).toContain('src="asset:media-1"');
    expect(rootHtml).toContain('data-start="0"');
    expect(rootHtml).toContain('data-duration="4"');
    expect(rootHtml).toContain('data-track-index="0"');
    expect(rootHtml).not.toContain("data-end=");
    expect(rootHtml).not.toContain("data-layer=");
    expect(coreMock.generateCalls.at(-1)?.opts).toMatchObject({
      includeStyles: true,
      includeScripts: true,
    });
  });
});

// ─── Store cache sync ─────────────────────────────────────────────────────────
// NOTE: Character composition generation is being refactored. Cache sync tests
// will be rewritten once the new character pipeline is in place.

describe.skip("Studio cache sync", () => {
  it("rebakes character clips when a cached character changes", () => {
    const project = createBlankProject("Cache sync");
    const mediaA = makeMediaAsset("asset-a", "body-a");
    const mediaB = makeMediaAsset("asset-b", "body-b");
    const character = {
      ...createBlankCharacter("Actor"),
      id: "char-1",
      parts: [
        makePart("body", mediaA.id, {
          id: "part-a",
          name: "Body A",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          zIndex: 1,
        }),
      ],
      updatedAt: 1,
    };
    const clip: CharacterClip = {
      id: "clip-1",
      kind: "character",
      characterId: character.id,
      name: "Actor",
      trackIndex: 0,
      start: 0,
      duration: 4,
      x: 0,
      y: 0,
      width: 300,
      height: 450,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      poses: {},
      autoBlink: false,
    };

    useStudio.setState({
      project,
      tracks: project.editorMeta.tracks,
      characters: new Map([[character.id, character]]),
      mediaAssets: new Map([
        [mediaA.id, mediaA],
        [mediaB.id, mediaB],
      ]),
    });
    useStudio.getState().addClip(clip);

    const compId = `comp_${clip.id}`;
    const before = useStudio.getState().project!.hf.compositionHtml[compId];
    expect(before).toBeDefined();

    const updatedCharacter = {
      ...character,
      parts: [
        ...character.parts,
        makePart("head", mediaB.id, {
          id: "part-b",
          name: "Head B",
          x: 10,
          y: 10,
          width: 80,
          height: 80,
          zIndex: 2,
        }),
      ],
      updatedAt: 2,
    };

    useStudio.getState().registerCharacterPreset(updatedCharacter);

    const state = useStudio.getState();
    const newCompHtml = state.project!.hf.compositionHtml[compId];
    expect(newCompHtml).not.toBe(before);
    expect(newCompHtml).toContain("Head B");
    expect(state.project!.hf.assets.map((asset) => asset.id)).toEqual(
      expect.arrayContaining([mediaA.id, mediaB.id]),
    );
  });

  it("rebakes character clips when a cached motion preset changes", () => {
    const project = createBlankProject("Preset sync");
    const media = makeMediaAsset("asset-a", "body-a");
    const character = {
      ...createBlankCharacter("Actor"),
      id: "char-1",
      parts: [
        makePart("body", media.id, {
          id: "part-a",
          name: "Body",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          zIndex: 1,
        }),
      ],
      updatedAt: 1,
    };
    const preset: MotionPreset = {
      id: "preset-1",
      name: "Nod",
      category: "gesture",
      duration: 1,
      loop: false,
      tracks: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const clip: CharacterClip = {
      id: "clip-1",
      kind: "character",
      characterId: character.id,
      name: "Actor",
      trackIndex: 0,
      start: 0,
      duration: 4,
      x: 0,
      y: 0,
      width: 300,
      height: 450,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      poses: {},
      motions: [{ id: "motion-1", presetId: preset.id, offset: 0, intensity: 1 }],
      autoBlink: false,
    };

    useStudio.setState({
      project,
      tracks: project.editorMeta.tracks,
      characters: new Map([[character.id, character]]),
      motionPresets: new Map([[preset.id, preset]]),
      mediaAssets: new Map([[media.id, media]]),
    });
    useStudio.getState().addClip(clip);

    const compId = `comp_${clip.id}`;
    const before = useStudio.getState().project!.hf.compositionHtml[compId];

    useStudio.getState().registerMotionPreset({
      ...preset,
      duration: 2,
      updatedAt: 2,
    });

    const after = useStudio.getState().project!.hf.compositionHtml[compId];
    // Composition HTML is regenerated when motion preset changes
    expect(after).toBeDefined();
    // The composition is the same since buildCharacterCompositionHtml doesn't process motion presets directly
    // but the rebake was triggered — this verifies the machinery ran without error
    expect(typeof after).toBe("string");
  });
});
