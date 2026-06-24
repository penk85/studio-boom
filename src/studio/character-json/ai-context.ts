import {
  CHARACTER_JSON_SCHEMA_VERSION,
  CHARACTER_RIG_CONTEXT_AI_OUT_KIND,
  MOTION_EASE_NAMES,
  MOTION_REQUEST_AI_OUT_KIND,
  MOTION_SUGGESTION_AI_IN_KIND,
  MOTION_TRANSFORM_FIELD_DOCS,
  MOTION_TRANSFORM_FIELD_NAMES,
  RIG_SUGGESTION_AI_IN_KIND,
  type AngleRigJson,
  type CharacterJson,
  type MotionPromptAngleJson,
  type MotionPromptCharacterJson,
  type MotionPromptReachJson,
  type MotionPromptSlotJson,
  type CharacterRigContextAiOutJson,
  type MotionControlSurfaceJson,
  type MotionJson,
  type MotionRequestAiOutJson,
} from "./schema";
import { aiOutFilename, motionJsonFilename, slugifyName } from "./normalize";
import { inferCharacterSideFromText, type CharacterPartSide } from "../character/side-utils";

export function buildCharacterRigContextAiOut(
  character: CharacterJson,
  angles: AngleRigJson[],
): CharacterRigContextAiOutJson {
  return {
    kind: CHARACTER_RIG_CONTEXT_AI_OUT_KIND,
    schemaVersion: CHARACTER_JSON_SCHEMA_VERSION,
    suggestedFilename: aiOutFilename(character.name, "rig-context"),
    character,
    angles,
    instructions: [
      "Return only valid JSON.",
      `For rig changes, use kind "${RIG_SUGGESTION_AI_IN_KIND}".`,
      `For motion changes, use kind "${MOTION_SUGGESTION_AI_IN_KIND}".`,
      "Use semanticBone and semanticSlot targets when the motion should work across angles.",
      "Use angleBone or angleSlot targets only for angle-specific edits.",
      "Use motion.angleIds or track.angleIds when a movement is intended only for specific character angles.",
      "Bone transform tracks are parent-relative. Do not restate inherited parent motion on child bones.",
      "Slot variant tracks can swap any slot variant, including hands, clothing, props, eyes, and mouths.",
      "Depth is for parallax. Draw order is for visual stacking. Do not mix them.",
      'Do not create a structural pose tier. Poses are per-slot variant maps and motion channel "variant" tracks.',
      "The bone graph is the only transform hierarchy. Parts have one incoming registration point and named output pins. A child bone restSource names the direct parent slot and pin; pins never create another parent chain.",
      "Rotation constraints: a slot's rotReach (reaches) limits twist from rest; a variant bone's rotationLimits override it while that variant is active. Motions exceeding these are clamped unless listed in constraints.allowOutOfBounds.",
    ],
    validKinds: {
      character: "studioBoom.character.v1",
      angleRig: "studioBoom.angleRig.v1",
      motion: "studioBoom.motion.v1",
      rigSuggestion: RIG_SUGGESTION_AI_IN_KIND,
      motionSuggestion: MOTION_SUGGESTION_AI_IN_KIND,
    },
  };
}

/**
 * The native control surface advertised to the AI. Built from the same shared constants validation
 * uses, so what we advertise (OUT) is exactly what we accept (IN). This describes the control
 * *vocabulary* — the AI composes the actual movement; the editor defines no named effects.
 */
export function buildMotionControlSurface(): MotionControlSurfaceJson {
  return {
    transformFields: MOTION_TRANSFORM_FIELD_NAMES.map((name) => ({
      name,
      unit: MOTION_TRANSFORM_FIELD_DOCS[name].unit,
      doc: MOTION_TRANSFORM_FIELD_DOCS[name].doc,
    })),
    easings: [...MOTION_EASE_NAMES],
    channels: ["transform", "variant", "visibility", "opacity"],
    targetKinds: ["semanticBone", "semanticSlot", "angleBone", "angleSlot", "camera"],
    note:
      "Compose movements yourself from these primitives — there are no named effects. A card flip " +
      "is rotationY 0→360 with transformPerspective; a pendulum is an oscillating rotation with an " +
      "off-center origin (e.g. originY 0); a spin is rotation 0→360. Keyframe times t are normalized " +
      "0..1 and transforms are parent-relative.",
  };
}

