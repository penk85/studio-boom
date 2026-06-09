import type {
  CharacterAngle,
  CharacterAngleRig,
  CharacterBone,
  CharacterHostConstraint,
  CharacterPart,
  CharacterPreset,
  CharacterReach,
  CharacterRig,
  CharacterSlotBinding,
  CharacterSlotRelation,
  ID,
  PartRole,
} from "../types";
import {
  getPartSlotId,
  listCharacterSlots,
  partsAvailableForAngle,
  roleLabel,
} from "./character-utils";
import { pivotForPart } from "./alpha-bounds";

export const CHARACTER_ANGLES: CharacterAngle[] = ["front", "3qL", "3qR", "sideL", "sideR"];

export interface ResolvedSlotBinding extends CharacterSlotBinding {
  effectiveBoneId: ID;
  effectiveDepth: number;
  visible: boolean;
  effectivePartId?: ID;
}

export interface BoneWorldTransform {
  id: ID;
  x: number;
  y: number;
  rotation: number;
  depth: number;
  parentId?: ID;
}

type SlotLike = ReturnType<typeof listCharacterSlots>[number];

const ROOT_BONE_ID = "bone:root";

export function normalizeCharacterRig(character: CharacterPreset): CharacterRig {
  const inferred = buildDefaultRig(character);
  const source = character.rig;
  if (!source) return inferred;

  const angles = normalizeRigAngles(character, source, inferred);
  const activeAngle = isCharacterAngle(source.activeAngle)
    ? source.activeAngle
    : inferred.activeAngle;
  const active =
    activeAngleRig(angles, activeAngle) ??
    firstAngleRig(angles) ??
    activeAngleRig(inferred.angles, inferred.activeAngle);
  const rig: CharacterRig = {
    version: 1,
    activeAngle: active?.angleId ?? inferred.activeAngle,
    angles,
    bones: active?.bones ?? inferred.bones,
    slotBindings: active?.slotBindings ?? inferred.slotBindings,
    drawOrder: active?.drawOrder ?? inferred.drawOrder,
    slotRelations: active?.slotRelations ?? inferred.slotRelations,
    hostConstraints: active?.hostConstraints ?? inferred.hostConstraints,
    reaches: active?.reaches ?? inferred.reaches,
    mesh: source.mesh?.version === 1 ? source.mesh : undefined,
  };
  const validation = validateCharacterRig(rig);
  return validation.ok ? rig : inferred;
}

export function buildDefaultRig(
  character: CharacterPreset,
  activeAngle: CharacterAngle = availableCharacterAngles(character)[0] ?? "front",
): CharacterRig {
  const angles = Object.fromEntries(
    availableCharacterAngles(character).map((angle) => [angle, buildDefaultAngleRig(character, angle)]),
  ) as Partial<Record<CharacterAngle, CharacterAngleRig>>;
  const active = activeAngleRig(angles, activeAngle) ?? activeAngleRig(angles, "front") ?? firstAngleRig(angles);
  return {
    version: 1,
    activeAngle: active?.angleId ?? "front",
    angles,
    bones: active?.bones ?? [],
    slotBindings: active?.slotBindings ?? [],
    drawOrder: active?.drawOrder ?? [],
    slotRelations: active?.slotRelations ?? [],
    hostConstraints: active?.hostConstraints ?? [],
    reaches: active?.reaches ?? [],
  };
}

function buildDefaultAngleRig(character: CharacterPreset, angle: CharacterAngle): CharacterAngleRig {
  const slots = listCharacterSlots(partsAvailableForAngle(character.parts, angle));
  const reps = new Map(slots.map((slot) => [slot.id, representativePart(slot)] as const));
  const slotIdByRoleSide = new Map<string, string>();
  const slotIdByPartId = new Map<string, string>();
  for (const slot of slots) {
    const part = reps.get(slot.id);
    slotIdByRoleSide.set(roleSideKey(slot.role, part?.side), slot.id);
    for (const slotPart of slot.parts) slotIdByPartId.set(slotPart.id, slot.id);
  }

  const root: CharacterBone = {
    id: ROOT_BONE_ID,
    semanticBoneId: ROOT_BONE_ID,
    name: "Root",
    role: "root",
    x: 0,
    y: 0,
    rotation: 0,
    depth: 0,
  };
  const boneBySlot = new Map<string, CharacterBone>();
  for (const slot of slots) {
    const part = reps.get(slot.id);
    if (!part) continue;
    const inferredParentSlotId = parentSlotIdFor(slot, part, slotIdByRoleSide, slotIdByPartId);
    const parentSlotId = inferredParentSlotId === slot.id ? undefined : inferredParentSlotId;
    const parentBoneId = parentSlotId ? `bone:${parentSlotId}` : ROOT_BONE_ID;
    const pivot = pivotForPart(part);
    const parentPart = parentSlotId ? reps.get(parentSlotId) : undefined;
    const parentPivot = parentPart ? pivotForPart(parentPart) : { x: 0, y: 0 };
    const x = Math.round(pivot.x - parentPivot.x);
    const y = Math.round(pivot.y - parentPivot.y);
    const length = Math.round(Math.hypot(part.width, part.height) * 0.5);
    boneBySlot.set(slot.id, {
      id: `bone:${slot.id}`,
      semanticBoneId: `bone:${slot.id}`,
      name: slot.name ?? roleLabel(slot.role),
      role: slot.role,
      side: part.side,
      parentId: parentBoneId,
      x,
      y,
      rotation: 0,
      length,
      depth: part.depth,
    });
  }

  const bindings: CharacterSlotBinding[] = [];
  for (const slot of slots) {
    const part = reps.get(slot.id);
    const bone = boneBySlot.get(slot.id);
    if (!part || !bone) continue;
    const pivot = pivotForPart(part);
    bindings.push({
      slotId: slot.id,
      semanticSlotId: slot.id,
      boneId: bone.id,
      x: Math.round(part.x - pivot.x),
      y: Math.round(part.y - pivot.y),
      rotation: part.rotation,
      scaleX: 1,
      scaleY: 1,
      depth: part.depth,
    });
  }

  const drawOrder = slots
    .slice()
    .sort(
      (a, b) =>
        Math.min(...a.parts.map((p) => p.zIndex)) - Math.min(...b.parts.map((p) => p.zIndex)),
    )
    .map((slot) => slot.id);
  const slotRelations = inferSlotRelations(slots, slotIdByRoleSide, slotIdByPartId);
  const hostConstraints = inferHostConstraints(slots, slotIdByRoleSide);

  return {
    angleId: angle,
    bones: [root, ...Array.from(boneBySlot.values())],
    slotBindings: bindings,
    drawOrder,
    slotRelations,
    hostConstraints,
    reaches: [],
  };
}

