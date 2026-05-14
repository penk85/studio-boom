import { addElementToHtml, parseHtml, updateElementInHtml } from "@hyperframes/core";
import type { ParsedHtml, TimelineElement } from "@hyperframes/core";

type StudioElementUpdates = Partial<TimelineElement> & {
  sourceWidth?: number;
  sourceHeight?: number;
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
  element: TimelineElement,
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
  const x = parseFiniteNumber(el.getAttribute("data-x"));
  const y = parseFiniteNumber(el.getAttribute("data-y"));
  const sourceWidth =
    parseFiniteNumber(el.getAttribute("data-source-width")) ??
    parseFiniteNumber(el.getAttribute("data-width"));
  const sourceHeight =
    parseFiniteNumber(el.getAttribute("data-source-height")) ??
    parseFiniteNumber(el.getAttribute("data-height"));

  return {
    ...element,
    duration: duration ?? element.duration,
    zIndex: trackIndex ?? element.zIndex,
    x: x ?? element.x,
    y: y ?? element.y,
    sourceWidth: sourceWidth ?? getElementSourceWidth(element),
    sourceHeight: sourceHeight ?? getElementSourceHeight(element),
  };
}

function parseFiniteNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getElementSourceWidth(element: TimelineElement): number | undefined {
  return "sourceWidth" in element ? element.sourceWidth : undefined;
}

function getElementSourceHeight(element: TimelineElement): number | undefined {
  return "sourceHeight" in element ? element.sourceHeight : undefined;
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

  const x = updates.x ?? parseFiniteNumber(el.getAttribute("data-x"));
  const y = updates.y ?? parseFiniteNumber(el.getAttribute("data-y"));
  if (x !== null || y !== null) {
    el.style.transform = `translate(${x ?? 0}px, ${y ?? 0}px)`;
  }
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
