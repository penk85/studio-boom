import type { MouthViseme } from "../types";

export const MOUTH_VISEMES: MouthViseme[] = [
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

export const MOUTH_VISEME_DESCRIPTIONS: Record<MouthViseme, string> = {
  rest: "Neutral closed or slightly open resting mouth.",
  A: "Wide open mouth for A / ah sounds.",
  E: "Stretched smile shape for ee / ih sounds.",
  O: "Rounded open mouth for oh sounds.",
  U: "Small tight rounded mouth for oo / w sounds.",
  MBP: "Closed lips for M, B, and P sounds.",
  FV: "Upper teeth touching lower lip for F and V sounds.",
  L: "Tongue-up shape for L sounds.",
  WQ: "Pursed rounded shape for W and Q sounds.",
  Smile: "Optional smile expression mouth.",
};

export function legacyVisemeToStandard(viseme: string | undefined): MouthViseme | undefined {
  switch (viseme) {
    case undefined:
      return undefined;
    case "rest":
    case "MBP":
    case "FV":
    case "A":
    case "E":
    case "O":
    case "U":
    case "L":
    case "WQ":
    case "Smile":
      return viseme;
    case "AI":
      return "A";
    case "I":
      return "E";
    case "W":
    case "Q":
      return "WQ";
    default:
      return undefined;
  }
}
