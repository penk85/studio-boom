import { generateHyperframesHtml } from "@hyperframes/core";
import type {
  CharacterClipMeta,
  CharacterPart,
  CharacterPreset,
  CharacterSlotRelation,
  MotionPreset,
  MouthPose,
  MouthViseme,
  PartRole,
  VisemeEntry,
} from "../types";
import { characterSpeeches } from "../types";
import { validateCompositionSourceHtml } from "../hyperframes/composition-source";
import { normalizeNativeHyperframesHtml } from "../hyperframes/native";
import {
  composeMotionsAt,
  deltaForBone,
  deltaForBoneOnly,
  deltaFor,
  emptyDelta,
  generateMotionOccurrences,
  motionAppliesToAngle,
  poseSwapFor,
} from "../presets/apply";
import {
  anchorPartForVariant,
  listCharacterSlots,
  partMatchesVariant,
  partsAvailableForAngle,
  pivotAlignedPartOffset,
  roleEnabledByManifest,
  variantAliasesForPart,
  variantKeyForPart,
  variantLabelForPart,
} from "./character-utils";
import { faceTurnMotionForPart } from "./face-turn";
import {
  autoBlinkPoseSwapAt,
  blinkWindowsForClip,
  eyeVariantsForSlot,
  resolveEyeState,
} from "./eye-state";
import {
  MOUTH_VIEWBOX,
  RIG_STYLES,
  VISEME_POSES,
  poseToTransforms,
  type RigTransforms,
} from "./mouth-libraries";
import {
  normalizeCharacterRig,
  representativePart,
  resolveSlotBinding,
  slotDrawIndex,
  type ResolvedSlotBinding,
} from "./rig";
import {
  buildMotionConstraintContext,
  childAnchorForVariant,
  parentSlotIdForBone,
  resolveMotionDelta,
  type MotionConstraintContext,
} from "./motion-constraints";

const VISEMES: MouthViseme[] = ["rest", "A", "E", "O", "U", "MBP", "FV", "L", "WQ", "Smile"];
const MOTION_SAMPLE_FPS = 12;

type CharacterSlotRef = ReturnType<typeof listCharacterSlots>[number];

interface NestedSlotChild {
  slot: CharacterSlotRef;
  relation: CharacterSlotRelation;
}

interface BuildCharacterCompositionArgs {
  compositionId: string;
  clipId: string;
  width: number;
  height: number;
  duration: number;
  character: CharacterPreset;
  meta: CharacterClipMeta;
  motionPresets: Map<string, MotionPreset>;
  /** Speeches placed on the character, resolved against their audio assets. Each
   *  emits an `<audio>` at its start and contributes offset visemes to the mouth.
   *  When omitted, falls back to the legacy single `meta.lipSyncAudioId`. */
  speeches?: ResolvedSpeech[];
  /** @deprecated Legacy single-speech length; superseded by `speeches`. */
  speechDuration?: number;
}

/** A speech resolved for the builder: audio ref + start + length + its viseme track. */
export interface ResolvedSpeech {
  audioId: string;
  start: number;
  duration: number;
  visemes: VisemeEntry[];
  /** Playback volume, 0–1 (default 1). */
  volume?: number;
  /** In-point into the source audio in seconds (trim start; default 0). */
  mediaStartTime?: number;
}

interface MotionTarget {
  kind: "slot" | "bone";
  id: string;
  selector: string;
  boneId?: string;
  slotId: string;
  role: PartRole;
  basePart?: CharacterPart;
  defaultVariantKey?: string;
  variantParts?: Record<string, CharacterPart>;
  /**
   * The binding's representative part for bone-bound variant slots. When present, variant art is
   * pivot-aligned to the joint, so motion transform origins must use the same placement math
   * instead of authored canvas offsets.
   */
  referencePart?: CharacterPart;
  baseRotation: number;
  baseAnchorX: number;
  baseAnchorY: number;
  depth?: number;
  /**
   * For bone targets whose rest rotation depends on the parent slot's active variant: motion
   * rotation vars are absolute, so the per-frame base must follow the variant or the first
   * motion tween would stomp the swap's rotation.
   */
  anchorParentSlotId?: string;
  anchorRotations?: Record<string, number>;
}

interface SlotTimeline {
  slotId: string;
  role: PartRole;
  hostSlotId?: string;
  defaultKey: string;
  render: SlotRenderStrategy;
}

interface VariantSlotRender {
  kind: "variant";
  variants: Record<string, string[]>;
}

interface GeneratedMouthSlotRender {
  kind: "generatedMouth";
  componentIds: {
    upperLip: string;
    lowerLip: string;
    interior: string;
    teeth: string;
    tongue: string;
  };
  visemeVars: Partial<Record<MouthViseme, GeneratedMouthTimelineVars>>;
}

type SlotRenderStrategy = VariantSlotRender | GeneratedMouthSlotRender;

interface GeneratedMouthTimelineVars {
  upperLip: GsapVars;
  lowerLip: GsapVars;
  interior: GsapVars;
  teeth: GsapVars;
  tongue: GsapVars;
}

interface GsapVars {
  x?: number;
  y?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  skewX?: number;
  skewY?: number;
  rotation?: number;
  rotationX?: number;
  rotationY?: number;
  transformPerspective?: number;
  opacity?: number;
  transformOrigin?: string;
}

interface PuppetDom {
  html: string[];
  motionTargets: MotionTarget[];
  slotTimelines: SlotTimeline[];
  boneAnchorTimelines: BoneAnchorTimeline[];
}

/**
 * A child bone whose rest anchor depends on its parent slot's active variant (a bent arm carries
 * the hand, and may angle it). Values are stage-scaled CSS left/top plus the bone's absolute
 * rest rotation in degrees, keyed by every alias of each parent variant.
 */
interface BoneAnchorTimeline {
  parentSlotId: string;
  selector: string;
  boneId: string;
  base: { left: number; top: number; rotation: number };
  /** Rest anchor under the initially active parent variant — the baked style left/top/rotate. */
  initial: { left: number; top: number; rotation: number };
  anchors: Record<string, { left: number; top: number; rotation: number }>;
}

export function defaultCharacterCompositionId(clipId: string): string {
  return `char_${clipId}`;
}

export function characterAssetIds(
  character: CharacterPreset | null | undefined,
  meta?: CharacterClipMeta,
): Set<string> {
  const ids = new Set<string>();
  if (character) {
    for (const part of character.parts) ids.add(part.mediaId);
    for (const variant of character.headVariants ?? []) ids.add(variant.mediaId);
    for (const variant of character.variantPackages ?? []) {
      for (const layer of variant.artwork?.layers ?? []) {
        if (layer.mediaId) ids.add(layer.mediaId);
      }
    }
  }
  for (const speech of characterSpeeches(meta)) ids.add(speech.audioId);
  return ids;
}

export function buildCharacterCompositionHtml(args: BuildCharacterCompositionArgs): string {
  const width = positiveNumber(args.width, 1);
  const height = positiveNumber(args.height, 1);
  const duration = positiveNumber(args.duration, 0.1);
  const resolution = width >= height ? "landscape" : "portrait";
  const baseHtml = generateHyperframesHtml([], duration, {
    compositionId: args.compositionId,
    resolution,
    includeStyles: true,
    includeScripts: true,
  });

  const doc = parseCompositionBase(baseHtml, args.compositionId, duration, width, height);
  const stage = ensureStage(doc, args.compositionId, duration, width, height);
  const scaleX = width / Math.max(1, args.character.canvasWidth);
  const scaleY = height / Math.max(1, args.character.canvasHeight);
  const characterRig = normalizeCharacterRig(args.character);
  const dom = buildPuppetDom(args.character, characterRig, args.meta, scaleX, scaleY);

  stage.innerHTML = "";
  stage.insertAdjacentHTML("beforeend", dom.html.join("\n"));

  // Each speech becomes its own <audio> at its start (clamped to the clip), and
  // contributes its visemes offset by that start to a combined mouth track.
  const { audioSpeeches, combinedVisemes } = resolveSpeechTimeline(args, duration);
  audioSpeeches.forEach((speech, index) => {
    // Each speech is its own timeline clip on its own track lane (HyperFrames
    // assigns a distinct data-track-index per clip).
    stage.insertAdjacentHTML(
      "beforeend",
      buildSpeechAudio(
        `${args.compositionId}-speech-${index}`,
        speech.audioId,
        speech.start,
        speech.duration,
        index,
        speech.volume,
        speech.mediaStart,
      ),
    );
  });
  const effectiveMeta: CharacterClipMeta = {
    ...args.meta,
    visemes: [...combinedVisemes].sort((a, b) => a.t - b.t),
  };

  appendCharacterStyles(doc);
  appendCharacterTimelineScript(doc, {
    compositionId: args.compositionId,
    clipId: args.clipId,
    duration,
    scaleX,
    scaleY,
    meta: effectiveMeta,
    motionPresets: args.motionPresets,
    motionTargets: dom.motionTargets,
    canvasWidth: args.character.canvasWidth,
    canvasHeight: args.character.canvasHeight,
    slotTimelines: dom.slotTimelines,
    boneAnchorTimelines: dom.boneAnchorTimelines,
    constraintContext: buildMotionConstraintContext({
      reaches: characterRig.reaches,
      variantPackages: args.character.variantPackages,
      parts: args.character.parts,
    }),
    activeAngle: characterRig.activeAngle,
    parentBoneIds: new Set(
      characterRig.bones.map((bone) => bone.parentId).filter((id): id is string => !!id),
    ),
  });

  const normalized = normalizeNativeHyperframesHtml(
    "<!DOCTYPE html>\n" + doc.documentElement.outerHTML,
    {
      width,
      height,
    },
  );
  const validation = validateCompositionSourceHtml(normalized, {
    compositionId: args.compositionId,
    duration,
    width,
    height,
  });
  if (!validation.ok || !validation.html) {
    throw new Error(
      `Generated character composition is invalid:\n${validation.errors
        .map((error) => `- ${error}`)
        .join("\n")}`,
    );
  }
  return validation.html;
}