export function availableCharacterAngles(character: CharacterPreset): CharacterAngle[] {
  const seen = new Set<CharacterAngle>();
  const add = (value: unknown) => {
    if (isCharacterAngle(value)) seen.add(value);
  };
  for (const angle of character.angles ?? []) add(angle);
  for (const angle of Object.keys(character.rig?.angles ?? {})) add(angle);
  add(character.rig?.activeAngle);
  for (const part of character.parts) {
    add(part.angleId);
    for (const angle of part.angleIds ?? []) add(angle);
  }
  if (seen.size === 0) seen.add("front");
  return CHARACTER_ANGLES.filter((angle) => seen.has(angle));
}

function normalizeRigAngles(
  character: CharacterPreset,
  source: CharacterRig,
  inferred: CharacterRig,
): Partial<Record<CharacterAngle, CharacterAngleRig>> {
  const out: Partial<Record<CharacterAngle, CharacterAngleRig>> = {};
  const angles = availableCharacterAngles({ ...character, rig: source });
  for (const angle of angles) {
    const inferredAngle = activeAngleRig(inferred.angles, angle) ?? rigViewToAngleRig(inferred, angle);
    const sourceAngle = source.angles?.[angle] ?? legacyRigViewToAngleRig(source, angle);
    out[angle] = normalizeAngleRig(inferredAngle, sourceAngle);
  }
  return out;
}

function normalizeAngleRig(
  inferred: CharacterAngleRig,
  source: Partial<CharacterAngleRig> | undefined,
): CharacterAngleRig {
  if (!source) return inferred;
  const bonesById = new Map(inferred.bones.map((bone) => [bone.id, bone]));
  for (const bone of source.bones ?? []) {
    bonesById.set(bone.id, {
      ...bone,
      x: finiteNumber(bone.x, 0),
      y: finiteNumber(bone.y, 0),
      rotation: finiteNumber(bone.rotation, 0),
    });
  }
  if (!bonesById.has(ROOT_BONE_ID)) bonesById.set(ROOT_BONE_ID, inferred.bones[0]);

  const bindingsBySlot = new Map(inferred.slotBindings.map((binding) => [binding.slotId, binding]));
  for (const binding of source.slotBindings ?? []) {
    bindingsBySlot.set(binding.slotId, {
      ...binding,
      boneId: bonesById.has(binding.boneId) ? binding.boneId : ROOT_BONE_ID,
      x: finiteNumber(binding.x, 0),
      y: finiteNumber(binding.y, 0),
      rotation: finiteNumber(binding.rotation, 0),
      scaleX: positiveNumber(binding.scaleX, 1),
      scaleY: positiveNumber(binding.scaleY, 1),
      depth: finiteNumber(binding.depth, 0),
      visible: binding.visible,
      partId: binding.partId,
    });
  }

  const bindingSlots = new Set(bindingsBySlot.keys());
  const boneIds = new Set(bonesById.keys());
  return {
    angleId: isCharacterAngle(source.angleId) ? source.angleId : inferred.angleId,
    bones: Array.from(bonesById.values()).filter((bone): bone is CharacterBone => !!bone),
    slotBindings: Array.from(bindingsBySlot.values()),
    drawOrder: normalizeDrawOrder(
      source.drawOrder?.length ? source.drawOrder : inferred.drawOrder,
      Array.from(bindingSlots),
    ),
    slotRelations: normalizeSlotRelations(
      source.slotRelations ?? inferred.slotRelations,
      bindingSlots,
      boneIds,
    ),
    hostConstraints: normalizeHostConstraints(
      source.hostConstraints ?? inferred.hostConstraints,
      bindingSlots,
      boneIds,
    ),
    reaches: normalizeReaches(source.reaches ?? inferred.reaches, bindingSlots),
  };
}

function activeAngleRig(
  angles: Partial<Record<CharacterAngle, CharacterAngleRig>> | undefined,
  angle: CharacterAngle,
): CharacterAngleRig | undefined {
  return angles?.[angle];
}

function angleRigView(rig: CharacterRig, angle: CharacterAngle = rig.activeAngle): CharacterAngleRig {
  if (angle === rig.activeAngle) return legacyRigViewToAngleRig(rig, angle);
  return activeAngleRig(rig.angles, angle) ?? legacyRigViewToAngleRig(rig, angle);
}

function firstAngleRig(
  angles: Partial<Record<CharacterAngle, CharacterAngleRig>> | undefined,
): CharacterAngleRig | undefined {
  return Object.values(angles ?? {})[0];
}

function rigViewToAngleRig(rig: CharacterRig, angle: CharacterAngle): CharacterAngleRig {
  return {
    angleId: angle,
    bones: rig.bones ?? [],
    slotBindings: rig.slotBindings ?? [],
    drawOrder: rig.drawOrder ?? [],
    slotRelations: rig.slotRelations ?? [],
    hostConstraints: rig.hostConstraints ?? [],
    reaches: rig.reaches ?? [],
  };
}

