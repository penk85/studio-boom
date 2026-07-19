import type {
  CharacterAngle,
  CharacterClipMeta,
  MediaAsset,
  CharacterPart,
  CharacterPreset,
  PartRole,
} from "../types";
import { localAlphaBounds } from "./alpha-bounds";
import {
  anchorPartForVariant,
  defaultLimbPathDeformForPart,
  pivotAlignedPartOffset,
  variantAliasesForPart,
  variantKeyForPart,
} from "./character-utils";
import {
  BEND_CROSS_VERTICES,
  DEFAULT_BEND_SEGMENTS,
  DEFAULT_LIMB_CROSS_VERTICES,
  LIMB_PATH_RENDER_SEGMENTS,
  clampBendDegrees,
  limbPathProjectPointT,
} from "./mesh-deform";
import { runtimeAncestorMotionTargets, runtimeMotionTargetForSlot } from "./motion-targets";
import { registrationForPart, pinTransformInBoneSpace } from "./registration";
import { representativePart, slotDrawIndex } from "./rig";
import {
  buildCharacterRuntime,
  resolveRuntimeSlotPart,
  runtimeBoneWorldTransforms,
  runtimePartPlacement,
  type CharacterRuntime,
  type RuntimePartPlacement,
  type RuntimeCharacterSlot,
} from "./runtime";

export const CHARACTER_SCENE_ROOT_NODE_ID = "character-scene:root";

export type CharacterSceneNodeKind = "root" | "bone" | "slot" | "sprite" | "mesh" | "vector";

