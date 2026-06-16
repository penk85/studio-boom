import type {
  CharacterAngle,
  CharacterAngleRig,
  CharacterBone,
  CharacterPart,
  CharacterPreset,
  CharacterRig,
  CharacterSlotBinding,
} from "../types";
import { pivotForPart } from "./alpha-bounds";
import {
  anchorPartForVariant,
  listCharacterSlots,
  partMatchesVariant,
  pivotAlignedPartOffset,
  roleEnabledByManifest,
  variantKeyForPart,
} from "./character-utils";
import {
  availableCharacterAngles,
  computeBoneWorldTransforms,
  normalizeCharacterRig,
  representativePart,
  resolveSlotBinding,
  type BoneWorldTransform,
  type ResolvedSlotBinding,
} from "./rig";
import { buildMotionConstraintContext, type MotionConstraintContext } from "./motion-constraints";

export type RuntimeCharacterSlot = ReturnType<typeof listCharacterSlots>[number];

export interface CharacterRuntime {
  character: CharacterPreset;
  rig: CharacterRig;
  angle: CharacterAngle;
  angleRig: CharacterAngleRig;
  slots: RuntimeCharacterSlot[];
  slotById: Map<string, RuntimeCharacterSlot>;
  bindingBySlot: Map<string, ResolvedSlotBinding>;
  boneById: Map<string, CharacterBone>;
  worldByBone: Map<string, BoneWorldTransform>;
  parentBoneIds: Set<string>;
  constraintContext: MotionConstraintContext;
}

export interface BuildCharacterRuntimeOptions {
  angle?: CharacterAngle;
  includeDisabledRoles?: boolean;
}

export interface RuntimePartPlacement {
  x: number;
  y: number;
  pivotX: number;
  pivotY: number;
  containerX: number;
  containerY: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  depth: number;
  transformTarget: "slot" | "bone";
  basePart: CharacterPart;
  referencePart?: CharacterPart;
}

export interface RuntimePartPlacementOptions {
  /**
   * Variant key the consumer intends to show. This mirrors the composition builder's pose map:
   * it picks the slot container's base drawing before resolving the displayed part offset.
   */
  poseKey?: string;
  basePart?: CharacterPart;
}

/**
 * Canonical runtime view for all character consumers. This is the boundary where active-angle
 * slots, the normalized rig, resolved bindings, bone world transforms, and motion constraints are
 * bundled together so builder, recorder, composition playback, and future export tools do not
 * each assemble subtly different answers.
 */
export function buildCharacterRuntime(
  character: CharacterPreset,
  options: BuildCharacterRuntimeOptions = {},
): CharacterRuntime {
  const rig = normalizeCharacterRig(character);
  const angle = resolveRuntimeAngle(character, rig, options.angle);
  const angleRig = angleRigForRuntime(rig, angle);
  const bindingBySlot = new Map<string, ResolvedSlotBinding>();
  for (const binding of angleRig.slotBindings) {
    const resolved = resolveSlotBinding(rig, binding.slotId, angle);
    if (resolved) bindingBySlot.set(binding.slotId, resolved);
  }
  const slots = listCharacterSlots(character, { angle, includeEmpty: false }).filter(
    (slot) =>
      bindingBySlot.has(slot.id) &&
      (options.includeDisabledRoles || roleEnabledByManifest(slot.role, character.manifest)),
  );
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const boneById = new Map(angleRig.bones.map((bone) => [bone.id, bone]));
  const worldByBone = computeBoneWorldTransforms(rig, angle);
  const parentBoneIds = new Set(
    angleRig.bones.map((bone) => bone.parentId).filter((id): id is string => !!id),
  );
  return {
    character,
    rig,
    angle,
    angleRig,
    slots,
    slotById,
    bindingBySlot,
    boneById,
    worldByBone,
    parentBoneIds,
    constraintContext: buildMotionConstraintContext({
      reaches: angleRig.reaches,
      variantPackages: character.variantPackages,
      parts: character.parts,
      bones: angleRig.bones,
    }),
  };
}

export function resolveRuntimeSlotPart(
  slot: RuntimeCharacterSlot,
  runtime: CharacterRuntime,
  poseKey?: string,
): CharacterPart | undefined {
  const visibleParts = slot.parts.filter((part) => part.visible);
  const activePose = runtime.bindingBySlot.get(slot.id)?.effectivePartId ?? poseKey;
  return (
    (activePose ? visibleParts.find((part) => partMatchesVariant(part, activePose)) : undefined) ??
    (runtime.angle
      ? visibleParts.find(
          (part) => partMatchesVariant(part, runtime.angle) || part.name === runtime.angle,
        )
      : undefined) ??
    visibleParts[0]
  );
}

