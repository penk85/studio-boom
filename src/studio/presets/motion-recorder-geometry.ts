// Shared constraint and frame math for the action recorder's draft surface.
import { localAlphaBounds } from "../character/alpha-bounds";
import { faceTurnMotionForPart } from "../character/face-turn";
import {
  motionDeltaMovesJoint,
  resolveFkJointDelta,
  resolveMotionDelta,
  type MotionConstraintContext,
} from "../character/motion-constraints";
import { canvasDeltaToMotionDelta, runtimeMotionTargetForSlot } from "../character/motion-targets";
import {
  resolveRuntimePosePartFrame,
  type PartFrameTransform,
  type RuntimePartFrame,
} from "../character/part-frame";
import {
  runtimeBoneWorldTransforms,
  runtimePartPlacement,
  type CharacterRuntime,
  type RuntimePartPlacement,
} from "../character/runtime";
import { variantKeyForPart } from "../character/character-utils";
import type { CharacterPart, CharacterPreset } from "../types";
import {
  defaultOverride,
  round,
  type CharacterSlot,
  type RecorderPartState,
} from "./motion-recorder-state";

type RuntimeRig = CharacterRuntime["rig"];

export function constrainRecorderOverrides({
  character,
  rig,
  runtime,
  slots,
  overrides,
  activePartForSlot,
  basePoses,
  constraintCtx,
  allowOutOfBounds,
  faceTurnX,
  faceTurnY,
}: {
  character: CharacterPreset;
  rig: RuntimeRig;
  runtime: CharacterRuntime;
  slots: CharacterSlot[];
  overrides: Map<string, RecorderPartState>;
  activePartForSlot: (slot: CharacterSlot, poseSwap?: string) => CharacterPart | undefined;
  basePoses: Record<string, string>;
  constraintCtx: MotionConstraintContext;
  allowOutOfBounds: string[];
  faceTurnX: number;
  faceTurnY: number;
}): Map<string, RecorderPartState> {
  const out = new Map<string, RecorderPartState>();
  const activeVariants = activeVariantsForRecorderOverrides(basePoses, overrides);
  const unclampedLayers = new Set(allowOutOfBounds);
  const animatedBoneIds = animatedBoneIdsForRecorderOverrides({
    runtime,
    slots,
    overrides,
    activePartForSlot,
  });

  for (const [slotId, override] of overrides) {
    const slot = slots.find((candidate) => candidate.id === slotId);
    const part = slot ? activePartForSlot(slot, override.poseSwap) : undefined;
    if (!slot || !part) {
      out.set(slotId, override);
      continue;
    }
    const withTarget = { ...override, ...recorderMotionTargetForSlot(slot, runtime) };
    const hostClamped = clampRecorderOverrideToHost({
      character,
      runtime,
      rig,
      slots,
      overrides,
      activePartForSlot,
      slot,
      part,
      override: withTarget,
      activeVariants,
      faceTurnX,
      faceTurnY,
    });
    const fkLocked = resolveFkJointDelta({
      ctx: constraintCtx,
      boneId: hostClamped.boneId,
      slotId: slot.id,
      role: slot.role,
      dx: hostClamped.dx,
      dy: hostClamped.dy,
      animatedBoneIds,
      unclampedLayers,
    });
    const fkClamped = fkLocked.clamped
      ? { ...hostClamped, dx: round(fkLocked.dx, 1), dy: round(fkLocked.dy, 1) }
      : hostClamped;
    const limited = resolveMotionDelta({
      ctx: constraintCtx,
      slotId: slot.id,
      boneId: fkClamped.boneId,
      role: slot.role,
      activeVariants,
      dx: fkClamped.dx,
      dy: fkClamped.dy,
      rotation: fkClamped.rotation,
      unclampedLayers,
    });
    out.set(
      slotId,
      limited.clamped
        ? {
            ...fkClamped,
            dx: round(limited.dx, 1),
            dy: round(limited.dy, 1),
            rotation: round(limited.rotation, 1),
          }
        : fkClamped,
    );
  }
  return out;
}

export function activeVariantsForRecorderOverrides(
  basePoses: Record<string, string>,
  overrides: Map<string, RecorderPartState>,
): Record<string, string> {
  const activeVariants: Record<string, string> = { ...basePoses };
  for (const [slotId, override] of overrides) {
    if (override.poseSwap) activeVariants[slotId] = override.poseSwap;
  }
  return activeVariants;
}

