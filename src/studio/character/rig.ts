import type {
  CharacterAngle,
  CharacterAngleRig,
  CharacterBone,
  CharacterHostConstraint,
  CharacterIkConstraint,
  CharacterPart,
  CharacterPreset,
  CharacterReach,
  CharacterRig,
  CharacterSlotBinding,
  CharacterSlotRelation,
  CharacterSocketAnchor,
  CharacterSlotSocket,
  ID,
  PartRole,
} from "../types";
import {
  anchorPartForVariant,
  getPartSlotId,
  inferPartSide,
  listCharacterSlots,
  partMatchesVariant,
  partsAvailableForAngle,
  roleLabel,
  variantKeyForPart,
} from "./character-utils";
import { pivotForPart } from "./alpha-bounds";
import { pinNameForChildSlot, pinTransformInBoneSpace } from "./registration";

export const CHARACTER_ANGLES: CharacterAngle[] = ["front", "3qL", "3qR", "sideL", "sideR"];

/** User-facing labels for the discrete character angles. */
export const ANGLE_LABELS: Record<CharacterAngle, string> = {
  front: "Front",
  "3qL": "¾ Left",
  "3qR": "¾ Right",
  sideL: "Left Side",
  sideR: "Right Side",
};

export interface ResolvedSlotBinding extends CharacterSlotBinding {
  effectiveBoneId: ID;
  effectiveDepth: number;
  visible: boolean;
  effectivePartId?: ID;
}

export interface BoneWorldTransform {
  id: ID;
  x: number;
  y: number;
  rotation: number;
  depth: number;
  parentId?: ID;
}

type SlotLike = ReturnType<typeof listCharacterSlots>[number];

const ROOT_BONE_ID = "bone:root";

type SocketAnchorInput = Partial<CharacterSocketAnchor> | undefined;

function socketPairKey(parentSlotId: ID, childSlotId: ID): string {
  return `${parentSlotId}::${childSlotId}`;
}

function normalizeSocketAnchor(
  anchor: SocketAnchorInput,
  fallback: CharacterSocketAnchor = { x: 0, y: 0 },
): CharacterSocketAnchor {
  const rotation =
    anchor?.rotation !== undefined && Number.isFinite(anchor.rotation)
      ? { rotation: Math.round(anchor.rotation * 10) / 10 }
      : fallback.rotation !== undefined && Number.isFinite(fallback.rotation)
        ? { rotation: Math.round(fallback.rotation * 10) / 10 }
        : {};
  return {
    x: Math.round(finiteNumber(anchor?.x, fallback.x)),
    y: Math.round(finiteNumber(anchor?.y, fallback.y)),
    ...rotation,
  };
}

function normalizeVariantAnchors(
  anchors: CharacterSlotSocket["variantAnchors"] | undefined,
): CharacterSlotSocket["variantAnchors"] {
  const out: CharacterSlotSocket["variantAnchors"] = {};
  for (const [key, anchor] of Object.entries(anchors ?? {})) {
    const trimmed = key.trim();
    if (!trimmed) continue;
    if (!Number.isFinite(anchor?.x) || !Number.isFinite(anchor?.y)) continue;
    out[trimmed] = normalizeSocketAnchor(anchor);
  }
  return out;
}

function socketLabelForSlots(parent: SlotLike | undefined, child: SlotLike): string {
  const childSide = child.parts.find((part) => part.side === "left" || part.side === "right")?.side;
  if (parent?.role === "body" && (child.role === "arm" || child.role === "upperArm"))
    return childSide === "left"
      ? "Left shoulder"
      : childSide === "right"
        ? "Right shoulder"
        : "Shoulder";
  if (parent?.role === "body" && (child.role === "leg" || child.role === "upperLeg"))
    return childSide === "left" ? "Left hip" : childSide === "right" ? "Right hip" : "Hip";
  if ((parent?.role === "arm" || parent?.role === "upperArm") && child.role === "lowerArm")
    return "Elbow";
  if (
    (parent?.role === "arm" || parent?.role === "lowerArm" || parent?.role === "upperArm") &&
    child.role === "hand"
  )
    return "Wrist";
  if ((parent?.role === "leg" || parent?.role === "upperLeg") && child.role === "lowerLeg")
    return "Knee";
  if (
    (parent?.role === "leg" || parent?.role === "lowerLeg" || parent?.role === "upperLeg") &&
    child.role === "foot"
  )
    return "Ankle";
  if (
    parent?.role === "head" &&
    ["eye", "iris", "eyebrow", "nose", "mouth", "hair"].includes(child.role)
  )
    return `${child.name ?? roleLabel(child.role)} socket`;
  return `${child.name ?? roleLabel(child.role)} socket`;
}

function socketForPair(
  sockets: CharacterSlotSocket[] | undefined,
  parentSlotId: ID,
  childSlotId: ID,
): CharacterSlotSocket | undefined {
  return (sockets ?? []).find(
    (entry) => entry.slotId === parentSlotId && entry.childSlotId === childSlotId,
  );
}

function socketForChild(
  sockets: CharacterSlotSocket[] | undefined,
  childSlotId: ID,
): CharacterSlotSocket | undefined {
  return (sockets ?? []).find((entry) => entry.childSlotId === childSlotId);
}

export function normalizeCharacterRig(character: CharacterPreset): CharacterRig {
  const inferred = buildDefaultRig(character);
  const source = character.rig;
  if (!source) return inferred;

  const angles = normalizeRigAngles(character, source, inferred);
  const activeAngle = isCharacterAngle(source.activeAngle)
    ? source.activeAngle
    : inferred.activeAngle;
  const active =
    activeAngleRig(angles, activeAngle) ??
    firstAngleRig(angles) ??
    activeAngleRig(inferred.angles, inferred.activeAngle);
  const rig: CharacterRig = {
    version: 2,
    pinSchemaInitialized: source.pinSchemaInitialized,
    pinSchemaRevision: source.pinSchemaRevision,
    activeAngle: active?.angleId ?? inferred.activeAngle,
    angles,
    bones: active?.bones ?? inferred.bones,
    slotBindings: active?.slotBindings ?? inferred.slotBindings,
    drawOrder: active?.drawOrder ?? inferred.drawOrder,
    slotRelations: active?.slotRelations ?? inferred.slotRelations,
    hostConstraints: active?.hostConstraints ?? inferred.hostConstraints,
    reaches: active?.reaches ?? inferred.reaches,
    ikConstraints: active?.ikConstraints ?? inferred.ikConstraints,
    sockets: active?.sockets ?? inferred.sockets,
    mesh: source.mesh?.version === 1 ? source.mesh : undefined,
  };
  const validation = validateCharacterRig(rig);
  return validation.ok ? rig : inferred;
}

export function buildDefaultRig(
  character: CharacterPreset,
  activeAngle: CharacterAngle = availableCharacterAngles(character)[0] ?? "front",
): CharacterRig {
  const angles = Object.fromEntries(
    availableCharacterAngles(character).map((angle) => [
      angle,
      buildDefaultAngleRig(character, angle),
    ]),
  ) as Partial<Record<CharacterAngle, CharacterAngleRig>>;
  const active =
    activeAngleRig(angles, activeAngle) ?? activeAngleRig(angles, "front") ?? firstAngleRig(angles);
  return {
    version: 2,
    activeAngle: active?.angleId ?? "front",
    angles,
    bones: active?.bones ?? [],
    slotBindings: active?.slotBindings ?? [],
    drawOrder: active?.drawOrder ?? [],
    slotRelations: active?.slotRelations ?? [],
    hostConstraints: active?.hostConstraints ?? [],
    reaches: active?.reaches ?? [],
    ikConstraints: active?.ikConstraints,
    sockets: active?.sockets,
  };
}

/**
 * Recompute bones/bindings from the current parts (like {@link buildDefaultRig}) while carrying
 * the user-authored movement/rotation reaches and host ("drag boundary") choices forward, per
 * angle. A plain `buildDefaultRig` drops reaches and re-infers host constraints, so a from-scratch
 * rebuild after a structural edit (set pivot, set area, move a layer) would otherwise silently
 * wipe a slot's rotation-reach clipping and revert its drag boundary. Carried records are filtered
 * to slots/bones that still exist so the result stays valid; freshly inferred host defaults are
 * kept for any slot the user never configured.
 */
export function rebuildRigPreservingConstraints(character: CharacterPreset): CharacterRig {
  const prev = character.rig;
  const prevAngle = prev && isCharacterAngle(prev.activeAngle) ? prev.activeAngle : undefined;
  const rebuilt = buildDefaultRig(character, prevAngle);
  if (!prev) return rebuilt;

  // Per-angle authored records — with a fallback to the top-level mirror for legacy saves that
  // have no per-angle map.
  const authoredReaches = (angleId: CharacterAngle): CharacterReach[] => {
    const angleRig = prev.angles?.[angleId];
    if (angleRig) return angleRig.reaches ?? [];
    return angleId === prev.activeAngle ? (prev.reaches ?? []) : [];
  };
  const authoredHosts = (angleId: CharacterAngle): CharacterHostConstraint[] => {
    const angleRig = prev.angles?.[angleId];
    if (angleRig) return angleRig.hostConstraints ?? [];
    return angleId === prev.activeAngle ? (prev.hostConstraints ?? []) : [];
  };

  const carry = (fresh: CharacterAngleRig, angleId: CharacterAngle): CharacterAngleRig => {
    const slotSet = new Set(fresh.slotBindings.map((binding) => binding.slotId));
    const boneSet = new Set(fresh.bones.map((bone) => bone.id));
    const reaches = authoredReaches(angleId).filter((reach) => slotSet.has(reach.slotId));
    const authored = authoredHosts(angleId)
      .filter((c) => slotSet.has(c.slotId) && (!c.hostSlotId || slotSet.has(c.hostSlotId)))
      .map((c) =>
        c.hostBoneId && !boneSet.has(c.hostBoneId) ? { ...c, hostBoneId: undefined } : c,
      );
    // Keep inferred host defaults for untouched slots; the user's explicit choice wins per slot.
    const overridden = new Set(authored.map((c) => c.slotId));
    const hostConstraints = [
      ...fresh.hostConstraints.filter((c) => !overridden.has(c.slotId)),
      ...authored,
    ];
    return {
      ...fresh,
      reaches: reaches.length > 0 ? reaches : fresh.reaches,
      hostConstraints,
      ikConstraints: fresh.ikConstraints,
    };
  };

  const angles = rebuilt.angles
    ? (Object.fromEntries(
        Object.entries(rebuilt.angles).map(([angleId, angleRig]) => [
          angleId,
          angleRig && isCharacterAngle(angleId) ? carry(angleRig, angleId) : angleRig,
        ]),
      ) as Partial<Record<CharacterAngle, CharacterAngleRig>>)
    : rebuilt.angles;

  const active = isCharacterAngle(rebuilt.activeAngle) ? angles?.[rebuilt.activeAngle] : undefined;
  return {
    ...rebuilt,
    angles,
    reaches: active?.reaches ?? rebuilt.reaches,
    hostConstraints: active?.hostConstraints ?? rebuilt.hostConstraints,
    ikConstraints: active?.ikConstraints ?? rebuilt.ikConstraints,
    sockets: active?.sockets ?? rebuilt.sockets,
  };
}

