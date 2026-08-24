import type {
  CharacterClipMeta,
  CharacterPart,
  CharacterPreset,
  CharacterIkConstraint,
  CharacterSlotRelation,
  MediaAsset,
  MotionPreset,
  MouthViseme,
  PartRole,
  VisemeEntry,
} from "../types";
import { characterSpeeches } from "../types";
import {
  composeMotionsAt,
  deltaForBone,
  deltaForBoneOnly,
  deltaFor,
  emptyDelta,
  generateMotionOccurrences,
  motionAppliesToAngle,
  poseSwapFor,
} from "../presets/apply";
import {
  anchorPartForVariant,
  partMatchesVariant,
  pivotAlignedPartOffset,
  variantAliasesForPart,
  variantKeyForPart,
} from "./character-utils";
import { faceTurnMotionForPart } from "./face-turn";
import {
  autoBlinkPoseSwapAt,
  blinkWindowsForClip,
  eyeVariantsForSlot,
  resolveEyeState,
} from "./eye-state";
import {
  representativePart,
  resolveSlotBinding,
  slotDrawIndex,
  type ResolvedSlotBinding,
} from "./rig";
import {
  motionDeltaMovesJoint,
  resolveFkJointDelta,
  resolveMotionDelta,
  type MotionConstraintContext,
} from "./motion-constraints";
import {
  buildCharacterRuntime,
  resolveRuntimeSlotPart,
  type CharacterRuntime,
  type RuntimeCharacterSlot,
} from "./runtime";
import { runtimeMotionTargetForSlot } from "./motion-targets";
import { solveTwoBoneIk } from "./ik";
import { pinTransformInBoneSpace, registrationForPart } from "./registration";
import { assertCharacterPinRigReadyForAngle } from "./rig-v2";
import {
  buildPixiCharacterCompositionHtml,
  type PixiCharacterAudioSpeech,
} from "./pixi-composition";
import {
  buildCharacterScene,
  characterSceneBoneNodeId,
  characterScenePartNodeId,
  characterSceneSlotNodeId,
  type CharacterSceneGraph,
} from "./scene";
import type {
  CharacterTimelineScene,
  CharacterTimelineSlotEvent,
  CharacterTimelineTarget,
  CharacterTimelineVars,
} from "./timeline-scene";

const VISEMES: MouthViseme[] = ["rest", "A", "E", "O", "U", "MBP", "FV", "L", "WQ", "Smile"];
// Character motion is baked into a deterministic seekable payload. Sampling at
// standard video cadence keeps eased/elastic motion smooth when Pixi linearly
// interpolates between samples without introducing an async runtime clock.
const MOTION_SAMPLE_FPS = 30;

type CharacterSlotRef = RuntimeCharacterSlot;
type RuntimeRig = CharacterRuntime["rig"];

interface NestedSlotChild {
  slot: CharacterSlotRef;
  relation: CharacterSlotRelation;
}

export interface BuildCharacterCompositionArgs {
  compositionId: string;
  clipId: string;
  width: number;
  height: number;
  duration: number;
  character: CharacterPreset;
  meta: CharacterClipMeta;
  motionPresets: Map<string, MotionPreset>;
  /** Speeches placed on the character, resolved against their audio assets. Each
   *  emits an `<audio>` at its start and contributes offset visemes to the mouth.
   *  When omitted, falls back to the legacy single `meta.lipSyncAudioId`. */
  speeches?: ResolvedSpeech[];
  mediaAssets?: ReadonlyMap<string, Pick<MediaAsset, "filename" | "mimeType">>;
  /** @deprecated Legacy single-speech length; superseded by `speeches`. */
  speechDuration?: number;
}

export interface CharacterRenderPayload {
  compositionId: string;
  clipId: string;
  width: number;
  height: number;
  duration: number;
  character: CharacterPreset;
  meta: CharacterClipMeta;
  scene: CharacterSceneGraph;
  timelineScene: CharacterTimelineScene;
  audioSpeeches: PixiCharacterAudioSpeech[];
}

/** A speech resolved for the builder: audio ref + start + length + its viseme track. */
export interface ResolvedSpeech {
  audioId: string;
  start: number;
  duration: number;
  visemes: VisemeEntry[];
  /** Playback volume, 0–1 (default 1). */
  volume?: number;
  /** In-point into the source audio in seconds (trim start; default 0). */
  mediaStartTime?: number;
}

interface MotionTarget {
  kind: "slot" | "bone";
  /** Whether semantic role/slot motion is routed here. Exact bone motion always remains valid. */
  acceptsSlotMotion: boolean;
  id: string;
  selector: string;
  boneId?: string;
  slotId: string;
  role: PartRole;
  controlKind?: "pelvis" | "ikTarget";
  basePart?: CharacterPart;
  defaultVariantKey?: string;
  variantParts?: Record<string, CharacterPart>;
  /**
   * The binding's representative part for bone-bound variant slots. When present, variant art is
   * pivot-aligned to the joint, so motion transform origins must use the same placement math
   * instead of authored canvas offsets.
   */
  referencePart?: CharacterPart;
  baseRotation: number;
  baseAnchorX: number;
  baseAnchorY: number;
  depth?: number;
  /**
   * For bone targets whose rest rotation depends on the parent slot's active variant: motion
   * rotation vars are absolute, so the per-frame base must follow the variant or the first
   * motion tween would stomp the swap's rotation.
   */
  anchorParentSlotId?: string;
  anchorRotations?: Record<string, number>;
}

interface SlotTimeline {
  slotId: string;
  role: PartRole;
  hostSlotId?: string;
  defaultKey: string;
  render: SlotRenderStrategy;
  parentVariantGate?: {
    parentSlotId: string;
    keys: string[];
  };
}

interface VariantSlotRender {
  kind: "variant";
  variants: Record<string, string[]>;
  sceneVariants?: Record<string, string[]>;
}

type SlotRenderStrategy = VariantSlotRender;

type GsapVars = CharacterTimelineVars;

interface CharacterTimelineInputs {
  motionTargets: MotionTarget[];
  slotTimelines: SlotTimeline[];
  boneAnchorTimelines: BoneAnchorTimeline[];
}

/**
 * A child bone whose rest anchor depends on its parent slot's active variant (a bent arm carries
 * the hand, and may angle it). Values are stage-scaled CSS left/top plus the bone's absolute
 * rest rotation in degrees, keyed by every alias of each parent variant.
 */
interface BoneAnchorTimeline {
  parentSlotId: string;
  selector: string;
  sceneNodeId: string;
  boneId: string;
  base: { left: number; top: number; rotation: number };
  /** Rest anchor under the initially active parent variant — the baked style left/top/rotate. */
  initial: { left: number; top: number; rotation: number };
  anchors: Record<string, { left: number; top: number; rotation: number }>;
}

export function defaultCharacterCompositionId(clipId: string): string {
  return `char_${clipId}`;
}

export function characterAssetIds(
  character: CharacterPreset | null | undefined,
  meta?: CharacterClipMeta,
): Set<string> {
  const ids = new Set<string>();
  if (character) {
    for (const part of character.parts) ids.add(part.mediaId);
    for (const variant of character.headVariants ?? []) ids.add(variant.mediaId);
    for (const variant of character.variantPackages ?? []) {
      for (const layer of variant.artwork?.layers ?? []) {
        if (layer.mediaId) ids.add(layer.mediaId);
      }
    }
  }
  for (const speech of characterSpeeches(meta)) ids.add(speech.audioId);
  return ids;
}

export function buildCharacterCompositionHtml(args: BuildCharacterCompositionArgs): string {
  const payload = buildCharacterRenderPayload(args);
  return buildPixiCharacterCompositionHtml({
    ...args,
    width: payload.width,
    height: payload.height,
    duration: payload.duration,
    character: payload.character,
    meta: payload.meta,
    scene: payload.scene,
    timelineScene: payload.timelineScene,
    audioSpeeches: payload.audioSpeeches,
  });
}

