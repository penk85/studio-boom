import type {
  CharacterAngle,
  CharacterAngleRig,
  CharacterPart,
  CharacterPreset,
  CharacterRig,
  ID,
} from "../types";
import {
  anchorPartForVariant,
  getPartSlotId,
  listCharacterSlots,
  partMatchesVariant,
  variantKeyForPart,
} from "./character-utils";
import { rotateVector } from "./geometry";
import {
  availableCharacterAngles,
  computeBoneWorldTransforms,
  normalizeCharacterRig,
  representativePart,
  resolveCharacterAngleRig,
} from "./rig";
import {
  partLocalPointFromCanvas,
  pinTransformInBoneSpace,
  pinNameForChildSlot,
  registrationForPart,
} from "./registration";
import { pivotForPart } from "./alpha-bounds";

/**
 * One-way schema upgrade to the pin-based rig contract.
 *
 * Bones remain the only transform hierarchy. Every attached child bone references one named pin
 * on its parent slot. Existing angle/socket anchors are converted into variant-local part pins,
 * then removed from the normalized rig so runtime resolution has one authority.
 */
export function upgradeCharacterRigV2(character: CharacterPreset): CharacterPreset {
  const repairStalePins = character.rig?.pinSchemaRevision !== 2;
  const hasLegacySockets =
    !!character.rig?.sockets?.length ||
    Object.values(character.rig?.angles ?? {}).some((angleRig) => !!angleRig?.sockets?.length);
  const hasLegacyAnchors =
    !!character.rig?.bones.some((bone) => !!bone.parentVariantAnchors) ||
    Object.values(character.rig?.angles ?? {}).some((angleRig) =>
      angleRig?.bones.some((bone) => !!bone.parentVariantAnchors),
    );
  const sourceCharacter =
    hasLegacySockets || hasLegacyAnchors
      ? {
          ...character,
          rig: character.rig
            ? ({
                ...character.rig,
                version: 1,
              } as unknown as CharacterRig)
            : character.rig,
        }
      : character;
  const preserveV2Bindings =
    (character.rig as { version?: number } | undefined)?.version === 2 &&
    !hasLegacySockets &&
    !hasLegacyAnchors;
  const preserveMissingPins = character.rig?.pinSchemaInitialized === true && !repairStalePins;
  const legacyRig = normalizeCharacterRig(sourceCharacter);
  const partsById = new Map(character.parts.map((part) => [part.id, part]));
  const upgradedAngles: Partial<Record<CharacterAngle, CharacterAngleRig>> = {};

  for (const angle of availableCharacterAngles(character)) {
    const angleRig = resolveCharacterAngleRig(legacyRig, angle);
    const slotByBone = new Map(
      angleRig.slotBindings.map((binding) => [binding.boneId, binding.slotId]),
    );
    const slots = listCharacterSlots(character, { angle, includeEmpty: false });
    const slotById = new Map(slots.map((slot) => [slot.id, slot]));

    const bones = angleRig.bones.map((bone) => {
      if (!bone.parentId) return { ...bone, parentVariantAnchors: undefined };
      const childSlotId = slotByBone.get(bone.id);
      const parentSlotId = slotByBone.get(bone.parentId);
      const childSlot = childSlotId ? slotById.get(childSlotId) : undefined;
      const parentSlot = parentSlotId ? slotById.get(parentSlotId) : undefined;
      if (!childSlot || !parentSlot || !parentSlotId) {
        return { ...bone, parentVariantAnchors: undefined };
      }

      const pinName = bone.restSource?.pinName ?? pinNameForChildSlot(childSlot);
      for (const parentPart of parentSlot.parts) {
        const existing = partsById.get(parentPart.id) ?? parentPart;
        if (existing.pins?.[pinName] && !repairStalePins) continue;
        if (preserveMissingPins && bone.restSource) continue;
        const key = variantKeyForPart(parentPart);
        const registration = registrationForPart(existing);
        const authoredAnchor = bone.parentVariantAnchors?.[key];
        const pairedChild =
          anchorPartForVariant(childSlot.parts, key) ?? representativePart(childSlot);
        const pinPoint = authoredAnchor
          ? (() => {
              const localVector = rotateVector(
                { x: authoredAnchor.x, y: authoredAnchor.y },
                -registration.rotation,
              );
              return {
                x: registration.x + localVector.x,
                y: registration.y + localVector.y,
              };
            })()
          : pairedChild
            ? partLocalPointFromCanvas(existing, pivotForPart(pairedChild))
            : (() => {
                const localVector = rotateVector({ x: bone.x, y: bone.y }, -registration.rotation);
                return {
                  x: registration.x + localVector.x,
                  y: registration.y + localVector.y,
                };
              })();
        partsById.set(existing.id, {
          ...existing,
          pins: {
            ...(existing.pins ?? {}),
            [pinName]: {
              x: pinPoint.x,
              y: pinPoint.y,
              rotation: (authoredAnchor?.rotation ?? bone.rotation) - registration.rotation,
              space: "part-local-pixels",
            },
          },
        });
      }

      return {
        ...bone,
        restSource: {
          slotId: parentSlotId,
          pinName,
          ...(bone.restSource?.offset ? { offset: bone.restSource.offset } : {}),
        },
        parentVariantAnchors: undefined,
      };
    });

    upgradedAngles[angle] = {
      ...angleRig,
      bones,
      slotBindings: angleRig.slotBindings.map((binding) => ({
        ...binding,
        x: preserveV2Bindings ? binding.x : 0,
        y: preserveV2Bindings ? binding.y : 0,
        rotation: preserveV2Bindings ? binding.rotation : 0,
        scaleX: Number.isFinite(binding.scaleX) ? binding.scaleX : 1,
        scaleY: Number.isFinite(binding.scaleY) ? binding.scaleY : 1,
      })),
      sockets: undefined,
    };
  }

  const activeAngle = legacyRig.activeAngle;
  const active =
    upgradedAngles[activeAngle] ??
    upgradedAngles[availableCharacterAngles(character)[0] ?? "front"];
  const rig: CharacterRig = {
    ...legacyRig,
    version: 2,
    pinSchemaInitialized: true,
    pinSchemaRevision: 2,
    angles: upgradedAngles,
    bones: active?.bones ?? legacyRig.bones,
    slotBindings: active?.slotBindings ?? legacyRig.slotBindings,
    drawOrder: active?.drawOrder ?? legacyRig.drawOrder,
    slotRelations: active?.slotRelations ?? legacyRig.slotRelations,
    hostConstraints: active?.hostConstraints ?? legacyRig.hostConstraints,
    reaches: active?.reaches ?? legacyRig.reaches,
    sockets: undefined,
  };
  const parts = character.parts.map((part) => partsById.get(part.id) ?? part);
  return {
    ...character,
    parts,
    rig,
  };
}