export function buildMotionRequestAiOut(args: {
  character: CharacterJson;
  activeAngle: AngleRigJson;
  request: string;
  exampleMotion?: MotionJson;
}): MotionRequestAiOutJson {
  const requestSlug = slugifyName(args.request, "motion-request");
  return {
    kind: MOTION_REQUEST_AI_OUT_KIND,
    schemaVersion: CHARACTER_JSON_SCHEMA_VERSION,
    suggestedFilename: `${requestSlug}.motion-request.ai-out.json`,
    request: args.request,
    character: motionPromptCharacter(args.character),
    activeAngle: motionPromptAngle(args.activeAngle),
    instructions: [
      "Return a single JSON object.",
      `Use kind "${MOTION_SUGGESTION_AI_IN_KIND}" with a nested motion object of kind "studioBoom.motion.v1".`,
      "Use targetSpace parentRelative.",
      'Choose category from exactly: "expression", "gesture", "full-body", "camera", "headTurn", or "custom". Do not invent category labels.',
      "Author the movement yourself from the native controls in `controls` — there are no named effects. Express flips, spins, swings, twirls, etc. directly as transform keyframes.",
      "Use rotationX/rotationY together with transformPerspective for true 3D (flips, card flips); plain rotation is 2D about the Z axis.",
      "Set each keyframe's `ease` from controls.easings to shape the curve between keyframes; for oscillations (swing/pendulum) author multiple keyframes.",
      "Prefer semanticBone targets for inherited body movement.",
      "Prefer semanticSlot targets for variant swaps, visibility, opacity, or local offsets.",
      `Set angleIds to ["${args.activeAngle.angleId}"] when the requested motion is only valid for this angle.`,
      "Use activeAngle.bones[].pivot/restAngle/segmentLength for believable rotations around real joints; local rotation values may be less informative than the derived restAngle.",
      "Use activeAngle.ground.y and foot-slot contact hints to keep planted feet near the contact line. footLockAvailable=false means the runtime will not solve IK for you.",
      "Use activeAngle.facing.screenVector to choose the sign of forward/back movement for this view.",
      "Use activeAngle.depthOrdering only as overlap/near-far context. Do not output depth or z-index keyframes; they are not supported controls yet.",
      "Use cadenceHints for walk timing and stride amplitude relative to character height.",
      "Bone hierarchy is locked FK. Child bones inherit parent motion; do not restate inherited parent motion on children.",
      "There is no bidirectional IK yet. For attached hands/feet, animate the arm/leg parent for placement and use the hand/foot only for small local roll, lag, scale, or variant changes.",
      "Do not put dx/dy on a child bone when any ancestor is also animated; that moves the pin-derived joint instead of preserving the attachment.",
      "Use finite normalized keyframe times from 0 to 1.",
    ],
    controls: buildMotionControlSurface(),
    exampleMotion: args.exampleMotion ?? exampleMotion(args.request),
  };
}