function legacyRigViewToAngleRig(
  rig: Partial<CharacterRig>,
  angle: CharacterAngle,
): CharacterAngleRig {
  return {
    angleId: angle,
    bones: (rig.bones ?? []).map((bone) => {
      const override = bone.angleOverrides?.[angle];
      return override
        ? {
            ...bone,
            x: override.x ?? bone.x,
            y: override.y ?? bone.y,
            rotation: override.rotation ?? bone.rotation,
            depth: override.depth ?? bone.depth,
          }
        : bone;
    }),
    slotBindings: (rig.slotBindings ?? []).map((binding) => {
      const override = binding.angleOverrides?.[angle];
      return override
        ? {
            ...binding,
            boneId: override.boneId ?? binding.boneId,
            x: override.x ?? binding.x,
            y: override.y ?? binding.y,
            rotation: override.rotation ?? binding.rotation,
            scaleX: override.scaleX ?? binding.scaleX,
            scaleY: override.scaleY ?? binding.scaleY,
            depth: override.depth ?? binding.depth,
            visible: override.visible ?? binding.visible,
            partId: override.partId ?? binding.partId,
          }
        : binding;
    }),
    drawOrder: rig.drawOrder ?? [],
    slotRelations: rig.slotRelations ?? [],
    hostConstraints: rig.hostConstraints ?? [],
    reaches: rig.reaches ?? [],
  };
}

function withUpdatedAngleRig(
  rig: CharacterRig,
  angle: CharacterAngle,
  update: (angleRig: CharacterAngleRig) => CharacterAngleRig,
): CharacterRig {
  const angles: Partial<Record<CharacterAngle, CharacterAngleRig>> = {
    ...(rig.angles ?? {}),
  };
  const sourceAngle = angleRigView(rig, angle);
  const nextAngle = update(sourceAngle);
  angles[angle] = nextAngle;
  const active = angle === rig.activeAngle ? nextAngle : activeAngleRig(angles, rig.activeAngle);
  return {
    ...rig,
    angles,
    ...(active
      ? {
          bones: active.bones,
          slotBindings: active.slotBindings,
          drawOrder: active.drawOrder,
          slotRelations: active.slotRelations,
          hostConstraints: active.hostConstraints,
          reaches: active.reaches,
        }
      : {}),
  };
}

function isCharacterAngle(value: unknown): value is CharacterAngle {
  return typeof value === "string" && (CHARACTER_ANGLES as string[]).includes(value);
}

export function validateCharacterRig(rig: CharacterRig): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (rig.version !== 1) errors.push("Rig version must be 1.");
  const boneIds = new Set<string>();
  for (const bone of rig.bones) {
    if (!bone.id) errors.push("Bone is missing id.");
    if (boneIds.has(bone.id)) errors.push(`Duplicate bone id "${bone.id}".`);
    boneIds.add(bone.id);
  }
  for (const bone of rig.bones) {
    if (bone.parentId && !boneIds.has(bone.parentId)) {
      errors.push(`Bone "${bone.id}" references missing parent "${bone.parentId}".`);
    }
  }
  const bindingSlots = new Set<string>();
  for (const binding of rig.slotBindings) {
    if (!boneIds.has(binding.boneId)) {
      errors.push(`Slot "${binding.slotId}" references missing bone "${binding.boneId}".`);
    }
    if (bindingSlots.has(binding.slotId))
      errors.push(`Duplicate binding for slot "${binding.slotId}".`);
    bindingSlots.add(binding.slotId);
  }
  for (const reach of rig.reaches) {
    if (!bindingSlots.has(reach.slotId)) {
      errors.push(`Reach "${reach.id}" references missing slot "${reach.slotId}".`);
    }
  }
  validateSlotRelations(rig.slotRelations ?? [], bindingSlots, boneIds, "Rig", errors);
  for (const constraint of rig.hostConstraints ?? []) {
    if (!bindingSlots.has(constraint.slotId)) {
      errors.push(
        `Host constraint "${constraint.id}" references missing slot "${constraint.slotId}".`,
      );
    }
    if (constraint.hostSlotId && !bindingSlots.has(constraint.hostSlotId)) {
      errors.push(
        `Host constraint "${constraint.id}" references missing host slot "${constraint.hostSlotId}".`,
      );
    }
    if (constraint.hostBoneId && !boneIds.has(constraint.hostBoneId)) {
      errors.push(
        `Host constraint "${constraint.id}" references missing host bone "${constraint.hostBoneId}".`,
      );
    }
  }
  for (const bone of rig.bones) {
    const seen = new Set<string>();
    let current: CharacterBone | undefined = bone;
    while (current?.parentId) {
      if (seen.has(current.id)) {
        errors.push(`Bone "${bone.id}" is part of a parent cycle.`);
        break;
      }
      seen.add(current.id);
      current = rig.bones.find((candidate) => candidate.id === current?.parentId);
    }
  }
  for (const [angle, angleRig] of Object.entries(rig.angles ?? {})) {
    if (!isCharacterAngle(angle)) {
      errors.push(`Unknown angle "${angle}".`);
      continue;
    }
    if (!angleRig) continue;
    validateAngleRigGraph(angleRig, `Angle "${angle}"`, errors);
  }
  return { ok: errors.length === 0, errors };
}

