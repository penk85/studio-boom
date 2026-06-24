import type { CharacterAngle, CharacterPart, CharacterPreset, ID } from "../types";
import {
  anchorPartForVariant,
  getPartSlotId,
  listCharacterSlots,
  partsAvailableForAngle,
  variantAliasesForPart,
  variantKeyForPackage,
  variantKeyForPart,
  variantKeySourceForPart,
} from "./character-utils";
import {
  ANGLE_LABELS,
  availableCharacterAngles,
  normalizeCharacterRig,
  representativePart,
  upsertSlotSocketAnchor,
} from "./rig";
import { parentSlotIdForBone } from "./motion-constraints";
import { alphaCenterForPart, pivotForPart } from "./alpha-bounds";
import { rotateVector } from "./geometry";
import { pinNameForChildSlot, pinTransformInBoneSpace, registrationForPart } from "./registration";
import { buildCharacterRuntime, runtimeBoneWorldTransforms, runtimePartPlacement } from "./runtime";

/**
 * Parent↔child variant pairing helpers for the Character Editor authoring UX. Pure functions:
 * no React and no DOM. The shared runtime resolves part-local pins into the bone graph; this
 * module authors those pins and reports incomplete contracts.
 */

/** Comparison form for near-miss detection: keys pair by exact match at runtime. */
export function normalizeVariantKey(key: string): string {
  return key.trim().toLowerCase();
}

/** Distinct variant keys a slot answers to: its parts' resolved keys plus its package keys. */
export function slotVariantKeys(
  character: Pick<CharacterPreset, "parts" | "variantPackages">,
  slotId: ID,
  angle?: CharacterAngle,
): string[] {
  const keys: string[] = [];
  const push = (key: string | undefined) => {
    const trimmed = key?.trim();
    if (trimmed && !keys.includes(trimmed)) keys.push(trimmed);
  };
  const parts = angle ? partsAvailableForAngle(character.parts, angle) : character.parts;
  for (const part of parts) {
    if (getPartSlotId(part) === slotId) push(variantKeyForPart(part));
  }
  for (const pkg of character.variantPackages ?? []) {
    if (pkg.slotId !== slotId) continue;
    if (angle && pkg.angleIds?.length && !pkg.angleIds.includes(angle)) continue;
    push(variantKeyForPackage(pkg, parts));
  }
  return keys;
}

export interface VariantKeyNearMiss {
  parentSlotId: ID;
  childSlotId: ID;
  /** The parent slot's variant key the child almost pairs with. */
  parentKey: string;
  /** The child part's alias that matches only after trim/lowercase. */
  childKey: string;
  childPartId: ID;
  /**
   * "warning" when no anchor resolved for the parent key on the child's bone (the mismatch is
   * costing an anchor); "info" when an anchor exists anyway (e.g. an authored socket) so only
   * variant-gating consistency is affected.
   */
  severity: "warning" | "info";
}

/**
 * Find child variant keys that pair with a parent variant only after normalization — the
 * `hand "Bent" ≠ arm "bent"` trap. Runtime pairing is exact-match, so these silently fall back.
 */
export function findVariantKeyNearMisses(character: CharacterPreset): VariantKeyNearMiss[] {
  const rig = normalizeCharacterRig(character);
  const out: VariantKeyNearMiss[] = [];
  const partsBySlot = new Map<ID, CharacterPart[]>();
  const activeParts = partsAvailableForAngle(character.parts, rig.activeAngle);
  for (const part of activeParts) {
    const slotId = getPartSlotId(part);
    partsBySlot.set(slotId, [...(partsBySlot.get(slotId) ?? []), part]);
  }

  for (const bone of rig.bones) {
    const childSlotId = rig.slotBindings.find((binding) => binding.boneId === bone.id)?.slotId;
    const parentSlotId = parentSlotIdForBone(rig, bone.id);
    if (!childSlotId || !parentSlotId) continue;
    const parentKeys = slotVariantKeys(character, parentSlotId, rig.activeAngle);
    if (parentKeys.length <= 1) continue;
    const childParts = partsBySlot.get(childSlotId) ?? [];

    for (const parentKey of parentKeys) {
      const normalizedParent = normalizeVariantKey(parentKey);
      const exactMatch = childParts.some((part) => variantAliasesForPart(part).includes(parentKey));
      if (exactMatch) continue;
      for (const part of childParts) {
        const nearAlias = variantAliasesForPart(part).find(
          (alias) => alias !== parentKey && normalizeVariantKey(alias) === normalizedParent,
        );
        if (!nearAlias) continue;
        out.push({
          parentSlotId,
          childSlotId,
          parentKey,
          childKey: nearAlias,
          childPartId: part.id,
          severity:
            bone.restSource &&
            partsBySlot
              .get(parentSlotId)
              ?.some(
                (parentPart) =>
                  variantAliasesForPart(parentPart).includes(parentKey) &&
                  !!parentPart.pins?.[bone.restSource!.pinName],
              )
              ? "info"
              : "warning",
        });
      }
    }
  }
  return out;
}