export interface CharacterSceneFrame {
  /** Top-left position in the parent coordinate space, after output scaling. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Transform origin in local pixels. For Pixi, position = x/y + origin and pivot = origin. */
  originX: number;
  originY: number;
  /** Degrees, matching the existing character motion vocabulary. */
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export interface CharacterScenePlacement {
  x: number;
  y: number;
  pivotX: number;
  pivotY: number;
  containerX: number;
  containerY: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  depth: number;
  drawOrder: number;
  basePartId: string;
  referencePartId?: string;
}

export interface CharacterSceneBoneVariantAnchor {
  x: number;
  y: number;
  rotation: number;
}

export interface CharacterSceneBoneAnchorTrack {
  boneId: string;
  parentSlotId: string;
  base: CharacterSceneBoneVariantAnchor;
  initial: CharacterSceneBoneVariantAnchor;
  anchors: Record<string, CharacterSceneBoneVariantAnchor>;
}

interface CharacterSceneNodeBase {
  id: string;
  kind: CharacterSceneNodeKind;
  parentId?: string;
  childIds: string[];
  frame: CharacterSceneFrame;
  visible: boolean;
  opacity: number;
  zIndex: number;
}

export interface CharacterSceneRootNode extends CharacterSceneNodeBase {
  kind: "root";
}

export interface CharacterSceneBoneNode extends CharacterSceneNodeBase {
  kind: "bone";
  boneId: string;
  role: PartRole | "root";
  side?: CharacterPart["side"];
  parentBoneId?: string;
  depth: number;
  variantAnchors?: CharacterSceneBoneAnchorTrack;
}

export interface CharacterSceneSlotNode extends CharacterSceneNodeBase {
  kind: "slot";
  slotId: string;
  role: PartRole;
  side?: CharacterPart["side"];
  boneId?: string;
  depth: number;
  drawOrder: number;
  defaultVariantKey: string;
  activePartId: string;
  basePartId: string;
  referencePartId?: string;
  variantNodeIds: Record<string, string[]>;
  motionTargetNodeId: string;
  ancestorMotionTargetNodeIds: string[];
}

export interface CharacterSceneSpriteNode extends CharacterSceneNodeBase {
  kind: "sprite";
  slotId: string;
  partId: string;
  role: PartRole;
  mediaId: string;
  assetId: string;
  assetRef: string;
  variantKey: string;
  variantAliases: string[];
  active: boolean;
  placement: CharacterScenePlacement;
}

export interface CharacterSceneMeshNode extends CharacterSceneNodeBase {
  kind: "mesh";
  meshKind: "plane" | "rope";
  slotId: string;
  partId: string;
  role: PartRole;
  mediaId: string;
  assetId: string;
  assetRef: string;
  variantKey: string;
  variantAliases: string[];
  active: boolean;
  verticesX?: number;
  verticesY?: number;
  /** Limb axis the art bends along; matches the part's longer dimension. */
  stretchAxis?: "x" | "y";
  /** Which end of the limb axis stays fixed at the joint (registration end). */
  bendAnchor?: "start" | "end";
  /** Registration point in normalized texture space, used as the bend joint. */
  bendOriginX?: number;
  bendOriginY?: number;
  /** Authored base curve in degrees applied every frame before motion vars. */
  bend?: number;
  /** Point path (spine) for flexible limb/stretch rendering, part-local px. */
  pathPoints?: Array<{ x: number; y: number }>;
  /** Normalized spine positions that stay fixed while the distal mesh segment moves. */
  pathLockTs?: number[];
  /** Child bone sockets that should ride along this deformed limb path. */
  pathAttachments?: CharacterSceneMeshPathAttachment[];
  /** Locked fold direction (+1 left-hand normal side, -1 opposite). */
  pathBendSide?: number;
  /** Authored joint (elbow/knee) position as t along the spine. */
  pathJointT?: number;
  /** Ribbon cross width in part-local px (the visible limb's short dimension). */
  ropeWidth?: number;
  /** Columns across the ribbon (>=2). */
  crossVertices?: number;
  /** Visible texture sub-rect (0..1) mapped across the ribbon. */
  uvRect?: { u0: number; v0: number; u1: number; v1: number };
  /** True when the limb's long axis is the texture's height (v). */
  ribbonVertical?: boolean;
  /**
   * Authoring source size (part-local px) for rope geometry, which lives in
   * part-local pixels rather than texture pixels. The runtime scales the rope
   * container by frame.width/sourceWidth so a resized limb still aligns (using
   * texture dims here would mis-scale any part whose size != its image size).
   */
  sourceWidth?: number;
  sourceHeight?: number;
  placement: CharacterScenePlacement;
}

export interface CharacterSceneMeshPathAttachment {
  boneNodeId: string;
  localPoint: { x: number; y: number };
}

export interface CharacterSceneVectorNode extends CharacterSceneNodeBase {
  kind: "vector";
  slotId: string;
  partId: string;
  role: PartRole;
  variantKey: string;
  variantAliases: string[];
  active: boolean;
  path: string;
  viewBox: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: string;
  strokeLinecap?: string;
  strokeLinejoin?: string;
  placement: CharacterScenePlacement;
}

export type CharacterSceneNode =
  | CharacterSceneRootNode
  | CharacterSceneBoneNode
  | CharacterSceneSlotNode
  | CharacterSceneSpriteNode
  | CharacterSceneMeshNode
  | CharacterSceneVectorNode;

export interface CharacterSceneMotionTarget {
  slotId: string;
  nodeId: string;
  address: string;
  runtimeTarget: ReturnType<typeof runtimeMotionTargetForSlot>;
  ancestorNodeIds: string[];
  pivot?: { x: number; y: number };
}

export interface CharacterSceneAsset {
  id: string;
  ref: string;
  kind: "texture";
  parser: "texture" | "svg";
  partIds: string[];
  /** Logical output size used to rasterize SVG source instead of its often much larger canvas. */
  rasterWidth?: number;
  rasterHeight?: number;
}

export interface CharacterSceneGraph {
  version: 1;
  characterId: string;
  characterName: string;
  angle: CharacterAngle;
  sourceCanvas: { width: number; height: number };
  output: { width: number; height: number; scaleX: number; scaleY: number };
  rootNodeId: typeof CHARACTER_SCENE_ROOT_NODE_ID;
  nodes: Record<string, CharacterSceneNode>;
  boneNodeIds: Record<string, string>;
  slotNodeIds: Record<string, string>;
  partNodeIds: Record<string, string>;
  motionTargetsBySlotId: Record<string, CharacterSceneMotionTarget>;
  boneAnchorTracks: Record<string, CharacterSceneBoneAnchorTrack>;
  assets: CharacterSceneAsset[];
}

export interface BuildCharacterSceneArgs {
  character: CharacterPreset;
  meta?: Pick<CharacterClipMeta, "poses">;
  poses?: Record<string, string>;
  width?: number;
  height?: number;
  angle?: CharacterAngle;
  runtime?: CharacterRuntime;
  mediaAssets?: ReadonlyMap<string, Pick<MediaAsset, "filename" | "mimeType">>;
}

export function buildCharacterScene(args: BuildCharacterSceneArgs): CharacterSceneGraph {
  const runtime = args.runtime ?? buildCharacterRuntime(args.character, { angle: args.angle });
  const character = runtime.character;
  const width = positiveNumber(args.width, character.canvasWidth);
  const height = positiveNumber(args.height, character.canvasHeight);
  const scaleX = width / Math.max(1, character.canvasWidth);
  const scaleY = height / Math.max(1, character.canvasHeight);
  const poses = args.poses ?? args.meta?.poses ?? {};
  const activeVariants = activeVariantMap(runtime, poses);
  const worldByBone = runtimeBoneWorldTransforms(runtime, activeVariants);
  const boneAnchorTracks = buildBoneAnchorTracks(runtime, poses, scaleX, scaleY);

  const nodes: Record<string, CharacterSceneNode> = {};
  const boneNodeIds: Record<string, string> = {};
  const slotNodeIds: Record<string, string> = {};
  const partNodeIds: Record<string, string> = {};
  const motionTargetsBySlotId: Record<string, CharacterSceneMotionTarget> = {};
  const assetsById = new Map<string, CharacterSceneAsset>();

  const addNode = (node: CharacterSceneNode) => {
    nodes[node.id] = node;
    if (node.parentId) nodes[node.parentId]?.childIds.push(node.id);
  };

  addNode({
    id: CHARACTER_SCENE_ROOT_NODE_ID,
    kind: "root",
    childIds: [],
    frame: frame(0, 0, width, height),
    visible: true,
    opacity: 1,
    zIndex: 0,
  });

  for (const bone of runtime.angleRig.bones) {
    const id = characterSceneBoneNodeId(bone.id);
    boneNodeIds[bone.id] = id;
    const parentId = bone.parentId
      ? characterSceneBoneNodeId(bone.parentId)
      : CHARACTER_SCENE_ROOT_NODE_ID;
    const anchorTrack = boneAnchorTracks[bone.id];
    const initial = anchorTrack?.initial;
    addNode({
      id,
      kind: "bone",
      parentId,
      childIds: [],
      boneId: bone.id,
      role: bone.role,
      side: bone.side,
      parentBoneId: bone.parentId,
      depth: bone.depth ?? 0,
      variantAnchors: anchorTrack,
      frame: frame(
        initial ? initial.x : bone.x * scaleX,
        initial ? initial.y : bone.y * scaleY,
        0,
        0,
        {
          rotation: initial ? initial.rotation : bone.rotation,
        },
      ),
      visible: true,
      opacity: 1,
      zIndex: boneZIndex(runtime, bone.id),
    });
  }

  for (const slot of runtime.slots) {
    addSlotSceneNodes({
      runtime,
      slot,
      poses,
      activeVariants,
      worldByBone,
      scaleX,
      scaleY,
      nodes,
      addNode,
      boneNodeIds,
      slotNodeIds,
      partNodeIds,
      motionTargetsBySlotId,
      assetsById,
      mediaAssets: args.mediaAssets,
    });
  }

  return {
    version: 1,
    characterId: character.id,
    characterName: character.name,
    angle: runtime.angle,
    sourceCanvas: { width: character.canvasWidth, height: character.canvasHeight },
    output: { width, height, scaleX, scaleY },
    rootNodeId: CHARACTER_SCENE_ROOT_NODE_ID,
    nodes,
    boneNodeIds,
    slotNodeIds,
    partNodeIds,
    motionTargetsBySlotId,
    boneAnchorTracks,
    assets: Array.from(assetsById.values()),
  };
}

export function characterSceneBoneNodeId(boneId: string): string {
  return `character-scene:bone:${boneId}`;
}

export function characterSceneSlotNodeId(slotId: string): string {
  return `character-scene:slot:${slotId}`;
}

export function characterScenePartNodeId(
  slotId: string,
  variantKey: string,
  partId: string,
): string {
  return `character-scene:part:${slotId}:${variantKey}:${partId}`;
}

export function characterSceneMotionAddress(
  target: ReturnType<typeof runtimeMotionTargetForSlot>,
): string {
  return target.kind === "bone" ? `bone:${target.boneId}` : `slot:${target.slotId}`;
}

interface AddSlotSceneNodesArgs {
  runtime: CharacterRuntime;
  slot: RuntimeCharacterSlot;
  poses: Record<string, string>;
  activeVariants: ReadonlyMap<string, string>;
  worldByBone: ReturnType<typeof runtimeBoneWorldTransforms>;
  scaleX: number;
  scaleY: number;
  nodes: Record<string, CharacterSceneNode>;
  addNode: (node: CharacterSceneNode) => void;
  boneNodeIds: Record<string, string>;
  slotNodeIds: Record<string, string>;
  partNodeIds: Record<string, string>;
  motionTargetsBySlotId: Record<string, CharacterSceneMotionTarget>;
  assetsById: Map<string, CharacterSceneAsset>;
  mediaAssets?: ReadonlyMap<string, Pick<MediaAsset, "filename" | "mimeType">>;
}

function addSlotSceneNodes(args: AddSlotSceneNodesArgs): void {
  const {
    runtime,
    slot,
    poses,
    activeVariants,
    worldByBone,
    scaleX,
    scaleY,
    addNode,
    boneNodeIds,
    slotNodeIds,
    partNodeIds,
    motionTargetsBySlotId,
    assetsById,
    mediaAssets,
  } = args;
  const visibleParts = slot.parts.filter((part) => part.visible);
  const activePart = resolveRuntimeSlotPart(slot, runtime, poses[slot.id]);
  if (!activePart) return;

  const binding = runtime.bindingBySlot.get(slot.id);
  const slotNodeId = characterSceneSlotNodeId(slot.id);
  const parentId = binding
    ? (boneNodeIds[binding.effectiveBoneId] ?? CHARACTER_SCENE_ROOT_NODE_ID)
    : CHARACTER_SCENE_ROOT_NODE_ID;
  const activeRegistration = registrationForPart(activePart);
  const drawOrder = slotDrawIndex(runtime.rig, slot.id, activePart.zIndex, runtime.angle);
  const defaultVariantKey = variantKeyForPart(activePart);
  const referencePart = binding ? (representativePart(slot) ?? activePart) : undefined;
  const runtimeTarget = runtimeMotionTargetForSlot(runtime, slot.id);
  const ancestorNodeIds = runtimeAncestorMotionTargets(runtime, slot.id).map((target) =>
    sceneNodeIdForRuntimeTarget(target, slot.id, boneNodeIds),
  );
  const variantNodeIds: Record<string, string[]> = {};

  addNode({
    id: slotNodeId,
    kind: "slot",
    parentId,
    childIds: [],
    slotId: slot.id,
    role: slot.role,
    side: slot.side,
    boneId: binding?.effectiveBoneId,
    depth: binding?.effectiveDepth ?? activePart.depth,
    drawOrder,
    defaultVariantKey,
    activePartId: activePart.id,
    basePartId: activePart.id,
    referencePartId: referencePart?.id,
    variantNodeIds,
    motionTargetNodeId: sceneNodeIdForRuntimeTarget(runtimeTarget, slot.id, boneNodeIds),
    ancestorMotionTargetNodeIds: ancestorNodeIds,
    frame: slotFrame(activePart, binding, scaleX, scaleY),
    visible: binding?.visible ?? true,
    opacity: 1,
    zIndex: drawOrder,
  });
  slotNodeIds[slot.id] = slotNodeId;

  motionTargetsBySlotId[slot.id] = {
    slotId: slot.id,
    nodeId: sceneNodeIdForRuntimeTarget(runtimeTarget, slot.id, boneNodeIds),
    address: characterSceneMotionAddress(runtimeTarget),
    runtimeTarget,
    ancestorNodeIds,
    pivot:
      runtimeTarget.kind === "bone"
        ? scaledPoint(worldByBone.get(runtimeTarget.boneId), scaleX, scaleY)
        : undefined,
  };

  for (const part of visibleParts) {
    const variantKey = variantKeyForPart(part);
    const nodeId = characterScenePartNodeId(slot.id, variantKey, part.id);
    const placement = runtimePartPlacement(slot, part, runtime, {
      basePart: activePart,
      activeVariants,
      worldByBone,
    });
    const partNode = buildPartNode({
      nodeId,
      slotNodeId,
      slot,
      part,
      activePart,
      variantKey,
      active: part.id === activePart.id,
      placement,
      bindingPresent: !!binding,
      scaleX,
      scaleY,
      runtime,
      boneNodeIds,
    });
    addNode(partNode);
    partNodeIds[part.id] = nodeId;
    for (const alias of variantAliasesForPart(part)) {
      (variantNodeIds[alias] ??= []).push(nodeId);
    }
    if (isTexturedPartNode(partNode)) {
      const asset = assetsById.get(partNode.assetId) ?? {
        id: partNode.assetId,
        ref: partNode.assetRef,
        kind: "texture",
        parser: sceneAssetParserForMedia(mediaAssets?.get(partNode.assetId)),
        partIds: [],
      };
      asset.partIds.push(part.id);
      if (asset.parser === "svg") {
        asset.rasterWidth = Math.max(
          asset.rasterWidth ?? 1,
          Math.ceil(partNode.frame.width * Math.abs(partNode.frame.scaleX || 1)),
        );
        asset.rasterHeight = Math.max(
          asset.rasterHeight ?? 1,
          Math.ceil(partNode.frame.height * Math.abs(partNode.frame.scaleY || 1)),
        );
      }
      assetsById.set(partNode.assetId, asset);
    }
  }
}

function isTexturedPartNode(
  node: CharacterSceneSpriteNode | CharacterSceneMeshNode | CharacterSceneVectorNode,
): node is CharacterSceneSpriteNode | CharacterSceneMeshNode {
  return node.kind === "sprite" || node.kind === "mesh";
}

function sceneAssetParserForMedia(
  asset: Pick<MediaAsset, "filename" | "mimeType"> | undefined,
): CharacterSceneAsset["parser"] {
  const mimeType = asset?.mimeType.trim().toLowerCase();
  const filename = asset?.filename.trim().toLowerCase();
  if (mimeType === "image/svg+xml" || filename?.endsWith(".svg")) return "svg";
  return "texture";
}

function buildPartNode(args: {
  nodeId: string;
  slotNodeId: string;
  slot: RuntimeCharacterSlot;
  part: CharacterPart;
  activePart: CharacterPart;
  variantKey: string;
  active: boolean;
  placement: RuntimePartPlacement;
  bindingPresent: boolean;
  scaleX: number;
  scaleY: number;
  runtime: CharacterRuntime;
  boneNodeIds: Record<string, string>;
}): CharacterSceneSpriteNode | CharacterSceneMeshNode | CharacterSceneVectorNode {
  const {
    nodeId,
    slotNodeId,
    slot,
    part,
    activePart,
    variantKey,
    active,
    placement,
    bindingPresent,
    scaleX,
    scaleY,
    runtime,
    boneNodeIds,
  } = args;
  const partRegistration = registrationForPart(part);
  const baseRegistration = registrationForPart(activePart);
  // Eyes and mouths are face builders, not joint attachments: their variants sit
  // at authored canvas offsets and must never be pivot-aligned onto a socket.
  const faceSlot = slot.role === "eye" || slot.role === "mouth";
  const offset =
    bindingPresent && !faceSlot
      ? pivotAlignedPartOffset(
          activePart,
          anchorPartForVariant(slot.parts, variantKey) ?? part,
          part,
        )
      : { x: part.x - activePart.x, y: part.y - activePart.y };
  const base = {
    id: nodeId,
    parentId: slotNodeId,
    childIds: [],
    slotId: slot.id,
    partId: part.id,
    role: part.role,
    variantKey,
    variantAliases: variantAliasesForPart(part),
    active,
    frame: frame(offset.x * scaleX, offset.y * scaleY, part.width * scaleX, part.height * scaleY, {
      originX: partRegistration.x * scaleX,
      originY: partRegistration.y * scaleY,
      rotation: partRegistration.rotation - baseRegistration.rotation,
    }),
    visible: part.visible,
    opacity: active ? 1 : 0,
    zIndex: part.zIndex - activePart.zIndex,
    placement: scalePlacement(placement, scaleX, scaleY),
  };

  if (part.morph?.primaryPath) {
    return {
      ...base,
      kind: "vector",
      path: part.morph.primaryPath,
      viewBox: part.morph.viewBox ?? `0 0 ${part.width} ${part.height}`,
      fill: part.morph.fill,
      stroke: part.morph.stroke,
      strokeWidth: part.morph.strokeWidth,
      strokeLinecap: part.morph.strokeLinecap,
      strokeLinejoin: part.morph.strokeLinejoin,
    };
  }

  const textured = {
    ...base,
    mediaId: part.mediaId,
    assetId: part.mediaId,
    assetRef: `asset:${part.mediaId}`,
  };

  if (part.deform?.mode === "limb-path") {
    const alpha = localAlphaBounds(part);
    const w = Math.max(1, part.width);
    const h = Math.max(1, part.height);
    const neutralDeform = defaultLimbPathDeformForPart(part);
    const solveInputs = limbPathSolveInputsForPart(part);
    const ropeWidth = neutralDeform.mode === "limb-path" ? neutralDeform.width : undefined;
    return {
      ...textured,
      kind: "mesh",
      meshKind: "rope",
      pathPoints: solveInputs?.basePoints ?? [],
      pathLockTs: solveInputs?.lockTs,
      pathAttachments: limbPathAttachments(part, slot, runtime, boneNodeIds),
      pathBendSide: solveInputs?.side,
      pathJointT: solveInputs?.jointT,
      ropeWidth: Math.max(1, ropeWidth ?? Math.min(alpha.width, alpha.height)),
      crossVertices: DEFAULT_LIMB_CROSS_VERTICES,
      // Map only the visible art across the ribbon so padding is not shown.
      uvRect: {
        u0: alpha.x / w,
        v0: alpha.y / h,
        u1: (alpha.x + alpha.width) / w,
        v1: (alpha.y + alpha.height) / h,
      },
      ribbonVertical: alpha.height >= alpha.width,
      // Ribbon geometry is in part-local px; carry the authoring size so the
      // runtime scales by it rather than the texture's intrinsic size.
      sourceWidth: w,
      sourceHeight: h,
    };
  }

  if (part.deform?.mode === "bend") {
    const stretchAxis: "x" | "y" = part.height >= part.width ? "y" : "x";
    const segments = Math.max(2, Math.round(part.deform.segments ?? DEFAULT_BEND_SEGMENTS));
    const alongVertices = segments + 1;
    // The joint stays where the artwork registers onto its bone; the far end
    // is the free end that curves.
    const registrationAlong = stretchAxis === "y" ? partRegistration.y : partRegistration.x;
    const partLength = stretchAxis === "y" ? part.height : part.width;
    return {
      ...textured,
      kind: "mesh",
      meshKind: "plane",
      verticesX: stretchAxis === "y" ? BEND_CROSS_VERTICES : alongVertices,
      verticesY: stretchAxis === "y" ? alongVertices : BEND_CROSS_VERTICES,
      stretchAxis,
      bendAnchor: registrationAlong <= partLength / 2 ? "start" : "end",
      bendOriginX: normalizedRegistration(partRegistration.x, part.width),
      bendOriginY: normalizedRegistration(partRegistration.y, part.height),
      bend: clampBendDegrees(part.deform.bend ?? 0),
    };
  }

  return {
    ...textured,
    kind: "sprite",
  };
}

function normalizedRegistration(value: number, size: number): number {
  const normalized = (Number(value) || 0) / Math.max(1, Number(size) || 1);
  return Math.max(0, Math.min(1, normalized));
}

function limbPathPoints(deform: Extract<CharacterPart["deform"], { mode: "limb-path" }>) {
  if (!deform) return [];
  const segments = Math.max(2, Math.round(deform.segments ?? DEFAULT_BEND_SEGMENTS));
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    if (!deform.curve) {
      points.push({
        x: deform.start.x + (deform.end.x - deform.start.x) * t,
        y: deform.start.y + (deform.end.y - deform.start.y) * t,
      });
      continue;
    }
    const inv = 1 - t;
    points.push({
      x: inv * inv * deform.start.x + 2 * inv * t * deform.curve.x + t * t * deform.end.x,
      y: inv * inv * deform.start.y + 2 * inv * t * deform.curve.y + t * t * deform.end.y,
    });
  }
  return points;
}