export function buildCharacterRenderPayload(
  args: BuildCharacterCompositionArgs,
): CharacterRenderPayload {
  const width = positiveNumber(args.width, 1);
  const height = positiveNumber(args.height, 1);
  const duration = positiveNumber(args.duration, 0.1);
  const runtime = buildCharacterRuntime(args.character);
  const character = runtime.character;
  assertCharacterPinRigReadyForAngle(character, runtime.angle);
  const scaleX = width / Math.max(1, character.canvasWidth);
  const scaleY = height / Math.max(1, character.canvasHeight);
  const { audioSpeeches, combinedVisemes } = resolveSpeechTimeline(args, duration);
  const effectiveMeta: CharacterClipMeta = {
    ...args.meta,
    visemes: [...combinedVisemes].sort((a, b) => a.t - b.t),
  };
  const timelineInputs = buildCharacterTimelineInputs(
    character,
    runtime,
    effectiveMeta,
    scaleX,
    scaleY,
  );
  const timelineScene = buildCharacterTimelineScene({
    compositionId: args.compositionId,
    clipId: args.clipId,
    duration,
    scaleX,
    scaleY,
    meta: effectiveMeta,
    motionPresets: args.motionPresets,
    motionTargets: timelineInputs.motionTargets,
    canvasWidth: character.canvasWidth,
    canvasHeight: character.canvasHeight,
    slotTimelines: timelineInputs.slotTimelines,
    boneAnchorTimelines: timelineInputs.boneAnchorTimelines,
    constraintContext: runtime.constraintContext,
    ikConstraints: runtime.angleRig.ikConstraints,
    activeAngle: runtime.angle,
  });
  return {
    compositionId: args.compositionId,
    clipId: args.clipId,
    width,
    height,
    duration,
    character,
    meta: effectiveMeta,
    scene: buildCharacterScene({
      character,
      meta: effectiveMeta,
      width,
      height,
      runtime,
      mediaAssets: args.mediaAssets,
    }),
    timelineScene,
    audioSpeeches,
  };
}

function buildCharacterTimelineInputs(
  character: CharacterPreset,
  runtime: CharacterRuntime,
  meta: CharacterClipMeta,
  scaleX: number,
  scaleY: number,
): CharacterTimelineInputs {
  const rig: RuntimeRig = {
    ...runtime.rig,
    activeAngle: runtime.angle,
    bones: runtime.angleRig.bones,
    slotBindings: runtime.angleRig.slotBindings,
    drawOrder: runtime.angleRig.drawOrder,
    slotRelations: runtime.angleRig.slotRelations,
    hostConstraints: runtime.angleRig.hostConstraints,
    reaches: runtime.angleRig.reaches,
    ikConstraints: runtime.angleRig.ikConstraints,
    sockets: undefined,
  };
  const out: CharacterTimelineInputs = {
    motionTargets: [],
    slotTimelines: [],
    boneAnchorTimelines: [],
  };
  const slotTargets: MotionTarget[] = [];

  const captureSlotTargetsForBone = (boneId: string, build: () => void): MotionTarget[] => {
    const beforeTargets = out.motionTargets.length;
    build();
    const newTargets = out.motionTargets.splice(beforeTargets);
    for (const target of newTargets) target.boneId ??= boneId;
    slotTargets.push(...newTargets);
    return newTargets;
  };

  const slots = runtime.slots;
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const nestedSlotIds = new Set<string>();
  const nestedChildrenByParentSlotId = new Map<string, NestedSlotChild[]>();
  for (const relation of rig.slotRelations ?? []) {
    if (relation.renderMode !== "nested") continue;
    if (relation.characterViewIds?.length && !relation.characterViewIds.includes(runtime.angle))
      continue;
    const childSlot = slotById.get(relation.childSlotId);
    const parentSlotId = parentSlotIdForRelation(relation, slots);
    if (!childSlot || !parentSlotId || !slotById.has(parentSlotId)) continue;
    nestedSlotIds.add(childSlot.id);
    nestedChildrenByParentSlotId.set(parentSlotId, [
      ...(nestedChildrenByParentSlotId.get(parentSlotId) ?? []),
      { slot: childSlot, relation },
    ]);
  }

  for (const slot of slots) {
    if (nestedSlotIds.has(slot.id)) continue;
    const binding = runtime.bindingBySlot.get(slot.id);
    if (binding && !binding.visible) continue;
    const boneId = binding?.effectiveBoneId ?? "bone:root";
    captureSlotTargetsForBone(boneId, () => {
      buildSlotByRole(
        out,
        character,
        slot,
        meta.poses,
        scaleX,
        scaleY,
        binding,
        rig,
        runtime,
        nestedChildrenByParentSlotId,
      );
    });
  }

  const hasVisibleMouthParts = character.parts.some(
    (part) => part.role === "mouth" && part.visible,
  );
  const losesGeneratedMouth =
    !hasVisibleMouthParts &&
    ((character.mouthStyle === "rig" && !!(character.mouthRig || character.fallbackMouth)) ||
      (!!character.mouthRig && character.mouthStyle !== "images"));
  if (losesGeneratedMouth) {
    // The generated/fallback mouth rig was DOM-renderer-only and is retired.
    // Legacy characters keep building, minus that mouth, until they get real
    // mouth image/SVG parts.
    console.warn(
      `Character "${character.name}" still references the legacy generated mouth rig; ` +
        "it is no longer rendered. Add mouth image or SVG parts to restore the mouth.",
    );
  }

  out.boneAnchorTimelines = buildBoneAnchorTimelines(
    rig,
    runtime,
    slotById,
    meta.poses,
    scaleX,
    scaleY,
  );
  const controlTargets: MotionTarget[] = runtime.angleRig.bones
    .filter((bone) => bone.controlKind)
    .map((bone) => ({
      kind: "bone",
      acceptsSlotMotion: false,
      controlKind: bone.controlKind,
      id: boneElementId(bone.id),
      selector: `#${boneElementId(bone.id)}`,
      boneId: bone.id,
      slotId: bone.id,
      role: "custom",
      baseRotation: bone.rotation,
      baseAnchorX: 0,
      baseAnchorY: 0,
      depth: bone.depth,
    }));
  const resolvedTargets = slotTargets.flatMap((target) => {
    const runtimeTarget = runtimeMotionTargetForSlot(runtime, target.slotId);
    const slotTarget = { ...target, acceptsSlotMotion: runtimeTarget.kind === "slot" };
    const binding = runtime.bindingBySlot.get(target.slotId);
    if (!binding) return [slotTarget];
    return [
      slotTarget,
      {
        ...boneTargetForSlotTarget(target, binding, runtime),
        acceptsSlotMotion: runtimeTarget.kind === "bone",
      },
    ];
  });
  out.motionTargets = [...controlTargets, ...uniqueMotionTargets(resolvedTargets)];
  // Bone targets whose rest rotation follows the parent variant: hand the motion builder the
  // per-key rotations so its absolute rotation vars track the active variant frame by frame.
  const anchorByBoneId = new Map(out.boneAnchorTimelines.map((entry) => [entry.boneId, entry]));
  for (const target of out.motionTargets) {
    if (target.kind !== "bone" || !target.boneId) continue;
    const entry = anchorByBoneId.get(target.boneId);
    if (!entry) continue;
    const rotations = Object.fromEntries(
      Object.entries(entry.anchors).map(([key, anchor]) => [key, anchor.rotation]),
    );
    if (Object.values(rotations).every((rotation) => rotation === entry.base.rotation)) continue;
    target.anchorParentSlotId = entry.parentSlotId;
    target.anchorRotations = rotations;
    target.baseRotation = entry.base.rotation;
  }
  return out;
}

