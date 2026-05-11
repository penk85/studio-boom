import { describe, expect, it } from "vitest";
import { normalizeNativeHyperframesHtml } from "../native";

describe("normalizeNativeHyperframesHtml", () => {
  it("normalizes current core-generated attrs to CLI/runtime attrs", () => {
    const html = `<!DOCTYPE html>
<html data-composition-id="project-1" data-composition-duration="5">
<body>
  <div id="stage">
    <img id="image-1" data-start="1" data-end="4" data-layer="2" src="asset:image-1" />
  </div>
</body>
</html>`;

    const normalized = normalizeNativeHyperframesHtml(html, { width: 1920, height: 1080 });

    expect(normalized).toContain('data-start="0"');
    expect(normalized).toContain('data-duration="3"');
    expect(normalized).toContain('data-track-index="2"');
    expect(normalized).toContain('class="clip"');
    expect(normalized).toContain('id="stage" data-composition-id="project-1"');
    expect(normalized).toContain('data-width="1920"');
    expect(normalized).toContain('data-height="1080"');
    expect(normalized).not.toContain("data-end=");
    expect(normalized).not.toContain("data-layer=");
  });

  it("promotes generated iframe composition hosts to data-composition-src", () => {
    const html = `<!DOCTYPE html>
<html data-composition-id="project-1" data-composition-duration="5">
<body>
  <div id="stage">
    <div id="char-1" data-type="composition" data-composition-id="comp_char-1" data-start="0" data-end="5" data-layer="0">
      <iframe src="compositions/comp_char-1.html?title=Hi"></iframe>
    </div>
  </div>
</body>
</html>`;

    const normalized = normalizeNativeHyperframesHtml(html);

    expect(normalized).toContain('data-composition-src="compositions/comp_char-1.html"');
    expect(normalized).toContain('data-duration="5"');
    expect(normalized).toContain('data-track-index="0"');
  });
});
