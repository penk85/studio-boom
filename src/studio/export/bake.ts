// Pure baking functions: editorMeta + character + presets → HyperFramesProject.
// This is the ONLY path into HFComposition. All store mutations that touch
// character clip authoring state call bakeCharacterClip here.
import type {
  HyperFramesProject,
  HFClip,
  HFAttrs,
  HFComposition,
  HFElement,
  HFTimelineCall,
  HFAsset,
  ClipEditorMeta,
  CharacterPreset,
  MotionPreset,
  MediaAsset,
  MouthViseme,
  CharacterClip,
  CharacterPart,
} from "../types";
import {
  listCharacterSlots,
  roleEnabledByManifest,
} from "../character/character-utils";
import { eyeVariantsForSlot } from "../character/eye-state";
import { MOUTH_VIEWBOX, RIG_STYLES } from "../character/mouth-libraries";
import { slotDomId, visemeDomId, eyeDomId, rigComponentId } from "./timeline-builder";
import { recordCharacterTimeline } from "./timeline-serializer";

type CharacterSlot = ReturnType<typeof listCharacterSlots>[number];

const VISEMES: MouthViseme[] = ["rest", "A", "E", "O", "U", "MBP", "FV", "L", "WQ", "Smile"];

// ─── compositionSourceHash ────────────────────────────────────────────────────

/** Deterministic hash of all inputs to an HFComposition bake.
 *  Map<string, MotionPreset> is serialized as sorted [id, preset][] pairs —
 *  JSON.stringify(Map) produces "{}" which is non-deterministic and must not be used. */
export function compositionSourceHash(
  editorMeta: ClipEditorMeta,
  character: CharacterPreset,
  presets: Map<string, MotionPreset>,
  clipPixelWidth: number,
  clipPixelHeight: number,
): string {
  const sortedPresets = Array.from(presets.entries()).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify({
    editorMeta,
    character,
    presets: sortedPresets,
    clipPixelWidth,
    clipPixelHeight,
  });
}

// ─── validateHfProject ────────────────────────────────────────────────────────

/** Assert that every HFClip.mediaId and every HFElement.mediaId (recursively)
 *  exists in hf.assets. Throws if the asset closure is violated. */
export function validateHfProject(hf: HyperFramesProject): void {
  const assetIds = new Set(hf.assets.map((a) => a.id));
  const missing: string[] = [];

  for (const clip of hf.clips) {
    if (clip.mediaId && !assetIds.has(clip.mediaId)) {
      missing.push(`clip "${clip.id}": mediaId "${clip.mediaId}"`);
    }
  }

  for (const comp of hf.compositions) {
    collectMissingElementAssets(comp.elements, assetIds, `comp "${comp.id}"`, missing);
  }

  if (missing.length > 0) {
    throw new Error(`HF asset closure violated — missing assets:\n${missing.join("\n")}`);
  }
}

function collectMissingElementAssets(
  elements: HFElement[],
  assetIds: Set<string>,
  context: string,
  missing: string[],
): void {
  for (const el of elements) {
    if (el.mediaId && !assetIds.has(el.mediaId)) {
      missing.push(`${context} element "${el.id}": mediaId "${el.mediaId}"`);
    }
    if (el.children) {
      collectMissingElementAssets(el.children, assetIds, context, missing);
    }
  }
}

// ─── syncClipToHF ─────────────────────────────────────────────────────────────

/** Upsert a clip into hf.clips, returning a new HyperFramesProject.
 *  Caller is responsible for setting attrs["data-track-index"] via allocateHfTrackIndex()
 *  and attrs["data-composition-id"] = "comp_<clipId>" for character clips.
 *  No track-index formula lives here — only the allocator computes track indices. */
export function syncClipToHF(
  hf: HyperFramesProject,
  clip: {
    id: string;
    tag: HFClip["tag"];
    attrs: HFAttrs;
    style: Record<string, string | number>;
    mediaId?: string;
  },
): HyperFramesProject {
  const hfClip: HFClip = { ...clip };
  const idx = hf.clips.findIndex((c) => c.id === clip.id);
  const newClips =
    idx >= 0 ? hf.clips.map((c, i) => (i === idx ? hfClip : c)) : [...hf.clips, hfClip];
  return { ...hf, clips: newClips };
}

// ─── bakeCharacterClip ────────────────────────────────────────────────────────

/** Re-derive the HFComposition for one character clip from editor metadata.
 *  Reads clip pixel dimensions from hf.clips[clipId].style — single source,
 *  no divergence possible. Also creates/updates the sibling audio HFClip if
 *  editorMeta.lipSyncAudioId is set. Registers all character part images and
 *  lip-sync audio into hf.assets using mediaAssets. Returns an updated
 *  HyperFramesProject with composition + audio clip + assets refreshed. */