function validateAngleRigGraph(
  angleRig: CharacterAngleRig,
  label: string,
  errors: string[],
): void {
  const boneIds = new Set<string>();
  for (const bone of angleRig.bones) {
    if (!bone.id) errors.push(`${label}: bone is missing id.`);
    if (boneIds.has(bone.id)) errors.push(`${label}: duplicate bone id "${bone.id}".`);
    boneIds.add(bone.id);
  }
  for (const bone of angleRig.bones) {
    if (bone.parentId && !boneIds.has(bone.parentId)) {
      errors.push(`${label}: bone "${bone.id}" references missing parent "${bone.parentId}".`);
    }
  }
  const bindingSlots = new Set<string>();
  for (const binding of angleRig.slotBindings) {
    if (!boneIds.has(binding.boneId)) {
      errors.push(`${label}: slot "${binding.slotId}" references missing bone "${binding.boneId}".`);
    }
    if (bindingSlots.has(binding.slotId)) {
      errors.push(`${label}: duplicate binding for slot "${binding.slotId}".`);
    }
    bindingSlots.add(binding.slotId);
  }
  for (const reach of angleRig.reaches) {
    if (!bindingSlots.has(reach.slotId)) {
      errors.push(`${label}: reach "${reach.id}" references missing slot "${reach.slotId}".`);
    }
  }
  validateSlotRelations(angleRig.slotRelations ?? [], bindingSlots, boneIds, label, errors);
  for (const constraint of angleRig.hostConstraints ?? []) {
    if (!bindingSlots.has(constraint.slotId)) {
      errors.push(`${label}: host constraint "${constraint.id}" references missing slot "${constraint.slotId}".`);
    }
    if (constraint.hostSlotId && !bindingSlots.has(constraint.hostSlotId)) {
      errors.push(
        `${label}: host constraint "${constraint.id}" references missing host slot "${constraint.hostSlotId}".`,
      );
    }
    if (constraint.hostBoneId && !boneIds.has(constraint.hostBoneId)) {
      errors.push(
        `${label}: host constraint "${constraint.id}" references missing host bone "${constraint.hostBoneId}".`,
      );
    }
  }
  for (const bone of angleRig.bones) {
    const seen = new Set<string>();
    let current: CharacterBone | undefined = bone;
    while (current?.parentId) {
      if (seen.has(current.id)) {
        errors.push(`${label}: bone "${bone.id}" is part of a parent cycle.`);
        break;
      }
      seen.add(current.id);
      current = angleRig.bones.find((candidate) => candidate.id === current?.parentId);
    }
  }
}

function validateSlotRelations(
  relations: CharacterSlotRelation[],
  slotIds: Set<string>,
  boneIds: Set<string>,
  label: string,
  errors: string[],
): void {
  const parentByChild = new Map<string, string>();
  for (const relation of relations ?? []) {
    if (!relation.id) errors.push(`${label}: slot relation is missing id.`);
    if (!slotIds.has(relation.childSlotId)) {
      errors.push(
        `${label}: slot relation "${relation.id}" references missing child slot "${relation.childSlotId}".`,
      );
    }
    if (relation.parentRef.type === "slot" || relation.parentRef.type === "semanticSlot") {
      if (!slotIds.has(relation.parentRef.id)) {
        errors.push(
          `${label}: slot relation "${relation.id}" references missing parent slot "${relation.parentRef.id}".`,
        );
      } else if (relation.parentRef.id === relation.childSlotId) {
        errors.push(`${label}: slot relation "${relation.id}" cannot parent a slot to itself.`);
      } else {
        parentByChild.set(relation.childSlotId, relation.parentRef.id);
      }
    }
    if (relation.parentRef.type === "bone" && !boneIds.has(relation.parentRef.id)) {
      errors.push(
        `${label}: slot relation "${relation.id}" references missing parent bone "${relation.parentRef.id}".`,
      );
    }
    if (relation.clipMode === "clipToMaskSlot" && relation.clipSlotId && !slotIds.has(relation.clipSlotId)) {
      errors.push(
        `${label}: slot relation "${relation.id}" references missing clip slot "${relation.clipSlotId}".`,
      );
    }
  }
  for (const childSlotId of parentByChild.keys()) {
    const seen = new Set<string>();
    let current: string | undefined = childSlotId;
    while (current) {
      if (seen.has(current)) {
        errors.push(`${label}: slot relation cycle includes "${childSlotId}".`);
        break;
      }
      seen.add(current);
      current = parentByChild.get(current);
    }
  }
}

export function computeBoneWorldTransforms(
  rig: CharacterRig,
  angle: CharacterAngle = rig.activeAngle,
): Map<string, BoneWorldTransform> {
  const angleRig = angleRigView(rig, angle);
  const bonesById = new Map(angleRig.bones.map((bone) => [bone.id, bone]));
  const out = new Map<string, BoneWorldTransform>();
  const resolving = new Set<string>();
  const resolve = (bone: CharacterBone): BoneWorldTransform => {
    const cached = out.get(bone.id);
    if (cached) return cached;
    resolving.add(bone.id);
    const local = {
      x: bone.x,
      y: bone.y,
      rotation: bone.rotation,
      depth: bone.depth ?? 0,
    };
    const parent = bone.parentId ? bonesById.get(bone.parentId) : undefined;
    if (!parent) {
      const world = { id: bone.id, parentId: bone.parentId, ...local };
      out.set(bone.id, world);
      resolving.delete(bone.id);
      return world;
    }
    if (resolving.has(parent.id)) {
      const world = { id: bone.id, parentId: bone.parentId, ...local };
      out.set(bone.id, world);
      resolving.delete(bone.id);
      return world;
    }
    const parentWorld = resolve(parent);
    const point = rotatePoint(local, parentWorld.rotation);
    const world = {
      id: bone.id,
      parentId: bone.parentId,
      x: parentWorld.x + point.x,
      y: parentWorld.y + point.y,
      rotation: parentWorld.rotation + local.rotation,
      depth: local.depth,
    };
    out.set(bone.id, world);
    resolving.delete(bone.id);
    return world;
  };
  for (const bone of angleRig.bones) resolve(bone);
  return out;
}

