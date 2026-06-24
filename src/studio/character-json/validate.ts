import type { CharacterAngle, CharacterVariantKind } from "../types";
import {
  ANGLE_RIG_JSON_KIND,
  CHARACTER_JSON_KIND,
  CHARACTER_JSON_SCHEMA_VERSION,
  MOTION_EASE_NAMES,
  MOTION_JSON_KIND,
  MOTION_TRANSFORM_FIELD_NAMES,
  normalizeMotionCategory,
  normalizeMotionCategoryForImport,
  type AngleRigJson,
  type CharacterJson,
  type JsonValidationIssue,
  type JsonValidationResult,
  type MotionJson,
  type MotionJsonTrack,
  type MotionTargetJson,
  type ResolvedMotionTarget,
  type StudioBoomJsonKind,
} from "./schema";

// Single source of truth — the same transform vocabulary the prompt advertises and the adapter
// interpolates. Adding a field in schema.ts updates validation, prompt, and adapter together.
const NUMERIC_KEYFRAME_FIELDS = MOTION_TRANSFORM_FIELD_NAMES;
const SUPPORTED_EASE_NAMES = new Set<string>(MOTION_EASE_NAMES);
const CHARACTER_ANGLE_VALUES = new Set(["front", "3qL", "3qR", "sideL", "sideR"]);
const CHARACTER_VARIANT_KIND_VALUES = new Set<CharacterVariantKind>([
  "pose",
  "eyeState",
  "viseme",
  "handShape",
  "mouthShape",
  "expression",
  "custom",
]);

export function identifyJsonArtifact(value: unknown): StudioBoomJsonKind | null {
  if (!isRecord(value)) return null;
  return typeof value.kind === "string" ? (value.kind as StudioBoomJsonKind) : null;
}

export function parseJsonArtifact(text: string): { value?: unknown; error?: string } {
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invalid JSON." };
  }
}

export function validateCharacterJson(value: unknown): JsonValidationResult {
  const issues = makeIssues();
  if (!isRecord(value)) {
    issues.error("$", "Expected a character JSON object.");
    return issues.result();
  }
  validateBase(value, CHARACTER_JSON_KIND, issues);
  requiredString(value, "id", "$.id", issues);
  requiredString(value, "name", "$.name", issues);
  requiredString(value, "defaultAngle", "$.defaultAngle", issues);
  validateUniqueStringArray(value.angles, "$.angles", issues);
  if (
    typeof value.defaultAngle === "string" &&
    Array.isArray(value.angles) &&
    !value.angles.includes(value.defaultAngle)
  ) {
    issues.error("$.defaultAngle", "defaultAngle must be listed in angles.");
  }

  if (!Array.isArray(value.semanticBones)) {
    issues.error("$.semanticBones", "Expected semanticBones array.");
  } else {
    validateUniqueObjects(value.semanticBones, "$.semanticBones", issues, (bone, path) => {
      requiredString(bone, "id", `${path}.id`, issues);
      requiredString(bone, "name", `${path}.name`, issues);
      requiredString(bone, "role", `${path}.role`, issues);
    });
  }

  if (!Array.isArray(value.semanticSlots)) {
    issues.error("$.semanticSlots", "Expected semanticSlots array.");
  } else {
    validateUniqueObjects(value.semanticSlots, "$.semanticSlots", issues, (slot, path) => {
      requiredString(slot, "id", `${path}.id`, issues);
      requiredString(slot, "name", `${path}.name`, issues);
      requiredString(slot, "role", `${path}.role`, issues);
      requiredString(slot, "semanticType", `${path}.semanticType`, issues);
      validateOptionalAngleIds(slot.angleIds, `${path}.angleIds`, issues);
    });
  }

  return issues.result();
}