/**
 * Collect the bones whose rest anchor follows their parent slot's active variant. Anchor values
 * are stage-scaled and expanded to every alias of each parent variant part, so timeline slot
 * states (which may use pose/viseme/id aliases) resolve to the same anchor as canonical keys.
 */
function buildBoneAnchorTimelines(
  rig: RuntimeRig,
  runtime: CharacterRuntime,
  slotById: Map<string, CharacterSlotRef>,
  poses: Record<string, string>,
  scaleX: number,
  scaleY: number,
): BoneAnchorTimeline[] {
  const out: BoneAnchorTimeline[] = [];
  for (const bone of runtime.angleRig.bones) {
    const source = bone.restSource;
    if (!source) continue;
    const parentSlotId = source.slotId;
    const parentSlot = parentSlotId ? slotById.get(parentSlotId) : undefined;
    if (!parentSlotId || !parentSlot) continue;
    if (new Set(parentSlot.parts.map((part) => variantKeyForPart(part))).size <= 1) continue;
    const anchors: Record<string, { left: number; top: number; rotation: number }> = {};
    const scaled = (anchor: { x: number; y: number; rotation: number }) => ({
      left: anchor.x * scaleX,
      top: anchor.y * scaleY,
      rotation: anchor.rotation,
    });
    for (const part of parentSlot.parts) {
      const pin = part.pins?.[source.pinName];
      if (!pin) continue;
      const canonical = variantKeyForPart(part);
      const anchor = pinTransformInBoneSpace(part, pin, source.offset);
      anchors[canonical] = scaled(anchor);
      for (const alias of variantAliasesForPart(part)) anchors[alias] ??= scaled(anchor);
    }
    if (Object.keys(anchors).length === 0) continue;
    const base = { left: bone.x * scaleX, top: bone.y * scaleY, rotation: bone.rotation };
    const initialPart = resolveRuntimeSlotPart(parentSlot, runtime, poses[parentSlot.id]);
    const initialKey = initialPart ? variantKeyForPart(initialPart) : undefined;
    out.push({
      parentSlotId,
      selector: `#${boneElementId(bone.id)}`,
      sceneNodeId: characterSceneBoneNodeId(bone.id),
      boneId: bone.id,
      base,
      initial: (initialKey ? anchors[initialKey] : undefined) ?? base,
      anchors,
    });
  }
  return out;
}

function boneTargetForSlotTarget(
  target: MotionTarget,
  binding: ResolvedSlotBinding | undefined,
  runtime: CharacterRuntime,
): MotionTarget {
  if (!binding) return target;
  const bone = runtime.boneById.get(binding.effectiveBoneId);
  return {
    ...target,
    kind: "bone",
    id: boneElementId(binding.effectiveBoneId),
    selector: `#${boneElementId(binding.effectiveBoneId)}`,
    boneId: binding.effectiveBoneId,
    baseRotation: bone?.rotation ?? 0,
    baseAnchorX: 0,
    baseAnchorY: 0,
    depth: binding.effectiveDepth,
  };
}

function uniqueMotionTargets(targets: MotionTarget[]): MotionTarget[] {
  const out = new Map<string, MotionTarget>();
  for (const target of targets) {
    const existing = out.get(target.selector);
    if (!existing || (!existing.acceptsSlotMotion && target.acceptsSlotMotion)) {
      out.set(target.selector, target);
    }
  }
  return Array.from(out.values());
}

function boneZIndex(rig: RuntimeRig, boneId: string): number {
  const binding = rig.slotBindings.find((candidate) => candidate.boneId === boneId);
  return binding ? slotDrawIndex(rig, binding.slotId, 0) : 0;
}

function boneElementId(boneId: string): string {
  return `char-bone-${safeId(boneId)}`;
}

function lipSyncOwnsMouth(meta: CharacterClipMeta): boolean {
  return !!meta.visemes?.length;
}

function buildSlotByRole(
  out: CharacterTimelineInputs,
  character: CharacterPreset,
  slot: CharacterSlotRef,
  poses: Record<string, string>,
  scaleX: number,
  scaleY: number,
  binding: ResolvedSlotBinding | undefined,
  rig: RuntimeRig,
  runtime: CharacterRuntime,
  nestedChildrenByParentSlotId: Map<string, NestedSlotChild[]>,
): void {
  if (slot.role === "eye")
    buildEyeSlot(
      out,
      character,
      slot,
      poses,
      scaleX,
      scaleY,
      binding,
      rig,
      runtime,
      nestedChildrenByParentSlotId,
    );
  else if (slot.role === "mouth")
    buildMouthSlot(
      out,
      character,
      slot,
      poses,
      scaleX,
      scaleY,
      binding,
      rig,
      runtime,
      nestedChildrenByParentSlotId,
    );
  else
    buildGenericSlot(
      out,
      character,
      slot,
      poses,
      scaleX,
      scaleY,
      binding,
      rig,
      runtime,
      nestedChildrenByParentSlotId,
    );
}

function collectNestedTimelineInputsForPart(
  out: CharacterTimelineInputs,
  character: CharacterPreset,
  parentSlot: CharacterSlotRef,
  parentPart: CharacterPart,
  poses: Record<string, string>,
  scaleX: number,
  scaleY: number,
  rig: RuntimeRig,
  runtime: CharacterRuntime,
  nestedChildrenByParentSlotId: Map<string, NestedSlotChild[]>,
): void {
  const children = nestedChildrenByParentSlotId.get(parentSlot.id) ?? [];
  if (children.length === 0) return;
  children
    .filter(({ relation }) => relationActiveForParentPart(relation, parentPart))
    .forEach(({ slot, relation }) => {
      const binding = runtime.bindingBySlot.get(slot.id);
      if (binding && !binding.visible) return;
      const beforeSlotTimelines = out.slotTimelines.length;
      buildSlotByRole(
        out,
        character,
        slot,
        poses,
        scaleX,
        scaleY,
        binding,
        rig,
        runtime,
        nestedChildrenByParentSlotId,
      );
      const gateKeys = relation.activeWhenParentVariant?.keys ?? [];
      if (relation.visibilityMode === "withParentVariant" && gateKeys.length > 0) {
        for (const timeline of out.slotTimelines.slice(beforeSlotTimelines)) {
          if (timeline.slotId !== slot.id) continue;
          timeline.parentVariantGate = {
            parentSlotId: parentSlot.id,
            keys: [...gateKeys],
          };
        }
      }
    });
}

function relationActiveForParentPart(relation: CharacterSlotRelation, parentPart: CharacterPart) {
  const gate = relation.activeWhenParentVariant;
  if (!gate?.keys?.length && !gate?.partIds?.length) return true;
  if (gate.partIds?.includes(parentPart.id)) return true;
  return variantAliasesForPart(parentPart).some((value) => gate.keys?.includes(value));
}

function parentSlotIdForRelation(
  relation: CharacterSlotRelation,
  slots: CharacterSlotRef[],
): string | undefined {
  if (relation.parentRef.type === "slot" || relation.parentRef.type === "semanticSlot") {
    return relation.parentRef.id;
  }
  if (relation.parentRef.type === "role") {
    const parentRole = relation.parentRef.role;
    const parentSide = relation.parentRef.side;
    return slots.find(
      (slot) =>
        slot.role === parentRole &&
        (!parentSide || slot.parts.some((part) => part.side === parentSide)),
    )?.id;
  }
  return undefined;
}

