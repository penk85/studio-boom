// Character helpers — create/load/save CharacterPreset records.
import { db, deleteMediaIfUnused, mediaIdsForCharacter, uid } from "../db";
import {
  DEFAULT_PARALLAX_CONFIG,
  DEFAULT_PART_MANIFEST,
  type CharacterAngle,
  type CharacterSlotVariant,
  type CharacterSlotVariantPackage,
  type CharacterVariantKind,
  type ID,
  type CharacterPart,
  type CharacterPreset,
  type CharacterRig,
  type CharacterSlot,
  type FallbackMouthAnchor,
  type MouthViseme,
  type PartManifest,
  type PartRole,
} from "../types";
import { legacyVisemeToStandard } from "../lipsync/viseme-schema";
import { alphaCenterForPart, pivotForPart } from "./alpha-bounds";
import { normalizePartRegistration } from "./registration";
import { inferPartSide, isSidedSlotRole } from "./side-utils";

export { inferPartSide } from "./side-utils";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const CHARACTER_ANGLE_VALUES: CharacterAngle[] = ["front", "3qL", "3qR", "sideL", "sideR"];

export const CHARACTER_VARIANT_KIND_VALUES: CharacterVariantKind[] = [
  "pose",
  "eyeState",
  "viseme",
  "handShape",
  "mouthShape",
  "expression",
  "custom",
];

export function defaultFallbackMouthAnchor(
  canvasWidth: number,
  canvasHeight: number,
): FallbackMouthAnchor {
  const width = Math.round(canvasWidth * 0.14);
  const height = Math.round(width * 0.42);
  return {
    x: Math.round((canvasWidth - width) / 2),
    y: Math.round(canvasHeight * 0.42 - height / 2),
    width,
    height,
    rotation: 0,
    anchorX: 0.5,
    anchorY: 0.5,
    zIndex: 50,
    depth: 0,
  };
}

export function createBlankCharacter(name = "New Character"): CharacterPreset {
  const now = Date.now();
  return {
    id: uid(),
    name,
    canvasWidth: 600,
    canvasHeight: 900,
    angles: ["front"],
    slots: [],
    parts: [],
    manifest: { ...DEFAULT_PART_MANIFEST },
    parallax: { ...DEFAULT_PARALLAX_CONFIG },
    headVariants: [],
    fallbackMouth: defaultFallbackMouthAnchor(600, 900),
    createdAt: now,
    updatedAt: now,
  };
}

export async function saveCharacter(c: CharacterPreset) {
  const updated = { ...normalizeCharacterSlots(c), updatedAt: Date.now() };
  const previous = await db.characters.get(updated.id);
  await db.characters.put(updated);
  const nextMediaIds = mediaIdsForCharacter(updated);
  const removedMediaIds = Array.from(mediaIdsForCharacter(previous)).filter(
    (id) => !nextMediaIds.has(id),
  );
  await Promise.all(removedMediaIds.map((id) => deleteMediaIfUnused(id, { internalOnly: true })));
  return updated;
}

export function defaultSlotIdForRole(
  role: PartRole,
  partId?: string,
  side?: CharacterPart["side"],
): string {
  if (side && isSidedSlotRole(role) && (side === "left" || side === "right")) {
    return `slot:${side}-${role}`;
  }
  if (side && role === "hair" && (side === "front" || side === "back")) {
    return `slot:${side}-${role}`;
  }
  return role === "custom" && partId ? `custom:${partId}` : `role:${role}`;
}

export function getPartSlotId(part: CharacterPart): ID {
  return normalizedStandardSlotId(
    part.slotId,
    part.slotName ?? part.name,
    part.role,
    inferPartSide(part),
    part.id,
  );
}

