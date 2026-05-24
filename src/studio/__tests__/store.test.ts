import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  pickFreeLane,
  createBlankProject,
  syncProjectRenderTrackIndices,
  useStudio,
} from "../store";

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
  addCalls: 0,
  updateCalls: 0,
  removeCalls: 0,
}));

vi.mock("@hyperframes/core", () => {
  const createClipNode = (
    doc: Document,
    element: {
      id?: string;
      type?: string;
      src?: string;
      name?: string;
      startTime?: number;
      duration?: number;
      zIndex?: number;
      x?: number;
      y?: number;
      sourceWidth?: number;
      sourceHeight?: number;
      opacity?: number;
      rotation?: number;
      compositionId?: string;
      content?: string;
      color?: string;
      fontSize?: number;
      fontFamily?: string;
      fontWeight?: number;
    },
  ) => {
    const tagName =
      element.type === "audio"
        ? "audio"
        : element.type === "video"
          ? "video"
          : element.type === "composition"
            ? "div"
            : element.type === "text"
              ? "div"
              : "img";
    const node = doc.createElement(tagName);
    node.setAttribute("id", element.id ?? "generated-id");
    node.setAttribute("data-start", String(element.startTime ?? 0));
    node.setAttribute("data-duration", String(element.duration ?? 5));
    node.setAttribute("data-track-index", String(element.zIndex ?? 0));
    node.setAttribute("data-name", element.name ?? element.id ?? "");
    if (element.src) node.setAttribute("src", element.src);
    if (element.x !== undefined) node.setAttribute("data-x", String(element.x));
    if (element.y !== undefined) node.setAttribute("data-y", String(element.y));
    if (element.sourceWidth !== undefined)
      node.setAttribute("data-source-width", String(element.sourceWidth));
    if (element.sourceHeight !== undefined)
      node.setAttribute("data-source-height", String(element.sourceHeight));
    if (element.opacity !== undefined) node.setAttribute("data-opacity", String(element.opacity));
    if (element.rotation !== undefined)
      node.setAttribute("data-rotation", String(element.rotation));
    if (element.type === "composition") {
      node.setAttribute("data-type", "composition");
      node.setAttribute("data-composition-id", element.compositionId ?? "");
      if (element.src) node.setAttribute("data-composition-src", element.src);
    }
    if (element.type === "text") {
      node.setAttribute("data-type", "text");
      if (element.color) node.setAttribute("data-color", element.color);
      if (element.fontSize !== undefined)
        node.setAttribute("data-font-size", String(element.fontSize));
      if (element.fontFamily) node.setAttribute("data-font-family", element.fontFamily);
      if (element.fontWeight !== undefined)
        node.setAttribute("data-font-weight", String(element.fontWeight));
      const textNode = doc.createElement("div");
      textNode.textContent = element.content ?? element.name ?? "";
      node.appendChild(textNode);
    }
    return node;
  };

  const serializeDoc = (doc: Document) => "<!DOCTYPE html>" + doc.documentElement.outerHTML;

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
    addElementToHtml: (
      html: string,
      el: {
        id?: string;
        type?: string;
        src?: string;
        name?: string;
        startTime?: number;
        duration?: number;
        zIndex?: number;
        x?: number;
        y?: number;
        sourceWidth?: number;
        sourceHeight?: number;
        opacity?: number;
        compositionId?: string;
        rotation?: number;
        content?: string;
        color?: string;
        fontSize?: number;
        fontFamily?: string;
        fontWeight?: number;
      },
    ) => {
      coreMock.addCalls += 1;
      const doc = new DOMParser().parseFromString(html, "text/html");
      doc.getElementById("stage")?.appendChild(createClipNode(doc, el));
      return { html: serializeDoc(doc), id: el.id ?? "generated-id" };
    },
    updateElementInHtml: (
      html: string,
      elementId: string,
      updates: {
        startTime?: number;
        duration?: number;
        zIndex?: number;
        name?: string;
        src?: string;
        sourceWidth?: number;
        sourceHeight?: number;
        x?: number;
        y?: number;
        opacity?: number;
        rotation?: number;
        content?: string;
        color?: string;
        fontSize?: number;
        fontFamily?: string;
        fontWeight?: number;
      },
    ) => {
      coreMock.updateCalls += 1;
      const doc = new DOMParser().parseFromString(html, "text/html");
      const node = doc.getElementById(elementId);
      if (!node) return html;
      if (updates.startTime !== undefined)
        node.setAttribute("data-start", String(updates.startTime));
      if (updates.duration !== undefined)
        node.setAttribute("data-duration", String(updates.duration));
      if (updates.zIndex !== undefined)
        node.setAttribute("data-track-index", String(updates.zIndex));
      if (updates.name !== undefined) node.setAttribute("data-name", updates.name);
      if (updates.src !== undefined) node.setAttribute("src", updates.src);
      if (updates.sourceWidth !== undefined)
        node.setAttribute("data-source-width", String(updates.sourceWidth));
      if (updates.sourceHeight !== undefined)
        node.setAttribute("data-source-height", String(updates.sourceHeight));
      if (updates.x !== undefined) node.setAttribute("data-x", String(updates.x));
      if (updates.y !== undefined) node.setAttribute("data-y", String(updates.y));
      if (updates.opacity !== undefined) node.setAttribute("data-opacity", String(updates.opacity));
      if (updates.rotation !== undefined)
        node.setAttribute("data-rotation", String(updates.rotation));
      if (updates.content !== undefined) {
        const textNode = node.firstElementChild ?? doc.createElement("div");
        textNode.textContent = updates.content;
        if (!textNode.parentElement) node.appendChild(textNode);
      }
      if (updates.color !== undefined) node.setAttribute("data-color", updates.color);
      if (updates.fontSize !== undefined)
        node.setAttribute("data-font-size", String(updates.fontSize));
      if (updates.fontFamily !== undefined)
        node.setAttribute("data-font-family", updates.fontFamily);
      if (updates.fontWeight !== undefined)
        node.setAttribute("data-font-weight", String(updates.fontWeight));
      return serializeDoc(doc);
    },
    removeElementFromHtml: (html: string, elementId: string) => {
      coreMock.removeCalls += 1;
      const doc = new DOMParser().parseFromString(html, "text/html");
      doc.getElementById(elementId)?.remove();
      return serializeDoc(doc);
    },
    parseHtml: (html: string) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const stage = doc.getElementById("stage");
      const elements = Array.from(stage?.children ?? []).map((node) => {
        const element = node as HTMLElement;
        const start = Number(element.getAttribute("data-start") ?? 0);
        const durationAttr = element.getAttribute("data-duration");
        const duration = durationAttr ? Number(durationAttr) : 5;
        const zIndex = Number(
          element.getAttribute("data-track-index") ?? element.getAttribute("data-layer") ?? 0,
        );
        const type =
          element.getAttribute("data-type") === "composition"
            ? "composition"
            : element.getAttribute("data-type") === "text"
              ? "text"
              : element.tagName.toLowerCase() === "audio"
                ? "audio"
                : element.tagName.toLowerCase() === "video"
                  ? "video"
                  : "image";
        return {
          id: element.id,
          type,
          name: element.getAttribute("data-name") ?? element.id,
          startTime: start,
          duration,
          zIndex,
          src:
            element.getAttribute("src") ??
            element.getAttribute("data-composition-src") ??
            `asset:${element.id}`,
          sourceWidth: Number(element.getAttribute("data-source-width") ?? 300),
          sourceHeight: Number(element.getAttribute("data-source-height") ?? 450),
          x: Number(element.getAttribute("data-x") ?? 0),
          y: Number(element.getAttribute("data-y") ?? 0),
          opacity: Number(element.getAttribute("data-opacity") ?? 1),
          rotation: Number(element.getAttribute("data-rotation") ?? 0),
          content: element.firstElementChild?.textContent ?? element.textContent ?? "",
          color: element.getAttribute("data-color") ?? undefined,
          fontSize: element.hasAttribute("data-font-size")
            ? Number(element.getAttribute("data-font-size"))
            : undefined,
          fontFamily: element.getAttribute("data-font-family") ?? undefined,
          fontWeight: element.hasAttribute("data-font-weight")
            ? Number(element.getAttribute("data-font-weight"))
            : undefined,
          compositionId: element.getAttribute("data-composition-id") ?? undefined,
        };
      });
      return {
        elements,
        keyframes: {},
      };
    },
  };
});
import { createBlankCharacter, makePart } from "../character/character-utils";
import type { CompositionClip, MediaAsset, MotionPreset, TextClip } from "../types";
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
    selectedKeyframe: null,
    zoom: 60,
    historyPast: [],
    historyFuture: [],
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  coreMock.generateCalls.length = 0;
  coreMock.addCalls = 0;
  coreMock.updateCalls = 0;
  coreMock.removeCalls = 0;
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

  it("keeps serialized clip HTML canonical when adding clips", () => {
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
    expect(rootHtml).toContain('data-track-index="1000"');
    expect(rootHtml).toContain('data-x="910"');
    expect(rootHtml).toContain('data-y="490"');
    expect(rootHtml).toContain('data-width="100"');
    expect(rootHtml).toContain('data-height="100"');
    expect(rootHtml).toContain("z-index: 0");
    expect(rootHtml).toContain("translate(910px, 490px)");
    expect(rootHtml).not.toContain("data-end=");
    expect(rootHtml).not.toContain("data-layer=");
    expect(coreMock.generateCalls.at(-1)?.opts).toMatchObject({
      includeStyles: true,
      includeScripts: true,
    });
  });

  it("keeps HyperFrames render tracks separate from visual z-index", () => {
    const project = createBlankProject("Track mapping");
    useStudio.setState({
      project,
      tracks: project.editorMeta.tracks,
    });

    useStudio.getState().addClip({
      id: "background-clip",
      kind: "text",
      name: "Background",
      content: "Back",
      trackIndex: 2,
      laneIndex: 0,
      start: 0,
      duration: 4,
      x: 0,
      y: 0,
      width: 400,
      height: 100,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
    });
    useStudio.getState().addClip({
      id: "overlay-clip",
      kind: "text",
      name: "Overlay",
      content: "Front",
      trackIndex: 1,
      laneIndex: 0,
      start: 0,
      duration: 4,
      x: 0,
      y: 140,
      width: 400,
      height: 100,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
    });

    const rootHtml = useStudio.getState().project!.hf.rootHtml;
    const doc = new DOMParser().parseFromString(rootHtml, "text/html");
    expect(doc.getElementById("background-clip")?.getAttribute("data-track-index")).toBe("2000");
    expect(doc.getElementById("overlay-clip")?.getAttribute("data-track-index")).toBe("1000");
    expect(rootHtml).toContain("z-index: 0");
    expect(rootHtml).toContain("z-index: 1");

    useStudio.getState().updateClip("overlay-clip", { trackIndex: 2, laneIndex: 1 });
    const updatedDoc = new DOMParser().parseFromString(
      useStudio.getState().project!.hf.rootHtml,
      "text/html",
    );
    expect(updatedDoc.getElementById("overlay-clip")?.getAttribute("data-track-index")).toBe(
      "2001",
    );
  });

  it("repairs overlapping clips that share the same editor lane", () => {
    const project = createBlankProject("Lane repair");
    const rootHtml = `<!DOCTYPE html>
<html data-composition-id="${project.id}" data-composition-duration="30">
  <body>
    <div id="stage" data-composition-id="${project.id}" data-start="0" data-duration="30">
      <img id="image-a" data-start="0" data-duration="4" data-track-index="1003" data-name="A" src="asset:a" />
      <img id="image-b" data-start="0" data-duration="4" data-track-index="1003" data-name="B" src="asset:b" />
    </div>
  </body>
</html>`;
    const repaired = syncProjectRenderTrackIndices({
      ...project,
      hf: { ...project.hf, rootHtml },
      editorMeta: {
        ...project.editorMeta,
        tracks: project.editorMeta.tracks.map((track, index) =>
          index === 1 ? { ...track, lanes: 4 } : track,
        ),
        clips: {
          "image-a": {
            kind: "image",
            mediaId: "a",
            uiTrackIndex: 1,
            uiLaneIndex: 3,
          },
          "image-b": {
            kind: "image",
            mediaId: "b",
            uiTrackIndex: 1,
            uiLaneIndex: 3,
          },
        },
      },
    });

    const doc = new DOMParser().parseFromString(repaired.hf.rootHtml, "text/html");
    expect(repaired.editorMeta.clips["image-a"]?.uiLaneIndex).toBe(3);
    expect(repaired.editorMeta.clips["image-b"]?.uiLaneIndex).toBe(4);
    expect(repaired.editorMeta.tracks[1]?.lanes).toBe(5);
    expect(doc.getElementById("image-a")?.getAttribute("data-track-index")).toBe("1003");
    expect(doc.getElementById("image-b")?.getAttribute("data-track-index")).toBe("1004");
  });

  it("adds text clips through canonical rootHtml", () => {
    const project = createBlankProject("Text clip");
    useStudio.setState({
      project,
      tracks: project.editorMeta.tracks,
    });

    const clip: TextClip = {
      id: "text-1",
      kind: "text",
      name: "Title",
      content: "Hello Studio",
      trackIndex: 1,
      start: 1,
      duration: 3,
      x: 120,
      y: 90,
      width: 640,
      height: 180,
      rotation: 0,
      opacity: 1,
      zIndex: 2,
      color: "#ffffff",
      fontSize: 72,
      fontFamily: "Inter",
      fontWeight: 700,
    };

    useStudio.getState().addClip(clip);

    const state = useStudio.getState();
    const rootHtml = state.project!.hf.rootHtml;
    const added = deriveEditorClips(state.project!).find((c) => c.id === clip.id);

    expect(rootHtml).toContain('data-type="text"');
    expect(rootHtml).toContain("Hello Studio");
    expect(rootHtml).toContain('data-font-size="72"');
    expect(rootHtml).toContain('data-font-family="Inter"');
    expect(added).toMatchObject({
      id: "text-1",
      kind: "text",
      content: "Hello Studio",
      width: 640,
      height: 180,
      fontSize: 72,
      fontFamily: "Inter",
      fontWeight: 700,
    });

    useStudio.getState().updateClip(clip.id, { content: "Updated", x: 240 });
    expect(useStudio.getState().project!.hf.rootHtml).toContain("Updated");
    expect(useStudio.getState().project!.hf.rootHtml).toContain('data-x="240"');
  });

  it("adds non-character composition clips with source html", () => {
    const project = createBlankProject("Composition clip");
    useStudio.setState({
      project,
      tracks: project.editorMeta.tracks,
    });

    const sourceHtml = `<!DOCTYPE html>
<html data-composition-id="ai-title" data-composition-duration="4">
  <body>
    <div id="stage" data-composition-id="ai-title" data-width="1920" data-height="1080">
      AI block
      <script>
        window.__timelines = window.__timelines || {};
        const tl = gsap.timeline({ paused: true });
        window.__timelines["ai-title"] = tl;
      </script>
    </div>
  </body>
</html>`;
    const clip: CompositionClip = {
      id: "composition-1",
      kind: "composition",
      compositionId: "ai-title",
      compositionKind: "ai-block",
      compositionHtml: sourceHtml,
      name: "AI Title",
      trackIndex: 1,
      start: 2,
      duration: 4,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      rotation: 0,
      opacity: 1,
      zIndex: 3,
    };

    useStudio.getState().addClip(clip);

    const state = useStudio.getState();
    const rootHtml = state.project!.hf.rootHtml;
    const added = deriveEditorClips(state.project!).find((c) => c.id === clip.id);

    expect(rootHtml).toContain('data-type="composition"');
    expect(rootHtml).toContain('data-composition-id="ai-title"');
    expect(rootHtml).toContain('data-composition-src="compositions/ai-title.html"');
    expect(state.project!.hf.compositionHtml["ai-title"]).toContain("AI block");
    expect(added).toMatchObject({
      id: "composition-1",
      kind: "composition",
      compositionId: "ai-title",
      compositionKind: "ai-block",
      width: 1920,
      height: 1080,
    });

    useStudio.getState().undo();
    expect(useStudio.getState().project!.hf.rootHtml).not.toContain("composition-1");
    expect(useStudio.getState().project!.hf.compositionHtml["ai-title"]).toBeUndefined();

    useStudio.getState().redo();
    expect(useStudio.getState().project!.hf.rootHtml).toContain("composition-1");
    expect(useStudio.getState().project!.hf.compositionHtml["ai-title"]).toContain("AI block");
  });

  it("rejects invalid non-character composition source before inserting the clip", () => {
    const project = createBlankProject("Bad composition clip");
    useStudio.setState({
      project,
      tracks: project.editorMeta.tracks,
    });

    const clip: CompositionClip = {
      id: "composition-bad",
      kind: "composition",
      compositionId: "ai-bad",
      compositionKind: "ai-block",
      compositionHtml: `<!DOCTYPE html>
<html data-composition-id="ai-bad" data-composition-duration="4">
  <body>
    <div id="stage" data-composition-id="ai-bad" data-width="1920" data-height="1080">
      <script>
        window.__timelines = window.__timelines || {};
        const tl = gsap.timeline({ paused: true });
        const broken = ;
        window.__timelines["ai-bad"] = tl;
      </script>
    </div>
  </body>
</html>`,
      name: "Bad AI Block",
      trackIndex: 1,
      start: 0,
      duration: 4,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
    };

    expect(() => useStudio.getState().addClip(clip)).toThrow(/Composition source is invalid/);
    expect(useStudio.getState().project!.hf.rootHtml).not.toContain("composition-bad");
    expect(useStudio.getState().project!.hf.compositionHtml["ai-bad"]).toBeUndefined();
  });

  it("preserves character clips as specialized compositions", () => {
    const project = createBlankProject("Character derivation");
    const character = { ...createBlankCharacter("Actor"), id: "character-source-1" };
    useStudio.setState({
      project,
      tracks: project.editorMeta.tracks,
      characters: new Map([[character.id, character]]),
    });

    const clip: CompositionClip = {
      id: "character-1",
      kind: "composition",
      compositionKind: "character",
      character: {
        characterId: "character-source-1",
        poses: {},
        autoBlink: false,
      },
      name: "Actor",
      trackIndex: 0,
      start: 0,
      duration: 4,
      x: 10,
      y: 20,
      width: 300,
      height: 450,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
    };

    useStudio.getState().addClip(clip);

    const added = deriveEditorClips(useStudio.getState().project!).find((c) => c.id === clip.id);
    expect(added).toMatchObject({
      id: "character-1",
      kind: "composition",
      compositionId: "char_character-1",
      compositionKind: "character",
      character: {
        characterId: "character-source-1",
        autoBlink: false,
      },
    });
    expect(useStudio.getState().project!.hf.compositionHtml["char_character-1"]).toContain(
      'window.__timelines["char_character-1"]',
    );
  });

  it("prunes stale generated speech audio when character lip sync changes or clears", () => {
    const project = createBlankProject("Character voice cleanup");
    const body = makeMediaAsset("body-a", "body-a");
    const oldVoice: MediaAsset = {
      ...makeMediaAsset("voice-old", "voice-old"),
      kind: "audio",
      scope: "generated-audio",
      filename: "voice-old.mp3",
      mimeType: "audio/mpeg",
      duration: 1,
    };
    const newVoice: MediaAsset = {
      ...makeMediaAsset("voice-new", "voice-new"),
      kind: "audio",
      scope: "generated-audio",
      filename: "voice-new.mp3",
      mimeType: "audio/mpeg",
      duration: 1,
    };
    const character = {
      ...createBlankCharacter("Actor"),
      id: "character-source-1",
      parts: [
        makePart("body", body.id, {
          id: "part-a",
          name: "Body",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          zIndex: 1,
        }),
      ],
    };
    const clip: CompositionClip = {
      id: "character-voice",
      kind: "composition",
      compositionKind: "character",
      character: {
        characterId: character.id,
        poses: {},
        autoBlink: false,
        lipSyncAudioId: oldVoice.id,
      },
      name: "Actor",
      trackIndex: 0,
      start: 0,
      duration: 4,
      x: 10,
      y: 20,
      width: 300,
      height: 450,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
    };

    useStudio.setState({
      project,
      tracks: project.editorMeta.tracks,
      characters: new Map([[character.id, character]]),
      mediaAssets: new Map([
        [body.id, body],
        [oldVoice.id, oldVoice],
        [newVoice.id, newVoice],
      ]),
    });

    useStudio.getState().addClip(clip);
    expect(useStudio.getState().project!.hf.assets.map((asset) => asset.id)).toContain(oldVoice.id);

    useStudio.getState().updateClip(clip.id, {
      character: {
        ...clip.character,
        lipSyncAudioId: newVoice.id,
        visemes: [{ t: 0, v: "A" }],
      },
    } as Partial<CompositionClip>);

    let state = useStudio.getState();
    expect(state.project!.hf.assets.map((asset) => asset.id)).toEqual(
      expect.arrayContaining([body.id, newVoice.id]),
    );
    expect(state.project!.hf.assets.map((asset) => asset.id)).not.toContain(oldVoice.id);
    expect(state.project!.hf.compositionHtml[`char_${clip.id}`]).toContain("asset:voice-new");
    expect(state.project!.hf.compositionHtml[`char_${clip.id}`]).not.toContain("asset:voice-old");

    useStudio.getState().updateClip(clip.id, {
      character: {
        ...state.project!.editorMeta.clips[clip.id].character!,
        lipSyncAudioId: undefined,
        visemes: undefined,
        voiceLine: undefined,
      },
    } as Partial<CompositionClip>);

    state = useStudio.getState();
    expect(state.project!.hf.assets.map((asset) => asset.id)).not.toContain(newVoice.id);
    expect(state.project!.hf.compositionHtml[`char_${clip.id}`]).not.toContain(
      'data-character-speech="true"',
    );
  });

  it("mutates root HTML through core helpers instead of regenerating the composition", () => {
    const project = createBlankProject("Direct mutation");
    const asset = makeMediaAsset("media-2", "Image");
    useStudio.setState({
      project,
      tracks: project.editorMeta.tracks,
      mediaAssets: new Map([[asset.id, asset]]),
    });

    useStudio.getState().addMediaToTimeline(asset);
    const clipId = useStudio.getState().selectedClipId!;
    useStudio.getState().updateClip(clipId, { start: 2, duration: 6, x: 24, y: 12 });
    useStudio.getState().setProjectMeta({ duration: 45, width: 1280, height: 720 });
    useStudio.getState().removeClip(clipId);

    const rootHtml = useStudio.getState().project!.hf.rootHtml;
    expect(coreMock.generateCalls).toHaveLength(1);
    expect(coreMock.addCalls).toBe(1);
    expect(coreMock.updateCalls).toBeGreaterThanOrEqual(1);
    expect(coreMock.removeCalls).toBe(1);
    expect(rootHtml).toContain('data-composition-duration="45"');
    expect(rootHtml).toContain('data-width="1280"');
    expect(rootHtml).toContain('data-height="720"');
    expect(rootHtml).not.toContain(clipId);
  });

  it("persists x and y edits through updateElementInHtml", () => {
    const project = createBlankProject("Position update");
    const asset = makeMediaAsset("media-xy", "Sprite");
    useStudio.setState({
      project,
      tracks: project.editorMeta.tracks,
      mediaAssets: new Map([[asset.id, asset]]),
    });

    useStudio.getState().addMediaToTimeline(asset);
    const clipId = useStudio.getState().selectedClipId!;

    useStudio.getState().updateClip(clipId, { x: 128, y: 96 });

    const rootHtml = useStudio.getState().project!.hf.rootHtml;
    expect(coreMock.updateCalls).toBeGreaterThanOrEqual(1);
    expect(rootHtml).toContain('data-x="128"');
    expect(rootHtml).toContain('data-y="96"');
  });

  it("stores clip keyframes in canonical rootHtml instead of editorMeta", () => {
    const project = createBlankProject("Keyframes");
    const asset = makeMediaAsset("media-kf", "Sprite");
    useStudio.setState({
      project,
      tracks: project.editorMeta.tracks,
      mediaAssets: new Map([[asset.id, asset]]),
    });

    useStudio.getState().addMediaToTimeline(asset);
    const clipId = useStudio.getState().selectedClipId!;

    const keyframeId = useStudio
      .getState()
      .upsertClipKeyframe(clipId, "position", 1, { x: 150, y: 125 });

    const state = useStudio.getState();
    const rootHtml = state.project!.hf.rootHtml;
    expect(keyframeId).toBeTruthy();
    expect(rootHtml).toContain("data-keyframes=");
    expect(rootHtml).toContain("data-studio-keyframes");
    expect(rootHtml).toContain(`&quot;x&quot;:${150 - 910}`);
    expect(rootHtml).toContain(`&quot;y&quot;:${125 - 490}`);
    expect(state.project!.editorMeta.clips[clipId]).not.toHaveProperty("keyframes");
    expect(state.selectedKeyframe).toMatchObject({
      clipId,
      keyframeId,
      property: "position",
    });
  });

  it("stores beginner motion steps as rootHtml grouping over native keyframes", () => {
    const project = createBlankProject("Motion steps");
    const asset = makeMediaAsset("media-motion", "Sprite");
    useStudio.setState({
      project,
      tracks: project.editorMeta.tracks,
      mediaAssets: new Map([[asset.id, asset]]),
    });

    useStudio.getState().addMediaToTimeline(asset);
    const clipId = useStudio.getState().selectedClipId!;
    const selection = useStudio.getState().addClipMotionStep(clipId, 0.5);

    const state = useStudio.getState();
    const rootHtml = state.project!.hf.rootHtml;
    expect(selection).toMatchObject({ clipId, property: "position" });
    expect(rootHtml).toContain("data-keyframes=");
    expect(rootHtml).toContain("data-motion-steps=");
    expect(state.project!.editorMeta.clips[clipId]).not.toHaveProperty("motionSteps");

    const clip = deriveEditorClips(state.project!).find((candidate) => candidate.id === clipId);
    expect(clip?.motionSteps).toHaveLength(1);
    expect(clip?.motionSteps[0]).toMatchObject({
      label: "Motion",
      startTime: 0.5,
    });
    expect(clip?.motionSteps[0]?.checkpointIds).toHaveLength(2);
    expect(clip?.motionSteps[0]?.checkpoints.map((checkpoint) => checkpoint.label)).toEqual([
      "Begin",
      "End",
    ]);

    useStudio.getState().renameClipMotionStep(clipId, clip!.motionSteps[0]!.id, "Hero glide");
    const namedClip = deriveEditorClips(useStudio.getState().project!).find(
      (candidate) => candidate.id === clipId,
    );
    expect(namedClip?.motionSteps[0]).toMatchObject({
      name: "Hero glide",
      label: "Hero glide",
    });
    expect(useStudio.getState().project!.hf.rootHtml).toContain("Hero glide");

    const checkpointSelection = useStudio
      .getState()
      .addClipMotionCheckpoint(clipId, namedClip!.motionSteps[0]!.id, 1);
    const checkpointClip = deriveEditorClips(useStudio.getState().project!).find(
      (candidate) => candidate.id === clipId,
    );
    expect(checkpointSelection).toMatchObject({ clipId, property: "position" });
    expect(
      checkpointClip?.motionSteps[0]?.checkpoints.map((checkpoint) => checkpoint.label),
    ).toEqual(["Begin", "Point 1", "End"]);

    useStudio.getState().removeClipMotionStep(clipId, checkpointClip!.motionSteps[0]!.id);
    const removedHtml = useStudio.getState().project!.hf.rootHtml;
    expect(removedHtml).not.toContain("data-keyframes=");
    expect(removedHtml).not.toContain("data-motion-steps=");
    expect(removedHtml).not.toContain("data-studio-keyframes");
  });

  it("undoes and redoes keyframe mutations as project snapshots", () => {
    const project = createBlankProject("Keyframe undo");
    const asset = makeMediaAsset("media-kf-undo", "Sprite");
    useStudio.setState({
      project,
      tracks: project.editorMeta.tracks,
      mediaAssets: new Map([[asset.id, asset]]),
    });

    useStudio.getState().addMediaToTimeline(asset);
    const clipId = useStudio.getState().selectedClipId!;
    useStudio.getState().upsertClipKeyframe(clipId, "opacity", 1, { opacity: 0.25 });
    expect(useStudio.getState().project!.hf.rootHtml).toContain("data-keyframes=");

    useStudio.getState().undo();
    expect(useStudio.getState().project!.hf.rootHtml).not.toContain("data-keyframes=");

    useStudio.getState().redo();
    expect(useStudio.getState().project!.hf.rootHtml).toContain("data-keyframes=");
  });

  it("keeps keyframe timing relative when clip start changes and clamps on trim", () => {
    const project = createBlankProject("Keyframe timing");
    const asset = makeMediaAsset("media-kf-time", "Sprite");
    useStudio.setState({
      project,
      tracks: project.editorMeta.tracks,
      mediaAssets: new Map([[asset.id, asset]]),
    });

    useStudio.getState().addMediaToTimeline(asset);
    const clipId = useStudio.getState().selectedClipId!;
    const keyframeId = useStudio
      .getState()
      .upsertClipKeyframe(clipId, "rotation", 3, { rotation: 45 });

    useStudio.getState().updateClip(clipId, { start: 2 });
    expect(useStudio.getState().project!.hf.rootHtml).toContain(
      'tl.to("#' + clipId + '", { rotation: 45, duration: 3 }, 2);',
    );

    useStudio.getState().updateClip(clipId, { duration: 1 });
    const clip = deriveEditorClips(useStudio.getState().project!).find((c) => c.id === clipId);
    expect(clip?.keyframes).toEqual(
      expect.arrayContaining([{ id: keyframeId!, time: 1, properties: { rotation: 45 } }]),
    );
    expect(clip?.motionSteps).toEqual([]);
  });

  it("persists width and height edits through updateElementInHtml", () => {
    const project = createBlankProject("Size update");
    const asset = makeMediaAsset("media-size", "Sprite");
    useStudio.setState({
      project,
      tracks: project.editorMeta.tracks,
      mediaAssets: new Map([[asset.id, asset]]),
    });

    useStudio.getState().addMediaToTimeline(asset);
    const clipId = useStudio.getState().selectedClipId!;

    useStudio.getState().updateClip(clipId, { width: 320, height: 180 });

    const rootHtml = useStudio.getState().project!.hf.rootHtml;
    expect(coreMock.updateCalls).toBeGreaterThanOrEqual(1);
    expect(rootHtml).toContain('data-source-width="320"');
    expect(rootHtml).toContain('data-source-height="180"');
    expect(rootHtml).toContain('data-width="320"');
    expect(rootHtml).toContain('data-height="180"');
  });

  it("persists base rotation edits through updateElementInHtml", () => {
    const project = createBlankProject("Rotation update");
    const asset = makeMediaAsset("media-rotation", "Sprite");
    useStudio.setState({
      project,
      tracks: project.editorMeta.tracks,
      mediaAssets: new Map([[asset.id, asset]]),
    });

    useStudio.getState().addMediaToTimeline(asset);
    const clipId = useStudio.getState().selectedClipId!;

    useStudio.getState().updateClip(clipId, { rotation: 18 });

    const rootHtml = useStudio.getState().project!.hf.rootHtml;
    const clip = deriveEditorClips(useStudio.getState().project!).find((c) => c.id === clipId);
    expect(coreMock.updateCalls).toBeGreaterThanOrEqual(1);
    expect(rootHtml).toContain('data-rotation="18"');
    expect(rootHtml).toContain("rotate(18deg)");
    expect(clip?.rotation).toBe(18);
  });

  it("reorders visual layers through canonical rootHtml", () => {
    const project = createBlankProject("Layer update");
    const backAsset = makeMediaAsset("media-back", "Back");
    const frontAsset = makeMediaAsset("media-front", "Front");
    useStudio.setState({
      project,
      tracks: project.editorMeta.tracks,
      mediaAssets: new Map([
        [backAsset.id, backAsset],
        [frontAsset.id, frontAsset],
      ]),
    });

    useStudio.getState().addMediaToTimeline(backAsset);
    const backClipId = useStudio.getState().selectedClipId!;
    useStudio.getState().addMediaToTimeline(frontAsset);
    const frontClipId = useStudio.getState().selectedClipId!;

    useStudio.getState().bringClipToFront(backClipId);

    const clips = deriveEditorClips(useStudio.getState().project!);
    const backClip = clips.find((clip) => clip.id === backClipId);
    const frontClip = clips.find((clip) => clip.id === frontClipId);
    const rootHtml = useStudio.getState().project!.hf.rootHtml;

    expect(backClip?.zIndex).toBe(1);
    expect(frontClip?.zIndex).toBe(0);
    expect(rootHtml).toContain(`id="${backClipId}"`);
    expect(rootHtml).toContain("z-index: 1");
    expect(rootHtml).toContain("z-index: 0");

    useStudio.getState().undo();
    const undone = deriveEditorClips(useStudio.getState().project!);
    expect(undone.find((clip) => clip.id === backClipId)?.zIndex).toBe(0);
    expect(undone.find((clip) => clip.id === frontClipId)?.zIndex).toBe(1);
  });

  it("undoes and redoes canonical rootHtml clip edits", () => {
    const project = createBlankProject("Undo update");
    const asset = makeMediaAsset("media-undo", "Sprite");
    useStudio.setState({
      project,
      tracks: project.editorMeta.tracks,
      mediaAssets: new Map([[asset.id, asset]]),
    });

    useStudio.getState().addMediaToTimeline(asset);
    const clipId = useStudio.getState().selectedClipId!;
    const beforeUpdate = useStudio.getState().project!.hf.rootHtml;

    useStudio.getState().updateClip(clipId, { x: 128, y: 96 });
    expect(useStudio.getState().project!.hf.rootHtml).toContain('data-x="128"');
    expect(useStudio.getState().project!.hf.rootHtml).toContain('data-y="96"');

    useStudio.getState().undo();
    expect(useStudio.getState().project!.hf.rootHtml).toBe(beforeUpdate);

    useStudio.getState().redo();
    expect(useStudio.getState().project!.hf.rootHtml).toContain('data-x="128"');
    expect(useStudio.getState().project!.hf.rootHtml).toContain('data-y="96"');
  });

  it("groups interactive timeline updates behind one explicit checkpoint", () => {
    const project = createBlankProject("Grouped update");
    const asset = makeMediaAsset("media-grouped", "Sprite");
    useStudio.setState({
      project,
      tracks: project.editorMeta.tracks,
      mediaAssets: new Map([[asset.id, asset]]),
    });

    useStudio.getState().addMediaToTimeline(asset);
    const clipId = useStudio.getState().selectedClipId!;
    const beforeDrag = useStudio.getState().project!.hf.rootHtml;
    const initialHistoryCount = useStudio.getState().historyPast.length;

    useStudio.getState().checkpointHistory();
    useStudio.getState().updateClip(clipId, { start: 1 }, { history: false });
    useStudio.getState().updateClip(clipId, { start: 2 }, { history: false });

    expect(useStudio.getState().historyPast).toHaveLength(initialHistoryCount + 1);
    expect(useStudio.getState().project!.hf.rootHtml).toContain('data-start="2"');

    useStudio.getState().undo();
    expect(useStudio.getState().project!.hf.rootHtml).toBe(beforeDrag);
  });
});

