// Shared option sets and editor-mode types for character inspector panels.

import type {
  CharacterPart,
  CharacterVariantKind,
  EyeState,
  PartMotionBehavior,
  PartRole,
} from "../types";

export type EditorMode = "select" | "pivot" | "bounds-rect" | "bounds-ellipse";
export type EditorBoundsMode = "frame" | "art";

export const ROLE_OPTIONS: PartRole[] = [
  "head",
  "body",
  "eye",
  "iris",
  "eyebrow",
  "nose",
  "mouth",
  "arm",
  "upperArm",
  "lowerArm",
  "hand",
  "leg",
  "upperLeg",
  "lowerLeg",
  "foot",
  "hair",
  "accessory",
  "static",
  "custom",
];

export const SLOT_SIDE_OPTIONS: Array<{
  value: "" | NonNullable<CharacterPart["side"]>;
  label: string;
}> = [
  { value: "", label: "None" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "center", label: "Center" },
  { value: "front", label: "Front" },
  { value: "back", label: "Back" },
];

export const MOTION_BEHAVIOR_OPTIONS: Array<{ value: PartMotionBehavior; label: string }> = [
  { value: "none", label: "None" },
  { value: "blink", label: "Blink" },
  { value: "rotate", label: "Rotate" },
  { value: "raise", label: "Raise" },
  { value: "lipSync", label: "Lip Sync" },
  { value: "bounce", label: "Bounce" },
];

export const VARIANT_KIND_LABELS: Record<CharacterVariantKind, string> = {
  pose: "Pose",
  eyeState: "Eye state",
  viseme: "Viseme",
  handShape: "Hand shape",
  mouthShape: "Mouth shape",
  expression: "Expression",
  custom: "Custom",
};

export const SAMPLE_WORDS = ["Hello", "Shalom", "Mommy", "Welcome"];
export const EYE_STATES: EyeState[] = ["open", "half", "closed", "wink"];
