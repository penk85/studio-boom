import type {
  CharacterDocument,
  CharacterDocumentBone,
  CharacterDocumentPart,
  CharacterDocumentRoot,
  CharacterDocumentSlot,
} from "./schema";
import type { CharacterAngle, EyeState, MouthViseme, PartRole } from "../types";

export function parseCharacterDocument(html: string): CharacterDocument {
  const doc = parseHtmlDocument(html);
  const compositionRoot = findCompositionRoot(doc);
  if (!compositionRoot) throw new Error("Missing HyperFrames composition root.");
  const stage = findStageRoot(doc, compositionRoot);
  const characterRoot = doc.querySelector<HTMLElement>('[data-character-root="true"]');
  if (!characterRoot) throw new Error("Missing character document root.");

  const compositionId = requiredAttr(compositionRoot, "data-composition-id");
  const width =
    positiveNumber(stage.getAttribute("data-width")) ??
    positiveNumber(compositionRoot.getAttribute("data-width")) ??
    positiveNumber(compositionRoot.getAttribute("data-composition-width")) ??
    1;
  const height =
    positiveNumber(stage.getAttribute("data-height")) ??
    positiveNumber(compositionRoot.getAttribute("data-height")) ??
    positiveNumber(compositionRoot.getAttribute("data-composition-height")) ??
    1;
  const duration =
    positiveNumber(stage.getAttribute("data-duration")) ??
    positiveNumber(compositionRoot.getAttribute("data-duration")) ??
    positiveNumber(compositionRoot.getAttribute("data-composition-duration")) ??
    1;

  return {
    html,
    compositionId,
    duration,
    width,
    height,
    root: parseRoot(characterRoot),
    bones: Array.from(doc.querySelectorAll<HTMLElement>('[data-character-bone="true"]')).map(
      parseBone,
    ),
    slots: Array.from(doc.querySelectorAll<HTMLElement>('[data-character-slot="true"]')).map(
      parseSlot,
    ),
    parts: Array.from(doc.querySelectorAll<HTMLElement>('[data-character-part="true"]')).map(
      parsePart,
    ),
    assetIds: assetIdsFromDocument(doc),
  };
}

export function parseHtmlDocument(html: string): Document {
  if (typeof DOMParser === "undefined") {
    throw new Error("DOMParser is required to parse character documents.");
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (doc.querySelector("parsererror")) throw new Error("Character document HTML is invalid.");
  return doc;
}

export function serializeHtmlDocument(doc: Document): string {
  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
}

export function findCompositionRoot(doc: Document): HTMLElement | null {
  if (doc.documentElement.hasAttribute("data-composition-id")) {
    return doc.documentElement as HTMLElement;
  }
  return doc.querySelector<HTMLElement>("[data-composition-id]");
}

function findStageRoot(doc: Document, compositionRoot: HTMLElement): HTMLElement {
  return doc.getElementById("stage") ?? compositionRoot;
}

function parseRoot(el: HTMLElement): CharacterDocumentRoot {
  return {
    elementId: el.id || undefined,
    characterId: attr(el, "data-character-id"),
    rigVersion: numberAttr(el, "data-character-rig-version"),
    activeAngle: attr(el, "data-character-angle") as CharacterAngle | undefined,
  };
}

function parseBone(el: HTMLElement): CharacterDocumentBone {
  const transform = parseTransform(el.style.transform);
  return {
    elementId: requiredElementId(el),
    boneId: requiredAttr(el, "data-character-bone-id"),
    parentBoneId: attr(el, "data-character-parent-bone-id"),
    role: attr(el, "data-character-role") as PartRole | "root" | undefined,
    depth: numberAttr(el, "data-character-depth"),
    drawOrderIndex: numberAttr(el, "data-character-draw-order-index"),
    x: cssNumber(el.style.left),
    y: cssNumber(el.style.top),
    rotation: transform.rotation,
  };
}

function parseSlot(el: HTMLElement): CharacterDocumentSlot {
  const transform = parseTransform(el.style.transform);
  return {
    elementId: requiredElementId(el),
    slotId: requiredAttr(el, "data-character-slot-id"),
    boundBoneId: attr(el, "data-character-bound-bone-id"),
    hostSlotId: attr(el, "data-character-host-slot-id"),
    hostBoneId: attr(el, "data-character-host-bone-id"),
    role: attr(el, "data-character-role") as PartRole | undefined,
    side: attr(el, "data-character-side"),
    depth: numberAttr(el, "data-character-depth"),
    drawOrderIndex: numberAttr(el, "data-character-draw-order-index"),
    x: cssNumber(el.style.left),
    y: cssNumber(el.style.top),
    width: cssNumber(el.style.width),
    height: cssNumber(el.style.height),
    rotation: transform.rotation,
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
  };
}

function parsePart(el: HTMLElement): CharacterDocumentPart {
  return {
    elementId: requiredElementId(el),
    partId: requiredAttr(el, "data-character-part-id"),
    slotId: requiredAttr(el, "data-character-slot-id"),
    role: attr(el, "data-character-role") as PartRole | undefined,
    variant: attr(el, "data-character-variant"),
    pose: attr(el, "data-character-pose"),
    viseme: attr(el, "data-character-viseme") as MouthViseme | undefined,
    eyeState: attr(el, "data-character-eye-state") as EyeState | undefined,
    assetId: assetIdFromSrc(el.getAttribute("src")),
    visible: (numberFromCss(el.style.opacity) ?? 1) > 0.001,
  };
}

export function parseTransform(value: string): {
  rotation: number;
  scaleX: number;
  scaleY: number;
} {
  const rotation = matchNumber(value, /rotate\(([-+\d.]+)deg\)/i) ?? 0;
  const scaleMatch = value.match(/scale\(([-+\d.]+)(?:\s*,\s*([-+\d.]+))?\)/i);
  const scaleX = scaleMatch ? Number(scaleMatch[1]) : 1;
  const scaleY = scaleMatch ? Number(scaleMatch[2] ?? scaleMatch[1]) : 1;
  return {
    rotation: finite(rotation, 0),
    scaleX: finite(scaleX, 1),
    scaleY: finite(scaleY, 1),
  };
}

export function assetIdFromSrc(src: string | null): string | undefined {
  if (!src?.startsWith("asset:")) return undefined;
  return src.slice("asset:".length) || undefined;
}

function assetIdsFromDocument(doc: Document): string[] {
  const ids = new Set<string>();
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[src]"))) {
    const id = assetIdFromSrc(el.getAttribute("src"));
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

function attr(el: Element, name: string): string | undefined {
  const value = el.getAttribute(name);
  return value === null || value === "" ? undefined : value;
}

function requiredAttr(el: Element, name: string): string {
  const value = attr(el, name);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function requiredElementId(el: HTMLElement): string {
  if (!el.id) throw new Error("Character document element is missing id.");
  return el.id;
}

function numberAttr(el: Element, name: string): number | undefined {
  return finiteNumber(el.getAttribute(name));
}

function cssNumber(value: string): number {
  return finite(numberFromCss(value), 0);
}

function numberFromCss(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveNumber(value: string | null): number | undefined {
  const parsed = finiteNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function finiteNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function matchNumber(value: string, pattern: RegExp): number | undefined {
  const match = value.match(pattern);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}
