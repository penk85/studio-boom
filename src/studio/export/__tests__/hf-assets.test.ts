import { describe, expect, it } from "vitest";
import { pruneHfAssets, registerHfAsset } from "../../hyperframes/assets";
import type { HyperFramesProject, MediaAsset } from "../../types";

function makeAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: "media-1",
    name: "Media",
    kind: "image",
    mimeType: "image/png",
    filename: "media.png",
    createdAt: 0,
    ...overrides,
  };
}

function makeHfProject(overrides: Partial<HyperFramesProject> = {}): HyperFramesProject {
  return {
    id: "project-1",
    name: "Project",
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 5,
    assets: [],
    rootHtml: "",
    compositionHtml: {},
    ...overrides,
  };
}

describe("registerHfAsset", () => {
  it("adds a media asset to hf.assets once", () => {
    const asset = makeAsset();
    const once = registerHfAsset(makeHfProject(), asset);
    const twice = registerHfAsset(once, asset);

    expect(twice.assets).toHaveLength(1);
    expect(twice.assets[0]).toMatchObject({
      id: asset.id,
      filename: asset.filename,
      mimeType: asset.mimeType,
      kind: asset.kind,
    });
  });
});

describe("pruneHfAssets", () => {
  it("keeps only assets referenced in rootHtml", () => {
    const kept = makeAsset({ id: "kept", filename: "kept.png" });
    const stale = makeAsset({ id: "stale", filename: "stale.png" });
    const hf = makeHfProject({
      assets: [
        { id: kept.id, filename: kept.filename, mimeType: kept.mimeType, kind: kept.kind },
        { id: stale.id, filename: stale.filename, mimeType: stale.mimeType, kind: stale.kind },
      ],
      rootHtml: `<html><body><img src="asset:kept" /></body></html>`,
    });

    const referencedIds = new Set<string>(["kept"]);
    expect(pruneHfAssets(hf, referencedIds).assets.map((a) => a.id)).toEqual([kept.id]);
  });
});