// ─── Store cache sync ─────────────────────────────────────────────────────────
describe("Studio cache sync", () => {
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
    const clip: CompositionClip = {
      id: "clip-1",
      kind: "composition",
      compositionKind: "character",
      character: {
        characterId: character.id,
        poses: {},
        autoBlink: false,
      },
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

    const compId = `char_${clip.id}`;
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
    expect(newCompHtml).toContain('data-character-part-id="part-b"');
    expect(newCompHtml).toContain("asset:asset-b");
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
      tracks: [
        {
          partRole: "body",
          keyframes: [
            { t: 0, dy: 0 },
            { t: 1, dy: 24 },
          ],
        },
      ],
      createdAt: 1,
      updatedAt: 1,
    };
    const clip: CompositionClip = {
      id: "clip-1",
      kind: "composition",
      compositionKind: "character",
      character: {
        characterId: character.id,
        poses: {},
        motions: [{ id: "motion-1", presetId: preset.id, offset: 0, intensity: 1 }],
        autoBlink: false,
      },
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
    };

    useStudio.setState({
      project,
      tracks: project.editorMeta.tracks,
      characters: new Map([[character.id, character]]),
      motionPresets: new Map([[preset.id, preset]]),
      mediaAssets: new Map([[media.id, media]]),
    });
    useStudio.getState().addClip(clip);

    const compId = `char_${clip.id}`;
    const before = useStudio.getState().project!.hf.compositionHtml[compId];

    useStudio.getState().registerMotionPreset({
      ...preset,
      duration: 2,
      updatedAt: 2,
    });

    const after = useStudio.getState().project!.hf.compositionHtml[compId];
    expect(after).toBeDefined();
    expect(typeof after).toBe("string");
    expect(after).not.toBe(before);
  });
});
