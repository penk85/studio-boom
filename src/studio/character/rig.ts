import type {
  CharacterAngle,
  CharacterBone,
  CharacterPart,
  CharacterPreset,
  CharacterReach,
  CharacterRig,
  CharacterSlotBinding,
  ID,
  PartRole,
} from "../types";
import { getPartSlotId, listCharacterSlots, roleLabel } from "./character-utils";
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
  const reaches = normalizeReaches(source.reaches ?? [], new Set(bindingsBySlot.keys()));

  const rig: CharacterRig = {
    version: 1,
    activeAngle: CHARACTER_ANGLES.includes(source.activeAngle) ? source.activeAngle : "front",
    bones: Array.from(bonesById.values()),
    slotBindings: Array.from(bindingsBySlot.values()),
    drawOrder,
    reaches,
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
    const x = Math.round(pivot.x - parentPivot.x);
    const y = Math.round(pivot.y - parentPivot.y);
    const length = Math.round(Math.hypot(part.width, part.height) * 0.5);
    boneBySlot.set(slot.id, {
      id: `bone:${slot.id}`,
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
    reaches: [],
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
  for (const reach of rig.reaches) {
    if (!bindingSlots.has(reach.slotId)) {
      errors.push(`Reach "${reach.id}" references missing slot "${reach.slotId}".`);
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

/** Create or update a slot's reach record. */
function upsertSlotReach(
  rig: CharacterRig,
  slotId: ID,
  patch: Partial<Pick<CharacterReach, "reach" | "rotReach">>,
): CharacterRig {
  const existing = rig.reaches.find((entry) => entry.slotId === slotId);
  const base: CharacterReach = existing ?? { id: `reach:${slotId}`, slotId };
  const next: CharacterReach = { ...base, ...patch };
  const others = rig.reaches.filter((entry) => entry.slotId !== slotId);
  return { ...rig, reaches: [...others, next] };
}

/**
 * Set or clear a slot's traced movement reach (parent-frame offsets from its rest position).
 * Fewer than three points clears it.
 */
export function setSlotReach(
  rig: CharacterRig,
  slotId: ID,
  reach: { x: number; y: number }[] | undefined,
): CharacterRig {
  return upsertSlotReach(rig, slotId, {
    reach: reach && reach.length >= 3 ? reach : undefined,
  });
}

/** Set or clear a slot's rotation reach — how far it may twist from rest, in degrees. */
export function setSlotRotReach(
  rig: CharacterRig,
  slotId: ID,
  rotReach: { min: number; max: number } | undefined,
): CharacterRig {
  const next =
    rotReach && (rotReach.min !== 0 || rotReach.max !== 0)
      ? { min: Math.round(Math.min(0, rotReach.min)), max: Math.round(Math.max(0, rotReach.max)) }
      : undefined;
  return upsertSlotReach(rig, slotId, { rotReach: next });
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
- depth is parallax/2.5D only; drawOrder controls visual stacking.
- reaches[] limit how far a slot may drift/twist from its parent (movement guides).
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
