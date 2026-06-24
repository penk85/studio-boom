import type {
  CharacterBone,
  CharacterPart,
  CharacterPartPin,
  CharacterPartRegistration,
  CharacterSlot,
  ID,
} from "../types";
import {
  composeMatrices,
  invertMatrix,
  matrixAroundPoint,
  transformPoint,
  transformVector,
  translationMatrix,
  type AffineMatrix,
  type Point,
} from "./geometry";
import { pivotForPart } from "./alpha-bounds";

export interface ResolvedPinTransform {
  x: number;
  y: number;
  rotation: number;
}

export function registrationForPart(part: CharacterPart): CharacterPartRegistration {
  if (
    part.registration?.space === "part-local-pixels" &&
    Number.isFinite(part.registration.x) &&
    Number.isFinite(part.registration.y) &&
    Number.isFinite(part.registration.rotation)
  ) {
    return part.registration;
  }
  const pivot = pivotForPart(part);
  return {
    x: pivot.x - part.x,
    y: pivot.y - part.y,
    rotation: part.rotation,
    space: "part-local-pixels",
  };
}

export function normalizePartRegistration(part: CharacterPart): CharacterPart {
  const pivot = pivotForPart(part);
  const registration: CharacterPartRegistration = {
    x: pivot.x - part.x,
    y: pivot.y - part.y,
    rotation: part.rotation,
    space: "part-local-pixels",
  };
  const pins = Object.fromEntries(
    Object.entries(part.pins ?? {}).flatMap(([name, pin]) => {
      const trimmed = name.trim();
      if (
        !trimmed ||
        !Number.isFinite(pin?.x) ||
        !Number.isFinite(pin?.y) ||
        !Number.isFinite(pin?.rotation)
      ) {
        return [];
      }
      return [
        [
          trimmed,
          {
            x: pin.x,
            y: pin.y,
            rotation: pin.rotation,
            space: "part-local-pixels",
          } satisfies CharacterPartPin,
        ],
      ];
    }),
  );
  return {
    ...part,
    registration,
    pins: Object.keys(pins).length > 0 ? pins : undefined,
  };
}

/**
 * Transform from artwork-local pixels to its legacy character-canvas rest placement. This is
 * used only while authoring/migrating pins; runtime rendering starts from the bone transform.
 */
export function partRestCanvasMatrix(part: CharacterPart): AffineMatrix {
  const registration = registrationForPart(part);
  const pivot = { x: part.x + registration.x, y: part.y + registration.y };
  return composeMatrices(
    translationMatrix(pivot.x, pivot.y),
    matrixAroundPoint(
      { x: 0, y: 0 },
      {
        rotation: registration.rotation,
      },
    ),
    translationMatrix(-registration.x, -registration.y),
  );
}

export function partLocalPointFromCanvas(part: CharacterPart, point: Point): Point {
  return transformPoint(invertMatrix(partRestCanvasMatrix(part)), point);
}

export function canvasPointFromPartLocal(part: CharacterPart, point: Point): Point {
  return transformPoint(partRestCanvasMatrix(part), point);
}

/**
 * Resolve one parent-art pin into the parent bone's local coordinate space.
 *
 * partWorld = boneWorld * R(registration.rotation) * T(-registration.x, -registration.y)
 * childRest = R(registration.rotation) * (pin - registration) + optional rest-source offset
 */
export function pinTransformInBoneSpace(
  part: CharacterPart,
  pin: CharacterPartPin,
  offset?: { x: number; y: number; rotation: number },
): ResolvedPinTransform {
  const registration = registrationForPart(part);
  const point = transformVector(
    matrixAroundPoint(
      { x: 0, y: 0 },
      {
        rotation: registration.rotation,
      },
    ),
    {
      x: pin.x - registration.x,
      y: pin.y - registration.y,
    },
  );
  return {
    x: point.x + (offset?.x ?? 0),
    y: point.y + (offset?.y ?? 0),
    rotation: registration.rotation + pin.rotation + (offset?.rotation ?? 0),
  };
}

export function pinNameForChildSlot(
  child: Pick<CharacterSlot, "id" | "role" | "side" | "name">,
): string {
  const side = child.side === "left" || child.side === "right" ? `:${child.side}` : "";
  switch (child.role) {
    case "head":
      return `neck${side}`;
    case "arm":
    case "upperArm":
      return `shoulder${side}`;
    case "lowerArm":
      return `elbow${side}`;
    case "hand":
      return `wrist${side}`;
    case "leg":
    case "upperLeg":
      return `hip${side}`;
    case "lowerLeg":
      return `knee${side}`;
    case "foot":
      return `ankle${side}`;
    case "iris":
      return `iris:${child.id}`;
    default:
      return `attach:${child.id}`;
  }
}

export function boneRequiredPin(
  bone: Pick<CharacterBone, "id" | "restSource">,
): { boneId: ID; slotId: ID; pinName: string } | undefined {
  return bone.restSource
    ? {
        boneId: bone.id,
        slotId: bone.restSource.slotId,
        pinName: bone.restSource.pinName,
      }
    : undefined;
}