function buildEyeSlot(
  out: CharacterTimelineInputs,
  character: CharacterPreset,
  slot: CharacterSlotRef,
  poses: Record<string, string>,
  scaleX: number,
  scaleY: number,
  binding: ResolvedSlotBinding | undefined,
  rig: RuntimeRig,
  runtime: CharacterRuntime,
  nestedChildrenByParentSlotId: Map<string, NestedSlotChild[]>,
): void {
  const variants = eyeVariantsForSlot(slot);
  const anglePart = resolveRuntimeSlotPart(slot, runtime, "open");
  const openVariant = variants.find((variant) => variant.state === "open");
  const basePart = anglePart ?? openVariant?.part ?? variants[0]?.part;
  if (!basePart) return;

  const containerId = slotContainerId(slot.id);
  const variantIds: Record<string, string[]> = {};
  const variantSceneNodeIds: Record<string, string[]> = {};
  const variantParts: Record<string, CharacterPart> = {};
  const activeState =
    (anglePart ? variantKeyForPart(anglePart) : undefined) ??
    openVariant?.state ??
    variants[0].state;
  for (const { state, part } of variants) {
    const id = partElementId(slot.id, state, part.id);
    const sceneNodeId = characterScenePartNodeId(slot.id, variantKeyForPart(part), part.id);
    for (const key of unique([state, ...variantAliasesForPart(part)])) {
      addVariantElement(variantIds, key, id);
      addVariantElement(variantSceneNodeIds, key, sceneNodeId);
      variantParts[key] = part;
    }
    collectNestedTimelineInputsForPart(
      out,
      character,
      slot,
      part,
      poses,
      scaleX,
      scaleY,
      rig,
      runtime,
      nestedChildrenByParentSlotId,
    );
  }
  out.motionTargets.push({
    ...motionTargetFor(containerId, slot, basePart, binding?.effectiveBoneId),
    defaultVariantKey: activeState,
    variantParts,
  });
  out.slotTimelines.push({
    slotId: slot.id,
    role: slot.role,
    hostSlotId: hostSlotIdFor(rig, slot.id),
    defaultKey: activeState,
    render: {
      kind: "variant",
      variants: variantIds,
      sceneVariants: variantSceneNodeIds,
    },
  });
}

function buildMouthSlot(
  out: CharacterTimelineInputs,
  character: CharacterPreset,
  slot: CharacterSlotRef,
  poses: Record<string, string>,
  scaleX: number,
  scaleY: number,
  binding: ResolvedSlotBinding | undefined,
  rig: RuntimeRig,
  runtime: CharacterRuntime,
  nestedChildrenByParentSlotId: Map<string, NestedSlotChild[]>,
): void {
  const visibleParts = slot.parts.filter((part) => part.visible);
  const anglePart = resolveRuntimeSlotPart(slot, runtime, "rest");
  const restPart =
    anglePart ?? visibleParts.find((part) => partMatchesVariant(part, "rest")) ?? visibleParts[0];
  if (!restPart) return;

  const containerId = slotContainerId(slot.id);
  const variants: Record<string, string[]> = {};
  const sceneVariants: Record<string, string[]> = {};
  const variantParts: Record<string, CharacterPart> = {};
  const renderedIds = new Set<string>();
  for (const viseme of VISEMES) {
    const part = visibleParts.find((candidate) => partMatchesVariant(candidate, viseme));
    if (!part) continue;
    const id = partElementId(slot.id, viseme, part.id);
    const sceneNodeId = characterScenePartNodeId(slot.id, variantKeyForPart(part), part.id);
    for (const key of unique([viseme, ...variantAliasesForPart(part)])) {
      addVariantElement(variants, key, id);
      addVariantElement(sceneVariants, key, sceneNodeId);
      variantParts[key] = part;
    }
    renderedIds.add(id);
    collectNestedTimelineInputsForPart(
      out,
      character,
      slot,
      part,
      poses,
      scaleX,
      scaleY,
      rig,
      runtime,
      nestedChildrenByParentSlotId,
    );
  }
  for (const part of visibleParts) {
    const key = variantKeyForPart(part);
    const id = partElementId(slot.id, key, part.id);
    const sceneNodeId = characterScenePartNodeId(slot.id, key, part.id);
    for (const alias of variantAliasesForPart(part)) {
      addVariantElement(variants, alias, id);
      addVariantElement(sceneVariants, alias, sceneNodeId);
      variantParts[alias] = part;
    }
    if (renderedIds.has(id)) continue;
    renderedIds.add(id);
    collectNestedTimelineInputsForPart(
      out,
      character,
      slot,
      part,
      poses,
      scaleX,
      scaleY,
      rig,
      runtime,
      nestedChildrenByParentSlotId,
    );
  }
  out.motionTargets.push({
    ...motionTargetFor(containerId, slot, restPart, binding?.effectiveBoneId),
    defaultVariantKey: "rest",
    variantParts,
  });
  out.slotTimelines.push({
    slotId: slot.id,
    role: slot.role,
    hostSlotId: hostSlotIdFor(rig, slot.id),
    defaultKey: "rest",
    render: {
      kind: "variant",
      variants,
      sceneVariants,
    },
  });
}

function buildGenericSlot(
  out: CharacterTimelineInputs,
  character: CharacterPreset,
  slot: CharacterSlotRef,
  poses: Record<string, string>,
  scaleX: number,
  scaleY: number,
  binding: ResolvedSlotBinding | undefined,
  rig: RuntimeRig,
  runtime: CharacterRuntime,
  nestedChildrenByParentSlotId: Map<string, NestedSlotChild[]>,
): void {
  const visibleParts = slot.parts.filter((part) => part.visible);
  const activePart = resolveRuntimeSlotPart(slot, runtime, poses[slot.id]);
  if (!activePart) return;

  const containerId = slotContainerId(slot.id);
  const variants: Record<string, string[]> = {};
  const sceneVariants: Record<string, string[]> = {};
  const variantParts: Record<string, CharacterPart> = {};
  const activeKey = variantKeyForPart(activePart);
  // Bone-bound slots place every variant pivot-aligned: the displayed art's pivot rides the
  // joint (and therefore any socket the joint resolves to), not its authored canvas spot. The
  // container itself sits at the binding offset derived from the representative part, so that
  // part's group keeps rendering at its authored position.
  const referencePart = binding ? (representativePart(slot) ?? activePart) : undefined;
  for (const part of visibleParts) {
    const key = variantKeyForPart(part);
    const id = partElementId(slot.id, key, part.id);
    const sceneNodeId = characterScenePartNodeId(slot.id, key, part.id);
    for (const alias of variantAliasesForPart(part)) {
      addVariantElement(variants, alias, id);
      addVariantElement(sceneVariants, alias, sceneNodeId);
      variantParts[alias] = part;
    }
    collectNestedTimelineInputsForPart(
      out,
      character,
      slot,
      part,
      poses,
      scaleX,
      scaleY,
      rig,
      runtime,
      nestedChildrenByParentSlotId,
    );
  }
  out.motionTargets.push({
    ...motionTargetFor(containerId, slot, activePart, binding?.effectiveBoneId),
    defaultVariantKey: activeKey,
    variantParts,
    referencePart,
  });
  out.slotTimelines.push({
    slotId: slot.id,
    role: slot.role,
    hostSlotId: hostSlotIdFor(rig, slot.id),
    defaultKey: activeKey,
    render: {
      kind: "variant",
      variants,
      sceneVariants,
    },
  });
}

function hostSlotIdFor(rig: RuntimeRig, slotId: string) {
  return hostConstraintFor(rig, slotId)?.hostSlotId;
}

function hostConstraintFor(rig: RuntimeRig, slotId: string) {
  return rig.hostConstraints.find((constraint) => constraint.slotId === slotId);
}

function motionTargetFor(
  id: string,
  slot: CharacterSlotRef,
  basePart: CharacterPart,
  boneId?: string,
): MotionTarget {
  return {
    kind: "slot",
    acceptsSlotMotion: true,
    id,
    selector: `#${id}`,
    boneId,
    slotId: slot.id,
    role: slot.role,
    basePart,
    baseRotation: basePart.rotation,
    baseAnchorX: basePart.anchorX,
    baseAnchorY: basePart.anchorY,
  };
}

