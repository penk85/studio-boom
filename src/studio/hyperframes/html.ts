import { parseHtml } from "@hyperframes/core";

export type TrackIndexByElementId = Map<string, number>;

// Studio Boom stores canonical studio-facing attrs (`data-duration`,
// `data-track-index`) even while the current core parser still reads the older
// `data-end` shape. The parser expansion below is in-memory only.
export function parseStudioHtml(html: string): ReturnType<typeof parseHtml> {
  return parseHtml(expandDurationForCoreParser(html));
}

export function canonicalizeHyperframesHtml(
  html: string,
  trackIndexByElementId: TrackIndexByElementId = new Map(),
): string {
  if (typeof DOMParser === "undefined") return html;

  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of doc.querySelectorAll<HTMLElement>("[data-start]")) {
    const start = Number.parseFloat(el.getAttribute("data-start") ?? "0");
    const end = Number.parseFloat(el.getAttribute("data-end") ?? "");
    if (!el.hasAttribute("data-duration") && Number.isFinite(start) && Number.isFinite(end)) {
      el.setAttribute("data-duration", String(Math.max(0, end - start)));
    }
    el.removeAttribute("data-end");

    const trackIndex = trackIndexByElementId.get(el.id);
    const layer = el.getAttribute("data-layer");
    if (trackIndex !== undefined) {
      el.setAttribute("data-track-index", String(trackIndex));
    } else if (!el.hasAttribute("data-track-index") && layer !== null) {
      el.setAttribute("data-track-index", layer);
    }

    if (layer !== null && !el.style.zIndex) {
      el.style.zIndex = layer;
    }
    el.removeAttribute("data-layer");
    el.removeAttribute("data-name");
  }

  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}

function expandDurationForCoreParser(html: string): string {
  if (typeof DOMParser === "undefined") return html;

  const doc = new DOMParser().parseFromString(html, "text/html");
  let changed = false;
  for (const el of doc.querySelectorAll<HTMLElement>("[data-start][data-duration]")) {
    if (el.hasAttribute("data-end")) continue;
    const start = Number.parseFloat(el.getAttribute("data-start") ?? "0");
    const duration = Number.parseFloat(el.getAttribute("data-duration") ?? "");
    if (!Number.isFinite(start) || !Number.isFinite(duration)) continue;
    el.setAttribute("data-end", String(start + duration));
    changed = true;
  }

  return changed ? "<!DOCTYPE html>\n" + doc.documentElement.outerHTML : html;
}