function parseCompositionBase(
  html: string,
  compositionId: string,
  duration: number,
  width: number,
  height: number,
): Document {
  if (typeof DOMParser === "undefined") {
    throw new Error("DOMParser is required to build character compositions.");
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.documentElement;
  root.setAttribute("data-composition-id", compositionId);
  root.setAttribute("data-composition-duration", String(duration));
  root.setAttribute("data-composition-width", String(width));
  root.setAttribute("data-composition-height", String(height));
  root.setAttribute("data-width", String(width));
  root.setAttribute("data-height", String(height));
  root.setAttribute("data-resolution", width >= height ? "landscape" : "portrait");
  if (doc.body) {
    doc.body.style.margin = "0";
    doc.body.style.overflow = "hidden";
    doc.body.style.background = "transparent";
  }
  return doc;
}

function ensureStage(
  doc: Document,
  compositionId: string,
  duration: number,
  width: number,
  height: number,
): HTMLElement {
  let stage = doc.getElementById("stage") as HTMLElement | null;
  if (!stage) {
    stage = doc.createElement("div");
    stage.id = "stage";
    doc.body?.appendChild(stage);
  }
  stage.setAttribute("data-composition-id", compositionId);
  stage.setAttribute("data-start", "0");
  stage.setAttribute("data-duration", String(duration));
  stage.setAttribute("data-width", String(width));
  stage.setAttribute("data-height", String(height));
  stage.removeAttribute("data-track-index");
  stage.style.position = "relative";
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  stage.style.overflow = "hidden";
  stage.style.background = "transparent";
  return stage;
}

function appendCharacterStyles(doc: Document): void {
  const style = doc.createElement("style");
  style.textContent = `
[data-character-root] {
  position: absolute;
  inset: 0;
  overflow: visible;
  pointer-events: none;
}
[data-character-bone] {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  overflow: visible;
  pointer-events: none;
  transform-origin: 0 0;
  will-change: transform;
}
[data-character-slot] {
  position: absolute;
  overflow: visible;
  pointer-events: none;
  will-change: transform, opacity;
}
[data-character-part] {
  position: absolute;
  display: block;
  pointer-events: none;
  user-select: none;
  max-width: none;
  max-height: none;
  will-change: transform, opacity;
}
[data-character-generated-mouth-component] {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  transform-origin: 50% 50%;
  will-change: transform, opacity;
}`;
  doc.head?.appendChild(style);
}

function buildPuppetDom(
  character: CharacterPreset,
  rig: ReturnType<typeof normalizeCharacterRig>,
  meta: CharacterClipMeta,
  scaleX: number,
  scaleY: number,
): PuppetDom {
  const out: PuppetDom = {
    html: [
      `<div data-character-root="true" data-character-id="${esc(
        character.id,
      )}" data-character-rig-version="${esc(rig.version)}" data-character-angle="${esc(
        rig.activeAngle,
      )}">`,
    ],
    motionTargets: [],
    slotTimelines: [],
    boneAnchorTimelines: [],
  };
  const slotHtmlByBone = new Map<string, string[]>();
  const slotTargets: MotionTarget[] = [];
  const boneTargets: MotionTarget[] = [];

  const slots = listCharacterSlots(partsAvailableForAngle(character.parts, rig.activeAngle)).filter(
    (slot) => roleEnabledByManifest(slot.role, character.manifest),
  );
  const hasMouthSlot = slots.some(
    (slot) => slot.role === "mouth" && slot.parts.some((p) => p.visible),
  );
  const appendCapturedSlotToBone = (boneId: string, render: () => void): MotionTarget[] => {
    const beforeHtml = out.html.length;
    const beforeTargets = out.motionTargets.length;
    render();
    const chunks = out.html.splice(beforeHtml);
    const newTargets = out.motionTargets.splice(beforeTargets);
    slotHtmlByBone.set(boneId, [...(slotHtmlByBone.get(boneId) ?? []), ...chunks]);
    for (const target of newTargets) target.boneId ??= boneId;
    slotTargets.push(...newTargets);
    return newTargets;
  };

  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const nestedSlotIds = new Set<string>();
  const nestedChildrenByParentSlotId = new Map<string, NestedSlotChild[]>();
  for (const relation of rig.slotRelations ?? []) {
    if (relation.renderMode !== "nested") continue;
    if (relation.characterViewIds?.length && !relation.characterViewIds.includes(rig.activeAngle))
      continue;
    const childSlot = slotById.get(relation.childSlotId);
    const parentSlotId = parentSlotIdForRelation(relation, slots);
    if (!childSlot || !parentSlotId || !slotById.has(parentSlotId)) continue;
    nestedSlotIds.add(childSlot.id);
    nestedChildrenByParentSlotId.set(parentSlotId, [
      ...(nestedChildrenByParentSlotId.get(parentSlotId) ?? []),
      { slot: childSlot, relation },
    ]);
  }

  for (const slot of slots) {
    if (nestedSlotIds.has(slot.id)) continue;
    const binding = resolveSlotBinding(rig, slot.id);
    if (binding && !binding.visible) continue;
    const boneId = binding?.effectiveBoneId ?? "bone:root";
    const newTargets = appendCapturedSlotToBone(boneId, () => {
      buildSlotByRole(
        out,
        character,
        slot,
        meta.poses,
        scaleX,
        scaleY,
        binding,
        rig,
        nestedChildrenByParentSlotId,
      );
    });
    if (binding && newTargets[0]) {
      boneTargets.push(boneTargetForSlotTarget(newTargets[0], binding));
    }
  }

  const generatedMouthBoneId = defaultGeneratedMouthBoneId(rig);
  if (!hasMouthSlot && character.mouthRig && character.mouthStyle !== "images") {
    appendCapturedSlotToBone(generatedMouthBoneId, () => {
      buildGeneratedMouthSlot(
        out,
        character,
        character.mouthRig.placement,
        "role:mouth",
        scaleX,
        scaleY,
        undefined,
        rig,
        generatedMouthBoneId,
      );
    });
  } else if (!hasMouthSlot && !character.mouthRig && character.fallbackMouth) {
    appendCapturedSlotToBone(generatedMouthBoneId, () => {
      buildFallbackMouthRig(out, character, scaleX, scaleY, generatedMouthBoneId);
    });
  }

  out.boneAnchorTimelines = buildBoneAnchorTimelines(rig, slotById, meta.poses, scaleX, scaleY);
  renderBoneTree(out.html, rig, slotHtmlByBone, scaleX, scaleY, out.boneAnchorTimelines);
  out.motionTargets.push(...uniqueMotionTargets([...slotTargets, ...boneTargets]));
  // Bone targets whose rest rotation follows the parent variant: hand the motion builder the
  // per-key rotations so its absolute rotation vars track the active variant frame by frame.
  const anchorByBoneId = new Map(out.boneAnchorTimelines.map((entry) => [entry.boneId, entry]));
  for (const target of out.motionTargets) {
    if (target.kind !== "bone" || !target.boneId) continue;
    const entry = anchorByBoneId.get(target.boneId);
    if (!entry) continue;
    const rotations = Object.fromEntries(
      Object.entries(entry.anchors).map(([key, anchor]) => [key, anchor.rotation]),
    );
    if (Object.values(rotations).every((rotation) => rotation === entry.base.rotation)) continue;
    target.anchorParentSlotId = entry.parentSlotId;
    target.anchorRotations = rotations;
    target.baseRotation = entry.base.rotation;
  }
  out.html.push("</div>");
  return out;
}

/**
 * Collect the bones whose rest anchor follows their parent slot's active variant. Anchor values
 * are stage-scaled and expanded to every alias of each parent variant part, so timeline slot
 * states (which may use pose/viseme/id aliases) resolve to the same anchor as canonical keys.
 */
function buildBoneAnchorTimelines(
  rig: ReturnType<typeof normalizeCharacterRig>,
  slotById: Map<string, CharacterSlotRef>,
  poses: Record<string, string>,
  scaleX: number,
  scaleY: number,
): BoneAnchorTimeline[] {
  const out: BoneAnchorTimeline[] = [];
  for (const bone of rig.bones) {
    if (!bone.parentVariantAnchors || Object.keys(bone.parentVariantAnchors).length === 0) continue;
    const parentSlotId = parentSlotIdForBone(rig, bone.id);
    const parentSlot = parentSlotId ? slotById.get(parentSlotId) : undefined;
    if (!parentSlotId || !parentSlot) continue;
    const anchors: Record<string, { left: number; top: number; rotation: number }> = {};
    const scaled = (anchor: { x: number; y: number; rotation?: number }) => ({
      left: anchor.x * scaleX,
      top: anchor.y * scaleY,
      rotation: anchor.rotation ?? bone.rotation,
    });
    for (const [key, anchor] of Object.entries(bone.parentVariantAnchors)) {
      anchors[key] = scaled(anchor);
    }
    for (const part of parentSlot.parts) {
      const canonical = variantKeyForPart(part);
      const anchor = bone.parentVariantAnchors[canonical];
      if (!anchor) continue;
      for (const alias of variantAliasesForPart(part)) anchors[alias] ??= scaled(anchor);
    }
    const base = { left: bone.x * scaleX, top: bone.y * scaleY, rotation: bone.rotation };
    const initialPart = resolveActiveSlotPart(
      parentSlot,
      poses,
      resolveSlotBinding(rig, parentSlotId),
      rig,
    );
    const initialKey = initialPart ? variantKeyForPart(initialPart) : undefined;
    out.push({
      parentSlotId,
      selector: `#${boneElementId(bone.id)}`,
      boneId: bone.id,
      base,
      initial: (initialKey ? anchors[initialKey] : undefined) ?? base,
      anchors,
    });
  }
  return out;
}

function defaultGeneratedMouthBoneId(rig: ReturnType<typeof normalizeCharacterRig>): string {
  return (
    rig.bones.find((bone) => bone.role === "head")?.id ??
    rig.bones.find((bone) => bone.role === "body")?.id ??
    "bone:root"
  );
}

function renderBoneTree(
  html: string[],
  rig: ReturnType<typeof normalizeCharacterRig>,
  slotHtmlByBone: Map<string, string[]>,
  scaleX: number,
  scaleY: number,
  boneAnchorTimelines: BoneAnchorTimeline[] = [],
): void {
  const anchorsBySelector = new Map(boneAnchorTimelines.map((entry) => [entry.selector, entry]));
  const byParent = new Map<string, typeof rig.bones>();
  for (const bone of rig.bones) {
    const parent = bone.parentId ?? "__root__";
    byParent.set(parent, [...(byParent.get(parent) ?? []), bone]);
  }
  const renderBone = (bone: (typeof rig.bones)[number]) => {
    const rotation = bone.rotation;
    const depth = bone.depth ?? 0;
    const id = boneElementId(bone.id);
    const anchorEntry = anchorsBySelector.get(`#${id}`);
    html.push(
      `<div id="${esc(id)}" data-character-bone="true" data-character-bone-id="${esc(bone.id)}"${
        bone.parentId ? ` data-character-parent-bone-id="${esc(bone.parentId)}"` : ""
      } data-character-role="${esc(bone.role)}" data-character-depth="${esc(
        depth,
      )}" data-character-draw-order-index="${esc(boneZIndex(rig, bone.id))}"${
        anchorEntry
          ? ` data-character-variant-anchors="${esc(
              JSON.stringify({ base: anchorEntry.base, anchors: anchorEntry.anchors }),
            )}"`
          : ""
      } style="${esc(
        styleString({
          left: anchorEntry ? anchorEntry.initial.left : bone.x * scaleX,
          top: anchorEntry ? anchorEntry.initial.top : bone.y * scaleY,
          "z-index": boneZIndex(rig, bone.id),
          transform: `rotate(${anchorEntry ? anchorEntry.initial.rotation : rotation}deg)`,
        }),
      )}">`,
    );
    for (const chunk of slotHtmlByBone.get(bone.id) ?? []) html.push(chunk);
    for (const child of byParent.get(bone.id) ?? []) renderBone(child);
    html.push("</div>");
  };
  const roots = byParent.get("__root__") ?? [];
  for (const root of roots) renderBone(root);
  for (const [boneId, chunks] of slotHtmlByBone.entries()) {
    if (rig.bones.some((bone) => bone.id === boneId)) continue;
    html.push(...chunks);
  }
}

