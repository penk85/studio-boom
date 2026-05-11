// Legacy character composition builder.
// This file originally turned character rigs, visemes, and motion intent into a
// standalone HyperFrames sub-composition. It is intentionally isolated while the
// character architecture is refactored; remove or reuse it during that work.
import type { ClipEditorMeta, CharacterPreset, MouthViseme, CharacterPart } from "../types";
import { listCharacterSlots, roleEnabledByManifest } from "../character/character-utils";
import { eyeVariantsForSlot } from "../character/eye-state";
import { MOUTH_VIEWBOX, RIG_STYLES } from "../character/mouth-libraries";

const VISEMES: MouthViseme[] = ["rest", "A", "E", "O", "U", "MBP", "FV", "L", "WQ", "Smile"];

// ─── DOM ID helpers (used by composition HTML + runtime) ──────────────────────

export function slotContainerId(slotId: string): string {
  return `slot-${slotId}`;
}

export function eyePartId(slotId: string, state: string): string {
  return `eye-${slotId}-${state}`;
}

export function mouthPartId(slotId: string, viseme: string): string {
  return `mouth-${slotId}-${viseme}`;
}

export function rigPartId(component: string): string {
  return `rig-${component}`;
}

// ─── Scene data types ─────────────────────────────────────────────────────────

interface BlinkSlot {
  openId: string;
  closedId?: string;
  halfId?: string;
  winkId?: string;
}

interface MouthSlot {
  visemes: Record<string, string>; // viseme name → element id
  isRig: boolean;
}

