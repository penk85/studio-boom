import { describe, expect, it } from "vitest";
import { CHARACTER_PART_ACCEPT, isSupportedCharacterPartFile, isSvgFile } from "../../db";

function file(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe("character part artwork intake", () => {
  it("accepts the raster formats real artwork actually arrives in", () => {
    // Cutout tools, background removers and image generators produce these.
    // Rejecting them locked non-animators out of the character editor entirely.
    for (const [name, type] of [
      ["head.png", "image/png"],
      ["body.jpg", "image/jpeg"],
      ["arm.jpeg", "image/jpeg"],
      ["leg.webp", "image/webp"],
    ] as const) {
      expect(isSupportedCharacterPartFile(file(name, type)), name).toBe(true);
    }
  });

  it("still accepts SVG", () => {
    expect(isSupportedCharacterPartFile(file("mouth.svg", "image/svg+xml"))).toBe(true);
    expect(isSvgFile(file("mouth.svg", "image/svg+xml"))).toBe(true);
  });

  it("identifies SVG by extension when the browser reports no MIME type", () => {
    expect(isSvgFile(file("mouth.svg", ""))).toBe(true);
    expect(isSupportedCharacterPartFile(file("head.PNG", ""))).toBe(true);
  });

  it("rejects things that are not images", () => {
    for (const [name, type] of [
      ["notes.pdf", "application/pdf"],
      ["clip.mp4", "video/mp4"],
      ["voice.mp3", "audio/mpeg"],
      ["archive.zip", "application/zip"],
    ] as const) {
      expect(isSupportedCharacterPartFile(file(name, type)), name).toBe(false);
    }
  });

  it("offers every supported format in the file picker", () => {
    // A format accepted by the guard but missing here is invisible to the user.
    for (const token of [".svg", ".png", ".jpg", ".jpeg", ".webp"]) {
      expect(CHARACTER_PART_ACCEPT).toContain(token);
    }
  });
});
