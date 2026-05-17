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
import { blinkWindowsForClip } from "./eye-state";
import { eyeVariantsForSlot } from "./eye-state";
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
  baseRotation: number;
  baseAnchorX: number;
  baseAnchorY: number;
}

interface VariantTimelineSlot {
  slotId: string;
  role: PartRole;
  defaultKey: string;
  variants: Record<string, string>;
}

interface BlinkTimelineSlot {
  slotId: string;
  openId?: string;
  closedId?: string;
  halfId?: string;
  winkId?: string;
}

interface MouthImageSlot {
  slotId: string;
  variants: Record<string, string>;
}

interface MouthRigSlot {
  slotId: string;
  componentIds: {
    upperLip: string;
    lowerLip: string;
    interior: string;
    teeth: string;
    tongue: string;
  };
  visemeVars: Partial<Record<MouthViseme, RigTimelineVars>>;
}

interface RigTimelineVars {
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
  variantSlots: VariantTimelineSlot[];
  blinkSlots: BlinkTimelineSlot[];
  mouthImageSlots: MouthImageSlot[];
  mouthRigSlots: MouthRigSlot[];
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
    variantSlots: dom.variantSlots,
    blinkSlots: dom.blinkSlots,
    mouthImageSlots: dom.mouthImageSlots,
    mouthRigSlots: dom.mouthRigSlots,
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
[data-character-rig-component] {
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
    variantSlots: [],
    blinkSlots: [],
    mouthImageSlots: [],
    mouthRigSlots: [],
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
    buildMouthRigSlot(out, character, character.mouthRig.placement, "role:mouth", scaleX, scaleY);
  } else if (!hasMouthSlot && !character.mouthRig && character.fallbackMouth) {
    buildFallbackMouthRig(out, character, scaleX, scaleY);
  }

  out.html.push("</div>");
  return out;
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
  const activeState = openVariant?.state ?? variants[0].state;
  out.html.push(openSlotContainer(containerId, slot, basePart, scaleX, scaleY));
  for (const { state, part } of variants) {
    const id = partElementId(slot.id, state);
    variantIds[state] = id;
    out.html.push(renderPartElement(id, part, basePart, state === activeState, scaleX, scaleY));
  }
  out.html.push("</div>");
  out.motionTargets.push(motionTargetFor(containerId, slot, basePart));
  out.variantSlots.push({
    slotId: slot.id,
    role: slot.role,
    defaultKey: activeState,
    variants: variantIds,
  });
  out.blinkSlots.push({
    slotId: slot.id,
    openId: variantIds.open,
    closedId: variantIds.closed,
    halfId: variantIds.half,
    winkId: variantIds.wink,
  });
}

function buildMouthSlot(
  out: PuppetDom,
  character: CharacterPreset,
  slot: CharacterSlotRef,
  scaleX: number,
  scaleY: number,
): void {
  if (character.mouthRig && character.mouthStyle !== "images") {
    buildMouthRigSlot(out, character, character.mouthRig.placement, slot.id, scaleX, scaleY);
    return;
  }

  const visibleParts = slot.parts.filter((part) => part.visible);
  const restPart =
    visibleParts.find((part) => part.viseme === "rest" || part.pose === "rest") ?? visibleParts[0];
  if (!restPart) return;

  const containerId = slotContainerId(slot.id);
  const variants: Record<string, string> = {};
  out.html.push(openSlotContainer(containerId, slot, restPart, scaleX, scaleY));
  for (const viseme of VISEMES) {
    const part = visibleParts.find(
      (candidate) => candidate.viseme === viseme || candidate.pose === viseme,
    );
    if (!part) continue;
    const id = partElementId(slot.id, viseme);
    variants[viseme] = id;
    out.html.push(renderPartElement(id, part, restPart, viseme === "rest", scaleX, scaleY));
  }
  out.html.push("</div>");
  out.motionTargets.push(motionTargetFor(containerId, slot, restPart));
  out.mouthImageSlots.push({ slotId: slot.id, variants });
}

