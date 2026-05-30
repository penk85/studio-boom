import { generateHyperframesHtml } from "@hyperframes/core";
import type {
  CharacterClipMeta,
  CharacterPart,
  CharacterPreset,
  MotionPreset,
  MouthPose,
  MouthViseme,
  PartRole,
} from "../types";
import { validateCompositionSourceHtml } from "../hyperframes/composition-source";
import { normalizeNativeHyperframesHtml } from "../hyperframes/native";
import {
  composeMotionsAt,
  deltaFor,
  generateMotionOccurrences,
  poseSwapFor,
} from "../presets/apply";
import { listCharacterSlots, roleEnabledByManifest } from "./character-utils";
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

const VISEMES: MouthViseme[] = ["rest", "A", "E", "O", "U", "MBP", "FV", "L", "WQ", "Smile"];
const MOTION_SAMPLE_FPS = 12;

type CharacterSlotRef = ReturnType<typeof listCharacterSlots>[number];

interface BuildCharacterCompositionArgs {
  compositionId: string;
  clipId: string;
  width: number;
  height: number;
  duration: number;
  character: CharacterPreset;
  meta: CharacterClipMeta;
  motionPresets: Map<string, MotionPreset>;
}

interface MotionTarget {
  id: string;
  selector: string;
  slotId: string;
  role: PartRole;
  basePart?: CharacterPart;
  defaultVariantKey?: string;
  variantParts?: Record<string, CharacterPart>;
  baseRotation: number;
  baseAnchorX: number;
  baseAnchorY: number;
}

interface SlotTimeline {
  slotId: string;
  role: PartRole;
  defaultKey: string;
  render: SlotRenderStrategy;
}

interface VariantSlotRender {
  kind: "variant";
  variants: Record<string, string>;
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
  opacity?: number;
  transformOrigin?: string;
}