function buildDefaultAngleRig(
  character: CharacterPreset,
  angle: CharacterAngle,
): CharacterAngleRig {
  const legacySocketData =
    !!character.rig && (character.rig as { version?: number } | undefined)?.version !== 2;
  const slots = listCharacterSlots(character, { angle, includeEmpty: false });
  const reps = new Map(slots.map((slot) => [slot.id, representativePart(slot)] as const));
  const slotIdByRoleSide = new Map<string, string>();
  const sideBySlotId = new Map<string, CharacterPart["side"] | undefined>();
  for (const slot of slots) {
    const part = reps.get(slot.id);
    const side = part ? inferSideForSlot(slot, part) : undefined;
    sideBySlotId.set(slot.id, side);
    slotIdByRoleSide.set(roleSideKey(slot.role, side), slot.id);
    if (!slotIdByRoleSide.has(roleSideKey(slot.role))) {
      slotIdByRoleSide.set(roleSideKey(slot.role), slot.id);
    }
  }
  const slotIdSet = new Set(slots.map((slot) => slot.id));
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const sourceAngleRig =
    character.rig?.angles?.[angle] ??
    (angle === character.rig?.activeAngle && character.rig
      ? rigViewToAngleRig(character.rig, angle)
      : undefined);
  const authoredRelations = (sourceAngleRig?.slotRelations ?? []).filter((relation) => {
    const parentSlotId = parentSlotIdForRelationRef(
      relation,
      slotIdByRoleSide,
      sourceAngleRig?.slotBindings,
    );
    return (
      !parentSlotId ||
      !hasCrossSideAttachmentConflict(relation.childSlotId, parentSlotId, slotById, sideBySlotId)
    );
  });
  const storedSockets = normalizeSockets(
    legacySocketData ? (sourceAngleRig?.sockets ?? []) : [],
    slotIdSet,
  ).filter(
    (socket) =>
      !hasCrossSideAttachmentConflict(socket.childSlotId, socket.slotId, slotById, sideBySlotId),
  );
  const authoredParentByChild = new Map<string, string>();
  for (const relation of authoredRelations) {
    const parentSlotId = parentSlotIdForRelationRef(
      relation,
      slotIdByRoleSide,
      sourceAngleRig?.slotBindings,
    );
    if (parentSlotId && parentSlotId !== relation.childSlotId && slotIdSet.has(parentSlotId)) {
      authoredParentByChild.set(relation.childSlotId, parentSlotId);
    }
  }
  for (const socket of storedSockets) {
    if (!authoredParentByChild.has(socket.childSlotId)) {
      authoredParentByChild.set(socket.childSlotId, socket.slotId);
    }
  }

  const root: CharacterBone = {
    id: ROOT_BONE_ID,
    semanticBoneId: ROOT_BONE_ID,
    name: "Root",
    role: "root",
    x: 0,
    y: 0,
    rotation: 0,
    depth: 0,
  };
  const boneBySlot = new Map<string, CharacterBone>();
  const parentSlotIdBySlot = new Map<string, string>();
  const sockets: CharacterSlotSocket[] = [];
  for (const slot of slots) {
    const part = reps.get(slot.id);
    if (!part) continue;
    const side = sideBySlotId.get(slot.id);
    const inferredParentSlotId = parentSlotIdFor(slot, slotIdByRoleSide, side);
    const authoredParentSlotId = authoredParentByChild.get(slot.id);
    const parentSlotId =
      authoredParentSlotId && authoredParentSlotId !== slot.id
        ? authoredParentSlotId
        : inferredParentSlotId === slot.id
          ? undefined
          : inferredParentSlotId;
    if (parentSlotId) parentSlotIdBySlot.set(slot.id, parentSlotId);
    const parentBoneId = parentSlotId ? `bone:${parentSlotId}` : ROOT_BONE_ID;
    const pivot = pivotForPart(part);
    const parentSlot = parentSlotId ? slotById.get(parentSlotId) : undefined;
    const parentPart = parentSlotId ? reps.get(parentSlotId) : undefined;
    const parentPivot = parentPart ? pivotForPart(parentPart) : { x: 0, y: 0 };
    const existingSocket = parentSlotId
      ? socketForPair(storedSockets, parentSlotId, slot.id)
      : undefined;
    const socketAnchor = parentSlotId
      ? normalizeSocketAnchor(existingSocket, { x: pivot.x, y: pivot.y })
      : { x: Math.round(pivot.x), y: Math.round(pivot.y) };
    if (parentSlotId && legacySocketData) {
      sockets.push({
        id: existingSocket?.id || `socket:${parentSlotId}:${slot.id}`,
        slotId: parentSlotId,
        childSlotId: slot.id,
        name: existingSocket?.name ?? socketLabelForSlots(parentSlot, slot),
        x: socketAnchor.x,
        y: socketAnchor.y,
        ...(socketAnchor.rotation !== undefined ? { rotation: socketAnchor.rotation } : {}),
        variantAnchors: normalizeVariantAnchors(existingSocket?.variantAnchors),
      });
    }
    const pinName = parentSlotId ? pinNameForChildSlot(slot) : undefined;
    const authoredPin = pinName && parentPart?.pins ? parentPart.pins[pinName] : undefined;
    const pinRest =
      parentPart && authoredPin ? pinTransformInBoneSpace(parentPart, authoredPin) : undefined;
    const x = parentSlotId
      ? Math.round(pinRest?.x ?? socketAnchor.x - parentPivot.x)
      : Math.round(pivot.x);
    const y = parentSlotId
      ? Math.round(pinRest?.y ?? socketAnchor.y - parentPivot.y)
      : Math.round(pivot.y);
    const length = Math.round(Math.hypot(part.width, part.height) * 0.5);
    boneBySlot.set(slot.id, {
      id: `bone:${slot.id}`,
      semanticBoneId: `bone:${slot.id}`,
      name: slot.name ?? roleLabel(slot.role),
      role: slot.role,
      side,
      parentId: parentBoneId,
      x,
      y,
      rotation: parentSlotId ? (pinRest?.rotation ?? socketAnchor.rotation ?? 0) : 0,
      ...(parentSlotId && pinName
        ? {
            restSource: {
              slotId: parentSlotId,
              pinName,
            },
          }
        : {}),
      length,
      depth: part.depth,
    });
  }

  const controlBones = addDefaultControlBones({ root, bones: boneBySlot, slots });
  const allBones = [root, ...Array.from(boneBySlot.values()), ...controlBones.bones];

  const bindings: CharacterSlotBinding[] = [];
  for (const slot of slots) {
    const part = reps.get(slot.id);
    const bone = boneBySlot.get(slot.id);
    if (!part || !bone) continue;
    const pivot = pivotForPart(part);
    bindings.push({
      slotId: slot.id,
      semanticSlotId: slot.id,
      boneId: bone.id,
      x: legacySocketData ? Math.round(part.x - pivot.x) : 0,
      y: legacySocketData ? Math.round(part.y - pivot.y) : 0,
      rotation: legacySocketData ? part.rotation : 0,
      scaleX: 1,
      scaleY: 1,
      depth: part.depth,
    });
  }

  const drawOrder = slots
    .slice()
    .sort(
      (a, b) =>
        Math.min(...a.parts.map((p) => p.zIndex)) - Math.min(...b.parts.map((p) => p.zIndex)),
    )
    .map((slot) => slot.id);
  const inferredSlotRelations = inferSlotRelations(slots, slotIdByRoleSide, sideBySlotId);
  const slotRelationsWithControls = inferredSlotRelations.map((relation) => {
    const child = slotById.get(relation.childSlotId);
    if (
      controlBones.pelvis &&
      child &&
      (child.role === "leg" || child.role === "upperLeg") &&
      relation.parentRef.type === "slot"
    ) {
      return { ...relation, parentRef: { type: "bone" as const, id: controlBones.pelvis.id } };
    }
    return relation;
  });
  const boneIds = new Set(allBones.map((bone) => bone.id));
  const slotRelations = normalizeSlotRelations(
    mergeSlotRelations(slotRelationsWithControls, authoredRelations),
    slotIdSet,
    boneIds,
  );
  const hostConstraints = inferHostConstraints(slots, slotIdByRoleSide, sideBySlotId);

  // Per-parent-variant child anchors: when the parent slot swaps to variant K (bent arm), the
  // child bone (hand) re-anchors to K's authored joint or to child art paired with K. Derived
  // data — recomputed on every build, never carried forward from saved rigs.
  const relationsByChild = new Map<string, CharacterSlotRelation[]>();
  for (const relation of slotRelations) {
    relationsByChild.set(relation.childSlotId, [
      ...(relationsByChild.get(relation.childSlotId) ?? []),
      relation,
    ]);
  }
  for (const slot of slots) {
    const bone = boneBySlot.get(slot.id);
    const parentSlotId = parentSlotIdBySlot.get(slot.id);
    const parentSlot = parentSlotId ? slotById.get(parentSlotId) : undefined;
    const parentPart = parentSlotId ? reps.get(parentSlotId) : undefined;
    if (!bone || !parentSlot || !parentPart) continue;
    const anchors = legacySocketData
      ? computeParentVariantAnchors({
          childSlot: slot,
          childBone: bone,
          parentSlot,
          parentPivot: pivotForPart(parentPart),
          socket: socketForPair(sockets, parentSlot.id, slot.id),
          relations: relationsByChild.get(slot.id) ?? [],
        })
      : undefined;
    if (anchors) bone.parentVariantAnchors = anchors;
  }

  return {
    angleId: angle,
    bones: allBones,
    slotBindings: bindings,
    drawOrder,
    slotRelations,
    hostConstraints,
    reaches: [],
    ikConstraints: controlBones.ikConstraints,
    sockets: legacySocketData ? sockets : undefined,
  };
}

