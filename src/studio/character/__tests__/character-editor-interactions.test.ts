import { describe, expect, it } from "vitest";
import type { CharacterPart } from "../../types";
import type { AlphaHitMask } from "../alpha-bounds";
import { makePart } from "../character-utils";
import {
  hitTestCharacterEditorParts,
  resizeAnchorForCorner,
  resizeScaleForPointerDelta,
  rotateCharacterPartsFromSnapshot,
  scaleCharacterPartsFromSnapshot,
  snapshotCharacterPartTransforms,
} from "../character-editor-interactions";
import type { EditorPartTransform } from "../character-editor-geometry";

const identityTransform: EditorPartTransform = {
  dx: 0,
  dy: 0,
  rotation: 0,
  scale: 1,
  opacity: 1,
};

const alphaMask = (alpha: number): AlphaHitMask => ({
  data: new Uint8ClampedArray([0, 0, 0, alpha]),
  sampleWidth: 1,
  sampleHeight: 1,
  sourceWidth: 100,
  sourceHeight: 100,
  threshold: 8,
});

function part(id: string, options: Partial<CharacterPart> = {}) {
  return makePart("custom", id, {
    id,
    slotId: `custom:${id}`,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    visible: true,
    ...options,
  });
}

describe("character editor interactions", () => {
  it("orders alpha-exact hits before topmost padded hits", () => {
    const lower = part("lower", { zIndex: 1 });
    const upper = part("upper", { zIndex: 2 });
    const masks = new Map([
      [lower.id, alphaMask(255)],
      [upper.id, alphaMask(0)],
    ]);

    expect(
      hitTestCharacterEditorParts({
        parts: [lower, upper],
        point: { x: 50, y: 50 },
        selectedPartId: null,
        viewportScale: 1,
        boundsMode: "art",
        transformForPart: () => identityTransform,
        alphaMaskForPart: (candidate) => masks.get(candidate.id),
      }).map((candidate) => candidate.id),
    ).toEqual(["lower", "upper"]);
  });

  it("skips inactive variants while keeping the selected variant selectable", () => {
    const rest = part("arm-rest", {
      role: "arm",
      slotId: "role:arm",
      variant: { key: "rest" },
      zIndex: 1,
    });
    const bent = part("arm-bent", {
      role: "arm",
      slotId: "role:arm",
      variant: { key: "bent" },
      zIndex: 2,
    });
    const options = {
      parts: [rest, bent],
      point: { x: 50, y: 50 },
      viewportScale: 1,
      boundsMode: "frame" as const,
      transformForPart: () => identityTransform,
      activeVariantForPart: () => "bent",
    };

    expect(
      hitTestCharacterEditorParts({ ...options, selectedPartId: null }).map(
        (candidate) => candidate.id,
      ),
    ).toEqual(["arm-bent"]);
    expect(
      hitTestCharacterEditorParts({ ...options, selectedPartId: rest.id }).map(
        (candidate) => candidate.id,
      ),
    ).toEqual(["arm-bent", "arm-rest"]);
  });

  it("derives resize anchors, scale, and transformed part snapshots", () => {
    const original = part("arm", {
      x: 10,
      y: 20,
      width: 40,
      height: 20,
      pivot: { x: 30, y: 30 },
      rotation: 5,
    });
    const bounds = { x: 10, y: 20, width: 40, height: 20 };
    const anchor = resizeAnchorForCorner(bounds, "se");
    const scale = resizeScaleForPointerDelta(bounds, "se", anchor, 40, 20);
    const snapshot = snapshotCharacterPartTransforms([original]);
    const [resized] = scaleCharacterPartsFromSnapshot(
      [original],
      snapshot,
      anchor,
      scale.scaleX,
      scale.scaleY,
    );
    const [rotated] = rotateCharacterPartsFromSnapshot([original], snapshot, { x: 0, y: 0 }, 90);

    expect(anchor).toEqual({ x: 10, y: 20 });
    expect(scale).toEqual({ scaleX: 2, scaleY: 2 });
    expect(resized).toMatchObject({
      x: 10,
      y: 20,
      width: 80,
      height: 40,
      pivot: { x: 50, y: 40 },
    });
    expect(rotated).toMatchObject({
      x: -50,
      y: 20,
      pivot: { x: -30, y: 30 },
      rotation: 95,
    });
  });
});
