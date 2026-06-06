import type { CharacterAngle } from "../types";
import {
  ANGLE_RIG_JSON_KIND,
  CHARACTER_JSON_KIND,
  CHARACTER_JSON_SCHEMA_VERSION,
  MOTION_JSON_KIND,
  type AngleRigJson,
  type CharacterJson,
  type JsonValidationIssue,
  type JsonValidationResult,
  type MotionJson,
  type MotionTargetJson,
  type ResolvedMotionTarget,
  type StudioBoomJsonKind,
} from "./schema";

const NUMERIC_KEYFRAME_FIELDS = [
  "dx",
  "dy",
  "scale",
  "scaleX",
  "scaleY",
  "skewX",
  "skewY",
  "rotation",
  "originX",
  "originY",
  "opacity",
] as const;

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
        });
      }
      if (id) variantsBySlot.set(id, variants);
    });
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

  for (const [index, reach] of optionalArray(value.reaches).entries()) {
    const path = `$.reaches[${index}]`;
    if (!isRecord(reach)) {
      issues.error(path, "Expected reach object.");
      continue;
    }
    const slotId = requiredString(reach, "slotId", `${path}.slotId`, issues);
    if (slotId && !slotIds.has(slotId)) issues.error(`${path}.slotId`, `Missing slot "${slotId}".`);
  }

  return issues.result();
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
  requiredString(value, "category", "$.category", issues);
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
  return issues.result();
}

export function validateMotionJsonForAngle(
  motion: unknown,
  angleRig: AngleRigJson,
): JsonValidationResult {
  const base = validateMotionJson(motion);
  const issues = makeIssues(base.errors, base.warnings);
  if (!base.ok || !isRecord(motion) || !Array.isArray(motion.tracks)) return issues.result();
  for (const [index, track] of motion.tracks.entries()) {
    if (!isRecord(track)) continue;
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
  }
  return issues.result();
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