function addDefaultControlBones(args: {
  root: CharacterBone;
  bones: Map<string, CharacterBone>;
  slots: SlotLike[];
}): { bones: CharacterBone[]; pelvis: CharacterBone; ikConstraints: CharacterIkConstraint[] } {
  const temporaryRig: CharacterRig = {
    version: 2,
    activeAngle: "front",
    bones: [args.root, ...Array.from(args.bones.values())],
    slotBindings: [],
    drawOrder: [],
    slotRelations: [],
    hostConstraints: [],
    reaches: [],
  };
  const previousWorld = computeBoneWorldTransforms(temporaryRig);
  const bodyBone = args.slots
    .filter((slot) => slot.role === "body")
    .map((slot) => args.bones.get(slot.id))
    .find((bone): bone is CharacterBone => !!bone);
  const hipBones = args.slots
    .filter((slot) => slot.role === "leg" || slot.role === "upperLeg")
    .map((slot) => args.bones.get(slot.id))
    .filter((bone): bone is CharacterBone => !!bone)
    .map((bone) => previousWorld.get(bone.id))
    .filter((bone): bone is NonNullable<typeof bone> => !!bone);
  const hipPoint = hipBones.length
    ? {
        x: hipBones.reduce((sum, bone) => sum + bone.x, 0) / hipBones.length,
        y: hipBones.reduce((sum, bone) => sum + bone.y, 0) / hipBones.length,
      }
    : bodyBone
      ? (previousWorld.get(bodyBone.id) ?? { x: bodyBone.x, y: bodyBone.y })
      : { x: 0, y: 0 };
  const pelvis: CharacterBone = {
    id: "bone:pelvis",
    semanticBoneId: "bone:pelvis",
    name: "Pelvis",
    role: "custom",
    controlKind: "pelvis",
    parentId: args.root.id,
    x: Math.round(hipPoint.x),
    y: Math.round(hipPoint.y),
    rotation: 0,
    length: Math.max(24, Math.round(Math.hypot(...hipSpan(hipBones)))),
    depth: 0,
  };
  const carriedByPelvis = new Set<string>([
    ...(bodyBone ? [bodyBone.id] : []),
    ...args.slots
      .filter((slot) => slot.role === "leg" || slot.role === "upperLeg")
      .map((slot) => args.bones.get(slot.id)?.id)
      .filter((id): id is string => !!id),
  ]);
  for (const [slotId, bone] of args.bones) {
    if (!carriedByPelvis.has(bone.id)) continue;
    const world = previousWorld.get(bone.id);
    if (!world) continue;
    args.bones.set(slotId, {
      ...bone,
      parentId: pelvis.id,
      restSource: undefined,
      parentVariantAnchors: undefined,
      x: Math.round(world.x - pelvis.x),
      y: Math.round(world.y - pelvis.y),
      rotation: Math.round((world.rotation - pelvis.rotation) * 10) / 10,
    });
  }

  const constraints: CharacterIkConstraint[] = [];
  const targetBones: CharacterBone[] = [];
  const sides: Array<CharacterPart["side"]> = ["left", "right"];
  for (const side of sides) {
    const upper = findBoneForRole(args.slots, args.bones, ["upperLeg", "leg"], side);
    const lower = findBoneForRole(args.slots, args.bones, ["lowerLeg"], side);
    const end = findBoneForRole(args.slots, args.bones, ["foot"], side);
    if (!upper || !lower || !end) continue;
    const world = computeBoneWorldTransforms({
      ...temporaryRig,
      bones: [args.root, pelvis, ...Array.from(args.bones.values())],
    });
    const endWorld = world.get(end.id);
    if (!endWorld) continue;
    const targetBone: CharacterBone = {
      id: `bone:ik-target:${side}-foot`,
      semanticBoneId: `bone:ik-target:${side}-foot`,
      name: `${side === "left" ? "Left" : "Right"} Foot target`,
      role: "custom",
      controlKind: "ikTarget",
      parentId: args.root.id,
      x: Math.round(endWorld.x),
      y: Math.round(endWorld.y),
      rotation: 0,
      depth: 0,
    };
    targetBones.push(targetBone);
    const upperWorld = world.get(upper.id);
    const lowerWorld = world.get(lower.id);
    const cross =
      upperWorld && lowerWorld
        ? (lowerWorld.x - upperWorld.x) * (endWorld.y - lowerWorld.y) -
          (lowerWorld.y - upperWorld.y) * (endWorld.x - lowerWorld.x)
        : 1;
    constraints.push({
      id: `ik:${side}-leg`,
      kind: "twoBone",
      targetBoneId: targetBone.id,
      parentBoneId: upper.id,
      childBoneId: lower.id,
      endBoneId: end.id,
      bendDirection: cross < 0 ? -1 : 1,
    });
  }
  return { bones: [pelvis, ...targetBones], pelvis, ikConstraints: constraints };
}

function hipSpan(hipBones: Array<{ x: number; y: number }>): [number, number] {
  if (hipBones.length < 2) return [32, 0];
  return [
    hipBones[hipBones.length - 1].x - hipBones[0].x,
    hipBones[hipBones.length - 1].y - hipBones[0].y,
  ];
}

function findBoneForRole(
  slots: SlotLike[],
  bones: Map<string, CharacterBone>,
  roles: PartRole[],
  side: CharacterPart["side"],
): CharacterBone | undefined {
  const slot = slots.find((candidate) => {
    if (!roles.includes(candidate.role)) return false;
    const part = representativePart(candidate);
    return !!part && inferSideForSlot(candidate, part) === side;
  });
  return slot ? bones.get(slot.id) : undefined;
}

const warnedAnchorFallbacks = new Set<string>();

/**
 * Resolve a child bone's local anchor per parent-slot variant key. Resolution order per key:
 * authored variant socket targeting the child slot, then child art paired to the key (a hand
 * drawn for the bent arm), then the representative fallback (no entry — bone keeps base x/y).
 * A relation that explicitly gates the child on a key with no anchor source gets a dev warning,
 * since the child would silently keep its rest anchor under that variant.
 */
function computeParentVariantAnchors(args: {
  childSlot: SlotLike;
  childBone: CharacterBone;
  parentSlot: SlotLike;
  parentPivot: { x: number; y: number };
  /** This angle's authored joint between parent and child, if any. */
  socket?: CharacterSlotSocket;
  relations: CharacterSlotRelation[];
}): Record<string, { x: number; y: number; source?: "socket" | "pairedArt" }> | undefined {
  const socketKeys = Object.keys(args.socket?.variantAnchors ?? {});
  const parentKeys = new Set<string>([
    ...args.parentSlot.parts.map((part) => variantKeyForPart(part)),
    ...socketKeys,
  ]);
  if (parentKeys.size <= 1 && socketKeys.length === 0) return undefined;

  // Warn only for relations that physically re-anchor (attachments, held props). Contained
  // features (iris in an eye) gate visibility on a parent variant without needing an anchor.
  const gatedKeys = new Set<string>();
  for (const relation of args.relations) {
    if (relation.relationType === "containedFeature") continue;
    for (const key of relation.activeWhenParentVariant?.keys ?? []) gatedKeys.add(key);
  }

  const out: Record<
    string,
    { x: number; y: number; rotation?: number; source?: "socket" | "pairedArt" }
  > = {};
  for (const key of parentKeys) {
    const authored = args.socket?.variantAnchors[key];
    // Rotation comes from authored joints only: paired child art expresses its angle in its own
    // part rotation (rotating the bone too would double-apply it on that art).
    const anchor:
      | { x: number; y: number; rotation?: number; source?: "socket" | "pairedArt" }
      | undefined =
      authored && Number.isFinite(authored.x) && Number.isFinite(authored.y)
        ? {
            x: Math.round(authored.x - args.parentPivot.x),
            y: Math.round(authored.y - args.parentPivot.y),
            ...(Number.isFinite(authored.rotation)
              ? { rotation: Math.round((authored.rotation as number) * 10) / 10 }
              : {}),
            source: "socket",
          }
        : keyedChildAnchor(args.childSlot, key, args.parentPivot);
    if (!anchor) {
      if (gatedKeys.has(key)) {
        const message =
          `No authored socket or keyed child part for ${args.childSlot.id} under ` +
          `${args.parentSlot.id} variant "${key}" — using representative fallback anchor.`;
        if (!warnedAnchorFallbacks.has(message)) {
          warnedAnchorFallbacks.add(message);
          console.warn(message);
        }
      }
      continue;
    }
    const rotationDiffers =
      anchor.rotation !== undefined && anchor.rotation !== args.childBone.rotation;
    if (anchor.x === args.childBone.x && anchor.y === args.childBone.y && !rotationDiffers)
      continue;
    out[key] = anchor;
  }
  return Object.keys(out).length ? out : undefined;
}

function keyedChildAnchor(
  childSlot: SlotLike,
  variantKey: string,
  parentPivot: { x: number; y: number },
): { x: number; y: number; source: "pairedArt" } | undefined {
  const part = anchorPartForVariant(childSlot.parts, variantKey);
  if (!part) return undefined;
  const pivot = pivotForPart(part);
  return {
    x: Math.round(pivot.x - parentPivot.x),
    y: Math.round(pivot.y - parentPivot.y),
    source: "pairedArt",
  };
}

/**
 * The rest pivot of a slot's representative part — the reference point variant sockets are
 * authored against (`anchor = socket − parentPivot` in {@link buildDefaultAngleRig}). Exposed so
 * editor tools can convert a desired canvas anchor point into socket coordinates.
 */
