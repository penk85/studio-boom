import type {
  CharacterBone,
  CharacterPart,
  CharacterReach,
  CharacterSlotBinding,
  CharacterSlotVariantPackage,
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

export interface MotionConstraintContext {
  reachBySlot: Map<string, CharacterReach>;
  /** slotId → variantKey → rotation limits from that variant's rig package bones. */
  variantRotationLimitsBySlot: Map<string, Map<string, { min: number; max: number }>>;
}

export function buildMotionConstraintContext(args: {
  reaches: CharacterReach[];
  variantPackages?: CharacterSlotVariantPackage[];
  parts?: CharacterPart[];
}): MotionConstraintContext {
  const reachBySlot = new Map(args.reaches.map((reach) => [reach.slotId, reach]));
  const variantRotationLimitsBySlot = new Map<string, Map<string, { min: number; max: number }>>();
  for (const pkg of args.variantPackages ?? []) {
    const limits = rotationLimitsForPackage(pkg);
    if (!limits) continue;
    const key = variantKeyForPackage(pkg, args.parts);
    const bySlot =
      variantRotationLimitsBySlot.get(pkg.slotId) ?? new Map<string, { min: number; max: number }>();
    bySlot.set(key, limits);
    variantRotationLimitsBySlot.set(pkg.slotId, bySlot);
  }
  return { reachBySlot, variantRotationLimitsBySlot };
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

/**
 * Tone a raw motion delta down to the layer's effective reach (drift polygon + twist range),
 * honoring the per-movement "allow out of bounds" escape hatch. `unclampedLayers` may contain
 * slot ids or roles, matching the compiled-timeline semantics.
 */
export function resolveMotionDelta(args: {
  ctx: MotionConstraintContext;
  slotId: string;
  role?: string;
  activeVariants?: ActiveVariantMap;
  dx: number;
  dy: number;
  rotation: number;
  unclampedLayers?: ReadonlySet<string>;
}): ResolvedMotionDelta {
  const { reach, source } = effectiveReachForSlot(args.ctx, args.slotId, args.activeVariants);
  const overridden =
    !!args.unclampedLayers &&
    (args.unclampedLayers.has(args.slotId) || (!!args.role && args.unclampedLayers.has(args.role)));
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

/**
 * The bone's local rest anchor and rotation while the parent slot shows variant
 * `parentVariantKey` — how a bent-arm variant carries the hand to its new wrist (and angles it).
 * Falls back to the bone's base x/y/rotation.
 */
export function childAnchorForVariant(
  bone: Pick<CharacterBone, "x" | "y" | "rotation" | "parentVariantAnchors">,
  parentVariantKey: string | undefined,
): { x: number; y: number; rotation: number } {
  const anchor = parentVariantKey ? bone.parentVariantAnchors?.[parentVariantKey] : undefined;
  return {
    x: anchor?.x ?? bone.x,
    y: anchor?.y ?? bone.y,
    rotation: anchor?.rotation ?? bone.rotation,
  };
}

/** The slot whose variant selection re-anchors this bone: the slot bound to the parent bone. */
export function parentSlotIdForBone(
  rig: { bones: CharacterBone[]; slotBindings: CharacterSlotBinding[] },
  boneId: string,
): string | undefined {
  const bone = rig.bones.find((candidate) => candidate.id === boneId);
  if (!bone?.parentId) return undefined;
  return rig.slotBindings.find((binding) => binding.boneId === bone.parentId)?.slotId;
}

function activeVariantFor(map: ActiveVariantMap | undefined, slotId: string): string | undefined {
  if (!map) return undefined;
  if (map instanceof Map) return map.get(slotId);
  return (map as Readonly<Record<string, string>>)[slotId];
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