export function buildMotionRequestPrompt(args: {
  character: CharacterJson;
  activeAngle: AngleRigJson;
  request: string;
  exampleMotion?: MotionJson;
}): string {
  const context = buildMotionRequestAiOut(args);
  return [
    "Studio Boom motion prompt",
    "",
    `request: ${context.request}`,
    `active_angle: ${context.activeAngle.angleId}`,
    `character: ${context.character.name}`,
    `available_angles: ${context.character.angles.join(", ") || "none"}`,
    "",
    "return",
    `kind: ${MOTION_SUGGESTION_AI_IN_KIND}`,
    "shape: one JSON object only; nested motion.kind must be studioBoom.motion.v1",
    "target_space: parentRelative",
    `categories: expression, gesture, full-body, camera, headTurn, custom`,
    "",
    "instructions",
    ...context.instructions.map((instruction) => `- ${instruction}`),
    "",
    "facing",
    `forward_axis: ${context.activeAngle.facing.forwardAxis}`,
    `screen_vector: ${pointText(context.activeAngle.facing.screenVector)}`,
    `hint: ${context.activeAngle.facing.hint}`,
    "",
    "ground",
    `y: ${context.activeAngle.ground.y}`,
    `source: ${context.activeAngle.ground.source}`,
    `planted_slots: ${listText(context.activeAngle.ground.plantedSlotIds)}`,
    `foot_lock_available: ${context.activeAngle.ground.footLockAvailable ? "yes" : "no"}`,
    `hint: ${context.activeAngle.ground.hint}`,
    "",
    "cadence_hints",
    `character_height_px: ${context.activeAngle.cadenceHints.characterHeightPx}`,
    `suggested_step_duration_sec: ${context.activeAngle.cadenceHints.suggestedStepDurationSec}`,
    `steps_per_cycle: ${context.activeAngle.cadenceHints.stepsPerCycle}`,
    `stride_px_range: ${context.activeAngle.cadenceHints.stridePxRange.min} to ${context.activeAngle.cadenceHints.stridePxRange.max}`,
    "",
    "depth_ordering",
    `animation_supported: ${context.activeAngle.depthOrdering.animationSupported ? "yes" : "no"}`,
    `near_to_far_slots: ${listText(context.activeAngle.depthOrdering.nearToFarSlotIds)}`,
    `hint: ${context.activeAngle.depthOrdering.hint}`,
    "",
    "active_angle.bone_locks",
    ...(context.activeAngle.boneLocks?.length
      ? context.activeAngle.boneLocks.map(
          (lock) =>
            `- parent_bone=${lock.parentBoneId}; child_bone=${lock.childBoneId}; child_slot=${
              lock.childSlotId ?? "none"
            }; policy=${lock.policy}; ik_available=${lock.ikAvailable ? "yes" : "no"}; hint=${
              lock.hint
            }`,
        )
      : ["- none"]),
    "",
    "controls.transform_fields",
    ...context.controls.transformFields.map(
      (field) => `- ${field.name}; unit=${field.unit}; ${field.doc}`,
    ),
    `controls.easings: ${context.controls.easings.join(", ")}`,
    `controls.channels: ${context.controls.channels.join(", ")}`,
    `controls.target_kinds: ${context.controls.targetKinds.join(", ")}`,
    `controls.note: ${context.controls.note}`,
    "",
    "semantic_bones",
    ...context.character.semanticBones.map(
      (bone) =>
        `- id=${bone.id}; name=${bone.name}; role=${bone.role}; aliases=${listText(
          bone.aliases,
        )}; hint=${bone.aiHint ?? "none"}`,
    ),
    "",
    "semantic_slots",
    ...context.character.semanticSlots.map(
      (slot) =>
        `- id=${slot.id}; name=${slot.name}; role=${slot.role}; type=${
          slot.semanticType
        }; angles=${listText(slot.angleIds)}; aliases=${listText(slot.aliases)}; hint=${
          slot.aiHint ?? "none"
        }`,
    ),
    "",
    "active_angle.bones",
    ...context.activeAngle.bones.map(
      (bone) =>
        `- id=${bone.id}; semantic=${bone.semanticBoneId ?? "none"}; name=${bone.name}; role=${
          bone.role
        }; side=${bone.side ?? "none"}; parent=${bone.parentId ?? "none"}; pivot=${pointText(
          bone.pivot,
        )}; rest_angle=${bone.restAngle}; segment_length=${bone.segmentLength}; segment_child=${
          bone.segmentChildId ?? "none"
        }; length_source=${bone.lengthSource}; joint_range=${rangeText(bone.jointRange)}`,
    ),
    "",
    "active_angle.slots",
    ...context.activeAngle.slots.flatMap((slot) => slotPromptLines(slot)),
    "",
    "active_angle.reaches",
    ...(context.activeAngle.reaches?.length
      ? context.activeAngle.reaches.map(
          (reach) =>
            `- slot=${reach.slotId}; reach_bounds=${reach.reachBounds ? `${reach.reachBounds.minX},${reach.reachBounds.minY} to ${reach.reachBounds.maxX},${reach.reachBounds.maxY}` : "none"}; rot_reach=${rangeText(reach.rotReach)}`,
        )
      : ["- none"]),
    "",
    "active_angle.pin_contracts",
    ...(context.activeAngle.pinContracts?.length
      ? context.activeAngle.pinContracts.map(
          (contract) =>
            `- parent_slot=${contract.parentSlotId}; child_bone=${contract.childBoneId}; child_slot=${
              contract.childSlotId ?? "none"
            }; pin=${contract.pinName}; supplied_by_variants=${listText(
              contract.suppliedByVariantIds,
            )}`,
        )
      : ["- none"]),
    "",
    "example_motion",
    ...motionExampleLines(context.exampleMotion),
  ].join("\n");
}