export function slotRestPivot(
  character: CharacterPreset,
  slotId: string,
  angle?: CharacterAngle,
): { x: number; y: number } | undefined {
  const resolvedAngle = angle ?? normalizeCharacterRig(character).activeAngle;
  const slots = listCharacterSlots(character, { angle: resolvedAngle, includeEmpty: false });
  const slot = slots.find((candidate) => candidate.id === slotId);
  const part = slot ? representativePart(slot) : undefined;
  return part ? pivotForPart(part) : undefined;
}

export function availableCharacterAngles(character: CharacterPreset): CharacterAngle[] {
  const explicitAngles = (character.angles ?? []).filter(isCharacterAngle);
  if (explicitAngles.length > 0) {
    return CHARACTER_ANGLES.filter((angle) => explicitAngles.includes(angle));
  }

  const seen = new Set<CharacterAngle>();
  const add = (value: unknown) => {
    if (isCharacterAngle(value)) seen.add(value);
  };
  for (const angle of Object.keys(character.rig?.angles ?? {})) add(angle);
  add(character.rig?.activeAngle);
  for (const part of character.parts) {
    add(part.angleId);
    for (const angle of part.angleIds ?? []) add(angle);
  }
  if (seen.size === 0) seen.add("front");
  return CHARACTER_ANGLES.filter((angle) => seen.has(angle));
}

function normalizeRigAngles(
  character: CharacterPreset,
  source: CharacterRig,
  inferred: CharacterRig,
): Partial<Record<CharacterAngle, CharacterAngleRig>> {
  const out: Partial<Record<CharacterAngle, CharacterAngleRig>> = {};
  const angles = availableCharacterAngles({ ...character, rig: source });
  for (const angle of angles) {
    const inferredAngle =
      activeAngleRig(inferred.angles, angle) ?? rigViewToAngleRig(inferred, angle);
    const sourceAngle = source.angles?.[angle] ?? legacyRigViewToAngleRig(source, angle);
    out[angle] = normalizeAngleRig(inferredAngle, sourceAngle);
  }
  return out;
}

function normalizeAngleRig(
  inferred: CharacterAngleRig,
  source: Partial<CharacterAngleRig> | undefined,
): CharacterAngleRig {
  if (!source) return inferred;
  const bonesById = new Map(inferred.bones.map((bone) => [bone.id, bone]));
  for (const bone of source.bones ?? []) {
    const inferredBone = bonesById.get(bone.id);
    if (!inferredBone) {
      bonesById.set(bone.id, {
        ...bone,
        x: finiteNumber(bone.x, 0),
        y: finiteNumber(bone.y, 0),
        rotation: finiteNumber(bone.rotation, 0),
        parentVariantAnchors: undefined,
      });
      continue;
    }
    const socketDriven = !!inferredBone.restSource && inferredBone.parentId !== ROOT_BONE_ID;
    bonesById.set(bone.id, {
      ...inferredBone,
      name: bone.name || inferredBone.name,
      semanticBoneId: bone.semanticBoneId || inferredBone.semanticBoneId,
      role: bone.role ?? inferredBone.role,
      side: bone.side ?? inferredBone.side,
      // Attached bones resolve their rest x/y from sockets. Top-level bones may still carry
      // manually authored rig-only offsets until root sockets/controls exist.
      x: socketDriven ? inferredBone.x : finiteNumber(bone.x, inferredBone.x),
      y: socketDriven ? inferredBone.y : finiteNumber(bone.y, inferredBone.y),
      parentId: inferredBone.parentId,
      restSource: bone.restSource ?? inferredBone.restSource,
      rotation: finiteNumber(bone.rotation, inferredBone.rotation),
      length:
        bone.length !== undefined
          ? positiveNumber(bone.length, inferredBone.length ?? 0)
          : inferredBone.length,
      depth: finiteNumber(bone.depth, inferredBone.depth ?? 0),
      // Derived from the current parts/variant sockets; a saved rig may carry stale anchors.
      parentVariantAnchors: inferredBone.parentVariantAnchors,
    });
  }
  if (!bonesById.has(ROOT_BONE_ID)) bonesById.set(ROOT_BONE_ID, inferred.bones[0]);

  const bindingsBySlot = new Map(inferred.slotBindings.map((binding) => [binding.slotId, binding]));
  for (const binding of source.slotBindings ?? []) {
    bindingsBySlot.set(binding.slotId, {
      ...binding,
      boneId: bonesById.has(binding.boneId) ? binding.boneId : ROOT_BONE_ID,
      x: finiteNumber(binding.x, 0),
      y: finiteNumber(binding.y, 0),
      rotation: finiteNumber(binding.rotation, 0),
      scaleX: positiveNumber(binding.scaleX, 1),
      scaleY: positiveNumber(binding.scaleY, 1),
      depth: finiteNumber(binding.depth, 0),
      visible: binding.visible,
      partId: binding.partId,
    });
  }

  const bindingSlots = new Set(bindingsBySlot.keys());
  const boneIds = new Set(bonesById.keys());
  const authoredRelations = (source.slotRelations ?? []).filter(
    (relation) => !angleRelationHasCrossSideConflict(relation, inferred),
  );
  return {
    angleId: isCharacterAngle(source.angleId) ? source.angleId : inferred.angleId,
    bones: Array.from(bonesById.values()).filter((bone): bone is CharacterBone => !!bone),
    slotBindings: Array.from(bindingsBySlot.values()),
    drawOrder: normalizeDrawOrder(
      source.drawOrder?.length ? source.drawOrder : inferred.drawOrder,
      Array.from(bindingSlots),
    ),
    slotRelations: normalizeSlotRelations(
      mergeSlotRelations(inferred.slotRelations, authoredRelations),
      bindingSlots,
      boneIds,
    ),
    hostConstraints: normalizeHostConstraints(
      source.hostConstraints ?? inferred.hostConstraints,
      bindingSlots,
      boneIds,
    ),
    reaches: normalizeReaches(source.reaches ?? inferred.reaches, bindingSlots),
    ikConstraints: normalizeIkConstraints(
      source.ikConstraints ?? inferred.ikConstraints ?? [],
      boneIds,
    ),
    sockets:
      (source as { sockets?: CharacterSlotSocket[] }).sockets !== undefined
        ? normalizeSockets(source.sockets ?? [], bindingSlots)
        : undefined,
  };
}

function angleRelationHasCrossSideConflict(
  relation: CharacterSlotRelation,
  angleRig: CharacterAngleRig,
): boolean {
  const parentRef = relation.parentRef;
  const boneById = new Map(angleRig.bones.map((bone) => [bone.id, bone]));
  const bindingBySlot = new Map(angleRig.slotBindings.map((binding) => [binding.slotId, binding]));
  const childBone = boneById.get(bindingBySlot.get(relation.childSlotId)?.boneId ?? "");
  let parentBone: CharacterBone | undefined;
  if (parentRef.type === "slot" || parentRef.type === "semanticSlot") {
    parentBone = boneById.get(bindingBySlot.get(parentRef.id)?.boneId ?? "");
  } else if (parentRef.type === "bone") {
    parentBone = boneById.get(parentRef.id);
  } else if (parentRef.type === "role") {
    parentBone = angleRig.bones.find(
      (bone) => bone.role === parentRef.role && (!parentRef.side || bone.side === parentRef.side),
    );
  }
  const childSide = childBone?.side;
  const parentSide = parentBone?.side;
  return (
    (childSide === "left" || childSide === "right") &&
    (parentSide === "left" || parentSide === "right") &&
    childSide !== parentSide
  );
}

function activeAngleRig(
  angles: Partial<Record<CharacterAngle, CharacterAngleRig>> | undefined,
  angle: CharacterAngle,
): CharacterAngleRig | undefined {
  return angles?.[angle];
}

function angleRigView(
  rig: CharacterRig,
  angle: CharacterAngle = rig.activeAngle,
): CharacterAngleRig {
  if (angle === rig.activeAngle) return legacyRigViewToAngleRig(rig, angle);
  return activeAngleRig(rig.angles, angle) ?? legacyRigViewToAngleRig(rig, angle);
}

/** Resolved angle view for editor/runtime consumers. Stored mirrors remain private to this module. */
export function resolveCharacterAngleRig(
  rig: CharacterRig,
  angle: CharacterAngle = rig.activeAngle,
): CharacterAngleRig {
  return angleRigView(rig, angle);
}

function firstAngleRig(
  angles: Partial<Record<CharacterAngle, CharacterAngleRig>> | undefined,
): CharacterAngleRig | undefined {
  return Object.values(angles ?? {})[0];
}

function rigViewToAngleRig(rig: CharacterRig, angle: CharacterAngle): CharacterAngleRig {
  return {
    angleId: angle,
    bones: rig.bones ?? [],
    slotBindings: rig.slotBindings ?? [],
    drawOrder: rig.drawOrder ?? [],
    slotRelations: rig.slotRelations ?? [],
    hostConstraints: rig.hostConstraints ?? [],
    reaches: rig.reaches ?? [],
    ikConstraints: rig.ikConstraints ?? [],
    sockets: rig.sockets ?? [],
  };
}

function legacyRigViewToAngleRig(
  rig: Partial<CharacterRig>,
  angle: CharacterAngle,
): CharacterAngleRig {
  return {
    angleId: angle,
    bones: (rig.bones ?? []).map((bone) => {
      const override = bone.angleOverrides?.[angle];
      return override
        ? {
            ...bone,
            x: override.x ?? bone.x,
            y: override.y ?? bone.y,
            rotation: override.rotation ?? bone.rotation,
            depth: override.depth ?? bone.depth,
          }
        : bone;
    }),
    slotBindings: (rig.slotBindings ?? []).map((binding) => {
      const override = binding.angleOverrides?.[angle];
      return override
        ? {
            ...binding,
            boneId: override.boneId ?? binding.boneId,
            x: override.x ?? binding.x,
            y: override.y ?? binding.y,
            rotation: override.rotation ?? binding.rotation,
            scaleX: override.scaleX ?? binding.scaleX,
            scaleY: override.scaleY ?? binding.scaleY,
            depth: override.depth ?? binding.depth,
            visible: override.visible ?? binding.visible,
            partId: override.partId ?? binding.partId,
          }
        : binding;
    }),
    drawOrder: rig.drawOrder ?? [],
    slotRelations: rig.slotRelations ?? [],
    hostConstraints: rig.hostConstraints ?? [],
    reaches: rig.reaches ?? [],
    ikConstraints: rig.ikConstraints ?? [],
    sockets: rig.sockets ?? [],
  };
}

