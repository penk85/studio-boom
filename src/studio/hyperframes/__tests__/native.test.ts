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
    const doc = new DOMParser().parseFromString(normalized, "text/html");
    expect(doc.querySelectorAll('[data-composition-id="project-1"]')).toHaveLength(1);
    expect(doc.documentElement.hasAttribute("data-composition-id")).toBe(false);
    expect(doc.getElementById("stage")?.getAttribute("data-composition-id")).toBe("project-1");
    expect(normalized).toContain('data-width="1920"');
    expect(normalized).toContain('data-height="1080"');
    expect(normalized).toContain('data-composition-width="1920"');
    expect(normalized).toContain('data-composition-height="1080"');
    expect(normalized).toContain('content="width=1920, height=1080"');
    expect(normalized).not.toContain("data-end=");
    expect(normalized).not.toContain("data-layer=");
  });

  it("syncs export dimensions onto the root composition and stage", () => {
    const html = `<!DOCTYPE html>
<html data-composition-id="project-1" data-composition-duration="5" data-resolution="landscape" data-width="1920" data-height="1080">
<head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body>
  <div id="stage" data-width="1920" data-height="1080" style="width: 1920px; height: 1080px;">
    <img id="image-1" data-start="0" data-duration="5" data-track-index="0" src="asset:image-1" />
  </div>
</body>
</html>`;

    const normalized = normalizeNativeHyperframesHtml(html, { width: 1080, height: 1920 });
    const doc = new DOMParser().parseFromString(normalized, "text/html");
    const root = doc.documentElement;
    const stage = doc.getElementById("stage")!;

    expect(root.getAttribute("data-width")).toBe("1080");
    expect(root.getAttribute("data-height")).toBe("1920");
    expect(root.getAttribute("data-composition-width")).toBe("1080");
    expect(root.getAttribute("data-composition-height")).toBe("1920");
    expect(root.getAttribute("data-resolution")).toBe("portrait");
    expect(stage.getAttribute("data-width")).toBe("1080");
    expect(stage.getAttribute("data-height")).toBe("1920");
    expect(stage.style.width).toBe("1080px");
    expect(stage.style.height).toBe("1920px");
    expect(doc.querySelector('meta[name="viewport"]')?.getAttribute("content")).toBe(
      "width=1080, height=1920",
    );
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