export function normalizeCharacterSlots(c: CharacterPreset): CharacterPreset {
  const restMouth = c.parts.find(
    (p) => normalizePartRole(p.role as string) === "mouth" && legacyVisemeToStandard(p.viseme),
  );
  const slotIdRemap = new Map<ID, ID>();
  const parts = c.parts.map((part) => {
    const role = normalizePartRole(part.role as string);
    const side = inferPartSide({ ...part, role }) ?? part.side;
    const slotId = normalizedStandardSlotId(
      part.slotId,
      part.slotName ?? part.name,
      role,
      side,
      part.id,
    );
    if (part.slotId && part.slotId !== slotId) slotIdRemap.set(part.slotId, slotId);
    const viseme = legacyVisemeToStandard(part.viseme) ?? part.viseme;
    const withNormalizedIds = { ...part, role, side, slotId, viseme };
    const alphaPivot = alphaCenterForPart(withNormalizedIds);
    const pivot = part.pivot ?? {
      x: Math.round(alphaPivot.x),
      y: Math.round(alphaPivot.y),
    };
    return normalizePartRegistration({
      ...part,
      role,
      side,
      slotId,
      viseme,
      variant: normalizePartVariant({ ...part, role, viseme }),
      angleId: normalizeAngleId(part.angleId),
      angleIds: normalizeAngleIds(part.angleIds),
      anchorX: clamp01((pivot.x - part.x) / Math.max(1, part.width)),
      anchorY: clamp01((pivot.y - part.y) / Math.max(1, part.height)),
      pivot,
      motionBehavior: part.motionBehavior ?? defaultMotionBehaviorForRole(role, viseme),
      morph:
        role === "mouth" && part.morph
          ? {
              ...part.morph,
              compatibleWithRest:
                part.morph.compatibleWithRest ??
                (!!restMouth?.morph?.commandCount &&
                  restMouth.morph.commandCount === part.morph.commandCount),
            }
          : part.morph,
    });
  });
  const slotRecords = c.slots?.map((slot) => ({
    ...slot,
    id: slotIdRemap.get(slot.id) ?? slot.id,
  }));
  const slots = normalizeSlotRecords(parts, slotRecords);
  const slotNames = new Map(slots.map((slot) => [slot.id, slot.name]));
  return {
    ...c,
    angles: normalizeAngleIds(c.angles) ?? c.angles,
    manifest: normalizePartManifest(c.manifest),
    fallbackMouth: c.fallbackMouth ?? defaultFallbackMouthAnchor(c.canvasWidth, c.canvasHeight),
    slots,
    rig: remapCharacterRigSlotIds(c.rig, slotIdRemap),
    parts: parts.map((part) => ({
      ...part,
      slotName: slotNames.get(part.slotId) ?? slotLabelForRoleSide(part.role, part.side),
      // The bone graph and part-local pins are the attachment authority. Clearing this legacy
      // artwork field prevents one stale variant from silently re-parenting the whole slot.
      parentId: undefined,
    })),
  };
}

function remapCharacterRigSlotIds(
  rig: CharacterRig | undefined,
  slotIds: ReadonlyMap<ID, ID>,
): CharacterRig | undefined {
  if (!rig || slotIds.size === 0) return rig;
  const slotId = (id: ID) => slotIds.get(id) ?? id;
  const boneIds = new Map(
    Array.from(slotIds, ([from, to]) => [`bone:${from}`, `bone:${to}`] as const),
  );
  const boneId = (id: ID | undefined) => (id ? (boneIds.get(id) ?? id) : undefined);
  const remapAngle = <
    T extends {
      bones: CharacterRig["bones"];
      slotBindings: CharacterRig["slotBindings"];
      drawOrder: CharacterRig["drawOrder"];
      slotRelations: CharacterRig["slotRelations"];
      hostConstraints: CharacterRig["hostConstraints"];
      reaches: CharacterRig["reaches"];
      sockets?: CharacterRig["sockets"];
    },
  >(
    angle: T,
  ): T => ({
    ...angle,
    bones: angle.bones.map((bone) => ({
      ...bone,
      id: boneId(bone.id) ?? bone.id,
      parentId: boneId(bone.parentId),
      restSource: bone.restSource
        ? { ...bone.restSource, slotId: slotId(bone.restSource.slotId) }
        : undefined,
    })),
    slotBindings: angle.slotBindings.map((binding) => ({
      ...binding,
      slotId: slotId(binding.slotId),
      boneId: boneId(binding.boneId) ?? binding.boneId,
    })),
    drawOrder: angle.drawOrder.map(slotId),
    slotRelations: angle.slotRelations.map((relation) => ({
      ...relation,
      childSlotId: slotId(relation.childSlotId),
      parentRef:
        relation.parentRef.type === "slot" || relation.parentRef.type === "semanticSlot"
          ? { ...relation.parentRef, id: slotId(relation.parentRef.id) }
          : relation.parentRef.type === "bone"
            ? { ...relation.parentRef, id: boneId(relation.parentRef.id) ?? relation.parentRef.id }
            : relation.parentRef,
    })),
    hostConstraints: angle.hostConstraints.map((constraint) => ({
      ...constraint,
      slotId: slotId(constraint.slotId),
      hostSlotId: slotId(constraint.hostSlotId),
      hostBoneId: boneId(constraint.hostBoneId),
    })),
    reaches: angle.reaches.map((reach) => ({ ...reach, slotId: slotId(reach.slotId) })),
    sockets: angle.sockets?.map((socket) => ({
      ...socket,
      slotId: slotId(socket.slotId),
      childSlotId: slotId(socket.childSlotId),
    })),
  });
  const remapped = remapAngle(rig);
  return {
    ...remapped,
    angles: Object.fromEntries(
      Object.entries(rig.angles ?? {}).map(([angle, value]) => [
        angle,
        value ? remapAngle(value) : value,
      ]),
    ),
  };
}

export function normalizePartVariant(
  part: Pick<CharacterPart, "variant" | "role" | "pose" | "viseme" | "eyeState">,
): CharacterSlotVariant | undefined {
  const key = part.variant?.key?.trim() || part.viseme || part.eyeState || part.pose;
  if (!key) return undefined;
  const name = part.variant?.name?.trim();
  return {
    key,
    ...(name ? { name } : {}),
    kind: part.variant?.kind ?? defaultVariantKindForPart(part),
  };
}