interface SceneData {
  compositionId: string;
  duration: number;
  autoBlink: boolean;
  blinkEvery: number;
  blinkOffset: number;
  blinkSlots: BlinkSlot[];
  mouthSlots: MouthSlot[];
  visemes: { t: number; v: string }[];
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/** Build a self-contained character composition HTML string from editor meta. */
export function buildCharacterCompositionHtml(
  compId: string,
  clipPixelWidth: number,
  clipPixelHeight: number,
  duration: number,
  editorMeta: ClipEditorMeta,
  character: CharacterPreset,
  resolveUrl: (mediaId: string) => string,
): string {
  const scaleX = clipPixelWidth / character.canvasWidth;
  const scaleY = clipPixelHeight / character.canvasHeight;

  const slots = listCharacterSlots(character.parts).filter((slot) =>
    roleEnabledByManifest(slot.role, character.manifest),
  );

  const domParts: string[] = [];
  const blinkSlots: BlinkSlot[] = [];
  const mouthSlots: MouthSlot[] = [];

  for (const slot of slots) {
    if (slot.role === "eye") {
      const { html, blinkSlot } = buildEyeSlot(slot, scaleX, scaleY, resolveUrl);
      if (html) {
        domParts.push(html);
        if (blinkSlot) blinkSlots.push(blinkSlot);
      }
    } else if (slot.role === "mouth") {
      if (character.mouthRig && character.mouthStyle !== "images") {
        const { html, mouthSlot } = buildMouthRigSlot(character, scaleX, scaleY);
        if (html) {
          domParts.push(html);
          mouthSlots.push(mouthSlot);
        }
      } else {
        const { html, mouthSlot } = buildMouthSlot(slot, scaleX, scaleY, resolveUrl);
        if (html) {
          domParts.push(html);
          mouthSlots.push(mouthSlot);
        }
      }
    } else {
      const html = buildGenericSlot(slot, scaleX, scaleY, resolveUrl, editorMeta.poses);
      if (html) domParts.push(html);
    }
  }

  const sceneData: SceneData = {
    compositionId: compId,
    duration,
    autoBlink: editorMeta.autoBlink ?? false,
    blinkEvery: 3.5,
    blinkOffset: 1.0,
    blinkSlots,
    mouthSlots,
    visemes: editorMeta.visemes?.map((v) => ({ t: v.t, v: v.v })) ?? [],
  };

  return buildCompositionDocument(compId, clipPixelWidth, clipPixelHeight, domParts, sceneData);
}

// ─── DOM builders ─────────────────────────────────────────────────────────────

function styleStr(style: Record<string, string | number>): string {
  return Object.entries(style)
    .map(([k, v]) => `${k}:${typeof v === "number" ? `${v}px` : v}`)
    .join(";");
}

function slotContainerStyle(
  part: CharacterPart,
  scaleX: number,
  scaleY: number,
): Record<string, string | number> {
  return {
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
}

function partImgStyle(
  part: CharacterPart,
  basePart: CharacterPart,
  scaleX: number,
  scaleY: number,
  opacity: number,
): Record<string, string | number> {
  return {
    position: "absolute",
    left: (part.x - basePart.x) * scaleX,
    top: (part.y - basePart.y) * scaleY,
    width: part.width * scaleX,
    height: part.height * scaleY,
    opacity,
    "transform-origin": `${part.anchorX * 100}% ${part.anchorY * 100}%`,
    "pointer-events": "none",
  };
}

function renderPartImg(
  id: string,
  part: CharacterPart,
  basePart: CharacterPart,
  scaleX: number,
  scaleY: number,
  opacity: number,
  resolveUrl: (mediaId: string) => string,
): string {
  if (part.morph?.primaryPath) {
    const viewBox = part.morph.viewBox ?? `0 0 ${part.width} ${part.height}`;
    const fill = esc(part.morph.fill ?? "#733f43");
    const strokeAttrs = part.morph.stroke
      ? ` stroke="${esc(part.morph.stroke)}" stroke-width="${esc(String(part.morph.strokeWidth ?? 1))}"`
      : "";
    return `<svg id="${esc(id)}" viewBox="${esc(viewBox)}" aria-hidden="true" overflow="visible" style="${esc(styleStr(partImgStyle(part, basePart, scaleX, scaleY, opacity)))}"><path d="${esc(part.morph.primaryPath)}" fill="${fill}"${strokeAttrs}/></svg>`;
  }
  return `<img id="${esc(id)}" src="${esc(resolveUrl(part.mediaId))}" alt="" draggable="false" style="${esc(styleStr(partImgStyle(part, basePart, scaleX, scaleY, opacity)))}">`;
}

function buildEyeSlot(
  slot: ReturnType<typeof listCharacterSlots>[number],
  scaleX: number,
  scaleY: number,
  resolveUrl: (mediaId: string) => string,
): { html: string | null; blinkSlot: BlinkSlot | null } {
  const variants = eyeVariantsForSlot(slot);
  const openVariant = variants.find((v) => v.state === "open");
  const basePart = openVariant?.part ?? variants[0]?.part;
  if (!basePart) return { html: null, blinkSlot: null };

  const containerId = slotContainerId(slot.id);
  const children = variants
    .map(({ state, part }) =>
      renderPartImg(
        eyePartId(slot.id, state),
        part,
        basePart,
        scaleX,
        scaleY,
        state === "open" || (!openVariant && variants[0].state === state) ? 1 : 0,
        resolveUrl,
      ),
    )
    .join("\n  ");

  const html = `<div id="${esc(containerId)}" style="${esc(styleStr(slotContainerStyle(basePart, scaleX, scaleY)))}">\n  ${children}\n</div>`;

  const blinkSlot: BlinkSlot = {
    openId: eyePartId(slot.id, "open"),
    closedId: variants.find((v) => v.state === "closed") ? eyePartId(slot.id, "closed") : undefined,
    halfId: variants.find((v) => v.state === "half") ? eyePartId(slot.id, "half") : undefined,
    winkId: variants.find((v) => v.state === "wink") ? eyePartId(slot.id, "wink") : undefined,
  };

  return { html, blinkSlot };
}

function buildMouthSlot(
  slot: ReturnType<typeof listCharacterSlots>[number],
  scaleX: number,
  scaleY: number,
  resolveUrl: (mediaId: string) => string,
): { html: string | null; mouthSlot: MouthSlot } {
  const restPart =
    slot.parts.find((p) => p.visible && (p.viseme === "rest" || p.pose === "rest")) ??
    slot.parts.find((p) => p.visible);
  if (!restPart) return { html: null, mouthSlot: { visemes: {}, isRig: false } };

  const visemeMap: Record<string, string> = {};
  const children: string[] = [];

  for (const viseme of VISEMES) {
    const part = slot.parts.find((p) => p.visible && (p.viseme === viseme || p.pose === viseme));
    if (!part) continue;
    const id = mouthPartId(slot.id, viseme);
    visemeMap[viseme] = id;
    children.push(
      renderPartImg(id, part, restPart, scaleX, scaleY, viseme === "rest" ? 1 : 0, resolveUrl),
    );
  }

  const containerId = slotContainerId(slot.id);
  const html = `<div id="${esc(containerId)}" style="${esc(styleStr(slotContainerStyle(restPart, scaleX, scaleY)))}">\n  ${children.join("\n  ")}\n</div>`;

  return { html, mouthSlot: { visemes: visemeMap, isRig: false } };
}

function buildMouthRigSlot(
  character: CharacterPreset,
  scaleX: number,
  scaleY: number,
): { html: string | null; mouthSlot: MouthSlot } {
  const { mouthRig } = character;
  if (!mouthRig) return { html: null, mouthSlot: { visemes: {}, isRig: true } };

  const rigStyle = RIG_STYLES.find((s) => s.id === mouthRig.styleId) ?? RIG_STYLES[0];
  const { placement } = mouthRig;

  const containerStyle = styleStr({
    position: "absolute",
    left: placement.x * scaleX,
    top: placement.y * scaleY,
    width: placement.width * scaleX,
    height: placement.height * scaleY,
    "z-index": placement.zIndex,
    overflow: "visible",
    "pointer-events": "none",
    "transform-origin": "50% 50%",
  });

  const componentStyle = `position:absolute;top:0;left:0;width:100%;height:100%;transform-origin:50% ${(30 / 60) * 100}%`;

  const makeSvg = (id: string, path: string, fill: string, opacity?: number): string => {
    const opacityStr = opacity !== undefined ? `;opacity:${opacity}` : "";
    return `<svg id="${esc(id)}" viewBox="${esc(MOUTH_VIEWBOX)}" aria-hidden="true" style="${esc(componentStyle + opacityStr)}"><path d="${esc(path)}" fill="${esc(fill)}"/></svg>`;
  };

  const html = `<div id="${esc(rigPartId("container"))}" style="${esc(containerStyle)}">
  ${makeSvg(rigPartId("interior"), rigStyle.interiorPath, mouthRig.interiorColor)}
  ${makeSvg(rigPartId("tongue"), rigStyle.tonguePath, mouthRig.tongueColor, 0)}
  ${makeSvg(rigPartId("teeth"), rigStyle.teethPath, mouthRig.teethColor, 0)}
  ${makeSvg(rigPartId("lower-lip"), rigStyle.lowerLipPath, mouthRig.lipColor)}
  ${makeSvg(rigPartId("upper-lip"), rigStyle.upperLipPath, mouthRig.lipColor)}
</div>`;

  return { html, mouthSlot: { visemes: {}, isRig: true } };
}

function buildGenericSlot(
  slot: ReturnType<typeof listCharacterSlots>[number],
  scaleX: number,
  scaleY: number,
  resolveUrl: (mediaId: string) => string,
  poses?: Record<string, string>,
): string | null {
  const activePoseId = poses?.[slot.id];
  const part = activePoseId
    ? (slot.parts.find((p) => p.id === activePoseId || p.pose === activePoseId) ??
      slot.parts.find((p) => p.visible))
    : slot.parts.find((p) => p.visible);
  if (!part) return null;

  const containerId = slotContainerId(slot.id);
  const style = styleStr({
    position: "absolute",
    left: part.x * scaleX,
    top: part.y * scaleY,
    width: part.width * scaleX,
    height: part.height * scaleY,
    "z-index": part.zIndex,
    "transform-origin": `${part.anchorX * 100}% ${part.anchorY * 100}%`,
    overflow: "visible",
    "pointer-events": "none",
  });

  if (part.morph?.primaryPath) {
    const viewBox = part.morph.viewBox ?? `0 0 ${part.width} ${part.height}`;
    const fill = esc(part.morph.fill ?? "#733f43");
    const strokeAttrs = part.morph.stroke
      ? ` stroke="${esc(part.morph.stroke)}" stroke-width="${esc(String(part.morph.strokeWidth ?? 1))}"`
      : "";
    return `<svg id="${esc(containerId)}" viewBox="${esc(viewBox)}" aria-hidden="true" overflow="visible" style="${esc(style)}"><path d="${esc(part.morph.primaryPath)}" fill="${fill}"${strokeAttrs}/></svg>`;
  }

  return `<img id="${esc(containerId)}" src="${esc(resolveUrl(part.mediaId))}" alt="" draggable="false" style="${esc(style)}">`;
}

// ─── Composition document assembler ──────────────────────────────────────────

const CHARACTER_RUNTIME = `(function(){
  var S=window.SCENE;
  if(!S||typeof gsap==='undefined')return;
  var tl=gsap.timeline({paused:true});
  // Blinks
  if(S.autoBlink&&S.blinkSlots){
    S.blinkSlots.forEach(function(slot){
      for(var t=S.blinkOffset;t<S.duration;t+=S.blinkEvery){
        tl.set('#'+slot.openId,{opacity:0},t);
        if(slot.closedId)tl.set('#'+slot.closedId,{opacity:1},t);
        tl.set('#'+slot.openId,{opacity:1},t+0.12);
        if(slot.closedId)tl.set('#'+slot.closedId,{opacity:0},t+0.12);
      }
    });
  }
  // Visemes
  if(S.mouthSlots&&S.visemes&&S.visemes.length){
    S.mouthSlots.filter(function(m){return!m.isRig;}).forEach(function(slot){
      var cur='rest';
      S.visemes.forEach(function(v){
        var prevEl=slot.visemes[cur];
        var nextEl=slot.visemes[v.v]||slot.visemes['rest'];
        if(prevEl)tl.set('#'+prevEl,{opacity:0},v.t);
        if(nextEl)tl.set('#'+nextEl,{opacity:1},v.t);
        cur=v.v;
      });
    });
  }
  window.__timelines=window.__timelines||{};
  window.__timelines[S.compositionId]=tl;
})();`;

function buildCompositionDocument(
  compId: string,
  width: number,
  height: number,
  domParts: string[],
  sceneData: SceneData,
): string {
  const sceneJson = JSON.stringify(sceneData)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  return `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<style>*{margin:0;padding:0;box-sizing:border-box}body{overflow:hidden}</style>
</head>
<body>
<div id="comp-root" data-composition-id="${esc(compId)}" style="position:relative;width:${width}px;height:${height}px;overflow:hidden">
${domParts.join("\n")}
</div>
<script>window.SCENE=${sceneJson};</script>
<script src="../gsap.min.js"></script>
<script>${CHARACTER_RUNTIME}</script>
</body>
</html>`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