function motionPromptCharacter(character: CharacterJson): MotionPromptCharacterJson {
  return {
    id: character.id,
    name: character.name,
    description: character.description,
    defaultAngle: character.defaultAngle,
    angles: character.angles,
    semanticBones: character.semanticBones,
    semanticSlots: character.semanticSlots,
  };
}

function motionPromptAngle(angle: AngleRigJson): MotionPromptAngleJson {
  const bindingsBySlot = new Map(angle.bindings.map((binding) => [binding.slotId, binding]));
  const slotIdByBoneId = new Map(angle.bindings.map((binding) => [binding.boneId, binding.slotId]));
  const drawOrderBySlot = new Map(angle.drawOrder.map((slotId, index) => [slotId, index]));
  const reachesBySlot = new Map(compactReaches(angle)?.map((reach) => [reach.slotId, reach]) ?? []);
  const worldBones = boneWorldTransforms(angle);
  const childrenByParent = new Map<string, typeof angle.bones>();
  for (const bone of angle.bones) {
    if (!bone.parentId) continue;
    childrenByParent.set(bone.parentId, [...(childrenByParent.get(bone.parentId) ?? []), bone]);
  }
  const ground = groundMetrics(angle, worldBones, bindingsBySlot);
  const facing = facingMetrics(angle.angleId);
  const nearSide = nearSideForAngle(angle.angleId);
  const slots: MotionPromptSlotJson[] = angle.slots.map((slot) => {
    const binding = bindingsBySlot.get(slot.id);
    const side = inferCharacterSideFromText(`${slot.id} ${slot.name}`);
    const motionLimits = reachesBySlot.get(slot.id);
    return {
      id: slot.id,
      semanticSlotId: slot.semanticSlotId,
      name: slot.name,
      role: slot.role,
      side,
      bounds: slot.bounds,
      drawOrderIndex: drawOrderBySlot.get(slot.id),
      nearFar: nearFarForSlot(side, nearSide),
      binding: binding
        ? {
            boneId: binding.boneId,
            defaultVariant: binding.defaultVariant,
            visible: binding.visible,
            depth: binding.depth,
          }
        : undefined,
      motionLimits,
      contact:
        slot.role === "foot"
          ? {
              canPlant: true,
              groundY: ground.y,
              footLockAvailable: false,
              hint: "This slot can visually act as a planted foot. Keep it near groundY during stance; Studio Boom does not enforce IK/foot-lock yet.",
            }
          : undefined,
      variants: slot.variants.map((variant) => ({
        id: variant.id,
        name: variant.name,
        displayName: variant.displayName,
        variant: variant.variant,
        pose: variant.pose,
        viseme: variant.viseme,
        eyeState: variant.eyeState,
        aiMetadata: variant.aiMetadata,
        angleIds: variant.angleIds,
      })),
    };
  });
  return {
    angleId: angle.angleId,
    canvas: angle.canvas,
    facing,
    ground,
    cadenceHints: cadenceHints(angle, worldBones, ground.y),
    depthOrdering: {
      animationSupported: false,
      nearToFarSlotIds: slots
        .slice()
        .sort((a, b) => {
          const aDepth = a.binding?.depth ?? 0;
          const bDepth = b.binding?.depth ?? 0;
          return bDepth - aDepth || (b.drawOrderIndex ?? 0) - (a.drawOrderIndex ?? 0);
        })
        .map((slot) => slot.id),
      hint: "Use this for crossing/overlap decisions. Depth/z keyframes are not supported unless a future controls.transformFields entry explicitly adds them.",
    },
    boneLocks: boneLocksForAngle(angle, slotIdByBoneId),
    bones: angle.bones.map((bone) => {
      const world = worldBones.get(bone.id) ?? {
        x: bone.x,
        y: bone.y,
        rotation: bone.rotation,
      };
      const segment = segmentMetrics(bone, childrenByParent.get(bone.id) ?? [], worldBones, angle);
      const boundSlot = angle.bindings.find((binding) => binding.boneId === bone.id)?.slotId;
      const range = boundSlot ? reachesBySlot.get(boundSlot)?.rotReach : undefined;
      return {
        id: bone.id,
        semanticBoneId: bone.semanticBoneId,
        name: bone.name,
        role: bone.role,
        side: inferCharacterSideFromText(`${bone.id} ${bone.name}`),
        parentId: bone.parentId,
        x: bone.x,
        y: bone.y,
        rotation: bone.rotation,
        depth: bone.depth,
        length: bone.length,
        pivot: { x: round(world.x), y: round(world.y) },
        restAngle: round(segment.restAngle),
        segmentLength: round(segment.segmentLength),
        segmentVector: segment.segmentVector
          ? { x: round(segment.segmentVector.x), y: round(segment.segmentVector.y) }
          : undefined,
        segmentChildId: segment.segmentChildId,
        lengthSource: segment.lengthSource,
        jointRange: range ? { ...range, source: "slotRotReach" as const } : undefined,
      };
    }),
    slots,
    slotRelations: angle.slotRelations?.map((relation) => ({ ...relation })),
    hostConstraints: angle.hostConstraints?.map((constraint) => ({ ...constraint })),
    reaches: Array.from(reachesBySlot.values()),
    pinContracts: angle.pinContracts?.map((contract) => ({
      ...contract,
      suppliedByVariantIds:
        angle.slots
          .find((slot) => slot.id === contract.parentSlotId)
          ?.variants.filter((variant) => !!variant.pins?.[contract.pinName])
          .map((variant) => variant.id) ?? [],
    })),
  };
}