export type VariantKeySource =
  | "explicitKey"
  | "package"
  | "viseme"
  | "eyeState"
  | "pose"
  | "idFallback";

/**
 * The resolved variant key plus which field won the fallback chain. The authoring UI shows this
 * so "what key is this part, really?" is answerable at a glance; an `idFallback` in a
 * multi-variant slot is a rig smell (the part can never pair with parent variants by name).
 */
export function variantKeySourceForPart(
  part: Pick<CharacterPart, "variant" | "variantPackageId" | "pose" | "viseme" | "eyeState" | "id">,
): { key: string; source: VariantKeySource } {
  const explicit = part.variant?.key?.trim();
  if (explicit) return { key: explicit, source: "explicitKey" };
  if (part.variantPackageId) return { key: part.variantPackageId, source: "package" };
  if (part.viseme) return { key: part.viseme, source: "viseme" };
  if (part.eyeState) return { key: part.eyeState, source: "eyeState" };
  if (part.pose) return { key: part.pose, source: "pose" };
  return { key: part.id, source: "idFallback" };
}

export function variantKeyForPart(
  part: Pick<CharacterPart, "variant" | "variantPackageId" | "pose" | "viseme" | "eyeState" | "id">,
): string {
  return variantKeySourceForPart(part).key;
}

export function variantLabelForPart(
  part: Pick<CharacterPart, "variant" | "pose" | "viseme" | "eyeState" | "name">,
): string {
  return (
    part.variant?.name?.trim() ||
    part.variant?.key?.trim() ||
    part.viseme ||
    part.eyeState ||
    part.pose ||
    part.name
  );
}

export function variantAliasesForPart(
  part: Pick<CharacterPart, "id" | "variant" | "variantPackageId" | "pose" | "viseme" | "eyeState">,
): string[] {
  return uniqueStrings([
    variantKeyForPart(part),
    part.id,
    part.variantPackageId,
    part.variant?.key,
    part.pose,
    part.viseme,
    part.eyeState,
  ]);
}

export function partMatchesVariant(
  part: Pick<CharacterPart, "id" | "variant" | "pose" | "viseme" | "eyeState">,
  variantKey: string | undefined,
): boolean {
  return !!variantKey && variantAliasesForPart(part).includes(variantKey);
}

/**
 * The variant a multi-variant slot displays when nothing selects one: mouths rest, eyes open,
 * else the lowest visible layer. This is the rest-state vocabulary pose capture measures against.
 */
export function defaultVariantForSlotParts(
  parts: CharacterPart[],
  role: PartRole,
): string | undefined {
  const visible = parts.filter((part) => part.visible);
  const candidates = visible.length ? visible : parts;
  if (role === "mouth") {
    const rest = candidates.find((part) => partMatchesVariant(part, "rest"));
    if (rest) return variantKeyForPart(rest);
  }
  if (role === "eye") {
    const open = candidates.find((part) => partMatchesVariant(part, "open"));
    if (open) return variantKeyForPart(open);
  }
  const first = candidates.slice().sort((a, b) => a.zIndex - b.zIndex)[0];
  return first ? variantKeyForPart(first) : undefined;
}

/**
 * The part whose pivot represents a variant group — the same selection `keyedChildAnchor` uses
 * for anchor inference, so art placement and anchor resolution can never disagree.
 */
export function anchorPartForVariant(
  slotParts: CharacterPart[],
  variantKey: string | undefined,
): CharacterPart | undefined {
  if (!variantKey) return undefined;
  return (
    slotParts.find((candidate) => candidate.visible && partMatchesVariant(candidate, variantKey)) ??
    slotParts.find((candidate) => partMatchesVariant(candidate, variantKey))
  );
}

/**
 * Canvas offset (relative to the reference part's origin) that places `part` of a variant group
 * so the group's anchor-part PIVOT lands where the reference part's pivot is — i.e. on the
 * slot's bone/joint. One delta per variant group: other layers keep their authored layout
 * relative to the anchor part. Identity (0,0) when part === anchorPart === referencePart, so
 * the representative group renders exactly as before.
 */
export function pivotAlignedPartOffset(
  referencePart: CharacterPart,
  anchorPart: CharacterPart,
  part: CharacterPart,
): { x: number; y: number } {
  const referencePivot = pivotForPart(referencePart);
  const anchorPivot = pivotForPart(anchorPart);
  return {
    x:
      referencePivot.x - referencePart.x - (anchorPivot.x - anchorPart.x) + (part.x - anchorPart.x),
    y:
      referencePivot.y - referencePart.y - (anchorPivot.y - anchorPart.y) + (part.y - anchorPart.y),
  };
}