export interface CharacterRigValidationIssue {
  severity: "error" | "warning";
  path: string;
  message: string;
}

export class CharacterPinRigError extends Error {
  issues: CharacterRigValidationIssue[];

  constructor(issues: CharacterRigValidationIssue[]) {
    super(
      `Character rig has unresolved pins:\n${issues.map((issue) => `- ${issue.message}`).join("\n")}`,
    );
    this.name = "CharacterPinRigError";
    this.issues = issues;
  }
}

export interface CharacterPinRigValidationOptions {
  angle?: CharacterAngle;
}

/**
 * Validate authored pin contracts without preventing an unfinished character from opening in the
 * builder. Callers can block scene insertion/export when any error is present.
 */
export function validateCharacterPinRig(
  character: CharacterPreset,
  options: CharacterPinRigValidationOptions = {},
): CharacterRigValidationIssue[] {
  const rig = normalizeCharacterRig(character);
  const issues: CharacterRigValidationIssue[] = [];
  const angles = options.angle ? [options.angle] : availableCharacterAngles(character);
  for (const angle of angles) {
    const angleRig = resolveCharacterAngleRig(rig, angle);
    const slotByBone = new Map(
      angleRig.slotBindings.map((binding) => [binding.boneId, binding.slotId]),
    );
    for (const bone of angleRig.bones) {
      if (!bone.restSource) continue;
      if (slotByBone.get(bone.parentId ?? "") !== bone.restSource.slotId) {
        issues.push({
          severity: "error",
          path: `rig.${angle}.bones.${bone.id}.restSource`,
          message: `Bone "${bone.name}" pin source must belong to its direct parent bone.`,
        });
        continue;
      }
      const parentParts = character.parts.filter(
        (part) =>
          getPartSlotId(part) === bone.restSource?.slotId &&
          (!part.angleIds?.length || part.angleIds.includes(angle)),
      );
      if (parentParts.length === 0) {
        issues.push({
          severity: "error",
          path: `rig.${angle}.bones.${bone.id}.restSource.slotId`,
          message: `Bone "${bone.name}" references a parent slot with no ${angle} artwork.`,
        });
        continue;
      }
      for (const part of parentParts) {
        if (part.pins?.[bone.restSource.pinName]) continue;
        issues.push({
          severity: "error",
          path: `parts.${part.id}.pins.${bone.restSource.pinName}`,
          message: `${part.name} is missing required pin "${bone.restSource.pinName}".`,
        });
      }
    }
  }
  return dedupeIssues(issues);
}