/** True when this part's resolved key is the id fallback inside a slot that has real variants. */
export function isUnkeyedVariantPart(
  character: Pick<CharacterPreset, "parts">,
  part: CharacterPart,
): boolean {
  if (variantKeySourceForPart(part).source !== "idFallback") return false;
  const slotId = getPartSlotId(part);
  return character.parts.filter((candidate) => getPartSlotId(candidate) === slotId).length > 1;
}

export interface VariantPreviewShift {
  /** Canvas-space offset + extra rotation (about the part pivot) per part id. */
  parts: Map<ID, { dx: number; dy: number; rotation: number }>;
  /** Canvas-space offset + rotation delta per bone id (for overlay markers). */
  bones: Map<ID, { dx: number; dy: number; rotation: number }>;
}

/**
 * Canvas offsets and rotations that re-anchor children while parent slots preview a variant in
 * the editor. Computed as a rigid-transform diff: rebuild the bone world transforms with each
 * previewed anchor's position/rotation applied, then express each part's movement as a pivot
 * displacement plus a rotation about its own pivot (matching how the editor renders parts —
 * absolute rest positions, not through bones).
 *
 * A slot previewing its OWN variant key additionally aligns the displayed group by pivot —
 * the canvas vector `pivot(rep) − pivot(anchorPart(key))` — mirroring the composition's
 * pivot-aligned placement, so the preview shows the variant where playback will put it.
 * Face slots are exempt (the composition keeps their authored placement) and ghosts/rest
 * views never shift.
 */
export function variantPreviewDeltas(
  character: CharacterPreset,
  variantPreview: Readonly<Record<ID, string>>,
): VariantPreviewShift {
  const parts = new Map<ID, { dx: number; dy: number; rotation: number }>();
  const bones = new Map<ID, { dx: number; dy: number; rotation: number }>();
  if (Object.keys(variantPreview).length === 0) return { parts, bones };

  const runtime = buildCharacterRuntime(character);
  const restWorld = runtime.worldByBone;
  const previewWorld = runtimeBoneWorldTransforms(runtime, variantPreview);
  for (const bone of runtime.angleRig.bones) {
    const rest = restWorld.get(bone.id);
    const moved = previewWorld.get(bone.id);
    if (!rest || !moved) continue;
    const shift = {
      dx: moved.x - rest.x,
      dy: moved.y - rest.y,
      rotation: moved.rotation - rest.rotation,
    };
    if (shift.dx === 0 && shift.dy === 0 && shift.rotation === 0) continue;
    bones.set(bone.id, shift);
  }

  for (const slot of runtime.slots) {
    for (const part of slot.parts) {
      const rest = runtimePartPlacement(slot, part, runtime);
      const moved = runtimePartPlacement(slot, part, runtime, {
        poseKey: variantPreview[slot.id],
        activeVariants: variantPreview,
        worldByBone: previewWorld,
      });
      const shift = {
        dx: moved.x - rest.x,
        dy: moved.y - rest.y,
        rotation: moved.rotation - rest.rotation,
      };
      if (shift.dx !== 0 || shift.dy !== 0 || shift.rotation !== 0) {
        parts.set(part.id, shift);
      }
    }
  }
  return { parts, bones };
}

