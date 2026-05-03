import type { CharacterPart } from "../types";

export interface FaceTurnMotion {
  dx: number;
  dy: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
  skewY: number;
  rotation: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function faceTurnMotionForPart(
  part: CharacterPart,
  turnX: number,
  canvasWidth: number,
): FaceTurnMotion {
  const t = clamp(turnX, -1, 1);
  const amount = Math.abs(t);
  if (amount < 0.0001) return identityFaceTurn();

  const faceShift = clamp(canvasWidth * 0.03, 10, 34);
  const smallShift = clamp(canvasWidth * 0.01, 3, 12);
  const side = part.side === "left" ? -1 : part.side === "right" ? 1 : 0;
  const nearSide = side !== 0 ? side * Math.sign(t) : 0;
  const depth = clamp(part.depth ?? 0, -1, 1);

  switch (part.role) {
    case "eye":
      return {
        dx: t * faceShift * (1 + depth * 0.25) + nearSide * amount * smallShift * 0.28,
        dy: 0,
        scaleX: 1 + nearSide * amount * 0.04 - amount * 0.025,
        scaleY: 1,
        skewX: 0,
        skewY: t * -2,
        rotation: t * 0.5,
      };
    case "eyebrow":
      return {
        dx: t * faceShift * 0.9 * (1 + depth * 0.25) + nearSide * amount * smallShift * 0.2,
        dy: -amount * 1.5,
        scaleX: 1 + nearSide * amount * 0.035 - amount * 0.02,
        scaleY: 1,
        skewX: t * -1.5,
        skewY: t * -1,
        rotation: t * 1.2,
      };
    case "mouth":
      return {
        dx: t * faceShift * 0.68 * (1 + depth * 0.2),
        dy: amount * 1.5,
        scaleX: 1 - amount * 0.045,
        scaleY: 1,
        skewX: t * -2,
        skewY: 0,
        rotation: t * 0.8,
      };
    case "hair":
    case "accessory":
      return {
        dx: t * faceShift * 0.35 * (1 + depth * 0.4),
        dy: 0,
        scaleX: 1,
        scaleY: 1,
        skewX: t * -1,
        skewY: 0,
        rotation: t * 0.5,
      };
    case "head":
      return {
        dx: t * smallShift * 0.35,
        dy: 0,
        scaleX: 1 - amount * 0.015,
        scaleY: 1,
        skewX: t * -0.8,
        skewY: 0,
        rotation: t * 1.8,
      };
    default:
      return identityFaceTurn();
  }
}

function identityFaceTurn(): FaceTurnMotion {
  return { dx: 0, dy: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0, rotation: 0 };
}