function withUpdatedAngleRig(
  rig: CharacterRig,
  angle: CharacterAngle,
  update: (angleRig: CharacterAngleRig) => CharacterAngleRig,
): CharacterRig {
  const angles: Partial<Record<CharacterAngle, CharacterAngleRig>> = {
    ...(rig.angles ?? {}),
  };
  const sourceAngle = angleRigView(rig, angle);
  const nextAngle = update(sourceAngle);
  angles[angle] = nextAngle;
  const active = angle === rig.activeAngle ? nextAngle : activeAngleRig(angles, rig.activeAngle);
  return {
    ...rig,
    angles,
    ...(active
      ? {
          bones: active.bones,
          slotBindings: active.slotBindings,
          drawOrder: active.drawOrder,
          slotRelations: active.slotRelations,
          hostConstraints: active.hostConstraints,
          reaches: active.reaches,
          ikConstraints: active.ikConstraints,
          sockets: active.sockets,
        }
      : {}),
  };
}

function isCharacterAngle(value: unknown): value is CharacterAngle {
  return typeof value === "string" && (CHARACTER_ANGLES as string[]).includes(value);
}

export function validateCharacterRig(rig: CharacterRig): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (rig.version !== 2) errors.push("Rig version must be 2.");
  const boneIds = new Set<string>();
  for (const bone of rig.bones) {
    if (!bone.id) errors.push("Bone is missing id.");
    if (boneIds.has(bone.id)) errors.push(`Duplicate bone id "${bone.id}".`);
    boneIds.add(bone.id);
  }
  for (const bone of rig.bones) {
    if (bone.parentId && !boneIds.has(bone.parentId)) {
      errors.push(`Bone "${bone.id}" references missing parent "${bone.parentId}".`);
    }
  }
  const bindingSlots = new Set<string>();
  for (const binding of rig.slotBindings) {
    if (!boneIds.has(binding.boneId)) {
      errors.push(`Slot "${binding.slotId}" references missing bone "${binding.boneId}".`);
    }
    if (bindingSlots.has(binding.slotId))
      errors.push(`Duplicate binding for slot "${binding.slotId}".`);
    bindingSlots.add(binding.slotId);
  }
  for (const reach of rig.reaches) {
    if (!bindingSlots.has(reach.slotId)) {
      errors.push(`Reach "${reach.id}" references missing slot "${reach.slotId}".`);
    }
  }
  validateSlotRelations(rig.slotRelations ?? [], bindingSlots, boneIds, "Rig", errors);
  for (const constraint of rig.hostConstraints ?? []) {
    if (!bindingSlots.has(constraint.slotId)) {
      errors.push(
        `Host constraint "${constraint.id}" references missing slot "${constraint.slotId}".`,
      );
    }
    if (constraint.hostSlotId && !bindingSlots.has(constraint.hostSlotId)) {
      errors.push(
        `Host constraint "${constraint.id}" references missing host slot "${constraint.hostSlotId}".`,
      );
    }
    if (constraint.hostBoneId && !boneIds.has(constraint.hostBoneId)) {
      errors.push(
        `Host constraint "${constraint.id}" references missing host bone "${constraint.hostBoneId}".`,
      );
    }
  }
  validateIkConstraints(rig.ikConstraints ?? [], boneIds, "Rig", errors);
  for (const bone of rig.bones) {
    const seen = new Set<string>();
    let current: CharacterBone | undefined = bone;
    while (current?.parentId) {
      if (seen.has(current.id)) {
        errors.push(`Bone "${bone.id}" is part of a parent cycle.`);
        break;
      }
      seen.add(current.id);
      current = rig.bones.find((candidate) => candidate.id === current?.parentId);
    }
  }
  for (const [angle, angleRig] of Object.entries(rig.angles ?? {})) {
    if (!isCharacterAngle(angle)) {
      errors.push(`Unknown angle "${angle}".`);
      continue;
    }
    if (!angleRig) continue;
    validateAngleRigGraph(angleRig, `Angle "${angle}"`, errors);
  }
  return { ok: errors.length === 0, errors };
}

function validateAngleRigGraph(angleRig: CharacterAngleRig, label: string, errors: string[]): void {
  const boneIds = new Set<string>();
  for (const bone of angleRig.bones) {
    if (!bone.id) errors.push(`${label}: bone is missing id.`);
    if (boneIds.has(bone.id)) errors.push(`${label}: duplicate bone id "${bone.id}".`);
    boneIds.add(bone.id);
  }
  for (const bone of angleRig.bones) {
    if (bone.parentId && !boneIds.has(bone.parentId)) {
      errors.push(`${label}: bone "${bone.id}" references missing parent "${bone.parentId}".`);
    }
  }
  const bindingSlots = new Set<string>();
  for (const binding of angleRig.slotBindings) {
    if (!boneIds.has(binding.boneId)) {
      errors.push(
        `${label}: slot "${binding.slotId}" references missing bone "${binding.boneId}".`,
      );
    }
    if (bindingSlots.has(binding.slotId)) {
      errors.push(`${label}: duplicate binding for slot "${binding.slotId}".`);
    }
    bindingSlots.add(binding.slotId);
  }
  for (const reach of angleRig.reaches) {
    if (!bindingSlots.has(reach.slotId)) {
      errors.push(`${label}: reach "${reach.id}" references missing slot "${reach.slotId}".`);
    }
  }
  validateSlotRelations(angleRig.slotRelations ?? [], bindingSlots, boneIds, label, errors);
  for (const constraint of angleRig.hostConstraints ?? []) {
    if (!bindingSlots.has(constraint.slotId)) {
      errors.push(
        `${label}: host constraint "${constraint.id}" references missing slot "${constraint.slotId}".`,
      );
    }
    if (constraint.hostSlotId && !bindingSlots.has(constraint.hostSlotId)) {
      errors.push(
        `${label}: host constraint "${constraint.id}" references missing host slot "${constraint.hostSlotId}".`,
      );
    }
    if (constraint.hostBoneId && !boneIds.has(constraint.hostBoneId)) {
      errors.push(
        `${label}: host constraint "${constraint.id}" references missing host bone "${constraint.hostBoneId}".`,
      );
    }
  }
  validateIkConstraints(angleRig.ikConstraints ?? [], boneIds, label, errors);
  for (const bone of angleRig.bones) {
    const seen = new Set<string>();
    let current: CharacterBone | undefined = bone;
    while (current?.parentId) {
      if (seen.has(current.id)) {
        errors.push(`${label}: bone "${bone.id}" is part of a parent cycle.`);
        break;
      }
      seen.add(current.id);
      current = angleRig.bones.find((candidate) => candidate.id === current?.parentId);
    }
  }
}

function validateIkConstraints(
  constraints: CharacterIkConstraint[],
  boneIds: Set<string>,
  label: string,
  errors: string[],
): void {
  for (const constraint of constraints) {
    for (const boneId of [
      constraint.targetBoneId,
      constraint.parentBoneId,
      constraint.childBoneId,
      constraint.endBoneId,
    ]) {
      if (boneId && !boneIds.has(boneId)) {
        errors.push(
          `${label}: IK constraint "${constraint.id}" references missing bone "${boneId}".`,
        );
      }
    }
    if (constraint.parentBoneId === constraint.childBoneId) {
      errors.push(`${label}: IK constraint "${constraint.id}" cannot use one bone twice.`);
    }
  }
}

function validateSlotRelations(
  relations: CharacterSlotRelation[],
  slotIds: Set<string>,
  boneIds: Set<string>,
  label: string,
  errors: string[],
): void {
  const parentByChild = new Map<string, string>();
  for (const relation of relations ?? []) {
    if (!relation.id) errors.push(`${label}: slot relation is missing id.`);
    if (!slotIds.has(relation.childSlotId)) {
      errors.push(
        `${label}: slot relation "${relation.id}" references missing child slot "${relation.childSlotId}".`,
      );
    }
    if (relation.parentRef.type === "slot" || relation.parentRef.type === "semanticSlot") {
      if (!slotIds.has(relation.parentRef.id)) {
        errors.push(
          `${label}: slot relation "${relation.id}" references missing parent slot "${relation.parentRef.id}".`,
        );
      } else if (relation.parentRef.id === relation.childSlotId) {
        errors.push(`${label}: slot relation "${relation.id}" cannot parent a slot to itself.`);
      } else {
        parentByChild.set(relation.childSlotId, relation.parentRef.id);
      }
    }
    if (relation.parentRef.type === "bone" && !boneIds.has(relation.parentRef.id)) {
      errors.push(
        `${label}: slot relation "${relation.id}" references missing parent bone "${relation.parentRef.id}".`,
      );
    }
    if (
      relation.clipMode === "clipToMaskSlot" &&
      relation.clipSlotId &&
      !slotIds.has(relation.clipSlotId)
    ) {
      errors.push(
        `${label}: slot relation "${relation.id}" references missing clip slot "${relation.clipSlotId}".`,
      );
    }
  }
  for (const childSlotId of parentByChild.keys()) {
    const seen = new Set<string>();
    let current: string | undefined = childSlotId;
    while (current) {
      if (seen.has(current)) {
        errors.push(`${label}: slot relation cycle includes "${childSlotId}".`);
        break;
      }
      seen.add(current);
      current = parentByChild.get(current);
    }
  }
}

