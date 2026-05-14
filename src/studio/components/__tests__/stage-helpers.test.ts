import { describe, expect, it } from "vitest";
import {
  compositionDomRectToCss,
  compositionRectToCss,
  getStageGeometry,
  pointerDeltaToComposition,
  pixelBoundsToRenderedRect,
  resizeCompositionRect,
  resolvePickedClipId,
  resolveTargetClipId,
} from "../stage-helpers";

describe("stage helpers", () => {
  it("computes a contained composition box inside the stage shell", () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "getBoundingClientRect", {
      value: () => new DOMRect(0, 0, 1000, 1000),
    });

    const geometry = getStageGeometry(container, 1920, 1080);

    expect(geometry.rect.left).toBeCloseTo(0);
    expect(geometry.rect.top).toBeCloseTo(218.75);
    expect(geometry.rect.width).toBeCloseTo(1000);
    expect(geometry.rect.height).toBeCloseTo(562.5);
    expect(geometry.scaleX).toBeCloseTo(1.92);
    expect(geometry.scaleY).toBeCloseTo(1.92);
  });

  it("uses the rendered iframe box when one is available", () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "getBoundingClientRect", {
      value: () => new DOMRect(100, 50, 1200, 800),
    });

    const geometry = getStageGeometry(container, 1920, 1080, new DOMRect(220, 100, 960, 540));

    expect(geometry.rect.left).toBe(120);
    expect(geometry.rect.top).toBe(50);
    expect(geometry.rect.width).toBe(960);
    expect(geometry.rect.height).toBe(540);
  });

  it("converts pointer deltas and composition rects through stage scale", () => {
    const geometry = {
      rect: new DOMRect(20, 30, 960, 540),
      scaleX: 2,
      scaleY: 2,
    };

    expect(pointerDeltaToComposition(15, -10, geometry)).toEqual({ x: 30, y: -20 });
    expect(compositionRectToCss({ x: 200, y: 120, width: 400, height: 300 }, geometry)).toEqual({
      left: 120,
      top: 90,
      width: 200,
      height: 150,
    });
    expect(compositionDomRectToCss(new DOMRect(200, 120, 400, 300), geometry)).toEqual({
      left: 120,
      top: 90,
      width: 200,
      height: 150,
    });
  });

  it("maps measured pixel bounds into rendered element coordinates", () => {
    const rect = pixelBoundsToRenderedRect(
      { x: 10, y: 20, width: 40, height: 30, sampleWidth: 100, sampleHeight: 100 },
      new DOMRect(200, 300, 500, 400),
    );

    expect(rect.left).toBe(250);
    expect(rect.top).toBe(380);
    expect(rect.width).toBe(200);
    expect(rect.height).toBe(120);
  });

  it("resizes composition rects from each corner while anchoring the opposite corner", () => {
    expect(
      resizeCompositionRect({
        handle: "se",
        startX: 100,
        startY: 100,
        startWidth: 80,
        startHeight: 40,
        deltaX: 20,
        deltaY: 10,
      }),
    ).toEqual({ x: 100, y: 100, width: 100, height: 50 });

    expect(
      resizeCompositionRect({
        handle: "nw",
        startX: 100,
        startY: 100,
        startWidth: 80,
        startHeight: 40,
        deltaX: 10,
        deltaY: 5,
      }),
    ).toEqual({ x: 110, y: 105, width: 70, height: 35 });

    expect(
      resizeCompositionRect({
        handle: "ne",
        startX: 100,
        startY: 100,
        startWidth: 80,
        startHeight: 40,
        deltaX: 20,
        deltaY: -10,
      }),
    ).toEqual({ x: 100, y: 90, width: 100, height: 50 });

    expect(
      resizeCompositionRect({
        handle: "sw",
        startX: 100,
        startY: 100,
        startWidth: 80,
        startHeight: 40,
        deltaX: -20,
        deltaY: 10,
      }),
    ).toEqual({ x: 80, y: 100, width: 100, height: 50 });
  });

  it("clamps resized composition rects to a minimum size", () => {
    expect(
      resizeCompositionRect({
        handle: "nw",
        startX: 100,
        startY: 100,
        startWidth: 80,
        startHeight: 40,
        deltaX: 1000,
        deltaY: 1000,
        minSize: 16,
      }),
    ).toEqual({ x: 164, y: 124, width: 16, height: 16 });
  });

  it("preserves aspect ratio during resize when requested", () => {
    expect(
      resizeCompositionRect({
        handle: "se",
        startX: 100,
        startY: 100,
        startWidth: 80,
        startHeight: 40,
        deltaX: 40,
        deltaY: 0,
        preserveAspect: true,
      }),
    ).toEqual({ x: 100, y: 100, width: 120, height: 60 });

    expect(
      resizeCompositionRect({
        handle: "nw",
        startX: 100,
        startY: 100,
        startWidth: 80,
        startHeight: 40,
        deltaX: 20,
        deltaY: 0,
        preserveAspect: true,
      }),
    ).toEqual({ x: 120, y: 110, width: 60, height: 30 });
  });

  it("resolves nested picked nodes back to the owning clip id", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    iframe.contentDocument?.open();
    iframe.contentDocument?.write(`<!DOCTYPE html><html><body>
      <div id="clip-1">
        <div class="inner">
          <span id="nested-leaf">Label</span>
        </div>
      </div>
    </body></html>`);
    iframe.contentDocument?.close();

    const clipId = resolvePickedClipId(
      iframe,
      {
        id: "nested-leaf",
        tagName: "span",
        selector: "#nested-leaf",
        label: "Label",
        boundingBox: { x: 0, y: 0, width: 10, height: 10 },
        textContent: "Label",
        src: null,
        dataAttributes: {},
        computedStyles: {},
      },
      new Set(["clip-1"]),
    );

    expect(clipId).toBe("clip-1");
    iframe.remove();
  });

  it("resolves clicked targets or owning frame nodes back to clip ids", () => {
    const clip = document.createElement("div");
    clip.id = "clip-7";
    const inner = document.createElement("span");
    clip.appendChild(inner);

    expect(resolveTargetClipId(inner, new Set(["clip-7"]))).toBe("clip-7");

    const frame = document.createElement("iframe");
    frame.id = "clip-8";
    expect(resolveTargetClipId(null, new Set(["clip-8"]), frame)).toBe("clip-8");
  });
});