export function resolveSlotBinding(
  rig: CharacterRig,
  slotId: string,
  angle: CharacterAngle = rig.activeAngle,
): ResolvedSlotBinding | undefined {
  const angleRig = angleRigView(rig, angle);
  const binding = angleRig.slotBindings.find((candidate) => candidate.slotId === slotId);
  if (!binding) return undefined;
  return {
    ...binding,
    effectiveBoneId: binding.boneId,
    effectivePartId: binding.partId,
    effectiveDepth: binding.depth,
    visible: binding.visible ?? true,
  };
}

export function activeDepthForSlot(
  rig: CharacterRig,
  slotId: string,
  fallbackDepth = 0,
  angle: CharacterAngle = rig.activeAngle,
): number {
  return resolveSlotBinding(rig, slotId, angle)?.effectiveDepth ?? fallbackDepth;
}

export function slotDrawIndex(
  rig: CharacterRig,
  slotId: string,
  fallback = 0,
  angle: CharacterAngle = rig.activeAngle,
): number {
  const index = angleRigView(rig, angle).drawOrder.indexOf(slotId);
  return index >= 0 ? index : fallback;
}

export function moveSlotBinding(
  rig: CharacterRig,
  slotId: string,
  dx: number,
  dy: number,
  angle: CharacterAngle = rig.activeAngle,
): CharacterRig {
  return withUpdatedAngleRig(rig, angle, (angleRig) => ({
    ...angleRig,
    slotBindings: angleRig.slotBindings.map((binding) => {
      if (binding.slotId !== slotId) return binding;
      return { ...binding, x: binding.x + dx, y: binding.y + dy };
    }),
  }));
}

export function moveBone(
  rig: CharacterRig,
  boneId: string,
  dx: number,
  dy: number,
  angle: CharacterAngle = rig.activeAngle,
): CharacterRig {
  return withUpdatedAngleRig(rig, angle, (angleRig) => ({
    ...angleRig,
    bones: angleRig.bones.map((bone) => {
      if (bone.id !== boneId) return bone;
      return { ...bone, x: bone.x + dx, y: bone.y + dy };
    }),
  }));
}

export function moveBoneForSlot(
  rig: CharacterRig,
  slotId: string,
  dx: number,
  dy: number,
  angle: CharacterAngle = rig.activeAngle,
): CharacterRig {
  const binding = resolveSlotBinding(rig, slotId, angle);
  return binding ? moveBone(rig, binding.effectiveBoneId, dx, dy, angle) : rig;
}

export function bindSlotPartToAngle(
  rig: CharacterRig,
  slotId: string,
  partId: string,
  angle: CharacterAngle = rig.activeAngle,
): CharacterRig {
  return withUpdatedAngleRig(rig, angle, (angleRig) => ({
    ...angleRig,
    slotBindings: angleRig.slotBindings.map((binding) => {
      if (binding.slotId !== slotId) return binding;
      return { ...binding, partId, visible: true };
    }),
  }));
}

export function setSlotDepth(
  rig: CharacterRig,
  slotId: string,
  depth: number,
  angle: CharacterAngle = rig.activeAngle,
): CharacterRig {
  return withUpdatedAngleRig(rig, angle, (angleRig) => ({
    ...angleRig,
    slotBindings: angleRig.slotBindings.map((binding) => {
      if (binding.slotId !== slotId) return binding;
      return { ...binding, depth };
    }),
  }));
}

export function setBoneDepth(
  rig: CharacterRig,
  boneId: string,
  depth: number,
  angle: CharacterAngle = rig.activeAngle,
): CharacterRig {
  return withUpdatedAngleRig(rig, angle, (angleRig) => ({
    ...angleRig,
    bones: angleRig.bones.map((bone) => {
      if (bone.id !== boneId) return bone;
      return { ...bone, depth };
    }),
  }));
}

export function setBoneTransform(
  rig: CharacterRig,
  boneId: string,
  patch: Partial<Pick<CharacterBone, "x" | "y" | "rotation" | "depth">>,
  angle: CharacterAngle = rig.activeAngle,
): CharacterRig {
  return withUpdatedAngleRig(rig, angle, (angleRig) => ({
    ...angleRig,
    bones: angleRig.bones.map((bone) => (bone.id === boneId ? { ...bone, ...patch } : bone)),
  }));
}

/** Create or update a slot's reach record. */
function upsertSlotReach(
  rig: CharacterRig,
  slotId: ID,
  patch: Partial<Pick<CharacterReach, "reach" | "rotReach">>,
  angle: CharacterAngle = rig.activeAngle,
): CharacterRig {
  return withUpdatedAngleRig(rig, angle, (angleRig) => {
    const existing = angleRig.reaches.find((entry) => entry.slotId === slotId);
    const base: CharacterReach = existing ?? { id: `reach:${slotId}`, slotId };
    const next: CharacterReach = { ...base, ...patch };
    const others = angleRig.reaches.filter((entry) => entry.slotId !== slotId);
    return { ...angleRig, reaches: [...others, next] };
  });
}

/**
 * Set or clear a slot's traced movement reach (parent-frame offsets from its rest position).
 * Fewer than three points clears it.
 */
export function setSlotReach(
  rig: CharacterRig,
  slotId: ID,
  reach: { x: number; y: number }[] | undefined,
  angle: CharacterAngle = rig.activeAngle,
): CharacterRig {
  return upsertSlotReach(rig, slotId, {
    reach: reach && reach.length >= 3 ? reach : undefined,
  }, angle);
}