function boneTargetForSlotTarget(
  target: MotionTarget,
  binding: ResolvedSlotBinding | undefined,
): MotionTarget {
  if (!binding) return target;
  return {
    ...target,
    kind: "bone",
    id: boneElementId(binding.effectiveBoneId),
    selector: `#${boneElementId(binding.effectiveBoneId)}`,
    boneId: binding.effectiveBoneId,
    baseRotation: 0,
    baseAnchorX: 0,
    baseAnchorY: 0,
    depth: binding.effectiveDepth,
  };
}

function uniqueMotionTargets(targets: MotionTarget[]): MotionTarget[] {
  const out = new Map<string, MotionTarget>();
  for (const target of targets) {
    if (!out.has(target.selector)) out.set(target.selector, target);
  }
  return Array.from(out.values());
}

function boneZIndex(rig: ReturnType<typeof normalizeCharacterRig>, boneId: string): number {
  const binding = rig.slotBindings.find((candidate) => candidate.boneId === boneId);
  return binding ? slotDrawIndex(rig, binding.slotId, 0) : 0;
}

function boneElementId(boneId: string): string {
  return `char-bone-${safeId(boneId)}`;
}

function lipSyncOwnsMouth(meta: CharacterClipMeta): boolean {
  return !!meta.visemes?.length;
}

function buildSlotByRole(
  out: PuppetDom,
  character: CharacterPreset,
  slot: CharacterSlotRef,
  poses: Record<string, string>,
  scaleX: number,
  scaleY: number,
  binding: ResolvedSlotBinding | undefined,
  rig: ReturnType<typeof normalizeCharacterRig>,
  nestedChildrenByParentSlotId: Map<string, NestedSlotChild[]>,
  hostPart?: CharacterPart,
): void {
  if (slot.role === "eye")
    buildEyeSlot(
      out,
      character,
      slot,
      poses,
      scaleX,
      scaleY,
      binding,
      rig,
      nestedChildrenByParentSlotId,
      hostPart,
    );
  else if (slot.role === "mouth")
    buildMouthSlot(
      out,
      character,
      slot,
      poses,
      scaleX,
      scaleY,
      binding,
      rig,
      nestedChildrenByParentSlotId,
      hostPart,
    );
  else
    buildGenericSlot(
      out,
      character,
      slot,
      poses,
      scaleX,
      scaleY,
      binding,
      rig,
      nestedChildrenByParentSlotId,
      hostPart,
    );
}

function renderNestedChildrenForPart(
  out: PuppetDom,
  character: CharacterPreset,
  parentSlotId: string,
  parentPart: CharacterPart,
  poses: Record<string, string>,
  scaleX: number,
  scaleY: number,
  rig: ReturnType<typeof normalizeCharacterRig>,
  nestedChildrenByParentSlotId: Map<string, NestedSlotChild[]>,
): string {
  const children = nestedChildrenByParentSlotId.get(parentSlotId) ?? [];
  if (children.length === 0) return "";
  return children
    .filter(({ relation }) => relationActiveForParentPart(relation, parentPart))
    .map(({ slot }) => {
      const beforeHtml = out.html.length;
      const binding = resolveSlotBinding(rig, slot.id);
      if (binding && !binding.visible) return "";
      buildSlotByRole(
        out,
        character,
        slot,
        poses,
        scaleX,
        scaleY,
        binding,
        rig,
        nestedChildrenByParentSlotId,
        parentPart,
      );
      return out.html.splice(beforeHtml).join("");
    })
    .join("");
}

function relationActiveForParentPart(relation: CharacterSlotRelation, parentPart: CharacterPart) {
  const gate = relation.activeWhenParentVariant;
  if (!gate?.keys?.length && !gate?.partIds?.length) return true;
  if (gate.partIds?.includes(parentPart.id)) return true;
  return variantAliasesForPart(parentPart).some((value) => gate.keys?.includes(value));
}

function parentSlotIdForRelation(
  relation: CharacterSlotRelation,
  slots: CharacterSlotRef[],
): string | undefined {
  if (relation.parentRef.type === "slot" || relation.parentRef.type === "semanticSlot") {
    return relation.parentRef.id;
  }
  if (relation.parentRef.type === "role") {
    return slots.find(
      (slot) =>
        slot.role === relation.parentRef.role &&
        (!relation.parentRef.side ||
          slot.parts.some((part) => part.side === relation.parentRef.side)),
    )?.id;
  }
  return undefined;
}

function buildEyeSlot(
  out: PuppetDom,
  character: CharacterPreset,
  slot: CharacterSlotRef,
  poses: Record<string, string>,
  scaleX: number,
  scaleY: number,
  binding: ResolvedSlotBinding | undefined,
  rig: ReturnType<typeof normalizeCharacterRig>,
  nestedChildrenByParentSlotId: Map<string, NestedSlotChild[]>,
  hostPart?: CharacterPart,
): void {
  const variants = eyeVariantsForSlot(slot);
  const anglePart = binding?.effectivePartId
    ? slot.parts.find((part) => part.id === binding.effectivePartId)
    : undefined;
  const openVariant = variants.find((variant) => variant.state === "open");
  const basePart = anglePart ?? openVariant?.part ?? variants[0]?.part;
  if (!basePart) return;

  const containerId = slotContainerId(slot.id);
  const variantIds: Record<string, string[]> = {};
  const variantParts: Record<string, CharacterPart> = {};
  const activeState =
    (anglePart ? variantKeyForPart(anglePart) : undefined) ??
    openVariant?.state ??
    variants[0].state;
  out.html.push(
    openSlotContainerForPart(containerId, slot, basePart, scaleX, scaleY, binding, rig, hostPart),
  );
  for (const { state, part } of variants) {
    const id = partElementId(slot.id, state, part.id);
    for (const key of unique([state, ...variantAliasesForPart(part)])) {
      addVariantElement(variantIds, key, id);
      variantParts[key] = part;
    }
    const children = renderNestedChildrenForPart(
      out,
      character,
      slot.id,
      part,
      poses,
      scaleX,
      scaleY,
      rig,
      nestedChildrenByParentSlotId,
    );
    out.html.push(
      renderPartElement(
        id,
        part,
        basePart,
        part.id === anglePart?.id || state === activeState,
        scaleX,
        scaleY,
        children,
      ),
    );
  }
  out.html.push("</div>");
  out.motionTargets.push({
    ...motionTargetFor(containerId, slot, basePart, binding?.effectiveBoneId),
    defaultVariantKey: activeState,
    variantParts,
  });
  out.slotTimelines.push({
    slotId: slot.id,
    role: slot.role,
    hostSlotId: hostSlotIdFor(rig, slot.id),
    defaultKey: activeState,
    render: {
      kind: "variant",
      variants: variantIds,
    },
  });
}

function buildMouthSlot(
  out: PuppetDom,
  character: CharacterPreset,
  slot: CharacterSlotRef,
  poses: Record<string, string>,
  scaleX: number,
  scaleY: number,
  binding: ResolvedSlotBinding | undefined,
  rig: ReturnType<typeof normalizeCharacterRig>,
  nestedChildrenByParentSlotId: Map<string, NestedSlotChild[]>,
  hostPart?: CharacterPart,
): void {
  if (character.mouthRig && character.mouthStyle === "rig") {
    buildGeneratedMouthSlot(
      out,
      character,
      character.mouthRig.placement,
      slot.id,
      scaleX,
      scaleY,
      binding,
      rig,
    );
    return;
  }

  const visibleParts = slot.parts.filter((part) => part.visible);
  const anglePart = binding?.effectivePartId
    ? visibleParts.find((part) => part.id === binding.effectivePartId)
    : undefined;
  const restPart =
    anglePart ?? visibleParts.find((part) => partMatchesVariant(part, "rest")) ?? visibleParts[0];
  if (!restPart) return;

  const containerId = slotContainerId(slot.id);
  const variants: Record<string, string[]> = {};
  const variantParts: Record<string, CharacterPart> = {};
  const renderedIds = new Set<string>();
  out.html.push(
    openSlotContainerForPart(containerId, slot, restPart, scaleX, scaleY, binding, rig, hostPart),
  );
  for (const viseme of VISEMES) {
    const part = visibleParts.find((candidate) => partMatchesVariant(candidate, viseme));
    if (!part) continue;
    const id = partElementId(slot.id, viseme, part.id);
    for (const key of unique([viseme, ...variantAliasesForPart(part)])) {
      addVariantElement(variants, key, id);
      variantParts[key] = part;
    }
    renderedIds.add(id);
    const children = renderNestedChildrenForPart(
      out,
      character,
      slot.id,
      part,
      poses,
      scaleX,
      scaleY,
      rig,
      nestedChildrenByParentSlotId,
    );
    out.html.push(
      renderPartElement(id, part, restPart, viseme === "rest", scaleX, scaleY, children),
    );
  }
  for (const part of visibleParts) {
    const key = variantKeyForPart(part);
    const id = partElementId(slot.id, key, part.id);
    for (const alias of variantAliasesForPart(part)) {
      addVariantElement(variants, alias, id);
      variantParts[alias] = part;
    }
    if (renderedIds.has(id)) continue;
    renderedIds.add(id);
    const children = renderNestedChildrenForPart(
      out,
      character,
      slot.id,
      part,
      poses,
      scaleX,
      scaleY,
      rig,
      nestedChildrenByParentSlotId,
    );
    out.html.push(
      renderPartElement(id, part, restPart, part === restPart, scaleX, scaleY, children),
    );
  }
  out.html.push("</div>");
  out.motionTargets.push({
    ...motionTargetFor(containerId, slot, restPart, binding?.effectiveBoneId),
    defaultVariantKey: "rest",
    variantParts,
  });
  out.slotTimelines.push({
    slotId: slot.id,
    role: slot.role,
    hostSlotId: hostSlotIdFor(rig, slot.id),
    defaultKey: "rest",
    render: {
      kind: "variant",
      variants,
    },
  });
}

