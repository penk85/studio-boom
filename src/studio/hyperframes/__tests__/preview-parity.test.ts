// Parity safety net: the Stage preview and the MP4 render must consume the *same*
// HyperFrames source. Both go through buildHyperframesProjectFiles(project); this test
// proves the files the preview pipeline posts to the bundler are byte-identical to the
// files export/render writes, so "what you edit" can't silently drift from "what renders".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../../types";

const mediaRows = vi.hoisted(() => new Map<string, Blob>());

vi.mock("../../db", () => ({
  db: {
    mediaBlobs: {
      where: () => ({
        anyOf: (ids: string[]) => ({
          toArray: async () =>
            ids.filter((id) => mediaRows.has(id)).map((id) => ({ id, blob: mediaRows.get(id)! })),
        }),
      }),
    },
  },
  getMediaUrl: async () => undefined,
}));

function makeProject(rootHtml?: string): Project {
  return {
    id: "project-1",
    name: "Parity",
    createdAt: 0,
    updatedAt: 0,
    hf: {
      id: "project-1",
      name: "Parity",
      width: 1920,
      height: 1080,
      fps: 30,
      duration: 5,
      assets: [{ id: "image-1", filename: "image.png", mimeType: "image/png", kind: "image" }],
      rootHtml:
        rootHtml ??
        `<!DOCTYPE html>
<html data-composition-id="project-1" data-composition-duration="5">
<body>
  <div id="stage">
    <img id="image-1" class="clip" data-start="0" data-duration="5" data-track-index="0" data-rotation="30" src="asset:image-1" />
    <div id="char-1" class="clip" data-type="composition" data-composition-id="comp_char-1" data-composition-src="compositions/comp_char-1.html" data-start="0" data-duration="5" data-track-index="1"></div>
  </div>
</body>
</html>`,
      compositionHtml: {
        "comp_char-1": `<!DOCTYPE html>
<html data-composition-id="comp_char-1" data-composition-duration="5">
<body>
  <div id="stage">
    <img id="part-1" class="clip" data-start="0" data-duration="5" data-track-index="0" src="asset:image-1" />
  </div>
</body>
</html>`,
      },
    },
    editorMeta: {
      tracks: [{ id: "track-1", name: "Characters", kind: "character" }],
      clips: {},
    },
  };
}

describe("preview ↔ export file parity", () => {
  const realFetch = globalThis.fetch;
  let postedFiles: File[] = [];

  beforeEach(() => {
    mediaRows.clear();
    mediaRows.set("image-1", new Blob(["png"], { type: "image/png" }));
    postedFiles = [];
    globalThis.fetch = vi.fn(async (_input: unknown, init?: { body?: unknown }) => {
      if (init?.body instanceof FormData) postedFiles = init.body.getAll("file") as File[];
      // A minimal valid HyperFrames composition so bundlePreviewProject's asserts pass.
      return new Response(
        '<!DOCTYPE html><html data-composition-id="project-1"><body></body></html>',
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("posts byte-identical HTML to what export writes (index.html + compositions, incl. rotation)", async () => {
    const { buildHyperframesProjectFiles } = await import("../../export/project-files");
    const { bundlePreviewProject } = await import("../preview");

    const project = makeProject();
    const expected = await buildHyperframesProjectFiles(project);
    await bundlePreviewProject(project);

    const postedText = new Map<string, string>();
    for (const file of postedFiles) {
      if (file.type === "text/html") postedText.set(file.name, await file.text());
    }
    const expectedText = expected.textFiles.filter((file) => file.mimeType === "text/html");

    // Same set of HTML source files…
    expect([...postedText.keys()].sort()).toEqual(expectedText.map((file) => file.path).sort());
    // …byte-for-byte identical contents (the one source preview and render share).
    for (const file of expectedText) {
      expect(postedText.get(file.path)).toBe(file.contents);
    }
    // Sanity: the rotation we author is actually present in the shared source.
    expect(postedText.get("index.html")).toContain('data-rotation="30"');
  });

  it("rewrites the GSAP CDN to the bundled runtime so preview and render run the same GSAP", async () => {
    const { buildHyperframesProjectFiles } = await import("../../export/project-files");
    const project = makeProject(
      `<!DOCTYPE html>
<html data-composition-id="project-1" data-composition-duration="5">
<head><script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script></head>
<body><div id="stage"></div></body>
</html>`,
    );

    const files = await buildHyperframesProjectFiles(project);
    const index = files.textFiles.find((file) => file.path === "index.html")!.contents;

    expect(index).not.toMatch(/cdn\.jsdelivr|unpkg|cdnjs/);
    expect(index).toContain('src="gsap.min.js"');
    expect(files.textFiles.some((file) => file.path === "gsap.min.js")).toBe(true);
  });

  it("rewrites bundled preview runtime refs to dev-server runtime endpoints", async () => {
    const { resolvePreviewRuntimeScriptRefs } = await import("../render-plugin");
    const html = `<!DOCTYPE html>
<html data-composition-id="project-1">
  <head>
    <script src="gsap.min.js"></script>
  </head>
  <body>
    <script src="../pixi.min.js"></script>
  </body>
</html>`;

    const resolved = resolvePreviewRuntimeScriptRefs(html);

    expect(resolved).toContain('src="/api/hyperframes/runtime/gsap.min.js"');
    expect(resolved).toContain('src="/api/hyperframes/runtime/pixi.min.js"');
    expect(resolved).not.toContain('src="../pixi.min.js"');
  });

  it("rewrites bundled render runtime refs to packaged root-local runtimes", async () => {
    const { resolveRenderRuntimeScriptRefs } = await import("../render-plugin");
    const html = `<!DOCTYPE html>
<html data-composition-id="project-1">
  <head>
    <script src="/api/hyperframes/runtime/gsap.min.js"></script>
  </head>
  <body>
    <script src="../pixi.min.js"></script>
  </body>
</html>`;

    const resolved = resolveRenderRuntimeScriptRefs(html);

    expect(resolved).toContain('src="gsap.min.js"');
    expect(resolved).toContain('src="pixi.min.js"');
    expect(resolved).not.toContain("/api/hyperframes/runtime/");
    expect(resolved).not.toContain('src="../pixi.min.js"');
  });

  it("resolves nested composition asset paths without corrupting blob URLs", async () => {
    const { resolvePreviewAssetPaths } = await import("../preview");
    const assets = [
      { id: "image-1", filename: "image.png", mimeType: "image/png", kind: "image" },
    ] satisfies Project["hf"]["assets"];
    const blobUrl = "blob:http://127.0.0.1:8082/asset-1";
    const html = `<!DOCTYPE html>
<html data-composition-id="project-1">
  <body>
    <img src="assets/image-1.png">
    <script>window.spriteUrl = "../assets/image-1.png";</script>
    <script>window.assetUrl = "asset:image-1";</script>
  </body>
</html>`;

    const resolved = resolvePreviewAssetPaths(html, assets, new Map([["image-1", blobUrl]]));
    const occurrences = resolved.match(
      new RegExp(blobUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
    );

    expect(occurrences).toHaveLength(3);
    expect(resolved).not.toContain("../blob:");
  });
});