export function validateAngleRigJson(value: unknown): JsonValidationResult {
  const issues = makeIssues();
  if (!isRecord(value)) {
    issues.error("$", "Expected an angle rig JSON object.");
    return issues.result();
  }
  validateBase(value, ANGLE_RIG_JSON_KIND, issues);
  requiredString(value, "characterId", "$.characterId", issues);
  requiredString(value, "angleId", "$.angleId", issues);
  if (!isRecord(value.canvas)) {
    issues.error("$.canvas", "Expected canvas object.");
  } else {
    finitePositive(value.canvas.width, "$.canvas.width", issues);
    finitePositive(value.canvas.height, "$.canvas.height", issues);
  }

  const boneIds = new Set<string>();
  if (!Array.isArray(value.bones)) {
    issues.error("$.bones", "Expected bones array.");
  } else {
    validateUniqueObjects(value.bones, "$.bones", issues, (bone, path) => {
      const id = requiredString(bone, "id", `${path}.id`, issues);
      if (id) boneIds.add(id);
      requiredString(bone, "name", `${path}.name`, issues);
      finiteNumber(bone.x, `${path}.x`, issues);
      finiteNumber(bone.y, `${path}.y`, issues);
      finiteNumber(bone.rotation, `${path}.rotation`, issues);
    });
    for (const [index, bone] of value.bones.entries()) {
      if (isRecord(bone) && typeof bone.parentId === "string" && !boneIds.has(bone.parentId)) {
        issues.error(`$.bones[${index}].parentId`, `Missing parent bone "${bone.parentId}".`);
      }
    }
  }

  const slotIds = new Set<string>();
  const variantsBySlot = new Map<string, Set<string>>();
  if (!Array.isArray(value.slots)) {
    issues.error("$.slots", "Expected slots array.");
  } else {
    validateUniqueObjects(value.slots, "$.slots", issues, (slot, path) => {
      const id = requiredString(slot, "id", `${path}.id`, issues);
      if (id) slotIds.add(id);
      requiredString(slot, "name", `${path}.name`, issues);
      requiredString(slot, "role", `${path}.role`, issues);
      const variants = new Set<string>();
      if (!Array.isArray(slot.variants)) {
        issues.error(`${path}.variants`, "Expected variants array.");
      } else {
        validateUniqueObjects(slot.variants, `${path}.variants`, issues, (variant, variantPath) => {
          const variantId = requiredString(variant, "id", `${variantPath}.id`, issues);
          if (variantId) variants.add(variantId);
          requiredString(variant, "mediaId", `${variantPath}.mediaId`, issues);
          requiredString(variant, "name", `${variantPath}.name`, issues);
          if (variant.displayName !== undefined && typeof variant.displayName !== "string")
            issues.error(`${variantPath}.displayName`, "Expected string.");
          if (variant.slotCompatibility !== undefined)
            validateUniqueStringArray(
              variant.slotCompatibility,
              `${variantPath}.slotCompatibility`,
              issues,
            );
          validateOptionalAngleIds(variant.angleIds, `${variantPath}.angleIds`, issues);
          validateOptionalVariant(variant.variant, `${variantPath}.variant`, issues);
          validateOptionalArtwork(variant.artwork, `${variantPath}.artwork`, issues);
          validateOptionalVariantRigPackage(variant.rig, `${variantPath}.rig`, issues);
          validateOptionalAiMetadata(variant.aiMetadata, `${variantPath}.aiMetadata`, issues);
          if (variant.registration !== undefined) {
            validatePinTransform(variant.registration, `${variantPath}.registration`, issues);
          }
          if (variant.pins !== undefined && !isRecord(variant.pins)) {
            issues.error(`${variantPath}.pins`, "Expected pin record.");
          } else if (isRecord(variant.pins)) {
            for (const [pinName, pin] of Object.entries(variant.pins)) {
              validatePinTransform(pin, `${variantPath}.pins["${pinName}"]`, issues);
            }
          }
        });
      }
      if (id) variantsBySlot.set(id, variants);
    });
  }

  for (const [index, bone] of optionalArray(value.bones).entries()) {
    if (!isRecord(bone) || bone.restSource === undefined) continue;
    const path = `$.bones[${index}].restSource`;
    if (!isRecord(bone.restSource)) {
      issues.error(path, "Expected restSource object.");
      continue;
    }
    const parentSlotId = requiredString(
      bone.restSource,
      "parentSlotId",
      `${path}.parentSlotId`,
      issues,
    );
    if (parentSlotId && !slotIds.has(parentSlotId)) {
      issues.error(`${path}.parentSlotId`, `Missing parent slot "${parentSlotId}".`);
    }
    requiredString(bone.restSource, "pinName", `${path}.pinName`, issues);
    if (bone.restSource.offset !== undefined) {
      validateSocketLike(bone.restSource.offset, `${path}.offset`, issues);
    }
  }

  if (!Array.isArray(value.bindings)) {
    issues.error("$.bindings", "Expected bindings array.");
  } else {
    const boundSlots = new Set<string>();
    for (const [index, binding] of value.bindings.entries()) {
      const path = `$.bindings[${index}]`;
      if (!isRecord(binding)) {
        issues.error(path, "Expected binding object.");
        continue;
      }
      const slotId = requiredString(binding, "slotId", `${path}.slotId`, issues);
      const boneId = requiredString(binding, "boneId", `${path}.boneId`, issues);
      if (slotId && boundSlots.has(slotId))
        issues.error(`${path}.slotId`, `Duplicate binding for "${slotId}".`);
      if (slotId) boundSlots.add(slotId);
      if (slotId && !slotIds.has(slotId))
        issues.error(`${path}.slotId`, `Missing slot "${slotId}".`);
      if (boneId && !boneIds.has(boneId))
        issues.error(`${path}.boneId`, `Missing bone "${boneId}".`);
      finiteNumber(binding.x, `${path}.x`, issues);
      finiteNumber(binding.y, `${path}.y`, issues);
      finiteNumber(binding.rotation, `${path}.rotation`, issues);
      finitePositive(binding.scaleX, `${path}.scaleX`, issues);
      finitePositive(binding.scaleY, `${path}.scaleY`, issues);
      finiteNumber(binding.depth, `${path}.depth`, issues);
      if (
        slotId &&
        typeof binding.defaultVariant === "string" &&
        !(variantsBySlot.get(slotId)?.has(binding.defaultVariant) ?? false)
      ) {
        issues.warn(
          `${path}.defaultVariant`,
          `Variant "${binding.defaultVariant}" is not defined on "${slotId}".`,
        );
      }
    }
  }

  if (!Array.isArray(value.drawOrder)) {
    issues.error("$.drawOrder", "Expected drawOrder array.");
  } else {
    for (const [index, slotId] of value.drawOrder.entries()) {
      if (typeof slotId !== "string") {
        issues.error(`$.drawOrder[${index}]`, "Expected slot id string.");
      } else if (!slotIds.has(slotId)) {
        issues.error(`$.drawOrder[${index}]`, `Draw order references missing slot "${slotId}".`);
      }
    }
  }

  for (const [index, constraint] of optionalArray(value.hostConstraints).entries()) {
    const path = `$.hostConstraints[${index}]`;
    if (!isRecord(constraint)) {
      issues.error(path, "Expected host constraint object.");
      continue;
    }
    const slotId = requiredString(constraint, "slotId", `${path}.slotId`, issues);
    if (slotId && !slotIds.has(slotId)) issues.error(`${path}.slotId`, `Missing slot "${slotId}".`);
    if (typeof constraint.hostSlotId === "string" && !slotIds.has(constraint.hostSlotId)) {
      issues.error(`${path}.hostSlotId`, `Missing host slot "${constraint.hostSlotId}".`);
    }
    if (typeof constraint.hostBoneId === "string" && !boneIds.has(constraint.hostBoneId)) {
      issues.error(`${path}.hostBoneId`, `Missing host bone "${constraint.hostBoneId}".`);
    }
  }

  for (const [index, relation] of optionalArray(value.slotRelations).entries()) {
    const path = `$.slotRelations[${index}]`;
    if (!isRecord(relation)) {
      issues.error(path, "Expected slot relation object.");
      continue;
    }
    const childSlotId = requiredString(relation, "childSlotId", `${path}.childSlotId`, issues);
    if (childSlotId && !slotIds.has(childSlotId)) {
      issues.error(`${path}.childSlotId`, `Missing child slot "${childSlotId}".`);
    }
    if (!isRecord(relation.parentRef)) {
      issues.error(`${path}.parentRef`, "Expected parentRef object.");
      continue;
    }
    const parentType = requiredString(relation.parentRef, "type", `${path}.parentRef.type`, issues);
    if (parentType === "slot" || parentType === "semanticSlot") {
      const parentId = requiredString(relation.parentRef, "id", `${path}.parentRef.id`, issues);
      if (parentId && !slotIds.has(parentId)) {
        issues.error(`${path}.parentRef.id`, `Missing parent slot "${parentId}".`);
      }
    } else if (parentType === "bone") {
      const parentId = requiredString(relation.parentRef, "id", `${path}.parentRef.id`, issues);
      if (parentId && !boneIds.has(parentId)) {
        issues.error(`${path}.parentRef.id`, `Missing parent bone "${parentId}".`);
      }
    } else if (parentType !== "role") {
      issues.error(`${path}.parentRef.type`, `Unknown parentRef type "${parentType}".`);
    }
    if (typeof relation.clipSlotId === "string" && !slotIds.has(relation.clipSlotId)) {
      issues.error(`${path}.clipSlotId`, `Missing clip slot "${relation.clipSlotId}".`);
    }
  }

  for (const [index, reach] of optionalArray(value.reaches).entries()) {
    const path = `$.reaches[${index}]`;
    if (!isRecord(reach)) {
      issues.error(path, "Expected reach object.");
      continue;
    }
    const slotId = requiredString(reach, "slotId", `${path}.slotId`, issues);
    if (slotId && !slotIds.has(slotId)) issues.error(`${path}.slotId`, `Missing slot "${slotId}".`);
  }

  for (const [index, contract] of optionalArray(value.pinContracts).entries()) {
    const path = `$.pinContracts[${index}]`;
    if (!isRecord(contract)) {
      issues.error(path, "Expected pin contract object.");
      continue;
    }
    const slotId = requiredString(contract, "parentSlotId", `${path}.parentSlotId`, issues);
    if (slotId && !slotIds.has(slotId))
      issues.error(`${path}.parentSlotId`, `Missing slot "${slotId}".`);
    const childBoneId = requiredString(contract, "childBoneId", `${path}.childBoneId`, issues);
    if (childBoneId && !boneIds.has(childBoneId))
      issues.error(`${path}.childBoneId`, `Missing bone "${childBoneId}".`);
    const childSlotId = typeof contract.childSlotId === "string" ? contract.childSlotId : undefined;
    if (childSlotId && !slotIds.has(childSlotId))
      issues.error(`${path}.childSlotId`, `Missing slot "${childSlotId}".`);
    requiredString(contract, "pinName", `${path}.pinName`, issues);
  }

  return issues.result();
}

