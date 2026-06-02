import { normalizeNativeHyperframesHtml } from "./native";
import { findInlineScripts } from "./script-blocks";

export interface CompositionSourceValidation {
  ok: boolean;
  errors: string[];
  compositionId?: string;
  duration?: number;
  width?: number;
  height?: number;
  html?: string;
}

export interface CompositionSourceDefaults {
  compositionId?: string;
  duration: number;
  width: number;
  height: number;
}

export function validateCompositionSourceHtml(
  html: string,
  defaults: CompositionSourceDefaults,
): CompositionSourceValidation {
  const errors: string[] = [];
  const trimmed = html.trim();
  if (!trimmed) {
    return { ok: false, errors: ["Composition source is empty."] };
  }
  if (typeof DOMParser === "undefined") {
    return { ok: false, errors: ["DOMParser is not available in this environment."] };
  }

  const validationSource = unwrapSingleTemplateForValidation(trimmed);
  const doc = new DOMParser().parseFromString(validationSource, "text/html");
  const parserError = doc.querySelector("parsererror");
  if (parserError) errors.push("HTML could not be parsed.");

  const root = findCompositionRoot(doc);
  if (!root) {
    errors.push(
      'Missing an element with data-composition-id, such as <html data-composition-id="...">.',
    );
  }

  const compositionId = root?.getAttribute("data-composition-id")?.trim() || defaults.compositionId;
  if (!compositionId) errors.push("Missing composition id.");

  const stageCompositionId = doc
    .getElementById("stage")
    ?.getAttribute("data-composition-id")
    ?.trim();
  if (compositionId && stageCompositionId && stageCompositionId !== compositionId) {
    errors.push(
      `#stage data-composition-id "${stageCompositionId}" must match composition id "${compositionId}".`,
    );
  }

  const duration =
    parsePositiveNumber(root?.getAttribute("data-duration")) ??
    parsePositiveNumber(doc.documentElement.getAttribute("data-composition-duration")) ??
    defaults.duration;
  const width =
    parsePositiveNumber(root?.getAttribute("data-width")) ??
    parsePositiveNumber(doc.documentElement.getAttribute("data-width")) ??
    parsePositiveNumber(doc.documentElement.getAttribute("data-composition-width")) ??
    defaults.width;
  const height =
    parsePositiveNumber(root?.getAttribute("data-height")) ??
    parsePositiveNumber(doc.documentElement.getAttribute("data-height")) ??
    parsePositiveNumber(doc.documentElement.getAttribute("data-composition-height")) ??
    defaults.height;

  if (!Number.isFinite(duration) || duration <= 0) errors.push("Duration must be positive.");
  if (!Number.isFinite(width) || width <= 0) errors.push("Width must be positive.");
  if (!Number.isFinite(height) || height <= 0) errors.push("Height must be positive.");

  if (!doc.querySelector("script")) {
    errors.push(
      "Missing script timeline registration. Add a paused GSAP timeline and register it on window.__timelines.",
    );
  }
  errors.push(...validateInlineScriptSyntax(trimmed));

  if (compositionId && !sourceMentionsTimelineRegistration(trimmed, compositionId)) {
    errors.push(`Missing window.__timelines registration for "${compositionId}".`);
  }

  errors.push(...validateTimedClipTracks(doc, root, compositionId));

  if (/\brepeat\s*:\s*-1\b/.test(trimmed)) {
    errors.push("Infinite GSAP repeats are not allowed. Use a finite repeat count.");
  }

  if (errors.length > 0) {
    return { ok: false, errors, compositionId, duration, width, height };
  }

  const normalized =
    validationSource === trimmed
      ? normalizeNativeHyperframesHtml(trimmed, { width, height })
      : serializeHtmlDocument(trimmed);
  return {
    ok: true,
    errors: [],
    compositionId,
    duration,
    width,
    height,
    html: normalized,
  };
}

export function buildCompositionRepairPrompt(errors: string[], html: string): string {
  return `Fix this HyperFrames composition for Studio Boom.

Validation errors:
${errors.map((error) => `- ${error}`).join("\n")}

Original HTML:
${html}`;
}

