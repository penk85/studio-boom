import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import {
  createProjectFromHyperframesHtml,
  createProjectFromHyperframesZip,
} from "../project-import";

function makeRootHtml(body: string): string {
  return `<!DOCTYPE html>
<html data-composition-id="source-project" data-composition-duration="8" data-width="1280" data-height="720">
  <head>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  </head>
  <body>
    <div id="stage" data-composition-id="source-project" data-width="1280" data-height="720">
      ${body}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      window.__timelines = window.__timelines || {};
      window.__timelines["source-project"] = tl;
    </script>
  </body>
</html>`;
}

describe("createProjectFromHyperframesHtml", () => {
  it("creates a Studio Boom project from top-level HyperFrames clips", async () => {
    const imported = await createProjectFromHyperframesHtml(
      makeRootHtml(`
        <div
          id="title"
          data-type="text"
          data-start="0"
          data-duration="4"
          data-track-index="1"
          data-x="100"
          data-y="80"
          data-width="600"
          data-height="160"
        >Hello</div>
        <img
          id="visual"
          data-start="4"
          data-duration="4"
          data-track-index="2"
          src="https://images.unsplash.com/photo-1"
          data-width="640"
          data-height="360"
        />
      `),
      { id: "imported-project", name: "Imported", now: 10 },
    );

    expect(imported.clipCount).toBe(2);
    expect(imported.project.id).toBe("imported-project");
    expect(imported.project.hf.id).toBe("imported-project");
    expect(imported.project.hf.width).toBe(1280);
    expect(imported.project.hf.height).toBe(720);
    expect(imported.project.hf.duration).toBe(8);
    expect(imported.project.hf.rootHtml).toContain('data-composition-id="imported-project"');
    expect(imported.project.hf.rootHtml).toContain('"imported-project"');
    expect(imported.project.editorMeta.clips.title?.kind).toBe("text");
    expect(imported.project.editorMeta.clips.title?.uiTrackIndex).toBe(1);
    expect(imported.project.editorMeta.clips.visual?.kind).toBe("image");
    expect(imported.project.editorMeta.clips.visual?.uiTrackIndex).toBe(2);
    expect(imported.mediaFiles).toEqual([]);
  });

  it("rejects asset references that need a project bundle", async () => {
    await expect(
      createProjectFromHyperframesHtml(
        makeRootHtml(`
          <img
            id="visual"
            data-start="0"
            data-duration="4"
            data-track-index="2"
            src="asset:image-1"
            data-width="640"
            data-height="360"
          />
        `),
      ),
    ).rejects.toThrow(/Missing local media assets/);
  });
});

