import { describe, expect, it } from "vitest";
import { buildHfMediaHealth, indexHfAssetReferences } from "../media-health";
import type { HyperFramesProject } from "../../types";

function makeProject(): HyperFramesProject {
  return {
    id: "project-1",
    name: "Project",
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 5,
    assets: [
      { id: "image-1", filename: "image.png", mimeType: "image/png", kind: "image" },
      { id: "voice-1", filename: "voice.mp3", mimeType: "audio/mpeg", kind: "audio" },
      { id: "part-1", filename: "part.png", mimeType: "image/png", kind: "image" },
    ],
    rootHtml: `<html><body>
      <img id="image-clip" src="asset:image-1" />
      <audio id="audio_char-clip" src="asset:voice-1"></audio>
      <div id="char-clip" data-composition-src="compositions/comp_char-clip.html"></div>
    </body></html>`,
    compositionHtml: {
      "comp_char-clip": `<html><body><img id="part" src="asset:part-1" /></body></html>`,
    },
  };
}

describe("indexHfAssetReferences", () => {
  it("maps HF assets to which html source (root or comp) references them", () => {
    const references = indexHfAssetReferences(makeProject());

    expect(references.has("image-1")).toBe(true);
    expect(references.has("voice-1")).toBe(true);
    expect(references.has("part-1")).toBe(true);
  });
});

describe("buildHfMediaHealth", () => {
  it("reports missing asset ids", () => {
    const health = buildHfMediaHealth(makeProject(), ["image-1"]);

    expect(health.missingAssetIds.has("voice-1")).toBe(true);
    expect(health.missingAssetIds.has("part-1")).toBe(true);
    expect(health.missingAssetIds.has("image-1")).toBe(false);
  });
});