/**
 * Everything the limb solver needs for a flexible part, derived the same way
 * the scene build derives it: the neutral render spine (dense sampling), lock
 * ts, fold side, and joint t. Editors use this to draw the SOLVED spine —
 * what the runtime actually renders — instead of the raw control bezier.
 */
export function limbPathSolveInputsForPart(part: CharacterPart): {
  /** The neutral render spine — what the runtime actually deforms. */
  basePoints: Array<{ x: number; y: number }>;
  /**
   * The authored (possibly rig-fitted) control path at the same sampling
   * density. Editors draw THIS displaced by the solved deformation, so the
   * gizmo stays anchored to the user's rig alignment while bending exactly
   * like the runtime.
   */
  authoredPoints: Array<{ x: number; y: number }>;
  lockTs?: number[];
  side?: number;
  jointT?: number;
} | null {
  const deform = part.deform?.mode === "limb-path" ? part.deform : null;
  if (!deform) return null;
  const neutralDeform = defaultLimbPathDeformForPart(part);
  if (neutralDeform.mode !== "limb-path") return null;
  const controlPathPoints = limbPathPoints(deform);
  const renderSegments = Math.max(
    LIMB_PATH_RENDER_SEGMENTS,
    Math.round(deform.segments ?? DEFAULT_BEND_SEGMENTS),
  );
  return {
    basePoints: limbPathPoints({ ...neutralDeform, segments: renderSegments }),
    authoredPoints: limbPathPoints({ ...deform, segments: renderSegments }),
    lockTs: limbPathLockTs(deform, controlPathPoints),
    side: limbPathBendSide(deform),
    jointT: limbPathJointT(deform, controlPathPoints),
  };
}

