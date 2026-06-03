import type {
  CharacterAngle,
  CharacterBone,
  CharacterHostConstraint,
  CharacterPart,
  CharacterPreset,
  CharacterRig,
  CharacterSlotBinding,
  ID,
  PartRole,
} from "../types";
import { getPartSlotId, listCharacterSlots, roleLabel } from "./character-utils";
import { localAlphaBounds, pivotForPart } from "./alpha-bounds";

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
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function normalizeCharacterRig(character: CharacterPreset): CharacterRig {
  const inferred = buildDefaultRig(character);
  const source = character.rig;
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
      partId: binding.partId,
    });
  }

  const drawOrder = normalizeDrawOrder(
    source.drawOrder?.length ? source.drawOrder : inferred.drawOrder,
    Array.from(bindingsBySlot.keys()),
  );
  const hostConstraints = normalizeHostConstraints(
    mergeHostConstraints(inferred.hostConstraints, source.hostConstraints ?? []),
    new Set(bindingsBySlot.keys()),
    new Set(bonesById.keys()),
  );

  const rig: CharacterRig = {
    version: 1,
    activeAngle: CHARACTER_ANGLES.includes(source.activeAngle) ? source.activeAngle : "front",
    bones: Array.from(bonesById.values()),
    slotBindings: Array.from(bindingsBySlot.values()),
    drawOrder,
    hostConstraints,
    mesh: source.mesh?.version === 1 ? source.mesh : undefined,
  };
  const validation = validateCharacterRig(rig);
  return validation.ok ? rig : inferred;
}

