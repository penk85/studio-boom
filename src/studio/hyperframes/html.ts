import { addElementToHtml, parseHtml, updateElementInHtml } from "@hyperframes/core";
import type { ParsedHtml, TimelineElement } from "@hyperframes/core";
import {
  STUDIO_ROTATION_ATTR,
  STUDIO_SCALE_X_ATTR,
  STUDIO_SCALE_Y_ATTR,
  composeStudioTransform,
  hasStudioTransform,
  parseFiniteNumber,
  readStudioTransform,
} from "./transform";

export type StudioTimelineElement = TimelineElement & {
  sourceWidth?: number;
  sourceHeight?: number;
  renderTrackIndex?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  volume?: number;
  mediaStartTime?: number;
  sourceDuration?: number;
  content?: string;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  fitToBounds?: boolean;
};

type StudioElementUpdates = Partial<StudioTimelineElement> & {
  sourceWidth?: number;
  sourceHeight?: number;
  renderTrackIndex?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  volume?: number;
  mediaStartTime?: number;
  sourceDuration?: number;
  content?: string;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  fitToBounds?: boolean;
};

/**
 * Boundary adapter for the HyperFrames core parser and mutation helpers.
 * Studio Boom stores native HyperFrames attrs; this patches parser results so
 * the editor's canonical source remains compatible with the current package.
 */