function boneLocksForAngle(
  angle: AngleRigJson,
  slotIdByBoneId: Map<string, string>,
): MotionPromptAngleJson["boneLocks"] {
  const attachmentRoles = new Set([
    "arm",
    "upperArm",
    "lowerArm",
    "hand",
    "leg",
    "upperLeg",
    "lowerLeg",
    "foot",
    "head",
    "hair",
    "accessory",
  ]);
  const locks = angle.bones
    .filter((bone) => bone.parentId && attachmentRoles.has(String(bone.role)))
    .map((bone) => {
      const childSlotId = slotIdByBoneId.get(bone.id);
      return {
        parentBoneId: bone.parentId as string,
        childBoneId: bone.id,
        ...(childSlotId ? { childSlotId } : {}),
        policy: "fkInheritsParent" as const,
        ikAvailable: false,
        hint: "Parent controls placement; child transform is local articulation only. Avoid child dx/dy when the parent or another ancestor is animated.",
      };
    });
  return locks.length ? locks : undefined;
}

function slotPromptLines(slot: MotionPromptSlotJson): string[] {
  return [
    `- id=${slot.id}; semantic=${slot.semanticSlotId ?? "none"}; name=${slot.name}; role=${
      slot.role
    }; side=${slot.side ?? "none"}; near_far=${slot.nearFar ?? "none"}; bounds=${
      slot.bounds
        ? `${slot.bounds.type} ${slot.bounds.x},${slot.bounds.y} ${slot.bounds.width}x${slot.bounds.height}`
        : "none"
    }; binding=${slot.binding ? `bone=${slot.binding.boneId}, default_variant=${slot.binding.defaultVariant ?? "none"}, depth=${slot.binding.depth}` : "none"}; contact=${
      slot.contact
        ? `can_plant=${slot.contact.canPlant ? "yes" : "no"}, ground_y=${
            slot.contact.groundY ?? "none"
          }, foot_lock=${slot.contact.footLockAvailable ? "yes" : "no"}`
        : "none"
    }; motion_limits=${
      slot.motionLimits
        ? `reach=${slot.motionLimits.reachBounds ? `${slot.motionLimits.reachBounds.minX},${slot.motionLimits.reachBounds.minY} to ${slot.motionLimits.reachBounds.maxX},${slot.motionLimits.reachBounds.maxY}` : "none"}, rot=${rangeText(slot.motionLimits.rotReach)}`
        : "none"
    }`,
    `  variants: ${
      slot.variants
        .map((variant) =>
          [
            variant.id,
            variant.displayName ?? variant.name,
            variant.variant?.kind,
            variant.pose,
            variant.viseme,
            variant.eyeState,
            variant.aiMetadata?.plainDescription,
          ]
            .filter(Boolean)
            .join(" | "),
        )
        .join("; ") || "none"
    }`,
  ];
}