export function assertCharacterPinRigReady(character: CharacterPreset): void {
  const errors = validateCharacterPinRig(character).filter((issue) => issue.severity === "error");
  if (errors.length === 0) return;
  throw new CharacterPinRigError(errors);
}

export function assertCharacterPinRigReadyForAngle(
  character: CharacterPreset,
  angle: CharacterAngle,
): void {
  const errors = validateCharacterPinRig(character, { angle }).filter(
    (issue) => issue.severity === "error",
  );
  if (errors.length === 0) return;
  throw new CharacterPinRigError(errors);
}

function dedupeIssues(issues: CharacterRigValidationIssue[]): CharacterRigValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.severity}:${issue.path}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function requiredPinNamesForSlot(
  character: CharacterPreset,
  slotId: ID,
): Array<{ name: string; childBoneId: ID }> {
  const rig = normalizeCharacterRig(character);
  const out = new Map<string, ID>();
  for (const angle of availableCharacterAngles(character)) {
    for (const bone of resolveCharacterAngleRig(rig, angle).bones) {
      if (bone.restSource?.slotId === slotId) out.set(bone.restSource.pinName, bone.id);
    }
  }
  return Array.from(out, ([name, childBoneId]) => ({ name, childBoneId }));
}

type ActiveVariantSelection = ReadonlyMap<string, string> | Readonly<Record<string, string>>;

function activeVariantForSlot(
  selection: ActiveVariantSelection | undefined,
  slotId: string,
): string | undefined {
  if (!selection) return undefined;
  const mapSelection = selection as ReadonlyMap<string, string>;
  if (typeof mapSelection.get === "function") return mapSelection.get(slotId);
  return (selection as Readonly<Record<string, string>>)[slotId];
}

/**
 * Resolve the local rest transform of every pin-driven bone for one angle.
 *
 * The returned bones still form the only transform hierarchy. Active artwork supplies only the
 * local rest transform at named pins, so runtime playback and editor controls share one resolver.
 */
export function resolvePinnedBonesForAngle(
  character: CharacterPreset,
  angleRig: CharacterAngleRig,
  angle: CharacterAngle,
  activeVariants?: ActiveVariantSelection,
): CharacterAngleRig["bones"] {
  const slots = listCharacterSlots(character, { angle, includeEmpty: false });
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const bindingBySlot = new Map(angleRig.slotBindings.map((binding) => [binding.slotId, binding]));
  return angleRig.bones.map((bone) => {
    const source = bone.restSource;
    if (!source) return bone;
    const parentSlot = slotById.get(source.slotId);
    const binding = bindingBySlot.get(source.slotId);
    if (!parentSlot) return bone;
    const variantKey = activeVariantForSlot(activeVariants, source.slotId);
    const visibleParts = parentSlot.parts.filter((part) => part.visible);
    const parentPart =
      (variantKey
        ? visibleParts.find((part) => partMatchesVariant(part, variantKey))
        : undefined) ??
      (binding?.partId ? visibleParts.find((part) => part.id === binding.partId) : undefined) ??
      visibleParts.find((part) => partMatchesVariant(part, angle) || part.name === angle) ??
      visibleParts[0];
    const pin = parentPart?.pins?.[source.pinName];
    if (!parentPart || !pin) return bone;
    const rest = pinTransformInBoneSpace(parentPart, pin, source.offset);
    return { ...bone, x: rest.x, y: rest.y, rotation: rest.rotation };
  });
}

