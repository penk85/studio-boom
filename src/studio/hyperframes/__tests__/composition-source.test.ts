import { describe, expect, it } from "vitest";
import { buildCompositionRepairPrompt, validateCompositionSourceHtml } from "../composition-source";

const defaults = {
  compositionId: "ai-title",
  duration: 4,
  width: 1920,
  height: 1080,
};

describe("validateCompositionSourceHtml", () => {
  it("accepts a registered HyperFrames composition source", () => {
    const result = validateCompositionSourceHtml(
      `<!DOCTYPE html>
<html data-composition-id="ai-title" data-composition-duration="4">
  <body>
    <div id="stage" data-composition-id="ai-title" data-width="1920" data-height="1080">
      <div>AI Title</div>
      <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
      <script>
        window.__timelines = window.__timelines || {};
        const tl = gsap.timeline({ paused: true });
        window.__timelines["ai-title"] = tl;
      </script>
    </div>
  </body>
</html>`,
      defaults,
    );

    expect(result.ok).toBe(true);
    expect(result.compositionId).toBe("ai-title");
    expect(result.html).toContain('data-composition-id="ai-title"');
  });

  it("accepts a template-wrapped reusable HyperFrames composition source", () => {
    const result = validateCompositionSourceHtml(
      `<template id="ai-title-template">
        <div data-composition-id="ai-title" data-width="1920" data-height="1080">
          <div class="title">AI Title</div>
          <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
          <script>
            const tl = gsap.timeline({ paused: true });
            window.__timelines = window.__timelines || {};
            window.__timelines["ai-title"] = tl;
          </script>
        </div>
      </template>`,
      defaults,
    );

    expect(result.ok).toBe(true);
    expect(result.compositionId).toBe("ai-title");
    expect(result.html).toContain("<template");
    expect(result.html).toContain('data-composition-id="ai-title"');
  });

  it("rejects timed child clips without track indexes", () => {
    const result = validateCompositionSourceHtml(
      `<!DOCTYPE html>
<html data-composition-id="ai-title" data-composition-duration="4">
  <body>
    <div id="stage" data-composition-id="ai-title" data-width="1920" data-height="1080">
      <div id="headline" data-start="0" data-duration="4">AI Title</div>
      <script>
        window.__timelines = window.__timelines || {};
        const tl = gsap.timeline({ paused: true });
        window.__timelines["ai-title"] = tl;
      </script>
    </div>
  </body>
</html>`,
      defaults,
    );

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain(
      '<div id="headline"> has timing but is missing data-track-index.',
    );
  });

  it("rejects overlapping internal clips on the same track", () => {
    const result = validateCompositionSourceHtml(
      `<!DOCTYPE html>
<html data-composition-id="ai-title" data-composition-duration="4">
  <body>
    <div id="stage" data-composition-id="ai-title" data-width="1920" data-height="1080">
      <div id="headline" data-start="0" data-duration="4" data-track-index="0">AI Title</div>
      <div id="subtitle" data-start="0" data-duration="4" data-track-index="0">Subtitle</div>
      <script>
        window.__timelines = window.__timelines || {};
        const tl = gsap.timeline({ paused: true });
        window.__timelines["ai-title"] = tl;
      </script>
    </div>
  </body>
</html>`,
      defaults,
    );

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain(
      'Track 0: <div id="headline"> ending at 4s overlaps with <div id="subtitle"> starting at 0s.',
    );
  });

  it("rejects composition roots that set a render track", () => {
    const result = validateCompositionSourceHtml(
      `<!DOCTYPE html>
<html data-composition-id="ai-title" data-composition-duration="4">
  <body>
    <div
      id="stage"
      data-composition-id="ai-title"
      data-width="1920"
      data-height="1080"
      data-start="0"
      data-duration="4"
      data-track-index="0"
    >
      <div id="headline">AI Title</div>
      <script>
        window.__timelines = window.__timelines || {};
        const tl = gsap.timeline({ paused: true });
        window.__timelines["ai-title"] = tl;
      </script>
    </div>
  </body>
</html>`,
      defaults,
    );

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain(
      '<div id="stage"> is the composition root and should not set data-track-index.',
    );
  });

  it("rejects source without timeline registration", () => {
    const result = validateCompositionSourceHtml(
      `<!DOCTYPE html>
<html data-composition-id="ai-title" data-composition-duration="4">
  <body><div id="stage" data-composition-id="ai-title"></div></body>
</html>`,
      defaults,
    );

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/window.__timelines/);
  });

  it("rejects a stage composition id that disagrees with the source root", () => {
    const result = validateCompositionSourceHtml(
      `<!DOCTYPE html>
<html data-composition-id="ai-title" data-composition-duration="4">
  <body>
    <div id="stage" data-composition-id="wrong-id" data-width="1920" data-height="1080">
      <script>
        window.__timelines = window.__timelines || {};
        const tl = gsap.timeline({ paused: true });
        window.__timelines["ai-title"] = tl;
      </script>
    </div>
  </body>
</html>`,
      defaults,
    );

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain(
      '#stage data-composition-id "wrong-id" must match composition id "ai-title".',
    );
  });

  it("rejects source with invalid inline JavaScript", () => {
    const result = validateCompositionSourceHtml(
      `<!DOCTYPE html>
<html data-composition-id="ai-title" data-composition-duration="4">
  <body>
    <div id="stage" data-composition-id="ai-title" data-width="1920" data-height="1080">
      <script>
        window.__timelines = window.__timelines || {};
        const tl = gsap.timeline({ paused: true });
        const broken = ;
        window.__timelines["ai-title"] = tl;
      </script>
    </div>
  </body>
</html>`,
      defaults,
    );

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("[invalid_inline_script_syntax]");
  });

  it("uses the HyperFrames linter to reject non-deterministic composition code", () => {
    const result = validateCompositionSourceHtml(
      `<!DOCTYPE html>
<html data-composition-id="ai-title" data-composition-duration="4">
  <body>
    <div id="stage" data-composition-id="ai-title" data-width="1920" data-height="1080">
      <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
      <script>
        window.__timelines = window.__timelines || {};
        const tl = gsap.timeline({ paused: true });
        const offset = Math.random();
        tl.to("#title", { x: offset });
        window.__timelines["ai-title"] = tl;
      </script>
    </div>
  </body>
</html>`,
      defaults,
    );

    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("[non_deterministic_code]");
  });

  it("builds a copyable repair prompt", () => {
    expect(buildCompositionRepairPrompt(["Missing timeline."], "<html></html>")).toContain(
      "Validation errors:",
    );
  });
});