/**
 * The fold direction for a limb: an explicit authored `side` wins; otherwise
 * the authored curve control point implies the natural side (which side of
 * the start→end chord it sits on, against the left-hand normal — matching the
 * runtime solver's pole convention). Undefined leaves the side to the
 * animated curve point, and end-only drags stay straight.
 */
export function limbPathBendSide(
  deform: Extract<CharacterPart["deform"], { mode: "limb-path" }>,
): number | undefined {
  if (deform.side === 1 || deform.side === -1) return deform.side;
  if (!deform.curve) return undefined;
  const dx = deform.end.x - deform.start.x;
  const dy = deform.end.y - deform.start.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.0001) return undefined;
  const px = -dy / len;
  const py = dx / len;
  const midX = (deform.start.x + deform.end.x) / 2;
  const midY = (deform.start.y + deform.end.y) / 2;
  const dot = (deform.curve.x - midX) * px + (deform.curve.y - midY) * py;
  // A curve point sitting on the chord carries no side information.
  if (Math.abs(dot) < 1) return undefined;
  return dot >= 0 ? 1 : -1;
}

/** Authored joint (elbow/knee) position projected onto the spine as t. */
function limbPathJointT(
  deform: Extract<CharacterPart["deform"], { mode: "limb-path" }>,
  points: Array<{ x: number; y: number }>,
): number | undefined {
  if (!deform.joint || points.length < 2) return undefined;
  const t = limbPathProjectPointT(points, deform.joint);
  return t > 0.02 && t < 0.98 ? t : undefined;
}

