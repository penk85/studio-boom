import type {
  CharacterBone,
  CharacterIkConstraint,
  CharacterPart,
  CharacterReach,
  CharacterSlotBinding,
  CharacterSlotVariantPackage,
  PartRole,
} from "../types";
import { clampMotionDeltaToReach } from "./rig";
import { variantKeyForPackage } from "./character-utils";

/**
 * Single boundary for character movement constraints. Every consumer that applies a motion delta
 * to a character layer — the compiled GSAP timeline, the motion editor's interactive edits, and
 * any future stage-level posing — must resolve the delta through this module so the rig's reach
 * and rotation clipping cannot be bypassed by one call site drifting out of sync with the others.
 */

export type ClampReason = "dx" | "dy" | "rotation";
export type EffectiveReachSource = "slotRotReach" | "variantRotationLimits" | "none";

/** Active variant selection per slot (slotId → variant key), e.g. a motion frame's slot states. */
export type ActiveVariantMap = ReadonlyMap<string, string> | Readonly<Record<string, string>>;

const FK_JOINT_LOCK_ROLES = new Set<PartRole>([
  "head",
  "body",
  "arm",
  "upperArm",
  "lowerArm",
  "hand",
  "leg",
  "upperLeg",
  "lowerLeg",
  "foot",
  "hair",
  "accessory",
  "custom",
]);

export interface MotionConstraintContext {
  reachBySlot: Map<string, CharacterReach>;
  /** slotId → variantKey → rotation limits from that variant's rig package bones. */
  variantRotationLimitsBySlot: Map<string, Map<string, { min: number; max: number }>>;
  /** child bone id → parent bone id. Used to keep FK joints locked during motion playback. */
  parentBoneByBone: Map<string, string>;
  /** Rest local transforms used by the deterministic composition-time IK solve. */
  boneById: Map<string, CharacterBone>;
  ikConstraints: CharacterIkConstraint[];
}

export function buildMotionConstraintContext(args: {
  reaches: CharacterReach[];
  variantPackages?: CharacterSlotVariantPackage[];
  parts?: CharacterPart[];
  bones?: CharacterBone[];
  ikConstraints?: CharacterIkConstraint[];
}): MotionConstraintContext {
  const reachBySlot = new Map(args.reaches.map((reach) => [reach.slotId, reach]));
  const variantRotationLimitsBySlot = new Map<string, Map<string, { min: number; max: number }>>();
  const parentBoneByBone = new Map<string, string>();
  for (const bone of args.bones ?? []) {
    if (bone.parentId) parentBoneByBone.set(bone.id, bone.parentId);
  }
  for (const pkg of args.variantPackages ?? []) {
    const limits = rotationLimitsForPackage(pkg);
    if (!limits) continue;
    const key = variantKeyForPackage(pkg, args.parts);
    const bySlot =
      variantRotationLimitsBySlot.get(pkg.slotId) ??
      new Map<string, { min: number; max: number }>();
    bySlot.set(key, limits);
    variantRotationLimitsBySlot.set(pkg.slotId, bySlot);
  }
  return {
    reachBySlot,
    variantRotationLimitsBySlot,
    parentBoneByBone,
    boneById: new Map((args.bones ?? []).map((bone) => [bone.id, bone])),
    ikConstraints: args.ikConstraints ?? [],
  };
}

/**
 * The single rotation-constraint vocabulary: the slot's authored `rotReach`, overridden by the
 * active variant's bone `rotationLimits` while that variant is selected (a closed fist may twist
 * further than an open hand). Takes the full active-variant map so future resolution may consult
 * parent-slot or relation-gated variants without changing the signature.
 */
export function effectiveReachForSlot(
  ctx: MotionConstraintContext,
  slotId: string,
  activeVariants?: ActiveVariantMap,
): { reach: CharacterReach | undefined; source: EffectiveReachSource } {
  const slotReach = ctx.reachBySlot.get(slotId);
  const activeKey = activeVariantFor(activeVariants, slotId);
  const variantLimits = activeKey
    ? ctx.variantRotationLimitsBySlot.get(slotId)?.get(activeKey)
    : undefined;
  if (variantLimits) {
    return {
      reach: { ...(slotReach ?? { id: `reach:${slotId}`, slotId }), rotReach: variantLimits },
      source: "variantRotationLimits",
    };
  }
  if (slotReach?.rotReach || (slotReach?.reach && slotReach.reach.length >= 3)) {
    return { reach: slotReach, source: "slotRotReach" };
  }
  return { reach: slotReach, source: "none" };
}

export interface ResolvedMotionDelta {
  dx: number;
  dy: number;
  rotation: number;
  clamped: boolean;
  clampReasons?: ClampReason[];
  effectiveReachSource: EffectiveReachSource;
}

export interface MotionDeltaLike {
  dx: number;
  dy: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  skewX?: number;
  skewY?: number;
  rotation: number;
  rotationX?: number;
  rotationY?: number;
}

/**
 * Tone a raw motion delta down to the layer's effective reach (drift polygon + twist range),
 * honoring the per-movement "allow out of bounds" escape hatch. `unclampedLayers` may contain
 * slot ids or roles, matching the compiled-timeline semantics.
 */