/**
 * Move a bone rest joint in canvas space. Attached bones write through to every active-angle
 * parent-art pin; top-level bones update their local rest transform. Artwork itself is untouched.
 */
export function moveCharacterBoneRest(
  character: CharacterPreset,
  boneId: ID,
  dx: number,
  dy: number,
  angle?: CharacterAngle,
  options: {
    keepArtwork?: boolean;
    activeVariants?: ActiveVariantSelection;
  } = {},
): CharacterPreset {
  const canonical = upgradeCharacterRigV2(character);
  const rig = normalizeCharacterRig(canonical);
  const activeAngle = angle ?? rig.activeAngle;
  const angleRig = resolveCharacterAngleRig(rig, activeAngle);
  const resolvedBones = resolvePinnedBonesForAngle(
    canonical,
    angleRig,
    activeAngle,
    options.activeVariants,
  );
  const bone = resolvedBones.find((candidate) => candidate.id === boneId);
  if (!bone) return canonical;

  if (!bone.restSource) {
    const resolvedRig: CharacterRig = {
      ...rig,
      bones: resolvedBones,
      angles: {
        ...(rig.angles ?? {}),
        [activeAngle]: { ...angleRig, bones: resolvedBones },
      },
    };
    const parentWorld = bone.parentId
      ? computeBoneWorldTransforms(resolvedRig, activeAngle).get(bone.parentId)
      : undefined;
    const localDelta = rotateVector({ x: dx, y: dy }, -(parentWorld?.rotation ?? 0));
    const moved = withAngleBones(canonical, rig, activeAngle, (bones) =>
      bones.map((candidate) =>
        candidate.id === boneId
          ? {
              ...candidate,
              x: candidate.x + localDelta.x,
              y: candidate.y + localDelta.y,
            }
          : candidate,
      ),
    );
    return options.keepArtwork
      ? counterMoveBoundArtwork(moved, angleRig, bone, dx, dy, activeAngle)
      : moved;
  }

  const parentBinding = angleRig.slotBindings.find(
    (binding) => binding.slotId === bone.restSource?.slotId,
  );
  const resolvedRig: CharacterRig = {
    ...rig,
    bones: resolvedBones,
    angles: {
      ...(rig.angles ?? {}),
      [activeAngle]: { ...angleRig, bones: resolvedBones },
    },
  };
  const parentWorld = parentBinding
    ? computeBoneWorldTransforms(resolvedRig, activeAngle).get(parentBinding.boneId)
    : undefined;
  const parentParts = canonical.parts.filter(
    (part) =>
      getPartSlotId(part) === bone.restSource?.slotId &&
      (!part.angleIds?.length || part.angleIds.includes(activeAngle)),
  );
  if (!parentWorld || parentParts.length === 0) return canonical;

  const activeVariant = activeVariantForSlot(options.activeVariants, bone.restSource.slotId);
  const activeParentPart =
    (activeVariant ? anchorPartForVariant(parentParts, activeVariant) : undefined) ??
    (parentBinding?.partId
      ? parentParts.find((part) => part.id === parentBinding.partId)
      : undefined) ??
    parentParts.find(
      (part) => partMatchesVariant(part, activeAngle) || part.name === activeAngle,
    ) ??
    parentParts[0];
  const parentIds = new Set(activeParentPart ? [activeParentPart.id] : []);
  const parts = canonical.parts.map((part) => {
    if (!parentIds.has(part.id)) return part;
    const registration = registrationForPart(part);
    const localDelta = rotateVector(
      { x: dx, y: dy },
      -(parentWorld.rotation + registration.rotation),
    );
    const existing = part.pins?.[bone.restSource!.pinName];
    const basePin = existing ?? {
      x: registration.x + rotateVector({ x: bone.x, y: bone.y }, -registration.rotation).x,
      y: registration.y + rotateVector({ x: bone.x, y: bone.y }, -registration.rotation).y,
      rotation: bone.rotation - registration.rotation,
      space: "part-local-pixels" as const,
    };
    return {
      ...part,
      pins: {
        ...(part.pins ?? {}),
        [bone.restSource!.pinName]: {
          ...basePin,
          x: basePin.x + localDelta.x,
          y: basePin.y + localDelta.y,
        },
      },
    };
  });
  const moved = withAngleBones({ ...canonical, parts }, rig, activeAngle, (bones) =>
    bones.map((candidate) =>
      candidate.id === boneId
        ? { ...candidate, x: candidate.x + dx, y: candidate.y + dy }
        : candidate,
    ),
  );
  const withPins = { ...moved, parts };
  return options.keepArtwork
    ? counterMoveBoundArtwork(withPins, angleRig, bone, dx, dy, activeAngle)
    : withPins;
}

