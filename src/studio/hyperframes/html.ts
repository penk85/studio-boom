import { parseHtml } from "@hyperframes/core";
import type { ParsedHtml, TimelineElement } from "@hyperframes/core";

/**
 * Boundary adapter for @hyperframes/core@0.5.3.
 * Studio Boom stores native HyperFrames attrs; this patches the current parser
 * result until the upstream parser reads data-duration/data-track-index itself.
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

function isCompositionRootMarker(element: TimelineElement, doc: Document): boolean {
  const el = doc.getElementById(element.id);
  return element.id === "stage" && el?.hasAttribute("data-composition-id") === true;
}

function patchElementFromNativeAttrs(element: TimelineElement, doc: Document): TimelineElement {
  const el = doc.getElementById(element.id);
  if (!el) return element;

  const duration = parseFiniteNumber(el.getAttribute("data-duration"));
  const trackIndex = parseFiniteNumber(el.getAttribute("data-track-index"));

  return {
    ...element,
    duration: duration ?? element.duration,
    zIndex: trackIndex ?? element.zIndex,
  };
}

function parseFiniteNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