function validateOptionalArtwork(
  value: unknown,
  path: string,
  issues: ReturnType<typeof makeIssues>,
) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.error(path, "Expected artwork object.");
    return;
  }
  if (value.partIds !== undefined)
    validateUniqueStringArray(value.partIds, `${path}.partIds`, issues);
  if (value.layers !== undefined && !Array.isArray(value.layers)) {
    issues.error(`${path}.layers`, "Expected layers array.");
  }
  for (const [index, layer] of optionalArray(value.layers).entries()) {
    const layerPath = `${path}.layers[${index}]`;
    if (!isRecord(layer)) {
      issues.error(layerPath, "Expected layer object.");
      continue;
    }
    requiredString(layer, "id", `${layerPath}.id`, issues);
    if (layer.partId !== undefined && typeof layer.partId !== "string")
      issues.error(`${layerPath}.partId`, "Expected string.");
    if (layer.mediaId !== undefined && typeof layer.mediaId !== "string")
      issues.error(`${layerPath}.mediaId`, "Expected string.");
    if (layer.zIndex !== undefined) finiteNumber(layer.zIndex, `${layerPath}.zIndex`, issues);
  }
}

function validateOptionalVariantRigPackage(
  value: unknown,
  path: string,
  issues: ReturnType<typeof makeIssues>,
) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.error(path, "Expected rig object.");
    return;
  }
  const boneIds = new Set<string>();
  for (const [index, bone] of optionalArray(value.bones).entries()) {
    const bonePath = `${path}.bones[${index}]`;
    if (!isRecord(bone)) {
      issues.error(bonePath, "Expected bone object.");
      continue;
    }
    const id = requiredString(bone, "id", `${bonePath}.id`, issues);
    if (id) boneIds.add(id);
    validateSocketLike(bone.pivot, `${bonePath}.pivot`, issues);
    if (bone.defaultRotation !== undefined)
      finiteNumber(bone.defaultRotation, `${bonePath}.defaultRotation`, issues);
    validateOptionalNumberPair(bone.rotationLimits, `${bonePath}.rotationLimits`, issues);
  }
  for (const [index, control] of optionalArray(value.controls).entries()) {
    const controlPath = `${path}.controls[${index}]`;
    if (!isRecord(control)) {
      issues.error(controlPath, "Expected control object.");
      continue;
    }
    requiredString(control, "id", `${controlPath}.id`, issues);
    requiredString(control, "label", `${controlPath}.label`, issues);
    requiredString(control, "type", `${controlPath}.type`, issues);
    if (
      typeof control.targetBoneId === "string" &&
      boneIds.size > 0 &&
      !boneIds.has(control.targetBoneId)
    ) {
      issues.error(
        `${controlPath}.targetBoneId`,
        `Missing variant bone "${control.targetBoneId}".`,
      );
    }
    validateOptionalNumberPair(control.range, `${controlPath}.range`, issues);
  }
  if (value.clipping !== undefined && !isRecord(value.clipping)) {
    issues.error(`${path}.clipping`, "Expected clipping object.");
  } else if (isRecord(value.clipping)) {
    if (value.clipping.maskPartIds !== undefined)
      validateUniqueStringArray(value.clipping.maskPartIds, `${path}.clipping.maskPartIds`, issues);
    if (value.clipping.coverPartIds !== undefined)
      validateUniqueStringArray(
        value.clipping.coverPartIds,
        `${path}.clipping.coverPartIds`,
        issues,
      );
    if (value.clipping.rules !== undefined)
      validateUniqueStringArray(value.clipping.rules, `${path}.clipping.rules`, issues);
  }
  if (value.sockets !== undefined && !isRecord(value.sockets)) {
    issues.error(`${path}.sockets`, "Expected sockets object.");
  } else if (isRecord(value.sockets)) {
    if (value.sockets.mount !== undefined)
      validateSocketLike(value.sockets.mount, `${path}.sockets.mount`, issues);
    for (const [index, socket] of optionalArray(value.sockets.outputs).entries()) {
      const socketPath = `${path}.sockets.outputs[${index}]`;
      validateSocketLike(socket, socketPath, issues);
      if (
        isRecord(socket) &&
        socket.childSlotId !== undefined &&
        typeof socket.childSlotId !== "string"
      )
        issues.error(`${socketPath}.childSlotId`, "Expected string.");
    }
  }
  if (value.zOrder !== undefined) validateUniqueStringArray(value.zOrder, `${path}.zOrder`, issues);
}