function limbPathLockTs(
  deform: Extract<CharacterPart["deform"], { mode: "limb-path" }>,
  points: Array<{ x: number; y: number }>,
) {
  const locks = deform?.locks ?? [];
  if (!locks.length || points.length < 2) return undefined;
  const ts = locks
    .map((lock) => limbPathProjectPointT(points, lock))
    .filter((value) => value > 0.001 && value < 0.999)
    .sort((a, b) => a - b);
  return ts.length ? ts : undefined;
}

function limbPathAttachments(
  part: CharacterPart,
  slot: RuntimeCharacterSlot,
  runtime: CharacterRuntime,
  boneNodeIds: Record<string, string>,
): CharacterSceneMeshPathAttachment[] | undefined {
  const deform = part.deform?.mode === "limb-path" ? part.deform : null;
  if (!deform) return undefined;
  const attachments = runtime.angleRig.bones.flatMap((bone) => {
    if (bone.restSource?.slotId !== slot.id) return [];
    const boneNodeId = boneNodeIds[bone.id];
    if (!boneNodeId) return [];
    const pin = part.pins?.[bone.restSource.pinName];
    const localPoint = pin ? { x: pin.x, y: pin.y } : deform.end;
    return [{ boneNodeId, localPoint }];
  });
  return attachments.length ? attachments : undefined;
}

