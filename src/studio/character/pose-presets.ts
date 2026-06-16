import type { CharacterAngle, CharacterPosePreset, CharacterPreset, ID } from "../types";
import { uid } from "../db";
import {
  defaultVariantForSlotParts,
  listCharacterSlots,
  partMatchesVariant,
} from "./character-utils";
import { slotVariantKeys } from "./variant-pairing";

/**
 * Pose presets: named, reusable arrangements of slot variants ("Standing", "Waving"). Pure
 * helpers — no React, no DOM. A pose is a convenience record over the character → angles →
 * slots → variants hierarchy; it owns limbs only. Mouth/eye/iris slots are excluded because
 * visemes belong to lip-sync and blinking to autoBlink — a pose pinning them would fight those
 * runtimes.
 */

const NON_POSEABLE_ROLES = new Set(["mouth", "eye", "iris"]);

/** Slots a pose meaningfully controls: multi-variant slots outside the face machinery. */
export function poseableSlotIds(character: CharacterPreset): ID[] {
  return listCharacterSlots(character, { includeEmpty: false })
    .filter(
      (slot) =>
        !NON_POSEABLE_ROLES.has(slot.role) && slotVariantKeys(character, slot.id).length > 1,
    )
    .map((slot) => slot.id);
}

/**
 * Snapshot the current arrangement as a pose. Dense over poseable slots — the preview key when
 * set, else the slot's default displayed key — so applying a pose is order-independent (it fully
 * determines every poseable slot, restoring limbs the user never touched while saving).
 */
export function capturePosePreset(
  character: CharacterPreset,
  variantPreview: Readonly<Record<ID, string>>,
  opts: { name: string; angleIds?: CharacterAngle[] },
): CharacterPosePreset {
  const slots = listCharacterSlots(character, { includeEmpty: false });
  const poses: Record<ID, string> = {};
  for (const slotId of poseableSlotIds(character)) {
    const slot = slots.find((candidate) => candidate.id === slotId);
    const key =
      variantPreview[slotId] ??
      (slot ? defaultVariantForSlotParts(slot.parts, slot.role) : undefined);
    if (key) poses[slotId] = key;
  }
  return {
    id: uid(),
    name: opts.name.trim() || "Pose",
    poses,
    ...(opts.angleIds?.length ? { angleIds: opts.angleIds } : {}),
  };
}

/**
 * The pose as an applicable slot→key map, dropping entries whose slot or key no longer resolves
 * (renamed/removed art must not pin missing variants).
 */
export function applyPosePreset(
  character: CharacterPreset,
  preset: CharacterPosePreset,
): Record<ID, string> {
  const slots = new Map(
    listCharacterSlots(character, { includeEmpty: false }).map((slot) => [slot.id, slot]),
  );
  const out: Record<ID, string> = {};
  for (const [slotId, key] of Object.entries(preset.poses)) {
    const slot = slots.get(slotId);
    if (!slot) continue;
    const resolves =
      slot.parts.some((part) => partMatchesVariant(part, key)) ||
      slotVariantKeys(character, slotId).includes(key);
    if (resolves) out[slotId] = key;
  }
  return out;
}

export function defaultPosePresetForCharacter(
  character: CharacterPreset,
): CharacterPosePreset | undefined {
  const presets = character.posePresets ?? [];
  if (presets.length === 0) return undefined;
  return presets.find((preset) => preset.id === character.defaultPoseId) ?? presets[0];
}

/** The default pose's slot→key map, or `{}` — callers degrade exactly to unposed behavior. */
export function defaultPoseForCharacter(character: CharacterPreset): Record<ID, string> {
  const preset = defaultPosePresetForCharacter(character);
  return preset ? applyPosePreset(character, preset) : {};
}

/** Poses available at an angle (undefined `angleIds` = every angle). */
export function posePresetsForAngle(
  character: CharacterPreset,
  angle: CharacterAngle,
): CharacterPosePreset[] {
  return (character.posePresets ?? []).filter(
    (preset) => !preset.angleIds?.length || preset.angleIds.includes(angle),
  );
}

/**
 * A character should never sit in a non-pose: when it has poseable slots but no presets yet,
 * seed one "Standing" pose capturing the default displayed keys and make it the default.
 * Returns null when nothing to do (presets exist, or there is nothing to pose).
 */
export function seedDefaultPosePreset(character: CharacterPreset): CharacterPreset | null {
  if (character.posePresets?.length) return null;
  const preset = capturePosePreset(character, {}, { name: "Standing" });
  if (Object.keys(preset.poses).length === 0) return null;
  return { ...character, posePresets: [preset], defaultPoseId: preset.id };
}

/**
 * Whether the current preview still matches the pose, compared per poseable slot with default
 * keys filling unset entries — derived equality, so manually reverting a slot clears the
 * "modified" state without any flag bookkeeping.
 */
export function poseMatchesPreview(
  preset: CharacterPosePreset,
  variantPreview: Readonly<Record<ID, string>>,
  character: CharacterPreset,
): boolean {
  const slots = new Map(
    listCharacterSlots(character, { includeEmpty: false }).map((slot) => [slot.id, slot]),
  );
  const applied = applyPosePreset(character, preset);
  for (const slotId of poseableSlotIds(character)) {
    const slot = slots.get(slotId);
    const fallback = slot ? defaultVariantForSlotParts(slot.parts, slot.role) : undefined;
    const expected = applied[slotId] ?? fallback;
    const actual = variantPreview[slotId] ?? fallback;
    if (expected !== actual) return false;
  }
  return true;
}