function buildGeneratedMouthSlot(
  out: PuppetDom,
  character: CharacterPreset,
  placement:
    | NonNullable<CharacterPreset["fallbackMouth"]>
    | NonNullable<CharacterPreset["mouthRig"]>["placement"],
  slotId: string,
  scaleX: number,
  scaleY: number,
  binding?: ResolvedSlotBinding,
  rig?: ReturnType<typeof normalizeCharacterRig>,
  boundBoneId?: string,
): void {
  const mouthRig = character.mouthRig;
  if (!mouthRig) return;
  const rigStyle = RIG_STYLES.find((style) => style.id === mouthRig.styleId) ?? RIG_STYLES[0];
  const containerId = slotContainerId(slotId);
  const safeSlot = safeId(slotId);
  const componentIds = {
    upperLip: `char-generated-mouth-${safeSlot}-upper-lip`,
    lowerLip: `char-generated-mouth-${safeSlot}-lower-lip`,
    interior: `char-generated-mouth-${safeSlot}-interior`,
    teeth: `char-generated-mouth-${safeSlot}-teeth`,
    tongue: `char-generated-mouth-${safeSlot}-tongue`,
  };
  const drawIndex = rig ? slotDrawIndex(rig, slotId, placement.zIndex) : placement.zIndex;
  const style = styleString({
    left: (binding?.x ?? placement.x) * scaleX,
    top: (binding?.y ?? placement.y) * scaleY,
    width: placement.width * scaleX,
    height: placement.height * scaleY,
    "z-index": drawIndex,
    "transform-origin": "50% 50%",
    transform: `rotate(${binding?.rotation ?? 0}deg) scale(${binding?.scaleX ?? 1}, ${
      binding?.scaleY ?? 1
    })`,
  });
  out.html.push(
    `<div id="${esc(containerId)}" data-character-slot="true" data-character-slot-id="${esc(
      slotId,
    )}" data-character-role="mouth" data-character-generated-mouth="true"${
      binding || boundBoneId
        ? ` data-character-bound-bone-id="${esc(binding?.effectiveBoneId ?? boundBoneId ?? "")}"`
        : ""
    } data-character-depth="${esc(binding?.effectiveDepth ?? ("depth" in placement ? placement.depth : 0))}" data-character-draw-order-index="${esc(
      drawIndex,
    )}" style="${esc(style)}">`,
  );
  out.html.push(
    renderGeneratedMouthComponent(
      componentIds.interior,
      "interior",
      rigStyle.interiorPath,
      mouthRig.interiorColor,
    ),
  );
  out.html.push(
    renderGeneratedMouthComponent(
      componentIds.tongue,
      "tongue",
      rigStyle.tonguePath,
      mouthRig.tongueColor,
      0,
    ),
  );
  out.html.push(
    renderGeneratedMouthComponent(
      componentIds.teeth,
      "teeth",
      rigStyle.teethPath,
      mouthRig.teethColor,
      0,
    ),
  );
  out.html.push(
    renderGeneratedMouthComponent(
      componentIds.lowerLip,
      "lower-lip",
      rigStyle.lowerLipPath,
      mouthRig.lipColor,
    ),
  );
  out.html.push(
    renderGeneratedMouthComponent(
      componentIds.upperLip,
      "upper-lip",
      rigStyle.upperLipPath,
      mouthRig.lipColor,
    ),
  );
  out.html.push("</div>");
  const targetPart = generatedMouthMotionTargetPart(slotId, placement);
  out.motionTargets.push({
    kind: "slot",
    id: containerId,
    selector: `#${containerId}`,
    slotId,
    role: "mouth",
    basePart: targetPart,
    baseRotation: targetPart.rotation,
    baseAnchorX: targetPart.anchorX,
    baseAnchorY: targetPart.anchorY,
  });
  out.slotTimelines.push({
    slotId,
    role: "mouth",
    defaultKey: "rest",
    render: {
      kind: "generatedMouth",
      componentIds,
      visemeVars: Object.fromEntries(
        VISEMES.map((viseme) => [
          viseme,
          generatedMouthVarsForPose(
            mouthRig.poses[viseme] ?? mouthRig.poses.rest ?? VISEME_POSES[viseme],
            rigStyle,
            mouthRig,
          ),
        ]),
      ),
    },
  });
}

function buildFallbackMouthRig(
  out: PuppetDom,
  character: CharacterPreset,
  scaleX: number,
  scaleY: number,
  boundBoneId: string,
): void {
  const placement = character.fallbackMouth;
  if (!placement) return;
  const rigStyle = RIG_STYLES[0];
  const slotId = "fallback:mouth";
  const containerId = slotContainerId(slotId);
  const componentIds = {
    upperLip: "char-fallback-mouth-upper-lip",
    lowerLip: "char-fallback-mouth-lower-lip",
    interior: "char-fallback-mouth-interior",
    teeth: "char-fallback-mouth-teeth",
    tongue: "char-fallback-mouth-tongue",
  };
  out.html.push(
    `<div id="${esc(containerId)}" data-character-slot="true" data-character-slot-id="${esc(
      slotId,
    )}" data-character-role="mouth" data-character-generated-mouth="fallback" data-character-bound-bone-id="${esc(
      boundBoneId,
    )}" data-character-depth="${esc("depth" in placement ? placement.depth : 0)}" data-character-draw-order-index="${esc(
      placement.zIndex,
    )}" style="${esc(
      styleString({
        left: placement.x * scaleX,
        top: placement.y * scaleY,
        width: placement.width * scaleX,
        height: placement.height * scaleY,
        "z-index": placement.zIndex,
        "transform-origin": `${placement.anchorX * 100}% ${placement.anchorY * 100}%`,
        transform: `rotate(${placement.rotation}deg)`,
      }),
    )}">`,
  );
  out.html.push(
    renderGeneratedMouthComponent(
      componentIds.interior,
      "interior",
      rigStyle.interiorPath,
      "#23090b",
    ),
  );
  out.html.push(
    renderGeneratedMouthComponent(componentIds.tongue, "tongue", rigStyle.tonguePath, "#d96b76", 0),
  );
  out.html.push(
    renderGeneratedMouthComponent(componentIds.teeth, "teeth", rigStyle.teethPath, "#fff2df", 0),
  );
  out.html.push(
    renderGeneratedMouthComponent(
      componentIds.lowerLip,
      "lower-lip",
      rigStyle.lowerLipPath,
      "#b35b68",
    ),
  );
  out.html.push(
    renderGeneratedMouthComponent(
      componentIds.upperLip,
      "upper-lip",
      rigStyle.upperLipPath,
      "#b35b68",
    ),
  );
  out.html.push("</div>");
  const targetPart = generatedMouthMotionTargetPart(slotId, placement);
  out.motionTargets.push({
    kind: "slot",
    id: containerId,
    selector: `#${containerId}`,
    slotId,
    role: "mouth",
    basePart: targetPart,
    baseRotation: targetPart.rotation,
    baseAnchorX: targetPart.anchorX,
    baseAnchorY: targetPart.anchorY,
  });
  out.slotTimelines.push({
    slotId,
    role: "mouth",
    defaultKey: "rest",
    render: {
      kind: "generatedMouth",
      componentIds,
      visemeVars: Object.fromEntries(
        VISEMES.map((viseme) => [
          viseme,
          generatedMouthVarsForPose(VISEME_POSES[viseme], rigStyle),
        ]),
      ),
    },
  });
}

/** The part a slot initially shows: the placed pose/binding variant, else angle match, else first visible. */
function resolveActiveSlotPart(
  slot: CharacterSlotRef,
  poses: Record<string, string>,
  binding: ResolvedSlotBinding | undefined,
  rig: ReturnType<typeof normalizeCharacterRig>,
): CharacterPart | undefined {
  const visibleParts = slot.parts.filter((part) => part.visible);
  const activePose = binding?.effectivePartId ?? poses[slot.id];
  return (
    (activePose ? visibleParts.find((part) => partMatchesVariant(part, activePose)) : undefined) ??
    (rig.activeAngle
      ? visibleParts.find(
          (part) => partMatchesVariant(part, rig.activeAngle) || part.name === rig.activeAngle,
        )
      : undefined) ??
    visibleParts[0]
  );
}