/** Set or clear a slot's rotation reach — how far it may twist from rest, in degrees. */
export function setSlotRotReach(
  rig: CharacterRig,
  slotId: ID,
  rotReach: { min: number; max: number } | undefined,
  angle: CharacterAngle = rig.activeAngle,
): CharacterRig {
  const next =
    rotReach && (rotReach.min !== 0 || rotReach.max !== 0)
      ? { min: Math.round(Math.min(0, rotReach.min)), max: Math.round(Math.max(0, rotReach.max)) }
      : undefined;
  return upsertSlotReach(rig, slotId, { rotReach: next }, angle);
}

/** Create, update, or clear a slot's host containment constraint. */
export function setSlotHostConstraint(
  rig: CharacterRig,
  slotId: ID,
  hostSlotId: ID | undefined,
  mode: CharacterHostConstraint["mode"] = "insideHostMask",
  reachPolicy: NonNullable<CharacterHostConstraint["reachPolicy"]> = "scaleToFit",
  angle: CharacterAngle = rig.activeAngle,
): CharacterRig {
  return withUpdatedAngleRig(rig, angle, (angleRig) => {
    const others = (angleRig.hostConstraints ?? []).filter((entry) => entry.slotId !== slotId);
    if (!hostSlotId) return { ...angleRig, hostConstraints: others };
    const existing = (angleRig.hostConstraints ?? []).find((entry) => entry.slotId === slotId);
    const hostBoneId = angleRig.slotBindings.find((binding) => binding.slotId === hostSlotId)?.boneId;
    return {
      ...angleRig,
      hostConstraints: [
        ...others,
        {
          id: existing?.id || `host:${slotId}`,
          slotId,
          hostSlotId,
          hostBoneId,
          mode,
          reachPolicy,
        },
      ],
    };
  });
}

type Point = { x: number; y: number };

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const intersects =
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function nearestPointOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= Number.EPSILON) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** Clamp a point to lie within a polygon (nearest boundary point when outside). */
export function clampPointToPolygon(p: Point, poly: Point[]): Point {
  if (poly.length < 3 || pointInPolygon(p, poly)) return p;
  let best = poly[0];
  let bestDist = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const q = nearestPointOnSegment(p, poly[i], poly[(i + 1) % poly.length]);
    const dist = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = q;
    }
  }
  return best;
}

/**
 * "Tone down" a sampled motion delta so it respects the layer's authored reach: clamp its
 * drift (dx/dy) into the reach polygon and its rotation into the twist range. Returns the original
 * values when no reach is set, plus a `clamped` flag for warnings.
 */
export function clampMotionDeltaToReach(
  reach: CharacterReach | undefined,
  dx: number,
  dy: number,
  rotation: number,
): { dx: number; dy: number; rotation: number; clamped: boolean } {
  let outX = dx;
  let outY = dy;
  let outR = rotation;
  let clamped = false;
  if (reach?.reach && reach.reach.length >= 3) {
    const q = clampPointToPolygon({ x: dx, y: dy }, reach.reach);
    if (q.x !== dx || q.y !== dy) clamped = true;
    outX = q.x;
    outY = q.y;
  }
  if (reach?.rotReach) {
    const r = Math.max(reach.rotReach.min, Math.min(reach.rotReach.max, rotation));
    if (r !== rotation) clamped = true;
    outR = r;
  }
  return { dx: outX, dy: outY, rotation: outR, clamped };
}

export function slotIdsForBoneSubtree(
  rig: CharacterRig,
  boneId: string,
  angle: CharacterAngle = rig.activeAngle,
): Set<string> {
  const angleRig = angleRigView(rig, angle);
  const boneIds = new Set<string>([boneId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const bone of angleRig.bones) {
      if (boneIds.has(bone.id)) continue;
      if (bone.parentId && boneIds.has(bone.parentId)) {
        boneIds.add(bone.id);
        changed = true;
      }
    }
  }
  return new Set(
    angleRig.slotBindings
      .map((binding) => resolveSlotBinding(rig, binding.slotId, angle))
      .filter((binding): binding is ResolvedSlotBinding => !!binding)
      .filter((binding) => boneIds.has(binding.effectiveBoneId))
      .map((binding) => binding.slotId),
  );
}

export function moveSlotParts(
  character: CharacterPreset,
  slotId: string,
  dx: number,
  dy: number,
): CharacterPart[] {
  const slotParts = character.parts.filter((part) => getPartSlotId(part) === slotId);
  if (slotParts.length === 0) return character.parts;
  return character.parts.map((part) => {
    if (getPartSlotId(part) !== slotId) return part;
    const pivot = pivotForPart(part);
    return {
      ...part,
      x: part.x + dx,
      y: part.y + dy,
      pivot: { x: pivot.x + dx, y: pivot.y + dy },
    };
  });
}

export function movePartAndDescendants(
  parts: CharacterPart[],
  partId: string,
  dx: number,
  dy: number,
): CharacterPart[] {
  const targetIds = descendantPartIds(parts, partId);
  targetIds.add(partId);
  return parts.map((part) => {
    if (!targetIds.has(part.id)) return part;
    const pivot = pivotForPart(part);
    return {
      ...part,
      x: part.x + dx,
      y: part.y + dy,
      pivot: { x: pivot.x + dx, y: pivot.y + dy },
    };
  });
}