/** The resolved anchor entry for a child slot under a parent variant key, if any. */
export function anchorEntryForChild(
  character: CharacterPreset,
  childSlotId: ID,
  parentVariantKey: string,
): { x: number; y: number; rotation?: number; source: "pin" } | undefined {
  const runtime = buildCharacterRuntime(character);
  const binding = runtime.bindingBySlot.get(childSlotId);
  const bone = binding ? runtime.boneById.get(binding.effectiveBoneId) : undefined;
  const source = bone?.restSource;
  const parentSlot = source ? runtime.slotById.get(source.slotId) : undefined;
  const parentPart = parentSlot
    ? anchorPartForVariant(parentSlot.parts, parentVariantKey)
    : undefined;
  const pin = parentPart && source ? parentPart.pins?.[source.pinName] : undefined;
  if (!parentPart || !pin || !source) return undefined;
  return {
    ...pinTransformInBoneSpace(parentPart, pin, source.offset),
    source: "pin",
  };
}

/** How a child slot's anchor currently resolves under a parent variant key. */
export function anchorSourceForChild(
  character: CharacterPreset,
  childSlotId: ID,
  parentVariantKey: string,
): "pin" | "fallback" {
  return anchorEntryForChild(character, childSlotId, parentVariantKey)?.source ?? "fallback";
}

/**
 * Pin the joint so the child bone lands at `anchorPoint` (canvas px). Converts the desired
 * canvas point into the active parent artwork's part-local coordinate space.
 */
export function upsertVariantPinAtPoint(
  character: CharacterPreset,
  args: {
    parentSlotId: ID;
    variantKey: string;
    childSlotId: ID;
    anchorPoint: { x: number; y: number };
  },
): CharacterPreset {
  const runtime = buildCharacterRuntime(character);
  const parentSlot = runtime.slotById.get(args.parentSlotId);
  const childSlot = runtime.slotById.get(args.childSlotId);
  const parentPart = parentSlot
    ? anchorPartForVariant(parentSlot.parts, args.variantKey)
    : undefined;
  const parentBinding = runtime.bindingBySlot.get(args.parentSlotId);
  const parentWorld = parentBinding
    ? runtime.worldByBone.get(parentBinding.effectiveBoneId)
    : undefined;
  const childBinding = runtime.bindingBySlot.get(args.childSlotId);
  const childBone = childBinding ? runtime.boneById.get(childBinding.effectiveBoneId) : undefined;
  if (!parentPart || !parentWorld || !childBone || !childSlot) return runtime.character;

  const pinName = childBone.restSource?.pinName ?? pinNameForChildSlot(childSlot);
  const registration = registrationForPart(parentPart);
  const partRotation = parentWorld.rotation + registration.rotation;
  const radians = (-partRotation * Math.PI) / 180;
  const rel = {
    x: args.anchorPoint.x - parentWorld.x,
    y: args.anchorPoint.y - parentWorld.y,
  };
  const local = {
    x: registration.x + rel.x * Math.cos(radians) - rel.y * Math.sin(radians),
    y: registration.y + rel.x * Math.sin(radians) + rel.y * Math.cos(radians),
  };
  return withPartPinAndBoneSource(runtime.character, {
    parentPartId: parentPart.id,
    parentSlotId: args.parentSlotId,
    childBoneId: childBone.id,
    pinName,
    pin: {
      x: local.x,
      y: local.y,
      rotation: parentPart.pins?.[pinName]?.rotation ?? childBone.rotation - registration.rotation,
      space: "part-local-pixels",
    },
  });
}

/** Rebuild one parent-variant output pin from the child artwork's authored canvas pivot. */
export function resetVariantPinToArtwork(
  character: CharacterPreset,
  args: { parentSlotId: ID; variantKey: string; childSlotId: ID },
): CharacterPreset {
  const runtime = buildCharacterRuntime(character);
  const childSlot = runtime.slotById.get(args.childSlotId);
  if (!childSlot) return runtime.character;
  const childPart =
    anchorPartForVariant(childSlot.parts, args.variantKey) ?? representativePart(childSlot);
  if (!childPart) return runtime.character;
  return upsertVariantPinAtPoint(runtime.character, {
    ...args,
    anchorPoint: pivotForPart(childPart),
  });
}

/**
 * Set the child's rest angle under a parent variant. Writes through the joint (creating one at
 * the currently-resolved anchor position when none exists), so a single child art can sit at a
 * different angle per parent variant — paired art expresses its angle in its own part rotation.
 */
