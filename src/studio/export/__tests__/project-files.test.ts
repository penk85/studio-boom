import { beforeEach, describe, expect, it, vi } from "vitest";
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
}));

function makeProject(): Project {
  return {
    id: "project-1",
    name: "Native Flow",
    createdAt: 0,
    updatedAt: 0,
    hf: {
      id: "project-1",
      name: "Native Flow",
      width: 1920,
      height: 1080,
      fps: 30,
      duration: 5,
      assets: [
        {
          id: "image-1",
          filename: "image.png",
          mimeType: "image/png",
          kind: "image",
        },
      ],
      rootHtml: `<!DOCTYPE html>
<html data-composition-id="project-1" data-composition-duration="5">
<body>
  <div id="stage">
    <img id="image-1" class="clip" data-start="0" data-duration="5" data-track-index="0" src="asset:image-1" />
    <div id="char-1" class="clip" data-type="composition" data-composition-id="comp_char-1" data-composition-src="compositions/comp_char-1.html" data-start="0" data-duration="5" data-track-index="1"></div>
  </div>
  <script src="hyperframe-runtime.js"></script>
</body>
</html>`,
      compositionHtml: {
        "comp_char-1": `<!DOCTYPE html>
<html data-composition-id="comp_char-1" data-composition-duration="5">
<body>
  <div id="stage">
    <img id="part-1" class="clip" data-start="0" data-duration="5" data-track-index="0" src="asset:image-1" />
  </div>
  <script src="../hyperframe-runtime.js"></script>
</body>
</html>`,
      },
    },
    editorMeta: {
      tracks: [{ id: "track-1", name: "Characters", kind: "character" }],
      clips: {
        "char-1": {
          kind: "composition",
          compositionKind: "character",
          compositionId: "comp_char-1",
          character: {
            characterId: "editor-only-character",
            poses: {},
            voiceLine: {
              text: "this must not render",
              voiceId: "voice",
              modelId: "model",
              stability: 0.5,
              similarityBoost: 0.75,
            },
          },
        },
      },
    },
  };
}

describe("buildHyperframesProjectFiles", () => {
  beforeEach(() => {
    mediaRows.clear();
  });

  it("stages MP4 render files from project.hf and not editorMeta", async () => {
    mediaRows.set("image-1", new Blob(["png"], { type: "image/png" }));
    const { buildHyperframesProjectFiles } = await import("../project-files");

    const files = await buildHyperframesProjectFiles(makeProject());
    const textByPath = new Map(files.textFiles.map((file) => [file.path, file.contents]));

    expect(textByPath.get("index.html")).toContain('src="assets/image-1.png"');
    expect(textByPath.get("index.html")).toContain(
      'data-composition-src="compositions/comp_char-1.html"',
    );
    expect(textByPath.get("index.html")).toContain('data-duration="5"');
    expect(textByPath.get("index.html")).not.toContain("editor-only-character");
    expect(textByPath.get("index.html")).not.toContain("this must not render");
    expect(textByPath.get("index.html")).not.toContain("hyperframe-runtime.js");

    expect(textByPath.get("compositions/comp_char-1.html")).toContain(
      'src="../assets/image-1.png"',
    );
    expect(textByPath.get("compositions/comp_char-1.html")).not.toContain("hyperframe-runtime.js");
    expect(files.binaryFiles.map((file) => file.path)).toEqual(["assets/image-1.png"]);
  });

  it("stages root composition dimensions where the HyperFrames renderer reads them", async () => {
    mediaRows.set("image-1", new Blob(["png"], { type: "image/png" }));
    const { buildHyperframesProjectFiles } = await import("../project-files");
    const project = makeProject();
    project.hf.width = 1080;
    project.hf.height = 1920;
    project.hf.rootHtml = project.hf.rootHtml.replace(
      "<html data-composition-id",
      '<html data-resolution="landscape" data-width="1920" data-height="1080" data-composition-id',
    );

    const files = await buildHyperframesProjectFiles(project);
    const indexHtml = files.textFiles.find((file) => file.path === "index.html")?.contents ?? "";
    const doc = new DOMParser().parseFromString(indexHtml, "text/html");
    const root = doc.documentElement;
    const stage = doc.getElementById("stage")!;

    expect(root.getAttribute("data-width")).toBe("1080");
    expect(root.getAttribute("data-height")).toBe("1920");
    expect(root.getAttribute("data-resolution")).toBe("portrait");
    expect(stage.getAttribute("data-width")).toBe("1080");
    expect(stage.getAttribute("data-height")).toBe("1920");
    expect(doc.querySelector('meta[name="viewport"]')?.getAttribute("content")).toBe(
      "width=1080, height=1920",
    );
  });
});