function animatedBoneIdsForRecorderOverrides({
  runtime,
  slots,
  overrides,
  activePartForSlot,
}: {
  runtime: CharacterRuntime;
  slots: CharacterSlot[];
  overrides: Map<string, RecorderPartState>;
  activePartForSlot: (slot: CharacterSlot, poseSwap?: string) => CharacterPart | undefined;
}): Set<string> {
  const out = new Set<string>();
  for (const [slotId, override] of overrides) {
    const slot = slots.find((candidate) => candidate.id === slotId);
    const part = slot ? activePartForSlot(slot, override.poseSwap) : undefined;
    if (!slot || !part || !motionDeltaMovesJoint(override)) continue;
    const target = recorderMotionTargetForSlot(slot, runtime);
    if (target.target === "bone" && target.boneId) out.add(target.boneId);
  }
  return out;
}

export function recorderMotionTargetForSlot(
  slot: CharacterSlot,
  runtime: CharacterRuntime,
): Pick<RecorderPartState, "target" | "boneId"> {
  const target = runtimeMotionTargetForSlot(runtime, slot.id);
  return target.kind === "bone"
    ? { target: "bone", boneId: target.boneId }
    : { target: "slot", boneId: target.boneId };
}

function clampRecorderOverrideToHost({
  character,
  runtime,
  rig,
  slots,
  overrides,
  activePartForSlot,
  slot,
  part,
  override,
  activeVariants,
  faceTurnX,
  faceTurnY,
}: {
  character: CharacterPreset;
  runtime: CharacterRuntime;
  rig: RuntimeRig;
  slots: CharacterSlot[];
  overrides: Map<string, RecorderPartState>;
  activePartForSlot: (slot: CharacterSlot, poseSwap?: string) => CharacterPart | undefined;
  slot: CharacterSlot;
  part: CharacterPart;
  override: RecorderPartState;
  activeVariants: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
  faceTurnX: number;
  faceTurnY: number;
}): RecorderPartState {
  const constraint = rig.hostConstraints.find((entry) => entry.slotId === slot.id);
  if (
    !constraint?.hostSlotId ||
    constraint.hostSlotId === slot.id ||
    constraint.mode === "reach" ||
    constraint.reachPolicy === "allow"
  ) {
    return override;
  }

  const hostSlot = slots.find((candidate) => candidate.id === constraint.hostSlotId);
  const hostOverride = hostSlot ? overrides.get(hostSlot.id) : undefined;
  const hostPart = hostSlot ? activePartForSlot(hostSlot, hostOverride?.poseSwap) : undefined;
  if (!hostSlot || !hostPart) return override;

  const worldByBone = runtimeBoneWorldTransforms(runtime, activeVariants);
  const hostBounds = recorderPartFrame(
    hostSlot,
    hostPart,
    hostOverride ?? defaultOverride(hostSlot.id, hostPart),
    runtime,
    overrides,
    activePartForSlot,
    faceTurnX,
    faceTurnY,
    character.canvasWidth,
    character.canvasHeight,
    activeVariants,
    worldByBone,
    recorderPartPlacement(hostSlot, hostPart, runtime, activeVariants, worldByBone),
  ).bounds;
  const subjectBounds = recorderPartFrame(
    slot,
    part,
    override,
    runtime,
    overrides,
    activePartForSlot,
    faceTurnX,
    faceTurnY,
    character.canvasWidth,
    character.canvasHeight,
    activeVariants,
    worldByBone,
    recorderPartPlacement(slot, part, runtime, activeVariants, worldByBone),
  ).bounds;
  let canvasDx = 0;
  let canvasDy = 0;

  if (subjectBounds.right - subjectBounds.left > hostBounds.right - hostBounds.left) {
    const subjectCenter = (subjectBounds.left + subjectBounds.right) / 2;
    const hostCenter = (hostBounds.left + hostBounds.right) / 2;
    canvasDx += hostCenter - subjectCenter;
  } else {
    if (subjectBounds.left < hostBounds.left) canvasDx += hostBounds.left - subjectBounds.left;
    if (subjectBounds.right > hostBounds.right) canvasDx -= subjectBounds.right - hostBounds.right;
  }

  if (subjectBounds.bottom - subjectBounds.top > hostBounds.bottom - hostBounds.top) {
    const subjectCenter = (subjectBounds.top + subjectBounds.bottom) / 2;
    const hostCenter = (hostBounds.top + hostBounds.bottom) / 2;
    canvasDy += hostCenter - subjectCenter;
  } else {
    if (subjectBounds.top < hostBounds.top) canvasDy += hostBounds.top - subjectBounds.top;
    if (subjectBounds.bottom > hostBounds.bottom) {
      canvasDy -= subjectBounds.bottom - hostBounds.bottom;
    }
  }

  if (canvasDx === 0 && canvasDy === 0) return override;
  const correction = canvasDeltaToMotionDelta(
    runtime,
    runtimeMotionTargetForSlot(runtime, slot.id),
    { x: canvasDx, y: canvasDy },
    worldByBone,
  );
  return {
    ...override,
    dx: Math.round(override.dx + correction.x),
    dy: Math.round(override.dy + correction.y),
  };
}