/** The variant key a rich variant package answers to, matching `variantKeyForPart` vocabulary. */
export function variantKeyForPackage(
  pkg: Pick<CharacterSlotVariantPackage, "id" | "key">,
  parts?: Array<
    Pick<CharacterPart, "variant" | "variantPackageId" | "pose" | "viseme" | "eyeState" | "id">
  >,
): string {
  const explicit = pkg.key?.trim();
  if (explicit) return explicit;
  const part = parts?.find((candidate) => candidate.variantPackageId === pkg.id);
  return part ? variantKeyForPart(part) : pkg.id;
}

function defaultVariantKindForPart(
  part: Pick<CharacterPart, "role" | "pose" | "viseme" | "eyeState">,
): CharacterVariantKind {
  if (part.viseme) return "viseme";
  if (part.eyeState) return "eyeState";
  if (part.role === "hand") return "handShape";
  if (part.role === "mouth") return "mouthShape";
  if (part.pose) return "pose";
  return "custom";
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const out: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

/**
 * When a character gains its first additional angle, parts that were implicitly shared with
 * every angle (undefined `angleIds`) are claimed for the angles that existed before — front
 * drawings stay on Front, and the new angle starts empty. Genuinely shared art opts back in
 * via the part's Angles row. Parts already scoped are untouched.
 */
export function claimSharedPartsForAngles(
  character: CharacterPreset,
  existingAngles: CharacterAngle[],
): CharacterPreset {
  if (existingAngles.length === 0) return character;
  let changed = false;
  const parts = character.parts.map((part) => {
    if (part.angleIds?.length || part.angleId) return part;
    changed = true;
    return { ...part, angleIds: [...existingAngles] };
  });
  return changed ? { ...character, parts } : character;
}

export function partAvailableForAngle(part: CharacterPart, angle: CharacterAngle): boolean {
  const explicit = normalizeAngleIds(part.angleIds);
  if (explicit?.length) return explicit.includes(angle);
  const single = normalizeAngleId(part.angleId);
  return single ? single === angle : true;
}

export function partAngleMembership(part: CharacterPart): CharacterAngle[] | undefined {
  return normalizeAngleIds(part.angleIds) ?? (part.angleId ? [part.angleId] : undefined);
}

export function partsAvailableForAngle(
  parts: CharacterPart[],
  angle: CharacterAngle,
): CharacterPart[] {
  return parts.filter((part) => partAvailableForAngle(part, angle));
}

export function removePartFromAngle(
  character: CharacterPreset,
  partId: ID,
  angle: CharacterAngle,
): { character: CharacterPreset; removedEverywhere: boolean } {
  let removedEverywhere = false;
  const availableAngles = normalizeAngleIds(character.angles) ?? CHARACTER_ANGLE_VALUES;
  const fallbackAngles = availableAngles.filter((candidate) => candidate !== angle);
  const parts = character.parts.flatMap((part) => {
    if (part.id !== partId) return [part];
    const explicit = normalizeAngleIds(part.angleIds);
    if (explicit?.length) {
      if (!explicit.includes(angle)) return [part];
      const next = explicit.filter((candidate) => candidate !== angle);
      if (next.length > 0) return [{ ...part, angleIds: next, angleId: undefined }];
      removedEverywhere = true;
      return [];
    }
    const single = normalizeAngleId(part.angleId);
    if (single) {
      if (single !== angle) return [part];
      removedEverywhere = true;
      return [];
    }
    if (fallbackAngles.length > 0) {
      return [{ ...part, angleIds: fallbackAngles, angleId: undefined }];
    }
    removedEverywhere = true;
    return [];
  });
  const existingIds = new Set(parts.map((part) => part.id));
  const cleanedParts = removedEverywhere
    ? parts.map((part) =>
        part.parentId && !existingIds.has(part.parentId) ? { ...part, parentId: undefined } : part,
      )
    : parts;
  return { character: { ...character, parts: cleanedParts }, removedEverywhere };
}

function normalizeAngleId(value: unknown): CharacterAngle | undefined {
  return typeof value === "string" && (CHARACTER_ANGLE_VALUES as string[]).includes(value)
    ? (value as CharacterAngle)
    : undefined;
}

function normalizeAngleIds(value: unknown): CharacterAngle[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = Array.from(
    new Set(value.map(normalizeAngleId).filter((angle): angle is CharacterAngle => !!angle)),
  );
  return out.length ? out : undefined;
}

export function normalizePartManifest(manifest: Partial<PartManifest> | undefined): PartManifest {
  return {
    ...DEFAULT_PART_MANIFEST,
    ...(manifest ?? {}),
  };
}

export function roleEnabledByManifest(role: PartRole, manifest: Partial<PartManifest> | undefined) {
  const normalized = normalizePartManifest(manifest);
  switch (role) {
    case "head":
      return normalized.hasHead;
    case "body":
      return normalized.hasBody;
    case "arm":
    case "upperArm":
    case "lowerArm":
      return normalized.hasArms;
    case "hand":
      return normalized.hasHands;
    case "leg":
    case "upperLeg":
    case "lowerLeg":
      return normalized.hasLegs;
    case "foot":
      return normalized.hasFeet;
    case "eye":
      return normalized.hasEyes;
    case "iris":
      return normalized.hasEyes && normalized.hasIrises;
    case "eyebrow":
      return normalized.hasBrows;
    case "nose":
      return normalized.hasNose;
    case "mouth":
      return normalized.hasMouth;
    case "hair":
      return normalized.hasHair;
    case "accessory":
      return normalized.hasAccessories;
    case "static":
    case "custom":
      return true;
  }
}

export function normalizePartRole(role: string | undefined): PartRole {
  const compact = role
    ?.trim()
    .replace(/[\s_-]+/g, "")
    .toLowerCase();
  if (compact === "upperarm" || compact === "bicep") return "upperArm";
  if (compact === "lowerarm" || compact === "forearm") return "lowerArm";
  if (compact === "upperleg" || compact === "thigh") return "upperLeg";
  if (compact === "lowerleg" || compact === "shin" || compact === "calf") return "lowerLeg";
  switch (role) {
    case "head":
    case "body":
    case "eye":
    case "iris":
    case "eyebrow":
    case "nose":
    case "mouth":
    case "arm":
    case "upperArm":
    case "lowerArm":
    case "hand":
    case "leg":
    case "upperLeg":
    case "lowerLeg":
    case "foot":
    case "hair":
    case "accessory":
    case "static":
    case "custom":
      return role;
    case "eyeL":
    case "eyeR":
      return "eye";
    case "irisL":
    case "irisR":
    case "pupil":
    case "pupilL":
    case "pupilR":
      return "iris";
    case "brow":
    case "browL":
    case "browR":
      return "eyebrow";
    case "armL":
    case "armR":
      return "arm";
    case "upperArmL":
    case "upperArmR":
    case "upper-arm":
    case "upper_arm":
    case "upperarm":
    case "bicep":
    case "bicepL":
    case "bicepR":
      return "upperArm";
    case "lowerArmL":
    case "lowerArmR":
    case "lower-arm":
    case "lower_arm":
    case "lowerarm":
    case "forearm":
    case "forearmL":
    case "forearmR":
      return "lowerArm";
    case "legL":
    case "legR":
      return "leg";
    case "upperLegL":
    case "upperLegR":
    case "upper-leg":
    case "upper_leg":
    case "upperleg":
    case "thigh":
    case "thighL":
    case "thighR":
      return "upperLeg";
    case "lowerLegL":
    case "lowerLegR":
    case "lower-leg":
    case "lower_leg":
    case "lowerleg":
    case "shin":
    case "shinL":
    case "shinR":
    case "calf":
    case "calfL":
    case "calfR":
      return "lowerLeg";
    case "footL":
    case "footR":
      return "foot";
    case "extra":
      return "custom";
    default:
      return "custom";
  }
}

export function defaultMotionBehaviorForRole(role: PartRole, viseme?: MouthViseme | string) {
  if (role === "mouth" || viseme) return "lipSync";
  if (role === "eye") return "blink";
  if (role === "eyebrow") return "raise";
  if (
    role === "arm" ||
    role === "upperArm" ||
    role === "lowerArm" ||
    role === "leg" ||
    role === "upperLeg" ||
    role === "lowerLeg" ||
    role === "foot"
  )
    return "rotate";
  if (role === "head") return "rotate";
  if (role === "hair") return "bounce";
  return "none";
}

export function makePart(
  role: PartRole,
  mediaId: string,
  opts: Partial<CharacterPart> = {},
): CharacterPart {
  const id = opts.id ?? uid();
  const base = {
    x: opts.x ?? 100,
    y: opts.y ?? 100,
    width: opts.width ?? 200,
    height: opts.height ?? 200,
    alphaBounds: opts.alphaBounds,
  } as CharacterPart;
  const defaultPivot = alphaCenterForPart(base);
  const pivot = opts.pivot ?? {
    x: Math.round(defaultPivot.x),
    y: Math.round(defaultPivot.y),
  };
  return normalizePartRegistration({
    id,
    slotId:
      opts.slotId ?? defaultSlotIdForRole(role, role === "custom" ? id : undefined, opts.side),
    slotName: opts.slotName ?? slotLabelForRoleSide(role, opts.side),
    role,
    name: opts.name ?? roleLabel(role),
    pose: opts.pose,
    variantPackageId: opts.variantPackageId,
    variant: normalizePartVariant({
      role,
      pose: opts.pose,
      variant: opts.variant,
      viseme: opts.viseme,
      eyeState: opts.eyeState,
    }),
    viseme: opts.viseme,
    eyeState: opts.eyeState,
    side: opts.side,
    angleId: opts.angleId,
    angleIds: opts.angleIds,
    mediaId,
    x: base.x,
    y: base.y,
    width: base.width,
    height: base.height,
    rotation: opts.rotation ?? 0,
    anchorX: opts.anchorX ?? clamp01((pivot.x - base.x) / Math.max(1, base.width)),
    anchorY: opts.anchorY ?? clamp01((pivot.y - base.y) / Math.max(1, base.height)),
    pivot,
    parentId: opts.parentId,
    bounds: opts.bounds,
    alphaBounds: opts.alphaBounds,
    motionBehavior: opts.motionBehavior ?? defaultMotionBehaviorForRole(role, opts.viseme),
    morph: opts.morph,
    zIndex: opts.zIndex ?? 0,
    depth: opts.depth ?? 0,
    visible: opts.visible ?? true,
  });
}

export function roleLabel(role: PartRole): string {
  switch (role) {
    case "head":
      return "Head";
    case "body":
      return "Body";
    case "eye":
      return "Eye";
    case "iris":
      return "Iris";
    case "eyebrow":
      return "Eyebrow";
    case "nose":
      return "Nose";
    case "mouth":
      return "Mouth";
    case "arm":
      return "Arm";
    case "upperArm":
      return "Upper Arm";
    case "lowerArm":
      return "Lower Arm";
    case "hand":
      return "Hand";
    case "leg":
      return "Leg";
    case "upperLeg":
      return "Upper Leg";
    case "lowerLeg":
      return "Lower Leg";
    case "foot":
      return "Foot";
    case "hair":
      return "Hair";
    case "accessory":
      return "Accessory";
    case "static":
      return "Static";
    case "custom":
      return "Custom";
  }
}

function isGenericSidedSlot(part: Pick<CharacterPart, "role" | "slotId" | "side">) {
  if (!part.side || !part.slotId) return false;
  if (part.slotId !== `role:${part.role}`) return false;
  return (
    (isSidedSlotRole(part.role) && (part.side === "left" || part.side === "right")) ||
    (part.role === "hair" && (part.side === "front" || part.side === "back"))
  );
}

function normalizedStandardSlotId(
  slotId: ID | undefined,
  _name: string | undefined,
  role: PartRole,
  side: CharacterPart["side"],
  partId?: ID,
): ID {
  const canonical = defaultSlotIdForRole(role, role === "custom" ? partId : undefined, side);
  if (!slotId || isGenericSidedSlot({ role, slotId, side })) return canonical;
  if (role === "custom" || slotId.startsWith("custom:") || slotId === canonical) return slotId;

  // Older canvas-drop imports derived standard slot IDs from filenames and labels. Repair only
  // those recognizable generated IDs, preserving deliberately named non-custom slots.
  const generated = `slot:${slotSlug(slotLabelForRoleSide(role, side))}`;
  return slotId === generated ? canonical : slotId;
}

function slotSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "part"
  );
}

