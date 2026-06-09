import type {
  CharacterBone,
  CharacterPart,
  CharacterPreset,
  CharacterSlotVariantPackage,
  MotionPreset,
  MotionTrack,
  PartRole,
} from "../types";
import {
  listCharacterSlots,
  partAvailableForAngle,
  partMatchesVariant,
  partsAvailableForAngle,
  roleLabel,
  variantKeyForPart,
} from "../character/character-utils";
import { availableCharacterAngles, normalizeCharacterRig } from "../character/rig";
import {
  ANGLE_RIG_JSON_KIND,
  CHARACTER_JSON_KIND,
  CHARACTER_JSON_SCHEMA_VERSION,
  MOTION_JSON_KIND,
  type AngleRigJson,
  type AngleSlotVariantJson,
  type CharacterJson,
  type MotionJson,
  type MotionJsonTrack,
  type SemanticType,
} from "./schema";

export function slugifyName(value: string, fallback = "untitled"): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

export function characterJsonFilename(characterName: string): string {
  return `${slugifyName(characterName, "character")}.character.json`;
}

export function angleRigJsonFilename(characterName: string, angleId: string): string {
  return `${slugifyName(characterName, "character")}.${slugifyName(angleId, "front")}.angle-rig.json`;
}

export function motionJsonFilename(motionName: string): string {
  return `${slugifyName(motionName, "motion")}.motion.json`;
}

export function aiOutFilename(characterName: string, suffix: string): string {
  return `${slugifyName(characterName, "character")}.${suffix}.ai-out.json`;
}

export function aiInFilename(name: string, suffix: string): string {
  return `${slugifyName(name, "suggestion")}.${suffix}.ai-in.json`;
}

export function characterJsonFromPreset(character: CharacterPreset): CharacterJson {
  const rig = normalizeCharacterRig(character);
  const slots = listCharacterSlots(character.parts);
  const angles = availableCharacterAngles(character);
  const semanticBones = uniqueSemanticBones(rig);
  return {
    kind: CHARACTER_JSON_KIND,
    schemaVersion: CHARACTER_JSON_SCHEMA_VERSION,
    suggestedFilename: characterJsonFilename(character.name),
    id: `character:${character.id}`,
    name: character.name,
    defaultAngle: rig.activeAngle,
    angles,
    semanticBones: semanticBones.map((bone) => ({
      id: bone.semanticBoneId ?? bone.id,
      name: bone.name,
      role: bone.role,
      aliases: semanticAliases(bone.name, bone.role),
      aiHint:
        bone.role === "root"
          ? "Root control for whole-character motion."
          : `${bone.name} control. Use this for inherited movement on this part of the rig.`,
    })),
    semanticSlots: slots.map((slot) => {
      const representative = representativePart(slot.parts);
      return {
        id: slot.id,
        name: slot.name ?? roleLabel(slot.role),
        role: slot.role,
        semanticType: semanticTypeForSlot(slot.role, slot.name ?? representative?.name ?? ""),
        angleIds: angles.filter((angle) =>
          slot.parts.some((part) => partAvailableForAngle(part, angle)),
        ),
        aliases: semanticAliases(
          slot.name ?? representative?.name ?? roleLabel(slot.role),
          slot.role,
        ),
        aiHint: aiHintForSlot(slot.role, slot.name ?? representative?.name ?? roleLabel(slot.role)),
        defaultAttachment: rig.slotBindings.find((binding) => binding.slotId === slot.id)?.boneId,
        preferredRig: preferredRigForSlot(slot.role, slot.name ?? ""),
      };
    }),
  };
}

