// Shared preview state and pure preview-label/viseme helpers for character authoring.

import type { CharacterPart, MouthViseme, PartRole } from "../types";

export interface PreviewState {
  kind: "blink" | "talk" | "wave" | "kick" | "nod" | "bounce" | "raise";
  targetPartId: string;
  targetSlotId: string;
  targetRole: PartRole;
  startedAt: number;
  durationMs: number;
  visemes?: MouthViseme[];
  /** When set, talk shows exactly this viseme during live audio-driven testing. */
  forcedViseme?: MouthViseme;
  /** Audio drives the preview frame-by-frame; lifetime is managed by playback. */
  audioDriven?: boolean;
}

export function previewLabels(
  part: CharacterPart,
): Array<{ kind: PreviewState["kind"]; label: string }> {
  const out: Array<{ kind: PreviewState["kind"]; label: string }> = [];
  if (part.role === "eye" || (part.role === "custom" && part.motionBehavior === "blink")) {
    out.push({ kind: "blink", label: "Test Blink" });
  }
  if (part.role === "mouth" || (part.role === "custom" && part.motionBehavior === "lipSync")) {
    out.push({ kind: "talk", label: "Test Talk" });
  }
  if (part.role === "arm" || part.role === "upperArm" || part.role === "lowerArm") {
    out.push({ kind: "wave", label: "Test Wave" });
  }
  if (
    part.role === "leg" ||
    part.role === "upperLeg" ||
    part.role === "lowerLeg" ||
    part.role === "foot"
  ) {
    out.push({ kind: "kick", label: "Test Kick" });
  }
  if (part.role === "custom" && part.motionBehavior === "rotate") {
    out.push({ kind: "wave", label: "Test Wave" });
  }
  if (part.role === "head") out.push({ kind: "nod", label: "Test Nod" });
  if (part.role === "hair" || (part.role === "custom" && part.motionBehavior === "bounce")) {
    out.push({ kind: "bounce", label: "Test Bounce" });
  }
  if (part.role === "eyebrow" || (part.role === "custom" && part.motionBehavior === "raise")) {
    out.push({ kind: "raise", label: "Test Raise" });
  }
  return out;
}

export function wordToVisemes(word: string): MouthViseme[] {
  const map: Record<string, MouthViseme> = {
    a: "A",
    e: "E",
    i: "E",
    o: "O",
    u: "U",
    m: "MBP",
    b: "MBP",
    p: "MBP",
    f: "FV",
    v: "FV",
    l: "L",
    w: "WQ",
    q: "WQ",
  };
  return [
    "rest",
    ...word
      .toLowerCase()
      .split("")
      .map((character) => map[character] ?? "E"),
    "rest",
  ];
}
