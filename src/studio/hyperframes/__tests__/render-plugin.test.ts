import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertNoTrackOverlaps,
  isTrustedStudioApiRequest,
  removeRenderTempDirectory,
  renderPixiArgsForHtml,
  renderPixiArgsForProject,
} from "../render-plugin";

describe("render plugin track overlap guard", () => {
  it("allows root clips and nested composition clips to reuse track indexes in separate files", () => {
    const rootHtml = `
      <html><body>
        <div id="character-clip" data-type="composition" data-composition-id="char_character-clip" data-composition-src="compositions/char_character-clip.html" data-start="0" data-duration="4" data-track-index="0"></div>
      </body></html>
    `;
    const characterHtml = `
      <html><body>
        <div id="stage" data-composition-id="char_character-clip" data-start="0" data-duration="4">
          <audio id="char_character-clip-speech" data-character-speech="true" data-start="0" data-duration="4" data-track-index="0" src="asset:speech"></audio>
        </div>
      </body></html>
    `;

    expect(() => assertNoTrackOverlaps(rootHtml, "index.html")).not.toThrow();
    expect(() =>
      assertNoTrackOverlaps(characterHtml, "compositions/char_character-clip.html"),
    ).not.toThrow();
  });

  it("rejects true same-file overlaps on the same track", () => {
    const rootHtml = `
      <html><body>
        <img id="image-a" data-start="0" data-duration="4" data-track-index="0" src="asset:a" />
        <audio id="audio-b" data-start="1" data-duration="4" data-track-index="0" src="asset:b"></audio>
      </body></html>
    `;

    expect(() => assertNoTrackOverlaps(rootHtml, "index.html")).toThrow(
      /index\.html track 0: <img id="image-a"> .* overlaps <audio id="audio-b">/,
    );
  });
});

describe("render plugin local API boundary", () => {
  it("accepts loopback requests from the same Studio origin", () => {
    expect(
      isTrustedStudioApiRequest({
        host: "127.0.0.1:8080",
        origin: "http://127.0.0.1:8080",
      }),
    ).toBe(true);
    expect(isTrustedStudioApiRequest({ host: "localhost:8080" })).toBe(true);
    expect(isTrustedStudioApiRequest({ host: "[::1]:8080" })).toBe(true);
  });

  it("rejects network hosts and cross-origin browser requests", () => {
    expect(isTrustedStudioApiRequest({ host: "192.168.1.25:8080" })).toBe(false);
    expect(isTrustedStudioApiRequest({ host: "studio.example:8080" })).toBe(false);
    expect(
      isTrustedStudioApiRequest({
        host: "127.0.0.1:8080",
        origin: "https://malicious.example",
      }),
    ).toBe(false);
    expect(
      isTrustedStudioApiRequest({
        host: "127.0.0.1:8080",
        origin: "http://127.0.0.1:9090",
      }),
    ).toBe(false);
  });

  it("removes staged render trees recursively", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "studio-boom-render-test-"));
    const nestedDir = path.join(rootDir, "project", "assets");
    await mkdir(nestedDir, { recursive: true });
    await writeFile(path.join(nestedDir, "asset.txt"), "asset");

    await removeRenderTempDirectory(rootDir);

    await expect(access(rootDir)).rejects.toThrow();
  });
});

describe("render plugin Pixi capture settings", () => {
  it("keeps HyperFrames auto-calibration for movies without Pixi characters", () => {
    expect(renderPixiArgsForHtml("<html><body></body></html>")).toEqual([]);
  });

  it("uses one software-WebGL worker when a Pixi character canvas is present", () => {
    expect(
      renderPixiArgsForHtml(`
        <div data-character-root="true" data-character-renderer="pixi"></div>
        <style>[data-character-renderer="pixi"] { display: block; }</style>
      `),
    ).toEqual(["--workers", "1", "--no-browser-gpu"]);
  });

  it("detects Pixi characters in staged sub-compositions before bundling", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "studio-boom-worker-test-"));
    try {
      await writeFile(path.join(projectDir, "index.html"), "<html><body></body></html>");
      const compositionsDir = path.join(projectDir, "compositions");
      await mkdir(compositionsDir);
      await writeFile(
        path.join(compositionsDir, "character.html"),
        '<div data-character-root="true" data-character-renderer="pixi"></div>',
      );

      await expect(renderPixiArgsForProject(projectDir)).resolves.toEqual([
        "--workers",
        "1",
        "--no-browser-gpu",
      ]);
    } finally {
      await removeRenderTempDirectory(projectDir);
    }
  });
});