function motionExampleLines(motion: MotionJson): string[] {
  return [
    `name: ${motion.name}`,
    `category: ${motion.category}`,
    `duration: ${motion.duration}`,
    `loop: ${motion.loop ? "yes" : "no"}`,
    ...motion.tracks.flatMap((track) => [
      `track: id=${track.id}; target=${targetText(track.target)}; channel=${track.channel}`,
      ...track.keyframes.map(
        (keyframe) =>
          `  keyframe: t=${keyframe.t}; ${Object.entries(keyframe)
            .filter(([key]) => key !== "t")
            .map(([key, value]) => `${key}=${String(value)}`)
            .join("; ")}`,
      ),
    ]),
  ];
}

function targetText(target: MotionJson["tracks"][number]["target"]): string {
  if (target.kind === "camera") return "camera";
  return `${target.kind}:${target.id}${"angleId" in target ? `@${target.angleId}` : ""}`;
}

function pointText(point: { x: number; y: number }): string {
  return `${point.x},${point.y}`;
}

function rangeText(range: { min: number; max: number } | undefined): string {
  return range ? `${range.min} to ${range.max}` : "none";
}

function listText(items: string[] | undefined): string {
  return items?.length ? items.join(", ") : "none";
}

function boneWorldTransforms(
  angle: AngleRigJson,
): Map<string, { x: number; y: number; rotation: number }> {
  const bonesById = new Map(angle.bones.map((bone) => [bone.id, bone]));
  const out = new Map<string, { x: number; y: number; rotation: number }>();
  const resolving = new Set<string>();
  const resolve = (bone: AngleRigJson["bones"][number]) => {
    const cached = out.get(bone.id);
    if (cached) return cached;
    const local = { x: bone.x, y: bone.y, rotation: bone.rotation };
    const parent = bone.parentId ? bonesById.get(bone.parentId) : undefined;
    if (!parent || resolving.has(parent.id)) {
      out.set(bone.id, local);
      return local;
    }
    resolving.add(bone.id);
    const parentWorld = resolve(parent);
    resolving.delete(bone.id);
    const rotated = rotatePoint(local.x, local.y, parentWorld.rotation);
    const world = {
      x: parentWorld.x + rotated.x,
      y: parentWorld.y + rotated.y,
      rotation: parentWorld.rotation + local.rotation,
    };
    out.set(bone.id, world);
    return world;
  };
  for (const bone of angle.bones) resolve(bone);
  return out;
}