function buildMouthRigSlot(
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
    upperLip: `char-rig-${safeSlot}-upper-lip`,
    lowerLip: `char-rig-${safeSlot}-lower-lip`,
    interior: `char-rig-${safeSlot}-interior`,
    teeth: `char-rig-${safeSlot}-teeth`,
    tongue: `char-rig-${safeSlot}-tongue`,
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
    )}" data-character-role="mouth" data-character-rig="mouth" style="${esc(style)}">`,
  );
  out.html.push(
    renderRigComponent(
      componentIds.interior,
      "interior",
      rigStyle.interiorPath,
      mouthRig.interiorColor,
    ),
  );
  out.html.push(
    renderRigComponent(componentIds.tongue, "tongue", rigStyle.tonguePath, mouthRig.tongueColor, 0),
  );
  out.html.push(
    renderRigComponent(componentIds.teeth, "teeth", rigStyle.teethPath, mouthRig.teethColor, 0),
  );
  out.html.push(
    renderRigComponent(
      componentIds.lowerLip,
      "lower-lip",
      rigStyle.lowerLipPath,
      mouthRig.lipColor,
    ),
  );
  out.html.push(
    renderRigComponent(
      componentIds.upperLip,
      "upper-lip",
      rigStyle.upperLipPath,
      mouthRig.lipColor,
    ),
  );
  out.html.push("</div>");
  out.motionTargets.push({
    id: containerId,
    selector: `#${containerId}`,
    slotId,
    role: "mouth",
    baseRotation: "rotation" in placement ? placement.rotation : 0,
    baseAnchorX: "anchorX" in placement ? placement.anchorX : 0.5,
    baseAnchorY: "anchorY" in placement ? placement.anchorY : 0.5,
  });
  out.mouthRigSlots.push({
    slotId,
    componentIds,
    visemeVars: Object.fromEntries(
      VISEMES.map((viseme) => [
        viseme,
        rigVarsForPose(
          mouthRig.poses[viseme] ?? mouthRig.poses.rest ?? VISEME_POSES[viseme],
          rigStyle,
          mouthRig,
        ),
      ]),
    ),
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
    )}" data-character-role="mouth" data-character-rig="fallback-mouth" style="${esc(
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
    renderRigComponent(componentIds.interior, "interior", rigStyle.interiorPath, "#23090b"),
  );
  out.html.push(
    renderRigComponent(componentIds.tongue, "tongue", rigStyle.tonguePath, "#d96b76", 0),
  );
  out.html.push(renderRigComponent(componentIds.teeth, "teeth", rigStyle.teethPath, "#fff2df", 0));
  out.html.push(
    renderRigComponent(componentIds.lowerLip, "lower-lip", rigStyle.lowerLipPath, "#b35b68"),
  );
  out.html.push(
    renderRigComponent(componentIds.upperLip, "upper-lip", rigStyle.upperLipPath, "#b35b68"),
  );
  out.html.push("</div>");
  out.motionTargets.push({
    id: containerId,
    selector: `#${containerId}`,
    slotId,
    role: "mouth",
    baseRotation: placement.rotation,
    baseAnchorX: placement.anchorX,
    baseAnchorY: placement.anchorY,
  });
  out.mouthRigSlots.push({
    slotId,
    componentIds,
    visemeVars: Object.fromEntries(
      VISEMES.map((viseme) => [viseme, rigVarsForPose(VISEME_POSES[viseme], rigStyle)]),
    ),
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
  const activeKey = variantKeyForPart(activePart);
  out.html.push(openSlotContainer(containerId, slot, activePart, scaleX, scaleY));
  for (const part of visibleParts) {
    const key = variantKeyForPart(part);
    const id = partElementId(slot.id, key);
    variants[key] = id;
    variants[part.id] = id;
    if (part.pose) variants[part.pose] = id;
    out.html.push(renderPartElement(id, part, activePart, key === activeKey, scaleX, scaleY));
  }
  out.html.push("</div>");
  out.motionTargets.push(motionTargetFor(containerId, slot, activePart));
  out.variantSlots.push({
    slotId: slot.id,
    role: slot.role,
    defaultKey: activeKey,
    variants,
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

function renderRigComponent(
  id: string,
  component: string,
  path: string,
  fill: string,
  opacity?: number,
): string {
  return `<svg id="${esc(id)}" data-character-rig-component="${esc(
    component,
  )}" viewBox="${esc(MOUTH_VIEWBOX)}" aria-hidden="true" style="${esc(
    styleString({ opacity: opacity ?? 1, "transform-origin": "50% 50%" }),
  )}"><path d="${esc(path)}" fill="${esc(fill)}"/></svg>`;
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
    variantSlots: VariantTimelineSlot[];
    blinkSlots: BlinkTimelineSlot[];
    mouthImageSlots: MouthImageSlot[];
    mouthRigSlots: MouthRigSlot[];
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
    ),
  );
  const variantEvents = buildVariantEvents(
    times,
    args.duration,
    args.meta,
    args.motionPresets,
    args.variantSlots,
  );
  const motionSegments = frames.slice(1).map((frame, index) => ({
    start: frames[index].time,
    duration: roundTime(frame.time - frames[index].time),
    targets: frame.targets,
  }));

  const scene = {
    duration: args.duration,
    initialTargets: frames[0]?.targets ?? [],
    motionSegments,
    variantEvents,
    blinkEvents: buildBlinkEvents(blinkWindows, args.blinkSlots),
    mouthImageEvents: buildMouthImageEvents(args.meta.visemes ?? [], args.mouthImageSlots),
    mouthRigEvents: buildMouthRigEvents(args.meta.visemes ?? [], args.mouthRigSlots),
  };
  const sceneJson = safeJson(scene);
  const script = doc.createElement("script");
  script.textContent = `(function(){
  const S = ${sceneJson};
  const tl = gsap.timeline({ paused: true });
  const setVars = function(targets, time) {
    targets.forEach(function(target) { tl.set(target.selector, target.vars, time); });
  };
  setVars(S.initialTargets || [], 0);
  (S.motionSegments || []).forEach(function(segment) {
    (segment.targets || []).forEach(function(target) {
      tl.to(target.selector, Object.assign({ duration: segment.duration, ease: "none" }, target.vars), segment.start);
    });
  });
  (S.variantEvents || []).forEach(function(event) {
    (event.hide || []).forEach(function(id) { tl.set("#" + id, { opacity: 0 }, event.time); });
    if (event.show) tl.set("#" + event.show, { opacity: 1 }, event.time);
  });
  (S.blinkEvents || []).forEach(function(event) {
    (event.hide || []).forEach(function(id) { tl.set("#" + id, { opacity: 0 }, event.time); });
    (event.show || []).forEach(function(id) { tl.set("#" + id, { opacity: 1 }, event.time); });
  });
  (S.mouthImageEvents || []).forEach(function(event) {
    (event.hide || []).forEach(function(id) { tl.set("#" + id, { opacity: 0 }, event.time); });
    if (event.show) tl.set("#" + event.show, { opacity: 1 }, event.time);
  });
  (S.mouthRigEvents || []).forEach(function(event) {
    Object.keys(event.components || {}).forEach(function(selector) {
      tl.to(selector, Object.assign({ duration: 0.045, ease: "none" }, event.components[selector]), event.time);
    });
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
) {
  const composed = composeMotionsAt({ duration, motions: meta.motions }, time, presets);
  return {
    time,
    targets: motionTargets.map((target) => {
      const delta = deltaFor(composed, target.role, target.slotId);
      const originX = delta.originX ?? target.baseAnchorX;
      const originY = delta.originY ?? target.baseAnchorY;
      const vars: GsapVars = {
        x: round(delta.dx * scaleX, 3),
        y: round(delta.dy * scaleY, 3),
        scaleX: round(delta.scale * delta.scaleX, 4),
        scaleY: round(delta.scale * delta.scaleY, 4),
        skewX: round(delta.skewX, 3),
        skewY: round(delta.skewY, 3),
        rotation: round(target.baseRotation + delta.rotation, 3),
        transformOrigin: `${round(originX * 100, 3)}% ${round(originY * 100, 3)}%`,
      };
      if (delta.opacity !== null) vars.opacity = round(delta.opacity, 4);
      return { selector: target.selector, vars };
    }),
  };
}

function buildVariantEvents(
  times: number[],
  duration: number,
  meta: CharacterClipMeta,
  presets: Map<string, MotionPreset>,
  variantSlots: VariantTimelineSlot[],
) {
  const events: Array<{ time: number; hide: string[]; show?: string }> = [];
  const previous = new Map<string, string>();
  for (const time of times) {
    const composed = composeMotionsAt({ duration, motions: meta.motions }, time, presets);
    for (const slot of variantSlots) {
      const swap = poseSwapFor(composed, slot.role, slot.slotId);
      const key = swap && slot.variants[swap] ? swap : slot.defaultKey;
      const show = slot.variants[key] ?? slot.variants[slot.defaultKey];
      if (!show || previous.get(slot.slotId) === show) continue;
      previous.set(slot.slotId, show);
      events.push({
        time,
        hide: unique(Object.values(slot.variants)),
        show,
      });
    }
  }
  return events;
}

function buildBlinkEvents(
  blinkWindows: Array<{ start: number; end: number }>,
  blinkSlots: BlinkTimelineSlot[],
) {
  const events: Array<{ time: number; hide: string[]; show: string[] }> = [];
  for (const window of blinkWindows) {
    for (const slot of blinkSlots) {
      const closed = slot.closedId ?? slot.halfId ?? slot.winkId;
      if (!closed || !slot.openId) continue;
      events.push({
        time: roundTime(window.start),
        hide: [slot.openId],
        show: [closed],
      });
      events.push({
        time: roundTime(window.end),
        hide: [closed],
        show: [slot.openId],
      });
    }
  }
  return events;
}

function buildMouthImageEvents(
  visemes: Array<{ t: number; v: MouthViseme }>,
  slots: MouthImageSlot[],
) {
  const events: Array<{ time: number; hide: string[]; show?: string }> = [];
  for (const slot of slots) {
    const all = unique(Object.values(slot.variants));
    if (slot.variants.rest) events.push({ time: 0, hide: all, show: slot.variants.rest });
    for (const viseme of visemes) {
      events.push({
        time: roundTime(viseme.t),
        hide: all,
        show: slot.variants[viseme.v] ?? slot.variants.rest,
      });
    }
  }
  return events;
}

function buildMouthRigEvents(visemes: Array<{ t: number; v: MouthViseme }>, slots: MouthRigSlot[]) {
  const events: Array<{ time: number; components: Record<string, GsapVars> }> = [];
  const ordered = [{ t: 0, v: "rest" as MouthViseme }, ...visemes].sort((a, b) => a.t - b.t);
  for (const entry of ordered) {
    for (const slot of slots) {
      const vars = slot.visemeVars[entry.v] ?? slot.visemeVars.rest;
      if (!vars) continue;
      events.push({
        time: roundTime(entry.t),
        components: {
          [`#${slot.componentIds.upperLip}`]: vars.upperLip,
          [`#${slot.componentIds.lowerLip}`]: vars.lowerLip,
          [`#${slot.componentIds.interior}`]: vars.interior,
          [`#${slot.componentIds.teeth}`]: vars.teeth,
          [`#${slot.componentIds.tongue}`]: vars.tongue,
        },
      });
    }
  }
  return events;
}

function rigVarsForPose(
  pose: MouthPose,
  style: (typeof RIG_STYLES)[number],
  rig?: CharacterPreset["mouthRig"],
): RigTimelineVars {
  const t = poseToTransforms(pose, style, {
    upperCurve: rig?.upperCurve,
    lowerCurve: rig?.lowerCurve,
  });
  return rigVarsFromTransforms(t);
}

function rigVarsFromTransforms(t: RigTransforms): RigTimelineVars {
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
  return clean || "part";
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
