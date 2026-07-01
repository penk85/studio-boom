import { describe, expect, it } from "vitest";
import { assertExportBlobsPresent } from "../project-files";
import { resolvePackagedAssetRefs, resolvePackagedRuntimeRefs } from "../project-files";
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

  it("throws before MP4 render staging when an HF asset has no blob", () => {
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

describe("resolvePackagedRuntimeRefs", () => {
  it("rewrites root GSAP CDN scripts to the packaged local runtime and removes remote fonts", () => {
    const html = `<!DOCTYPE html>
<html>
  <head>
    <link data-hf-fonts="true" rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap">
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
  </head>
  <body></body>
</html>`;

    const resolved = resolvePackagedRuntimeRefs(html, { gsap: "root" });

    expect(resolved).toContain('src="gsap.min.js"');
    expect(resolved).not.toContain("cdn.jsdelivr.net");
    expect(resolved).not.toContain("fonts.googleapis.com");
  });

  it("omits duplicate sub-composition GSAP scripts because root owns the packaged runtime", () => {
    const html = `<!DOCTYPE html>
<html>
  <head>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
  </head>
  <body>
    <script>const tl = gsap.timeline({ paused: true });</script>
  </body>
</html>`;

    const resolved = resolvePackagedRuntimeRefs(html, { gsap: "omit" });

    expect(resolved).not.toContain("cdn.jsdelivr.net");
    expect(resolved).not.toContain('src="gsap.min.js"');
    expect(resolved).toContain("gsap.timeline");
  });

  it("rewrites root Pixi CDN scripts to the packaged local runtime", () => {
    const html = `<!DOCTYPE html>
<html>
  <head>
    <script src="https://pixijs.download/release/pixi.min.js"></script>
  </head>
  <body></body>
</html>`;

    const resolved = resolvePackagedRuntimeRefs(html, { gsap: "root", pixi: "root" });

    expect(resolved).toContain('src="pixi.min.js"');
    expect(resolved).not.toContain("pixijs.download");
  });

  it("rewrites sub-composition Pixi scripts relative to the compositions folder", () => {
    const html = `<!DOCTYPE html>
<html>
  <head>
    <script src="pixi.min.js"></script>
  </head>
  <body>
    <script>window.PIXI;</script>
  </body>
</html>`;

    const resolved = resolvePackagedRuntimeRefs(html, { gsap: "omit", pixi: "composition" });

    expect(resolved).toContain('src="../pixi.min.js"');
    expect(resolved).toContain("window.PIXI");
  });
});