interface PuppetDom {
  html: string[];
  motionTargets: MotionTarget[];
  slotTimelines: SlotTimeline[];
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
  }
  if (meta?.lipSyncAudioId) ids.add(meta.lipSyncAudioId);
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
  const dom = buildPuppetDom(args.character, args.meta, scaleX, scaleY);

  stage.innerHTML = "";
  stage.insertAdjacentHTML("beforeend", dom.html.join("\n"));
  if (args.meta.lipSyncAudioId) {
    stage.insertAdjacentHTML(
      "beforeend",
      buildSpeechAudio(args.compositionId, args.meta.lipSyncAudioId, duration),
    );
  }

  appendCharacterStyles(doc);
  appendCharacterTimelineScript(doc, {
    compositionId: args.compositionId,
    clipId: args.clipId,
    duration,
    scaleX,
    scaleY,
    meta: args.meta,
    motionPresets: args.motionPresets,
    motionTargets: dom.motionTargets,
    canvasWidth: args.character.canvasWidth,
    slotTimelines: dom.slotTimelines,
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
  meta: CharacterClipMeta,
  scaleX: number,
  scaleY: number,
): PuppetDom {
  const out: PuppetDom = {
    html: ['<div data-character-root="true" data-character-id="' + esc(character.id) + '">'],
    motionTargets: [],
    slotTimelines: [],
  };

  const slots = listCharacterSlots(character.parts).filter((slot) =>
    roleEnabledByManifest(slot.role, character.manifest),
  );
  const hasMouthSlot = slots.some(
    (slot) => slot.role === "mouth" && slot.parts.some((p) => p.visible),
  );

  for (const slot of slots) {
    if (slot.role === "eye") buildEyeSlot(out, slot, scaleX, scaleY);
    else if (slot.role === "mouth") buildMouthSlot(out, character, slot, scaleX, scaleY);
    else buildGenericSlot(out, slot, meta.poses, scaleX, scaleY);
  }

  if (!hasMouthSlot && character.mouthRig && character.mouthStyle !== "images") {
    buildGeneratedMouthSlot(
      out,
      character,
      character.mouthRig.placement,
      "role:mouth",
      scaleX,
      scaleY,
    );
  } else if (!hasMouthSlot && !character.mouthRig && character.fallbackMouth) {
    buildFallbackMouthRig(out, character, scaleX, scaleY);
  }

  out.html.push("</div>");
  return out;
}

function lipSyncOwnsMouth(meta: CharacterClipMeta): boolean {
  return !!meta.lipSyncAudioId || !!meta.visemes?.length;
}

function buildEyeSlot(
  out: PuppetDom,
  slot: CharacterSlotRef,
  scaleX: number,
  scaleY: number,
): void {
  const variants = eyeVariantsForSlot(slot);
  const openVariant = variants.find((variant) => variant.state === "open");
  const basePart = openVariant?.part ?? variants[0]?.part;
  if (!basePart) return;

  const containerId = slotContainerId(slot.id);
  const variantIds: Record<string, string> = {};
  const variantParts: Record<string, CharacterPart> = {};
  const activeState = openVariant?.state ?? variants[0].state;
  out.html.push(openSlotContainer(containerId, slot, basePart, scaleX, scaleY));
  for (const { state, part } of variants) {
    const id = partElementId(slot.id, state);
    const keys = [state, part.id];
    if (part.pose) keys.push(part.pose);
    if (part.eyeState) keys.push(part.eyeState);
    for (const key of keys) {
      variantIds[key] = id;
      variantParts[key] = part;
    }
    out.html.push(renderPartElement(id, part, basePart, state === activeState, scaleX, scaleY));
  }
  out.html.push("</div>");
  out.motionTargets.push({
    ...motionTargetFor(containerId, slot, basePart),
    defaultVariantKey: activeState,
    variantParts,
  });
  out.slotTimelines.push({
    slotId: slot.id,
    role: slot.role,
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
  scaleX: number,
  scaleY: number,
): void {
  if (character.mouthRig && character.mouthStyle === "rig") {
    buildGeneratedMouthSlot(out, character, character.mouthRig.placement, slot.id, scaleX, scaleY);
    return;
  }

  const visibleParts = slot.parts.filter((part) => part.visible);
  const restPart =
    visibleParts.find((part) => part.viseme === "rest" || part.pose === "rest") ?? visibleParts[0];
  if (!restPart) return;

  const containerId = slotContainerId(slot.id);
  const variants: Record<string, string> = {};
  const variantParts: Record<string, CharacterPart> = {};
  const renderedIds = new Set<string>();
  out.html.push(openSlotContainer(containerId, slot, restPart, scaleX, scaleY));
  for (const viseme of VISEMES) {
    const part = visibleParts.find(
      (candidate) => candidate.viseme === viseme || candidate.pose === viseme,
    );
    if (!part) continue;
    const id = partElementId(slot.id, viseme);
    variants[viseme] = id;
    variants[part.id] = id;
    variantParts[viseme] = part;
    variantParts[part.id] = part;
    if (part.pose) variants[part.pose] = id;
    if (part.pose) variantParts[part.pose] = part;
    if (part.viseme) {
      variants[part.viseme] = id;
      variantParts[part.viseme] = part;
    }
    renderedIds.add(id);
    out.html.push(renderPartElement(id, part, restPart, viseme === "rest", scaleX, scaleY));
  }
  for (const part of visibleParts) {
    const key = variantKeyForPart(part);
    const id = partElementId(slot.id, key);
    variants[key] = id;
    variants[part.id] = id;
    variantParts[key] = part;
    variantParts[part.id] = part;
    if (part.pose) variants[part.pose] = id;
    if (part.pose) variantParts[part.pose] = part;
    if (part.viseme) {
      variants[part.viseme] = id;
      variantParts[part.viseme] = part;
    }
    if (renderedIds.has(id)) continue;
    renderedIds.add(id);
    out.html.push(renderPartElement(id, part, restPart, part === restPart, scaleX, scaleY));
  }
  out.html.push("</div>");
  out.motionTargets.push({
    ...motionTargetFor(containerId, slot, restPart),
    defaultVariantKey: "rest",
    variantParts,
  });
  out.slotTimelines.push({
    slotId: slot.id,
    role: slot.role,
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
  const style = styleString({
    left: placement.x * scaleX,
    top: placement.y * scaleY,
    width: placement.width * scaleX,
    height: placement.height * scaleY,
    "z-index": placement.zIndex,
    "transform-origin": "50% 50%",
  });
  out.html.push(
    `<div id="${esc(containerId)}" data-character-slot="true" data-character-slot-id="${esc(
      slotId,
    )}" data-character-role="mouth" data-character-generated-mouth="true" style="${esc(style)}">`,
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
    )}" data-character-role="mouth" data-character-generated-mouth="fallback" style="${esc(
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

function buildGenericSlot(
  out: PuppetDom,
  slot: CharacterSlotRef,
  poses: Record<string, string>,
  scaleX: number,
  scaleY: number,
): void {
  const visibleParts = slot.parts.filter((part) => part.visible);
  const activePose = poses[slot.id];
  const activePart =
    (activePose
      ? visibleParts.find((part) => part.id === activePose || part.pose === activePose)
      : undefined) ?? visibleParts[0];
  if (!activePart) return;

  const containerId = slotContainerId(slot.id);
  const variants: Record<string, string> = {};
  const variantParts: Record<string, CharacterPart> = {};
  const activeKey = variantKeyForPart(activePart);
  out.html.push(openSlotContainer(containerId, slot, activePart, scaleX, scaleY));
  for (const part of visibleParts) {
    const key = variantKeyForPart(part);
    const id = partElementId(slot.id, key);
    variants[key] = id;
    variants[part.id] = id;
    variantParts[key] = part;
    variantParts[part.id] = part;
    if (part.pose) variants[part.pose] = id;
    if (part.pose) variantParts[part.pose] = part;
    out.html.push(renderPartElement(id, part, activePart, key === activeKey, scaleX, scaleY));
  }
  out.html.push("</div>");
  out.motionTargets.push({
    ...motionTargetFor(containerId, slot, activePart),
    defaultVariantKey: activeKey,
    variantParts,
  });
  out.slotTimelines.push({
    slotId: slot.id,
    role: slot.role,
    defaultKey: activeKey,
    render: {
      kind: "variant",
      variants,
    },
  });
}

function openSlotContainer(
  containerId: string,
  slot: CharacterSlotRef,
  basePart: CharacterPart,
  scaleX: number,
  scaleY: number,
): string {
  return `<div id="${esc(containerId)}" data-character-slot="true" data-character-slot-id="${esc(
    slot.id,
  )}" data-character-role="${esc(slot.role)}" data-character-side="${esc(
    basePart.side ?? "",
  )}" style="${esc(
    styleString({
      left: basePart.x * scaleX,
      top: basePart.y * scaleY,
      width: basePart.width * scaleX,
      height: basePart.height * scaleY,
      "z-index": basePart.zIndex,
      "transform-origin": `${basePart.anchorX * 100}% ${basePart.anchorY * 100}%`,
      transform: `rotate(${basePart.rotation}deg)`,
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
): string {
  const attrs = `id="${esc(id)}" data-character-part="true" data-character-part-id="${esc(
    part.id,
  )}" data-character-slot-id="${esc(part.slotId)}" data-character-role="${esc(
    part.role,
  )}" data-character-variant="${esc(variantKeyForPart(part))}"${
    part.pose ? ` data-character-pose="${esc(part.pose)}"` : ""
  }${part.viseme ? ` data-character-viseme="${esc(part.viseme)}"` : ""}${
    part.eyeState ? ` data-character-eye-state="${esc(part.eyeState)}"` : ""
  }`;
  const style = esc(
    styleString({
      left: (part.x - basePart.x) * scaleX,
      top: (part.y - basePart.y) * scaleY,
      width: part.width * scaleX,
      height: part.height * scaleY,
      opacity: visible ? 1 : 0,
      "z-index": part.zIndex - basePart.zIndex,
      "transform-origin": `${part.anchorX * 100}% ${part.anchorY * 100}%`,
      transform: `rotate(${part.rotation - basePart.rotation}deg)`,
    }),
  );

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
): MotionTarget {
  return {
    id,
    selector: `#${id}`,
    slotId: slot.id,
    role: slot.role,
    basePart,
    baseRotation: basePart.rotation,
    baseAnchorX: basePart.anchorX,
    baseAnchorY: basePart.anchorY,
  };
}

function buildSpeechAudio(compositionId: string, mediaId: string, duration: number): string {
  return `<audio id="${esc(safeId(`${compositionId}-speech`))}" data-character-speech="true" data-start="0" data-duration="${esc(
    duration,
  )}" data-track-index="0" src="asset:${esc(mediaId)}" preload="auto"></audio>`;
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
    slotTimelines: SlotTimeline[];
  },
): void {
  const blinkWindows = blinkWindowsForClip({
    id: args.clipId,
    duration: args.duration,
    autoBlink: args.meta.autoBlink,
  });
  const times = collectTimelineTimes(args.duration, args.meta, args.motionPresets, blinkWindows);
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
      args.slotTimelines,
      blinkWindows,
    ),
  );
  const slotEvents = buildSlotEvents(frames, args.slotTimelines);
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
  tl.to({}, { duration: S.duration }, 0);
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
      if (event.variant.show) tl.set("#" + event.variant.show, { opacity: 1 }, event.time);
    }
    if (event.generatedMouth) {
      Object.keys(event.generatedMouth.components || {}).forEach(function(selector) {
        tl.to(selector, Object.assign({ duration: event.generatedMouth.duration, ease: "none" }, event.generatedMouth.components[selector]), event.time);
      });
    }
  });
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
    const motionDuration = Math.max(0.0001, motion.duration ?? preset.duration);
    for (const occurrence of generateMotionOccurrences(motion, preset, duration)) {
      times.add(roundTime(Math.max(0, Math.min(duration, occurrence.start))));
      times.add(roundTime(Math.max(0, Math.min(duration, occurrence.end))));
      for (const track of preset.tracks) {
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
  slots: SlotTimeline[],
  blinkWindows: Array<{ start: number; end: number }>,
) {
  const composed = composeMotionsAt({ duration, motions: meta.motions }, time, presets);
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
      const delta = deltaFor(composed, target.role, target.slotId);
      const activePart = activePartForMotionTarget(target, composed, slotStates);
      const turn = activePart
        ? faceTurnMotionForPart(activePart, composed.faceTurnX, canvasWidth)
        : null;
      const { originX, originY } = transformOriginForMotionTarget(target, activePart, delta);
      const vars: GsapVars = {
        x: round((delta.dx + (turn?.dx ?? 0)) * scaleX, 3),
        y: round((delta.dy + (turn?.dy ?? 0)) * scaleY, 3),
        scaleX: round(delta.scale * delta.scaleX * (turn?.scaleX ?? 1), 4),
        scaleY: round(delta.scale * delta.scaleY * (turn?.scaleY ?? 1), 4),
        skewX: round(delta.skewX + (turn?.skewX ?? 0), 3),
        skewY: round(delta.skewY + (turn?.skewY ?? 0), 3),
        rotation: round(target.baseRotation + delta.rotation + (turn?.rotation ?? 0), 3),
        transformOrigin: `${round(originX * 100, 3)}% ${round(originY * 100, 3)}%`,
      };
      if (delta.opacity !== null) vars.opacity = round(delta.opacity, 4);
      return { selector: target.selector, vars };
    }),
  };
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
  if (state && target.variantParts?.[state]) return target.variantParts[state];
  const swap = poseSwapFor(composed, target.role, target.slotId);
  if (swap && target.variantParts?.[swap]) return target.variantParts[swap];
  if (target.defaultVariantKey && target.variantParts?.[target.defaultVariantKey]) {
    return target.variantParts[target.defaultVariantKey];
  }
  return target.basePart;
}

