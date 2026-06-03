import { describe, expect, it } from "vitest";
import { extractCompositionOutline } from "../composition-outline";

describe("extractCompositionOutline", () => {
  it("returns timed nested HyperFrames clips when a composition has them", () => {
    const outline = extractCompositionOutline(
      `<template id="scene-template">
        <div data-composition-id="scene" data-width="1920" data-height="1080">
          <div id="title" data-type="text" data-start="0" data-duration="2" data-track-index="0">Launch</div>
          <img id="hero" src="asset:hero" data-start="2" data-duration="3" data-track-index="1" />
        </div>
      </template>`,
      { compositionId: "scene", duration: 5 },
    );

    expect(outline).toEqual([
      expect.objectContaining({
        id: "title",
        kind: "text",
        timed: true,
        start: 0,
        duration: 2,
      }),
      expect.objectContaining({
        id: "hero",
        kind: "image",
        timed: true,
        start: 2,
        duration: 3,
      }),
    ]);
  });

  it("falls back to DOM layers for rich custom composition scenes", () => {
    const outline = extractCompositionOutline(
      `<template id="scene-template">
        <div data-composition-id="scene" data-width="1920" data-height="1080">
          <div id="s3Bg"></div>
          <div id="s3Stage">
            <div id="s3PhoneLeft">
              <div id="s3Tagline">Unleash Full Potential</div>
            </div>
            <svg>
              <circle id="s3Ring" class="ring-fill"></circle>
            </svg>
          </div>
        </div>
      </template>`,
      { compositionId: "scene", duration: 5.5 },
    );

    expect(outline.map((item) => item.id)).toEqual([
      "s3Bg",
      "s3Stage",
      "s3PhoneLeft",
      "s3Tagline",
      "s3Ring",
    ]);
    expect(outline.find((item) => item.id === "s3Tagline")).toMatchObject({
      kind: "text",
      timed: false,
      duration: 5.5,
    });
  });
});