function buildGenericSlot(
  out: PuppetDom,
  character: CharacterPreset,
  slot: CharacterSlotRef,
  poses: Record<string, string>,
  scaleX: number,
  scaleY: number,
  binding: ResolvedSlotBinding | undefined,
  rig: ReturnType<typeof normalizeCharacterRig>,
  nestedChildrenByParentSlotId: Map<string, NestedSlotChild[]>,
  hostPart?: CharacterPart,
): void {
  const visibleParts = slot.parts.filter((part) => part.visible);
  const activePart = resolveActiveSlotPart(slot, poses, binding, rig);
  if (!activePart) return;

  const containerId = slotContainerId(slot.id);
  const variants: Record<string, string[]> = {};
  const variantParts: Record<string, CharacterPart> = {};
  const activeKey = variantKeyForPart(activePart);
  // Bone-bound slots place every variant pivot-aligned: the displayed art's pivot rides the
  // joint (and therefore any socket the joint resolves to), not its authored canvas spot. The
  // container itself sits at the binding offset derived from the representative part, so that
  // part's group keeps rendering at its authored position.
  const referencePart = binding ? (representativePart(slot) ?? activePart) : undefined;
  out.html.push(
    openSlotContainerForPart(containerId, slot, activePart, scaleX, scaleY, binding, rig, hostPart),
  );
  for (const part of visibleParts) {
    const key = variantKeyForPart(part);
    const id = partElementId(slot.id, key, part.id);
    for (const alias of variantAliasesForPart(part)) {
      addVariantElement(variants, alias, id);
      variantParts[alias] = part;
    }
    const children = renderNestedChildrenForPart(
      out,
      character,
      slot.id,
      part,
      poses,
      scaleX,
      scaleY,
      rig,
      nestedChildrenByParentSlotId,
    );
    const offset = referencePart
      ? pivotAlignedPartOffset(referencePart, anchorPartForVariant(visibleParts, key) ?? part, part)
      : undefined;
    out.html.push(
      renderPartElement(id, part, activePart, key === activeKey, scaleX, scaleY, children, offset),
    );
  }
  out.html.push("</div>");
  out.motionTargets.push({
    ...motionTargetFor(containerId, slot, activePart, binding?.effectiveBoneId),
    defaultVariantKey: activeKey,
    variantParts,
    referencePart,
  });
  out.slotTimelines.push({
    slotId: slot.id,
    role: slot.role,
    hostSlotId: hostSlotIdFor(rig, slot.id),
    defaultKey: activeKey,
    render: {
      kind: "variant",
      variants,
    },
  });
}

function openSlotContainerForPart(
  containerId: string,
  slot: CharacterSlotRef,
  basePart: CharacterPart,
  scaleX: number,
  scaleY: number,
  binding: ResolvedSlotBinding | undefined,
  rig: ReturnType<typeof normalizeCharacterRig>,
  hostPart?: CharacterPart,
): string {
  return hostPart
    ? openNestedSlotContainer(containerId, slot, basePart, hostPart, scaleX, scaleY, binding, rig)
    : openSlotContainer(containerId, slot, basePart, scaleX, scaleY, binding, rig);
}

function openSlotContainer(
  containerId: string,
  slot: CharacterSlotRef,
  basePart: CharacterPart,
  scaleX: number,
  scaleY: number,
  binding: ResolvedSlotBinding | undefined,
  rig: ReturnType<typeof normalizeCharacterRig>,
): string {
  const drawIndex = slotDrawIndex(rig, slot.id, basePart.zIndex);
  const left = binding ? binding.x : basePart.x;
  const top = binding ? binding.y : basePart.y;
  const rotation = binding ? binding.rotation : basePart.rotation;
  const depth = binding ? binding.effectiveDepth : basePart.depth;
  const host = rig.hostConstraints.find((constraint) => constraint.slotId === slot.id);
  return `<div id="${esc(containerId)}" data-character-slot="true" data-character-slot-id="${esc(
    slot.id,
  )}"${binding ? ` data-character-bound-bone-id="${esc(binding.effectiveBoneId)}"` : ""}${
    host?.hostSlotId ? ` data-character-host-slot-id="${esc(host.hostSlotId)}"` : ""
  }${host?.hostBoneId ? ` data-character-host-bone-id="${esc(host.hostBoneId)}"` : ""}${
    host?.mode ? ` data-character-host-mode="${esc(host.mode)}"` : ""
  }${
    host?.reachPolicy ? ` data-character-reach-policy="${esc(host.reachPolicy)}"` : ""
  } data-character-depth="${esc(depth)}" data-character-draw-order-index="${esc(
    drawIndex,
  )}" data-character-role="${esc(slot.role)}" data-character-side="${esc(
    basePart.side ?? "",
  )}" style="${esc(
    styleString({
      left: left * scaleX,
      top: top * scaleY,
      width: basePart.width * scaleX,
      height: basePart.height * scaleY,
      "z-index": drawIndex,
      "transform-origin": `${basePart.anchorX * 100}% ${basePart.anchorY * 100}%`,
      transform: `rotate(${rotation}deg) scale(${binding?.scaleX ?? 1}, ${binding?.scaleY ?? 1})`,
    }),
  )}">`;
}

function hostSlotIdFor(rig: ReturnType<typeof normalizeCharacterRig>, slotId: string) {
  return hostConstraintFor(rig, slotId)?.hostSlotId;
}

function hostConstraintFor(rig: ReturnType<typeof normalizeCharacterRig>, slotId: string) {
  return rig.hostConstraints.find((constraint) => constraint.slotId === slotId);
}

function openNestedSlotContainer(
  containerId: string,
  slot: CharacterSlotRef,
  basePart: CharacterPart,
  hostPart: CharacterPart,
  scaleX: number,
  scaleY: number,
  binding: ResolvedSlotBinding | undefined,
  rig: ReturnType<typeof normalizeCharacterRig>,
): string {
  const drawIndex = slotDrawIndex(rig, slot.id, basePart.zIndex);
  const host = rig.hostConstraints.find((constraint) => constraint.slotId === slot.id);
  return `<div id="${esc(containerId)}" data-character-slot="true" data-character-slot-id="${esc(
    slot.id,
  )}"${binding ? ` data-character-bound-bone-id="${esc(binding.effectiveBoneId)}"` : ""}${
    host?.hostSlotId ? ` data-character-host-slot-id="${esc(host.hostSlotId)}"` : ""
  }${host?.hostBoneId ? ` data-character-host-bone-id="${esc(host.hostBoneId)}"` : ""}${
    host?.mode ? ` data-character-host-mode="${esc(host.mode)}"` : ""
  }${
    host?.reachPolicy ? ` data-character-reach-policy="${esc(host.reachPolicy)}"` : ""
  } data-character-depth="${esc(binding?.effectiveDepth ?? basePart.depth)}" data-character-draw-order-index="${esc(
    drawIndex,
  )}" data-character-role="${esc(slot.role)}" data-character-side="${esc(
    basePart.side ?? "",
  )}" style="${esc(
    styleString({
      left: (basePart.x - hostPart.x) * scaleX,
      top: (basePart.y - hostPart.y) * scaleY,
      width: basePart.width * scaleX,
      height: basePart.height * scaleY,
      "z-index": Math.max(0, drawIndex - hostPart.zIndex),
      "transform-origin": `${basePart.anchorX * 100}% ${basePart.anchorY * 100}%`,
      transform: `rotate(${basePart.rotation - hostPart.rotation}deg) scale(${
        binding?.scaleX ?? 1
      }, ${binding?.scaleY ?? 1})`,
    }),
  )}">`;
}

function renderPartElement(
  id: string,
  part: CharacterPart,
  basePart: CharacterPart,
  visible: boolean,
  scaleX: number,
  scaleY: number,
  children = "",
  // Container-local canvas offset. Defaults to the authored position (face builders); bone-bound
  // variant slots pass a pivot-aligned offset so the displayed art's pivot rides the joint.
  offset?: { x: number; y: number },
): string {
  const attrs = `id="${esc(id)}" data-character-part="true" data-character-part-id="${esc(
    part.id,
  )}" data-character-slot-id="${esc(part.slotId)}" data-character-role="${esc(
    part.role,
  )}" data-character-variant="${esc(variantKeyForPart(part))}"${
    part.variant?.kind ? ` data-character-variant-kind="${esc(part.variant.kind)}"` : ""
  }${
    variantLabelForPart(part)
      ? ` data-character-variant-label="${esc(variantLabelForPart(part))}"`
      : ""
  }${
    part.pose ? ` data-character-pose="${esc(part.pose)}"` : ""
  }${part.viseme ? ` data-character-viseme="${esc(part.viseme)}"` : ""}${
    part.eyeState ? ` data-character-eye-state="${esc(part.eyeState)}"` : ""
  }`;
  const style = esc(
    styleString({
      left: (offset?.x ?? part.x - basePart.x) * scaleX,
      top: (offset?.y ?? part.y - basePart.y) * scaleY,
      width: part.width * scaleX,
      height: part.height * scaleY,
      opacity: visible ? 1 : 0,
      "z-index": part.zIndex - basePart.zIndex,
      "transform-origin": `${part.anchorX * 100}% ${part.anchorY * 100}%`,
      transform: `rotate(${part.rotation - basePart.rotation}deg)`,
    }),
  );

  if (children) {
    return `<div ${attrs} style="${style}">${renderPartVisual(part, children)}</div>`;
  }

  if (part.morph?.primaryPath) {
    const viewBox = part.morph.viewBox ?? `0 0 ${part.width} ${part.height}`;
    const strokeAttrs = part.morph.stroke
      ? ` stroke="${esc(part.morph.stroke)}" stroke-width="${esc(String(part.morph.strokeWidth ?? 1))}" stroke-linecap="${esc(
          part.morph.strokeLinecap ?? "round",
        )}" stroke-linejoin="${esc(part.morph.strokeLinejoin ?? "round")}"`
      : "";
    return `<svg ${attrs} viewBox="${esc(viewBox)}" aria-hidden="true" overflow="visible" style="${style}"><path d="${esc(
      part.morph.primaryPath,
    )}" fill="${esc(part.morph.fill ?? "#733f43")}"${strokeAttrs}/></svg>`;
  }

  return `<img ${attrs} src="asset:${esc(part.mediaId)}" alt="" draggable="false" style="${style}">`;
}

function renderPartVisual(part: CharacterPart, children: string): string {
  if (part.morph?.primaryPath) {
    const viewBox = part.morph.viewBox ?? `0 0 ${part.width} ${part.height}`;
    const strokeAttrs = part.morph.stroke
      ? ` stroke="${esc(part.morph.stroke)}" stroke-width="${esc(String(part.morph.strokeWidth ?? 1))}" stroke-linecap="${esc(
          part.morph.strokeLinecap ?? "round",
        )}" stroke-linejoin="${esc(part.morph.strokeLinejoin ?? "round")}"`
      : "";
    return `<svg viewBox="${esc(viewBox)}" aria-hidden="true" overflow="visible" style="${esc(
      styleString({ position: "absolute", left: 0, top: 0, width: "100%", height: "100%" }),
    )}"><path d="${esc(part.morph.primaryPath)}" fill="${esc(
      part.morph.fill ?? "#733f43",
    )}"${strokeAttrs}/></svg>${children}`;
  }
  const visual = `<img src="asset:${esc(part.mediaId)}" alt="" draggable="false" style="${esc(
    styleString({ position: "absolute", left: 0, top: 0, width: "100%", height: "100%" }),
  )}">`;
  return `${visual}${children}`;
}