export function computeBoneWorldTransforms(
  rig: CharacterRig,
  angle: CharacterAngle = rig.activeAngle,
): Map<string, BoneWorldTransform> {
  const angleRig = angleRigView(rig, angle);
  const bonesById = new Map(angleRig.bones.map((bone) => [bone.id, bone]));
  const out = new Map<string, BoneWorldTransform>();
  const resolving = new Set<string>();
  const resolve = (bone: CharacterBone): BoneWorldTransform => {
    const cached = out.get(bone.id);
    if (cached) return cached;
    resolving.add(bone.id);
    const local = {
      x: bone.x,
      y: bone.y,
      rotation: bone.rotation,
      depth: bone.depth ?? 0,
    };
    const parent = bone.parentId ? bonesById.get(bone.parentId) : undefined;
    if (!parent) {
      const world = { id: bone.id, parentId: bone.parentId, ...local };
      out.set(bone.id, world);
      resolving.delete(bone.id);
      return world;
    }
    if (resolving.has(parent.id)) {
      const world = { id: bone.id, parentId: bone.parentId, ...local };
      out.set(bone.id, world);
      resolving.delete(bone.id);
      return world;
    }
    const parentWorld = resolve(parent);
    const point = rotatePoint(local, parentWorld.rotation);
    const world = {
      id: bone.id,
      parentId: bone.parentId,
      x: parentWorld.x + point.x,
      y: parentWorld.y + point.y,
      rotation: parentWorld.rotation + local.rotation,
      depth: local.depth,
    };
    out.set(bone.id, world);
    resolving.delete(bone.id);
    return world;
  };
  for (const bone of angleRig.bones) resolve(bone);
  return out;
}

export function resolveSlotBinding(
  rig: CharacterRig,
  slotId: string,
  angle: CharacterAngle = rig.activeAngle,
): ResolvedSlotBinding | undefined {
  const angleRig = angleRigView(rig, angle);
  const binding = angleRig.slotBindings.find((candidate) => candidate.slotId === slotId);
  if (!binding) return undefined;
  return {
    ...binding,
    effectiveBoneId: binding.boneId,
    effectivePartId: binding.partId,
    effectiveDepth: binding.depth,
    visible: binding.visible ?? true,
  };
}

export function activeDepthForSlot(
  rig: CharacterRig,
  slotId: string,
  fallbackDepth = 0,
  angle: CharacterAngle = rig.activeAngle,
): number {
  return resolveSlotBinding(rig, slotId, angle)?.effectiveDepth ?? fallbackDepth;
}

export function slotDrawIndex(
  rig: CharacterRig,
  slotId: string,
  fallback = 0,
  angle: CharacterAngle = rig.activeAngle,
): number {
  const index = angleRigView(rig, angle).drawOrder.indexOf(slotId);
  return index >= 0 ? index : fallback;
}

export function moveSlotBinding(
  rig: CharacterRig,
  slotId: string,
  dx: number,
  dy: number,
  angle: CharacterAngle = rig.activeAngle,
): CharacterRig {
  return withUpdatedAngleRig(rig, angle, (angleRig) => ({
    ...angleRig,
    slotBindings: angleRig.slotBindings.map((binding) => {
      if (binding.slotId !== slotId) return binding;
      return { ...binding, x: binding.x + dx, y: binding.y + dy };
    }),
  }));
}

export function bindSlotPartToAngle(
  rig: CharacterRig,
  slotId: string,
  partId: string,
  angle: CharacterAngle = rig.activeAngle,
): CharacterRig {
  return withUpdatedAngleRig(rig, angle, (angleRig) => ({
    ...angleRig,
    slotBindings: angleRig.slotBindings.map((binding) => {
      if (binding.slotId !== slotId) return binding;
      return { ...binding, partId, visible: true };
    }),
  }));
}

export function setSlotDepth(
  rig: CharacterRig,
  slotId: string,
  depth: number,
  angle: CharacterAngle = rig.activeAngle,
): CharacterRig {
  return withUpdatedAngleRig(rig, angle, (angleRig) => ({
    ...angleRig,
    slotBindings: angleRig.slotBindings.map((binding) => {
      if (binding.slotId !== slotId) return binding;
      return { ...binding, depth };
    }),
  }));
}

export function setBoneDepth(
  rig: CharacterRig,
  boneId: string,
  depth: number,
  angle: CharacterAngle = rig.activeAngle,
): CharacterRig {
  return withUpdatedAngleRig(rig, angle, (angleRig) => ({
    ...angleRig,
    bones: angleRig.bones.map((bone) => {
      if (bone.id !== boneId) return bone;
      return { ...bone, depth };
    }),
  }));
}

/** Create or update a slot's reach record. */
function upsertSlotReach(
  rig: CharacterRig,
  slotId: ID,
  patch: Partial<Pick<CharacterReach, "reach" | "rotReach">>,
  angle: CharacterAngle = rig.activeAngle,
): CharacterRig {
  return withUpdatedAngleRig(rig, angle, (angleRig) => {
    const existing = angleRig.reaches.find((entry) => entry.slotId === slotId);
    const base: CharacterReach = existing ?? { id: `reach:${slotId}`, slotId };
    const next: CharacterReach = { ...base, ...patch };
    const others = angleRig.reaches.filter((entry) => entry.slotId !== slotId);
    return { ...angleRig, reaches: [...others, next] };
  });
}

/**
 * Set or clear a slot's traced movement reach (parent-frame offsets from its rest position).
 * Fewer than three points clears it.
 */
export function setSlotReach(
  rig: CharacterRig,
  slotId: ID,
  reach: { x: number; y: number }[] | undefined,
  angle: CharacterAngle = rig.activeAngle,
): CharacterRig {
  return upsertSlotReach(
    rig,
    slotId,
    {
      reach: reach && reach.length >= 3 ? reach : undefined,
    },
    angle,
  );
}

/** Set or clear a slot's rotation reach — how far it may twist from rest, in degrees. */
export function setSlotRotReach(
  rig: CharacterRig,
  slotId: ID,
  rotReach: { min: number; max: number } | undefined,
  angle: CharacterAngle = rig.activeAngle,
): CharacterRig {
  const next =
    rotReach && (rotReach.min !== 0 || rotReach.max !== 0)
      ? { min: Math.round(Math.min(0, rotReach.min)), max: Math.round(Math.max(0, rotReach.max)) }
      : undefined;
  return upsertSlotReach(rig, slotId, { rotReach: next }, angle);
}

/** Create, update, or clear a slot's host containment constraint. */
export function setSlotHostConstraint(
  rig: CharacterRig,
  slotId: ID,
  hostSlotId: ID | undefined,
  mode: CharacterHostConstraint["mode"] = "insideHostMask",
  reachPolicy: NonNullable<CharacterHostConstraint["reachPolicy"]> = "scaleToFit",
  angle: CharacterAngle = rig.activeAngle,
): CharacterRig {
  return withUpdatedAngleRig(rig, angle, (angleRig) => {
    const others = (angleRig.hostConstraints ?? []).filter((entry) => entry.slotId !== slotId);
    if (!hostSlotId) return { ...angleRig, hostConstraints: others };
    const existing = (angleRig.hostConstraints ?? []).find((entry) => entry.slotId === slotId);
    const hostBoneId = angleRig.slotBindings.find(
      (binding) => binding.slotId === hostSlotId,
    )?.boneId;
    return {
      ...angleRig,
      hostConstraints: [
        ...others,
        {
          id: existing?.id || `host:${slotId}`,
          slotId,
          hostSlotId,
          hostBoneId,
          mode,
          reachPolicy,
        },
      ],
    };
  });
}

export function parentSlotIdForSlot(
  rig: CharacterRig,
  childSlotId: ID,
  angle: CharacterAngle = rig.activeAngle,
): ID | undefined {
  const angleRig = angleRigView(rig, angle);
  const slotByBone = new Map(
    angleRig.slotBindings.map((binding) => [binding.boneId, binding.slotId]),
  );
  const boneBySlot = new Map(
    angleRig.slotBindings.map((binding) => [binding.slotId, binding.boneId]),
  );
  const boneId = boneBySlot.get(childSlotId);
  const bone = boneId ? angleRig.bones.find((candidate) => candidate.id === boneId) : undefined;
  const boneParentSlotId = bone?.parentId ? slotByBone.get(bone.parentId) : undefined;
  if (boneParentSlotId) return boneParentSlotId;
  if (rig.version !== 2) {
    const socketParent = socketForChild(angleRig.sockets, childSlotId)?.slotId;
    if (socketParent) return socketParent;
  }
  for (const relation of angleRig.slotRelations ?? []) {
    if (relation.childSlotId !== childSlotId) continue;
    const parentRef = relation.parentRef;
    if (parentRef.type === "slot" || parentRef.type === "semanticSlot") return parentRef.id;
    if (parentRef.type === "bone") return slotByBone.get(parentRef.id);
    if (parentRef.type === "role") {
      const parentBone = angleRig.bones.find(
        (bone) => bone.role === parentRef.role && (!parentRef.side || bone.side === parentRef.side),
      );
      if (parentBone) return slotByBone.get(parentBone.id);
    }
  }
  return undefined;
}

/**
 * Author (or move) the joint anchoring `childSlotId` under the parent slot's `variantKey`, for
 * one angle. Canvas px. Omitted rotation preserves any previously authored rotation for that key.
 */
export function upsertSlotSocketAnchor(
  rig: CharacterRig,
  args: {
    parentSlotId: ID;
    childSlotId: ID;
    variantKey: string;
    x: number;
    y: number;
    rotation?: number;
  },
  angle: CharacterAngle = rig.activeAngle,
): CharacterRig {
  const angleRig = angleRigView(rig, angle);
  const childBoneId = angleRig.slotBindings.find(
    (binding) => binding.slotId === args.childSlotId,
  )?.boneId;
  const childWorld = childBoneId
    ? computeBoneWorldTransforms(rig, angle).get(childBoneId)
    : undefined;
  return withUpdatedAngleRig(rig, angle, (angleRig) => {
    const sockets = angleRig.sockets ?? [];
    const existing = sockets.find(
      (entry) => entry.slotId === args.parentSlotId && entry.childSlotId === args.childSlotId,
    );
    const previous = existing?.variantAnchors[args.variantKey];
    const rotation = args.rotation ?? previous?.rotation;
    const anchor = {
      x: Math.round(args.x),
      y: Math.round(args.y),
      ...(rotation !== undefined && Number.isFinite(rotation)
        ? { rotation: Math.round(rotation * 10) / 10 }
        : {}),
    };
    const next: CharacterSlotSocket = existing
      ? { ...existing, variantAnchors: { ...existing.variantAnchors, [args.variantKey]: anchor } }
      : {
          id: `socket:${args.parentSlotId}:${args.childSlotId}`,
          slotId: args.parentSlotId,
          childSlotId: args.childSlotId,
          x: Math.round(childWorld?.x ?? args.x),
          y: Math.round(childWorld?.y ?? args.y),
          ...(childWorld?.rotation !== undefined ? { rotation: childWorld.rotation } : {}),
          variantAnchors: { [args.variantKey]: anchor },
        };
    return {
      ...angleRig,
      sockets: [
        ...sockets.filter(
          (entry) =>
            !(entry.slotId === args.parentSlotId && entry.childSlotId === args.childSlotId),
        ),
        next,
      ],
    };
  });
}

