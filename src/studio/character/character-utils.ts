// Character helpers — create/load/save CharacterPreset records.
import { db, deleteMediaIfUnused, mediaIdsForCharacter, uid } from "../db";
import {
  DEFAULT_PARALLAX_CONFIG,
  DEFAULT_PART_MANIFEST,
  type ID,
  type CharacterPart,
  type CharacterPreset,
  type FallbackMouthAnchor,
  type MouthViseme,
  type PartManifest,
  type PartRole,
} from "../types";
import { legacyVisemeToStandard } from "../lipsync/viseme-schema";
import { alphaCenterForPart } from "./alpha-bounds";

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

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

const SIDED_SLOT_ROLES = new Set<PartRole>(["eye", "eyebrow", "arm", "hand", "leg", "foot"]);

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

export function normalizeCharacterSlots(c: CharacterPreset): CharacterPreset {
  const restMouth = c.parts.find(
    (p) => normalizePartRole(p.role as string) === "mouth" && legacyVisemeToStandard(p.viseme),
  );
  return {
    ...c,
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
    case "eyebrow":
      return normalized.hasBrows;
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
    case "eyebrow":
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
    viseme: opts.viseme,
    eyeState: opts.eyeState,
    side: opts.side,
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
    case "eyebrow":
      return "Eyebrow";
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
  selectors: { pose?: string; viseme?: string; eyeState?: string },
  slotId?: ID,
): CharacterPart | undefined {
  const candidates = parts.filter(
    (p) => p.role === role && p.visible && (!slotId || getPartSlotId(p) === slotId),
  );
  if (candidates.length === 0) return undefined;
  if (role === "mouth" && (selectors.viseme || selectors.pose)) {
    const target = selectors.viseme ?? selectors.pose;
    const m = candidates.find((p) => p.viseme === target || p.pose === target);
    if (m) return m;
    const rest = candidates.find((p) => p.viseme === "rest");
    if (rest) return rest;
  }
  if (role === "eye" && (selectors.eyeState || selectors.pose)) {
    const target = selectors.eyeState ?? selectors.pose;
    const m = candidates.find((p) => p.eyeState === target || p.pose === target);
    if (m) return m;
    const open = candidates.find((p) => p.eyeState === "open");
    if (open) return open;
  }
  if (selectors.pose) {
    const m = candidates.find((p) => p.pose === selectors.pose);
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