function segmentMetrics(
  bone: AngleRigJson["bones"][number],
  children: AngleRigJson["bones"],
  worldBones: Map<string, { x: number; y: number; rotation: number }>,
  angle: AngleRigJson,
): {
  restAngle: number;
  segmentLength: number;
  segmentVector?: { x: number; y: number };
  segmentChildId?: string;
  lengthSource: MotionPromptAngleJson["bones"][number]["lengthSource"];
} {
  const world = worldBones.get(bone.id) ?? { x: bone.x, y: bone.y, rotation: bone.rotation };
  const child = children
    .map((candidate) => {
      const childWorld = worldBones.get(candidate.id);
      if (!childWorld) return null;
      const vector = { x: childWorld.x - world.x, y: childWorld.y - world.y };
      return { child: candidate, vector, length: Math.hypot(vector.x, vector.y) };
    })
    .filter((item): item is NonNullable<typeof item> => !!item)
    .sort((a, b) => b.length - a.length)[0];
  if (child && child.length > 0) {
    return {
      restAngle: deg(Math.atan2(child.vector.y, child.vector.x)),
      segmentLength: child.length,
      segmentVector: child.vector,
      segmentChildId: child.child.id,
      lengthSource: "childPivot",
    };
  }

  const boundSlot = angle.bindings.find((binding) => binding.boneId === bone.id)?.slotId;
  const slotBounds = boundSlot
    ? angle.slots.find((slot) => slot.id === boundSlot)?.bounds
    : undefined;
  if (slotBounds) {
    return {
      restAngle: world.rotation,
      segmentLength: Math.max(slotBounds.width, slotBounds.height),
      lengthSource: "slotBounds",
    };
  }
  if (typeof bone.length === "number" && Number.isFinite(bone.length) && bone.length > 0) {
    return {
      restAngle: world.rotation,
      segmentLength: bone.length,
      lengthSource: "authoredLength",
    };
  }
  return { restAngle: world.rotation, segmentLength: 0, lengthSource: "zero" };
}

function groundMetrics(
  angle: AngleRigJson,
  worldBones: Map<string, { x: number; y: number; rotation: number }>,
  bindingsBySlot: Map<string, AngleRigJson["bindings"][number]>,
): MotionPromptAngleJson["ground"] {
  const footSlots = angle.slots.filter((slot) => slot.role === "foot");
  const boundedFeet = footSlots
    .map((slot) => {
      const binding = bindingsBySlot.get(slot.id);
      const bone = binding ? worldBones.get(binding.boneId) : undefined;
      if (!binding || !bone || !slot.bounds) return null;
      const bottom = bone.y + binding.y + slot.bounds.y + slot.bounds.height;
      return { slotId: slot.id, bottom };
    })
    .filter((item): item is NonNullable<typeof item> => !!item);
  if (boundedFeet.length) {
    return {
      y: round(Math.max(...boundedFeet.map((item) => item.bottom))),
      source: "slotBounds",
      plantedSlotIds: boundedFeet.map((item) => item.slotId),
      footLockAvailable: false,
      hint: "Use as the visual contact line for planted feet. The runtime does not enforce planted-foot IK yet.",
    };
  }
  const footPivots = footSlots
    .map((slot) => {
      const binding = bindingsBySlot.get(slot.id);
      const bone = binding ? worldBones.get(binding.boneId) : undefined;
      return bone ? { slotId: slot.id, y: bone.y } : null;
    })
    .filter((item): item is NonNullable<typeof item> => !!item);
  if (footPivots.length) {
    return {
      y: round(Math.max(...footPivots.map((item) => item.y))),
      source: "bonePivots",
      plantedSlotIds: footPivots.map((item) => item.slotId),
      footLockAvailable: false,
      hint: "Inferred from foot pivots because slot bounds were unavailable. Keep stance feet near this line; no IK lock is enforced yet.",
    };
  }
  return {
    y: angle.canvas.height,
    source: "canvasBottom",
    plantedSlotIds: [],
    footLockAvailable: false,
    hint: "No foot slots were available; canvas bottom is only a fallback contact line.",
  };
}

function cadenceHints(
  angle: AngleRigJson,
  worldBones: Map<string, { x: number; y: number; rotation: number }>,
  groundY: number,
): MotionPromptAngleJson["cadenceHints"] {
  const ys = Array.from(worldBones.values()).map((world) => world.y);
  const top = ys.length ? Math.min(...ys) : 0;
  const characterHeightPx = Math.max(1, groundY - top);
  return {
    characterHeightPx: round(characterHeightPx),
    suggestedStepDurationSec: 0.42,
    stepsPerCycle: 2,
    stridePxRange: {
      min: round(characterHeightPx * 0.12),
      max: round(characterHeightPx * 0.28),
    },
  };
}