export function slotLabelForRoleSide(role: PartRole, side?: CharacterPart["side"]) {
  const base = roleLabel(role);
  if (side === "left") return `Left ${base}`;
  if (side === "right") return `Right ${base}`;
  if (side === "front") return `${base} Front`;
  if (side === "back") return `${base} Back`;
  return base;
}

function sortOrderForPartRole(role: PartRole): number {
  switch (role) {
    case "body":
      return 10;
    case "head":
      return 20;
    case "hair":
      return 30;
    case "eye":
    case "iris":
    case "eyebrow":
    case "nose":
    case "mouth":
      return 40;
    case "arm":
    case "upperArm":
    case "lowerArm":
    case "hand":
      return 50;
    case "leg":
    case "upperLeg":
    case "lowerLeg":
    case "foot":
      return 60;
    case "accessory":
      return 70;
    case "static":
      return 80;
    case "custom":
      return 90;
  }
}

function slotRecordFromPart(part: CharacterPart, fallbackOrder: number): CharacterSlot {
  const side = inferPartSide(part) ?? part.side;
  return {
    id: getPartSlotId(part),
    name: part.slotName?.trim() || slotLabelForRoleSide(part.role, side),
    role: part.role,
    side,
    sortOrder: sortOrderForPartRole(part.role) + fallbackOrder / 1000,
  };
}

