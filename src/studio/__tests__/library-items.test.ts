import { describe, expect, it } from "vitest";
import {
  LIBRARY_DRAG_MIME,
  buildTextClip,
  characterClipSize,
  findTextBlock,
  hasLibraryDragItem,
  mediaClipSize,
  readLibraryDragItem,
  topLeftFromCenter,
  writeLibraryDragItem,
  type LibraryDragItem,
} from "../library-items";

const STAGE = { width: 1920, height: 1080 };

/** Minimal DataTransfer stand-in — jsdom does not construct one for us. */
function fakeDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  const transfer = {
    types: [] as string[],
    effectAllowed: "none",
    setData(format: string, value: string) {
      store.set(format, value);
      transfer.types = [...store.keys()];
    },
    getData(format: string) {
      return store.get(format) ?? "";
    },
  };
  return transfer as unknown as DataTransfer;
}

describe("library drag payload", () => {
  it("round-trips each item kind through a custom MIME type", () => {
    const items: LibraryDragItem[] = [
      { kind: "media", mediaId: "m1" },
      { kind: "text", presetId: "title" },
      { kind: "character", characterId: "c1" },
    ];
    for (const item of items) {
      const dt = fakeDataTransfer();
      writeLibraryDragItem(dt, item);
      expect(dt.getData(LIBRARY_DRAG_MIME)).toBeTruthy();
      expect(hasLibraryDragItem(dt)).toBe(true);
      expect(readLibraryDragItem(dt)).toEqual(item);
    }
  });

  it("ignores drags that are not library items", () => {
    const dt = fakeDataTransfer();
    expect(hasLibraryDragItem(dt)).toBe(false);
    expect(readLibraryDragItem(dt)).toBeNull();
  });

  it("rejects malformed payloads instead of creating a broken clip", () => {
    for (const payload of ["not json", "{}", '{"kind":"media"}', '{"kind":"nope"}']) {
      const dt = fakeDataTransfer();
      dt.setData(LIBRARY_DRAG_MIME, payload);
      expect(readLibraryDragItem(dt)).toBeNull();
    }
  });
});

describe("placement", () => {
  it("centres on the drop point", () => {
    expect(topLeftFromCenter({ x: 960, y: 540 }, { width: 400, height: 200 }, STAGE)).toEqual({
      x: 760,
      y: 440,
    });
  });

  it("keeps a clip dropped near an edge fully on the canvas", () => {
    expect(topLeftFromCenter({ x: 0, y: 0 }, { width: 400, height: 200 }, STAGE)).toEqual({
      x: 0,
      y: 0,
    });
    expect(topLeftFromCenter({ x: 1920, y: 1080 }, { width: 400, height: 200 }, STAGE)).toEqual({
      x: 1520,
      y: 880,
    });
  });

  it("falls back to the canvas centre when there is no drop point", () => {
    expect(topLeftFromCenter(undefined, { width: 400, height: 200 }, STAGE)).toEqual({
      x: 760,
      y: 440,
    });
  });

  it("honours a per-block vertical default when clicked rather than dropped", () => {
    const block = findTextBlock("lower-third");
    expect(block).toBeDefined();
    const clip = buildTextClip({
      id: "t1",
      block: block!,
      stage: STAGE,
      placement: {},
      trackIndex: 2,
      zIndex: 3,
    });
    // yFactor 0.68 — a lower third sits low, not dead centre.
    expect(clip.y).toBe(Math.round(1080 * 0.68));
    expect(clip.start).toBe(0);
  });

  it("places a dropped text block at the drop point and start time", () => {
    const clip = buildTextClip({
      id: "t2",
      block: findTextBlock("caption")!,
      stage: STAGE,
      placement: { center: { x: 960, y: 300 }, start: 2.5, laneIndex: 1 },
      trackIndex: 2,
      zIndex: 3,
    });
    expect(clip.start).toBe(2.5);
    expect(clip.laneIndex).toBe(1);
    // The clip's centre lands on the drop point, up to the half-pixel the
    // integer rounding of the top-left corner can introduce.
    expect(Math.abs(clip.x + clip.width / 2 - 960)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(clip.y + clip.height / 2 - 300)).toBeLessThanOrEqual(0.5);
  });

  it("clamps a wide block dropped near the left edge instead of hanging it off-canvas", () => {
    // A title is 1190px wide, so centring it on x=500 would put its left at -95.
    const clip = buildTextClip({
      id: "t4",
      block: findTextBlock("title")!,
      stage: STAGE,
      placement: { center: { x: 500, y: 300 } },
      trackIndex: 0,
      zIndex: 0,
    });
    expect(clip.x).toBe(0);
    expect(clip.x + clip.width).toBeLessThanOrEqual(STAGE.width);
  });

  it("never gives a clip a negative start", () => {
    const clip = buildTextClip({
      id: "t3",
      block: findTextBlock("title")!,
      stage: STAGE,
      placement: { start: -5 },
      trackIndex: 0,
      zIndex: 0,
    });
    expect(clip.start).toBe(0);
  });
});

describe("sizing", () => {
  it("fits a character to a share of the canvas without distorting it", () => {
    const size = characterClipSize({ canvasWidth: 600, canvasHeight: 900 }, STAGE);
    expect(size.width / size.height).toBeCloseTo(600 / 900, 2);
    expect(size.width).toBeLessThanOrEqual(Math.round(STAGE.width * 0.42));
    expect(size.height).toBeLessThanOrEqual(Math.round(STAGE.height * 0.68));
  });

  it("scales oversized media down to fit, preserving aspect", () => {
    const size = mediaClipSize({ kind: "image", width: 3840, height: 2160 }, STAGE);
    expect(size).toEqual({ width: 1920, height: 1080 });
  });

  it("leaves audio without a stage box", () => {
    expect(mediaClipSize({ kind: "audio", width: 0, height: 0 }, STAGE)).toEqual({
      width: 0,
      height: 0,
    });
  });
});
