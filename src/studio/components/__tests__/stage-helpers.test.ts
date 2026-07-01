import { describe, expect, it } from "vitest";
import {
  compositionDomRectToCss,
  compositionPointToCss,
  compositionRectToCss,
  getStageGeometry,
  keyboardNudgeDelta,
  pointerDeltaToComposition,
  pointerAngleDegrees,
  pixelBoundsToRenderedRect,
  resizeCompositionRect,
  rotationDeltaDegrees,
  roundCompositionRect,
  roundRotationDegrees,
  resolvePickedClipId,
  resolveTargetClipId,
  scaleCompositionRectFromHandleRect,
  snapCompositionRect,
  snapRotationDegrees,
  rectsOverlap,
  marqueeHitIds,
  compositionGroupCenter,
  compositionGroupBounds,
  groupFlipPatch,
  snapGuideSignature,
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

  it("freeze & ghost: the on-screen ghost maps back to the exact committed value (no drift)", () => {
    const geometry = { rect: new DOMRect(20, 30, 960, 540), scaleX: 2, scaleY: 2 };

    // The composition value that gets committed to rootHtml on release.
    const committed = { x: 400, y: 200, width: 300, height: 150 };

    // The ghost overlay renders that value on screen through the same helper the commit
    // path uses to derive geometry. Inverting the mapping must return the committed value
    // exactly — i.e. what the user SEES is what gets SAVED.
    const ghostCss = compositionRectToCss(committed, geometry);
    const recovered = {
      x: (ghostCss.left - geometry.rect.left) * geometry.scaleX,
      y: (ghostCss.top - geometry.rect.top) * geometry.scaleY,
      width: ghostCss.width * geometry.scaleX,
      height: ghostCss.height * geometry.scaleY,
    };
    expect(recovered).toEqual(committed);

    // A drag of D screen px commits exactly D*scale composition px — the same delta the
    // ghost moved by — so the frozen element never jumps on release.
    const screenDelta = { x: 24, y: -12 };
    const compDelta = pointerDeltaToComposition(screenDelta.x, screenDelta.y, geometry);
    expect(compDelta).toEqual({ x: 48, y: -24 });
    expect({ x: compDelta.x / geometry.scaleX, y: compDelta.y / geometry.scaleY }).toEqual(
      screenDelta,
    );
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
    expect(compositionPointToCss({ x: 300, y: 140 }, geometry)).toEqual({ x: 170, y: 100 });
    expect(compositionDomRectToCss(new DOMRect(200, 120, 400, 300), geometry)).toEqual({
      left: 120,
      top: 90,
      width: 200,
      height: 150,
    });
  });

  it("maps arrow keys to composition-pixel nudge deltas", () => {
    expect(keyboardNudgeDelta("ArrowLeft", 10)).toEqual({ x: -10, y: 0 });
    expect(keyboardNudgeDelta("ArrowRight", 1)).toEqual({ x: 1, y: 0 });
    expect(keyboardNudgeDelta("ArrowUp", 10)).toEqual({ x: 0, y: -10 });
    expect(keyboardNudgeDelta("ArrowDown", 1)).toEqual({ x: 0, y: 1 });
    expect(keyboardNudgeDelta("Enter", 1)).toBeNull();
  });

  it("computes pointer rotation angles in viewport coordinates", () => {
    expect(pointerAngleDegrees(100, 100, 200, 100)).toBeCloseTo(0);
    expect(pointerAngleDegrees(100, 100, 100, 200)).toBeCloseTo(90);
    expect(pointerAngleDegrees(100, 100, 100, 0)).toBeCloseTo(-90);
    expect(pointerAngleDegrees(100, 100, 0, 100)).toBeCloseTo(180);
  });

  it("accumulates rotation deltas across the 180 degree boundary", () => {
    expect(rotationDeltaDegrees(170, -170)).toBeCloseTo(20);
    expect(rotationDeltaDegrees(-170, 170)).toBeCloseTo(-20);
    expect(rotationDeltaDegrees(10, 40)).toBeCloseTo(30);
  });

  it("snaps and rounds rotation values", () => {
    expect(snapRotationDegrees(22, 15)).toBe(15);
    expect(snapRotationDegrees(23, 15)).toBe(30);
    expect(snapRotationDegrees(-22, 15)).toBe(-15);
    expect(roundRotationDegrees(12.34)).toBe(12.3);
    expect(roundRotationDegrees(12.36)).toBe(12.4);
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

  it("scales the full clip box from a visible-pixel handle rect", () => {
    expect(
      scaleCompositionRectFromHandleRect(
        { x: 100, y: 100, width: 200, height: 200 },
        { x: 150, y: 150, width: 100, height: 100 },
        { x: 150, y: 150, width: 150, height: 150 },
      ),
    ).toEqual({ x: 75, y: 75, width: 300, height: 300 });
  });

  it("rounds committed resize values to composition pixels", () => {
    expect(roundCompositionRect({ x: 10.2, y: 20.7, width: 99.5, height: 0.2 })).toEqual({
      x: 10,
      y: 21,
      width: 100,
      height: 1,
    });
  });

  it("snaps moving rects to canvas centers and exposes visual guide positions", () => {
    const result = snapCompositionRect(
      { x: 902, y: 502, width: 120, height: 80 },
      [{ id: "canvas", kind: "canvas", rect: { x: 0, y: 0, width: 1920, height: 1080 } }],
      10,
    );

    expect(result.rect).toEqual({ x: 900, y: 500, width: 120, height: 80 });
    expect(result.guides).toEqual([
      expect.objectContaining({ axis: "x", position: 960, targetAnchor: "center" }),
      expect.objectContaining({ axis: "y", position: 540, targetAnchor: "center" }),
    ]);
  });

  it("snaps moving rects to neighboring clip edges within threshold", () => {
    const result = snapCompositionRect(
      { x: 244, y: 204, width: 50, height: 40 },
      [{ id: "other", kind: "clip", rect: { x: 300, y: 200, width: 80, height: 60 } }],
      8,
    );

    expect(result.rect).toEqual({ x: 250, y: 200, width: 50, height: 40 });
    expect(result.guides).toEqual([
      expect.objectContaining({ axis: "x", position: 300, targetId: "other" }),
      expect.objectContaining({ axis: "y", position: 200, targetId: "other" }),
    ]);
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

  it("resolves clicked targets that come from an iframe realm", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    iframe.contentDocument?.open();
    iframe.contentDocument?.write(`<!DOCTYPE html><html><body>
      <div id="clip-9"><span id="inside-frame">Inside</span></div>
    </body></html>`);
    iframe.contentDocument?.close();

    const inner = iframe.contentDocument?.getElementById("inside-frame") ?? null;

    expect(resolveTargetClipId(inner, new Set(["clip-9"]))).toBe("clip-9");
    iframe.remove();
  });
});

describe("marquee selection hit-testing", () => {
  const box = { left: 10, top: 10, width: 100, height: 100 };

  it("overlaps rects that share area and rejects those that only touch or miss", () => {
    expect(rectsOverlap(box, { left: 50, top: 50, width: 20, height: 20 })).toBe(true);
    expect(rectsOverlap(box, { left: 100, top: 50, width: 20, height: 20 })).toBe(true);
    // Edge-touching (zero-area overlap) is not a hit.
    expect(rectsOverlap(box, { left: 110, top: 10, width: 20, height: 20 })).toBe(false);
    // Fully outside.
    expect(rectsOverlap(box, { left: 200, top: 200, width: 20, height: 20 })).toBe(false);
  });

  it("returns the ids of every target the band overlaps, preserving input order", () => {
    const targets = [
      { id: "a", rect: { left: 0, top: 0, width: 30, height: 30 } }, // overlaps
      { id: "b", rect: { left: 500, top: 500, width: 30, height: 30 } }, // outside
      { id: "c", rect: { left: 80, top: 80, width: 60, height: 60 } }, // overlaps
    ];
    expect(marqueeHitIds(box, targets)).toEqual(["a", "c"]);
  });

  it("selects nothing when the band is empty of targets", () => {
    expect(
      marqueeHitIds(box, [{ id: "z", rect: { left: 300, top: 300, width: 10, height: 10 } }]),
    ).toEqual([]);
  });
});

describe("group flip", () => {
  it("computes the bounding-box center of a set of composition boxes", () => {
    expect(
      compositionGroupCenter([
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 200, y: 100, width: 100, height: 100 },
      ]),
    ).toEqual({ cx: 150, cy: 100 });
    expect(compositionGroupCenter([])).toBeNull();
  });

  it("mirrors a clip horizontally across the group center and toggles scaleX", () => {
    // Group of two 100-wide clips at x=0 and x=200 → bbox [0,300], center cx=150.
    const center = { cx: 150, cy: 100 };
    // Left clip (x=0..100) reflects to the right edge (x=200..300); scaleX toggles, y/scaleY hold.
    expect(
      groupFlipPatch({ x: 0, y: 40, width: 100, height: 100, scaleX: 1, scaleY: 1 }, "h", center),
    ).toEqual({ x: 200, y: 40, scaleX: -1, scaleY: 1 });
    // An already-mirrored clip flips back to +1.
    expect(
      groupFlipPatch(
        { x: 200, y: 40, width: 100, height: 100, scaleX: -1, scaleY: 1 },
        "h",
        center,
      ),
    ).toEqual({ x: 0, y: 40, scaleX: 1, scaleY: 1 });
  });

  it("mirrors a clip vertically across the group center and toggles scaleY", () => {
    const center = { cx: 150, cy: 100 };
    expect(
      groupFlipPatch({ x: 30, y: 0, width: 100, height: 40, scaleX: 1, scaleY: 1 }, "v", center),
    ).toEqual({ x: 30, y: 160, scaleX: 1, scaleY: -1 });
  });

  it("is an involution: flipping the same axis twice restores the original box", () => {
    const center = { cx: 150, cy: 100 };
    const original = { x: 20, y: 40, width: 80, height: 60, scaleX: 1, scaleY: 1 };
    const once = groupFlipPatch(original, "h", center);
    const twice = groupFlipPatch(
      { ...once, width: original.width, height: original.height },
      "h",
      center,
    );
    expect(twice).toEqual({
      x: original.x,
      y: original.y,
      scaleX: original.scaleX,
      scaleY: original.scaleY,
    });
  });
});

describe("group snapping helpers", () => {
  it("computes the bounding box of a set of composition boxes", () => {
    expect(
      compositionGroupBounds([
        { x: 10, y: 20, width: 100, height: 40 },
        { x: 200, y: 100, width: 50, height: 50 },
      ]),
    ).toEqual({ x: 10, y: 20, width: 240, height: 130 });
    expect(compositionGroupBounds([])).toBeNull();
  });

  it("keeps compositionGroupCenter consistent with the bounds it derives from", () => {
    const clips = [
      { x: 10, y: 20, width: 100, height: 40 },
      { x: 200, y: 100, width: 50, height: 50 },
    ];
    const bounds = compositionGroupBounds(clips)!;
    expect(compositionGroupCenter(clips)).toEqual({
      cx: bounds.x + bounds.width / 2,
      cy: bounds.y + bounds.height / 2,
    });
  });

  it("builds a stable, change-detecting signature for a guide set", () => {
    const a = [
      {
        axis: "x" as const,
        position: 100,
        sourceAnchor: "start" as const,
        targetAnchor: "start" as const,
        targetId: "clip-1",
      },
    ];
    const b = [
      {
        axis: "x" as const,
        position: 100,
        sourceAnchor: "center" as const,
        targetAnchor: "end" as const,
        targetId: "clip-1",
      },
    ];
    // Only axis/position/targetId matter for identity — anchors don't change the signature.
    expect(snapGuideSignature(a)).toBe(snapGuideSignature(b));
    expect(snapGuideSignature([])).toBe("");
    expect(snapGuideSignature(a)).not.toBe(snapGuideSignature([{ ...a[0]!, position: 101 }]));
  });
});
