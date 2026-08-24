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
import { listCharacterSlots, partMatchesVariant, roleEnabledByManifest } from "./character-utils";
import {
  availableCharacterAngles,
  computeBoneWorldTransforms,
  normalizeCharacterRig,
  representativePart,
  resolveSlotBinding,
  type BoneWorldTransform,
  type ResolvedSlotBinding,
} from "./rig";
import {
  buildMotionConstraintContext,
  type ActiveVariantMap,
  type MotionConstraintContext,
} from "./motion-constraints";
import { resolvePinnedBonesForAngle, upgradeCharacterRigV2 } from "./rig-v2";
import { registrationForPart } from "./registration";

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
  drawOrder: number;
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
  /** Active slot variants used to resolve socket-driven child bone rest transforms. */
  activeVariants?: ActiveVariantMap;
  /** Pre-resolved pose skeleton when the caller already needs it for frame or drag math. */
  worldByBone?: ReadonlyMap<string, BoneWorldTransform>;
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
  const canonicalCharacter = upgradeCharacterRigV2(character);
  const rig = normalizeCharacterRig(canonicalCharacter);
  const angle = resolveRuntimeAngle(canonicalCharacter, rig, options.angle);
  const baseAngleRig = angleRigForRuntime(rig, angle);
  const bindingBySlot = new Map<string, ResolvedSlotBinding>();
  for (const binding of baseAngleRig.slotBindings) {
    const resolved = resolveSlotBinding(rig, binding.slotId, angle);
    if (resolved) bindingBySlot.set(binding.slotId, resolved);
  }
  const slots = listCharacterSlots(canonicalCharacter, { angle, includeEmpty: false }).filter(
    (slot) =>
      bindingBySlot.has(slot.id) &&
      (options.includeDisabledRoles ||
        roleEnabledByManifest(slot.role, canonicalCharacter.manifest)),
  );
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const angleRig = {
    ...baseAngleRig,
    bones: resolvePinnedBonesForAngle(canonicalCharacter, baseAngleRig, angle),
  };
  const boneById = new Map(angleRig.bones.map((bone) => [bone.id, bone]));
  const worldByBone = computeAngleRigWorldTransforms(rig, angleRig, angle);
  const parentBoneIds = new Set(
    angleRig.bones.map((bone) => bone.parentId).filter((id): id is string => !!id),
  );
  return {
    character: canonicalCharacter,
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
      variantPackages: canonicalCharacter.variantPackages,
      parts: canonicalCharacter.parts,
      bones: angleRig.bones,
      ikConstraints: angleRig.ikConstraints,
    }),
  };
}

export function resolveRuntimeSlotPart(
  slot: RuntimeCharacterSlot,
  runtime: CharacterRuntime,
  poseKey?: string,
): CharacterPart | undefined {
  const visibleParts = slot.parts.filter((part) => part.visible);
  const boundPartId = runtime.bindingBySlot.get(slot.id)?.effectivePartId;
  return (
    (poseKey ? visibleParts.find((part) => partMatchesVariant(part, poseKey)) : undefined) ??
    (boundPartId ? visibleParts.find((part) => part.id === boundPartId) : undefined) ??
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
  const requestedBasePart =
    options.basePart ?? resolveRuntimeSlotPart(slot, runtime, options.poseKey) ?? part;
  const preservesAuthoredOffsets = slot.role === "eye" || slot.role === "mouth";
  const basePart =
    preservesAuthoredOffsets && binding
      ? (representativePart(slot) ?? requestedBasePart)
      : requestedBasePart;
  const worldByBone =
    options.worldByBone ??
    (options.activeVariants
      ? runtimeBoneWorldTransforms(runtime, options.activeVariants)
      : runtime.worldByBone);
  const boneWorld = binding ? worldByBone.get(binding.effectiveBoneId) : undefined;
  const boneRotation = boneWorld?.rotation ?? 0;
  const slotX = binding?.x ?? 0;
  const slotY = binding?.y ?? 0;
  const slotOrigin = boneWorld
    ? addPoint(boneWorld, rotatePoint({ x: slotX, y: slotY }, boneRotation))
    : { x: basePart.x + slotX, y: basePart.y + slotY };
  const slotRotation = binding?.rotation ?? 0;
  const slotScaleX = binding?.scaleX ?? 1;
  const slotScaleY = binding?.scaleY ?? 1;
  const registration = registrationForPart(part);
  const baseRegistration = registrationForPart(basePart);
  const pivotWorld = slotOrigin;
  const placedX =
    preservesAuthoredOffsets && binding
      ? pivotWorld.x - baseRegistration.x + (part.x - basePart.x)
      : pivotWorld.x - registration.x;
  const placedY =
    preservesAuthoredOffsets && binding
      ? pivotWorld.y - baseRegistration.y + (part.y - basePart.y)
      : pivotWorld.y - registration.y;
  const placedPivotX =
    preservesAuthoredOffsets && binding ? placedX + registration.x : pivotWorld.x;
  const placedPivotY =
    preservesAuthoredOffsets && binding ? placedY + registration.y : pivotWorld.y;
  const referencePart =
    binding && slot.role !== "eye" && slot.role !== "mouth"
      ? (representativePart(slot) ?? basePart)
      : undefined;
  const drawOrderIndex = runtime.angleRig.drawOrder.indexOf(slot.id);
  return {
    x: placedX,
    y: placedY,
    pivotX: placedPivotX,
    pivotY: placedPivotY,
    containerX: slotOrigin.x,
    containerY: slotOrigin.y,
    offsetX: placedX - (pivotWorld.x - baseRegistration.x),
    offsetY: placedY - (pivotWorld.y - baseRegistration.y),
    rotation: boneRotation + slotRotation + registration.rotation,
    scaleX: slotScaleX,
    scaleY: slotScaleY,
    depth: binding?.effectiveDepth ?? part.depth,
    drawOrder: drawOrderIndex >= 0 ? drawOrderIndex : part.zIndex,
    basePart,
    referencePart,
  };
}

export function runtimeBoneWorldTransforms(
  runtime: CharacterRuntime,
  activeVariants: ActiveVariantMap,
): Map<string, BoneWorldTransform> {
  const bones = resolvePinnedBonesForAngle(
    runtime.character,
    runtime.angleRig,
    runtime.angle,
    activeVariants,
  );
  return computeAngleRigWorldTransforms(runtime.rig, { ...runtime.angleRig, bones }, runtime.angle);
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
      ikConstraints: rig.ikConstraints,
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

function computeAngleRigWorldTransforms(
  rig: CharacterRig,
  angleRig: CharacterAngleRig,
  angle: CharacterAngle,
): Map<string, BoneWorldTransform> {
  return computeBoneWorldTransforms(
    {
      ...rig,
      activeAngle: angle,
      bones: angleRig.bones,
      angles: {
        ...rig.angles,
        [angle]: angleRig,
      },
    },
    angle,
  );
}