function facingMetrics(angle: AngleRigJson["angleId"]): MotionPromptAngleJson["facing"] {
  if (angle === "sideL" || angle === "3qL") {
    return {
      forwardAxis: "-x",
      screenVector: { x: -1, y: 0 },
      hint: "Forward movement for this view travels toward negative screen X.",
    };
  }
  if (angle === "sideR" || angle === "3qR") {
    return {
      forwardAxis: "+x",
      screenVector: { x: 1, y: 0 },
      hint: "Forward movement for this view travels toward positive screen X.",
    };
  }
  return {
    forwardAxis: "camera",
    screenVector: { x: 0, y: 0 },
    hint: "Front view faces the camera; choose a screen travel direction from the user's request instead of assuming left/right.",
  };
}

function nearSideForAngle(angle: AngleRigJson["angleId"]): "left" | "right" | undefined {
  if (angle === "sideL" || angle === "3qL") return "right";
  if (angle === "sideR" || angle === "3qR") return "left";
  return undefined;
}

function nearFarForSlot(
  side: CharacterPartSide | undefined,
  nearSide: ReturnType<typeof nearSideForAngle>,
): "near" | "far" | "center" | undefined {
  if (!side || side === "center" || side === "front" || side === "back") return "center";
  if (!nearSide) return "center";
  return side === nearSide ? "near" : "far";
}

function rotatePoint(x: number, y: number, degrees: number): { x: number; y: number } {
  if (!degrees) return { x, y };
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

function deg(radians: number): number {
  return (radians * 180) / Math.PI;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function compactReaches(angle: AngleRigJson): MotionPromptReachJson[] | undefined {
  if (!angle.reaches?.length) return undefined;
  return angle.reaches.map((reach) => {
    const xs = reach.reach?.map((point) => point.x) ?? [];
    const ys = reach.reach?.map((point) => point.y) ?? [];
    return {
      slotId: reach.slotId,
      reachBounds:
        xs.length && ys.length
          ? {
              minX: Math.min(...xs),
              maxX: Math.max(...xs),
              minY: Math.min(...ys),
              maxY: Math.max(...ys),
            }
          : undefined,
      rotReach: reach.rotReach,
    };
  });
}

function exampleMotion(request: string): MotionJson {
  const name = request.trim() || "Example Gesture";
  return {
    kind: "studioBoom.motion.v1",
    schemaVersion: CHARACTER_JSON_SCHEMA_VERSION,
    suggestedFilename: motionJsonFilename(name),
    id: `motion:${slugifyName(name, "example")}`,
    name,
    category: "gesture",
    duration: 1,
    loop: false,
    targetSpace: "parentRelative",
    tracks: [
      {
        id: "track:body",
        target: { kind: "semanticBone", id: "bone:torso" },
        channel: "transform",
        keyframes: [
          { t: 0, dy: 0 },
          { t: 0.5, dy: -12, ease: "easeOut" },
          { t: 1, dy: 0, ease: "easeIn" },
        ],
      },
      {
        id: "track:right-hand-variant",
        target: { kind: "semanticSlot", id: "slot:rightHand" },
        channel: "variant",
        keyframes: [
          { t: 0, variant: "openPalm" },
          { t: 0.5, variant: "closedFist" },
          { t: 1, variant: "openPalm" },
        ],
      },
      {
        // Illustrative 3D "card flip" — authored as plain keyframes, not a named effect.
        id: "track:head-cardflip",
        target: { kind: "semanticBone", id: "bone:head" },
        channel: "transform",
        keyframes: [
          { t: 0, rotationY: 0, transformPerspective: 800, ease: "easeInOut" },
          { t: 1, rotationY: 360, transformPerspective: 800, ease: "easeInOut" },
        ],
      },
      {
        // Illustrative "pendulum" — oscillating 2D rotation pivoting from the top edge (originY 0).
        id: "track:arm-pendulum",
        target: { kind: "semanticBone", id: "bone:armR" },
        channel: "transform",
        keyframes: [
          { t: 0, rotation: 0, originY: 0, ease: "easeInOut" },
          { t: 0.25, rotation: 18, originY: 0, ease: "easeInOut" },
          { t: 0.75, rotation: -18, originY: 0, ease: "easeInOut" },
          { t: 1, rotation: 0, originY: 0, ease: "easeInOut" },
        ],
      },
    ],
    constraints: { defaultReachPolicy: "scaleToFit" },
  };
}