function buildBoneAnchorTracks(
  runtime: CharacterRuntime,
  poses: Record<string, string>,
  scaleX: number,
  scaleY: number,
): Record<string, CharacterSceneBoneAnchorTrack> {
  const out: Record<string, CharacterSceneBoneAnchorTrack> = {};
  for (const bone of runtime.angleRig.bones) {
    const source = bone.restSource;
    if (!source) continue;
    const parentSlot = runtime.slotById.get(source.slotId);
    if (!parentSlot) continue;
    if (new Set(parentSlot.parts.map((part) => variantKeyForPart(part))).size <= 1) continue;

    const anchors: Record<string, CharacterSceneBoneVariantAnchor> = {};
    for (const part of parentSlot.parts) {
      const pin = part.pins?.[source.pinName];
      if (!pin) continue;
      const anchor = scaleAnchor(pinTransformInBoneSpace(part, pin, source.offset), scaleX, scaleY);
      anchors[variantKeyForPart(part)] = anchor;
      for (const alias of variantAliasesForPart(part)) anchors[alias] ??= anchor;
    }
    if (Object.keys(anchors).length === 0) continue;

    const base = scaleAnchor({ x: bone.x, y: bone.y, rotation: bone.rotation }, scaleX, scaleY);
    const initialPart = resolveRuntimeSlotPart(parentSlot, runtime, poses[parentSlot.id]);
    const initialKey = initialPart ? variantKeyForPart(initialPart) : undefined;
    out[bone.id] = {
      boneId: bone.id,
      parentSlotId: source.slotId,
      base,
      initial: (initialKey ? anchors[initialKey] : undefined) ?? base,
      anchors,
    };
  }
  return out;
}

