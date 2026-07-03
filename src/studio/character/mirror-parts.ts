import type { CharacterAngle, CharacterPart, ID } from "../types";
import { defaultSlotIdForRole, getPartSlotId, partAvailableForAngle } from "./character-utils";
import { inferPartSide } from "./side-utils";

/**
 * Mirror a sided slot's artwork to the other side: every variant layer is
 * duplicated into the opposite slot with mirrored placement, pivots, pins, and
 * motion bounds. The art itself is NOT flipped — parts have no flip transform
 * yet — so asymmetric drawings may still need a flipped export from the art
 * tool. Positions assume mirroring across the vertical canvas center.
 */
export type MirrorSlotPlan =
  | {
      ok: true;
      targetSlotId: ID;
      targetSide: "left" | "right";
      newParts: CharacterPart[];
    }
  | {
      ok: false;
      reason: "empty" | "unsided" | "occupied";
      targetSlotId?: ID;
      targetSide?: "left" | "right";
    };

function swapSideWord(value: string, targetSide: "left" | "right"): string {
  const sourceWord = targetSide === "right" ? /left/gi : /right/gi;
  return value.replace(sourceWord, (match) => {
    const replacement = targetSide === "right" ? "right" : "left";
    if (match === match.toUpperCase()) return replacement.toUpperCase();
    if (match[0] === match[0].toUpperCase())
      return replacement[0].toUpperCase() + replacement.slice(1);
    return replacement;
  });
}

function mirrorPart(
  part: CharacterPart,
  args: { id: ID; slotId: ID; targetSide: "left" | "right"; canvasWidth: number },
): CharacterPart {
  const { id, slotId, targetSide, canvasWidth } = args;
  const x = Math.round(canvasWidth - part.x - part.width);
  const pins = part.pins
    ? Object.fromEntries(
        Object.entries(part.pins).map(([name, pin]) => [
          swapSideWord(name, targetSide),
          { ...pin, x: part.width - pin.x, rotation: -pin.rotation },
        ]),
      )
    : undefined;
  return {
    ...part,
    id,
    slotId,
    side: targetSide,
    name: swapSideWord(part.name, targetSide),
    slotName: part.slotName ? swapSideWord(part.slotName, targetSide) : part.slotName,
    x,
    pivot: part.pivot ? { x: canvasWidth - part.pivot.x, y: part.pivot.y } : undefined,
    pins,
    bounds: part.bounds
      ? { ...part.bounds, x: Math.round(canvasWidth - part.bounds.x - part.bounds.width) }
      : undefined,
    parentId: undefined,
  };
}

export function planMirrorSlot(args: {
  docParts: CharacterPart[];
  slotId: ID;
  angle: CharacterAngle;
  canvasWidth: number;
  makeId: () => ID;
}): MirrorSlotPlan {
  const sourceParts = args.docParts.filter(
    (part) => getPartSlotId(part) === args.slotId && partAvailableForAngle(part, args.angle),
  );
  if (sourceParts.length === 0) return { ok: false, reason: "empty" };

  const sourceSide = inferPartSide(sourceParts[0]);
  if (sourceSide !== "left" && sourceSide !== "right") return { ok: false, reason: "unsided" };
  const targetSide = sourceSide === "left" ? "right" : "left";
  const role = sourceParts[0].role;
  const targetSlotId = defaultSlotIdForRole(role, undefined, targetSide);

  const occupied = args.docParts.some(
    (part) => getPartSlotId(part) === targetSlotId && partAvailableForAngle(part, args.angle),
  );
  if (occupied) return { ok: false, reason: "occupied", targetSlotId, targetSide };

  return {
    ok: true,
    targetSlotId,
    targetSide,
    newParts: sourceParts.map((part) =>
      mirrorPart(part, {
        id: args.makeId(),
        slotId: targetSlotId,
        targetSide,
        canvasWidth: args.canvasWidth,
      }),
    ),
  };
}
