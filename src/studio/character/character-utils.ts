// Character helpers — create/load/save CharacterPreset records.
import { db, uid } from "../db";
import {
  DEFAULT_PARALLAX_CONFIG,
  DEFAULT_PART_MANIFEST,
  type ID,
  type CharacterPart,
  type CharacterPreset,
  type FallbackMouthAnchor,
  type PartRole,
} from "../types";

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
  await db.characters.put(updated);
  return updated;
}

export function defaultSlotIdForRole(role: PartRole, partId?: string): string {
  return role === "extra" && partId ? `extra:${partId}` : `role:${role}`;
}

export function getPartSlotId(part: CharacterPart): ID {
  return part.slotId ?? defaultSlotIdForRole(part.role, part.id);
}

export function normalizeCharacterSlots(c: CharacterPreset): CharacterPreset {
  return {
    ...c,
    fallbackMouth: c.fallbackMouth ?? defaultFallbackMouthAnchor(c.canvasWidth, c.canvasHeight),
    parts: c.parts.map((part) => {
      const slotId = getPartSlotId(part);
      return {
        ...part,
        slotId,
        slotName: part.slotName ?? roleLabel(part.role),
      };
    }),
  };
}

export function makePart(
  role: PartRole,
  mediaId: string,
  opts: Partial<CharacterPart> = {},
): CharacterPart {
  const id = uid();
  return {
    id,
    slotId: opts.slotId ?? defaultSlotIdForRole(role, role === "extra" ? id : undefined),
    slotName: opts.slotName ?? roleLabel(role),
    role,
    name: opts.name ?? roleLabel(role),
    pose: opts.pose,
    viseme: opts.viseme,
    eyeState: opts.eyeState,
    mediaId,
    x: opts.x ?? 100,
    y: opts.y ?? 100,
    width: opts.width ?? 200,
    height: opts.height ?? 200,
    rotation: opts.rotation ?? 0,
    anchorX: opts.anchorX ?? 0.5,
    anchorY: opts.anchorY ?? 0.5,
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
    case "armL":
      return "Left Arm";
    case "armR":
      return "Right Arm";
    case "legL":
      return "Left Leg";
    case "legR":
      return "Right Leg";
    case "eye":
      return "Eyes";
    case "eyeL":
      return "Left Eye";
    case "eyeR":
      return "Right Eye";
    case "brow":
      return "Brows";
    case "browL":
      return "Left Brow";
    case "browR":
      return "Right Brow";
    case "mouth":
      return "Mouth";
    case "extra":
      return "Extra";
  }
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
  return Array.from(bySlot.values()).sort((a, b) => {
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
  if (
    (role === "eye" || role === "eyeL" || role === "eyeR") &&
    (selectors.eyeState || selectors.pose)
  ) {
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