type Point = { x: number; y: number };

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const intersects =
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function nearestPointOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= Number.EPSILON) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** Clamp a point to lie within a polygon (nearest boundary point when outside). */
export function clampPointToPolygon(p: Point, poly: Point[]): Point {
  if (poly.length < 3 || pointInPolygon(p, poly)) return p;
  let best = poly[0];
  let bestDist = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const q = nearestPointOnSegment(p, poly[i], poly[(i + 1) % poly.length]);
    const dist = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = q;
    }
  }
  return best;
}

/**
 * "Tone down" a sampled motion delta so it respects the layer's authored reach: clamp its
 * drift (dx/dy) into the reach polygon and its rotation into the twist range. Returns the original
 * values when no reach is set, plus a `clamped` flag for warnings.
 */
export function clampMotionDeltaToReach(
  reach: CharacterReach | undefined,
  dx: number,
  dy: number,
  rotation: number,
): { dx: number; dy: number; rotation: number; clamped: boolean } {
  let outX = dx;
  let outY = dy;
  let outR = rotation;
  let clamped = false;
  if (reach?.reach && reach.reach.length >= 3) {
    const q = clampPointToPolygon({ x: dx, y: dy }, reach.reach);
    if (q.x !== dx || q.y !== dy) clamped = true;
    outX = q.x;
    outY = q.y;
  }
  if (reach?.rotReach) {
    const r = Math.max(reach.rotReach.min, Math.min(reach.rotReach.max, rotation));
    if (r !== rotation) clamped = true;
    outR = r;
  }
  return { dx: outX, dy: outY, rotation: outR, clamped };
}

export function slotIdsForBoneSubtree(
  rig: CharacterRig,
  boneId: string,
  angle: CharacterAngle = rig.activeAngle,
): Set<string> {
  const angleRig = angleRigView(rig, angle);
  const boneIds = new Set<string>([boneId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const bone of angleRig.bones) {
      if (boneIds.has(bone.id)) continue;
      if (bone.parentId && boneIds.has(bone.parentId)) {
        boneIds.add(bone.id);
        changed = true;
      }
    }
  }
  return new Set(
    angleRig.slotBindings
      .map((binding) => resolveSlotBinding(rig, binding.slotId, angle))
      .filter((binding): binding is ResolvedSlotBinding => !!binding)
      .filter((binding) => boneIds.has(binding.effectiveBoneId))
      .map((binding) => binding.slotId),
  );
}

export function moveSlotParts(
  character: CharacterPreset,
  slotId: string,
  dx: number,
  dy: number,
  angle?: CharacterAngle,
): CharacterPart[] {
  const scopedParts = angle ? partsAvailableForAngle(character.parts, angle) : character.parts;
  const slotParts = scopedParts.filter((part) => getPartSlotId(part) === slotId);
  if (slotParts.length === 0) return character.parts;
  const targetIds = new Set(slotParts.map((part) => part.id));
  return character.parts.map((part) => {
    if (!targetIds.has(part.id)) return part;
    const pivot = pivotForPart(part);
    return {
      ...part,
      x: part.x + dx,
      y: part.y + dy,
      pivot: { x: pivot.x + dx, y: pivot.y + dy },
    };
  });
}

export function movePartAndDescendants(
  parts: CharacterPart[],
  partId: string,
  dx: number,
  dy: number,
  angle?: CharacterAngle,
): CharacterPart[] {
  const scopedParts = angle ? partsAvailableForAngle(parts, angle) : parts;
  const targetIds = descendantPartIds(scopedParts, partId);
  targetIds.add(partId);
  return parts.map((part) => {
    if (!targetIds.has(part.id)) return part;
    const pivot = pivotForPart(part);
    return {
      ...part,
      x: part.x + dx,
      y: part.y + dy,
      pivot: { x: pivot.x + dx, y: pivot.y + dy },
    };
  });
}

export function representativePart(slot: SlotLike): CharacterPart | undefined {
  return (
    slot.parts.find(
      (part) =>
        part.visible &&
        (partMatchesVariant(part, "idle") ||
          partMatchesVariant(part, "rest") ||
          partMatchesVariant(part, "open")),
    ) ??
    slot.parts.find((part) => part.visible) ??
    slot.parts[0]
  );
}

function parentSlotIdFor(
  slot: SlotLike,
  slotIdByRoleSide: Map<string, string>,
  side?: CharacterPart["side"],
): string | undefined {
  const sameSide = side === "left" || side === "right" ? side : undefined;
  switch (slot.role) {
    case "head":
      return slotIdByRoleSide.get(roleSideKey("body"));
    case "eye":
    case "eyebrow":
    case "nose":
    case "mouth":
      return slotIdByRoleSide.get(roleSideKey("head"));
    case "iris":
      return (
        slotIdByRoleSide.get(roleSideKey("eye", sameSide)) ??
        slotIdByRoleSide.get(roleSideKey("eye")) ??
        slotIdByRoleSide.get(roleSideKey("head"))
      );
    case "hair":
      return slotIdByRoleSide.get(roleSideKey("head")) ?? slotIdByRoleSide.get(roleSideKey("body"));
    case "arm":
    case "upperArm":
      return slotIdByRoleSide.get(roleSideKey("body"));
    case "lowerArm":
      return (
        slotIdByRoleSide.get(roleSideKey("upperArm", sameSide)) ??
        slotIdByRoleSide.get(roleSideKey("upperArm")) ??
        slotIdByRoleSide.get(roleSideKey("arm", sameSide)) ??
        slotIdByRoleSide.get(roleSideKey("arm")) ??
        slotIdByRoleSide.get(roleSideKey("body"))
      );
    case "hand":
      return (
        slotIdByRoleSide.get(roleSideKey("lowerArm", sameSide)) ??
        slotIdByRoleSide.get(roleSideKey("lowerArm")) ??
        slotIdByRoleSide.get(roleSideKey("arm", sameSide)) ??
        slotIdByRoleSide.get(roleSideKey("arm")) ??
        slotIdByRoleSide.get(roleSideKey("upperArm", sameSide)) ??
        slotIdByRoleSide.get(roleSideKey("upperArm"))
      );
    case "leg":
    case "upperLeg":
      return slotIdByRoleSide.get(roleSideKey("body"));
    case "lowerLeg":
      return (
        slotIdByRoleSide.get(roleSideKey("upperLeg", sameSide)) ??
        slotIdByRoleSide.get(roleSideKey("upperLeg")) ??
        slotIdByRoleSide.get(roleSideKey("leg", sameSide)) ??
        slotIdByRoleSide.get(roleSideKey("leg")) ??
        slotIdByRoleSide.get(roleSideKey("body"))
      );
    case "foot":
      return (
        slotIdByRoleSide.get(roleSideKey("lowerLeg", sameSide)) ??
        slotIdByRoleSide.get(roleSideKey("lowerLeg")) ??
        slotIdByRoleSide.get(roleSideKey("leg", sameSide)) ??
        slotIdByRoleSide.get(roleSideKey("leg")) ??
        slotIdByRoleSide.get(roleSideKey("upperLeg", sameSide)) ??
        slotIdByRoleSide.get(roleSideKey("upperLeg"))
      );
    case "accessory":
      return slotIdByRoleSide.get(roleSideKey("head")) ?? slotIdByRoleSide.get(roleSideKey("body"));
    default:
      return slotIdByRoleSide.get(roleSideKey("body"));
  }
}

function parentSlotIdForRelationRef(
  relation: Pick<CharacterSlotRelation, "parentRef" | "childSlotId">,
  slotIdByRoleSide: Map<string, string>,
  bindings: CharacterSlotBinding[] | undefined,
): string | undefined {
  const ref = relation.parentRef;
  if (!ref) return undefined;
  if (ref.type === "slot" || ref.type === "semanticSlot") return ref.id;
  if (ref.type === "role") return slotIdByRoleSide.get(roleSideKey(ref.role, ref.side));
  if (ref.type === "bone") return bindings?.find((binding) => binding.boneId === ref.id)?.slotId;
  return undefined;
}

/**
 * Semantic left/right limbs cannot cross-parent through stale imported data. Deliberate unusual
 * attachments remain available through custom slots, while canonical body slots stay anatomical.
 */
function hasCrossSideAttachmentConflict(
  childSlotId: string,
  parentSlotId: string,
  slotById: ReadonlyMap<string, SlotLike>,
  sideBySlotId: ReadonlyMap<string, CharacterPart["side"] | undefined>,
): boolean {
  const childSlot = slotById.get(childSlotId);
  const parentSlot = slotById.get(parentSlotId);
  if (!childSlot || !parentSlot || childSlot.role === "custom" || parentSlot.role === "custom") {
    return false;
  }
  const childSide = sideBySlotId.get(childSlotId);
  const parentSide = sideBySlotId.get(parentSlotId);
  const childIsLateral = childSide === "left" || childSide === "right";
  const parentIsLateral = parentSide === "left" || parentSide === "right";
  return childIsLateral && parentIsLateral && childSide !== parentSide;
}