/**
 * Fine-tune a joint through the same authored path as canvas dragging.
 *
 * X/Y and rotation are local to the parent bone. Pin-driven bones write parent-art pins;
 * unpinned bones write their own rest transform.
 */
export function setCharacterBoneRestTransform(
  character: CharacterPreset,
  boneId: ID,
  patch: Partial<Pick<CharacterAngleRig["bones"][number], "x" | "y" | "rotation">>,
  angle?: CharacterAngle,
  options: { activeVariants?: ActiveVariantSelection } = {},
): CharacterPreset {
  const canonical = upgradeCharacterRigV2(character);
  const rig = normalizeCharacterRig(canonical);
  const activeAngle = angle ?? rig.activeAngle;
  const angleRig = resolveCharacterAngleRig(rig, activeAngle);
  const resolvedBones = resolvePinnedBonesForAngle(
    canonical,
    angleRig,
    activeAngle,
    options.activeVariants,
  );
  const bone = resolvedBones.find((candidate) => candidate.id === boneId);
  if (!bone) return canonical;

  const localDelta = {
    x: Number.isFinite(patch.x) ? (patch.x as number) - bone.x : 0,
    y: Number.isFinite(patch.y) ? (patch.y as number) - bone.y : 0,
  };
  const resolvedRig: CharacterRig = {
    ...rig,
    bones: resolvedBones,
    angles: {
      ...(rig.angles ?? {}),
      [activeAngle]: { ...angleRig, bones: resolvedBones },
    },
  };
  const parentWorld = bone.parentId
    ? computeBoneWorldTransforms(resolvedRig, activeAngle).get(bone.parentId)
    : undefined;
  const canvasDelta = rotateVector(localDelta, parentWorld?.rotation ?? 0);
  const next =
    localDelta.x !== 0 || localDelta.y !== 0
      ? moveCharacterBoneRest(canonical, boneId, canvasDelta.x, canvasDelta.y, activeAngle, {
          activeVariants: options.activeVariants,
        })
      : canonical;

  if (!Number.isFinite(patch.rotation)) return next;
  const rotation = patch.rotation as number;
  const nextRig = normalizeCharacterRig(next);
  const nextAngleRig = resolveCharacterAngleRig(nextRig, activeAngle);
  const nextBone = nextAngleRig.bones.find((candidate) => candidate.id === boneId);
  if (!nextBone) return next;
  if (!nextBone.restSource) {
    return withAngleBones(next, nextRig, activeAngle, (bones) =>
      bones.map((candidate) => (candidate.id === boneId ? { ...candidate, rotation } : candidate)),
    );
  }

  const parentParts = next.parts.filter(
    (part) =>
      getPartSlotId(part) === nextBone.restSource?.slotId &&
      (!part.angleIds?.length || part.angleIds.includes(activeAngle)),
  );
  const parentBinding = nextAngleRig.slotBindings.find(
    (binding) => binding.slotId === nextBone.restSource?.slotId,
  );
  const activeVariant = activeVariantForSlot(options.activeVariants, nextBone.restSource.slotId);
  const activeParentPart =
    (activeVariant ? anchorPartForVariant(parentParts, activeVariant) : undefined) ??
    (parentBinding?.partId
      ? parentParts.find((part) => part.id === parentBinding.partId)
      : undefined) ??
    parentParts.find(
      (part) => partMatchesVariant(part, activeAngle) || part.name === activeAngle,
    ) ??
    parentParts[0];
  const parentPartIds = new Set(activeParentPart ? [activeParentPart.id] : []);
  const parts = next.parts.map((part) => {
    if (!parentPartIds.has(part.id)) return part;
    const pin = part.pins?.[nextBone.restSource!.pinName];
    if (!pin) return part;
    const registration = registrationForPart(part);
    return {
      ...part,
      pins: {
        ...(part.pins ?? {}),
        [nextBone.restSource!.pinName]: {
          ...pin,
          rotation: rotation - registration.rotation - (nextBone.restSource!.offset?.rotation ?? 0),
        },
      },
    };
  });
  return {
    ...next,
    parts,
    rig: {
      ...nextRig,
      version: 2,
      pinSchemaInitialized: true,
      pinSchemaRevision: 2,
      sockets: undefined,
    },
  };
}