export function normalizeSlotRecords(
  parts: CharacterPart[],
  records: CharacterSlot[] = [],
): CharacterSlot[] {
  const byId = new Map<ID, CharacterSlot>();
  parts.forEach((part, index) => {
    const inferred = slotRecordFromPart(part, index);
    const current = byId.get(inferred.id);
    if (!current) {
      byId.set(inferred.id, inferred);
      return;
    }
    byId.set(inferred.id, {
      ...current,
      side: current.side ?? inferred.side,
      sortOrder: Math.min(
        current.sortOrder ?? inferred.sortOrder ?? index,
        inferred.sortOrder ?? index,
      ),
    });
  });
  records.forEach((slot, index) => {
    const inferred = byId.get(slot.id);
    const role = normalizePartRole((slot.role ?? inferred?.role ?? "custom") as string);
    const side = "side" in slot ? slot.side : inferred?.side;
    byId.set(slot.id, {
      ...inferred,
      ...slot,
      id: slot.id,
      role,
      side,
      name: slot.name?.trim() || inferred?.name || slotLabelForRoleSide(role, side),
      angleIds: normalizeAngleIds(slot.angleIds),
      sortOrder: slot.sortOrder ?? inferred?.sortOrder ?? 100 + index,
    });
  });
  return Array.from(byId.values()).sort(compareSlotRecords);
}

