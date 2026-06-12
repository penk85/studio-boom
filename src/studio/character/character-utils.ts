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
  type FallbackMouthAnchor,
  type MouthViseme,
  type PartManifest,
  type PartRole,
} from "../types";
import { legacyVisemeToStandard } from "../lipsync/viseme-schema";
import { alphaCenterForPart, pivotForPart } from "./alpha-bounds";

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

const SIDED_SLOT_ROLES = new Set<PartRole>([
  "eye",
  "iris",
  "eyebrow",
  "arm",
  "hand",
  "leg",
  "foot",
]);

export function defaultSlotIdForRole(
  role: PartRole,
  partId?: string,
  side?: CharacterPart["side"],
): string {
  if (side && SIDED_SLOT_ROLES.has(role) && (side === "left" || side === "right")) {
    return `slot:${side}-${role}`;
  }
  if (side && role === "hair" && (side === "front" || side === "back")) {
    return `slot:${side}-${role}`;
  }
  return role === "custom" && partId ? `custom:${partId}` : `role:${role}`;
}

export function getPartSlotId(part: CharacterPart): ID {
  if (part.slotId && !isGenericSidedSlot(part)) return part.slotId;
  return defaultSlotIdForRole(part.role, part.id, part.side);
}

export function inferHumanParentPartId(
  parts: CharacterPart[],
  part: CharacterPart,
): ID | undefined {
  if (part.parentId) return part.parentId;
  const sameSide = part.side === "left" || part.side === "right" ? part.side : undefined;
  const candidates = parts
    .filter((candidate) => candidate.id !== part.id)
    .slice()
    .sort((a, b) => Number(b.visible) - Number(a.visible) || b.zIndex - a.zIndex);
  const pick = (role: PartRole, side?: CharacterPart["side"]) =>
    candidates.find(
      (candidate) =>
        candidate.role === role &&
        (!side || candidate.side === side) &&
        getPartSlotId(candidate) !== getPartSlotId(part),
    )?.id;
  const pickAny = (role: PartRole) =>
    candidates.find(
      (candidate) => candidate.role === role && getPartSlotId(candidate) !== getPartSlotId(part),
    )?.id;

  switch (part.role) {
    case "head":
      return pickAny("body");
    case "eye":
    case "eyebrow":
    case "nose":
    case "mouth":
    case "hair":
      return pickAny("head") ?? pickAny("body");
    case "iris":
      return (
        (sameSide ? pick("eye", sameSide) : undefined) ??
        pickAny("eye") ??
        pickAny("head") ??
        pickAny("body")
      );
    case "arm":
    case "leg":
      return pickAny("body");
    case "hand":
      return (sameSide ? pick("arm", sameSide) : undefined) ?? pickAny("arm") ?? pickAny("body");
    case "foot":
      return (sameSide ? pick("leg", sameSide) : undefined) ?? pickAny("leg") ?? pickAny("body");
    case "accessory":
      return pickAny("head") ?? pickAny("body");
    default:
      return undefined;
  }
}

export function withInferredHumanParentIds(character: CharacterPreset): CharacterPreset {
  let changed = false;
  const parts = character.parts.map((part) => {
    if (part.parentId) return part;
    const parentId = inferHumanParentPartId(character.parts, part);
    if (!parentId) return part;
    changed = true;
    return { ...part, parentId };
  });
  return changed ? { ...character, parts } : character;
}

export function normalizeCharacterSlots(c: CharacterPreset): CharacterPreset {
  const restMouth = c.parts.find(
    (p) => normalizePartRole(p.role as string) === "mouth" && legacyVisemeToStandard(p.viseme),
  );
  return {
    ...c,
    angles: normalizeAngleIds(c.angles) ?? c.angles,
    manifest: normalizePartManifest(c.manifest),
    fallbackMouth: c.fallbackMouth ?? defaultFallbackMouthAnchor(c.canvasWidth, c.canvasHeight),
    parts: c.parts.map((part) => {
      const role = normalizePartRole(part.role as string);
      const slotId =
        part.slotId && !isGenericSidedSlot({ ...part, role })
          ? part.slotId
          : defaultSlotIdForRole(role, role === "custom" ? part.id : undefined, part.side);
      const viseme = legacyVisemeToStandard(part.viseme) ?? part.viseme;
      const withNormalizedIds = { ...part, role, slotId, viseme };
      const alphaPivot = alphaCenterForPart(withNormalizedIds);
      const slotName =
        part.slotName && part.slotName !== roleLabel(role)
          ? part.slotName
          : slotLabelForRoleSide(role, part.side);
      const pivot = part.pivot ?? {
        x: Math.round(alphaPivot.x),
        y: Math.round(alphaPivot.y),
      };
      return {
        ...part,
        role,
        slotId,
        slotName,
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
      };
    }),
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

export function partsAvailableForAngle(
  parts: CharacterPart[],
  angle: CharacterAngle,
): CharacterPart[] {
  return parts.filter((part) => partAvailableForAngle(part, angle));
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
      return normalized.hasArms;
    case "hand":
      return normalized.hasHands;
    case "leg":
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
  switch (role) {
    case "head":
    case "body":
    case "eye":
    case "iris":
    case "eyebrow":
    case "nose":
    case "mouth":
    case "arm":
    case "hand":
    case "leg":
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
    case "legL":
    case "legR":
      return "leg";
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
  if (role === "arm") return "rotate";
  if (role === "leg") return "rotate";
  if (role === "foot") return "rotate";
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
  return {
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
  };
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
    case "hand":
      return "Hand";
    case "leg":
      return "Leg";
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
    (SIDED_SLOT_ROLES.has(part.role) && (part.side === "left" || part.side === "right")) ||
    (part.role === "hair" && (part.side === "front" || part.side === "back"))
  );
}

function slotLabelForRoleSide(role: PartRole, side?: CharacterPart["side"]) {
  const base = roleLabel(role);
  if (side === "left") return `Left ${base}`;
  if (side === "right") return `Right ${base}`;
  if (side === "front") return `${base} Front`;
  if (side === "back") return `${base} Back`;
  return base;
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
  name: string;
  parts: CharacterPart[];
}

/** List stable animatable slots. Variants in a slot share one timeline target. */
export function listCharacterSlots(parts: CharacterPart[]): CharacterSlotRef[] {
  const bySlot = new Map<ID, CharacterSlotRef>();
  for (const part of parts) {
    const id = getPartSlotId(part);
    const slot = bySlot.get(id);
    if (slot) {
      slot.parts.push(part);
    } else {
      bySlot.set(id, {
        id,
        role: part.role,
        name: part.slotName ?? roleLabel(part.role),
        parts: [part],
      });
    }
  }
  const slots = Array.from(bySlot.values());
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
      const az = Math.min(...a.parts.map((p) => p.zIndex));
      const bz = Math.min(...b.parts.map((p) => p.zIndex));
      return az - bz;
    });
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