/** Reparent one slot by changing the bone graph and authoring the required parent-part pins. */
export function setCharacterSlotParent(
  character: CharacterPreset,
  childSlotId: ID,
  parentSlotId?: ID,
  angle?: CharacterAngle,
): CharacterPreset {
  const canonical = upgradeCharacterRigV2(character);
  const rig = normalizeCharacterRig(canonical);
  const activeAngle = angle ?? rig.activeAngle;
  const angleRig = resolveCharacterAngleRig(rig, activeAngle);
  const childBinding = angleRig.slotBindings.find((binding) => binding.slotId === childSlotId);
  const childBone = childBinding
    ? angleRig.bones.find((bone) => bone.id === childBinding.boneId)
    : undefined;
  if (!childBone) return canonical;

  const world = computeBoneWorldTransforms(rig, activeAngle);
  const childWorld = world.get(childBone.id);
  const rootBone = angleRig.bones.find((bone) => bone.role === "root");
  const relations = angleRig.slotRelations.filter(
    (relation) => relation.childSlotId !== childSlotId,
  );
  if (!parentSlotId) {
    return withAngleRig(canonical, rig, activeAngle, {
      ...angleRig,
      bones: angleRig.bones.map((bone) =>
        bone.id === childBone.id
          ? {
              ...bone,
              parentId: rootBone?.id,
              restSource: undefined,
              x: childWorld?.x ?? bone.x,
              y: childWorld?.y ?? bone.y,
              rotation: childWorld?.rotation ?? bone.rotation,
            }
          : bone,
      ),
      slotRelations: relations,
      sockets: undefined,
    });
  }

  const parentBinding = angleRig.slotBindings.find((binding) => binding.slotId === parentSlotId);
  const parentBone = parentBinding
    ? angleRig.bones.find((bone) => bone.id === parentBinding.boneId)
    : undefined;
  const parentWorld = parentBone ? world.get(parentBone.id) : undefined;
  const childSlot = listCharacterSlots(canonical, {
    angle: activeAngle,
    includeEmpty: false,
  }).find((slot) => slot.id === childSlotId);
  if (!parentBone || !parentWorld || !childWorld || !childSlot) return canonical;

  const pinName = pinNameForChildSlot(childSlot);
  const parentPartIds = new Set(
    canonical.parts
      .filter(
        (part) =>
          getPartSlotId(part) === parentSlotId &&
          (!part.angleIds?.length || part.angleIds.includes(activeAngle)),
      )
      .map((part) => part.id),
  );
  const parts = canonical.parts.map((part) => {
    if (!parentPartIds.has(part.id)) return part;
    const registration = registrationForPart(part);
    const rel = rotateVector(
      {
        x: childWorld.x - parentWorld.x,
        y: childWorld.y - parentWorld.y,
      },
      -(parentWorld.rotation + registration.rotation),
    );
    return {
      ...part,
      pins: {
        ...(part.pins ?? {}),
        [pinName]: {
          x: registration.x + rel.x,
          y: registration.y + rel.y,
          rotation: childWorld.rotation - parentWorld.rotation - registration.rotation,
          space: "part-local-pixels" as const,
        },
      },
    };
  });
  const nextAngle: CharacterAngleRig = {
    ...angleRig,
    bones: angleRig.bones.map((bone) =>
      bone.id === childBone.id
        ? {
            ...bone,
            parentId: parentBone.id,
            restSource: { slotId: parentSlotId, pinName },
            parentVariantAnchors: undefined,
          }
        : bone,
    ),
    slotRelations: [
      ...relations,
      {
        id: `relation:${childSlotId}`,
        childSlotId,
        parentRef: { type: "slot", id: parentSlotId },
        relationType: childSlot.role === "iris" ? "containedFeature" : "attachment",
        transformMode: "inheritParent",
        visibilityMode: childSlot.role === "iris" ? "withParentVariant" : "withParentSlot",
        renderMode: childSlot.role === "iris" ? "nested" : "sibling",
        clipMode: childSlot.role === "iris" ? "clipToParentShape" : "none",
        characterViewIds: [activeAngle],
      },
    ],
    sockets: undefined,
  };
  return withAngleRig({ ...canonical, parts }, rig, activeAngle, nextAngle);
}