function compareSlotRecords(
  a: Pick<CharacterSlot, "name" | "sortOrder">,
  b: Pick<CharacterSlot, "name" | "sortOrder">,
) {
  const order = (a.sortOrder ?? 999) - (b.sortOrder ?? 999);
  if (order !== 0) return order;
  return a.name.localeCompare(b.name);
}

/** Group parts by role for the parts list. */
export function groupParts(parts: CharacterPart[]): Map<PartRole, CharacterPart[]> {
  const m = new Map<PartRole, CharacterPart[]>();
  for (const p of parts) {
    const arr = m.get(p.role) ?? [];
    arr.push(p);
    m.set(p.role, arr);
  }
  return m;
}

export interface CharacterSlotRef {
  id: ID;
  role: PartRole;
  side?: CharacterPart["side"];
  name: string;
  semanticSlotId?: ID;
  angleIds?: CharacterAngle[];
  sortOrder?: number;
  color?: string;
  aiHint?: string;
  parts: CharacterPart[];
}

type SlotListInput = CharacterPart[] | Pick<CharacterPreset, "parts" | "slots">;

export interface CharacterSlotListOptions {
  angle?: CharacterAngle;
  includeEmpty?: boolean;
}

/** List stable animatable slots. Variants in a slot share one timeline target. */
export function listCharacterSlots(
  input: SlotListInput,
  options: CharacterSlotListOptions = {},
): CharacterSlotRef[] {
  const isCharacterLike = !Array.isArray(input);
  const allParts = Array.isArray(input) ? input : input.parts;
  const parts = options.angle
    ? allParts.filter((part) => partAvailableForAngle(part, options.angle!))
    : allParts;
  const records = normalizeSlotRecords(allParts, isCharacterLike ? input.slots : []);
  const includeEmpty = options.includeEmpty ?? isCharacterLike;
  const bySlot = new Map<ID, CharacterSlotRef>();
  if (includeEmpty) {
    for (const slot of records) {
      if (options.angle && slot.angleIds?.length && !slot.angleIds.includes(options.angle))
        continue;
      bySlot.set(slot.id, {
        id: slot.id,
        role: slot.role,
        side: slot.side,
        name: slot.name,
        semanticSlotId: slot.semanticSlotId,
        angleIds: slot.angleIds,
        sortOrder: slot.sortOrder,
        color: slot.color,
        aiHint: slot.aiHint,
        parts: [],
      });
    }
  }
  const recordById = new Map(records.map((slot) => [slot.id, slot]));
  for (const part of parts) {
    const id = getPartSlotId(part);
    const slot = bySlot.get(id);
    if (slot) {
      slot.parts.push(part);
    } else {
      const record = recordById.get(id) ?? slotRecordFromPart(part, 0);
      bySlot.set(id, {
        id,
        role: record.role,
        side: record.side,
        name: record.name,
        semanticSlotId: record.semanticSlotId,
        angleIds: record.angleIds,
        sortOrder: record.sortOrder,
        color: record.color,
        aiHint: record.aiHint,
        parts: [part],
      });
    }
  }
  const slots = Array.from(bySlot.values()).filter((slot) => includeEmpty || slot.parts.length > 0);
  const hasSidedEyeSlots = slots.some(
    (slot) =>
      slot.role === "eye" &&
      slot.parts.some((part) => part.side === "left" || part.side === "right"),
  );
  return slots
    .filter((slot) => {
      if (!hasSidedEyeSlots || slot.role !== "eye") return true;
      return slot.parts.some((part) => part.side === "left" || part.side === "right");
    })
    .sort((a, b) => {
      const order = (a.sortOrder ?? 999) - (b.sortOrder ?? 999);
      if (order !== 0) return order;
      const az = a.parts.length
        ? Math.min(...a.parts.map((p) => p.zIndex))
        : Number.POSITIVE_INFINITY;
      const bz = b.parts.length
        ? Math.min(...b.parts.map((p) => p.zIndex))
        : Number.POSITIVE_INFINITY;
      if (az !== bz) return az - bz;
      return a.name.localeCompare(b.name);
    });
}

export function findCharacterSlot(
  character: Pick<CharacterPreset, "parts" | "slots">,
  slotId: ID,
): CharacterSlotRef | undefined {
  return listCharacterSlots(character, { includeEmpty: true }).find((slot) => slot.id === slotId);
}

