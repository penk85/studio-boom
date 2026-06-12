import type { CharacterPreset } from "../../types";
import { createBlankCharacter, makePart } from "../character-utils";

/**
 * The real-world variant regression fixture: an upper arm with `straight` and `bent` variants,
 * a hand child slot with art paired to both, and (via `withFistVariant`) a fist variant whose
 * rotation limits are tighter than the hand slot's reach. Canvas is the blank-character default
 * 600x900, so a 300x450 composition renders at scale 0.5.
 */
export function makeVariantArmCharacter(): CharacterPreset {
  return {
    ...createBlankCharacter("Variant arm actor"),
    id: "variant-arm-actor",
    parts: [
      makePart("body", "body-media", {
        id: "body",
        slotId: "role:body",
        x: 100,
        y: 120,
        width: 200,
        height: 320,
        zIndex: 1,
        pivot: { x: 200, y: 280 },
      }),
      makePart("arm", "arm-straight-media", {
        id: "arm-straight",
        slotId: "slot:right-arm",
        side: "right",
        pose: "straight",
        x: 280,
        y: 160,
        width: 60,
        height: 180,
        zIndex: 2,
        pivot: { x: 290, y: 170 },
      }),
      makePart("arm", "arm-bent-media", {
        id: "arm-bent",
        slotId: "slot:right-arm",
        side: "right",
        pose: "bent",
        x: 280,
        y: 160,
        width: 90,
        height: 120,
        zIndex: 2,
        pivot: { x: 290, y: 170 },
      }),
      makePart("hand", "hand-straight-media", {
        id: "hand-straight",
        slotId: "slot:right-hand",
        side: "right",
        pose: "straight",
        x: 290,
        y: 340,
        width: 40,
        height: 40,
        zIndex: 3,
        pivot: { x: 300, y: 345 },
      }),
      makePart("hand", "hand-bent-media", {
        id: "hand-bent",
        slotId: "slot:right-hand",
        side: "right",
        pose: "bent",
        x: 360,
        y: 220,
        width: 40,
        height: 40,
        zIndex: 3,
        pivot: { x: 370, y: 230 },
      }),
    ],
  };
}

/** Add a fist hand variant whose rotation limits are tighter than any slot reach. */
export function withFistVariant(character: CharacterPreset): CharacterPreset {
  return {
    ...character,
    parts: [
      ...character.parts,
      makePart("hand", "hand-fist-media", {
        id: "hand-fist",
        slotId: "slot:right-hand",
        side: "right",
        pose: "fist",
        x: 290,
        y: 340,
        width: 36,
        height: 36,
        zIndex: 3,
        pivot: { x: 300, y: 345 },
      }),
    ],
    variantPackages: [
      ...(character.variantPackages ?? []),
      {
        id: "variant:hand-fist",
        slotId: "slot:right-hand",
        key: "fist",
        displayName: "Closed fist",
        rig: {
          bones: [
            {
              id: "vbone:fist",
              pivot: { x: 300, y: 345 },
              rotationLimits: [-15, 15],
            },
          ],
        },
      },
    ],
  };
}