export function characterRigPrompt(character: CharacterPreset): string {
  const rig = normalizeCharacterRig(character);
  return `Create or refine a Studio Boom CharacterRig.

Rules:
- Keep output as JSON only.
- Do not output Spine JSON or renderer code.
- Bones must form an acyclic FK hierarchy.
- slotBindings attach slots to bones using local offsets.
- slotRelations describe slot hierarchy, inheritance, variant-gated visibility, and render nesting.
- hostConstraints keep slots inside host art while editing movement/bounds only.
- depth is parallax/2.5D only; drawOrder controls visual stacking.
- reaches[] limit how far a slot may drift/twist from its parent (movement guides).
- Angles are discrete in V1: front, 3qL, 3qR, sideL, sideR.
- Each rig.angles[angleId] entry is its own concrete skeleton, slot binding set, draw order, and reach set.
- Use part angleIds to mark which image variants belong to each angle. Omit angleIds only for art that is intentionally shared across angles.
- The final character must remain HyperFrames-compatible.

Character:
${JSON.stringify(
  {
    id: character.id,
    name: character.name,
    canvasWidth: character.canvasWidth,
    canvasHeight: character.canvasHeight,
    parts: character.parts.map((part) => ({
      id: part.id,
      slotId: getPartSlotId(part),
      role: part.role,
      side: part.side,
      name: part.name,
      x: part.x,
      y: part.y,
      width: part.width,
      height: part.height,
      rotation: part.rotation,
      pivot: pivotForPart(part),
      alphaBounds: part.alphaBounds,
      zIndex: part.zIndex,
      depth: part.depth,
      angleId: part.angleId,
      angleIds: part.angleIds,
    })),
    currentRig: rig,
  },
  null,
  2,
)}`;
}

function representativePart(slot: SlotLike): CharacterPart | undefined {
  return (
    slot.parts.find(
      (part) =>
        part.visible &&
        (part.pose === "idle" || part.viseme === "rest" || part.eyeState === "open"),
    ) ??
    slot.parts.find((part) => part.visible) ??
    slot.parts[0]
  );
}

function parentSlotIdFor(
  slot: SlotLike,
  part: CharacterPart,
  slotIdByRoleSide: Map<string, string>,
  slotIdByPartId: Map<string, string>,
): string | undefined {
  if (part.parentId) {
    return slotIdByPartId.get(part.parentId);
  }
  const sameSide = part.side === "left" || part.side === "right" ? part.side : undefined;
  switch (slot.role) {
    case "head":
      return slotIdByRoleSide.get(roleSideKey("body"));
    case "eye":
    case "eyebrow":
    case "nose":
    case "mouth":
      return slotIdByRoleSide.get(roleSideKey("head"));
    case "iris":
      return (
        slotIdByRoleSide.get(roleSideKey("eye", sameSide)) ??
        slotIdByRoleSide.get(roleSideKey("eye")) ??
        slotIdByRoleSide.get(roleSideKey("head"))
      );
    case "hair":
      return slotIdByRoleSide.get(roleSideKey("head")) ?? slotIdByRoleSide.get(roleSideKey("body"));
    case "arm":
      return slotIdByRoleSide.get(roleSideKey("body"));
    case "hand":
      return (
        slotIdByRoleSide.get(roleSideKey("arm", sameSide)) ??
        slotIdByRoleSide.get(roleSideKey("arm"))
      );
    case "leg":
      return slotIdByRoleSide.get(roleSideKey("body"));
    case "foot":
      return (
        slotIdByRoleSide.get(roleSideKey("leg", sameSide)) ??
        slotIdByRoleSide.get(roleSideKey("leg"))
      );
    case "accessory":
      return slotIdByRoleSide.get(roleSideKey("head")) ?? slotIdByRoleSide.get(roleSideKey("body"));
    default:
      return slotIdByRoleSide.get(roleSideKey("body"));
  }
}

function inferHostConstraints(slots: SlotLike[], slotIdByRoleSide: Map<string, string>) {
  const headSlotId = slotIdByRoleSide.get(roleSideKey("head"));
  if (!headSlotId) return [];
  const constrainedRoles = new Set<PartRole>(["eye", "iris", "eyebrow", "nose", "mouth"]);
  return slots
    .filter((slot) => constrainedRoles.has(slot.role) && slot.id !== headSlotId)
    .map(
      (slot): CharacterHostConstraint => {
        const sameSide = slot.parts.find((part) => part.side === "left" || part.side === "right")
          ?.side;
        const hostSlotId =
          slot.role === "iris"
            ? (slotIdByRoleSide.get(roleSideKey("eye", sameSide)) ??
              slotIdByRoleSide.get(roleSideKey("eye")) ??
              headSlotId)
            : headSlotId;
        return {
          id: `host:${slot.id}`,
          slotId: slot.id,
          hostSlotId,
          hostBoneId: `bone:${hostSlotId}`,
          mode: "insideHostMask",
          reachPolicy: "scaleToFit",
        };
      },
    );
}

function inferSlotRelations(
  slots: SlotLike[],
  slotIdByRoleSide: Map<string, string>,
  slotIdByPartId: Map<string, string>,
): CharacterSlotRelation[] {
  return slots.flatMap((slot): CharacterSlotRelation[] => {
    const part = representativePart(slot);
    if (!part) return [];
    const parentSlotId = parentSlotIdFor(slot, part, slotIdByRoleSide, slotIdByPartId);
    if (!parentSlotId || parentSlotId === slot.id) return [];
    const isIris = slot.role === "iris";
    return [
      {
        id: `relation:${slot.id}`,
        childSlotId: slot.id,
        parentRef: { type: "slot", id: parentSlotId },
        relationType: relationTypeForSlot(slot.role),
        activeWhenParentVariant: isIris ? { keys: ["open"] } : undefined,
        transformMode: "inheritParent",
        visibilityMode: isIris ? "withParentVariant" : "withParentSlot",
        renderMode: isIris ? "nested" : "sibling",
        clipMode: "none",
      },
    ];
  });
}

function relationTypeForSlot(role: PartRole): CharacterSlotRelation["relationType"] {
  switch (role) {
    case "eye":
    case "iris":
    case "eyebrow":
    case "nose":
    case "mouth":
      return "containedFeature";
    case "hand":
    case "foot":
    case "hair":
    case "accessory":
      return "attachment";
    case "custom":
      return "heldProp";
    default:
      return "attachment";
  }
}

