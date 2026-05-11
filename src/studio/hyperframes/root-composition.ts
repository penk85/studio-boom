import { generateHyperframesHtml } from "@hyperframes/core";
import type { HyperFramesProject } from "../types";
import { normalizeNativeHyperframesHtml } from "./native";

export function createRootCompositionHtml(
  id: string,
  duration: number,
  width = 1920,
  height = 1080,
): string {
  const hf: Pick<HyperFramesProject, "id" | "width" | "height" | "duration"> = {
    id,
    width,
    height,
    duration,
  };
  const resolution = hf.width >= hf.height ? "landscape" : "portrait";
  const html = generateHyperframesHtml([], hf.duration, {
    compositionId: hf.id,
    resolution,
    includeStyles: true,
    includeScripts: true,
  });

  return normalizeNativeHyperframesHtml(ensureTimelineRegistration(html, hf.id), {
    width: hf.width,
    height: hf.height,
  });
}

export function updateRootCompositionHtml(
  html: string,
  patch: Partial<Pick<HyperFramesProject, "duration" | "width" | "height">>,
): string {
  if (!html || typeof DOMParser === "undefined") return html;

  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.documentElement;
  const stage = doc.getElementById("stage");

  if (patch.duration !== undefined) {
    root.setAttribute("data-composition-duration", String(patch.duration));
    if (stage) stage.setAttribute("data-duration", String(patch.duration));
  }

  if (patch.width !== undefined) {
    root.setAttribute("data-composition-width", String(patch.width));
    if (stage) stage.setAttribute("data-width", String(patch.width));
  }

  if (patch.height !== undefined) {
    root.setAttribute("data-composition-height", String(patch.height));
    if (stage) stage.setAttribute("data-height", String(patch.height));
  }

  return normalizeNativeHyperframesHtml("<!DOCTYPE html>\n" + root.outerHTML, {
    width: patch.width,
    height: patch.height,
  });
}

function ensureTimelineRegistration(html: string, compositionId: string): string {
  if (html.includes("window.__timelines")) return html;
  if (typeof DOMParser === "undefined") {
    return html.replace(
      /(<script>\s*[\s\S]*?gsap\.timeline[\s\S]*?)(\s*<\/script>)/,
      `$1\nwindow.__timelines = window.__timelines || {};\nwindow.__timelines[${JSON.stringify(compositionId)}] = tl;$2`,
    );
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const script of doc.querySelectorAll("script:not([src])")) {
    if (!script.textContent?.includes("gsap.timeline")) continue;
    script.textContent += `\nwindow.__timelines = window.__timelines || {};\nwindow.__timelines[${JSON.stringify(compositionId)}] = tl;`;
    return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
  }
  return html;
}
