import { describe, expect, it } from "vitest";
import { makePart } from "../character-utils";
import {
  fitArtInZone,
  placementGuideZones,
  placementZoneFor,
  smartImportPlacement,
  zoneCanvasRect,
} from "../placement-guide";

describe("placement guide zones", () => {
  it("expands sided roles into mirrored left/right zones", () => {
    const zones = placementGuideZones();
    const leftEye = zones.find((zone) => zone.role === "eye" && zone.side === "left");
    const rightEye = zones.find((zone) => zone.role === "eye" && zone.side === "right");

    expect(leftEye).toBeTruthy();
    expect(rightEye).toBeTruthy();
    // Mirrored across the vertical center: x + width of one equals 1 − x of the other.
    expect(rightEye!.rect.x).toBeCloseTo(1 - leftEye!.rect.x - leftEye!.rect.width, 6);
    expect(rightEye!.rect.y).toBe(leftEye!.rect.y);
  });

  it("resolves zones by role and side, and refuses sided roles without a side", () => {
    expect(placementZoneFor("mouth")?.label).toBe("Mouth");
    expect(placementZoneFor("eye", "left")?.label).toBe("Left Eye");
    expect(placementZoneFor("eye")).toBeUndefined();
    expect(placementZoneFor("custom")).toBeUndefined();
  });

  it("contain-fits art into a zone, centered and aspect-kept", () => {
    const zone = { x: 100, y: 200, width: 200, height: 100 };
    // Wide art limited by zone width.
    expect(fitArtInZone(400, 100, zone)).toEqual({ x: 100, y: 225, width: 200, height: 50 });
    // Tall art limited by zone height, centered horizontally.
    expect(fitArtInZone(100, 400, zone)).toEqual({ x: 188, y: 200, width: 25, height: 100 });
  });
});

describe("smartImportPlacement", () => {
  const canvas = { canvasWidth: 600, canvasHeight: 900 };

  it("fits art for an empty slot into its guide zone", () => {
    const placement = smartImportPlacement({
      slotParts: [],
      role: "mouth",
      artWidth: 200,
      artHeight: 100,
      ...canvas,
    });
    const zone = zoneCanvasRect(placementZoneFor("mouth")!, 600, 900);

    expect(placement?.mode).toBe("zone");
    // Contained in the mouth zone.
    expect(placement!.x).toBeGreaterThanOrEqual(Math.floor(zone.x));
    expect(placement!.y).toBeGreaterThanOrEqual(Math.floor(zone.y));
    expect(placement!.x + placement!.width).toBeLessThanOrEqual(Math.ceil(zone.x + zone.width));
    expect(placement!.y + placement!.height).toBeLessThanOrEqual(Math.ceil(zone.y + zone.height));
  });

  it("returns null when there is no reference art and no zone", () => {
    expect(
      smartImportPlacement({
        slotParts: [],
        role: "custom",
        artWidth: 100,
        artHeight: 100,
        ...canvas,
      }),
    ).toBeNull();
  });

  it("sizes a new variant to the default variant's visible width and centers on it", () => {
    const open = makePart("eye", "eye-open-media", {
      id: "eye-open",
      slotId: "slot:left-eye",
      side: "left",
      eyeState: "open",
      x: 180,
      y: 180,
      width: 48,
      height: 28,
      zIndex: 4,
    });
    // Closed art authored at 2× resolution: 96px wide source.
    const placement = smartImportPlacement({
      slotParts: [open],
      role: "eye",
      side: "left",
      artWidth: 96,
      artHeight: 24,
      ...canvas,
    });

    expect(placement?.mode).toBe("variant");
    // Scaled to the open eye's 48px visible width…
    expect(placement!.width).toBe(48);
    expect(placement!.height).toBe(12);
    // …and centered on the open eye's center (204, 194).
    expect(placement!.x + placement!.width / 2).toBeCloseTo(204, 0);
    expect(placement!.y + placement!.height / 2).toBeCloseTo(194, 0);
  });

  it("uses alpha bounds of the imported art when they exist", () => {
    const open = makePart("eye", "eye-open-media", {
      id: "eye-open",
      slotId: "slot:left-eye",
      side: "left",
      eyeState: "open",
      x: 180,
      y: 180,
      width: 48,
      height: 28,
      zIndex: 4,
    });
    // 200px-wide source whose pixels occupy only the right 50px.
    const placement = smartImportPlacement({
      slotParts: [open],
      role: "eye",
      side: "left",
      artWidth: 200,
      artHeight: 28,
      alphaBounds: {
        x: 150,
        y: 0,
        width: 50,
        height: 28,
        sourceWidth: 200,
        sourceHeight: 28,
        threshold: 8,
      },
      ...canvas,
    });

    // Visible pixels scale to 48px (scale ≈ 0.96 on a 200px frame → 192px frame),
    // and the visible center — not the frame center — lands on (204, 194).
    expect(placement!.width).toBe(192);
    const scale = placement!.width / 200;
    const visibleCenterX = placement!.x + (150 + 25) * scale;
    expect(visibleCenterX).toBeCloseTo(204, 0);
  });
});