export function angleRigJsonFromPreset(
  character: CharacterPreset,
  angleId = normalizeCharacterRig(character).activeAngle,
): AngleRigJson {
  const rig = normalizeCharacterRig({
    ...character,
    rig: { ...normalizeCharacterRig(character), activeAngle: angleId },
  });
  const slots = listCharacterSlots(partsAvailableForAngle(character.parts, rig.activeAngle));
  const variantsBySlot = new Map(
    slots.map((slot) => [
      slot.id,
      variantsForParts(
        slot.parts,
        character.variantPackages?.filter((variant) => variant.slotId === slot.id) ?? [],
      ),
    ]),
  );
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  return {
    kind: ANGLE_RIG_JSON_KIND,
    schemaVersion: CHARACTER_JSON_SCHEMA_VERSION,
    suggestedFilename: angleRigJsonFilename(character.name, angleId),
    characterId: `character:${character.id}`,
    angleId: rig.activeAngle,
    canvas: { width: character.canvasWidth, height: character.canvasHeight },
    bones: rig.bones.map((bone) => ({
      id: bone.id,
      semanticBoneId: bone.semanticBoneId ?? bone.id,
      name: bone.name,
      role: bone.role,
      parentId: bone.parentId ?? null,
      x: bone.x,
      y: bone.y,
      rotation: bone.rotation,
      depth: bone.depth,
      length: bone.length,
      maxExtension: null,
    })),
    slots: slots.map((slot) => ({
      id: slot.id,
      semanticSlotId:
        rig.slotBindings.find((binding) => binding.slotId === slot.id)?.semanticSlotId ?? slot.id,
      name: slot.name ?? roleLabel(slot.role),
      role: slot.role,
      variants: variantsBySlot.get(slot.id) ?? [],
      bounds: representativePart(slot.parts)?.bounds,
    })),
    bindings: rig.slotBindings.map((binding) => ({
      slotId: binding.slotId,
      boneId: binding.boneId,
      x: binding.x,
      y: binding.y,
      rotation: binding.rotation,
      scaleX: binding.scaleX,
      scaleY: binding.scaleY,
      depth: binding.depth,
      defaultVariant:
        binding.partId ??
        defaultVariantForParts(slotById.get(binding.slotId)?.parts ?? []) ??
        variantsBySlot.get(binding.slotId)?.[0]?.id,
      visible: true,
    })),
    slotRelations: rig.slotRelations.map((relation) => ({ ...relation })),
    hostConstraints: rig.hostConstraints.map((constraint) => ({ ...constraint })),
    reaches: rig.reaches.map((reach) => ({ ...reach })),
    drawOrder: rig.drawOrder,
  };
}

export function motionJsonFromPreset(preset: MotionPreset): MotionJson {
  return {
    kind: MOTION_JSON_KIND,
    schemaVersion: CHARACTER_JSON_SCHEMA_VERSION,
    suggestedFilename: motionJsonFilename(preset.name),
    id: `motion:${preset.id}`,
    name: preset.name,
    category: preset.category,
    angleIds: preset.angleIds,
    duration: preset.duration,
    loop: preset.loop,
    targetSpace: "parentRelative",
    tracks: preset.tracks.map((track, index) => motionJsonTrackFromPresetTrack(track, index)),
    constraints: preset.allowOutOfBounds?.length
      ? {
          defaultReachPolicy: "scaleToFit",
          allowOutOfBounds: preset.allowOutOfBounds.map((id) => ({
            target: id.startsWith("bone:")
              ? ({ kind: "semanticBone", id } as const)
              : ({ kind: "semanticSlot", id } as const),
          })),
        }
      : { defaultReachPolicy: "scaleToFit" },
    description: preset.description,
  };
}

function motionJsonTrackFromPresetTrack(track: MotionTrack, index: number): MotionJsonTrack {
  const id = `track:${index + 1}`;
  const channel = track.poseSwap ? "variant" : "transform";
  if (track.target === "camera" || track.partRole === "__camera") {
    return {
      id,
      angleIds: track.angleIds,
      target: { kind: "camera", id: "__camera" },
      channel: "transform",
      keyframes: track.keyframes,
    };
  }
  if (track.target === "bone" && track.boneId) {
    return {
      id,
      angleIds: track.angleIds,
      target: { kind: "semanticBone", id: track.boneId },
      channel,
      keyframes: track.keyframes.map((keyframe) => ({ ...keyframe, variant: track.poseSwap })),
    };
  }
  return {
    id,
    angleIds: track.angleIds,
    target: { kind: "semanticSlot", id: track.slotId ?? `role:${track.partRole}` },
    channel,
    keyframes: track.keyframes.map((keyframe) => ({ ...keyframe, variant: track.poseSwap })),
  };
}

function representativePart(parts: CharacterPart[]): CharacterPart | undefined {
  return parts.find((part) => part.visible) ?? parts[0];
}

