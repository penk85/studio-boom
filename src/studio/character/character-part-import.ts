// Pure filename inference and placement rules for character artwork imports.
import { MOUTH_VISEMES } from "../lipsync/viseme-schema";
import type {
  CharacterPart,
  CharacterVariantKind,
  EyeState,
  ID,
  MouthViseme,
  PartRole,
} from "../types";
import { defaultSlotIdForRole, detectPartRoleFromFilename } from "./character-utils";
import { inferCharacterSideFromText } from "./side-utils";

export interface CharacterPartImportOptions {
  role?: PartRole;
  side?: CharacterPart["side"];
  variantKey?: string;
  variantLabel?: string;
  variantKind?: CharacterVariantKind;
  viseme?: MouthViseme;
  eyeState?: EyeState;
  label?: string;
  slotId?: string;
  placement?: Partial<Pick<CharacterPart, "x" | "y" | "width" | "height" | "rotation" | "pivot">>;
  zIndex?: number;
}

export function fitImportedPartToCanvas(
  width = 0,
  height = 0,
  canvasWidth: number,
  canvasHeight: number,
) {
  const sourceWidth = width > 0 ? width : 240;
  const sourceHeight = height > 0 ? height : 240;
  const ratio = Math.min(1, (canvasWidth * 0.7) / sourceWidth, (canvasHeight * 0.7) / sourceHeight);
  const fittedWidth = Math.max(16, Math.round(sourceWidth * ratio));
  const fittedHeight = Math.max(16, Math.round(sourceHeight * ratio));
  return {
    x: Math.round((canvasWidth - fittedWidth) / 2),
    y: Math.round((canvasHeight - fittedHeight) / 2),
    width: fittedWidth,
    height: fittedHeight,
  };
}

export function detectImportedPartRole(filename: string): PartRole {
  return detectPartRoleFromFilename(filename);
}

export function detectImportedPartSide(filename: string): CharacterPart["side"] {
  return inferCharacterSideFromText(filename);
}

export function detectImportedViseme(filename: string): MouthViseme | undefined {
  const tokens = filename
    .replace(/\.[^.]+$/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return MOUTH_VISEMES.find((viseme) => tokens.includes(viseme.toLowerCase()));
}

export function detectImportedEyeState(filename: string): EyeState | undefined {
  const name = filename.toLowerCase();
  if (name.includes("closed") || name.includes("blink")) return "closed";
  if (name.includes("half")) return "half";
  if (name.includes("wink")) return "wink";
  return "open";
}

export function detectImportedVariantKey(
  filename: string,
  role: PartRole,
  side: CharacterPart["side"],
): string | undefined {
  const stem = filename.replace(/\.[^.]+$/i, "");
  const tokens = stem.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const ignored = new Set(["svg", "image", "asset", "part"]);
  if (side) ignored.add(side);
  if (side === "left") ignored.add("l");
  if (side === "right") ignored.add("r");
  for (const token of ignoredRoleTokens(role)) ignored.add(token);
  const kept = tokens.filter((token) => !ignored.has(token.toLowerCase()));
  return kept.length ? slugCharacterPartKey(kept.join("-")) : undefined;
}

export function defaultImportedVariantKind(
  role: PartRole,
  viseme: MouthViseme | undefined,
  eyeState: EyeState | undefined,
): CharacterVariantKind {
  if (viseme) return "viseme";
  if (eyeState) return "eyeState";
  if (role === "hand") return "handShape";
  if (role === "mouth") return "mouthShape";
  return role === "eye" ? "eyeState" : "pose";
}

export function slotIdForImportedPart(role: PartRole, id: ID, side: CharacterPart["side"]): ID {
  if (role === "custom") return `custom:${id}`;
  return defaultSlotIdForRole(role, undefined, side);
}

export function slugCharacterPartKey(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "part"
  );
}

export function maxPartZIndex(parts: CharacterPart[]): number {
  return parts.reduce((max, part) => Math.max(max, part.zIndex), 0);
}

function ignoredRoleTokens(role: PartRole): string[] {
  switch (role) {
    case "head":
      return ["head"];
    case "body":
      return ["body", "torso"];
    case "eye":
      return ["eye", "eyes"];
    case "iris":
      return ["iris", "pupil"];
    case "eyebrow":
      return ["brow", "eyebrow"];
    case "nose":
      return ["nose"];
    case "mouth":
      return ["mouth", "lip", "lips", "viseme"];
    case "arm":
      return ["arm"];
    case "upperArm":
      return ["upper", "upperarm", "arm", "bicep"];
    case "lowerArm":
      return ["lower", "lowerarm", "arm", "forearm"];
    case "hand":
      return ["hand"];
    case "leg":
      return ["leg"];
    case "upperLeg":
      return ["upper", "upperleg", "leg", "thigh"];
    case "lowerLeg":
      return ["lower", "lowerleg", "leg", "shin", "calf"];
    case "foot":
      return ["foot", "feet"];
    case "hair":
      return ["hair"];
    case "accessory":
      return ["accessory", "prop"];
    case "static":
      return ["static"];
    case "custom":
      return ["custom"];
  }
}