describe("createProjectFromHyperframesZip", () => {
  it("imports native root wrapper projects as their scene clips", async () => {
    const file = makeZipFile(
      {
        "index.html": `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Fitness App Showcase</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="fitness-app-showcase"
      data-width="1920"
      data-height="1080"
      data-duration="5.5"
      data-start="0"
    >
      <div
        id="scene-3"
        data-composition-id="scene-3-phones"
        data-composition-src="compositions/scene-3-phones.html"
        data-start="0"
        data-duration="5.5"
        data-track-index="0"
      ></div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      window.__timelines["fitness-app-showcase"] = tl;
    </script>
    <script src="hyperframe-runtime.js"></script>
  </body>
</html>`,
        "compositions/scene-3-phones.html": makeCompositionHtml("scene-3-phones", ""),
      },
      "Fitness App Showcase.zip",
    );

    const imported = await createProjectFromHyperframesZip(file, {
      id: "zip-project",
      now: 20,
    });

    expect(imported.clipCount).toBe(1);
    expect(imported.project.name).toBe("Fitness App Showcase");
    expect(imported.project.editorMeta.clips.root).toBeUndefined();
    expect(imported.project.editorMeta.clips["scene-3"]).toMatchObject({
      kind: "composition",
      compositionId: "scene-3-phones",
    });
    expect(imported.project.hf.compositionHtml["scene-3-phones"]).toContain(
      'data-composition-id="scene-3-phones"',
    );
  });

  it("imports root HTML, nested compositions, and local media from a ZIP", async () => {
    const file = makeZipFile(
      {
        "showcase/index.html": makeRootHtml(`
          <div
            id="text-beat"
            data-name="Text beat"
            data-start="0"
            data-duration="4"
            data-track-index="1"
            data-width="1280"
            data-height="720"
          >
            <div class="scene-content">
              <h1>Three phones</h1>
              <p>One coordinated launch.</p>
            </div>
          </div>
          <img
            id="visual"
            data-start="0"
            data-duration="4"
            data-track-index="2"
            src="assets/visual.png"
            data-width="640"
            data-height="360"
          />
          <div
            id="card-host"
            data-composition-id="card"
            data-composition-file="compositions/card.html"
            data-start="4"
            data-duration="4"
            data-track-index="1"
            data-width="640"
            data-height="360"
          ></div>
        `),
        "showcase/compositions/card.html": makeCompositionHtml(
          "card",
          `
            <div
              id="card-bg"
              data-start="0"
              data-duration="4"
              data-track-index="0"
              style="background-image: url('../assets/card.png')"
            ></div>
          `,
        ),
        "showcase/assets/visual.png": new Uint8Array([1, 2, 3]),
        "showcase/assets/card.png": new Uint8Array([4, 5, 6]),
      },
      "showcase.zip",
    );

    const imported = await createProjectFromHyperframesZip(file, {
      id: "zip-project",
      name: "Zip Project",
      now: 20,
    });

    expect(imported.project.id).toBe("zip-project");
    expect(imported.project.name).toBe("Zip Project");
    expect(imported.project.hf.rootHtml).toContain('data-composition-id="zip-project"');
    expect(imported.project.hf.rootHtml).toContain('src="asset:');
    expect(imported.project.hf.rootHtml).toContain('data-composition-src="compositions/card.html"');
    expect(imported.project.hf.rootHtml).toContain(
      'data-composition-file="compositions/card.html"',
    );
    expect(imported.project.hf.compositionHtml.card).toMatch(/url\(['"]asset:/);
    expect(imported.project.editorMeta.clips["text-beat"]?.kind).toBe("composition");
    expect(imported.project.editorMeta.clips["text-beat"]?.compositionId).toBeUndefined();
    expect(imported.project.editorMeta.clips.visual?.kind).toBe("image");
    expect(imported.project.editorMeta.clips["card-host"]?.kind).toBe("composition");
    expect(imported.project.editorMeta.clips["card-host"]?.compositionId).toBe("card");
    expect(imported.mediaFiles).toHaveLength(2);
    expect(imported.project.hf.assets).toHaveLength(2);
    expect(imported.mediaFiles.every(({ asset }) => asset.kind === "image")).toBe(true);
    expect(imported.mediaFiles.every(({ mediaBlob }) => mediaBlob.blob.type === "image/png")).toBe(
      true,
    );
  });

  it("rejects ZIP imports when a referenced local media file is missing", async () => {
    const file = makeZipFile({
      "index.html": makeRootHtml(`
        <img
          id="missing"
          data-start="0"
          data-duration="4"
          data-track-index="2"
          src="assets/missing.png"
          data-width="640"
          data-height="360"
        />
      `),
    });

    await expect(createProjectFromHyperframesZip(file)).rejects.toThrow(/Missing media file/);
  });

  it("rejects ZIP imports without an index file", async () => {
    const file = makeZipFile({
      "compositions/card.html": makeCompositionHtml("card", ""),
    });

    await expect(createProjectFromHyperframesZip(file)).rejects.toThrow(/index\.html/);
  });
});

function makeCompositionHtml(compositionId: string, body: string): string {
  return `<template id="${compositionId}-template">
    <div data-composition-id="${compositionId}" data-width="1280" data-height="720">
      ${body}
      <script>
        const tl = gsap.timeline({ paused: true });
        window.__timelines = window.__timelines || {};
        window.__timelines["${compositionId}"] = tl;
      </script>
    </div>
  </template>`;
}

function makeZipFile(files: Record<string, string | Uint8Array>, name = "project.zip"): File {
  const entries = Object.fromEntries(
    Object.entries(files).map(([path, contents]) => [
      path,
      typeof contents === "string" ? textToBytes(contents) : contents,
    ]),
  );
  const zipped = zipSync(entries);
  const bytes = new ArrayBuffer(zipped.byteLength);
  new Uint8Array(bytes).set(zipped);
  return new File([bytes], name, { type: "application/zip" });
}

function textToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index);
  }
  return bytes;
}
