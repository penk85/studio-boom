import { addElementToHtml, parseHtml, updateElementInHtml } from "@hyperframes/core";
import type { ParsedHtml, TimelineElement } from "@hyperframes/core";
import {
  STUDIO_ROTATION_ATTR,
  composeStudioTransform,
  hasStudioTransform,
  parseFiniteNumber,
  readStudioTransform,
} from "./transform";

export type StudioTimelineElement = TimelineElement & {
  sourceWidth?: number;
  sourceHeight?: number;
  rotation?: number;
};

type StudioElementUpdates = Partial<StudioTimelineElement> & {
  sourceWidth?: number;
  sourceHeight?: number;
  rotation?: number;
};

/**
 * Boundary adapter for @hyperframes/core@0.5.3.
 * Studio Boom stores native HyperFrames attrs; this patches the current parser
 * result until the upstream parser reads the native attrs Studio relies on.
 */
export function parseStudioHtml(html: string): ParsedHtml {
  const parsed = parseHtml(html);
  if (!html || typeof DOMParser === "undefined") return parsed;

  const doc = new DOMParser().parseFromString(html, "text/html");
  return {
    ...parsed,
    elements: parsed.elements
      .filter((element) => !isCompositionRootMarker(element, doc))
      .map((element) => patchElementFromNativeAttrs(element, doc)),
  };
}

/**
 * Calls the upstream add helper first, then patches the native attrs that the
 * current package helper drops. This keeps the store on the HyperFrames mutation
 * path without letting add/update disagree about stage placement.
 */
export function addStudioElementToHtml(
  html: string,
  element: StudioTimelineElement,
): { html: string; id: string } {
  const result = addElementToHtml(html, element);
  return {
    id: result.id,
    html: patchStudioElementInHtml(result.html, result.id, element),
  };
}

/**
 * Calls the upstream mutation helper first, then patches the native attrs that
 * @hyperframes/core@0.5.3 declares in types but does not serialize yet.
 */
export function updateStudioElementInHtml(
  html: string,
  elementId: string,
  updates: StudioElementUpdates,
): string {
  const coreHtml = updateElementInHtml(html, elementId, updates);
  return patchStudioElementInHtml(coreHtml, elementId, updates);
}

function patchStudioElementInHtml(
  html: string,
  elementId: string,
  updates: StudioElementUpdates,
): string {
  const coreHtml = html;
  if (!coreHtml || typeof DOMParser === "undefined") return coreHtml;

  const doc = new DOMParser().parseFromString(coreHtml, "text/html");
  const el = doc.getElementById(elementId);
  if (!el) return coreHtml;

  if (updates.type !== undefined) el.setAttribute("data-type", updates.type);
  if ("compositionId" in updates && updates.compositionId !== undefined) {
    el.setAttribute("data-composition-id", updates.compositionId);
  }
  setNumericAttr(el, "data-start", updates.startTime);
  setNumericAttr(el, "data-duration", updates.duration);
  setNumericAttr(el, "data-track-index", updates.zIndex);
  setNumericAttr(el, "data-x", updates.x);
  setNumericAttr(el, "data-y", updates.y);
  setNumericAttr(el, "data-scale", updates.scale);
  setNumericAttr(el, STUDIO_ROTATION_ATTR, updates.rotation);
  setNumericAttr(el, "data-opacity", updates.opacity);
  setNumericAttr(el, "data-source-width", updates.sourceWidth);
  setNumericAttr(el, "data-source-height", updates.sourceHeight);
  setNumericAttr(el, "data-width", updates.sourceWidth);
  setNumericAttr(el, "data-height", updates.sourceHeight);

  if (updates.name !== undefined) el.setAttribute("data-name", updates.name);
  if ("src" in updates && updates.src !== undefined) {
    if (el.getAttribute("data-type") === "composition") {
      el.setAttribute("data-composition-src", updates.src);
      ensureCompositionIframe(doc, el, updates.src);
    } else {
      el.setAttribute("src", updates.src);
    }
  }

  patchElementVisualStyle(el, updates);

  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}