function counterMoveBoundArtwork(
  character: CharacterPreset,
  angleRig: CharacterAngleRig,
  bone: CharacterAngleRig["bones"][number],
  dx: number,
  dy: number,
  angle: CharacterAngle,
): CharacterPreset {
  const slotId = angleRig.slotBindings.find((binding) => binding.boneId === bone.id)?.slotId;
  if (!slotId) return character;
  const registrationDelta = rotateVector({ x: dx, y: dy }, -bone.rotation);
  return {
    ...character,
    parts: character.parts.map((part) => {
      if (
        getPartSlotId(part) !== slotId ||
        (part.angleIds?.length && !part.angleIds.includes(angle))
      ) {
        return part;
      }
      const registration = registrationForPart(part);
      const nextRegistration = {
        ...registration,
        x: registration.x + registrationDelta.x,
        y: registration.y + registrationDelta.y,
      };
      return {
        ...part,
        registration: nextRegistration,
        pivot: {
          x: part.x + nextRegistration.x,
          y: part.y + nextRegistration.y,
        },
        anchorX: nextRegistration.x / Math.max(1, part.width),
        anchorY: nextRegistration.y / Math.max(1, part.height),
      };
    }),
  };
}

function withAngleBones(
  character: CharacterPreset,
  rig: CharacterRig,
  angle: CharacterAngle,
  update: (bones: CharacterAngleRig["bones"]) => CharacterAngleRig["bones"],
): CharacterPreset {
  const angleRig = resolveCharacterAngleRig(rig, angle);
  const bones = update(angleRig.bones);
  const nextAngle = { ...angleRig, bones, sockets: undefined };
  return {
    ...character,
    rig: {
      ...rig,
      version: 2,
      pinSchemaInitialized: true,
      pinSchemaRevision: 2,
      angles: { ...(rig.angles ?? {}), [angle]: nextAngle },
      ...(angle === rig.activeAngle ? { bones, sockets: undefined } : {}),
    },
  };
}

function withAngleRig(
  character: CharacterPreset,
  rig: CharacterRig,
  angle: CharacterAngle,
  nextAngle: CharacterAngleRig,
): CharacterPreset {
  return {
    ...character,
    rig: {
      ...rig,
      version: 2,
      pinSchemaInitialized: true,
      pinSchemaRevision: 2,
      angles: { ...(rig.angles ?? {}), [angle]: nextAngle },
      ...(angle === rig.activeAngle
        ? {
            bones: nextAngle.bones,
            slotBindings: nextAngle.slotBindings,
            drawOrder: nextAngle.drawOrder,
            slotRelations: nextAngle.slotRelations,
            hostConstraints: nextAngle.hostConstraints,
            reaches: nextAngle.reaches,
            sockets: undefined,
          }
        : {}),
    },
  };
}