function transformOriginForMotionTarget(
  target: MotionTarget,
  activePart: CharacterPart | undefined,
  delta: ReturnType<typeof deltaFor>,
): { originX: number; originY: number } {
  const originPart = activePart ?? target.basePart;
  const partOriginX = delta.originX ?? originPart?.anchorX ?? target.baseAnchorX;
  const partOriginY = delta.originY ?? originPart?.anchorY ?? target.baseAnchorY;
  if (originPart && target.basePart && originPart !== target.basePart) {
    return {
      originX:
        (originPart.x - target.basePart.x + partOriginX * originPart.width) /
        Math.max(1, target.basePart.width),
      originY:
        (originPart.y - target.basePart.y + partOriginY * originPart.height) /
        Math.max(1, target.basePart.height),
    };
  }
  return { originX: partOriginX, originY: partOriginY };
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
  for (const entry of [...visemes].sort((a, b) => a.t - b.t)) {
    if (entry.t <= time + 0.0001) active = entry.v;
    else break;
  }
  return active;
}

function buildSlotEvents(
  frames: Array<{ time: number; slotStates: Map<string, string> }>,
  slots: SlotTimeline[],
) {
  const events: Array<{
    time: number;
    slotId: string;
    key: string;
    variant?: { hide: string[]; show?: string };
    generatedMouth?: { duration: number; components: Record<string, GsapVars> };
  }> = [];
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
      if (event) events.push(event);
    }
  }
  return events;
}

function slotRenderSignature(render: SlotRenderStrategy, key: string): string {
  if (render.kind === "variant") return render.variants[key] ?? render.variants.rest ?? key;
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
      variant?: { hide: string[]; show?: string };
      generatedMouth?: { duration: number; components: Record<string, GsapVars> };
    }
  | undefined {
  if (slot.render.kind === "variant") {
    return {
      time,
      slotId: slot.slotId,
      key,
      variant: {
        hide: unique(Object.values(slot.render.variants)),
        show: slot.render.variants[key] ?? slot.render.variants[slot.defaultKey],
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

function partElementId(slotId: string, variant: string): string {
  return `char-part-${safeId(slotId)}-${safeId(variant)}`;
}

function variantKeyForPart(part: CharacterPart): string {
  return part.viseme ?? part.eyeState ?? part.pose ?? part.id;
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
