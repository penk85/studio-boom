export type CompositionOutlineKind = "audio" | "composition" | "image" | "layer" | "text" | "video";

export interface CompositionOutlineItem {
  id: string;
  name: string;
  kind: CompositionOutlineKind;
  depth: number;
  timed: boolean;
  start: number;
  duration: number;
}

interface CompositionOutlineOptions {
  compositionId?: string;
  duration: number;
  maxLayerCount?: number;
}

const DEFAULT_MAX_LAYER_COUNT = 20;

export function extractCompositionOutline(
  html: string,
  options: CompositionOutlineOptions,
): CompositionOutlineItem[] {
  if (!html || typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = findCompositionRoot(doc, options.compositionId);
  if (!root) return [];

  const timedItems = extractTimedItems(root);
  if (timedItems.length > 0) return timedItems;

  return extractLayerItems(
    root,
    options.duration,
    options.maxLayerCount ?? DEFAULT_MAX_LAYER_COUNT,
  );
}

function findCompositionRoot(doc: Document, compositionId: string | undefined): Element | null {
  const roots = getSearchRoots(doc);
  for (const root of roots) {
    if (compositionId) {
      const match = root.querySelector(`[data-composition-id="${cssAttr(compositionId)}"]`);
      if (match) return match;
    }
    if (
      root instanceof Document &&
      root.documentElement.getAttribute("data-composition-id") &&
      (!compositionId || root.documentElement.getAttribute("data-composition-id") === compositionId)
    ) {
      return root.documentElement;
    }
    const match = root.querySelector("[data-composition-id]");
    if (match) return match;
  }
  return null;
}

function getSearchRoots(doc: Document): ParentNode[] {
  const roots: ParentNode[] = [doc];
  const templates = Array.from(doc.querySelectorAll<HTMLTemplateElement>("template"));
  for (const template of templates) roots.push(template.content);
  return roots;
}

function extractTimedItems(root: Element): CompositionOutlineItem[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[id][data-start], [id][data-duration]"))
    .filter((el) => el !== root && !isIgnoredElement(el))
    .map((el, index) => ({
      id: el.id,
      name: readableName(el),
      kind: elementKind(el),
      depth: depthFromRoot(el, root),
      timed: true,
      start: readNumber(el.getAttribute("data-start")) ?? 0,
      duration: readDuration(el, 1),
      documentOrder: index,
    }))
    .sort((a, b) => a.start - b.start || a.documentOrder - b.documentOrder)
    .map(({ documentOrder: _documentOrder, ...item }) => item);
}

function extractLayerItems(
  root: Element,
  duration: number,
  maxLayerCount: number,
): CompositionOutlineItem[] {
  const items: CompositionOutlineItem[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[id]"))) {
    if (el === root || isIgnoredElement(el) || isLowSignalElement(el)) continue;
    items.push({
      id: el.id,
      name: readableName(el),
      kind: elementKind(el),
      depth: depthFromRoot(el, root),
      timed: false,
      start: 0,
      duration,
    });
    if (items.length >= maxLayerCount) break;
  }
  return items;
}

function isIgnoredElement(el: Element): boolean {
  return ["SCRIPT", "STYLE", "TEMPLATE"].includes(el.tagName);
}

function isLowSignalElement(el: Element): boolean {
  const tag = el.tagName;
  if (["LINE", "PATH", "POLYLINE", "RECT", "CIRCLE"].includes(tag)) {
    return !el.id || el.classList.length === 0;
  }
  return false;
}

function elementKind(el: Element): CompositionOutlineKind {
  const explicit = el.getAttribute("data-type");
  if (
    explicit === "audio" ||
    explicit === "composition" ||
    explicit === "image" ||
    explicit === "text" ||
    explicit === "video"
  ) {
    return explicit;
  }
  if (el.hasAttribute("data-composition-id") || el.hasAttribute("data-composition-src")) {
    return "composition";
  }
  if (el.tagName === "IMG") return "image";
  if (el.tagName === "VIDEO") return "video";
  if (el.tagName === "AUDIO") return "audio";
  if (isTextLikeElement(el)) return "text";
  return "layer";
}

function isTextLikeElement(el: Element): boolean {
  if (["H1", "H2", "H3", "H4", "H5", "H6", "P", "SPAN", "STRONG", "EM"].includes(el.tagName)) {
    return true;
  }
  const childElementCount = Array.from(el.children).filter(
    (child) => !isIgnoredElement(child),
  ).length;
  return childElementCount === 0 && Boolean(el.textContent?.trim());
}

function readableName(el: HTMLElement): string {
  const explicit = el.getAttribute("data-name")?.trim();
  if (explicit) return explicit;
  const compositionId = el.getAttribute("data-composition-id")?.trim();
  if (compositionId) return compositionId;
  if (isTextLikeElement(el)) {
    const text = el.textContent?.replace(/\s+/g, " ").trim();
    if (text) return text.length > 42 ? `${text.slice(0, 39)}...` : text;
  }
  return humanizeId(el.id);
}

function humanizeId(id: string): string {
  return (
    id
      .replace(/^[a-z]\d+/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^./, (char) => char.toUpperCase()) || id
  );
}

function depthFromRoot(el: Element, root: Element): number {
  let depth = 0;
  let current = el.parentElement;
  while (current && current !== root) {
    if (!isIgnoredElement(current)) depth += 1;
    current = current.parentElement;
  }
  return Math.min(depth, 4);
}

function readDuration(el: Element, fallback: number): number {
  const start = readNumber(el.getAttribute("data-start")) ?? 0;
  const duration = readNumber(el.getAttribute("data-duration"));
  if (duration !== undefined) return duration;
  const end = readNumber(el.getAttribute("data-end"));
  return end !== undefined ? Math.max(0.1, end - start) : fallback;
}

function readNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function cssAttr(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