function renderGeneratedMouthComponent(
  id: string,
  component: string,
  path: string,
  fill: string,
  opacity?: number,
): string {
  return `<svg id="${esc(id)}" data-character-generated-mouth-component="${esc(
    component,
  )}" viewBox="${esc(MOUTH_VIEWBOX)}" aria-hidden="true" style="${esc(
    styleString({ opacity: opacity ?? 1, "transform-origin": "50% 50%" }),
  )}"><path d="${esc(path)}" fill="${esc(fill)}"/></svg>`;
}

function generatedMouthMotionTargetPart(
  slotId: string,
  placement:
    | NonNullable<CharacterPreset["fallbackMouth"]>
    | NonNullable<CharacterPreset["mouthRig"]>["placement"],
): CharacterPart {
  const rotation = "rotation" in placement ? placement.rotation : 0;
  const anchorX = "anchorX" in placement ? placement.anchorX : 0.5;
  const anchorY = "anchorY" in placement ? placement.anchorY : 0.5;
  return {
    id: `${slotId}:generated-mouth`,
    slotId,
    slotName: "Mouth",
    role: "mouth",
    name: "Generated mouth",
    mediaId: "",
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
    rotation,
    anchorX,
    anchorY,
    pivot: {
      x: placement.x + anchorX * placement.width,
      y: placement.y + anchorY * placement.height,
    },
    motionBehavior: "lipSync",
    zIndex: placement.zIndex,
    depth: 0,
    visible: true,
  };
}

function motionTargetFor(
  id: string,
  slot: CharacterSlotRef,
  basePart: CharacterPart,
  boneId?: string,
): MotionTarget {
  return {
    kind: "slot",
    id,
    selector: `#${id}`,
    boneId,
    slotId: slot.id,
    role: slot.role,
    basePart,
    baseRotation: basePart.rotation,
    baseAnchorX: basePart.anchorX,
    baseAnchorY: basePart.anchorY,
  };
}

function buildSpeechAudio(
  id: string,
  mediaId: string,
  start: number,
  duration: number,
  trackIndex: number,
  volume?: number,
  mediaStart?: number,
): string {
  const volumeAttr = volume !== undefined && volume !== 1 ? ` data-volume="${esc(volume)}"` : "";
  const mediaStartAttr =
    mediaStart !== undefined && mediaStart > 0 ? ` data-media-start="${esc(mediaStart)}"` : "";
  return `<audio id="${esc(safeId(id))}" data-character-speech="true" data-start="${esc(
    start,
  )}" data-duration="${esc(duration)}" data-track-index="${esc(
    trackIndex,
  )}"${volumeAttr}${mediaStartAttr} src="asset:${esc(mediaId)}" preload="auto"></audio>`;
}

type ResolvedAudioSpeech = {
  audioId: string;
  start: number;
  duration: number;
  volume?: number;
  mediaStart?: number;
};

/**
 * Resolve the build's speeches (or the legacy single voice) into the `<audio>`
 * clips to emit and a single combined viseme track for the mouth. Multi-speech
 * offsets each speech's visemes by its start and closes the mouth (rest) after
 * each; the legacy path is preserved byte-for-byte.
 */
function resolveSpeechTimeline(
  args: BuildCharacterCompositionArgs,
  duration: number,
): {
  audioSpeeches: ResolvedAudioSpeech[];
  combinedVisemes: VisemeEntry[];
} {
  const clampT = (t: number) => Math.max(0, Math.min(duration, t));
  if (args.speeches && args.speeches.length > 0) {
    const audioSpeeches: ResolvedAudioSpeech[] = [];
    const combinedVisemes: VisemeEntry[] = [];
    for (const speech of args.speeches) {
      const start = clampT(speech.start);
      const mediaStart = Math.max(0, speech.mediaStartTime ?? 0);
      const length = Math.min(duration - start, positiveNumber(speech.duration, duration));
      if (length <= 0) continue;
      audioSpeeches.push({
        audioId: speech.audioId,
        start,
        duration: length,
        volume: speech.volume,
        mediaStart,
      });
      // Visemes are timed against the source audio; an in-point shifts them earlier
      // and drops any that fall outside the trimmed [mediaStart, mediaStart+length) window.
      for (const entry of speech.visemes) {
        if (entry.t < mediaStart - 1e-6 || entry.t > mediaStart + length + 1e-6) continue;
        combinedVisemes.push({ t: clampT(start + (entry.t - mediaStart)), v: entry.v });
      }
      combinedVisemes.push({ t: clampT(start + length), v: "rest" });
    }
    combinedVisemes.sort((a, b) => a.t - b.t);
    return { audioSpeeches, combinedVisemes };
  }
  if (args.meta.lipSyncAudioId) {
    const length = Math.min(duration, positiveNumber(args.speechDuration ?? duration, duration));
    return {
      audioSpeeches: [{ audioId: args.meta.lipSyncAudioId, start: 0, duration: length }],
      combinedVisemes: args.meta.visemes ?? [],
    };
  }
  return { audioSpeeches: [], combinedVisemes: args.meta.visemes ?? [] };
}

function appendCharacterTimelineScript(
  doc: Document,
  args: {
    compositionId: string;
    clipId: string;
    duration: number;
    scaleX: number;
    scaleY: number;
    meta: CharacterClipMeta;
    motionPresets: Map<string, MotionPreset>;
    motionTargets: MotionTarget[];
    canvasWidth: number;
    canvasHeight: number;
    slotTimelines: SlotTimeline[];
    boneAnchorTimelines: BoneAnchorTimeline[];
    constraintContext: MotionConstraintContext;
    activeAngle: ReturnType<typeof normalizeCharacterRig>["activeAngle"];
    parentBoneIds: Set<string>;
  },
): void {
  const blinkWindows = blinkWindowsForClip({
    id: args.clipId,
    duration: args.duration,
    autoBlink: args.meta.autoBlink,
  });
  const times = collectTimelineTimes(
    args.duration,
    args.meta,
    args.motionPresets,
    blinkWindows,
    args.activeAngle,
  );
  const frames = times.map((time) =>
    buildMotionFrame(
      time,
      args.duration,
      args.scaleX,
      args.scaleY,
      args.meta,
      args.motionPresets,
      args.motionTargets,
      args.canvasWidth,
      args.canvasHeight,
      args.slotTimelines,
      blinkWindows,
      args.constraintContext,
      args.activeAngle,
      args.parentBoneIds,
    ),
  );
  backfillThreeDVars(frames);
  const slotEvents = buildSlotEvents(frames, args.slotTimelines, args.boneAnchorTimelines);
  const motionSegments = frames.slice(1).flatMap((frame, index) => {
    const previousFrame = frames[index];
    const targets = changedMotionTargets(previousFrame.targets, frame.targets);
    if (targets.length === 0) return [];
    return [
      {
        start: previousFrame.time,
        duration: roundTime(frame.time - previousFrame.time),
        targets,
      },
    ];
  });

  const scene = {
    duration: args.duration,
    initialTargets: frames[0]?.targets ?? [],
    motionSegments,
    slotEvents,
  };
  const sceneJson = safeJson(scene);
  const script = doc.createElement("script");
  script.textContent = `(function(){
  const S = ${sceneJson};
  const tl = gsap.timeline({ paused: true });
  // Anchor the timeline to the full composition duration. The hyperframes runtime
  // clamps a composition clip's visibility to min(data-duration, timeline.duration()),
  // so without this tween the character's host clip disappears as soon as the last
  // internal motion/viseme ends.
  tl.to({}, { duration: S.duration }, 0);
  const applyTargetVars = function(targets) {
    (targets || []).forEach(function(target) { gsap.set(target.selector, target.vars); });
  };
  const applyVariantEvent = function(event) {
    (event.variant.hide || []).forEach(function(id) { gsap.set("#" + id, { opacity: 0 }); });
    const show = Array.isArray(event.variant.show) ? event.variant.show : event.variant.show ? [event.variant.show] : [];
    show.forEach(function(id) { gsap.set("#" + id, { opacity: 1 }); });
    (event.boneAnchors || []).forEach(function(anchor) {
      gsap.set(anchor.selector, { left: anchor.left, top: anchor.top, rotation: anchor.rotation });
    });
  };
  const applyGeneratedMouthEvent = function(event) {
    Object.keys(event.generatedMouth.components || {}).forEach(function(selector) {
      gsap.set(selector, event.generatedMouth.components[selector]);
    });
  };
  const resetInitialState = function() {
    applyTargetVars(S.initialTargets || []);
    (S.slotEvents || []).forEach(function(event) {
      if (Math.abs((event.time || 0)) > 0.0001) return;
      if (event.variant) applyVariantEvent(event);
      if (event.generatedMouth) applyGeneratedMouthEvent(event);
    });
  };
  const setVars = function(targets, time) {
    targets.forEach(function(target) { tl.set(target.selector, target.vars, time); });
  };
  setVars(S.initialTargets || [], 0);
  (S.motionSegments || []).forEach(function(segment) {
    (segment.targets || []).forEach(function(target) {
      tl.to(target.selector, Object.assign({ duration: segment.duration, ease: "none" }, target.vars), segment.start);
    });
  });
  (S.slotEvents || []).forEach(function(event) {
    if (event.variant) {
      (event.variant.hide || []).forEach(function(id) { tl.set("#" + id, { opacity: 0 }, event.time); });
      const show = Array.isArray(event.variant.show) ? event.variant.show : event.variant.show ? [event.variant.show] : [];
      show.forEach(function(id) { tl.set("#" + id, { opacity: 1 }, event.time); });
      (event.boneAnchors || []).forEach(function(anchor) {
        tl.set(anchor.selector, { left: anchor.left, top: anchor.top, rotation: anchor.rotation }, event.time);
      });
    }
    if (event.generatedMouth) {
      Object.keys(event.generatedMouth.components || {}).forEach(function(selector) {
        tl.to(selector, Object.assign({ duration: event.generatedMouth.duration, ease: "none" }, event.generatedMouth.components[selector]), event.time);
      });
    }
  });
  const originalSeek = tl.seek;
  tl.seek = function(time, suppressEvents) {
    const result = originalSeek.call(this, time, suppressEvents);
    if (Number(time) <= 0.001) resetInitialState();
    return result;
  };
  tl.eventCallback("onStart", function() {
    if (tl.time() <= 0.001) resetInitialState();
  });
  tl.eventCallback("onReverseComplete", resetInitialState);
  resetInitialState();
  window.__timelines = window.__timelines || {};
  window.__timelines[${JSON.stringify(args.compositionId)}] = tl;
})();`;
  doc.body?.appendChild(script);
}