export function runtimePartPlacement(
  slot: RuntimeCharacterSlot,
  part: CharacterPart,
  runtime: CharacterRuntime,
  options: RuntimePartPlacementOptions = {},
): RuntimePartPlacement {
  const binding = runtime.bindingBySlot.get(slot.id);
  const basePart =
    options.basePart ?? resolveRuntimeSlotPart(slot, runtime, options.poseKey) ?? part;
  const boneWorld = binding ? runtime.worldByBone.get(binding.effectiveBoneId) : undefined;
  const boneRotation = boneWorld?.rotation ?? 0;
  const slotX = binding ? binding.x : basePart.x;
  const slotY = binding ? binding.y : basePart.y;
  const slotOrigin = boneWorld
    ? addPoint(boneWorld, rotatePoint({ x: slotX, y: slotY }, boneRotation))
    : { x: slotX, y: slotY };
  const slotRotation = binding ? binding.rotation : basePart.rotation;
  const slotScaleX = binding?.scaleX ?? 1;
  const slotScaleY = binding?.scaleY ?? 1;
  const offset = runtimePartOffset(slot, part, binding, basePart);
  const pivot = pivotForPart(part);
  const pivotLocal = { x: pivot.x - part.x, y: pivot.y - part.y };
  const slotPivotLocal = transformPointAroundOrigin(
    { x: offset.x + pivotLocal.x, y: offset.y + pivotLocal.y },
    {
      x: basePart.anchorX * basePart.width,
      y: basePart.anchorY * basePart.height,
    },
    slotRotation,
    slotScaleX,
    slotScaleY,
  );
  const pivotWorld = addPoint(slotOrigin, rotatePoint(slotPivotLocal, boneRotation));
  const referencePart =
    binding && slot.role !== "eye" && slot.role !== "mouth"
      ? (representativePart(slot) ?? basePart)
      : undefined;
  return {
    x: pivotWorld.x - pivotLocal.x,
    y: pivotWorld.y - pivotLocal.y,
    pivotX: pivotWorld.x,
    pivotY: pivotWorld.y,
    containerX: slotOrigin.x,
    containerY: slotOrigin.y,
    offsetX: offset.x,
    offsetY: offset.y,
    rotation: boneRotation + slotRotation + part.rotation - basePart.rotation,
    scaleX: slotScaleX,
    scaleY: slotScaleY,
    depth: binding?.effectiveDepth ?? part.depth,
    transformTarget:
      binding && runtime.parentBoneIds.has(binding.effectiveBoneId) ? "bone" : "slot",
    basePart,
    referencePart,
  };
}

function runtimePartOffset(
  slot: RuntimeCharacterSlot,
  part: CharacterPart,
  binding: ResolvedSlotBinding | undefined,
  basePart: CharacterPart,
): { x: number; y: number } {
  if (!binding || slot.role === "eye" || slot.role === "mouth") {
    return { x: part.x - basePart.x, y: part.y - basePart.y };
  }
  const referencePart = representativePart(slot) ?? basePart;
  return pivotAlignedPartOffset(
    referencePart,
    anchorPartForVariant(slot.parts, variantKeyForPart(part)) ?? part,
    part,
  );
}

function resolveRuntimeAngle(
  character: CharacterPreset,
  rig: CharacterRig,
  requested: CharacterAngle | undefined,
): CharacterAngle {
  const canonical = availableCharacterAngles(character);
  if (requested && canonical.includes(requested) && rig.angles?.[requested]) return requested;
  if (canonical.includes(rig.activeAngle) && rig.angles?.[rig.activeAngle]) return rig.activeAngle;
  return canonical.find((angle) => rig.angles?.[angle]) ?? rig.activeAngle;
}

function angleRigForRuntime(rig: CharacterRig, angle: CharacterAngle): CharacterAngleRig {
  return (
    rig.angles?.[angle] ?? {
      angleId: angle,
      bones: rig.bones,
      slotBindings: rig.slotBindings,
      drawOrder: rig.drawOrder,
      slotRelations: rig.slotRelations,
      hostConstraints: rig.hostConstraints,
      reaches: rig.reaches,
      sockets: rig.sockets,
    }
  );
}

function rotatePoint(point: { x: number; y: number }, degrees: number): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

function transformPointAroundOrigin(
  point: { x: number; y: number },
  origin: { x: number; y: number },
  rotation: number,
  scaleX: number,
  scaleY: number,
): { x: number; y: number } {
  const scaled = {
    x: (point.x - origin.x) * scaleX,
    y: (point.y - origin.y) * scaleY,
  };
  const rotated = rotatePoint(scaled, rotation);
  return { x: origin.x + rotated.x, y: origin.y + rotated.y };
}

function addPoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number } {
  return { x: a.x + b.x, y: a.y + b.y };
}