type ResolvedAudioSpeech = {
  audioId: string;
  start: number;
  duration: number;
  volume?: number;
  mediaStart?: number;
};

/**
 * Resolve the build's speeches (or the legacy single voice) into the `<audio>`
 * clips to emit and a single combined viseme track for the mouth. Multi-speech
 * offsets each speech's visemes by its start and closes the mouth (rest) after
 * each; the legacy path is preserved byte-for-byte.
 */
function resolveSpeechTimeline(
  args: BuildCharacterCompositionArgs,
  duration: number,
): {
  audioSpeeches: ResolvedAudioSpeech[];
  combinedVisemes: VisemeEntry[];
} {
  const clampT = (t: number) => Math.max(0, Math.min(duration, t));
  if (args.speeches && args.speeches.length > 0) {
    const audioSpeeches: ResolvedAudioSpeech[] = [];
    const combinedVisemes: VisemeEntry[] = [];
    for (const speech of args.speeches) {
      const start = clampT(speech.start);
      const mediaStart = Math.max(0, speech.mediaStartTime ?? 0);
      const length = Math.min(duration - start, positiveNumber(speech.duration, duration));
      if (length <= 0) continue;
      audioSpeeches.push({
        audioId: speech.audioId,
        start,
        duration: length,
        volume: speech.volume,
        mediaStart,
      });
      // Visemes are timed against the source audio; an in-point shifts them earlier
      // and drops any that fall outside the trimmed [mediaStart, mediaStart+length) window.
      for (const entry of speech.visemes) {
        if (entry.t < mediaStart - 1e-6 || entry.t > mediaStart + length + 1e-6) continue;
        combinedVisemes.push({ t: clampT(start + (entry.t - mediaStart)), v: entry.v });
      }
      combinedVisemes.push({ t: clampT(start + length), v: "rest" });
    }
    combinedVisemes.sort((a, b) => a.t - b.t);
    return { audioSpeeches, combinedVisemes };
  }
  if (args.meta.lipSyncAudioId) {
    const length = Math.min(duration, positiveNumber(args.speechDuration ?? duration, duration));
    return {
      audioSpeeches: [{ audioId: args.meta.lipSyncAudioId, start: 0, duration: length }],
      combinedVisemes: args.meta.visemes ?? [],
    };
  }
  return { audioSpeeches: [], combinedVisemes: args.meta.visemes ?? [] };
}

type CharacterTimelineScriptArgs = {
  compositionId: string;
  clipId: string;
  duration: number;
  scaleX: number;
  scaleY: number;
  meta: CharacterClipMeta;
  motionPresets: Map<string, MotionPreset>;
  motionTargets: MotionTarget[];
  canvasWidth: number;
  canvasHeight: number;
  slotTimelines: SlotTimeline[];
  boneAnchorTimelines: BoneAnchorTimeline[];
  constraintContext: MotionConstraintContext;
  ikConstraints?: CharacterIkConstraint[];
  activeAngle: RuntimeRig["activeAngle"];
};

function buildCharacterTimelineScene(args: CharacterTimelineScriptArgs): CharacterTimelineScene {
  const blinkWindows = blinkWindowsForClip({
    id: args.clipId,
    duration: args.duration,
    autoBlink: args.meta.autoBlink,
  });
  const times = collectTimelineTimes(
    args.duration,
    args.meta,
    args.motionPresets,
    blinkWindows,
    args.activeAngle,
  );
  const frames = times.map((time) =>
    buildMotionFrame(
      time,
      args.duration,
      args.scaleX,
      args.scaleY,
      args.meta,
      args.motionPresets,
      args.motionTargets,
      args.canvasWidth,
      args.canvasHeight,
      args.slotTimelines,
      blinkWindows,
      args.constraintContext,
      args.ikConstraints ?? [],
      args.activeAngle,
    ),
  );
  backfillThreeDVars(frames);
  backfillBendVars(frames);
  backfillFlexiblePathVars(frames);
  const slotEvents = buildSlotEvents(frames, args.slotTimelines, args.boneAnchorTimelines);
  const motionSegments = frames.slice(1).flatMap((frame, index) => {
    const previousFrame = frames[index];
    const targets = changedMotionTargets(previousFrame.targets, frame.targets);
    if (targets.length === 0) return [];
    return [
      {
        start: previousFrame.time,
        duration: roundTime(frame.time - previousFrame.time),
        targets,
      },
    ];
  });

  return {
    duration: args.duration,
    initialTargets: frames[0]?.targets ?? [],
    motionSegments,
    slotEvents,
  };
}

function collectTimelineTimes(
  duration: number,
  meta: CharacterClipMeta,
  presets: Map<string, MotionPreset>,
  blinkWindows: Array<{ start: number; end: number }>,
  activeAngle: RuntimeRig["activeAngle"],
): number[] {
  const times = new Set<number>([0, roundTime(duration)]);
  const step = 1 / MOTION_SAMPLE_FPS;
  for (let t = step; t < duration; t += step) times.add(roundTime(t));
  for (const blink of blinkWindows) {
    times.add(roundTime(blink.start));
    times.add(roundTime(blink.end));
  }
  for (const viseme of meta.visemes ?? [])
    times.add(roundTime(Math.max(0, Math.min(duration, viseme.t))));
  for (const motion of meta.motions ?? []) {
    const preset = presets.get(motion.presetId);
    if (!preset) continue;
    if (!motionAppliesToAngle(preset, activeAngle)) continue;
    const motionDuration = Math.max(0.0001, motion.duration ?? preset.duration);
    for (const occurrence of generateMotionOccurrences(motion, preset, duration)) {
      times.add(roundTime(Math.max(0, Math.min(duration, occurrence.start))));
      times.add(roundTime(Math.max(0, Math.min(duration, occurrence.end))));
      for (const track of preset.tracks) {
        if (track.angleIds?.length && !track.angleIds.includes(activeAngle)) continue;
        for (const keyframe of track.keyframes) {
          times.add(
            roundTime(
              Math.max(0, Math.min(duration, occurrence.start + keyframe.t * motionDuration)),
            ),
          );
        }
      }
      for (const keypose of preset.keyposes ?? []) {
        times.add(roundTime(Math.max(0, Math.min(duration, occurrence.start + keypose.t))));
        if (keypose.anticipation && keypose.t > 0) {
          times.add(
            roundTime(
              Math.max(
                0,
                Math.min(duration, occurrence.start + keypose.t - keypose.anticipation.duration),
              ),
            ),
          );
        }
      }
    }
  }
  return Array.from(times)
    .filter((time) => Number.isFinite(time) && time >= 0 && time <= duration)
    .sort((a, b) => a - b);
}