export function setVariantPinRotation(
  character: CharacterPreset,
  args: { parentSlotId: ID; variantKey: string; childSlotId: ID; rotation: number },
): CharacterPreset {
  const runtime = buildCharacterRuntime(character);
  const parentSlot = runtime.slotById.get(args.parentSlotId);
  const childSlot = runtime.slotById.get(args.childSlotId);
  const parentPart = parentSlot
    ? anchorPartForVariant(parentSlot.parts, args.variantKey)
    : undefined;
  const childBinding = runtime.bindingBySlot.get(args.childSlotId);
  const childBone = childBinding ? runtime.boneById.get(childBinding.effectiveBoneId) : undefined;
  if (!parentPart || !childBone || !childSlot) return runtime.character;
  const pinName = childBone.restSource?.pinName ?? pinNameForChildSlot(childSlot);
  const registration = registrationForPart(parentPart);
  const offset = childBone.restSource?.offset;
  const fallbackPoint = rotateVector(
    {
      x: childBone.x - (offset?.x ?? 0),
      y: childBone.y - (offset?.y ?? 0),
    },
    -registration.rotation,
  );
  const existing = parentPart.pins?.[pinName] ?? {
    x: registration.x + fallbackPoint.x,
    y: registration.y + fallbackPoint.y,
    rotation: childBone.rotation - registration.rotation - (offset?.rotation ?? 0),
    space: "part-local-pixels" as const,
  };
  return withPartPinAndBoneSource(runtime.character, {
    parentPartId: parentPart.id,
    parentSlotId: args.parentSlotId,
    childBoneId: childBone.id,
    pinName,
    pin: {
      ...existing,
      rotation: args.rotation - registration.rotation,
    },
  });
}

/** Remove the authored output pin for `childSlotId` from the active parent variant. */
export function removeVariantPin(
  character: CharacterPreset,
  args: { parentSlotId: ID; variantKey: string; childSlotId: ID },
): CharacterPreset {
  const runtime = buildCharacterRuntime(character);
  const parentSlot = runtime.slotById.get(args.parentSlotId);
  const parentPart = parentSlot
    ? anchorPartForVariant(parentSlot.parts, args.variantKey)
    : undefined;
  const childBinding = runtime.bindingBySlot.get(args.childSlotId);
  const childBone = childBinding ? runtime.boneById.get(childBinding.effectiveBoneId) : undefined;
  const pinName = childBone?.restSource?.pinName;
  if (!parentPart || !pinName) return runtime.character;
  return {
    ...runtime.character,
    parts: runtime.character.parts.map((part) => {
      if (part.id !== parentPart.id || !part.pins?.[pinName]) return part;
      const pins = { ...part.pins };
      delete pins[pinName];
      return { ...part, pins: Object.keys(pins).length ? pins : undefined };
    }),
    rig: runtime.character.rig
      ? {
          ...runtime.character.rig,
          version: 2,
          pinSchemaInitialized: true,
          pinSchemaRevision: 2,
          sockets: undefined,
        }
      : runtime.character.rig,
  };
}

function withPartPinAndBoneSource(
  character: CharacterPreset,
  args: {
    parentPartId: ID;
    parentSlotId: ID;
    childBoneId: ID;
    pinName: string;
    pin: NonNullable<CharacterPart["pins"]>[string];
  },
): CharacterPreset {
  const rig = normalizeCharacterRig(character);
  const angle = rig.activeAngle;
  const updateBones = (bones: typeof rig.bones) =>
    bones.map((bone) =>
      bone.id === args.childBoneId
        ? {
            ...bone,
            restSource: {
              slotId: args.parentSlotId,
              pinName: args.pinName,
              ...(bone.restSource?.offset ? { offset: bone.restSource.offset } : {}),
            },
            parentVariantAnchors: undefined,
          }
        : bone,
    );
  const angleRig = rig.angles?.[angle];
  const bones = updateBones(angleRig?.bones ?? rig.bones);
  return {
    ...character,
    parts: character.parts.map((part) =>
      part.id === args.parentPartId
        ? {
            ...part,
            pins: {
              ...(part.pins ?? {}),
              [args.pinName]: args.pin,
            },
          }
        : part,
    ),
    rig: {
      ...rig,
      version: 2,
      pinSchemaInitialized: true,
      pinSchemaRevision: 2,
      bones,
      angles: {
        ...(rig.angles ?? {}),
        [angle]: {
          ...(angleRig ?? {
            angleId: angle,
            slotBindings: rig.slotBindings,
            drawOrder: rig.drawOrder,
            slotRelations: rig.slotRelations,
            hostConstraints: rig.hostConstraints,
            reaches: rig.reaches,
          }),
          bones,
          sockets: undefined,
        },
      },
      sockets: undefined,
    },
  };
}