function collectTimelineTimes(
  duration: number,
  meta: CharacterClipMeta,
  presets: Map<string, MotionPreset>,
  blinkWindows: Array<{ start: number; end: number }>,
  activeAngle: ReturnType<typeof normalizeCharacterRig>["activeAngle"],
): number[] {
  const times = new Set<number>([0, roundTime(duration)]);
  const step = 1 / MOTION_SAMPLE_FPS;
  for (let t = step; t < duration; t += step) times.add(roundTime(t));
  for (const blink of blinkWindows) {
    times.add(roundTime(blink.start));
    times.add(roundTime(blink.end));
  }
  for (const viseme of meta.visemes ?? [])
    times.add(roundTime(Math.max(0, Math.min(duration, viseme.t))));
  for (const motion of meta.motions ?? []) {
    const preset = presets.get(motion.presetId);
    if (!preset) continue;
    if (!motionAppliesToAngle(preset, activeAngle)) continue;
    const motionDuration = Math.max(0.0001, motion.duration ?? preset.duration);
    for (const occurrence of generateMotionOccurrences(motion, preset, duration)) {
      times.add(roundTime(Math.max(0, Math.min(duration, occurrence.start))));
      times.add(roundTime(Math.max(0, Math.min(duration, occurrence.end))));
      for (const track of preset.tracks) {
        if (track.angleIds?.length && !track.angleIds.includes(activeAngle)) continue;
        for (const keyframe of track.keyframes) {
          times.add(
            roundTime(
              Math.max(0, Math.min(duration, occurrence.start + keyframe.t * motionDuration)),
            ),
          );
        }
      }
      for (const keypose of preset.keyposes ?? []) {
        times.add(roundTime(Math.max(0, Math.min(duration, occurrence.start + keypose.t))));
        if (keypose.anticipation && keypose.t > 0) {
          times.add(
            roundTime(
              Math.max(
                0,
                Math.min(duration, occurrence.start + keypose.t - keypose.anticipation.duration),
              ),
            ),
          );
        }
      }
    }
  }
  return Array.from(times)
    .filter((time) => Number.isFinite(time) && time >= 0 && time <= duration)
    .sort((a, b) => a - b);
}

function buildMotionFrame(
  time: number,
  duration: number,
  scaleX: number,
  scaleY: number,
  meta: CharacterClipMeta,
  presets: Map<string, MotionPreset>,
  motionTargets: MotionTarget[],
  canvasWidth: number,
  canvasHeight: number,
  slots: SlotTimeline[],
  blinkWindows: Array<{ start: number; end: number }>,
  constraintCtx: MotionConstraintContext,
  activeAngle: ReturnType<typeof normalizeCharacterRig>["activeAngle"],
  parentBoneIds: Set<string>,
) {
  const composed = composeMotionsAt(
    { duration, motions: meta.motions },
    time,
    presets,
    activeAngle,
  );
  const slotStates = resolveSlotStatesAt({
    time,
    meta,
    slots,
    blinkWindows,
    composed,
  });
  return {
    time,
    slotStates,
    targets: motionTargets.map((target) => {
      // A layer's motion drives exactly one element: the bone group when the bone carries children
      // (so they follow, pivoting at the joint), otherwise the slot element (anchor pivot). This
      // avoids the double-application that made layers race ahead of their children.
      const boneCarriesChildren = !!target.boneId && parentBoneIds.has(target.boneId);
      const rawDelta =
        target.kind === "bone"
          ? boneCarriesChildren
            ? deltaForBone(composed, target.role, target.slotId, target.boneId)
            : deltaForBoneOnly(composed, target.boneId)
          : boneCarriesChildren
            ? emptyDelta()
            : deltaFor(composed, target.role, target.slotId);
      // Tone preset motion down to the layer's effective reach (drift polygon + twist range,
      // variant rotation limits), unless an active movement opted this layer out of bounds.
      const limited = resolveMotionDelta({
        ctx: constraintCtx,
        slotId: target.slotId,
        role: target.role,
        activeVariants: slotStates,
        dx: rawDelta.dx,
        dy: rawDelta.dy,
        rotation: rawDelta.rotation,
        unclampedLayers: composed.unclampedLayers,
      });
      const delta = limited.clamped
        ? { ...rawDelta, dx: limited.dx, dy: limited.dy, rotation: limited.rotation }
        : rawDelta;
      const activePart = activePartForMotionTarget(target, composed, slotStates);
      const turn =
        activePart && shouldApplyFaceTurnToTarget(target, boneCarriesChildren)
          ? faceTurnMotionForPart(
              activePart,
              composed.faceTurnX,
              canvasWidth,
              composed.faceTurnY,
              canvasHeight,
            )
          : null;
      const { originX, originY } =
        target.kind === "bone"
          ? { originX: 0, originY: 0 }
          : transformOriginForMotionTarget(target, activePart, delta);
      // A bone whose rest rotation follows the parent variant uses the active variant's
      // rotation as this frame's base, so motion tweens compose with the swap instead of
      // stomping it back to the rest angle.
      const anchorKey = target.anchorParentSlotId
        ? slotStates.get(target.anchorParentSlotId)
        : undefined;
      const effectiveBaseRotation =
        (anchorKey ? target.anchorRotations?.[anchorKey] : undefined) ?? target.baseRotation;
      const vars: GsapVars = {
        x: round((delta.dx + (turn?.dx ?? 0)) * scaleX, 3),
        y: round((delta.dy + (turn?.dy ?? 0)) * scaleY, 3),
        scaleX: round(delta.scale * delta.scaleX * (turn?.scaleX ?? 1), 4),
        scaleY: round(delta.scale * delta.scaleY * (turn?.scaleY ?? 1), 4),
        skewX: round(delta.skewX + (turn?.skewX ?? 0), 3),
        skewY: round(delta.skewY + (turn?.skewY ?? 0), 3),
        rotation: round(effectiveBaseRotation + delta.rotation + (turn?.rotation ?? 0), 3),
        transformOrigin: `${round(originX * 100, 3)}% ${round(originY * 100, 3)}%`,
      };
      // 3D fields are emitted only when actually used, so existing 2D motions stay byte-identical.
      // The backfill pass in appendCharacterTimelineScript then keeps these present for the whole
      // motion on any target that uses 3D, so GSAP animates them cleanly back to zero.
      if (delta.rotationX) vars.rotationX = round(delta.rotationX, 3);
      if (delta.rotationY) vars.rotationY = round(delta.rotationY, 3);
      if (delta.transformPerspective !== null)
        vars.transformPerspective = round(delta.transformPerspective, 3);
      if (delta.opacity !== null) vars.opacity = round(delta.opacity, 4);
      return { selector: target.selector, vars };
    }),
  };
}

const DEFAULT_THREE_D_PERSPECTIVE = 800;

/**
 * Once a target uses any 3D transform anywhere in the motion, every frame for that target must
 * carry rotationX/rotationY/transformPerspective — otherwise a later `tl.to` that omits a field
 * leaves GSAP holding the previous value (e.g. a flip never returns to 0). buildMotionFrame emits
 * 3D vars only when non-zero (so plain 2D motions stay byte-identical); this pass backfills the
 * defaults across all frames for any target that touches 3D, keeping animations clean.
 */
function backfillThreeDVars(
  frames: Array<{ targets: Array<{ selector: string; vars: GsapVars }> }>,
) {
  const perspectiveBySelector = new Map<string, number>();
  for (const frame of frames) {
    for (const target of frame.targets) {
      const usesThreeD =
        target.vars.rotationX !== undefined ||
        target.vars.rotationY !== undefined ||
        target.vars.transformPerspective !== undefined;
      if (!usesThreeD) continue;
      const persp =
        target.vars.transformPerspective ??
        perspectiveBySelector.get(target.selector) ??
        DEFAULT_THREE_D_PERSPECTIVE;
      perspectiveBySelector.set(target.selector, persp);
    }
  }
  if (perspectiveBySelector.size === 0) return;
  for (const frame of frames) {
    for (const target of frame.targets) {
      const persp = perspectiveBySelector.get(target.selector);
      if (persp === undefined) continue;
      if (target.vars.rotationX === undefined) target.vars.rotationX = 0;
      if (target.vars.rotationY === undefined) target.vars.rotationY = 0;
      if (target.vars.transformPerspective === undefined) target.vars.transformPerspective = persp;
    }
  }
}

function changedMotionTargets(
  previousTargets: Array<{ selector: string; vars: GsapVars }>,
  nextTargets: Array<{ selector: string; vars: GsapVars }>,
) {
  const previousBySelector = new Map(
    previousTargets.map((target) => [target.selector, target.vars]),
  );
  return nextTargets.filter(
    (target) => !gsapVarsEqual(previousBySelector.get(target.selector), target.vars),
  );
}

function gsapVarsEqual(a: GsapVars | undefined, b: GsapVars): boolean {
  if (!a) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as Array<keyof GsapVars>);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function activePartForMotionTarget(
  target: MotionTarget,
  composed: ReturnType<typeof composeMotionsAt>,
  slotStates: Map<string, string>,
): CharacterPart | undefined {
  const state = slotStates.get(target.slotId);
  if (state && target.variantParts?.[state])
    return partWithTargetDepth(target.variantParts[state], target);
  const swap = poseSwapFor(composed, target.role, target.slotId);
  if (swap && target.variantParts?.[swap])
    return partWithTargetDepth(target.variantParts[swap], target);
  if (target.defaultVariantKey && target.variantParts?.[target.defaultVariantKey]) {
    return partWithTargetDepth(target.variantParts[target.defaultVariantKey], target);
  }
  return partWithTargetDepth(target.basePart, target);
}

function shouldApplyFaceTurnToTarget(target: MotionTarget, boneCarriesChildren: boolean): boolean {
  if (target.role === "iris") return false;
  if (target.kind === "slot" && boneCarriesChildren) return false;
  return true;
}

function partWithTargetDepth(
  part: CharacterPart | undefined,
  target: MotionTarget,
): CharacterPart | undefined {
  if (!part || target.depth === undefined) return part;
  return { ...part, depth: target.depth };
}

