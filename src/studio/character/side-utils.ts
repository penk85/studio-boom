import type { CharacterPart, PartRole } from "../types";

export type CharacterPartSide = CharacterPart["side"];

const SIDED_SLOT_ROLES = new Set<PartRole>([
  "eye",
  "iris",
  "eyebrow",
  "arm",
  "upperArm",
  "lowerArm",
  "hand",
  "leg",
  "upperLeg",
  "lowerLeg",
  "foot",
]);

export function isSidedSlotRole(role: PartRole): boolean {
  return SIDED_SLOT_ROLES.has(role);
}

export function inferCharacterSideFromText(value: string): CharacterPartSide | undefined {
  const text = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .toLowerCase();
  if (/(^|[\s:_-])(left|l)(?=$|[\s:_-])/.test(text) || /\bleft/.test(text)) return "left";
  if (/(^|[\s:_-])(right|r)(?=$|[\s:_-])/.test(text) || /\bright/.test(text)) return "right";
  if (/(^|[\s:_-])front(?=$|[\s:_-])/.test(text) || /\bfront/.test(text)) return "front";
  if (/(^|[\s:_-])back(?=$|[\s:_-])/.test(text) || /\bback/.test(text)) return "back";
  if (/(^|[\s:_-])center(?=$|[\s:_-])/.test(text) || /\bcenter/.test(text)) return "center";
  return undefined;
}

export function inferPartSide(
  part: Pick<CharacterPart, "id" | "name" | "role" | "side" | "slotId" | "slotName">,
): CharacterPartSide | undefined {
  if (part.side) return part.side;
  const inferred = inferCharacterSideFromText(
    [part.slotId, part.slotName, part.id, part.name].filter(Boolean).join(" "),
  );
  if (!inferred) return undefined;
  if (isSidedSlotRole(part.role) && (inferred === "left" || inferred === "right")) {
    return inferred;
  }
  if (part.role === "hair" && (inferred === "front" || inferred === "back")) return inferred;
  return undefined;
}