export function recorderPartPlacement(
  slot: CharacterSlot,
  part: CharacterPart,
  runtime: CharacterRuntime,
  activeVariants?: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
  worldByBone?: CharacterRuntime["worldByBone"],
): RuntimePartPlacement {
  return runtimePartPlacement(slot, part, runtime, {
    poseKey: variantKeyForPart(part),
    activeVariants,
    worldByBone,
  });
}

export function recorderPartFrame(
  slot: CharacterSlot,
  part: CharacterPart,
  override: RecorderPartState,
  runtime: CharacterRuntime,
  overrides: ReadonlyMap<string, RecorderPartState>,
  activePartForSlot: (slot: CharacterSlot, poseSwap?: string) => CharacterPart | undefined,
  faceTurnX: number,
  faceTurnY: number,
  canvasWidth: number,
  canvasHeight: number,
  activeVariants: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
  worldByBone: CharacterRuntime["worldByBone"],
  placement = recorderPartPlacement(slot, part, runtime, activeVariants, worldByBone),
): RuntimePartFrame {
  const target = runtimeMotionTargetForSlot(runtime, slot.id);
  const transform = recorderFrameTransform(
    part,
    override,
    runtime,
    target,
    worldByBone,
    faceTurnX,
    faceTurnY,
    canvasWidth,
    canvasHeight,
  );
  return resolveRuntimePosePartFrame({
    slotId: slot.id,
    resolveTransformForSlot: (ancestorSlotId) => {
      const ancestorSlot = runtime.slotById.get(ancestorSlotId);
      if (!ancestorSlot) return undefined;
      const ancestorOverride = overrides.get(ancestorSlotId);
      const ancestorPart = activePartForSlot(ancestorSlot, ancestorOverride?.poseSwap);
      if (!ancestorPart) return undefined;
      return recorderFrameTransform(
        ancestorPart,
        ancestorOverride ?? defaultOverride(ancestorSlotId, ancestorPart),
        runtime,
        runtimeMotionTargetForSlot(runtime, ancestorSlotId),
        worldByBone,
        faceTurnX,
        faceTurnY,
        canvasWidth,
        canvasHeight,
      );
    },
    part,
    placement,
    runtime,
    target,
    localBounds: localAlphaBounds(part),
    transform,
    worldByBone,
  });
}

function recorderFrameTransform(
  part: CharacterPart,
  override: RecorderPartState,
  runtime: CharacterRuntime,
  target: ReturnType<typeof runtimeMotionTargetForSlot>,
  worldByBone: CharacterRuntime["worldByBone"],
  faceTurnX: number,
  faceTurnY: number,
  canvasWidth: number,
  canvasHeight: number,
): PartFrameTransform {
  const turn = faceTurnMotionForPart(part, faceTurnX, canvasWidth, faceTurnY, canvasHeight);
  const turnDelta = canvasDeltaToMotionDelta(
    runtime,
    target,
    { x: turn.dx, y: turn.dy },
    worldByBone,
  );
  return {
    dx: override.dx + turnDelta.x,
    dy: override.dy + turnDelta.y,
    rotation: override.rotation + turn.rotation,
    scaleX: override.scale * override.scaleX * turn.scaleX,
    scaleY: override.scale * override.scaleY * turn.scaleY,
    skewX: override.skewX + turn.skewX,
    skewY: override.skewY + turn.skewY,
    originX: override.originX,
    originY: override.originY,
  };
}