function findCompositionRoot(doc: Document): Element | null {
  if (doc.documentElement.hasAttribute("data-composition-id")) return doc.documentElement;
  return doc.querySelector("[data-composition-id]");
}

function unwrapSingleTemplateForValidation(html: string): string {
  if (!html.toLowerCase().includes("<template")) return html;

  const doc = new DOMParser().parseFromString(html, "text/html");
  const container = doc.body ?? doc.documentElement;
  const template =
    getSingleMeaningfulElementChild(container) ?? getOnlyTemplateWhenBodyIsEmpty(doc);
  if (template?.tagName !== "TEMPLATE") return html;
  return (template as HTMLTemplateElement).innerHTML.trim();
}

function getOnlyTemplateWhenBodyIsEmpty(doc: Document): Element | null {
  if (getSingleMeaningfulElementChild(doc.body)) return null;
  const templates = Array.from(doc.querySelectorAll("template"));
  return templates.length === 1 ? (templates[0] ?? null) : null;
}

function getSingleMeaningfulElementChild(container: ParentNode): Element | null {
  let child: Element | null = null;
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && !(node.textContent ?? "").trim()) continue;
    if (node.nodeType === Node.COMMENT_NODE) continue;
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    if (child) return null;
    child = node as Element;
  }
  return child;
}

function serializeHtmlDocument(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
}

function parsePositiveNumber(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function sourceMentionsTimelineRegistration(html: string, compositionId: string): boolean {
  return (
    html.includes(`__timelines["${compositionId}"]`) ||
    html.includes(`__timelines['${compositionId}']`) ||
    html.includes(`__timelines[${JSON.stringify(compositionId)}]`)
  );
}

interface ScheduledClip {
  id: string;
  track: string;
  start: number;
  end: number;
}

function validateTimedClipTracks(
  doc: Document,
  root: Element | null,
  compositionId: string | undefined,
): string[] {
  const errors: string[] = [];
  const scheduledByTrack = new Map<string, ScheduledClip[]>();

  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[data-start], [data-duration]"))) {
    if (["SCRIPT", "STYLE", "TEMPLATE"].includes(el.tagName)) continue;

    const label = formatElementLabel(el);
    const isCompositionRoot =
      (root !== null && el === root) ||
      (compositionId !== undefined &&
        el.id === "stage" &&
        el.getAttribute("data-composition-id") === compositionId);
    const track = el.getAttribute("data-track-index");

    if (isCompositionRoot && track !== null) {
      errors.push(
        `${label} is the composition root and should not set data-track-index. Put tracks on its timed child clips instead.`,
      );
      continue;
    }

    if (!isCompositionRoot && track === null) {
      errors.push(`${label} has timing but is missing data-track-index.`);
      continue;
    }

    const start = parseNumber(el.getAttribute("data-start"));
    const duration = parseNumber(el.getAttribute("data-duration"));
    if (track === null || start === undefined || duration === undefined) continue;

    const clips = scheduledByTrack.get(track) ?? [];
    clips.push({
      id: label,
      track,
      start,
      end: start + duration,
    });
    scheduledByTrack.set(track, clips);
  }

  for (const [track, clips] of scheduledByTrack) {
    clips.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    for (let i = 0; i < clips.length - 1; i += 1) {
      const current = clips[i];
      const next = clips[i + 1];
      if (!current || !next || current.end <= next.start) continue;
      errors.push(
        `Track ${track}: ${current.id} ending at ${current.end}s overlaps with ${next.id} starting at ${next.start}s. Move one clip to a different data-track-index.`,
      );
    }
  }

  return errors;
}

function parseNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatElementLabel(el: Element): string {
  const id = el.getAttribute("id");
  return `<${el.tagName.toLowerCase()}${id ? ` id="${id}"` : ""}>`;
}

function validateInlineScriptSyntax(html: string): string[] {
  const errors: string[] = [];
  for (const script of findInlineScripts(html)) {
    try {
      // Parse only. This does not execute the pasted script.
      new Function(script.source);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Script block ${script.index} has invalid JavaScript: ${message}`);
    }
  }
  return errors;
}
