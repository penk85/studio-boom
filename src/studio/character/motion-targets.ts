import type { PartRole, RecordedPartOverride } from "../types";
import { rotateVector, type Point } from "./geometry";
import type { CharacterRuntime } from "./runtime";
import type { BoneWorldTransform } from "./rig";

export type RuntimeMotionTarget =
  | { kind: "slot"; slotId: string; boneId?: string }
  | { kind: "bone"; slotId: string; boneId: string };

export function runtimeMotionTargetForSlot(
  runtime: CharacterRuntime,
  slotId: string,
): RuntimeMotionTarget {
  const renderedInsideParentArtwork = runtime.angleRig.slotRelations.some(
    (relation) =>
      relation.childSlotId === slotId &&
      relation.renderMode === "nested" &&
      (!relation.characterViewIds?.length || relation.characterViewIds.includes(runtime.angle)),
  );
  const binding = runtime.bindingBySlot.get(slotId);
  if (renderedInsideParentArtwork) {
    return { kind: "slot", slotId, boneId: binding?.effectiveBoneId };
  }
  if (binding && runtime.parentBoneIds.has(binding.effectiveBoneId)) {
    return { kind: "bone", slotId, boneId: binding.effectiveBoneId };
  }
  return { kind: "slot", slotId, boneId: binding?.effectiveBoneId };
}

export function recordedOverrideTargetKey(part: RecordedPartOverride): string {
  if (part.target === "bone" && part.boneId) return `bone:${part.boneId}`;
  if (part.slotId) return `slot:${part.slotId}`;
  return `role:${part.partRole}`;
}

export function recordedOverrideTarget(
  target: RuntimeMotionTarget,
  partRole: PartRole,
): Pick<RecordedPartOverride, "target" | "boneId" | "slotId" | "partRole"> {
  return target.kind === "bone"
    ? {
        target: "bone",
        boneId: target.boneId,
        slotId: target.slotId,
        partRole,
      }
    : { target: "slot", slotId: target.slotId, partRole };
}

/**
 * Resolve an override back to one active-angle slot. Explicit identities are strict. A role-only
 * override is accepted only when the role is unambiguous, so semantic presets remain possible
 * without silently choosing the wrong left/right limb.
 */
export function slotIdForRecordedOverride(
  runtime: CharacterRuntime,
  override: RecordedPartOverride,
): string | undefined {
  if (override.slotId) {
    if (!runtime.slotById.has(override.slotId)) return undefined;
    if (override.target === "bone" && override.boneId) {
      const binding = runtime.bindingBySlot.get(override.slotId);
      if (binding?.effectiveBoneId !== override.boneId) return undefined;
    }
    return override.slotId;
  }
  if (override.target === "bone" && override.boneId) {
    const matches = runtime.slots.filter(
      (slot) => runtime.bindingBySlot.get(slot.id)?.effectiveBoneId === override.boneId,
    );
    return matches.length === 1 ? matches[0].id : undefined;
  }
  const roleMatches = runtime.slots.filter((slot) => slot.role === override.partRole);
  return roleMatches.length === 1 ? roleMatches[0].id : undefined;
}

export function canvasDeltaToMotionDelta(
  runtime: CharacterRuntime,
  target: RuntimeMotionTarget,
  canvasDelta: Point,
  worldByBone: ReadonlyMap<string, BoneWorldTransform> = runtime.worldByBone,
): Point {
  return rotateVector(canvasDelta, -motionParentWorldRotation(runtime, target, worldByBone));
}

export function motionDeltaToCanvasDelta(
  runtime: CharacterRuntime,
  target: RuntimeMotionTarget,
  motionDelta: Point,
  worldByBone: ReadonlyMap<string, BoneWorldTransform> = runtime.worldByBone,
): Point {
  return rotateVector(motionDelta, motionParentWorldRotation(runtime, target, worldByBone));
}

export function motionTargetPivot(
  runtime: CharacterRuntime,
  target: RuntimeMotionTarget,
  worldByBone: ReadonlyMap<string, BoneWorldTransform> = runtime.worldByBone,
): Point | undefined {
  if (target.kind !== "bone") return undefined;
  const bone = worldByBone.get(target.boneId);
  return bone ? { x: bone.x, y: bone.y } : undefined;
}

/**
 * Primary motion targets inherited by a slot through the bone hierarchy, ordered root-first.
 * Nested artwork (iris inside eye) and FK children (hand below arm) both use this same chain.
 */
export function runtimeAncestorMotionTargets(
  runtime: CharacterRuntime,
  slotId: string,
): RuntimeMotionTarget[] {
  const binding = runtime.bindingBySlot.get(slotId);
  if (!binding) return [];
  const slotsByBone = new Map<string, string>();
  for (const [candidateSlotId, candidateBinding] of runtime.bindingBySlot) {
    if (!slotsByBone.has(candidateBinding.effectiveBoneId)) {
      slotsByBone.set(candidateBinding.effectiveBoneId, candidateSlotId);
    }
  }

  const boneIds: string[] = [];
  const seen = new Set<string>();
  let boneId = runtime.boneById.get(binding.effectiveBoneId)?.parentId;
  while (boneId && !seen.has(boneId)) {
    seen.add(boneId);
    boneIds.push(boneId);
    boneId = runtime.boneById.get(boneId)?.parentId;
  }

  return boneIds
    .reverse()
    .map((ancestorBoneId) => {
      const ancestorSlotId = slotsByBone.get(ancestorBoneId);
      if (!ancestorSlotId) return undefined;
      const target = runtimeMotionTargetForSlot(runtime, ancestorSlotId);
      return target.kind === "bone" && target.boneId === ancestorBoneId ? target : undefined;
    })
    .filter((target): target is RuntimeMotionTarget => !!target);
}

function motionParentWorldRotation(
  runtime: CharacterRuntime,
  target: RuntimeMotionTarget,
  worldByBone: ReadonlyMap<string, BoneWorldTransform>,
): number {
  if (target.kind === "slot") {
    const boneId = runtime.bindingBySlot.get(target.slotId)?.effectiveBoneId;
    return boneId ? (worldByBone.get(boneId)?.rotation ?? 0) : 0;
  }
  const parentId = runtime.boneById.get(target.boneId)?.parentId;
  return parentId ? (worldByBone.get(parentId)?.rotation ?? 0) : 0;
}