function isCompositionRootMarker(element: TimelineElement, doc: Document): boolean {
  const el = doc.getElementById(element.id);
  return element.id === "stage" && el?.hasAttribute("data-composition-id") === true;
}

function patchElementFromNativeAttrs(element: TimelineElement, doc: Document): TimelineElement {
  const el = doc.getElementById(element.id);
  if (!el) return element;

  const duration = parseFiniteNumber(el.getAttribute("data-duration"));
  const trackIndex = parseFiniteNumber(el.getAttribute("data-track-index"));
  const visualZIndex = parseFiniteNumber(el.style.zIndex);
  const x = parseFiniteNumber(el.getAttribute("data-x"));
  const y = parseFiniteNumber(el.getAttribute("data-y"));
  const rotation =
    parseFiniteNumber(el.getAttribute(STUDIO_ROTATION_ATTR)) ??
    parseRotationFromInlineTransform(el.style.transform);
  const sourceWidth =
    parseFiniteNumber(el.getAttribute("data-source-width")) ??
    parseFiniteNumber(el.getAttribute("data-width"));
  const sourceHeight =
    parseFiniteNumber(el.getAttribute("data-source-height")) ??
    parseFiniteNumber(el.getAttribute("data-height"));

  return {
    ...element,
    duration: duration ?? element.duration,
    zIndex: visualZIndex ?? trackIndex ?? element.zIndex,
    x: x ?? element.x,
    y: y ?? element.y,
    rotation: rotation ?? getElementRotation(element),
    sourceWidth: sourceWidth ?? getElementSourceWidth(element),
    sourceHeight: sourceHeight ?? getElementSourceHeight(element),
  } as TimelineElement;
}

function getElementSourceWidth(element: TimelineElement): number | undefined {
  return "sourceWidth" in element ? element.sourceWidth : undefined;
}

function getElementSourceHeight(element: TimelineElement): number | undefined {
  return "sourceHeight" in element ? element.sourceHeight : undefined;
}

function getElementRotation(element: TimelineElement): number | undefined {
  return "rotation" in element && typeof element.rotation === "number"
    ? element.rotation
    : undefined;
}

function setNumericAttr(el: Element, attr: string, value: number | undefined): void {
  if (value === undefined) return;
  el.setAttribute(attr, String(value));
}

function patchElementVisualStyle(el: HTMLElement, updates: StudioElementUpdates): void {
  if (el.tagName === "AUDIO") return;

  if (!el.style.position) el.style.position = "absolute";
  if (!el.style.left) el.style.left = "0px";
  if (!el.style.top) el.style.top = "0px";

  const zIndex = updates.zIndex ?? parseFiniteNumber(el.getAttribute("data-track-index"));
  if (zIndex !== null && zIndex !== undefined) el.style.zIndex = String(zIndex);
  if (updates.sourceWidth !== undefined) el.style.width = `${updates.sourceWidth}px`;
  if (updates.sourceHeight !== undefined) el.style.height = `${updates.sourceHeight}px`;
  if (updates.opacity !== undefined) el.style.opacity = String(updates.opacity);

  if (el.tagName === "IMG" || el.tagName === "VIDEO") {
    el.style.objectFit = el.style.objectFit || "contain";
    if (updates.sourceWidth !== undefined || updates.sourceHeight !== undefined) {
      el.style.maxWidth = "none";
      el.style.maxHeight = "none";
    }
  }

  if (hasStudioTransform(el, updates)) {
    el.style.transform = composeStudioTransform(readStudioTransform(el, updates));
    el.style.transformOrigin = el.style.transformOrigin || "center center";
  }
}

function parseRotationFromInlineTransform(transform: string): number | null {
  const match = transform.match(/rotate\(\s*(-?\d+(?:\.\d+)?)deg\s*\)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function ensureCompositionIframe(doc: Document, el: HTMLElement, src: string): void {
  let iframe = el.querySelector("iframe");
  if (!iframe) {
    el.textContent = "";
    iframe = doc.createElement("iframe");
    el.appendChild(iframe);
  }

  iframe.setAttribute("src", src);
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
  iframe.setAttribute("style", "width: 100%; height: 100%; border: none; pointer-events: none;");
}
