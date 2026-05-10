import { describe, expect, it } from "vitest";
import { assertExportBlobsPresent } from "../exporter";
import { resolvePackagedAssetRefs } from "../project-files";
import type { HFAsset } from "../../types";

const asset = (id: string, filename = `${id}.png`): HFAsset => ({
  id,
  filename,
  mimeType: "image/png",
  kind: "image",
});

describe("assertExportBlobsPresent", () => {
  it("allows export when every HF asset has a blob", () => {
    const assets = [asset("image-1"), asset("image-2")];
    const blobs = new Map([
      ["image-1", new Blob(["one"])],
      ["image-2", new Blob(["two"])],
    ]);

    expect(() => assertExportBlobsPresent(assets, blobs)).not.toThrow();
  });

  it("throws before ZIP assembly when an HF asset has no blob", () => {
    const assets = [asset("image-1"), asset("missing", "missing.png")];
    const blobs = new Map([["image-1", new Blob(["one"])]]);

    expect(() => assertExportBlobsPresent(assets, blobs)).toThrow(
      "Export is missing media blobs:\n- missing (missing.png)",
    );
  });
});

describe("resolvePackagedAssetRefs", () => {
  it("rewrites root composition asset placeholders to packaged asset paths", () => {
    const assets = [
      asset("image-1", "portrait.png"),
      { ...asset("voice-1", "voice.mp3"), mimeType: "audio/mpeg" },
    ];

    const html = `<img src="asset:image-1"><audio src="asset:voice-1"></audio>`;

    expect(resolvePackagedAssetRefs(html, assets, "assets")).toBe(
      `<img src="assets/image-1.png"><audio src="assets/voice-1.mp3"></audio>`,
    );
  });

  it("rewrites sub-composition asset placeholders relative to compositions/", () => {
    const assets = [asset("part-1", "part.svg")];

    expect(resolvePackagedAssetRefs(`<img src="asset:part-1">`, assets, "../assets")).toBe(
      `<img src="../assets/part-1.svg">`,
    );
  });
});