function buildMotionFrame(
  time: number,
  duration: number,
  scaleX: number,
  scaleY: number,
  meta: CharacterClipMeta,
  presets: Map<string, MotionPreset>,
  motionTargets: MotionTarget[],
  canvasWidth: number,
  canvasHeight: number,
  slots: SlotTimeline[],
  blinkWindows: Array<{ start: number; end: number }>,
  constraintCtx: MotionConstraintContext,
  ikConstraints: CharacterIkConstraint[],
  activeAngle: RuntimeRig["activeAngle"],
) {
  const composed = composeMotionsAt(
    { duration, motions: meta.motions },
    time,
    presets,
    activeAngle,
  );
  const slotStates = resolveSlotStatesAt({
    time,
    meta,
    slots,
    blinkWindows,
    composed,
  });
  const targetFrames = motionTargets.map((target) => {
    // Semantic slot/role motion is routed to exactly one primary element. Exact bone tracks remain
    // available on the secondary bone channel without inheriting the slot delta.
    const rawDelta =
      target.kind === "bone"
        ? target.acceptsSlotMotion
          ? deltaForBone(composed, target.role, target.slotId, target.boneId)
          : deltaForBoneOnly(composed, target.boneId)
        : target.acceptsSlotMotion
          ? deltaFor(composed, target.role, target.slotId)
          : emptyDelta();
    return { target, rawDelta };
  });
  const animatedBoneIds = new Set(
    targetFrames
      .filter(
        (entry) =>
          entry.target.kind === "bone" &&
          !!entry.target.boneId &&
          motionDeltaMovesJoint(entry.rawDelta),
      )
      .map((entry) => entry.target.boneId as string),
  );
  applyIkToTargetFrames(targetFrames, composed, constraintCtx, ikConstraints);
  return {
    time,
    slotStates,
    targets: targetFrames.map(({ target, rawDelta }) => {
      const fkLocked = resolveFkJointDelta({
        ctx: constraintCtx,
        boneId: target.boneId,
        slotId: target.slotId,
        role: target.role,
        dx: rawDelta.dx,
        dy: rawDelta.dy,
        animatedBoneIds,
        unclampedLayers: composed.unclampedLayers,
        control: target.controlKind !== undefined,
      });
      const fkDelta = fkLocked.clamped
        ? { ...rawDelta, dx: fkLocked.dx, dy: fkLocked.dy }
        : rawDelta;
      // Tone preset motion down to the layer's effective reach (drift polygon + twist range,
      // variant rotation limits), unless an active movement opted this layer out of bounds.
      const limited = resolveMotionDelta({
        ctx: constraintCtx,
        slotId: target.slotId,
        boneId: target.boneId,
        role: target.role,
        activeVariants: slotStates,
        dx: fkDelta.dx,
        dy: fkDelta.dy,
        rotation: fkDelta.rotation,
        unclampedLayers: composed.unclampedLayers,
        control: target.controlKind !== undefined,
      });
      const delta = limited.clamped
        ? { ...fkDelta, dx: limited.dx, dy: limited.dy, rotation: limited.rotation }
        : fkDelta;
      const activePart = activePartForMotionTarget(target, composed, slotStates);
      const turn =
        activePart && shouldApplyFaceTurnToTarget(target)
          ? faceTurnMotionForPart(
              activePart,
              composed.faceTurnX,
              canvasWidth,
              composed.faceTurnY,
              canvasHeight,
            )
          : null;
      const { originX, originY } =
        target.kind === "bone"
          ? { originX: 0, originY: 0 }
          : transformOriginForMotionTarget(target, activePart, delta);
      // A bone whose rest rotation follows the parent variant uses the active variant's
      // rotation as this frame's base, so motion tweens compose with the swap instead of
      // stomping it back to the rest angle.
      const anchorKey = target.anchorParentSlotId
        ? slotStates.get(target.anchorParentSlotId)
        : undefined;
      const effectiveBaseRotation =
        (anchorKey ? target.anchorRotations?.[anchorKey] : undefined) ?? target.baseRotation;
      const vars: GsapVars = {
        x: round((delta.dx + (turn?.dx ?? 0)) * scaleX, 3),
        y: round((delta.dy + (turn?.dy ?? 0)) * scaleY, 3),
        scaleX: round(delta.scale * delta.scaleX * (turn?.scaleX ?? 1), 4),
        scaleY: round(delta.scale * delta.scaleY * (turn?.scaleY ?? 1), 4),
        skewX: round(delta.skewX + (turn?.skewX ?? 0), 3),
        skewY: round(delta.skewY + (turn?.skewY ?? 0), 3),
        rotation: round(effectiveBaseRotation + delta.rotation + (turn?.rotation ?? 0), 3),
        transformOrigin: `${round(originX * 100, 3)}% ${round(originY * 100, 3)}%`,
      };
      // 3D fields are emitted only when actually used, so existing 2D motions stay byte-identical.
      // backfillThreeDVars then keeps these present for the whole motion on any target that
      // uses 3D, so the runtime animates them cleanly back to zero.
      if (delta.rotationX) vars.rotationX = round(delta.rotationX, 3);
      if (delta.rotationY) vars.rotationY = round(delta.rotationY, 3);
      if (delta.bend) vars.bend = round(delta.bend, 3);
      if (delta.pathEndX) vars.pathEndX = round(delta.pathEndX, 3);
      if (delta.pathEndY) vars.pathEndY = round(delta.pathEndY, 3);
      if (delta.pathCurveX) vars.pathCurveX = round(delta.pathCurveX, 3);
      if (delta.pathCurveY) vars.pathCurveY = round(delta.pathCurveY, 3);
      if (delta.transformPerspective !== null)
        vars.transformPerspective = round(delta.transformPerspective, 3);
      if (delta.opacity !== null) vars.opacity = round(delta.opacity, 4);
      return { selector: target.selector, sceneNodeId: sceneNodeIdForMotionTarget(target), vars };
    }),
  };
}

type MotionTargetFrame = { target: MotionTarget; rawDelta: ReturnType<typeof emptyDelta> };

/** Bake IK rotations into ordinary bone target deltas so Pixi preview and export share one path. */
function applyIkToTargetFrames(
  targetFrames: MotionTargetFrame[],
  composed: ReturnType<typeof composeMotionsAt>,
  constraintCtx: MotionConstraintContext,
  constraints: CharacterIkConstraint[],
): void {
  if (composed.kinematics !== "ik" || constraints.length === 0) return;
  const frameByBoneId = new Map<string, MotionTargetFrame>();
  for (const frame of targetFrames) {
    if (frame.target.kind === "bone" && frame.target.boneId) {
      frameByBoneId.set(frame.target.boneId, frame);
    }
  }
  const worldByBone = new Map<string, { x: number; y: number; rotation: number }>();
  const resolving = new Set<string>();
  const worldForBone = (boneId: string): { x: number; y: number; rotation: number } | undefined => {
    const cached = worldByBone.get(boneId);
    if (cached) return cached;
    const bone = constraintCtx.boneById.get(boneId);
    if (!bone || resolving.has(boneId)) return undefined;
    resolving.add(boneId);
    const delta = frameByBoneId.get(boneId)?.rawDelta ?? emptyDelta();
    const parent = bone.parentId ? worldForBone(bone.parentId) : undefined;
    const localX = bone.x + delta.dx;
    const localY = bone.y + delta.dy;
    const localRotation = bone.rotation + delta.rotation;
    const radians = ((parent?.rotation ?? 0) * Math.PI) / 180;
    const world = parent
      ? {
          x: parent.x + localX * Math.cos(radians) - localY * Math.sin(radians),
          y: parent.y + localX * Math.sin(radians) + localY * Math.cos(radians),
          rotation: parent.rotation + localRotation,
        }
      : { x: localX, y: localY, rotation: localRotation };
    worldByBone.set(boneId, world);
    resolving.delete(boneId);
    return world;
  };
  const degrees = (radians: number) => (radians * 180) / Math.PI;

  for (const constraint of constraints) {
    const parentBone = constraintCtx.boneById.get(constraint.parentBoneId);
    const childBone = constraintCtx.boneById.get(constraint.childBoneId);
    const targetBone = constraintCtx.boneById.get(constraint.targetBoneId);
    const endBone = constraint.endBoneId
      ? constraintCtx.boneById.get(constraint.endBoneId)
      : childBone;
    const parentWorld = parentBone && worldForBone(parentBone.id);
    const parentParentWorld = parentBone?.parentId ? worldForBone(parentBone.parentId) : undefined;
    const childWorld = childBone && worldForBone(childBone.id);
    const targetWorld = targetBone && worldForBone(targetBone.id);
    const endWorld = endBone && worldForBone(endBone.id);
    if (!parentBone || !childBone || !targetBone || !parentWorld || !childWorld || !targetWorld) {
      continue;
    }
    const solved = solveTwoBoneIk({
      root: parentWorld,
      mid: childWorld,
      end: endWorld ?? childWorld,
      target: targetWorld,
      bendDirection: constraint.bendDirection,
    });
    const parentFrame = frameByBoneId.get(parentBone.id);
    const childFrame = frameByBoneId.get(childBone.id);
    if (!solved || !parentFrame || !childFrame) continue;
    parentFrame.rawDelta.rotation =
      degrees(solved.parentWorldRotation) -
      (parentParentWorld?.rotation ?? 0) -
      parentBone.rotation;
    childFrame.rawDelta.rotation =
      degrees(solved.childWorldRotation) - solved.parentWorldRotation - childBone.rotation;
    worldByBone.clear();
  }
}

