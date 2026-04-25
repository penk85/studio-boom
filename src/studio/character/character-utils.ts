// Character helpers — create/load/save CharacterPreset records.
import { db, uid } from "../db";
import {
  DEFAULT_PARALLAX_CONFIG,
  DEFAULT_PART_MANIFEST,
  type CharacterPart,
  type CharacterPreset,
  type PartRole,
} from "../types";

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
    createdAt: now,
    updatedAt: now,
  };
}

export async function saveCharacter(c: CharacterPreset) {
  const updated = { ...c, updatedAt: Date.now() };
  await db.characters.put(updated);
  return updated;
}

export function makePart(
  role: PartRole,
  mediaId: string,
  opts: Partial<CharacterPart> = {},
): CharacterPart {
  return {
    id: uid(),
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
    case "head": return "Head";
    case "body": return "Body";
    case "armL": return "Left Arm";
    case "armR": return "Right Arm";
    case "legL": return "Left Leg";
    case "legR": return "Right Leg";
    case "eye": return "Eyes";
    case "eyeL": return "Left Eye";
    case "eyeR": return "Right Eye";
    case "brow": return "Brows";
    case "browL": return "Left Brow";
    case "browR": return "Right Brow";
    case "mouth": return "Mouth";
    case "extra": return "Extra";
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

/** Find the part to display for a role given current pose/viseme/eyeState. */
export function pickActivePart(
  parts: CharacterPart[],
  role: PartRole,
  selectors: { pose?: string; viseme?: string; eyeState?: string },
): CharacterPart | undefined {
  const candidates = parts.filter((p) => p.role === role && p.visible);
  if (candidates.length === 0) return undefined;
  if (role === "mouth" && selectors.viseme) {
    const m = candidates.find((p) => p.viseme === selectors.viseme);
    if (m) return m;
    const rest = candidates.find((p) => p.viseme === "rest");
    if (rest) return rest;
  }
  if ((role === "eye" || role === "eyeL" || role === "eyeR") && selectors.eyeState) {
    const m = candidates.find((p) => p.eyeState === selectors.eyeState);
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
