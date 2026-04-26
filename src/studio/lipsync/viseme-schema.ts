import type { MouthViseme } from "../types";

export const MOUTH_VISEMES: MouthViseme[] = ["rest", "MBP", "FV", "AI", "E", "O", "U", "L"];

export const MOUTH_VISEME_DESCRIPTIONS: Record<MouthViseme, string> = {
  rest: "Neutral closed or slightly open resting mouth.",
  MBP: "Closed lips for M, B, and P sounds.",
  FV: "Upper teeth touching lower lip for F and V sounds.",
  AI: "Wide open mouth for A / ah / wide open speech shapes.",
  E: "Stretched smile shape for ee / ih sounds.",
  O: "Rounded open mouth for oh sounds.",
  U: "Small tight rounded mouth for oo / w sounds.",
  L: "Tongue-up shape for L sounds.",
};

export function legacyVisemeToStandard(viseme: string | undefined): MouthViseme | undefined {
  switch (viseme) {
    case undefined:
      return undefined;
    case "rest":
    case "MBP":
    case "FV":
    case "E":
    case "O":
    case "U":
    case "L":
      return viseme;
    case "A":
      return "AI";
    case "I":
      return "E";
    case "AI":
      return "AI";
    default:
      return undefined;
  }
}