/**
 * One-time, conservative, idempotent migration of legacy variant-package sockets into per-angle
 * rig joint records. A legacy socket applies to the package's `angleIds`, else to every
 * available angle (preserving the old un-scoped behavior at the moment of migration). After
 * conversion the package's `rig.sockets` is stripped; a package is deleted ONLY when it is a
 * strictly empty shell (no artwork, no aiMetadata, no slotCompatibility, no angleIds, no
 * custom displayName, and no other rig content). Returns the character unchanged when there is
 * nothing to migrate.
 */
export function migrateLegacyVariantSockets(character: CharacterPreset): CharacterPreset {
  const packages = character.variantPackages ?? [];
  const hasLegacySockets = packages.some((pkg) => pkg.rig?.sockets);
  if (!hasLegacySockets) return character;

  let rig = normalizeCharacterRig(character);
  const angles = availableCharacterAngles(character);
  for (const pkg of packages) {
    const outputs = pkg.rig?.sockets?.outputs ?? [];
    const variantKey = variantKeyForPackage(pkg, character.parts);
    const targetAngles = pkg.angleIds?.length ? pkg.angleIds : angles;
    for (const socket of outputs) {
      if (!socket.childSlotId || !Number.isFinite(socket.x) || !Number.isFinite(socket.y)) continue;
      for (const angle of targetAngles) {
        rig = upsertSlotSocketAnchor(
          rig,
          {
            parentSlotId: pkg.slotId,
            childSlotId: socket.childSlotId,
            variantKey,
            x: socket.x,
            y: socket.y,
            rotation: socket.rotation,
          },
          angle,
        );
      }
    }
  }

  const remaining = packages
    .map((pkg) => {
      if (!pkg.rig?.sockets) return pkg;
      const rigRest = { ...pkg.rig };
      delete rigRest.sockets;
      const rigEmpty =
        !rigRest.bones?.length &&
        !rigRest.controls?.length &&
        !rigRest.clipping &&
        !rigRest.zOrder?.length;
      return { ...pkg, rig: rigEmpty ? undefined : rigRest };
    })
    .filter((pkg) => {
      const autoName = pkg.displayName === (pkg.key ?? pkg.displayName);
      const strictlyEmptyShell =
        !pkg.rig &&
        !pkg.artwork &&
        !pkg.aiMetadata &&
        !pkg.slotCompatibility?.length &&
        !pkg.angleIds?.length &&
        autoName;
      return !strictlyEmptyShell;
    });

  return {
    ...character,
    rig,
    variantPackages: remaining.length ? remaining : undefined,
  };
}

/**
 * Rename a slot's variant key everywhere it is referenced: joint anchors (every angle), pose
 * presets, and variant-gated slot relations. Keeps a rename from silently orphaning anchors —
 * the phase-one mitigation until variants get stable internal IDs.
 */
export function renameVariantKeyEverywhere(
  character: CharacterPreset,
  slotId: ID,
  oldKey: string,
  newKey: string,
): CharacterPreset {
  if (!oldKey || !newKey || oldKey === newKey) return character;
  const rig = normalizeCharacterRig(character);

  const renameRelations = (relations: typeof rig.slotRelations) =>
    relations.map((relation) => {
      const parentId =
        relation.parentRef.type === "slot" || relation.parentRef.type === "semanticSlot"
          ? relation.parentRef.id
          : undefined;
      if (parentId !== slotId || !relation.activeWhenParentVariant?.keys?.includes(oldKey))
        return relation;
      return {
        ...relation,
        activeWhenParentVariant: {
          ...relation.activeWhenParentVariant,
          keys: relation.activeWhenParentVariant.keys.map((key) => (key === oldKey ? newKey : key)),
        },
      };
    });

  const angles = Object.fromEntries(
    Object.entries(rig.angles ?? {}).map(([angleId, angleRig]) => [
      angleId,
      angleRig
        ? {
            ...angleRig,
            sockets: undefined,
            slotRelations: renameRelations(angleRig.slotRelations),
          }
        : angleRig,
    ]),
  ) as typeof rig.angles;

  const posePresets = character.posePresets?.map((preset) =>
    preset.poses[slotId] === oldKey
      ? { ...preset, poses: { ...preset.poses, [slotId]: newKey } }
      : preset,
  );

  return {
    ...character,
    rig: {
      ...rig,
      angles,
      sockets: undefined,
      slotRelations: renameRelations(rig.slotRelations),
    },
    ...(posePresets ? { posePresets } : {}),
  };
}