function normalizeDrawOrder(drawOrder: string[], slotIds: string[]): string[] {
  const seen = new Set<string>();
  const out = drawOrder.filter((slotId) => {
    if (!slotIds.includes(slotId) || seen.has(slotId)) return false;
    seen.add(slotId);
    return true;
  });
  for (const slotId of slotIds) {
    if (!seen.has(slotId)) out.push(slotId);
  }
  return out;
}

/** Keep one reach record per known slot (latest wins), dropping any for missing slots. */
function normalizeReaches(reaches: CharacterReach[], slotIds: Set<string>): CharacterReach[] {
  const out = new Map<string, CharacterReach>();
  for (const entry of reaches) {
    if (!entry?.slotId || !slotIds.has(entry.slotId)) continue;
    out.set(entry.slotId, { ...entry, id: entry.id || `reach:${entry.slotId}` });
  }
  return Array.from(out.values());
}

function normalizeSlotRelations(
  relations: CharacterSlotRelation[],
  slotIds: Set<string>,
  boneIds: Set<string>,
): CharacterSlotRelation[] {
  const out = new Map<string, CharacterSlotRelation>();
  for (const entry of relations ?? []) {
    if (!entry?.childSlotId || !slotIds.has(entry.childSlotId)) continue;
    if (entry.parentRef?.type === "slot" || entry.parentRef?.type === "semanticSlot") {
      if (!slotIds.has(entry.parentRef.id) || entry.parentRef.id === entry.childSlotId) continue;
    } else if (entry.parentRef?.type === "bone") {
      if (!boneIds.has(entry.parentRef.id)) continue;
    } else if (entry.parentRef?.type !== "role") {
      continue;
    }
    out.set(entry.childSlotId, {
      id: entry.id || `relation:${entry.childSlotId}`,
      childSlotId: entry.childSlotId,
      parentRef: entry.parentRef,
      relationType: normalizeRelationType(entry.relationType),
      activeWhenParentVariant: normalizeVariantGate(entry.activeWhenParentVariant),
      transformMode: entry.transformMode === "independent" ? "independent" : "inheritParent",
      visibilityMode: ["withParentSlot", "withParentVariant", "independent"].includes(
        entry.visibilityMode,
      )
        ? entry.visibilityMode
        : "withParentSlot",
      renderMode: entry.renderMode === "nested" ? "nested" : "sibling",
      clipMode: ["none", "clipToParentShape", "clipToMaskSlot"].includes(entry.clipMode ?? "none")
        ? (entry.clipMode ?? "none")
        : "none",
      clipSlotId:
        entry.clipSlotId && slotIds.has(entry.clipSlotId) ? entry.clipSlotId : undefined,
      characterViewIds: entry.characterViewIds?.filter(isCharacterAngle),
    });
  }
  return Array.from(out.values());
}

function normalizeRelationType(
  value: CharacterSlotRelation["relationType"] | undefined,
): CharacterSlotRelation["relationType"] {
  return [
    "attachment",
    "containedFeature",
    "decorativeChild",
    "heldProp",
    "clothingCoverage",
  ].includes(value ?? "")
    ? (value as CharacterSlotRelation["relationType"])
    : "attachment";
}

function normalizeVariantGate(
  gate: CharacterSlotRelation["activeWhenParentVariant"] | undefined,
): CharacterSlotRelation["activeWhenParentVariant"] | undefined {
  const keys = gate?.keys?.filter((value): value is string => typeof value === "string");
  const partIds = gate?.partIds?.filter((value): value is string => typeof value === "string");
  if (!keys?.length && !partIds?.length) return undefined;
  return { keys, partIds };
}

/** Keep one host constraint per known slot, dropping broken references. */
function normalizeHostConstraints(
  constraints: CharacterHostConstraint[],
  slotIds: Set<string>,
  boneIds: Set<string>,
): CharacterHostConstraint[] {
  const out = new Map<string, CharacterHostConstraint>();
  for (const entry of constraints ?? []) {
    if (!entry?.slotId || !slotIds.has(entry.slotId)) continue;
    const hostSlotId =
      entry.hostSlotId && slotIds.has(entry.hostSlotId) && entry.hostSlotId !== entry.slotId
        ? entry.hostSlotId
        : undefined;
    const hostBoneId =
      entry.hostBoneId && boneIds.has(entry.hostBoneId) ? entry.hostBoneId : undefined;
    if (!hostSlotId && !hostBoneId) continue;
    const mode = ["insideHostMask", "insideHostBounds", "reach"].includes(entry.mode)
      ? entry.mode
      : "insideHostMask";
    const reachPolicy = ["scaleToFit", "cap", "allow"].includes(entry.reachPolicy ?? "")
      ? entry.reachPolicy
      : "scaleToFit";
    out.set(entry.slotId, {
      id: entry.id || `host:${entry.slotId}`,
      slotId: entry.slotId,
      hostSlotId,
      hostBoneId,
      mode,
      reachPolicy,
    });
  }
  return Array.from(out.values());
}

function descendantPartIds(parts: CharacterPart[], partId: string): Set<string> {
  const out = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const part of parts) {
      if (out.has(part.id)) continue;
      if (part.parentId === partId || (part.parentId && out.has(part.parentId))) {
        out.add(part.id);
        changed = true;
      }
    }
  }
  return out;
}

function rotatePoint(point: { x: number; y: number }, degrees: number): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

function roleSideKey(role: PartRole, side?: CharacterPart["side"]) {
  return `${role}:${side ?? "center"}`;
}

function finiteNumber(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? (value as number) : fallback;
}

function positiveNumber(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && (value as number) > 0 ? (value as number) : fallback;
}