function validateOptionalAiMetadata(
  value: unknown,
  path: string,
  issues: ReturnType<typeof makeIssues>,
) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.error(path, "Expected AI metadata object.");
    return;
  }
  requiredString(value, "plainDescription", `${path}.plainDescription`, issues);
  if (value.tags !== undefined) validateUniqueStringArray(value.tags, `${path}.tags`, issues);
  if (value.goodFor !== undefined)
    validateUniqueStringArray(value.goodFor, `${path}.goodFor`, issues);
  if (value.lessIdealFor !== undefined)
    validateUniqueStringArray(value.lessIdealFor, `${path}.lessIdealFor`, issues);
}

function validateSocketLike(value: unknown, path: string, issues: ReturnType<typeof makeIssues>) {
  if (!isRecord(value)) {
    issues.error(path, "Expected point object.");
    return;
  }
  finiteNumber(value.x, `${path}.x`, issues);
  finiteNumber(value.y, `${path}.y`, issues);
  if (value.rotation !== undefined) finiteNumber(value.rotation, `${path}.rotation`, issues);
}

function validatePinTransform(value: unknown, path: string, issues: ReturnType<typeof makeIssues>) {
  validateSocketLike(value, path, issues);
  if (isRecord(value) && value.space !== "part-local-pixels") {
    issues.error(`${path}.space`, 'Expected "part-local-pixels".');
  }
}