export interface VariantKeyIssue {
  severity: "warning" | "info";
  message: string;
}

/**
 * Per-part variant key problems for the editor: near-miss keys against the parent slot and
 * id-fallback keys inside multi-variant slots. Keyed by part id; parts without issues are absent.
 */
export function collectVariantKeyIssues(character: CharacterPreset): Map<ID, VariantKeyIssue[]> {
  const out = new Map<ID, VariantKeyIssue[]>();
  const add = (partId: ID, issue: VariantKeyIssue) => {
    out.set(partId, [...(out.get(partId) ?? []), issue]);
  };
  const slotLabel = (slotId: ID) =>
    character.parts.find((part) => getPartSlotId(part) === slotId)?.slotName ?? slotId;

  for (const miss of findVariantKeyNearMisses(character)) {
    add(miss.childPartId, {
      severity: miss.severity,
      message:
        `"${miss.childKey}" almost matches ${slotLabel(miss.parentSlotId)} "${miss.parentKey}" — ` +
        "keys must match exactly to pair.",
    });
  }
  for (const part of character.parts) {
    if (isUnkeyedVariantPart(character, part)) {
      add(part.id, {
        severity: "warning",
        message: "No variant key — falls back to the part id and can't pair with parent variants.",
      });
    }
  }
  return out;
}

export interface RigHealthAnchorRow {
  childSlotId: ID;
  parentSlotId: ID;
  variantKey: string;
  source: "pin" | "fallback";
  /** Local anchor in the parent bone's frame (bone base x/y for fallback rows). */
  anchor: { x: number; y: number };
}

export interface RigHealthWarning {
  severity: "warning" | "info";
  message: string;
  childSlotId?: ID;
  parentSlotId?: ID;
  variantKey?: string;
  partId?: ID;
  /** For cross-angle warnings: the specific angle this warning is about. */
  affectedAngle?: CharacterAngle;
}

export interface RigHealthReport {
  anchorRows: RigHealthAnchorRow[];
  warnings: RigHealthWarning[];
}

/**
 * The whole-character verification checklist: every child pin with its resolution path, plus
 * key/pivot problems. It reads the same restSource and part pins as the runtime resolver.
 */