function sceneNodeIdForMotionTarget(target: MotionTarget): string {
  if (target.kind === "bone" && target.boneId) return characterSceneBoneNodeId(target.boneId);
  return characterSceneSlotNodeId(target.slotId);
}

const DEFAULT_THREE_D_PERSPECTIVE = 800;

/**
 * Once a target uses any 3D transform anywhere in the motion, every frame for that target must
 * carry rotationX/rotationY/transformPerspective — otherwise a later `tl.to` that omits a field
 * leaves GSAP holding the previous value (e.g. a flip never returns to 0). buildMotionFrame emits
 * 3D vars only when non-zero (so plain 2D motions stay byte-identical); this pass backfills the
 * defaults across all frames for any target that touches 3D, keeping animations clean.
 */
function backfillThreeDVars(
  frames: Array<{ targets: Array<{ selector: string; vars: GsapVars }> }>,
) {
  const perspectiveBySelector = new Map<string, number>();
  for (const frame of frames) {
    for (const target of frame.targets) {
      const usesThreeD =
        target.vars.rotationX !== undefined ||
        target.vars.rotationY !== undefined ||
        target.vars.transformPerspective !== undefined;
      if (!usesThreeD) continue;
      const persp =
        target.vars.transformPerspective ??
        perspectiveBySelector.get(target.selector) ??
        DEFAULT_THREE_D_PERSPECTIVE;
      perspectiveBySelector.set(target.selector, persp);
    }
  }
  if (perspectiveBySelector.size === 0) return;
  for (const frame of frames) {
    for (const target of frame.targets) {
      const persp = perspectiveBySelector.get(target.selector);
      if (persp === undefined) continue;
      if (target.vars.rotationX === undefined) target.vars.rotationX = 0;
      if (target.vars.rotationY === undefined) target.vars.rotationY = 0;
      if (target.vars.transformPerspective === undefined) target.vars.transformPerspective = persp;
    }
  }
}

/**
 * Like backfillThreeDVars: once a target animates `bend` anywhere in the
 * motion, every frame for that target must carry `bend` — otherwise a frame
 * that omits it leaves the interpolated curve stuck at the previous value
 * mid-segment and snapping at the segment end.
 */
function backfillBendVars(frames: Array<{ targets: Array<{ selector: string; vars: GsapVars }> }>) {
  const bendSelectors = new Set<string>();
  for (const frame of frames) {
    for (const target of frame.targets) {
      if (target.vars.bend !== undefined) bendSelectors.add(target.selector);
    }
  }
  if (bendSelectors.size === 0) return;
  for (const frame of frames) {
    for (const target of frame.targets) {
      if (bendSelectors.has(target.selector) && target.vars.bend === undefined) {
        target.vars.bend = 0;
      }
    }
  }
}

function backfillFlexiblePathVars(
  frames: Array<{ targets: Array<{ selector: string; vars: GsapVars }> }>,
) {
  const pathSelectors = new Set<string>();
  for (const frame of frames) {
    for (const target of frame.targets) {
      const usesPath =
        target.vars.pathEndX !== undefined ||
        target.vars.pathEndY !== undefined ||
        target.vars.pathCurveX !== undefined ||
        target.vars.pathCurveY !== undefined;
      if (usesPath) pathSelectors.add(target.selector);
    }
  }
  if (pathSelectors.size === 0) return;
  for (const frame of frames) {
    for (const target of frame.targets) {
      if (!pathSelectors.has(target.selector)) continue;
      if (target.vars.pathEndX === undefined) target.vars.pathEndX = 0;
      if (target.vars.pathEndY === undefined) target.vars.pathEndY = 0;
      if (target.vars.pathCurveX === undefined) target.vars.pathCurveX = 0;
      if (target.vars.pathCurveY === undefined) target.vars.pathCurveY = 0;
    }
  }
}

function changedMotionTargets(
  previousTargets: Array<{ selector: string; vars: GsapVars }>,
  nextTargets: Array<{ selector: string; vars: GsapVars }>,
) {
  const previousBySelector = new Map(
    previousTargets.map((target) => [target.selector, target.vars]),
  );
  return nextTargets.filter(
    (target) => !gsapVarsEqual(previousBySelector.get(target.selector), target.vars),
  );
}

function gsapVarsEqual(a: GsapVars | undefined, b: GsapVars): boolean {
  if (!a) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as Array<keyof GsapVars>);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function activePartForMotionTarget(
  target: MotionTarget,
  composed: ReturnType<typeof composeMotionsAt>,
  slotStates: Map<string, string>,
): CharacterPart | undefined {
  const state = slotStates.get(target.slotId);
  if (state && target.variantParts?.[state])
    return partWithTargetDepth(target.variantParts[state], target);
  const swap = poseSwapFor(composed, target.role, target.slotId);
  if (swap && target.variantParts?.[swap])
    return partWithTargetDepth(target.variantParts[swap], target);
  if (target.defaultVariantKey && target.variantParts?.[target.defaultVariantKey]) {
    return partWithTargetDepth(target.variantParts[target.defaultVariantKey], target);
  }
  return partWithTargetDepth(target.basePart, target);
}

function shouldApplyFaceTurnToTarget(target: MotionTarget): boolean {
  if (target.role === "iris") return false;
  return target.acceptsSlotMotion;
}

function partWithTargetDepth(
  part: CharacterPart | undefined,
  target: MotionTarget,
): CharacterPart | undefined {
  if (!part || target.depth === undefined) return part;
  return { ...part, depth: target.depth };
}

function transformOriginForMotionTarget(
  target: MotionTarget,
  activePart: CharacterPart | undefined,
  delta: ReturnType<typeof deltaFor>,
): { originX: number; originY: number } {
  const originPart = activePart ?? target.basePart;
  const partOriginX = delta.originX ?? originPart?.anchorX ?? target.baseAnchorX;
  const partOriginY = delta.originY ?? originPart?.anchorY ?? target.baseAnchorY;
  // The origin point maps the displayed part's box into the container box, so it must use the
  // same offset the part was rendered at: pivot-aligned for bone-bound variant slots (where even
  // the container's own base part can sit offset from the reference), authored canvas offset
  // otherwise.
  if (
    originPart &&
    target.basePart &&
    (originPart !== target.basePart ||
      (target.referencePart && originPart !== target.referencePart))
  ) {
    const offset = motionOriginPartOffset(target, originPart);
    return {
      originX: (offset.x + partOriginX * originPart.width) / Math.max(1, target.basePart.width),
      originY: (offset.y + partOriginY * originPart.height) / Math.max(1, target.basePart.height),
    };
  }
  return { originX: partOriginX, originY: partOriginY };
}

function motionOriginPartOffset(
  target: MotionTarget,
  originPart: CharacterPart,
): { x: number; y: number } {
  const basePart = target.basePart!;
  if (!target.referencePart) {
    return { x: originPart.x - basePart.x, y: originPart.y - basePart.y };
  }
  // variantParts values preserve render order, so anchor selection matches buildGenericSlot's.
  const anchorPart =
    anchorPartForVariant(Object.values(target.variantParts ?? {}), variantKeyForPart(originPart)) ??
    originPart;
  return pivotAlignedPartOffset(target.referencePart, anchorPart, originPart);
}

