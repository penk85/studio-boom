/**
 * Boundary adapter for HyperFrames package seams.
 * Studio Boom stores HyperFrames HTML as the movie source; this normalizes HTML
 * produced by current core helpers into the native shape expected by the CLI.
 */
interface NativeHtmlOptions {
  width?: number;
  height?: number;
}

export function normalizeNativeHyperframesHtml(
  html: string,
  options: NativeHtmlOptions = {},
): string {
  if (!html) return html;

  if (typeof DOMParser === "undefined") return html;

  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.documentElement;
  normalizeCompositionRoot(doc, root, options);

  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[data-start]"))) {
    normalizeTimedElement(el);
    normalizeCompositionHost(el);
  }

  return "<!DOCTYPE html>\n" + root.outerHTML;
}

function normalizeCompositionRoot(
  doc: Document,
  root: HTMLElement,
  options: NativeHtmlOptions,
): void {
  const compositionId = root.getAttribute("data-composition-id");
  if (!compositionId) return;

  const stage = doc.getElementById("stage");
  if (!stage) {
    if (!root.hasAttribute("data-start")) root.setAttribute("data-start", "0");
    return;
  }

  stage.setAttribute(
    "data-composition-id",
    stage.getAttribute("data-composition-id") || compositionId,
  );
  stage.setAttribute("data-start", stage.getAttribute("data-start") || "0");

  const duration = root.getAttribute("data-composition-duration");
  if (duration && !stage.hasAttribute("data-duration")) {
    stage.setAttribute("data-duration", duration);
  }

  const dimensions = resolveDimensions(root, options);
  if (dimensions) {
    stage.setAttribute("data-width", stage.getAttribute("data-width") || String(dimensions.width));
    stage.setAttribute(
      "data-height",
      stage.getAttribute("data-height") || String(dimensions.height),
    );
  }
}

function resolveDimensions(
  root: HTMLElement,
  options: NativeHtmlOptions,
): { width: number; height: number } | null {
  if (options.width && options.height) {
    return { width: options.width, height: options.height };
  }

  const width = parseFiniteNumber(root.getAttribute("data-composition-width"));
  const height = parseFiniteNumber(root.getAttribute("data-composition-height"));
  if (width !== null && height !== null) return { width, height };

  const resolution = root.getAttribute("data-resolution");
  if (resolution === "landscape") return { width: 1920, height: 1080 };
  if (resolution === "portrait") return { width: 1080, height: 1920 };
  return null;
}

function normalizeTimedElement(el: HTMLElement): void {
  const start = parseFiniteNumber(el.getAttribute("data-start"));
  const generatedEnd = parseFiniteNumber(el.getAttribute("data-end"));
  const duration = parseFiniteNumber(el.getAttribute("data-duration"));

  if (duration === null && start !== null && generatedEnd !== null) {
    el.setAttribute("data-duration", String(Math.max(0, generatedEnd - start)));
  }
  el.removeAttribute("data-end");

  const generatedLayer = el.getAttribute("data-layer");
  if (generatedLayer !== null && !el.hasAttribute("data-track-index")) {
    el.setAttribute("data-track-index", generatedLayer);
  }
  el.removeAttribute("data-layer");

  if (!["AUDIO", "VIDEO", "SCRIPT", "STYLE", "TEMPLATE"].includes(el.tagName)) {
    const classes = new Set((el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean));
    classes.add("clip");
    el.setAttribute("class", Array.from(classes).join(" "));
  }
}

function normalizeCompositionHost(el: HTMLElement): void {
  if (el.getAttribute("data-type") !== "composition") return;
  if (el.hasAttribute("data-composition-src")) return;

  const iframe = el.querySelector("iframe[src]");
  const iframeSrc = iframe?.getAttribute("src");
  const directSrc = el.getAttribute("src");
  const src = iframeSrc || directSrc;
  if (!src) return;

  el.setAttribute("data-composition-src", src.split("?")[0] ?? src);
}

function parseFiniteNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
