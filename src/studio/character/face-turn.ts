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
  turnY = 0,
  canvasHeight = canvasWidth,
): FaceTurnMotion {
  const t = clamp(turnX, -1, 1);
  const y = clamp(turnY, -1, 1);
  const amount = Math.abs(t);
  const yAmount = Math.abs(y);
  if (amount < 0.0001 && yAmount < 0.0001) return identityFaceTurn();

  const faceShift = clamp(canvasWidth * 0.03, 10, 34);
  const verticalShift = clamp(canvasHeight * 0.018, 5, 20);
  const smallShift = clamp(canvasWidth * 0.01, 3, 12);
  const side = part.side === "left" ? -1 : part.side === "right" ? 1 : 0;
  const nearSide = side !== 0 ? side * Math.sign(t) : 0;
  const depth = clamp(part.depth ?? 0, -1, 1);
  const lift = y * verticalShift * (1 + depth * 0.18);

  switch (part.role) {
    case "eye":
      return {
        dx: t * faceShift * (1 + depth * 0.25) + nearSide * amount * smallShift * 0.28,
        dy: lift * 0.52,
        scaleX: 1 + nearSide * amount * 0.04 - amount * 0.025,
        scaleY: 1 - yAmount * 0.015,
        skewX: 0,
        skewY: t * -2 + y * 0.5,
        rotation: t * 0.5 + y * 0.25,
      };
    case "iris":
      return identityFaceTurn();
    case "eyebrow":
      return {
        dx: t * faceShift * 0.9 * (1 + depth * 0.25) + nearSide * amount * smallShift * 0.2,
        dy: lift * 0.42 - amount * 1.5,
        scaleX: 1 + nearSide * amount * 0.035 - amount * 0.02,
        scaleY: 1 - yAmount * 0.012,
        skewX: t * -1.5,
        skewY: t * -1 + y * 0.45,
        rotation: t * 1.2 + y * 0.2,
      };
    case "nose":
      return {
        dx: t * faceShift * 0.74 * (1 + depth * 0.18),
        dy: lift * 0.62,
        scaleX: 1 - amount * 0.025,
        scaleY: 1 - yAmount * 0.012,
        skewX: t * -1.4,
        skewY: y * 0.35,
        rotation: t * 0.55 + y * 0.15,
      };
    case "mouth":
      return {
        dx: t * faceShift * 0.68 * (1 + depth * 0.2),
        dy: lift * 0.78 + amount * 1.5,
        scaleX: 1 - amount * 0.045,
        scaleY: 1 - yAmount * 0.018,
        skewX: t * -2 + y * 0.4,
        skewY: 0,
        rotation: t * 0.8 + y * 0.2,
      };
    case "hair":
    case "accessory":
      return {
        dx: t * faceShift * 0.35 * (1 + depth * 0.4),
        dy: lift * 0.18,
        scaleX: 1,
        scaleY: 1,
        skewX: t * -1,
        skewY: 0,
        rotation: t * 0.5,
      };
    case "head":
      return {
        dx: t * smallShift * 0.35,
        dy: lift * 0.12,
        scaleX: 1 - amount * 0.015,
        scaleY: 1 - yAmount * 0.006,
        skewX: t * -0.8,
        skewY: y * 0.25,
        rotation: t * 1.8 + y * 0.25,
      };
    default:
      return identityFaceTurn();
  }
}

function identityFaceTurn(): FaceTurnMotion {
  return { dx: 0, dy: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0, rotation: 0 };
}