export function withUpsertedCharacterSlot(
  character: CharacterPreset,
  slot: CharacterSlot,
): CharacterPreset {
  const slots = normalizeSlotRecords(character.parts, [
    ...(character.slots ?? []).filter((candidate) => candidate.id !== slot.id),
    slot,
  ]);
  const name = slots.find((candidate) => candidate.id === slot.id)?.name ?? slot.name;
  return {
    ...character,
    slots,
    parts: character.parts.map((part) =>
      getPartSlotId(part) === slot.id ? { ...part, slotName: name } : part,
    ),
  };
}

export function withUpdatedCharacterSlot(
  character: CharacterPreset,
  slotId: ID,
  patch: Partial<CharacterSlot>,
): CharacterPreset {
  const current = findCharacterSlot(character, slotId);
  const representative = character.parts.find((part) => getPartSlotId(part) === slotId);
  if (!current && !representative && !patch.role && !patch.name?.trim()) return character;

  const role = patch.role ?? current?.role ?? representative?.role ?? "custom";
  const side = "side" in patch ? patch.side : (current?.side ?? representative?.side);
  const roleOrSideChanged = patch.role !== undefined || "side" in patch;
  const nextSlotId =
    roleOrSideChanged && role !== "custom" ? defaultSlotIdForRole(role, undefined, side) : slotId;
  const name =
    patch.name?.trim() ||
    (!roleOrSideChanged ? current?.name || representative?.slotName : undefined) ||
    slotLabelForRoleSide(role, side);
  const slot: CharacterSlot = {
    id: nextSlotId,
    name,
    role,
    side,
    semanticSlotId: "semanticSlotId" in patch ? patch.semanticSlotId : current?.semanticSlotId,
    angleIds: "angleIds" in patch ? patch.angleIds : current?.angleIds,
    sortOrder: "sortOrder" in patch ? patch.sortOrder : current?.sortOrder,
    color: "color" in patch ? patch.color : current?.color,
    aiHint: "aiHint" in patch ? patch.aiHint : current?.aiHint,
  };
  const base: CharacterPreset = {
    ...character,
    slots:
      character.slots?.filter(
        (candidate) => candidate.id !== slotId && candidate.id !== nextSlotId,
      ) ?? [],
  };
  const withParts: CharacterPreset = {
    ...base,
    parts: base.parts.map((part) => {
      if (getPartSlotId(part) !== slotId) return part;
      const previousDefault = defaultMotionBehaviorForRole(part.role, part.viseme);
      const shouldResetMotion =
        patch.role !== undefined &&
        (part.motionBehavior === undefined || part.motionBehavior === previousDefault);
      return {
        ...part,
        slotId: nextSlotId,
        role,
        side,
        slotName: name,
        viseme: role === "mouth" ? part.viseme : undefined,
        eyeState: role === "eye" ? part.eyeState : undefined,
        motionBehavior: shouldResetMotion
          ? defaultMotionBehaviorForRole(role, role === "mouth" ? part.viseme : undefined)
          : part.motionBehavior,
      };
    }),
  };
  const withSlot = withUpsertedCharacterSlot(withParts, slot);
  const slotIdRemap = nextSlotId === slotId ? new Map<ID, ID>() : new Map([[slotId, nextSlotId]]);
  return {
    ...withSlot,
    rig: remapCharacterRigSlotIds(withSlot.rig, slotIdRemap),
  };
}

/** Find the part to display for a role given current pose/viseme/eyeState. */
export function pickActivePart(
  parts: CharacterPart[],
  role: PartRole,
  selectors: { pose?: string; viseme?: string; eyeState?: string } = {},
  slotId?: ID,
): CharacterPart | undefined {
  const candidates = parts.filter(
    (p) => p.role === role && p.visible && (!slotId || getPartSlotId(p) === slotId),
  );
  if (candidates.length === 0) return undefined;
  if (role === "mouth" && (selectors.viseme || selectors.pose)) {
    const target = selectors.viseme ?? selectors.pose;
    const m = candidates.find((p) => partMatchesVariant(p, target));
    if (m) return m;
    const rest = candidates.find((p) => partMatchesVariant(p, "rest"));
    if (rest) return rest;
  }
  if (role === "eye" && (selectors.eyeState || selectors.pose)) {
    const target = selectors.eyeState ?? selectors.pose;
    const m = candidates.find((p) => partMatchesVariant(p, target));
    if (m) return m;
    const open = candidates.find((p) => partMatchesVariant(p, "open"));
    if (open) return open;
  }
  if (selectors.pose) {
    const m = candidates.find((p) => partMatchesVariant(p, selectors.pose));
    if (m) return m;
  }
  return candidates[0];
}

export function pickActivePartForSlot(
  slot: CharacterSlotRef,
  selectors: { pose?: string; viseme?: string; eyeState?: string },
): CharacterPart | undefined {
  return pickActivePart(slot.parts, slot.role, selectors, slot.id);
}
