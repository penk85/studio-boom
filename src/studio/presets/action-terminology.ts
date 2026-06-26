import type { AppliedMotion, MotionCategory, MotionPreset, MotionRegion, PartRole } from "../types";

export type ActionLaneKind = "expression" | "action" | "camera";

export const ACTION_CATEGORY_ORDER: MotionCategory[] = [
  "expression",
  "headTurn",
  "gesture",
  "full-body",
  "camera",
  "custom",
];

export const ACTION_CATEGORY_TABS: Array<{ id: MotionCategory | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "expression", label: "Expression" },
  { id: "gesture", label: "Gesture" },
  { id: "full-body", label: "Full body action" },
  { id: "camera", label: "Camera cue" },
  { id: "headTurn", label: "Head turn" },
  { id: "custom", label: "Custom" },
];

export const ACTION_CATEGORY_LABELS: Record<MotionCategory, string> = {
  expression: "Expression",
  gesture: "Gesture",
  "full-body": "Full body action",
  camera: "Camera cue",
  headTurn: "Head turn",
  custom: "Custom",
};

export const ACTION_CATEGORY_COLORS: Record<MotionCategory, string> = {
  expression: "bg-sky-500/75 border-sky-300/80",
  gesture: "bg-emerald-500/75 border-emerald-300/80",
  "full-body": "bg-amber-500/80 border-amber-300/80",
  camera: "bg-violet-500/75 border-violet-300/80",
  headTurn: "bg-fuchsia-500/75 border-fuchsia-300/80",
  custom: "bg-slate-400/75 border-slate-200/80",
};

export const ACTION_CATEGORY_DOT_COLORS: Record<MotionCategory, string> = {
  expression: "bg-sky-300",
  gesture: "bg-emerald-300",
  "full-body": "bg-amber-300",
  camera: "bg-violet-300",
  headTurn: "bg-fuchsia-300",
  custom: "bg-slate-300",
};

export const ACTION_LANE_ORDER: ActionLaneKind[] = ["expression", "action", "camera"];

export const ACTION_LANE_LABELS: Record<ActionLaneKind, string> = {
  expression: "Expressions",
  action: "Actions",
  camera: "Camera cues",
};

export const ACTION_LANE_DOT_COLORS: Record<ActionLaneKind, string> = {
  expression: "bg-sky-300",
  action: "bg-amber-300",
  camera: "bg-violet-300",
};

export const ACTION_REGION_OPTIONS: Array<{ id: MotionRegion; label: string }> = [
  { id: "fullBody", label: "Full body" },
  { id: "upperBody", label: "Upper body" },
  { id: "lowerBody", label: "Lower body" },
  { id: "face", label: "Face" },
  { id: "head", label: "Head" },
  { id: "hands", label: "Hands" },
  { id: "camera", label: "Camera" },
  { id: "custom", label: "Custom" },
];

export function actionBadgeFallback(count: number) {
  return count === 1 ? "1 action" : `${count} actions`;
}

export function actionTitle(names: string[]) {
  if (names.length === 0) return undefined;
  return `Actions: ${names.join(", ")}`;
}

export function actionLaneForCategory(category: MotionCategory): ActionLaneKind {
  if (category === "expression" || category === "headTurn") return "expression";
  if (category === "camera") return "camera";
  return "action";
}

export function actionLaneForPreset(preset: MotionPreset | undefined): ActionLaneKind {
  return actionLaneForCategory(preset?.category ?? "custom");
}

export function isActionCategoryExclusive(category: MotionCategory) {
  return actionLaneForCategory(category) === "expression";
}

export function defaultActionRegionForCategory(category: MotionCategory): MotionRegion {
  switch (category) {
    case "expression":
      return "face";
    case "headTurn":
      return "head";
    case "gesture":
      return "upperBody";
    case "full-body":
      return "fullBody";
    case "camera":
      return "camera";
    case "custom":
      return "fullBody";
  }
}

export function defaultActionRegion(preset: MotionPreset | undefined): MotionRegion {
  return preset?.region ?? defaultActionRegionForCategory(preset?.category ?? "custom");
}

export function effectiveActionRegion(
  motion: AppliedMotion,
  preset: MotionPreset | undefined,
): MotionRegion {
  return motion.region ?? defaultActionRegion(preset);
}

export function actionRegionLabel(region: MotionRegion) {
  return ACTION_REGION_OPTIONS.find((option) => option.id === region)?.label ?? "Custom";
}

export function roleMatchesActionRegion(role: PartRole, region: MotionRegion): boolean {
  switch (region) {
    case "fullBody":
    case "custom":
      return true;
    case "upperBody":
      return ["head", "body", "arm", "upperArm", "lowerArm", "hand", "hair", "accessory"].includes(
        role,
      );
    case "lowerBody":
      return ["leg", "upperLeg", "lowerLeg", "foot"].includes(role);
    case "face":
      return ["head", "eye", "iris", "eyebrow", "nose", "mouth"].includes(role);
    case "head":
      return ["head", "hair", "eye", "iris", "eyebrow", "nose", "mouth", "accessory"].includes(
        role,
      );
    case "hands":
      return ["arm", "upperArm", "lowerArm", "hand"].includes(role);
    case "camera":
      return false;
  }
}