export function resolveMotionDelta(args: {
  ctx: MotionConstraintContext;
  slotId: string;
  boneId?: string;
  role?: string;
  activeVariants?: ActiveVariantMap;
  dx: number;
  dy: number;
  rotation: number;
  unclampedLayers?: ReadonlySet<string>;
  control?: boolean;
}): ResolvedMotionDelta {
  if (args.control) {
    return {
      dx: args.dx,
      dy: args.dy,
      rotation: args.rotation,
      clamped: false,
      effectiveReachSource: "none",
    };
  }
  const { reach, source } = effectiveReachForSlot(args.ctx, args.slotId, args.activeVariants);
  const overridden =
    !!args.unclampedLayers &&
    (args.unclampedLayers.has(args.slotId) ||
      (!!args.boneId && args.unclampedLayers.has(args.boneId)) ||
      (!!args.role && args.unclampedLayers.has(args.role)));
  if (overridden || !reach) {
    return {
      dx: args.dx,
      dy: args.dy,
      rotation: args.rotation,
      clamped: false,
      effectiveReachSource: source,
    };
  }
  const limited = clampMotionDeltaToReach(reach, args.dx, args.dy, args.rotation);
  const clampReasons: ClampReason[] = [];
  if (limited.dx !== args.dx) clampReasons.push("dx");
  if (limited.dy !== args.dy) clampReasons.push("dy");
  if (limited.rotation !== args.rotation) clampReasons.push("rotation");
  return {
    dx: limited.dx,
    dy: limited.dy,
    rotation: limited.rotation,
    clamped: limited.clamped,
    ...(clampReasons.length ? { clampReasons } : {}),
    effectiveReachSource: source,
  };
}

export interface ResolvedFkJointDelta {
  dx: number;
  dy: number;
  clamped: boolean;
  ancestorBoneId?: string;
}

/**
 * Enforce FK joint locking for existing/bad presets that slipped through validation. If a child
 * bone and one of its ancestors are both animated, the child may still rotate/scale locally, but
 * child dx/dy would slide the authored joint socket away from the parent. Clamp that translation
 * to zero unless the movement explicitly opts the slot/bone/role out of bounds.
 */
export function resolveFkJointDelta(args: {
  ctx: MotionConstraintContext;
  boneId?: string;
  slotId: string;
  role?: string;
  dx: number;
  dy: number;
  animatedBoneIds: ReadonlySet<string>;
  unclampedLayers?: ReadonlySet<string>;
  control?: boolean;
}): ResolvedFkJointDelta {
  if (args.control) return { dx: args.dx, dy: args.dy, clamped: false };
  const overridden =
    !!args.unclampedLayers &&
    (args.unclampedLayers.has(args.slotId) ||
      (!!args.boneId && args.unclampedLayers.has(args.boneId)) ||
      (!!args.role && args.unclampedLayers.has(args.role)));
  if (overridden || !args.boneId || (!args.dx && !args.dy)) {
    return { dx: args.dx, dy: args.dy, clamped: false };
  }
  if (!roleUsesFkJointLock(args.role)) {
    return { dx: args.dx, dy: args.dy, clamped: false };
  }
  const ancestorBoneId = ancestorBoneIds(args.ctx, args.boneId).find((id) =>
    args.animatedBoneIds.has(id),
  );
  if (!ancestorBoneId) return { dx: args.dx, dy: args.dy, clamped: false };
  return { dx: 0, dy: 0, clamped: true, ancestorBoneId };
}

export function motionDeltaMovesJoint(delta: MotionDeltaLike): boolean {
  return (
    Math.abs(delta.dx) > 0.0001 ||
    Math.abs(delta.dy) > 0.0001 ||
    Math.abs(delta.rotation) > 0.0001 ||
    Math.abs(delta.rotationX ?? 0) > 0.0001 ||
    Math.abs(delta.rotationY ?? 0) > 0.0001 ||
    Math.abs((delta.scale ?? 1) - 1) > 0.0001 ||
    Math.abs((delta.scaleX ?? 1) - 1) > 0.0001 ||
    Math.abs((delta.scaleY ?? 1) - 1) > 0.0001 ||
    Math.abs(delta.skewX ?? 0) > 0.0001 ||
    Math.abs(delta.skewY ?? 0) > 0.0001
  );
}

/** The slot whose variant selection re-anchors this bone: the slot bound to the parent bone. */
export function parentSlotIdForBone(
  rig: { bones: CharacterBone[]; slotBindings: CharacterSlotBinding[] },
  boneId: string,
): string | undefined {
  const bone = rig.bones.find((candidate) => candidate.id === boneId);
  if (bone?.restSource) return bone.restSource.slotId;
  if (!bone?.parentId) return undefined;
  return rig.slotBindings.find((binding) => binding.boneId === bone.parentId)?.slotId;
}

function activeVariantFor(map: ActiveVariantMap | undefined, slotId: string): string | undefined {
  if (!map) return undefined;
  if (map instanceof Map) return map.get(slotId);
  return (map as Readonly<Record<string, string>>)[slotId];
}

function ancestorBoneIds(ctx: MotionConstraintContext, boneId: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let current = ctx.parentBoneByBone.get(boneId);
  while (current && !seen.has(current)) {
    seen.add(current);
    out.push(current);
    current = ctx.parentBoneByBone.get(current);
  }
  return out;
}

function roleUsesFkJointLock(role: string | undefined): boolean {
  if (!role) return true;
  return FK_JOINT_LOCK_ROLES.has(role as PartRole);
}

function rotationLimitsForPackage(
  pkg: CharacterSlotVariantPackage,
): { min: number; max: number } | undefined {
  const bone = pkg.rig?.bones?.find((candidate) => candidate.rotationLimits);
  const limits = bone?.rotationLimits;
  if (!limits) return undefined;
  const [a, b] = limits;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}