function slotFrame(
  basePart: CharacterPart,
  binding: ReturnType<CharacterRuntime["bindingBySlot"]["get"]>,
  scaleX: number,
  scaleY: number,
): CharacterSceneFrame {
  const registration = registrationForPart(basePart);
  const left = binding ? binding.x - registration.x : basePart.x;
  const top = binding ? binding.y - registration.y : basePart.y;
  return frame(left * scaleX, top * scaleY, basePart.width * scaleX, basePart.height * scaleY, {
    originX: registration.x * scaleX,
    originY: registration.y * scaleY,
    rotation: binding ? binding.rotation + registration.rotation : registration.rotation,
    scaleX: binding?.scaleX ?? 1,
    scaleY: binding?.scaleY ?? 1,
  });
}

function frame(
  x: number,
  y: number,
  width: number,
  height: number,
  options: Partial<Omit<CharacterSceneFrame, "x" | "y" | "width" | "height">> = {},
): CharacterSceneFrame {
  return {
    x,
    y,
    width,
    height,
    originX: options.originX ?? 0,
    originY: options.originY ?? 0,
    rotation: options.rotation ?? 0,
    scaleX: options.scaleX ?? 1,
    scaleY: options.scaleY ?? 1,
  };
}

function activeVariantMap(
  runtime: CharacterRuntime,
  poses: Record<string, string>,
): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const slot of runtime.slots) {
    const activePart = resolveRuntimeSlotPart(slot, runtime, poses[slot.id]);
    if (activePart) out.set(slot.id, variantKeyForPart(activePart));
  }
  return out;
}