export function parseStudioHtml(html: string): ParsedHtml {
  if (!html || typeof DOMParser === "undefined") return parseHtml(html);

  const doc = new DOMParser().parseFromString(html, "text/html");
  const parsed = parseHtml(withCanonicalHyperframeIds(doc));
  const patchedElements = parsed.elements
    .filter((element) => !isCompositionRootMarker(element, doc))
    .map((element) => patchElementFromNativeAttrs(element, doc));
  const patchedIds = new Set(patchedElements.map((element) => element.id));
  const fallbackElements = collectNativeFallbackElements(doc, patchedIds);

  return {
    ...parsed,
    elements: sortElementsByDocumentOrder([...patchedElements, ...fallbackElements], doc),
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
 * The current core helper declares these attrs in types but does not serialize
 * every Studio-specific field yet.
 */
export function updateStudioElementInHtml(
  html: string,
  elementId: string,
  updates: StudioElementUpdates,
): string {
  const coreHtml = updateElementInHtml(html, elementId, updates);
  return patchStudioElementInHtml(coreHtml, elementId, updates);
}

/**
 * Retarget a composition source's declared id and inline timeline references.
 * All callers use this boundary instead of rewriting serialized HTML directly.
 */
export function retargetCompositionIdInHtml(
  html: string,
  previousId: string,
  nextId: string,
): string {
  if (!html || previousId === nextId) return html;

  if (typeof DOMParser === "undefined") return html;

  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const element of compositionElements(doc)) {
    if (element.getAttribute("data-composition-id") === previousId) {
      element.setAttribute("data-composition-id", nextId);
    }
  }

  for (const element of htmlReferenceElements(doc)) {
    for (const attribute of ["data-composition-src", "data-composition-file", "src"]) {
      if (element.getAttribute(attribute) === `compositions/${previousId}.html`) {
        element.setAttribute(attribute, `compositions/${nextId}.html`);
      }
    }
  }

  for (const script of inlineCompositionScripts(doc)) {
    script.textContent = replaceInlineTimelineId(script.textContent ?? "", previousId, nextId);
  }

  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}

/** Read one stored root element through the same DOM boundary used for edits. */
export function readStudioElementHtml(html: string, elementId: string): string | null {
  if (!html || typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.getElementById(elementId)?.outerHTML ?? null;
}

/** Update canonical render-track attrs through the shared HTML boundary. */
export function updateStudioRenderTrackIndicesInHtml(
  html: string,
  assignments: ReadonlyMap<string, number>,
): string {
  if (!html || assignments.size === 0 || typeof DOMParser === "undefined") return html;

  const doc = new DOMParser().parseFromString(html, "text/html");
  let changed = false;
  for (const [elementId, renderTrackIndex] of assignments) {
    const element = doc.getElementById(elementId);
    if (!element) continue;
    const nextValue = String(renderTrackIndex);
    if (element.getAttribute("data-track-index") === nextValue) continue;
    element.setAttribute("data-track-index", nextValue);
    changed = true;
  }

  return changed ? "<!DOCTYPE html>\n" + doc.documentElement.outerHTML : html;
}

/** Clone a composition source while keeping element and nested composition rewrites in the boundary. */
export function cloneStudioCompositionSource(
  source: string,
  options: {
    sourceCompositionId: string;
    targetCompositionId: string;
    createElementId: () => string;
    resolveNestedCompositionId: (sourceElementId: string, targetElementId: string) => string;
  },
): {
  html: string;
  idMap: Map<string, string>;
  compositionIdMap: Map<string, string>;
} {
  const retargeted = retargetCompositionIdInHtml(
    source,
    options.sourceCompositionId,
    options.targetCompositionId,
  );
  const idMap = new Map<string, string>();
  const compositionIdMap = new Map<string, string>([
    [options.sourceCompositionId, options.targetCompositionId],
  ]);
  if (typeof DOMParser === "undefined") {
    return { html: retargeted, idMap, compositionIdMap };
  }

  const doc = new DOMParser().parseFromString(retargeted, "text/html");
  for (const element of Array.from(doc.querySelectorAll<HTMLElement>("[id]"))) {
    if (element.id === "stage") continue;

    const sourceElementId = element.id;
    const targetElementId = options.createElementId();
    idMap.set(sourceElementId, targetElementId);
    element.id = targetElementId;

    const nestedCompositionId = element.getAttribute("data-composition-id");
    if (nestedCompositionId && nestedCompositionId !== options.sourceCompositionId) {
      const targetNestedCompositionId = options.resolveNestedCompositionId(
        sourceElementId,
        targetElementId,
      );
      compositionIdMap.set(nestedCompositionId, targetNestedCompositionId);
      element.setAttribute("data-composition-id", targetNestedCompositionId);
      element.setAttribute(
        "data-composition-src",
        `compositions/${targetNestedCompositionId}.html`,
      );
      const iframe = element.querySelector<HTMLIFrameElement>("iframe[src]");
      if (iframe) {
        iframe.setAttribute("src", `compositions/${targetNestedCompositionId}.html`);
      }
    }
  }

  const html = rewriteStudioSourceIds(
    "<!DOCTYPE html>\n" + doc.documentElement.outerHTML,
    idMap,
    compositionIdMap,
  );
  return { html, idMap, compositionIdMap };
}

/** Rewrite serialized source references during a deliberate composition clone. */
export function rewriteStudioSourceIds(
  source: string,
  idMap: Map<string, string>,
  compositionIdMap: Map<string, string>,
): string {
  const entries = [...compositionIdMap, ...idMap].filter(([from, to]) => from && from !== to);
  const markers = entries.map(([,], index) => {
    let marker = `__studio_source_rewrite_${index}__`;
    while (source.includes(marker)) marker += "_";
    return marker;
  });

  let next = source;
  entries.forEach(([from], index) => {
    next = next.split(from).join(markers[index]!);
  });
  entries.forEach(([, to], index) => {
    next = next.split(markers[index]!).join(to);
  });
  return next;
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

  if (!el.hasAttribute("data-hf-id")) el.setAttribute("data-hf-id", elementId);

  if (updates.type !== undefined) el.setAttribute("data-type", updates.type);
  if ("compositionId" in updates && updates.compositionId !== undefined) {
    el.setAttribute("data-composition-id", updates.compositionId);
  }
  setNumericAttr(el, "data-start", updates.startTime);
  setNumericAttr(el, "data-duration", updates.duration);
  setNumericAttr(el, "data-track-index", updates.renderTrackIndex);
  setNumericAttr(el, "data-x", updates.x);
  setNumericAttr(el, "data-y", updates.y);
  setNumericAttr(el, "data-scale", updates.scale);
  setNumericAttr(el, STUDIO_ROTATION_ATTR, updates.rotation);
  // Per-axis mirror sign; omit at the default of 1 to keep the HTML clean.
  setFlipAttr(el, STUDIO_SCALE_X_ATTR, updates.scaleX);
  setFlipAttr(el, STUDIO_SCALE_Y_ATTR, updates.scaleY);
  setNumericAttr(el, "data-opacity", updates.opacity);
  if ("volume" in updates && updates.volume !== undefined) {
    // Generator omits data-volume at the default of 1; mirror that on mutation.
    if (updates.volume === 1) el.removeAttribute("data-volume");
    else el.setAttribute("data-volume", String(updates.volume));
  }
  if ("mediaStartTime" in updates && updates.mediaStartTime !== undefined) {
    // Generator omits data-media-start at the default of 0.
    if (updates.mediaStartTime === 0) el.removeAttribute("data-media-start");
    else el.setAttribute("data-media-start", String(updates.mediaStartTime));
  }
  setNumericAttr(el, "data-source-duration", updates.sourceDuration);
  setNumericAttr(el, "data-source-width", updates.sourceWidth);
  setNumericAttr(el, "data-source-height", updates.sourceHeight);
  setNumericAttr(el, "data-width", updates.sourceWidth);
  setNumericAttr(el, "data-height", updates.sourceHeight);
  setNumericAttr(el, "data-font-size", updates.fontSize);
  setNumericAttr(el, "data-font-weight", updates.fontWeight);

  if (updates.name !== undefined) el.setAttribute("data-name", updates.name);
  if (updates.content !== undefined) patchTextContent(el, updates.content);
  if (updates.color !== undefined) el.setAttribute("data-color", updates.color);
  if (updates.fontFamily !== undefined) el.setAttribute("data-font-family", updates.fontFamily);
  if (updates.fitToBounds !== undefined) {
    if (updates.fitToBounds) el.setAttribute("data-fit-to-bounds", "true");
    else el.removeAttribute("data-fit-to-bounds");
  }
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

function inlineCompositionScripts(doc: Document): HTMLScriptElement[] {
  const scripts = Array.from(doc.querySelectorAll<HTMLScriptElement>("script:not([src])"));
  for (const template of Array.from(doc.querySelectorAll<HTMLTemplateElement>("template"))) {
    scripts.push(
      ...Array.from(template.content.querySelectorAll<HTMLScriptElement>("script:not([src])")),
    );
  }
  return scripts;
}

function compositionElements(doc: Document): HTMLElement[] {
  const elements = Array.from(doc.querySelectorAll<HTMLElement>("[data-composition-id]"));
  for (const template of Array.from(doc.querySelectorAll<HTMLTemplateElement>("template"))) {
    elements.push(
      ...Array.from(template.content.querySelectorAll<HTMLElement>("[data-composition-id]")),
    );
  }
  return elements;
}

function htmlReferenceElements(doc: Document): HTMLElement[] {
  const elements = Array.from(
    doc.querySelectorAll<HTMLElement>("[data-composition-src], [data-composition-file], [src]"),
  );
  for (const template of Array.from(doc.querySelectorAll<HTMLTemplateElement>("template"))) {
    elements.push(
      ...Array.from(
        template.content.querySelectorAll<HTMLElement>(
          "[data-composition-src], [data-composition-file], [src]",
        ),
      ),
    );
  }
  return elements;
}

function replaceInlineTimelineId(source: string, previousId: string, nextId: string): string {
  const previousJson = JSON.stringify(previousId);
  const nextJson = JSON.stringify(nextId);
  let next = source.split(previousJson).join(nextJson);
  if (!previousId.includes("'")) {
    next = next.split(`'${previousId}'`).join(`'${nextId}'`);
  }
  return next;
}

function withCanonicalHyperframeIds(doc: Document): string {
  for (const element of Array.from(doc.querySelectorAll<HTMLElement>("[id]"))) {
    if (!element.hasAttribute("data-hf-id")) {
      element.setAttribute("data-hf-id", element.id);
    }
  }
  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}

function isCompositionRootMarker(element: TimelineElement, doc: Document): boolean {
  const el = doc.getElementById(element.id);
  if (el?.hasAttribute("data-composition-id") !== true) return false;
  const root = findNativeCompositionRoot(doc);
  if (el === root) return true;
  const rootCompositionId = root?.getAttribute("data-composition-id");
  return el.id === "stage" && el.getAttribute("data-composition-id") === rootCompositionId;
}

function collectNativeFallbackElements(doc: Document, parsedIds: Set<string>): TimelineElement[] {
  const root = findNativeCompositionRoot(doc);
  const elements: TimelineElement[] = [];
  for (const el of Array.from(
    doc.querySelectorAll<HTMLElement>("[id][data-start], [id][data-duration]"),
  )) {
    if (parsedIds.has(el.id)) continue;
    if (el === root || isCompositionStageRootMarker(el) || isIgnoredTimelineTag(el)) continue;
    const fallback = buildNativeFallbackElement(el);
    if (fallback) elements.push(patchElementFromNativeAttrs(fallback, doc));
  }
  return elements;
}

function findNativeCompositionRoot(doc: Document): Element | null {
  if (doc.documentElement.hasAttribute("data-composition-id")) return doc.documentElement;
  const stage = doc.getElementById("stage");
  if (stage?.hasAttribute("data-composition-id")) return stage;
  return (
    Array.from(doc.body?.children ?? []).find((el) => isNativeCompositionRootCandidate(el)) ?? null
  );
}

function isNativeCompositionRootCandidate(el: Element): boolean {
  if (!el.hasAttribute("data-composition-id")) return false;
  if (readNativeCompositionSrc(el)) return false;
  if (el.id === "root") return true;
  return hasTimedDescendantClip(el);
}

function hasTimedDescendantClip(el: Element): boolean {
  return Array.from(el.querySelectorAll<HTMLElement>("[id][data-start], [id][data-duration]"))
    .filter((child) => !isIgnoredTimelineTag(child))
    .some((child) => child !== el);
}

function isIgnoredTimelineTag(el: Element): boolean {
  return ["SCRIPT", "STYLE", "TEMPLATE"].includes(el.tagName);
}

function isCompositionStageRootMarker(el: Element): boolean {
  return el.id === "stage" && el.hasAttribute("data-composition-id");
}

function buildNativeFallbackElement(el: HTMLElement): TimelineElement | null {
  const type = inferNativeFallbackType(el);
  if (!type) return null;

  const startTime = parseFiniteNumber(el.getAttribute("data-start")) ?? 0;
  const end = parseFiniteNumber(el.getAttribute("data-end"));
  const duration =
    parseFiniteNumber(el.getAttribute("data-duration")) ??
    (end !== null ? Math.max(0.1, end - startTime) : 1);
  const sourceWidth =
    parseFiniteNumber(el.getAttribute("data-source-width")) ??
    parseFiniteNumber(el.getAttribute("data-width")) ??
    0;
  const sourceHeight =
    parseFiniteNumber(el.getAttribute("data-source-height")) ??
    parseFiniteNumber(el.getAttribute("data-height")) ??
    0;
  const src = readNativeCompositionSrc(el) ?? el.getAttribute("src") ?? undefined;
  // Transform fields through the ONE canonical reader (previously hand-rolled here, which is
  // how this builder silently missed rotation + flip).
  const transform = readStudioTransform(el);

  return {
    id: el.id,
    type,
    name: el.getAttribute("data-name") ?? el.getAttribute("data-composition-id") ?? el.id,
    startTime,
    duration,
    zIndex:
      parseFiniteNumber(el.style.zIndex) ??
      parseFiniteNumber(el.getAttribute("data-track-index")) ??
      0,
    x: transform.x,
    y: transform.y,
    scale: transform.scale,
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
    rotation: transform.rotation,
    opacity: parseFiniteNumber(el.getAttribute("data-opacity")) ?? 1,
    sourceWidth,
    sourceHeight,
    ...(src ? { src } : {}),
    ...(type === "text" ? { content: el.textContent?.trim() ?? "" } : {}),
  } as unknown as TimelineElement;
}

function inferNativeFallbackType(el: Element): TimelineElement["type"] | null {
  const explicitType = el.getAttribute("data-type");
  if (
    explicitType === "image" ||
    explicitType === "video" ||
    explicitType === "audio" ||
    explicitType === "text" ||
    explicitType === "composition"
  ) {
    return explicitType;
  }
  if (
    readNativeCompositionSrc(el) ||
    (el.getAttribute("data-composition-id") && hasElementTiming(el)) ||
    isStructuredTimedHtmlClip(el)
  ) {
    return "composition";
  }
  if (el.tagName === "IMG") return "image";
  if (el.tagName === "VIDEO") return "video";
  if (el.tagName === "AUDIO") return "audio";
  if (el.tagName === "DIV") return "text";
  return null;
}

function sortElementsByDocumentOrder(
  elements: TimelineElement[],
  doc: Document,
): TimelineElement[] {
  const order = new Map(
    Array.from(doc.querySelectorAll<HTMLElement>("[id]")).map((el, index) => [el.id, index]),
  );
  return elements.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
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
  const scaleX = parseFiniteNumber(el.getAttribute(STUDIO_SCALE_X_ATTR));
  const scaleY = parseFiniteNumber(el.getAttribute(STUDIO_SCALE_Y_ATTR));
  const sourceWidth =
    parseFiniteNumber(el.getAttribute("data-source-width")) ??
    parseFiniteNumber(el.getAttribute("data-width"));
  const sourceHeight =
    parseFiniteNumber(el.getAttribute("data-source-height")) ??
    parseFiniteNumber(el.getAttribute("data-height"));
  const fontSize = parseFiniteNumber(el.getAttribute("data-font-size"));
  const fontWeight = parseFiniteNumber(el.getAttribute("data-font-weight"));
  const volume = parseFiniteNumber(el.getAttribute("data-volume"));
  const mediaStartTime = parseFiniteNumber(el.getAttribute("data-media-start"));
  const sourceDuration = parseFiniteNumber(el.getAttribute("data-source-duration"));
  const nativeCompositionSrc = readNativeCompositionSrc(el);
  const nativeCompositionId = el.getAttribute("data-composition-id") ?? undefined;
  const explicitType = el.getAttribute("data-type");
  const isNativeCompositionHost =
    explicitType !== "text" &&
    (Boolean(nativeCompositionId && hasElementTiming(el)) || isStructuredTimedHtmlClip(el));

  const patched = {
    ...element,
    type: isNativeCompositionHost ? "composition" : element.type,
    duration: duration ?? element.duration,
    zIndex: visualZIndex ?? trackIndex ?? element.zIndex,
    x: x ?? element.x,
    y: y ?? element.y,
    rotation: rotation ?? getElementRotation(element),
    scaleX: scaleX ?? 1,
    scaleY: scaleY ?? 1,
    sourceWidth: sourceWidth ?? getElementSourceWidth(element),
    sourceHeight: sourceHeight ?? getElementSourceHeight(element),
    fontSize: fontSize ?? getElementFontSize(element),
    fontWeight: fontWeight ?? getElementFontWeight(element),
    fontFamily: el.getAttribute("data-font-family") ?? getElementFontFamily(element),
    fitToBounds:
      el.getAttribute("data-fit-to-bounds") === "true" ? true : getElementFitToBounds(element),
    volume: volume ?? (element as { volume?: number }).volume,
    mediaStartTime: mediaStartTime ?? (element as { mediaStartTime?: number }).mediaStartTime,
    sourceDuration: sourceDuration ?? (element as { sourceDuration?: number }).sourceDuration,
  } as unknown as TimelineElement;

  if (!isNativeCompositionHost) return patched;

  return {
    ...patched,
    type: "composition",
    name: el.getAttribute("data-name") ?? nativeCompositionId ?? element.name,
    ...(nativeCompositionSrc ? { src: nativeCompositionSrc } : {}),
    ...(nativeCompositionId ? { compositionId: nativeCompositionId } : {}),
    sourceWidth: sourceWidth ?? getElementSourceWidth(element),
    sourceHeight: sourceHeight ?? getElementSourceHeight(element),
  } as unknown as TimelineElement;
}

function readNativeCompositionSrc(el: Element): string | undefined {
  return (
    el.getAttribute("data-composition-src") ??
    el.getAttribute("data-composition-file") ??
    el.querySelector("iframe[src]")?.getAttribute("src") ??
    el.getAttribute("src") ??
    undefined
  );
}

function hasElementTiming(el: Element): boolean {
  return el.hasAttribute("data-start") || el.hasAttribute("data-duration");
}

function isStructuredTimedHtmlClip(el: Element): boolean {
  if (el.getAttribute("data-type")) return false;
  if (!hasElementTiming(el)) return false;
  if (!isGenericHtmlContainer(el)) return false;
  if (el.id === "stage") return false;

  const children = Array.from(el.children).filter(
    (child) => !["SCRIPT", "STYLE", "TEMPLATE"].includes(child.tagName),
  );
  if (children.length === 0) return false;
  if (children.length > 1) return true;
  const [child] = children;
  return child ? isBlockLikeElement(child) || hasElementTiming(child) : false;
}

function isGenericHtmlContainer(el: Element): boolean {
  return ["DIV", "SECTION", "ARTICLE", "MAIN", "ASIDE", "HEADER", "FOOTER"].includes(el.tagName);
}

function isBlockLikeElement(el: Element): boolean {
  return !new Set([
    "A",
    "ABBR",
    "B",
    "BR",
    "CITE",
    "CODE",
    "EM",
    "I",
    "MARK",
    "SMALL",
    "SPAN",
    "STRONG",
    "SUB",
    "SUP",
    "TIME",
    "U",
  ]).has(el.tagName);
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

function getElementFontSize(element: TimelineElement): number | undefined {
  return "fontSize" in element ? element.fontSize : undefined;
}

function getElementFontWeight(element: TimelineElement): number | undefined {
  return "fontWeight" in element ? element.fontWeight : undefined;
}

function getElementFontFamily(element: TimelineElement): string | undefined {
  return "fontFamily" in element ? element.fontFamily : undefined;
}

function getElementFitToBounds(element: TimelineElement): boolean | undefined {
  if (!("fitToBounds" in element)) return undefined;
  const value = (element as { fitToBounds?: unknown }).fitToBounds;
  return typeof value === "boolean" ? value : undefined;
}

function setNumericAttr(el: Element, attr: string, value: number | undefined): void {
  if (value === undefined) return;
  el.setAttribute(attr, String(value));
}

/** Per-axis mirror sign: drop the attr at the default of 1, else persist (e.g. -1 for a flip). */
function setFlipAttr(el: Element, attr: string, value: number | undefined): void {
  if (value === undefined) return;
  if (value === 1) el.removeAttribute(attr);
  else el.setAttribute(attr, String(value));
}

function patchElementVisualStyle(el: HTMLElement, updates: StudioElementUpdates): void {
  if (el.tagName === "AUDIO") return;

  if (!el.style.position) el.style.position = "absolute";
  if (!el.style.left) el.style.left = "0px";
  if (!el.style.top) el.style.top = "0px";

  const zIndex =
    updates.zIndex ??
    parseFiniteNumber(el.style.zIndex) ??
    parseFiniteNumber(el.getAttribute("data-track-index"));
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

  if (el.getAttribute("data-type") === "text") {
    const effectiveFontSize = resolveTextFontSize(el, updates);
    el.style.display = el.style.display || "flex";
    el.style.alignItems = el.style.alignItems || "center";
    el.style.justifyContent = el.style.justifyContent || "center";
    el.style.boxSizing = el.style.boxSizing || "border-box";
    el.style.whiteSpace = el.style.whiteSpace || "pre-wrap";
    el.style.overflow = "hidden";
    el.style.lineHeight = "1.12";
    if (updates.color !== undefined) el.style.color = updates.color;
    if (effectiveFontSize !== null) el.style.fontSize = `${effectiveFontSize}px`;
    if (updates.fontFamily !== undefined) el.style.fontFamily = updates.fontFamily;
    if (updates.fontWeight !== undefined) el.style.fontWeight = String(updates.fontWeight);
  }

  if (hasStudioTransform(el, updates)) {
    el.style.transform = composeStudioTransform(readStudioTransform(el, updates));
    el.style.transformOrigin = el.style.transformOrigin || "center center";
  }
}

function patchTextContent(el: HTMLElement, content: string): void {
  if (el.getAttribute("data-type") !== "text") return;
  const textEl = el.firstElementChild ?? el.ownerDocument.createElement("div");
  textEl.textContent = content;
  if (!textEl.parentElement) el.appendChild(textEl);
}

function resolveTextFontSize(el: HTMLElement, updates: StudioElementUpdates): number | null {
  const requested =
    updates.fontSize ?? parseFiniteNumber(el.getAttribute("data-font-size")) ?? null;
  if (requested === null) return null;
  if (el.getAttribute("data-fit-to-bounds") !== "true") return requested;

  const width =
    updates.sourceWidth ??
    parseFiniteNumber(el.getAttribute("data-source-width")) ??
    parseFiniteNumber(el.getAttribute("data-width")) ??
    null;
  const height =
    updates.sourceHeight ??
    parseFiniteNumber(el.getAttribute("data-source-height")) ??
    parseFiniteNumber(el.getAttribute("data-height")) ??
    null;
  if (width === null || height === null || width <= 0 || height <= 0) return requested;

  const content = (el.firstElementChild?.textContent ?? el.textContent ?? "").trim();
  if (!content) return requested;

  const lines = content.split(/\n/);
  const longestLineLength = Math.max(1, ...lines.map((line) => line.length));
  const estimatedByWidth = width / (longestLineLength * 0.58);
  const estimatedByHeight = height / (Math.max(1, lines.length) * 1.12);
  return Math.max(8, Math.floor(Math.min(requested, estimatedByWidth, estimatedByHeight)));
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
