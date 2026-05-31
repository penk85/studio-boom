import { describe, expect, it } from "vitest";
import { assertNoTrackOverlaps } from "../render-plugin";

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