function sceneNodeIdForRuntimeTarget(
  target: ReturnType<typeof runtimeMotionTargetForSlot>,
  fallbackSlotId: string,
  boneNodeIds: Record<string, string>,
): string {
  if (target.kind === "bone") {
    return boneNodeIds[target.boneId] ?? characterSceneBoneNodeId(target.boneId);
  }
  return characterSceneSlotNodeId(target.slotId || fallbackSlotId);
}

function scaledPoint(
  point: { x: number; y: number } | undefined,
  scaleX: number,
  scaleY: number,
): { x: number; y: number } | undefined {
  return point ? { x: point.x * scaleX, y: point.y * scaleY } : undefined;
}

function scaleAnchor(
  anchor: { x: number; y: number; rotation: number },
  scaleX: number,
  scaleY: number,
): CharacterSceneBoneVariantAnchor {
  return { x: anchor.x * scaleX, y: anchor.y * scaleY, rotation: anchor.rotation };
}

function scalePlacement(
  placement: RuntimePartPlacement,
  scaleX: number,
  scaleY: number,
): CharacterScenePlacement {
  return {
    x: placement.x * scaleX,
    y: placement.y * scaleY,
    pivotX: placement.pivotX * scaleX,
    pivotY: placement.pivotY * scaleY,
    containerX: placement.containerX * scaleX,
    containerY: placement.containerY * scaleY,
    offsetX: placement.offsetX * scaleX,
    offsetY: placement.offsetY * scaleY,
    rotation: placement.rotation,
    scaleX: placement.scaleX,
    scaleY: placement.scaleY,
    depth: placement.depth,
    drawOrder: placement.drawOrder,
    basePartId: placement.basePart.id,
    referencePartId: placement.referencePart?.id,
  };
}

function boneZIndex(runtime: CharacterRuntime, boneId: string): number {
  const binding = Array.from(runtime.bindingBySlot.values()).find(
    (candidate) => candidate.effectiveBoneId === boneId,
  );
  return binding ? slotDrawIndex(runtime.rig, binding.slotId, 0, runtime.angle) : 0;
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value && value > 0 ? value : fallback;
}