function transformOriginForMotionTarget(
  target: MotionTarget,
  activePart: CharacterPart | undefined,
  delta: ReturnType<typeof deltaFor>,
): { originX: number; originY: number } {
  const originPart = activePart ?? target.basePart;
  const partOriginX = delta.originX ?? originPart?.anchorX ?? target.baseAnchorX;
  const partOriginY = delta.originY ?? originPart?.anchorY ?? target.baseAnchorY;
  // The origin point maps the displayed part's box into the container box, so it must use the
  // same offset the part was rendered at: pivot-aligned for bone-bound variant slots (where even
  // the container's own base part can sit offset from the reference), authored canvas offset
  // otherwise.
  if (
    originPart &&
    target.basePart &&
    (originPart !== target.basePart ||
      (target.referencePart && originPart !== target.referencePart))
  ) {
    const offset = motionOriginPartOffset(target, originPart);
    return {
      originX: (offset.x + partOriginX * originPart.width) / Math.max(1, target.basePart.width),
      originY: (offset.y + partOriginY * originPart.height) / Math.max(1, target.basePart.height),
    };
  }
  return { originX: partOriginX, originY: partOriginY };
}

function motionOriginPartOffset(
  target: MotionTarget,
  originPart: CharacterPart,
): { x: number; y: number } {
  const basePart = target.basePart!;
  if (!target.referencePart) {
    return { x: originPart.x - basePart.x, y: originPart.y - basePart.y };
  }
  // variantParts values preserve render order, so anchor selection matches buildGenericSlot's.
  const anchorPart =
    anchorPartForVariant(Object.values(target.variantParts ?? {}), variantKeyForPart(originPart)) ??
    originPart;
  return pivotAlignedPartOffset(target.referencePart, anchorPart, originPart);
}

function resolveSlotStatesAt({
  time,
  meta,
  slots,
  blinkWindows,
  composed,
}: {
  time: number;
  meta: CharacterClipMeta;
  slots: SlotTimeline[];
  blinkWindows: Array<{ start: number; end: number }>;
  composed: ReturnType<typeof composeMotionsAt>;
}): Map<string, string> {
  const states = new Map<string, string>();
  for (const slot of slots) {
    states.set(slot.slotId, resolveSlotKeyAt(slot, time, meta, blinkWindows, composed));
  }
  return states;
}

function resolveSlotKeyAt(
  slot: SlotTimeline,
  time: number,
  meta: CharacterClipMeta,
  blinkWindows: Array<{ start: number; end: number }>,
  composed: ReturnType<typeof composeMotionsAt>,
): string {
  const expressionSwap = poseSwapFor(composed, slot.role, slot.slotId);
  if (slot.role === "mouth") {
    const key = lipSyncOwnsMouth(meta) ? lastVisemeAt(meta.visemes ?? [], time) : expressionSwap;
    return slotKeyOrDefault(slot, key);
  }
  if (slot.role === "eye") {
    const availableStates = new Set(slotRenderKeys(slot.render));
    const key = resolveEyeState({
      expressionPoseSwap: expressionSwap,
      proceduralPoseSwap: autoBlinkPoseSwapAt(blinkWindows, time),
      availableStates,
    });
    return slotKeyOrDefault(slot, key);
  }
  return slotKeyOrDefault(slot, expressionSwap);
}

function slotKeyOrDefault(slot: SlotTimeline, key: string | undefined): string {
  if (key && slotRenderHasKey(slot.render, key)) return key;
  return slot.defaultKey;
}

function slotRenderHasKey(render: SlotRenderStrategy, key: string): boolean {
  if (render.kind === "variant") return Boolean(render.variants[key]);
  return Boolean(render.visemeVars[key as MouthViseme]);
}

function slotRenderKeys(render: SlotRenderStrategy): string[] {
  return render.kind === "variant" ? Object.keys(render.variants) : Object.keys(render.visemeVars);
}

function lastVisemeAt(visemes: Array<{ t: number; v: MouthViseme }>, time: number): MouthViseme {
  let active: MouthViseme = "rest";
  for (const entry of visemes) {
    if (entry.t <= time + 0.0001) active = entry.v;
    else break;
  }
  return active;
}

function buildSlotEvents(
  frames: Array<{ time: number; slotStates: Map<string, string> }>,
  slots: SlotTimeline[],
  boneAnchorTimelines: BoneAnchorTimeline[] = [],
) {
  const events: Array<{
    time: number;
    slotId: string;
    key: string;
    variant?: { hide: string[]; show?: string[] };
    boneAnchors?: Array<{ selector: string; left: number; top: number; rotation: number }>;
    generatedMouth?: { duration: number; components: Record<string, GsapVars> };
  }> = [];
  const anchorsByParentSlot = new Map<string, BoneAnchorTimeline[]>();
  for (const entry of boneAnchorTimelines) {
    anchorsByParentSlot.set(entry.parentSlotId, [
      ...(anchorsByParentSlot.get(entry.parentSlotId) ?? []),
      entry,
    ]);
  }
  const previous = new Map<string, string>();
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const nextFrame = frames[index + 1];
    for (const slot of slots) {
      const key = frame.slotStates.get(slot.slotId) ?? slot.defaultKey;
      const signature = slotRenderSignature(slot.render, key);
      if (previous.get(slot.slotId) === signature) continue;
      previous.set(slot.slotId, signature);
      const event = slotEventFor(slot, key, frame.time, nextFrame?.time);
      if (!event) continue;
      if (event.variant) {
        const boneAnchors = (anchorsByParentSlot.get(slot.slotId) ?? []).map((entry) => {
          const anchor = entry.anchors[key] ?? entry.base;
          return {
            selector: entry.selector,
            left: anchor.left,
            top: anchor.top,
            rotation: anchor.rotation,
          };
        });
        if (boneAnchors.length) event.boneAnchors = boneAnchors;
      }
      events.push(event);
    }
  }
  return events;
}

function slotRenderSignature(render: SlotRenderStrategy, key: string): string {
  if (render.kind === "variant") return variantIdsForKey(render, key).join("|") || key;
  return key;
}

function slotEventFor(
  slot: SlotTimeline,
  key: string,
  time: number,
  nextTime: number | undefined,
):
  | {
      time: number;
      slotId: string;
      key: string;
      variant?: { hide: string[]; show?: string[] };
      boneAnchors?: Array<{ selector: string; left: number; top: number; rotation: number }>;
      generatedMouth?: { duration: number; components: Record<string, GsapVars> };
    }
  | undefined {
  if (slot.render.kind === "variant") {
    return {
      time,
      slotId: slot.slotId,
      key,
      variant: {
        hide: unique(Object.values(slot.render.variants).flat()),
        show: variantIdsForKey(slot.render, key),
      },
    };
  }
  const vars = slot.render.visemeVars[key as MouthViseme] ?? slot.render.visemeVars.rest;
  if (!vars) return undefined;
  return {
    time,
    slotId: slot.slotId,
    key,
    generatedMouth: {
      duration: Math.min(0.045, Math.max(0, (nextTime ?? time + 0.045) - time)),
      components: {
        [`#${slot.render.componentIds.upperLip}`]: vars.upperLip,
        [`#${slot.render.componentIds.lowerLip}`]: vars.lowerLip,
        [`#${slot.render.componentIds.interior}`]: vars.interior,
        [`#${slot.render.componentIds.teeth}`]: vars.teeth,
        [`#${slot.render.componentIds.tongue}`]: vars.tongue,
      },
    },
  };
}

function variantIdsForKey(render: VariantSlotRender, key: string): string[] {
  return (
    render.variants[key] ??
    render.variants.rest ??
    render.variants[Object.keys(render.variants)[0]] ??
    []
  );
}

function generatedMouthVarsForPose(
  pose: MouthPose,
  style: (typeof RIG_STYLES)[number],
  settings?: CharacterPreset["mouthRig"],
): GeneratedMouthTimelineVars {
  const t = poseToTransforms(pose, style, {
    upperCurve: settings?.upperCurve,
    lowerCurve: settings?.lowerCurve,
  });
  return generatedMouthVarsFromTransforms(t);
}

function generatedMouthVarsFromTransforms(t: RigTransforms): GeneratedMouthTimelineVars {
  return {
    upperLip: {
      y: round(t.upperLip.y, 3),
      scaleX: round(t.upperLip.scaleX, 4),
      scaleY: round(t.upperLip.scaleY, 4),
      transformOrigin: "50% 50%",
    },
    lowerLip: {
      y: round(t.lowerLip.y, 3),
      scaleX: round(t.lowerLip.scaleX, 4),
      scaleY: round(t.lowerLip.scaleY, 4),
      transformOrigin: "50% 50%",
    },
    interior: {
      scaleX: round(t.interior.scaleX, 4),
      scaleY: round(t.interior.scaleY, 4),
      opacity: round(t.interior.opacity, 4),
      transformOrigin: "50% 50%",
    },
    teeth: {
      y: round(t.teeth.y, 3),
      scaleX: round(t.teeth.scaleX, 4),
      opacity: round(t.teeth.opacity, 4),
      transformOrigin: "50% 50%",
    },
    tongue: {
      y: round(t.tongue.y, 3),
      scaleX: round(t.tongue.scaleX, 4),
      scaleY: round(t.tongue.scaleY, 4),
      opacity: round(t.tongue.opacity, 4),
      transformOrigin: "50% 50%",
    },
  };
}

function slotContainerId(slotId: string): string {
  return `char-slot-${safeId(slotId)}`;
}

function partElementId(slotId: string, variant: string, partId?: string): string {
  const suffix = partId && partId !== variant ? `-${safeId(partId)}` : "";
  return `char-part-${safeId(slotId)}-${safeId(variant)}${suffix}`;
}

function safeId(value: string): string {
  const clean = value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  const base = clean || "part";
  return clean === value ? base : `${base}-${hashIdFragment(value)}`;
}

function hashIdFragment(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function styleString(style: Record<string, string | number | undefined>): string {
  const unitless = new Set(["opacity", "z-index", "scale", "scaleX", "scaleY"]);
  return Object.entries(style)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(
      ([key, value]) =>
        `${key}:${
          typeof value === "number"
            ? unitless.has(key)
              ? round(value, 3)
              : `${round(value, 3)}px`
            : value
        }`,
    )
    .join(";");
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function addVariantElement(variants: Record<string, string[]>, key: string, id: string): void {
  const existing = variants[key] ?? [];
  if (!existing.includes(id)) variants[key] = [...existing, id];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function positiveNumber(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function roundTime(value: number): number {
  return round(value, 4);
}

function round(value: number, digits = 2): number {
  const multiplier = Math.pow(10, digits);
  return Math.round(value * multiplier) / multiplier;
}