export function buildRigHealthReport(character: CharacterPreset): RigHealthReport {
  const rig = normalizeCharacterRig(character);
  const anchorRows: RigHealthAnchorRow[] = [];
  const warnings: RigHealthWarning[] = [];
  const slotLabel = (slotId: ID) =>
    character.parts.find((part) => getPartSlotId(part) === slotId)?.slotName ?? slotId;

  const anchoredParentSlots = new Set<ID>();
  const runtime = buildCharacterRuntime(character);
  for (const bone of runtime.angleRig.bones) {
    const childSlotId = runtime.angleRig.slotBindings.find(
      (binding) => binding.boneId === bone.id,
    )?.slotId;
    const parentSlotId = bone.restSource?.slotId;
    const parentSlot = parentSlotId ? runtime.slotById.get(parentSlotId) : undefined;
    if (!childSlotId || !parentSlotId || !parentSlot || !bone.restSource) continue;
    const parentKeys = slotVariantKeys(character, parentSlotId, rig.activeAngle);
    if (parentKeys.length <= 1) continue;
    for (const variantKey of parentKeys) {
      const parentPart = anchorPartForVariant(parentSlot.parts, variantKey);
      const pin = parentPart?.pins?.[bone.restSource.pinName];
      const entry =
        parentPart && pin
          ? pinTransformInBoneSpace(parentPart, pin, bone.restSource.offset)
          : undefined;
      anchorRows.push({
        childSlotId,
        parentSlotId,
        variantKey,
        source: entry ? "pin" : "fallback",
        anchor: entry ?? { x: bone.x, y: bone.y },
      });
      if (entry) anchoredParentSlots.add(parentSlotId);
      else {
        warnings.push({
          severity: "warning",
          message:
            `${slotLabel(parentSlotId)} "${variantKey}" is missing required pin ` +
            `"${bone.restSource.pinName}" for ${slotLabel(childSlotId)}.`,
          childSlotId,
          parentSlotId,
          variantKey,
        });
      }
    }
  }

  for (const miss of findVariantKeyNearMisses(character)) {
    warnings.push({
      severity: miss.severity,
      message:
        `${slotLabel(miss.childSlotId)} "${miss.childKey}" almost matches ` +
        `${slotLabel(miss.parentSlotId)} "${miss.parentKey}" — keys must match exactly to pair.`,
      childSlotId: miss.childSlotId,
      parentSlotId: miss.parentSlotId,
      variantKey: miss.parentKey,
      partId: miss.childPartId,
    });
  }

  for (const part of character.parts) {
    if (isUnkeyedVariantPart(character, part)) {
      warnings.push({
        severity: "warning",
        message:
          `${part.name} has no variant key — it falls back to its part id and can't pair ` +
          "with parent variants.",
        childSlotId: getPartSlotId(part),
        partId: part.id,
      });
    }
  }

  // Cross-angle vocabulary contract: slots and variant keys should exist on every angle that
  // has artwork — a key present on Front but missing on Side Left makes pose chips fall back
  // there. Info-level: it's the authoring checklist for a new angle, not an error.
  const allAngles = availableCharacterAngles(character);
  if (allAngles.length > 1) {
    for (const slot of listCharacterSlots(character, { includeEmpty: false })) {
      const perAngle = allAngles.map((angle) => ({
        angle,
        keys: new Set(
          partsAvailableForAngle(slot.parts, angle)
            .filter((part) => variantKeySourceForPart(part).source !== "idFallback")
            .map((part) => variantKeyForPart(part)),
        ),
        hasArt: partsAvailableForAngle(slot.parts, angle).length > 0,
      }));
      const withArt = perAngle.filter((entry) => entry.hasArt);
      if (withArt.length === 0) continue;
      for (const entry of perAngle) {
        if (!entry.hasArt) {
          warnings.push({
            severity: "info",
            message: `${slotLabel(slot.id)} has no ${ANGLE_LABELS[entry.angle]} artwork yet.`,
            childSlotId: slot.id,
            affectedAngle: entry.angle,
          });
        }
      }
      const allKeys = new Set(withArt.flatMap((entry) => [...entry.keys]));
      for (const key of allKeys) {
        const has = withArt.filter((entry) => entry.keys.has(key));
        const lacks = withArt.filter((entry) => !entry.keys.has(key));
        if (has.length === 0 || lacks.length === 0) continue;
        // Tag the warning with each affected angle separately so the panel can group them.
        for (const lacking of lacks) {
          warnings.push({
            severity: "info",
            message:
              `"${key}" exists on ${has.map((entry) => ANGLE_LABELS[entry.angle]).join(", ")} ` +
              `but is missing on ${ANGLE_LABELS[lacking.angle]} — pose chips fall back there.`,
            childSlotId: slot.id,
            variantKey: key,
            affectedAngle: lacking.angle,
          });
        }
      }
    }
  }

  // Parent slots that carry anchored children but whose pivot is still the auto-center default:
  // the pivot is the anchor reference, so an unconsidered pivot is worth a look (info only).
  for (const parentSlotId of anchoredParentSlots) {
    const parts = partsAvailableForAngle(character.parts, rig.activeAngle).filter(
      (part) => getPartSlotId(part) === parentSlotId,
    );
    const rep = parts.find((part) => part.visible) ?? parts[0];
    if (!rep) continue;
    const pivot = pivotForPart(rep);
    const auto = alphaCenterForPart(rep);
    if (Math.abs(pivot.x - auto.x) <= 1 && Math.abs(pivot.y - auto.y) <= 1) {
      warnings.push({
        severity: "info",
        message:
          `${slotLabel(parentSlotId)} carries anchored children but its pivot is still the ` +
          "auto-center — set it deliberately (the pivot is the anchor reference).",
        parentSlotId,
      });
    }
  }

  return { anchorRows, warnings };
}
