// deform-fit — default flexible-limb paths derived from character rig sockets.
import type {
  CharacterPart,
  CharacterPartDeform,
  CharacterPartDeformPoint,
  CharacterPreset,
  PartRole,
} from "../types";
import { defaultLimbPathDeformForPart, getPartSlotId } from "./character-utils";
import {
  composeMatrices,
  invertMatrix,
  matrixAroundPoint,
  transformPoint,
  translationMatrix,
  type Point,
} from "./geometry";
import { registrationForPart } from "./registration";
import { buildCharacterRuntime, resolveRuntimeSlotPart, runtimePartPlacement } from "./runtime";

/**
 * Build the default Flexible path for a slot. Limb slots snap to their rig
 * joint and direct child joint; ambiguous slots fall back to visible artwork.
 */
export function defaultLimbPathDeformForSlot(
  character: CharacterPreset,
  slotId: string,
  preferredPart?: CharacterPart,
): CharacterPartDeform {
  const runtime = buildCharacterRuntime(character);
  const slot = runtime.slotById.get(slotId);
  const part =
    preferredPart ??
    (slot ? resolveRuntimeSlotPart(slot, runtime) : undefined) ??
    character.parts.find((candidate) => getPartSlotId(candidate) === slotId && candidate.visible) ??
    character.parts.find((candidate) => getPartSlotId(candidate) === slotId);
  if (!slot || !part) {
    return defaultLimbPathDeformForPart(
      preferredPart ?? character.parts.find((candidate) => getPartSlotId(candidate) === slotId)!,
    );
  }

  const fallback = defaultLimbPathDeformForPart(part);
  if (fallback.mode !== "limb-path") return fallback;
  const binding = runtime.bindingBySlot.get(slot.id);
  if (!binding) return fallback;
  const child = bestFlexibleChildJoint(character, slot.id, slot.role);
  if (!child) return fallback;

  const startCanvas = runtime.worldByBone.get(binding.effectiveBoneId);
  const endCanvas = runtime.worldByBone.get(child.boneId);
  if (!startCanvas || !endCanvas) return fallback;

  const placement = runtimePartPlacement(slot, part, runtime, { basePart: part });
  const matrix = partLocalToCanvasMatrix(part, placement);
  const inverse = invertMatrix(matrix);
  const start = roundPoint(transformPoint(inverse, startCanvas));
  const end = roundPoint(transformPoint(inverse, endCanvas));
  if (Math.hypot(end.x - start.x, end.y - start.y) < 8) return fallback;

  return {
    ...fallback,
    start,
    end,
    curve: midpoint(start, end),
    locks: [pointAlong(start, end, 0.14)],
  };
}

function bestFlexibleChildJoint(
  character: CharacterPreset,
  slotId: string,
  role: PartRole,
): { boneId: string } | null {
  const runtime = buildCharacterRuntime(character);
  const binding = runtime.bindingBySlot.get(slotId);
  const allowed = allowedFlexibleChildRoles(role);
  if (!binding || allowed.length === 0) return null;
  const start = runtime.worldByBone.get(binding.effectiveBoneId);
  if (!start) return null;
  const slotByBoneId = new Map(
    runtime.angleRig.slotBindings.map((entry) => [entry.boneId, entry.slotId]),
  );
  const candidates = runtime.angleRig.bones
    .filter((bone) => bone.parentId === binding.effectiveBoneId)
    .flatMap((bone) => {
      const childSlotId = slotByBoneId.get(bone.id);
      const childSlot = childSlotId ? runtime.slotById.get(childSlotId) : undefined;
      const point = runtime.worldByBone.get(bone.id);
      if (!childSlot || !point || !allowed.includes(childSlot.role)) return [];
      return [{ boneId: bone.id, distance: Math.hypot(point.x - start.x, point.y - start.y) }];
    })
    .sort((a, b) => b.distance - a.distance);
  return candidates[0] && candidates[0].distance >= 8 ? { boneId: candidates[0].boneId } : null;
}

function allowedFlexibleChildRoles(role: PartRole): PartRole[] {
  switch (role) {
    case "arm":
    case "upperArm":
      return ["lowerArm", "hand"];
    case "lowerArm":
      return ["hand"];
    case "leg":
    case "upperLeg":
      return ["lowerLeg", "foot"];
    case "lowerLeg":
      return ["foot"];
    default:
      return [];
  }
}

function partLocalToCanvasMatrix(
  part: CharacterPart,
  placement: ReturnType<typeof runtimePartPlacement>,
) {
  const registration = registrationForPart(part);
  return composeMatrices(
    translationMatrix(placement.pivotX, placement.pivotY),
    matrixAroundPoint(
      { x: 0, y: 0 },
      {
        rotation: placement.rotation,
        scaleX: placement.scaleX,
        scaleY: placement.scaleY,
      },
    ),
    translationMatrix(-registration.x, -registration.y),
  );
}

function midpoint(a: CharacterPartDeformPoint, b: CharacterPartDeformPoint) {
  return roundPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
}

function pointAlong(a: CharacterPartDeformPoint, b: CharacterPartDeformPoint, t: number) {
  return roundPoint({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
}

function roundPoint(point: Point): CharacterPartDeformPoint {
  return { x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 };
}