export function buildDefaultRig(character: CharacterPreset): CharacterRig {
  const slots = listCharacterSlots(character.parts);
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
    boneBySlot.set(slot.id, {
      id: `bone:${slot.id}`,
      name: slot.name ?? roleLabel(slot.role),
      role: slot.role,
      side: part.side,
      parentId: parentBoneId,
      x: Math.round(pivot.x - parentPivot.x),
      y: Math.round(pivot.y - parentPivot.y),
      rotation: 0,
      length: Math.round(Math.hypot(part.width, part.height) * 0.5),
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

  return {
    version: 1,
    activeAngle: "front",
    bones: [root, ...Array.from(boneBySlot.values())],
    slotBindings: bindings,
    drawOrder,
    hostConstraints: inferHostConstraints(slots, reps, boneBySlot),
  };
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
  for (const constraint of rig.hostConstraints) {
    if (!bindingSlots.has(constraint.slotId)) {
      errors.push(`Constraint "${constraint.id}" references missing slot "${constraint.slotId}".`);
    }
    if (constraint.hostSlotId && !bindingSlots.has(constraint.hostSlotId)) {
      errors.push(
        `Constraint "${constraint.id}" references missing host slot "${constraint.hostSlotId}".`,
      );
    }
    if (constraint.hostBoneId && !boneIds.has(constraint.hostBoneId)) {
      errors.push(
        `Constraint "${constraint.id}" references missing host bone "${constraint.hostBoneId}".`,
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
  return { ok: errors.length === 0, errors };
}

export function computeBoneWorldTransforms(
  rig: CharacterRig,
  angle: CharacterAngle = rig.activeAngle,
): Map<string, BoneWorldTransform> {
  const bonesById = new Map(rig.bones.map((bone) => [bone.id, bone]));
  const out = new Map<string, BoneWorldTransform>();
  const resolving = new Set<string>();
  const resolve = (bone: CharacterBone): BoneWorldTransform => {
    const cached = out.get(bone.id);
    if (cached) return cached;
    resolving.add(bone.id);
    const override = bone.angleOverrides?.[angle];
    const local = {
      x: override?.x ?? bone.x,
      y: override?.y ?? bone.y,
      rotation: override?.rotation ?? bone.rotation,
      depth: override?.depth ?? bone.depth ?? 0,
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
  for (const bone of rig.bones) resolve(bone);
  return out;
}

export function resolveSlotBinding(
  rig: CharacterRig,
  slotId: string,
  angle: CharacterAngle = rig.activeAngle,
): ResolvedSlotBinding | undefined {
  const binding = rig.slotBindings.find((candidate) => candidate.slotId === slotId);
  if (!binding) return undefined;
  const override = binding.angleOverrides?.[angle];
  return {
    ...binding,
    boneId: override?.boneId ?? binding.boneId,
    effectiveBoneId: override?.boneId ?? binding.boneId,
    x: override?.x ?? binding.x,
    y: override?.y ?? binding.y,
    rotation: override?.rotation ?? binding.rotation,
    scaleX: override?.scaleX ?? binding.scaleX,
    scaleY: override?.scaleY ?? binding.scaleY,
    partId: override?.partId ?? binding.partId,
    effectivePartId: override?.partId ?? binding.partId,
    effectiveDepth: override?.depth ?? binding.depth,
    depth: override?.depth ?? binding.depth,
    visible: override?.visible ?? true,
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

export function slotDrawIndex(rig: CharacterRig, slotId: string, fallback = 0): number {
  const index = rig.drawOrder.indexOf(slotId);
  return index >= 0 ? index : fallback;
}

export function moveSlotBinding(
  rig: CharacterRig,
  slotId: string,
  dx: number,
  dy: number,
  angle: CharacterAngle = rig.activeAngle,
): CharacterRig {
  return {
    ...rig,
    slotBindings: rig.slotBindings.map((binding) => {
      if (binding.slotId !== slotId) return binding;
      if (angle !== "front") {
        const override = binding.angleOverrides?.[angle] ?? {};
        return {
          ...binding,
          angleOverrides: {
            ...binding.angleOverrides,
            [angle]: {
              ...override,
              x: (override.x ?? binding.x) + dx,
              y: (override.y ?? binding.y) + dy,
            },
          },
        };
      }
      return { ...binding, x: binding.x + dx, y: binding.y + dy };
    }),
  };
}

export function moveBone(
  rig: CharacterRig,
  boneId: string,
  dx: number,
  dy: number,
  angle: CharacterAngle = rig.activeAngle,
): CharacterRig {
  return {
    ...rig,
    bones: rig.bones.map((bone) => {
      if (bone.id !== boneId) return bone;
      if (angle !== "front") {
        const override = bone.angleOverrides?.[angle] ?? {};
        return {
          ...bone,
          angleOverrides: {
            ...bone.angleOverrides,
            [angle]: {
              ...override,
              x: (override.x ?? bone.x) + dx,
              y: (override.y ?? bone.y) + dy,
            },
          },
        };
      }
      return { ...bone, x: bone.x + dx, y: bone.y + dy };
    }),
  };
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
  return {
    ...rig,
    slotBindings: rig.slotBindings.map((binding) => {
      if (binding.slotId !== slotId) return binding;
      if (angle !== "front") {
        const override = binding.angleOverrides?.[angle] ?? {};
        return {
          ...binding,
          angleOverrides: {
            ...binding.angleOverrides,
            [angle]: { ...override, partId, visible: true },
          },
        };
      }
      return { ...binding, partId };
    }),
  };
}

export function setSlotDepth(
  rig: CharacterRig,
  slotId: string,
  depth: number,
  angle: CharacterAngle = rig.activeAngle,
): CharacterRig {
  return {
    ...rig,
    slotBindings: rig.slotBindings.map((binding) => {
      if (binding.slotId !== slotId) return binding;
      if (angle !== "front") {
        const override = binding.angleOverrides?.[angle] ?? {};
        return {
          ...binding,
          angleOverrides: {
            ...binding.angleOverrides,
            [angle]: { ...override, depth },
          },
        };
      }
      return { ...binding, depth };
    }),
  };
}

export function setBoneDepth(
  rig: CharacterRig,
  boneId: string,
  depth: number,
  angle: CharacterAngle = rig.activeAngle,
): CharacterRig {
  return {
    ...rig,
    bones: rig.bones.map((bone) => {
      if (bone.id !== boneId) return bone;
      if (angle !== "front") {
        const override = bone.angleOverrides?.[angle] ?? {};
        return {
          ...bone,
          angleOverrides: {
            ...bone.angleOverrides,
            [angle]: { ...override, depth },
          },
        };
      }
      return { ...bone, depth };
    }),
  };
}

export function slotIdsForBoneSubtree(
  rig: CharacterRig,
  boneId: string,
  angle: CharacterAngle = rig.activeAngle,
): Set<string> {
  const boneIds = new Set<string>([boneId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const bone of rig.bones) {
      if (boneIds.has(bone.id)) continue;
      if (bone.parentId && boneIds.has(bone.parentId)) {
        boneIds.add(bone.id);
        changed = true;
      }
    }
  }
  return new Set(
    rig.slotBindings
      .map((binding) => resolveSlotBinding(rig, binding.slotId, angle))
      .filter((binding): binding is ResolvedSlotBinding => !!binding)
      .filter((binding) => boneIds.has(binding.effectiveBoneId))
      .map((binding) => binding.slotId),
  );
}

export function clampHostedPartPosition(
  character: CharacterPreset,
  slotId: string,
  next: { x: number; y: number },
  angle: CharacterAngle = character.rig?.activeAngle ?? "front",
): { x: number; y: number; clamped: boolean } {
  const rig = normalizeCharacterRig(character);
  const constraint = resolveHostConstraint(rig, slotId, angle);
  if (!constraint?.hostSlotId) return { ...next, clamped: false };
  const slotPart = representativePartBySlotId(character.parts, slotId);
  const hostPart = representativePartBySlotId(character.parts, constraint.hostSlotId);
  if (!slotPart || !hostPart) return { ...next, clamped: false };

  const slotBounds = localAlphaBounds(slotPart);
  const hostBounds = localAlphaBounds(hostPart);
  const padding = constraint.padding ?? 0;
  const minX = hostPart.x + hostBounds.x + padding - slotBounds.x;
  const minY = hostPart.y + hostBounds.y + padding - slotBounds.y;
  const maxX =
    hostPart.x + hostBounds.x + hostBounds.width - padding - (slotBounds.x + slotBounds.width);
  const maxY =
    hostPart.y + hostBounds.y + hostBounds.height - padding - (slotBounds.y + slotBounds.height);
  const x = clamp(next.x, Math.min(minX, maxX), Math.max(minX, maxX));
  const y = clamp(next.y, Math.min(minY, maxY), Math.max(minY, maxY));
  return { x: Math.round(x), y: Math.round(y), clamped: x !== next.x || y !== next.y };
}

export function moveSlotParts(
  character: CharacterPreset,
  slotId: string,
  dx: number,
  dy: number,
  options: { clampToHost?: boolean } = {},
): CharacterPart[] {
  const slotParts = character.parts.filter((part) => getPartSlotId(part) === slotId);
  if (slotParts.length === 0) return character.parts;
  const representative = representativePartBySlotId(character.parts, slotId) ?? slotParts[0];
  const nextPosition = options.clampToHost
    ? clampHostedPartPosition(character, slotId, {
        x: representative.x + dx,
        y: representative.y + dy,
      })
    : { x: representative.x + dx, y: representative.y + dy };
  const appliedDx = nextPosition.x - representative.x;
  const appliedDy = nextPosition.y - representative.y;
  return character.parts.map((part) => {
    if (getPartSlotId(part) !== slotId) return part;
    const pivot = pivotForPart(part);
    return {
      ...part,
      x: part.x + appliedDx,
      y: part.y + appliedDy,
      pivot: { x: pivot.x + appliedDx, y: pivot.y + appliedDy },
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
- depth is parallax/2.5D only; drawOrder controls visual stacking.
- hostConstraints keep hosted slots inside their hosts.
- Angles are discrete in V1: front, 3qL, 3qR, sideL, sideR.
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

function representativePartBySlotId(
  parts: CharacterPart[],
  slotId: string,
): CharacterPart | undefined {
  const slotParts = parts.filter((part) => getPartSlotId(part) === slotId);
  return representativePart({
    id: slotId,
    role: slotParts[0]?.role ?? "custom",
    name: slotParts[0]?.slotName ?? "Slot",
    parts: slotParts,
  });
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
    case "mouth":
      return slotIdByRoleSide.get(roleSideKey("head"));
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

function inferHostConstraints(
  slots: SlotLike[],
  reps: Map<string, CharacterPart | undefined>,
  boneBySlot: Map<string, CharacterBone>,
): CharacterHostConstraint[] {
  const headSlot = slots.find((slot) => slot.role === "head")?.id;
  const bodySlot = slots.find((slot) => slot.role === "body")?.id;
  const out: CharacterHostConstraint[] = [];
  for (const slot of slots) {
    const part = reps.get(slot.id);
    if (!part) continue;
    let hostSlotId: string | undefined;
    if (["eye", "eyebrow", "mouth"].includes(slot.role)) hostSlotId = headSlot;
    if (slot.role === "accessory") hostSlotId = headSlot ?? bodySlot;
    if (!hostSlotId || hostSlotId === slot.id) continue;
    out.push({
      id: `constraint:${slot.id}:host`,
      slotId: slot.id,
      hostSlotId,
      hostBoneId: boneBySlot.get(hostSlotId)?.id,
      mode: "mask",
      padding: 0,
    });
  }
  return out;
}

function resolveHostConstraint(
  rig: CharacterRig,
  slotId: string,
  angle: CharacterAngle,
): CharacterHostConstraint | undefined {
  const constraint = rig.hostConstraints.find((candidate) => candidate.slotId === slotId);
  if (!constraint) return undefined;
  const override = constraint.angleOverrides?.[angle];
  return {
    ...constraint,
    hostSlotId: override?.hostSlotId ?? constraint.hostSlotId,
    hostBoneId: override?.hostBoneId ?? constraint.hostBoneId,
    mode: override?.mode ?? constraint.mode,
    padding: override?.padding ?? constraint.padding,
  };
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

function normalizeHostConstraints(
  constraints: CharacterHostConstraint[],
  slotIds: Set<string>,
  boneIds: Set<string>,
): CharacterHostConstraint[] {
  return constraints.filter((constraint) => {
    if (!constraint.id || !slotIds.has(constraint.slotId)) return false;
    if (constraint.hostSlotId && !slotIds.has(constraint.hostSlotId)) return false;
    if (constraint.hostBoneId && !boneIds.has(constraint.hostBoneId)) return false;
    return true;
  });
}

function mergeHostConstraints(
  inferred: CharacterHostConstraint[],
  source: CharacterHostConstraint[],
): CharacterHostConstraint[] {
  const out = new Map<string, CharacterHostConstraint>();
  for (const constraint of inferred) out.set(constraint.slotId, constraint);
  for (const constraint of source) out.set(constraint.slotId, constraint);
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