function validateOptionalNumberPair(
  value: unknown,
  path: string,
  issues: ReturnType<typeof makeIssues>,
) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length !== 2) {
    issues.error(path, "Expected two-number tuple.");
    return;
  }
  finiteNumber(value[0], `${path}[0]`, issues);
  finiteNumber(value[1], `${path}[1]`, issues);
}

function validateOptionalVariant(
  value: unknown,
  path: string,
  issues: ReturnType<typeof makeIssues>,
) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.error(path, "Expected variant object.");
    return;
  }
  requiredString(value, "key", `${path}.key`, issues);
  if (value.name !== undefined && typeof value.name !== "string") {
    issues.error(`${path}.name`, "Expected string.");
  }
  if (
    value.kind !== undefined &&
    (typeof value.kind !== "string" ||
      !CHARACTER_VARIANT_KIND_VALUES.has(value.kind as CharacterVariantKind))
  ) {
    issues.error(`${path}.kind`, "Expected known variant kind.");
  }
}

export function validateMotionJson(value: unknown): JsonValidationResult {
  const issues = makeIssues();
  if (!isRecord(value)) {
    issues.error("$", "Expected a motion JSON object.");
    return issues.result();
  }
  validateBase(value, MOTION_JSON_KIND, issues);
  requiredString(value, "id", "$.id", issues);
  requiredString(value, "name", "$.name", issues);
  const category = requiredString(value, "category", "$.category", issues);
  if (category && !normalizeMotionCategory(category)) {
    const normalized = normalizeMotionCategoryForImport(category);
    if (normalized.warning) issues.warn("$.category", normalized.warning);
  }
  validateOptionalAngleIds(value.angleIds, "$.angleIds", issues);
  finitePositive(value.duration, "$.duration", issues);
  if (value.targetSpace !== "parentRelative")
    issues.error("$.targetSpace", 'Expected "parentRelative" targetSpace.');
  if (typeof value.loop !== "boolean") issues.error("$.loop", "Expected boolean.");
  if (!Array.isArray(value.tracks)) {
    issues.error("$.tracks", "Expected tracks array.");
    return issues.result();
  }
  validateUniqueObjects(value.tracks, "$.tracks", issues, (track, path) => {
    requiredString(track, "id", `${path}.id`, issues);
    validateOptionalAngleIds(track.angleIds, `${path}.angleIds`, issues);
    validateMotionTarget(track.target, `${path}.target`, issues);
    requiredString(track, "channel", `${path}.channel`, issues);
    if (!Array.isArray(track.keyframes)) {
      issues.error(`${path}.keyframes`, "Expected keyframes array.");
      return;
    }
    for (const [index, keyframe] of track.keyframes.entries()) {
      validateMotionKeyframe(keyframe, `${path}.keyframes[${index}]`, issues, track.channel);
    }
  });
  for (const [index, item] of optionalArray(value.constraints?.allowOutOfBounds).entries()) {
    const path = `$.constraints.allowOutOfBounds[${index}]`;
    if (!isRecord(item)) {
      issues.error(path, "Expected allowOutOfBounds object.");
      continue;
    }
    validateMotionTarget(item.target, `${path}.target`, issues);
  }
  if (value.overlays !== undefined) {
    if (!Array.isArray(value.overlays)) {
      issues.error("$.overlays", "Expected overlays array.");
    } else if (value.overlays.length > 0) {
      // Reserved seam — restricted/sanitized vector overlays are a future render phase.
      issues.warn(
        "$.overlays",
        "Overlays are accepted but not rendered yet (restricted/sanitized vector overlays are a future phase).",
      );
    }
  }
  return issues.result();
}

