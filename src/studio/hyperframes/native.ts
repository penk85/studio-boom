/**
 * Boundary adapter for HyperFrames package seams.
 * Studio Boom stores HyperFrames HTML as the movie source; this normalizes HTML
 * produced by current core helpers into the native shape expected by the CLI.
 */
interface NativeHtmlOptions {
  width?: number;
  height?: number;
}

interface NativeDimensions {
  width: number;
  height: number;
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

  const dimensions = resolveDimensions(root, stage, options);
  if (dimensions) {
    syncRootDimensions(root, dimensions);
    syncStageDimensions(stage, dimensions);
    syncViewportMeta(doc, dimensions);
  }
}

function resolveDimensions(
  root: HTMLElement,
  stage: HTMLElement,
  options: NativeHtmlOptions,
): NativeDimensions | null {
  const fallback = resolveResolutionDimensions(root);
  const width =
    parsePositiveNumber(options.width) ??
    parseFiniteNumber(root.getAttribute("data-width")) ??
    parseFiniteNumber(root.getAttribute("data-composition-width")) ??
    parseFiniteNumber(stage.getAttribute("data-width")) ??
    fallback?.width ??
    null;
  const height =
    parsePositiveNumber(options.height) ??
    parseFiniteNumber(root.getAttribute("data-height")) ??
    parseFiniteNumber(root.getAttribute("data-composition-height")) ??
    parseFiniteNumber(stage.getAttribute("data-height")) ??
    fallback?.height ??
    null;

  if (width !== null && height !== null) return { width, height };
  return null;
}

function resolveResolutionDimensions(root: HTMLElement): NativeDimensions | null {
  const resolution = root.getAttribute("data-resolution");
  if (resolution === "landscape") return { width: 1920, height: 1080 };
  if (resolution === "portrait") return { width: 1080, height: 1920 };
  return null;
}

function syncRootDimensions(root: HTMLElement, dimensions: NativeDimensions): void {
  root.setAttribute("data-width", String(dimensions.width));
  root.setAttribute("data-height", String(dimensions.height));
  root.setAttribute("data-composition-width", String(dimensions.width));
  root.setAttribute("data-composition-height", String(dimensions.height));
  root.setAttribute(
    "data-resolution",
    dimensions.width >= dimensions.height ? "landscape" : "portrait",
  );
}

function syncStageDimensions(stage: HTMLElement, dimensions: NativeDimensions): void {
  stage.setAttribute("data-width", String(dimensions.width));
  stage.setAttribute("data-height", String(dimensions.height));
  stage.style.width = `${dimensions.width}px`;
  stage.style.height = `${dimensions.height}px`;
}

function syncViewportMeta(doc: Document, dimensions: NativeDimensions): void {
  let head = doc.head;
  if (!head) {
    head = doc.createElement("head");
    doc.documentElement.insertBefore(head, doc.body ?? null);
  }

  let viewport = head.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!viewport) {
    viewport = doc.createElement("meta");
    viewport.setAttribute("name", "viewport");
    head.appendChild(viewport);
  }
  viewport.setAttribute("content", `width=${dimensions.width}, height=${dimensions.height}`);
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

function parsePositiveNumber(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
