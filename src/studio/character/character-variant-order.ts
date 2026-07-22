// Shared semantic ordering for character variant lists and missing-variant controls.
import type { CharacterPart, EyeState, MouthViseme } from "../types";
import { variantKeyForPart } from "./character-utils";

export const CHARACTER_VISEME_ORDER: MouthViseme[] = [
  "rest",
  "A",
  "E",
  "O",
  "U",
  "MBP",
  "FV",
  "L",
  "WQ",
  "Smile",
];

export const CHARACTER_EYE_STATE_ORDER: EyeState[] = ["open", "half", "closed", "wink"];

/** Stable semantic ordering for variant controls and the layer rail. */
export function orderCharacterVariants(parts: CharacterPart[]): CharacterPart[] {
  return parts.slice().sort((a, b) => {
    if (a.role === "mouth" && b.role === "mouth") {
      return (
        CHARACTER_VISEME_ORDER.indexOf((a.viseme ?? variantKeyForPart(a)) as MouthViseme) -
        CHARACTER_VISEME_ORDER.indexOf((b.viseme ?? variantKeyForPart(b)) as MouthViseme)
      );
    }
    if (a.role === "eye" && b.role === "eye") {
      return (
        CHARACTER_EYE_STATE_ORDER.indexOf((a.eyeState ?? variantKeyForPart(a)) as EyeState) -
        CHARACTER_EYE_STATE_ORDER.indexOf((b.eyeState ?? variantKeyForPart(b)) as EyeState)
      );
    }
    const byVariant = variantKeyForPart(a).localeCompare(variantKeyForPart(b));
    if (byVariant !== 0) return byVariant;
    return a.zIndex - b.zIndex;
  });
}