export function validateMotionJsonForAngle(
  motion: unknown,
  angleRig: AngleRigJson,
): JsonValidationResult {
  const base = validateMotionJson(motion);
  const issues = makeIssues(base.errors, base.warnings);
  if (!base.ok || !isRecord(motion) || !Array.isArray(motion.tracks)) return issues.result();
  if (!angleIdsInclude(motion.angleIds, angleRig.angleId)) {
    issues.error("$.angleIds", `Motion is not available for angle "${angleRig.angleId}".`);
    return issues.result();
  }
  const transformBoneTracks: Array<{ index: number; boneId: string; track: MotionJsonTrack }> = [];
  for (const [index, track] of motion.tracks.entries()) {
    if (!isRecord(track)) continue;
    if (!angleIdsInclude(track.angleIds, angleRig.angleId)) continue;
    const target = track.target as MotionTargetJson;
    const resolved = resolveMotionTarget(target, angleRig);
    if (!resolved.ok) {
      issues.error(`$.tracks[${index}].target`, resolved.message);
      continue;
    }
    if (track.channel === "variant" && resolved.target.kind === "angleSlot") {
      const slot = angleRig.slots.find((candidate) => candidate.id === resolved.target.id);
      const variants = new Set(slot?.variants.map((variant) => variant.id) ?? []);
      for (const [kfIndex, keyframe] of optionalArray(track.keyframes).entries()) {
        if (
          isRecord(keyframe) &&
          typeof keyframe.variant === "string" &&
          variants.size > 0 &&
          !variants.has(keyframe.variant)
        ) {
          issues.error(
            `$.tracks[${index}].keyframes[${kfIndex}].variant`,
            `Variant "${keyframe.variant}" is not defined on slot "${resolved.target.id}".`,
          );
        }
      }
    }
    if (track.channel === "transform" && resolved.target.kind === "angleBone") {
      transformBoneTracks.push({
        index,
        boneId: resolved.target.id,
        track: track as MotionJsonTrack,
      });
    }
  }
  validateMotionBoneLocks(transformBoneTracks, angleRig, issues);
  return issues.result();
}

function validateMotionBoneLocks(
  transformBoneTracks: Array<{ index: number; boneId: string; track: MotionJsonTrack }>,
  angleRig: AngleRigJson,
  issues: ReturnType<typeof makeIssues>,
) {
  if (transformBoneTracks.length === 0) return;
  const boneById = new Map(angleRig.bones.map((bone) => [bone.id, bone]));
  const tracksByBone = new Map<string, Array<{ index: number; track: MotionJsonTrack }>>();
  for (const info of transformBoneTracks) {
    tracksByBone.set(info.boneId, [...(tracksByBone.get(info.boneId) ?? []), info]);
  }
  for (const info of transformBoneTracks) {
    const bone = boneById.get(info.boneId);
    if (!bone?.parentId) continue;
    const ancestors = ancestorBoneIds(info.boneId, boneById);
    const animatedAncestor = ancestors.find((ancestorId) => tracksByBone.has(ancestorId));
    const translates = trackHasNonZeroFields(info.track, ["dx", "dy"]);
    if (animatedAncestor && translates) {
      issues.error(
        `$.tracks[${info.index}]`,
        `Child bone "${info.boneId}" has dx/dy while ancestor "${animatedAncestor}" is also animated. Child bones inherit ancestor movement; animate the parent/ancestor for placement and keep the child transform local unless IK is added.`,
      );
      continue;
    }
    if (translates) {
      issues.warn(
        `$.tracks[${info.index}]`,
        `Bone "${info.boneId}" is attached to parent "${bone.parentId}" and has dx/dy. Translation moves the authored joint socket; prefer rotating this bone or moving an ancestor.`,
      );
    }
    if (
      animatedAncestor &&
      trackHasNonZeroFields(info.track, [
        "rotation",
        "rotationX",
        "rotationY",
        "scale",
        "scaleX",
        "scaleY",
        "skewX",
        "skewY",
      ])
    ) {
      issues.warn(
        `$.tracks[${info.index}]`,
        `Child bone "${info.boneId}" is animated while ancestor "${animatedAncestor}" is also animated. This is relative local articulation; keep it small so the FK attachment reads as locked.`,
      );
    }
  }
}