function inferHostConstraints(
  slots: SlotLike[],
  slotIdByRoleSide: Map<string, string>,
  sideBySlotId: Map<string, CharacterPart["side"] | undefined>,
) {
  const headSlotId = slotIdByRoleSide.get(roleSideKey("head"));
  if (!headSlotId) return [];
  const constrainedRoles = new Set<PartRole>(["eye", "iris", "eyebrow", "nose", "mouth"]);
  return slots
    .filter((slot) => constrainedRoles.has(slot.role) && slot.id !== headSlotId)
    .map((slot): CharacterHostConstraint => {
      const side = sideBySlotId.get(slot.id);
      const sameSide = side === "left" || side === "right" ? side : undefined;
      const hostSlotId =
        slot.role === "iris"
          ? (slotIdByRoleSide.get(roleSideKey("eye", sameSide)) ??
            slotIdByRoleSide.get(roleSideKey("eye")) ??
            headSlotId)
          : headSlotId;
      return {
        id: `host:${slot.id}`,
        slotId: slot.id,
        hostSlotId,
        hostBoneId: `bone:${hostSlotId}`,
        mode: "insideHostMask",
        reachPolicy: "scaleToFit",
      };
    });
}

function inferSlotRelations(
  slots: SlotLike[],
  slotIdByRoleSide: Map<string, string>,
  sideBySlotId: Map<string, CharacterPart["side"] | undefined>,
): CharacterSlotRelation[] {
  return slots.flatMap((slot): CharacterSlotRelation[] => {
    const part = representativePart(slot);
    if (!part) return [];
    const parentSlotId = parentSlotIdFor(slot, slotIdByRoleSide, sideBySlotId.get(slot.id));
    if (!parentSlotId || parentSlotId === slot.id) return [];
    const isIris = slot.role === "iris";
    return [
      {
        id: `relation:${slot.id}`,
        childSlotId: slot.id,
        parentRef: { type: "slot", id: parentSlotId },
        relationType: relationTypeForSlot(slot.role),
        activeWhenParentVariant: isIris ? { keys: ["open"] } : undefined,
        transformMode: "inheritParent",
        visibilityMode: isIris ? "withParentVariant" : "withParentSlot",
        renderMode: isIris ? "nested" : "sibling",
        clipMode: "none",
      },
    ];
  });
}

function relationTypeForSlot(role: PartRole): CharacterSlotRelation["relationType"] {
  switch (role) {
    case "eye":
    case "iris":
    case "eyebrow":
    case "nose":
    case "mouth":
      return "containedFeature";
    case "hand":
    case "foot":
    case "hair":
    case "accessory":
      return "attachment";
    case "custom":
      return "heldProp";
    default:
      return "attachment";
  }
}

function normalizeDrawOrder(drawOrder: string[], slotIds: string[]): string[] {
  const seen = new Set<string>();
  const out = drawOrder.filter((slotId) => {
    if (!slotIds.includes(slotId) || seen.has(slotId)) return false;
    seen.add(slotId);
    return true;
  });
  for (const slotId of slotIds) {
    if (!seen.has(slotId)) out.push(slotId);
  }
  return out;
}

/**
 * Keep one socket record per (parent slot, child slot) pair — latest wins — dropping records
 * whose owner or child slot no longer exists. Sockets are canonical even without variant
 * overrides, because their base anchor is the rest joint.
 */
function normalizeSockets(
  sockets: CharacterSlotSocket[],
  slotIds: Set<string>,
): CharacterSlotSocket[] {
  const out = new Map<string, CharacterSlotSocket>();
  for (const entry of sockets) {
    if (!entry?.slotId || !entry.childSlotId) continue;
    if (!slotIds.has(entry.slotId) || !slotIds.has(entry.childSlotId)) continue;
    const anchor = normalizeSocketAnchor(entry);
    out.set(`${entry.slotId}::${entry.childSlotId}`, {
      ...entry,
      id: entry.id || `socket:${entry.slotId}:${entry.childSlotId}`,
      x: anchor.x,
      y: anchor.y,
      ...(anchor.rotation !== undefined ? { rotation: anchor.rotation } : {}),
      variantAnchors: normalizeVariantAnchors(entry.variantAnchors),
    });
  }
  return Array.from(out.values());
}

/** Keep one reach record per known slot (latest wins), dropping any for missing slots. */
function normalizeReaches(reaches: CharacterReach[], slotIds: Set<string>): CharacterReach[] {
  const out = new Map<string, CharacterReach>();
  for (const entry of reaches) {
    if (!entry?.slotId || !slotIds.has(entry.slotId)) continue;
    out.set(entry.slotId, { ...entry, id: entry.id || `reach:${entry.slotId}` });
  }
  return Array.from(out.values());
}

function normalizeIkConstraints(
  constraints: CharacterIkConstraint[],
  boneIds: Set<string>,
): CharacterIkConstraint[] {
  return constraints.filter(
    (constraint) =>
      constraint?.kind === "twoBone" &&
      boneIds.has(constraint.targetBoneId) &&
      boneIds.has(constraint.parentBoneId) &&
      boneIds.has(constraint.childBoneId) &&
      (!constraint.endBoneId || boneIds.has(constraint.endBoneId)),
  );
}

function mergeSlotRelations(
  inferred: CharacterSlotRelation[],
  authored: CharacterSlotRelation[] | undefined,
): CharacterSlotRelation[] {
  if (!authored?.length) return inferred;
  const authoredChildren = new Set(authored.map((relation) => relation.childSlotId));
  return [
    ...inferred.filter((relation) => !authoredChildren.has(relation.childSlotId)),
    ...authored,
  ];
}

function normalizeSlotRelations(
  relations: CharacterSlotRelation[],
  slotIds: Set<string>,
  boneIds: Set<string>,
): CharacterSlotRelation[] {
  const out = new Map<string, CharacterSlotRelation>();
  for (const entry of relations ?? []) {
    if (!entry?.childSlotId || !slotIds.has(entry.childSlotId)) continue;
    if (entry.parentRef?.type === "slot" || entry.parentRef?.type === "semanticSlot") {
      if (!slotIds.has(entry.parentRef.id) || entry.parentRef.id === entry.childSlotId) continue;
    } else if (entry.parentRef?.type === "bone") {
      if (!boneIds.has(entry.parentRef.id)) continue;
    } else if (entry.parentRef?.type !== "role") {
      continue;
    }
    out.set(entry.childSlotId, {
      id: entry.id || `relation:${entry.childSlotId}`,
      childSlotId: entry.childSlotId,
      parentRef: entry.parentRef,
      relationType: normalizeRelationType(entry.relationType),
      activeWhenParentVariant: normalizeVariantGate(entry.activeWhenParentVariant),
      transformMode: entry.transformMode === "independent" ? "independent" : "inheritParent",
      visibilityMode: ["withParentSlot", "withParentVariant", "independent"].includes(
        entry.visibilityMode,
      )
        ? entry.visibilityMode
        : "withParentSlot",
      renderMode: entry.renderMode === "nested" ? "nested" : "sibling",
      clipMode: ["none", "clipToParentShape", "clipToMaskSlot"].includes(entry.clipMode ?? "none")
        ? (entry.clipMode ?? "none")
        : "none",
      clipSlotId: entry.clipSlotId && slotIds.has(entry.clipSlotId) ? entry.clipSlotId : undefined,
      characterViewIds: entry.characterViewIds?.filter(isCharacterAngle),
    });
  }
  return Array.from(out.values());
}

function normalizeRelationType(
  value: CharacterSlotRelation["relationType"] | undefined,
): CharacterSlotRelation["relationType"] {
  return [
    "attachment",
    "containedFeature",
    "decorativeChild",
    "heldProp",
    "clothingCoverage",
  ].includes(value ?? "")
    ? (value as CharacterSlotRelation["relationType"])
    : "attachment";
}

function normalizeVariantGate(
  gate: CharacterSlotRelation["activeWhenParentVariant"] | undefined,
): CharacterSlotRelation["activeWhenParentVariant"] | undefined {
  const keys = gate?.keys?.filter((value): value is string => typeof value === "string");
  const partIds = gate?.partIds?.filter((value): value is string => typeof value === "string");
  if (!keys?.length && !partIds?.length) return undefined;
  return { keys, partIds };
}

/** Keep one host constraint per known slot, dropping broken references. */
function normalizeHostConstraints(
  constraints: CharacterHostConstraint[],
  slotIds: Set<string>,
  boneIds: Set<string>,
): CharacterHostConstraint[] {
  const out = new Map<string, CharacterHostConstraint>();
  for (const entry of constraints ?? []) {
    if (!entry?.slotId || !slotIds.has(entry.slotId)) continue;
    const hostSlotId =
      entry.hostSlotId && slotIds.has(entry.hostSlotId) && entry.hostSlotId !== entry.slotId
        ? entry.hostSlotId
        : undefined;
    const hostBoneId =
      entry.hostBoneId && boneIds.has(entry.hostBoneId) ? entry.hostBoneId : undefined;
    if (!hostSlotId && !hostBoneId) continue;
    const mode = ["insideHostMask", "insideHostBounds", "reach"].includes(entry.mode)
      ? entry.mode
      : "insideHostMask";
    const reachPolicy = ["scaleToFit", "cap", "allow"].includes(entry.reachPolicy ?? "")
      ? entry.reachPolicy
      : "scaleToFit";
    out.set(entry.slotId, {
      id: entry.id || `host:${entry.slotId}`,
      slotId: entry.slotId,
      hostSlotId,
      hostBoneId,
      mode,
      reachPolicy,
    });
  }
  return Array.from(out.values());
}

function descendantPartIds(parts: CharacterPart[], partId: string): Set<string> {
  const out = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const part of parts) {
      if (out.has(part.id)) continue;
      if (part.parentId === partId || (part.parentId && out.has(part.parentId))) {
        out.add(part.id);
        changed = true;
      }
    }
  }
  return out;
}

function rotatePoint(point: { x: number; y: number }, degrees: number): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

function roleSideKey(role: PartRole, side?: CharacterPart["side"]) {
  return `${role}:${side ?? "center"}`;
}

function inferSideForSlot(slot: SlotLike, part: CharacterPart): CharacterPart["side"] | undefined {
  return (
    inferPartSide(part) ??
    inferPartSide({
      ...part,
      slotId: slot.id,
      slotName: slot.name,
    })
  );
}

function finiteNumber(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? (value as number) : fallback;
}

function positiveNumber(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && (value as number) > 0 ? (value as number) : fallback;
}