function resolveSlotStatesAt({
  time,
  meta,
  slots,
  blinkWindows,
  composed,
}: {
  time: number;
  meta: CharacterClipMeta;
  slots: SlotTimeline[];
  blinkWindows: Array<{ start: number; end: number }>;
  composed: ReturnType<typeof composeMotionsAt>;
}): Map<string, string> {
  const states = new Map<string, string>();
  for (const slot of slots) {
    states.set(slot.slotId, resolveSlotKeyAt(slot, time, meta, blinkWindows, composed));
  }
  return states;
}

function resolveSlotKeyAt(
  slot: SlotTimeline,
  time: number,
  meta: CharacterClipMeta,
  blinkWindows: Array<{ start: number; end: number }>,
  composed: ReturnType<typeof composeMotionsAt>,
): string {
  const expressionSwap = poseSwapFor(composed, slot.role, slot.slotId);
  if (slot.role === "mouth") {
    const key = lipSyncOwnsMouth(meta) ? lastVisemeAt(meta.visemes ?? [], time) : expressionSwap;
    return slotKeyOrDefault(slot, key);
  }
  if (slot.role === "eye") {
    const availableStates = new Set(slotRenderKeys(slot.render));
    const key = resolveEyeState({
      expressionPoseSwap: expressionSwap,
      proceduralPoseSwap: autoBlinkPoseSwapAt(blinkWindows, time),
      availableStates,
    });
    return slotKeyOrDefault(slot, key);
  }
  return slotKeyOrDefault(slot, expressionSwap);
}

function slotKeyOrDefault(slot: SlotTimeline, key: string | undefined): string {
  if (key && slotRenderHasKey(slot.render, key)) return key;
  return slot.defaultKey;
}

function slotRenderHasKey(render: SlotRenderStrategy, key: string): boolean {
  return Boolean(render.variants[key]);
}

function slotRenderKeys(render: SlotRenderStrategy): string[] {
  return Object.keys(render.variants);
}

function lastVisemeAt(visemes: Array<{ t: number; v: MouthViseme }>, time: number): MouthViseme {
  let active: MouthViseme = "rest";
  for (const entry of visemes) {
    if (entry.t <= time + 0.0001) active = entry.v;
    else break;
  }
  return active;
}

function buildSlotEvents(
  frames: Array<{ time: number; slotStates: Map<string, string> }>,
  slots: SlotTimeline[],
  boneAnchorTimelines: BoneAnchorTimeline[] = [],
) {
  const events: CharacterTimelineSlotEvent[] = [];
  const anchorsByParentSlot = new Map<string, BoneAnchorTimeline[]>();
  const childVisibilityByParentSlot = new Map<string, SlotTimeline[]>();
  for (const entry of boneAnchorTimelines) {
    anchorsByParentSlot.set(entry.parentSlotId, [
      ...(anchorsByParentSlot.get(entry.parentSlotId) ?? []),
      entry,
    ]);
  }
  for (const slot of slots) {
    const parentSlotId = slot.parentVariantGate?.parentSlotId;
    if (!parentSlotId) continue;
    childVisibilityByParentSlot.set(parentSlotId, [
      ...(childVisibilityByParentSlot.get(parentSlotId) ?? []),
      slot,
    ]);
  }
  const previous = new Map<string, string>();
  for (const frame of frames) {
    for (const slot of slots) {
      const key = frame.slotStates.get(slot.slotId) ?? slot.defaultKey;
      const signature = slotRenderSignature(slot.render, key);
      if (previous.get(slot.slotId) === signature) continue;
      previous.set(slot.slotId, signature);
      const event = slotEventFor(slot, key, frame.time);
      const boneAnchors = (anchorsByParentSlot.get(slot.slotId) ?? []).map((entry) => {
        const anchor = entry.anchors[key] ?? entry.base;
        return {
          selector: entry.selector,
          sceneNodeId: entry.sceneNodeId,
          left: anchor.left,
          top: anchor.top,
          rotation: anchor.rotation,
        };
      });
      if (boneAnchors.length) event.boneAnchors = boneAnchors;
      const gatedChildren = childVisibilityByParentSlot.get(slot.slotId) ?? [];
      if (gatedChildren.length) applyGatedChildVisibility(event, gatedChildren, key, frame);
      events.push(event);
    }
  }
  return events;
}

function applyGatedChildVisibility(
  event: CharacterTimelineSlotEvent,
  children: SlotTimeline[],
  parentKey: string,
  frame: { slotStates: Map<string, string> },
): void {
  for (const child of children) {
    const allChildIds = unique(Object.values(child.render.variants).flat());
    const allChildSceneNodeIds = child.render.sceneVariants
      ? unique(Object.values(child.render.sceneVariants).flat())
      : [];
    const active = child.parentVariantGate?.keys.includes(parentKey) ?? false;
    event.variant ??= { hide: [], show: [] };
    event.variant.hide = unique([...(event.variant.hide ?? []), ...allChildIds]);
    if (event.variant.hideSceneNodeIds || allChildSceneNodeIds.length) {
      event.variant.hideSceneNodeIds = unique([
        ...(event.variant.hideSceneNodeIds ?? []),
        ...allChildSceneNodeIds,
      ]);
    }
    if (!active) continue;
    const childKey = frame.slotStates.get(child.slotId) ?? child.defaultKey;
    event.variant.show = unique([
      ...(event.variant.show ?? []),
      ...variantIdsForKey(child.render, childKey),
    ]);
    if (child.render.sceneVariants) {
      event.variant.showSceneNodeIds = unique([
        ...(event.variant.showSceneNodeIds ?? []),
        ...variantSceneNodeIdsForKey(child.render, childKey),
      ]);
    }
  }
}

function slotRenderSignature(render: SlotRenderStrategy, key: string): string {
  return variantIdsForKey(render, key).join("|") || key;
}

function slotEventFor(slot: SlotTimeline, key: string, time: number): CharacterTimelineSlotEvent {
  return {
    time,
    slotId: slot.slotId,
    key,
    variant: {
      hide: unique(Object.values(slot.render.variants).flat()),
      show: variantIdsForKey(slot.render, key),
      hideSceneNodeIds: slot.render.sceneVariants
        ? unique(Object.values(slot.render.sceneVariants).flat())
        : undefined,
      showSceneNodeIds: slot.render.sceneVariants
        ? variantSceneNodeIdsForKey(slot.render, key)
        : undefined,
    },
  };
}

function variantIdsForKey(render: VariantSlotRender, key: string): string[] {
  return (
    render.variants[key] ??
    render.variants.rest ??
    render.variants[Object.keys(render.variants)[0]] ??
    []
  );
}

function variantSceneNodeIdsForKey(render: VariantSlotRender, key: string): string[] {
  if (!render.sceneVariants) return [];
  return (
    render.sceneVariants[key] ??
    render.sceneVariants.rest ??
    render.sceneVariants[Object.keys(render.sceneVariants)[0]] ??
    []
  );
}

function slotContainerId(slotId: string): string {
  return `char-slot-${safeId(slotId)}`;
}

function partElementId(slotId: string, variant: string, partId?: string): string {
  const suffix = partId && partId !== variant ? `-${safeId(partId)}` : "";
  return `char-part-${safeId(slotId)}-${safeId(variant)}${suffix}`;
}

function safeId(value: string): string {
  const clean = value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  const base = clean || "part";
  return clean === value ? base : `${base}-${hashIdFragment(value)}`;
}

function hashIdFragment(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function addVariantElement(variants: Record<string, string[]>, key: string, id: string): void {
  const existing = variants[key] ?? [];
  if (!existing.includes(id)) variants[key] = [...existing, id];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function positiveNumber(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function roundTime(value: number): number {
  return round(value, 4);
}

function round(value: number, digits = 2): number {
  const multiplier = Math.pow(10, digits);
  return Math.round(value * multiplier) / multiplier;
}