function ancestorBoneIds(
  boneId: string,
  boneById: Map<string, AngleRigJson["bones"][number]>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let current = boneById.get(boneId);
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    out.push(current.parentId);
    current = boneById.get(current.parentId);
  }
  return out;
}

function trackHasNonZeroFields(track: MotionJsonTrack, fields: readonly string[]): boolean {
  return optionalArray(track.keyframes).some(
    (keyframe) =>
      isRecord(keyframe) &&
      fields.some((field) => {
        const value = keyframe[field];
        return typeof value === "number" && Number.isFinite(value) && Math.abs(value) > 0.0001;
      }),
  );
}

export function resolveMotionTarget(
  target: MotionTargetJson,
  angleRig: AngleRigJson,
): { ok: true; target: ResolvedMotionTarget } | { ok: false; message: string } {
  if (target.kind === "camera") {
    return {
      ok: true,
      target: { requested: target, angleId: angleRig.angleId, kind: "camera", id: "__camera" },
    };
  }
  if (target.kind === "angleBone") {
    if (target.angleId !== angleRig.angleId)
      return {
        ok: false,
        message: `Target is for angle "${target.angleId}", not active angle "${angleRig.angleId}".`,
      };
    if (!angleRig.bones.some((bone) => bone.id === target.id))
      return { ok: false, message: `Angle bone "${target.id}" does not exist.` };
    return {
      ok: true,
      target: { requested: target, angleId: angleRig.angleId, kind: "angleBone", id: target.id },
    };
  }
  if (target.kind === "angleSlot") {
    if (target.angleId !== angleRig.angleId)
      return {
        ok: false,
        message: `Target is for angle "${target.angleId}", not active angle "${angleRig.angleId}".`,
      };
    if (!angleRig.slots.some((slot) => slot.id === target.id))
      return { ok: false, message: `Angle slot "${target.id}" does not exist.` };
    return {
      ok: true,
      target: { requested: target, angleId: angleRig.angleId, kind: "angleSlot", id: target.id },
    };
  }
  if (target.kind === "semanticBone") {
    const bone = angleRig.bones.find((candidate) => candidate.semanticBoneId === target.id);
    if (!bone)
      return {
        ok: false,
        message: `Motion targets semantic bone "${target.id}", but angle "${angleRig.angleId}" has no mapped bone.`,
      };
    return {
      ok: true,
      target: { requested: target, angleId: angleRig.angleId, kind: "angleBone", id: bone.id },
    };
  }
  const slot = angleRig.slots.find((candidate) => candidate.semanticSlotId === target.id);
  if (!slot)
    return {
      ok: false,
      message: `Motion targets semantic slot "${target.id}", but angle "${angleRig.angleId}" has no mapped slot.`,
    };
  return {
    ok: true,
    target: { requested: target, angleId: angleRig.angleId, kind: "angleSlot", id: slot.id },
  };
}

function validateBase(
  value: Record<string, unknown>,
  kind: string,
  issues: ReturnType<typeof makeIssues>,
) {
  if (value.kind !== kind) issues.error("$.kind", `Expected kind "${kind}".`);
  if (value.schemaVersion !== CHARACTER_JSON_SCHEMA_VERSION)
    issues.error("$.schemaVersion", `Expected schemaVersion ${CHARACTER_JSON_SCHEMA_VERSION}.`);
  requiredString(value, "suggestedFilename", "$.suggestedFilename", issues);
}