export function bakeCharacterClip(
  hf: HyperFramesProject,
  clipId: string,
  editorMeta: ClipEditorMeta,
  character: CharacterPreset,
  presets: Map<string, MotionPreset>,
  mediaAssets: Map<string, MediaAsset>,
): HyperFramesProject {
  const hfClip = hf.clips.find((c) => c.id === clipId);
  if (!hfClip) {
    throw new Error(`bakeCharacterClip: clip "${clipId}" not found in hf.clips`);
  }

  const clipPixelWidth = hfClip.style["width"] as number;
  const clipPixelHeight = hfClip.style["height"] as number;
  const clipDuration = (hfClip.attrs["data-duration"] as number) ?? 0;
  const scaleX = clipPixelWidth / character.canvasWidth;
  const scaleY = clipPixelHeight / character.canvasHeight;

  const elements = buildCompositionElements(clipId, character, scaleX, scaleY);

  // Internal adapter — never stored. Future: refactor recordCharacterTimeline to
  // accept ClipEditorMeta directly and remove this shim.
  const adapter = makeClipAdapter(clipId, editorMeta, clipPixelWidth, clipPixelHeight, clipDuration);
  const rawCalls = recordCharacterTimeline(adapter, character, presets);
  const timelineCalls = rawCalls as HFTimelineCall[];

  const compId = `comp_${clipId}`;
  const composition: HFComposition = {
    id: compId,
    sourceClipId: clipId,
    characterId: character.id,
    width: clipPixelWidth,
    height: clipPixelHeight,
    root: {
      attrs: {
        "data-composition-id": compId,
        "data-width": clipPixelWidth,
        "data-height": clipPixelHeight,
      },
      style: {
        position: "relative",
        width: clipPixelWidth,
        height: clipPixelHeight,
        overflow: "hidden",
      },
    },
    elements,
    timelineCalls,
    sourceHash: compositionSourceHash(editorMeta, character, presets, clipPixelWidth, clipPixelHeight),
    bakedAt: Date.now(),
    dirty: false,
  };

  // Register assets
  const assetMap = new Map(hf.assets.map((a) => [a.id, a]));
  for (const part of character.parts) {
    if (part.mediaId && !assetMap.has(part.mediaId)) {
      const asset = mediaAssets.get(part.mediaId);
      if (asset) assetMap.set(asset.id, toHFAsset(asset));
    }
  }
  if (editorMeta.lipSyncAudioId && !assetMap.has(editorMeta.lipSyncAudioId)) {
    const asset = mediaAssets.get(editorMeta.lipSyncAudioId);
    if (asset) assetMap.set(asset.id, toHFAsset(asset));
  }

  // Update compositions
  const compIdx = hf.compositions.findIndex((c) => c.sourceClipId === clipId);
  const newCompositions =
    compIdx >= 0
      ? hf.compositions.map((c, i) => (i === compIdx ? composition : c))
      : [...hf.compositions, composition];

  // Handle sibling audio clip
  let newClips = [...hf.clips];
  const audioClipId = `audio_${clipId}`;
  if (editorMeta.lipSyncAudioId) {
    const audioClip: HFClip = {
      id: audioClipId,
      tag: "audio",
      attrs: {
        "data-start": hfClip.attrs["data-start"],
        "data-duration": hfClip.attrs["data-duration"],
        "data-track-index": editorMeta.lipSyncTrackIndex ?? 0,
      },
      style: {},
      mediaId: editorMeta.lipSyncAudioId,
    };
    const audioIdx = newClips.findIndex((c) => c.id === audioClipId);
    newClips =
      audioIdx >= 0
        ? newClips.map((c, i) => (i === audioIdx ? audioClip : c))
        : [...newClips, audioClip];
  } else {
    newClips = newClips.filter((c) => c.id !== audioClipId);
  }

  return {
    ...hf,
    assets: Array.from(assetMap.values()),
    clips: newClips,
    compositions: newCompositions,
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function toHFAsset(asset: MediaAsset): HFAsset {
  return {
    id: asset.id,
    filename: asset.filename,
    mimeType: asset.mimeType,
    kind: asset.kind,
    width: asset.width,
    height: asset.height,
    duration: asset.duration,
  };
}

/** Shim to make ClipEditorMeta + dimensions compatible with CharacterClip.
 *  width/height MUST be clip-pixel values (already scaled from the character canvas). */
function makeClipAdapter(
  clipId: string,
  meta: ClipEditorMeta,
  clipPixelWidth: number,
  clipPixelHeight: number,
  clipDuration: number,
): CharacterClip {
  return {
    id: clipId,
    name: meta.name ?? "",
    kind: "character",
    trackIndex: meta.uiTrackIndex ?? 0,
    laneIndex: meta.uiLaneIndex ?? 0,
    start: 0,
    duration: clipDuration,
    x: 0,
    y: 0,
    width: clipPixelWidth,
    height: clipPixelHeight,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    characterId: meta.characterId ?? "",
    poses: meta.poses ?? {},
    lipSyncAudioId: meta.lipSyncAudioId,
    visemes: meta.visemes,
    motions: meta.motions,
    autoBlink: meta.autoBlink,
    voiceLine: meta.voiceLine,
  };
}

// ─── Element builders ─────────────────────────────────────────────────────────

function buildCompositionElements(
  clipId: string,
  character: CharacterPreset,
  scaleX: number,
  scaleY: number,
): HFElement[] {
  const elements: HFElement[] = [];

  if (character.mouthRig && character.mouthStyle !== "images") {
    const rigEl = buildMouthRigElement(clipId, character, scaleX, scaleY);
    if (rigEl) elements.push(rigEl);
  }

  const slots = listCharacterSlots(character.parts).filter((slot) =>
    roleEnabledByManifest(slot.role, character.manifest),
  );

  for (const slot of slots) {
    if (slot.role === "mouth" && character.mouthRig && character.mouthStyle !== "images") {
      continue;
    }
    const el =
      slot.role === "eye"
        ? buildEyeSlotElement(clipId, slot, scaleX, scaleY)
        : slot.role === "mouth"
          ? buildMouthSlotElement(clipId, slot, scaleX, scaleY)
          : buildGenericSlotElement(clipId, slot, scaleX, scaleY);
    if (el) elements.push(el);
  }

  return elements;
}

function buildSlotContainer(
  id: string,
  basePart: CharacterPart,
  scaleX: number,
  scaleY: number,
  children: HFElement[],
): HFElement {
  return {
    id,
    tag: "div",
    attrs: {},
    style: {
      position: "absolute",
      left: basePart.x * scaleX,
      top: basePart.y * scaleY,
      width: basePart.width * scaleX,
      height: basePart.height * scaleY,
      "z-index": basePart.zIndex,
      "transform-origin": `${basePart.anchorX * 100}% ${basePart.anchorY * 100}%`,
      overflow: "visible",
      "pointer-events": "none",
    },
    children,
  };
}

function buildPartElement(
  part: CharacterPart,
  id: string,
  basePart: CharacterPart,
  scaleX: number,
  scaleY: number,
  opacity: number,
): HFElement {
  const style: Record<string, string | number> = {
    position: "absolute",
    left: (part.x - basePart.x) * scaleX,
    top: (part.y - basePart.y) * scaleY,
    width: part.width * scaleX,
    height: part.height * scaleY,
    opacity,
    "transform-origin": `${part.anchorX * 100}% ${part.anchorY * 100}%`,
    "pointer-events": "none",
    overflow: "visible",
  };

  if (part.morph?.primaryPath) {
    const viewBox = part.morph.viewBox ?? `0 0 ${part.width} ${part.height}`;
    const fill = part.morph.fill ?? "#733f43";
    // trust boundary: primaryPath/fill come from user-uploaded SVG, not sanitized here.
    // these values are the same trust level as the existing composition-builder.ts code.
    const strokeAttrs = part.morph.stroke
      ? ` stroke="${part.morph.stroke}" stroke-width="${part.morph.strokeWidth ?? 1}"`
      : "";
    return {
      id,
      tag: "svg",
      attrs: { viewBox, "aria-hidden": "true", overflow: "visible" },
      style,
      svgContent: `<path d="${part.morph.primaryPath}" fill="${fill}"${strokeAttrs}/>`,
    };
  }

  return {
    id,
    tag: "img",
    attrs: { alt: "", draggable: "false" },
    style,
    mediaId: part.mediaId,
  };
}

function buildEyeSlotElement(
  clipId: string,
  slot: CharacterSlot,
  scaleX: number,
  scaleY: number,
): HFElement | null {
  const variants = eyeVariantsForSlot(slot);
  const openVariant = variants.find((v) => v.state === "open");
  const basePart = openVariant?.part ?? variants[0]?.part;
  if (!basePart) return null;

  const children = variants.map(({ state, part }) =>
    buildPartElement(
      part,
      eyeDomId(clipId, slot.id, state),
      basePart,
      scaleX,
      scaleY,
      state === "open" || (!openVariant && variants[0].state === state) ? 1 : 0,
    ),
  );

  return buildSlotContainer(slotDomId(clipId, slot.id), basePart, scaleX, scaleY, children);
}

function buildMouthSlotElement(
  clipId: string,
  slot: CharacterSlot,
  scaleX: number,
  scaleY: number,
): HFElement | null {
  const restPart =
    slot.parts.find((p) => p.visible && (p.viseme === "rest" || p.pose === "rest")) ??
    slot.parts.find((p) => p.visible);
  if (!restPart) return null;

  const children: HFElement[] = [];
  for (const viseme of VISEMES) {
    const part = slot.parts.find((p) => p.visible && (p.viseme === viseme || p.pose === viseme));
    if (!part) continue;
    children.push(
      buildPartElement(
        part,
        visemeDomId(clipId, slot.id, viseme),
        restPart,
        scaleX,
        scaleY,
        viseme === "rest" ? 1 : 0,
      ),
    );
  }

  return buildSlotContainer(slotDomId(clipId, slot.id), restPart, scaleX, scaleY, children);
}

function buildGenericSlotElement(
  clipId: string,
  slot: CharacterSlot,
  scaleX: number,
  scaleY: number,
): HFElement | null {
  const part = slot.parts.find((p) => p.visible);
  if (!part) return null;

  const containerId = slotDomId(clipId, slot.id);
  const containerStyle: Record<string, string | number> = {
    position: "absolute",
    left: part.x * scaleX,
    top: part.y * scaleY,
    width: part.width * scaleX,
    height: part.height * scaleY,
    "z-index": part.zIndex,
    "transform-origin": `${part.anchorX * 100}% ${part.anchorY * 100}%`,
    overflow: "visible",
    "pointer-events": "none",
  };

  const innerStyle: Record<string, string | number> = {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    "pointer-events": "none",
  };

  if (part.morph?.primaryPath) {
    const viewBox = part.morph.viewBox ?? `0 0 ${part.width} ${part.height}`;
    const fill = part.morph.fill ?? "#733f43";
    const strokeAttrs = part.morph.stroke
      ? ` stroke="${part.morph.stroke}" stroke-width="${part.morph.strokeWidth ?? 1}"`
      : "";
    const innerSvg: HFElement = {
      id: `${containerId}-svg`,
      tag: "svg",
      attrs: { viewBox, "aria-hidden": "true", overflow: "visible" },
      style: innerStyle,
      svgContent: `<path d="${part.morph.primaryPath}" fill="${fill}"${strokeAttrs}/>`,
    };
    return { id: containerId, tag: "div", attrs: {}, style: containerStyle, children: [innerSvg] };
  }

  const innerImg: HFElement = {
    id: `${containerId}-img`,
    tag: "img",
    attrs: { alt: "", draggable: "false" },
    style: innerStyle,
    mediaId: part.mediaId,
  };
  return { id: containerId, tag: "div", attrs: {}, style: containerStyle, children: [innerImg] };
}

function buildMouthRigElement(
  clipId: string,
  character: CharacterPreset,
  scaleX: number,
  scaleY: number,
): HFElement | null {
  const { mouthRig } = character;
  if (!mouthRig) return null;

  const rigStyle = RIG_STYLES.find((s) => s.id === mouthRig.styleId) ?? RIG_STYLES[0];
  const { placement } = mouthRig;

  // transform-origin matches the original: 50% vertically = 30/60 of viewBox height
  const componentStyle: Record<string, string | number> = {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    "transform-origin": `50% ${(30 / 60) * 100}%`,
  };

  // svgContent trust boundary: RIG_STYLES paths are internal constants, never user input
  const makeSvgEl = (id: string, path: string, fill: string, opacity?: number): HFElement => ({
    id,
    tag: "svg",
    attrs: { viewBox: MOUTH_VIEWBOX, "aria-hidden": "true" },
    style: opacity !== undefined ? { ...componentStyle, opacity } : { ...componentStyle },
    svgContent: `<path d="${path}" fill="${fill}"/>`,
  });

  return {
    id: rigComponentId(clipId, "container"),
    tag: "div",
    attrs: {},
    style: {
      position: "absolute",
      left: placement.x * scaleX,
      top: placement.y * scaleY,
      width: placement.width * scaleX,
      height: placement.height * scaleY,
      "z-index": placement.zIndex,
      overflow: "visible",
      "pointer-events": "none",
      "transform-origin": "50% 50%",
    },
    children: [
      makeSvgEl(rigComponentId(clipId, "interior"), rigStyle.interiorPath, mouthRig.interiorColor),
      makeSvgEl(rigComponentId(clipId, "tongue"), rigStyle.tonguePath, mouthRig.tongueColor, 0),
      makeSvgEl(rigComponentId(clipId, "teeth"), rigStyle.teethPath, mouthRig.teethColor, 0),
      makeSvgEl(rigComponentId(clipId, "lower-lip"), rigStyle.lowerLipPath, mouthRig.lipColor),
      makeSvgEl(rigComponentId(clipId, "upper-lip"), rigStyle.upperLipPath, mouthRig.lipColor),
    ],
  };
}
