import { describe, expect, it } from "vitest";
import { addStudioElementToHtml, parseStudioHtml, updateStudioElementInHtml } from "../html";

describe("parseStudioHtml", () => {
  it("patches added elements with native placement attrs and visual styles", () => {
    const { html } = addStudioElementToHtml(
      `<!DOCTYPE html>
<html data-composition-id="project-1" data-composition-duration="5">
  <head><script>const tl = gsap.timeline({ paused: true });</script></head>
  <body><div id="stage" data-composition-id="project-1"></div></body>
</html>`,
      {
        id: "image-1",
        type: "image",
        name: "Image",
        src: "asset:image-1",
        startTime: 0,
        duration: 5,
        zIndex: 2,
        x: 128,
        y: 96,
        rotation: 12,
        sourceWidth: 320,
        sourceHeight: 180,
      },
    );

    expect(html).toContain('data-x="128"');
    expect(html).toContain('data-y="96"');
    expect(html).toContain('data-rotation="12"');
    expect(html).toContain('data-source-width="320"');
    expect(html).toContain('data-source-height="180"');
    expect(html).toContain('data-width="320"');
    expect(html).toContain('data-height="180"');
    expect(html).toContain("z-index: 2");
    expect(html).toContain("translate(128px, 96px) rotate(12deg)");
    expect(html).toContain("max-width: none");
    expect(html).toContain("max-height: none");

    expect(parseStudioHtml(html).elements[0]).toMatchObject({
      id: "image-1",
      x: 128,
      y: 96,
      rotation: 12,
      sourceWidth: 320,
      sourceHeight: 180,
    });
  });

  it("patches added composition clips into iframe hosts", () => {
    const { html } = addStudioElementToHtml(
      `<!DOCTYPE html>
<html data-composition-id="project-1" data-composition-duration="5">
  <body><div id="stage" data-composition-id="project-1"></div></body>
</html>`,
      {
        id: "character-1",
        type: "composition",
        name: "Character",
        src: "compositions/comp_character-1.html",
        compositionId: "comp_character-1",
        startTime: 0,
        duration: 5,
        zIndex: 1,
        x: 200,
        y: 120,
        sourceWidth: 400,
        sourceHeight: 600,
      },
    );

    expect(html).toContain('data-type="composition"');
    expect(html).toContain('data-composition-id="comp_character-1"');
    expect(html).toContain('data-composition-src="compositions/comp_character-1.html"');
    expect(html).toContain('<iframe src="compositions/comp_character-1.html"');
    expect(html).toContain('data-width="400"');
    expect(html).toContain('data-height="600"');
  });

  it("recognizes native HyperFrames composition hosts without data-type", () => {
    const parsed = parseStudioHtml(`<!DOCTYPE html>
<html data-composition-id="project-1" data-composition-duration="5">
  <body>
    <div id="stage" data-composition-id="project-1">
      <div
        id="scene-1"
        data-composition-id="scene-1"
        data-composition-src="compositions/scene-1.html"
        data-start="0"
        data-duration="5"
        data-track-index="1"
        data-width="1280"
        data-height="720"
      ></div>
    </div>
  </body>
</html>`);

    expect(parsed.elements).toHaveLength(1);
    expect(parsed.elements[0]).toMatchObject({
      id: "scene-1",
      type: "composition",
      src: "compositions/scene-1.html",
      compositionId: "scene-1",
      sourceWidth: 1280,
      sourceHeight: 720,
    });
  });

  it("does not expose body root composition wrappers as timeline clips", () => {
    const parsed = parseStudioHtml(`<!DOCTYPE html>
<html lang="en">
  <body>
    <div
      id="root"
      data-composition-id="project-1"
      data-width="1280"
      data-height="720"
      data-start="0"
      data-duration="5"
    >
      <div
        id="scene-1"
        data-composition-id="scene-1"
        data-composition-src="compositions/scene-1.html"
        data-start="0"
        data-duration="5"
        data-track-index="0"
      ></div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["project-1"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>`);

    expect(parsed.elements).toHaveLength(1);
    expect(parsed.elements[0]).toMatchObject({
      id: "scene-1",
      type: "composition",
      compositionId: "scene-1",
      src: "compositions/scene-1.html",
    });
  });

  it("recognizes native inline composition clips without external sources", () => {
    const parsed = parseStudioHtml(`<!DOCTYPE html>
<html data-composition-id="project-1" data-composition-duration="5">
  <body>
    <div id="stage" data-composition-id="project-1">
      <section
        id="beat-phones"
        data-composition-id="beat-phones"
        data-start="0"
        data-duration="5"
        data-track-index="1"
        data-width="1280"
        data-height="720"
      >
        <div class="phones-grid">
          <div>Phone one</div>
          <div>Phone two</div>
          <div>Phone three</div>
        </div>
      </section>
    </div>
  </body>
</html>`);

    expect(parsed.elements).toHaveLength(1);
    expect(parsed.elements[0]).toMatchObject({
      id: "beat-phones",
      type: "composition",
      compositionId: "beat-phones",
      sourceWidth: 1280,
      sourceHeight: 720,
    });
    expect("src" in parsed.elements[0]).toBe(false);
  });

  it("recognizes structured native timed HTML groups as composition clips", () => {
    const parsed = parseStudioHtml(`<!DOCTYPE html>
<html data-composition-id="project-1" data-composition-duration="5">
  <body>
    <div id="stage" data-composition-id="project-1">
      <div
        id="text-beat"
        data-name="Intro text beat"
        data-start="0"
        data-duration="5"
        data-track-index="1"
        data-width="1280"
        data-height="720"
      >
        <div class="scene-content">
          <h1>Launch day</h1>
          <p>Three screens, one story.</p>
        </div>
      </div>
    </div>
  </body>
</html>`);

    expect(parsed.elements).toHaveLength(1);
    expect(parsed.elements[0]).toMatchObject({
      id: "text-beat",
      type: "composition",
      name: "Intro text beat",
      sourceWidth: 1280,
      sourceHeight: 720,
    });
  });

  it("keeps simple native timed divs as text clips", () => {
    const parsed = parseStudioHtml(`<!DOCTYPE html>
<html data-composition-id="project-1" data-composition-duration="5">
  <body>
    <div id="stage" data-composition-id="project-1">
      <div
        id="caption"
        data-start="0"
        data-duration="5"
        data-track-index="1"
        data-width="1280"
        data-height="120"
      >Simple caption</div>
    </div>
  </body>
</html>`);

    expect(parsed.elements).toHaveLength(1);
    expect(parsed.elements[0]).toMatchObject({
      id: "caption",
      type: "text",
      content: "Simple caption",
      sourceWidth: 1280,
      sourceHeight: 120,
    });
  });

  it("patches native media sizing attrs for editor stage overlays", () => {
    const parsed = parseStudioHtml(`<!DOCTYPE html>
<html data-composition-id="project-1" data-composition-duration="5">
  <body>
    <div id="stage" data-composition-id="project-1">
      <img
        id="image-1"
        src="asset:image-1"
        data-start="0"
        data-duration="5"
        data-track-index="2"
        style="z-index: 8"
        data-rotation="22"
        data-source-width="640"
        data-source-height="360"
      />
    </div>
  </body>
</html>`);

    expect(parsed.elements).toHaveLength(1);
    expect(parsed.elements[0]).toMatchObject({
      id: "image-1",
      duration: 5,
      zIndex: 8,
      rotation: 22,
      sourceWidth: 640,
      sourceHeight: 360,
    });
  });

  it("persists native position and size attrs that the current core helper drops", () => {
    const updated = updateStudioElementInHtml(
      `<!DOCTYPE html>
<html data-composition-id="project-1" data-composition-duration="5">
  <body>
    <div id="stage" data-composition-id="project-1">
      <img
        id="image-1"
        src="asset:image-1"
        data-start="0"
        data-duration="5"
        data-track-index="2"
        data-source-width="640"
        data-source-height="360"
      />
    </div>
  </body>
</html>`,
      "image-1",
      {
        x: 128,
        y: 96,
        rotation: -15,
        sourceWidth: 320,
        sourceHeight: 180,
        opacity: 0.75,
      },
    );

    expect(updated).toContain('data-x="128"');
    expect(updated).toContain('data-y="96"');
    expect(updated).toContain('data-rotation="-15"');
    expect(updated).toContain('data-source-width="320"');
    expect(updated).toContain('data-source-height="180"');
    expect(updated).toContain('data-width="320"');
    expect(updated).toContain('data-height="180"');
    expect(updated).toContain('data-opacity="0.75"');
    expect(updated).toContain("z-index: 2");
    expect(updated).toContain("translate(128px, 96px) rotate(-15deg)");
    expect(updated).toContain("max-width: none");
    expect(updated).toContain("max-height: none");

    expect(parseStudioHtml(updated).elements[0]).toMatchObject({
      x: 128,
      y: 96,
      rotation: -15,
      sourceWidth: 320,
      sourceHeight: 180,
      opacity: 0.75,
    });
  });
});