function validateMotionTarget(value: unknown, path: string, issues: ReturnType<typeof makeIssues>) {
  if (!isRecord(value)) {
    issues.error(path, "Expected target object.");
    return;
  }
  const kind = requiredString(value, "kind", `${path}.kind`, issues);
  if (!kind) return;
  if (!["semanticBone", "semanticSlot", "angleBone", "angleSlot", "camera"].includes(kind)) {
    issues.error(`${path}.kind`, `Unknown target kind "${kind}".`);
    return;
  }
  if (kind !== "camera") requiredString(value, "id", `${path}.id`, issues);
  if (kind === "angleBone" || kind === "angleSlot")
    requiredString(value, "angleId", `${path}.angleId`, issues);
}

function validateOptionalAngleIds(
  value: unknown,
  path: string,
  issues: ReturnType<typeof makeIssues>,
) {
  if (value === undefined) return;
  validateUniqueStringArray(value, path, issues);
  if (!Array.isArray(value)) return;
  for (const [index, angle] of value.entries()) {
    if (typeof angle === "string" && !CHARACTER_ANGLE_VALUES.has(angle)) {
      issues.error(`${path}[${index}]`, `Unknown angle "${angle}".`);
    }
  }
}

function angleIdsInclude(value: unknown, angle: CharacterAngle): boolean {
  if (!Array.isArray(value) || value.length === 0) return true;
  return value.includes(angle);
}

function validateMotionKeyframe(
  value: unknown,
  path: string,
  issues: ReturnType<typeof makeIssues>,
  channel: unknown,
) {
  if (!isRecord(value)) {
    issues.error(path, "Expected keyframe object.");
    return;
  }
  finiteNumber(value.t, `${path}.t`, issues);
  if (typeof value.t === "number" && (value.t < 0 || value.t > 1))
    issues.error(`${path}.t`, "Expected normalized time from 0 to 1.");
  for (const field of NUMERIC_KEYFRAME_FIELDS) {
    if (value[field] !== undefined) finiteNumber(value[field], `${path}.${field}`, issues);
  }
  if (channel === "variant" && typeof value.variant !== "string")
    issues.error(`${path}.variant`, "Variant tracks require a variant string.");
  if (value.visible !== undefined && typeof value.visible !== "boolean")
    issues.error(`${path}.visible`, "Expected boolean visible value.");
  if (value.ease !== undefined) {
    if (typeof value.ease !== "string") {
      issues.error(`${path}.ease`, "Expected string ease name.");
    } else if (!SUPPORTED_EASE_NAMES.has(value.ease)) {
      issues.warn(
        `${path}.ease`,
        `Unknown ease "${value.ease}" will fall back to easeInOut. Supported: ${MOTION_EASE_NAMES.join(", ")}.`,
      );
    }
  }
}

function validateUniqueStringArray(
  value: unknown,
  path: string,
  issues: ReturnType<typeof makeIssues>,
) {
  if (!Array.isArray(value)) {
    issues.error(path, "Expected string array.");
    return;
  }
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || !item.trim()) {
      issues.error(`${path}[${index}]`, "Expected non-empty string.");
      continue;
    }
    if (seen.has(item)) issues.error(`${path}[${index}]`, `Duplicate id "${item}".`);
    seen.add(item);
  }
}

function validateUniqueObjects(
  value: unknown[],
  path: string,
  issues: ReturnType<typeof makeIssues>,
  validate: (item: Record<string, unknown>, path: string) => void,
) {
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      issues.error(itemPath, "Expected object.");
      continue;
    }
    if (typeof item.id === "string") {
      if (seen.has(item.id)) issues.error(`${itemPath}.id`, `Duplicate id "${item.id}".`);
      seen.add(item.id);
    }
    validate(item, itemPath);
  }
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: ReturnType<typeof makeIssues>,
): string | null {
  const item = value[key];
  if (typeof item !== "string" || !item.trim()) {
    issues.error(path, "Expected non-empty string.");
    return null;
  }
  return item;
}

function finiteNumber(value: unknown, path: string, issues: ReturnType<typeof makeIssues>) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.error(path, "Expected finite number.");
  }
}

function finitePositive(value: unknown, path: string, issues: ReturnType<typeof makeIssues>) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    issues.error(path, "Expected finite positive number.");
  }
}

function optionalArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function makeIssues(
  initialErrors: JsonValidationIssue[] = [],
  initialWarnings: JsonValidationIssue[] = [],
) {
  const errors = [...initialErrors];
  const warnings = [...initialWarnings];
  return {
    error(path: string, message: string) {
      errors.push({ path, message });
    },
    warn(path: string, message: string) {
      warnings.push({ path, message });
    },
    result(): JsonValidationResult {
      return { ok: errors.length === 0, errors, warnings };
    },
  };
}