function uniqueSemanticBones(rig: ReturnType<typeof normalizeCharacterRig>): CharacterBone[] {
  const out = new Map<string, CharacterBone>();
  const angleBones = Object.values(rig.angles ?? {}).flatMap((angleRig) => angleRig?.bones ?? []);
  for (const bone of angleBones.length ? angleBones : rig.bones) {
    const id = bone.semanticBoneId ?? bone.id;
    if (!out.has(id)) out.set(id, bone);
  }
  return Array.from(out.values());
}

function variantsForParts(
  parts: CharacterPart[],
  packages: CharacterSlotVariantPackage[] = [],
): AngleSlotVariantJson[] {
  const byVariant = new Map<string, CharacterPart[]>();
  for (const part of parts) {
    const key = variantKeyForPart(part);
    byVariant.set(key, [...(byVariant.get(key) ?? []), part]);
  }
  return Array.from(byVariant, ([id, groupedParts]) => {
    const representative = groupedParts[0];
    const explicitPackage = packages.find(
      (variant) => variant.id === id || variant.key === id || groupedParts.some((part) => part.variantPackageId === variant.id),
    );
    return {
      id,
      mediaId: representative.mediaId,
      name: representative.name,
      displayName: explicitPackage?.displayName ?? representative.variant?.name ?? representative.name,
      slotCompatibility: explicitPackage?.slotCompatibility,
      angleIds:
        explicitPackage?.angleIds ??
        uniqueAngles(groupedParts.flatMap((part) => part.angleIds ?? (part.angleId ? [part.angleId] : []))),
      variant: representative.variant,
      artwork:
        explicitPackage?.artwork ??
        {
          partIds: groupedParts.map((part) => part.id),
          layers: groupedParts.map((part) => ({
            id: part.id,
            partId: part.id,
            mediaId: part.mediaId,
            name: part.name,
            role: part.role,
            zIndex: part.zIndex,
          })),
        },
      rig: explicitPackage?.rig,
      aiMetadata: explicitPackage?.aiMetadata,
      pose: representative.pose,
      viseme: representative.viseme,
      eyeState: representative.eyeState,
    };
  });
}

function defaultVariantForParts(parts: CharacterPart[]): string | undefined {
  const part =
    parts.find((candidate) => partMatchesVariant(candidate, "rest")) ??
    representativePart(parts);
  return part ? variantKeyForPart(part) : undefined;
}

function uniqueAngles(angles: CharacterPreset["angles"]): CharacterPreset["angles"] | undefined {
  const unique = Array.from(new Set(angles ?? []));
  return unique.length ? unique : undefined;
}

function semanticTypeForSlot(role: PartRole, label: string): SemanticType {
  const text = label.toLowerCase();
  if (role === "mouth") return "mouthShape";
  if (role === "eye" || role === "iris" || role === "eyebrow" || role === "nose")
    return "faceFeature";
  if (role === "accessory") return "accessory";
  if (["head", "body", "arm", "hand", "leg", "foot", "hair"].includes(role)) return "bodyPart";
  if (text.includes("shirt") || text.includes("jacket") || text.includes("dress"))
    return "clothing";
  if (text.includes("tail") || text.includes("wing")) return "appendage";
  if (text.includes("umbrella") || text.includes("prop") || text.includes("bag")) return "prop";
  return "custom";
}

function preferredRigForSlot(role: PartRole, label: string): "single" | "chain" | "mesh" {
  const text = label.toLowerCase();
  if (role === "hair" || text.includes("tail") || text.includes("wing")) return "chain";
  return "single";
}

function semanticAliases(name: string, role: PartRole | "root" | "custom"): string[] {
  const aliases = new Set<string>([name]);
  if (role !== "custom" && role !== "root") aliases.add(role);
  return Array.from(aliases).filter(Boolean);
}

function aiHintForSlot(role: PartRole, name: string): string {
  if (role === "mouth") return `${name} slot. Use variants for visemes and expressions.`;
  if (role === "hand") return `${name} slot. Use variants for open palm, fist, pointing, or props.`;
  if (role === "custom")
    return `${name} custom slot. Use aliases and semantic type to infer motion.`;
  return `${name} visible slot attached to the rig. Use slot tracks for variants and local offsets.`;
}
