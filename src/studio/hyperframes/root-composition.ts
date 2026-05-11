import { generateHyperframesHtml } from "@hyperframes/core";
import type { Keyframe, TimelineElement } from "@hyperframes/core";
import type { HyperFramesProject } from "../types";
import { parseStudioHtml } from "./html";
import { normalizeNativeHyperframesHtml } from "./native";

export function createRootCompositionHtml(
  id: string,
  duration: number,
  width = 1920,
  height = 1080,
): string {
  return serializeRootCompositionHtml({ id, width, height, duration }, []);
}

export function parseRootComposition(html: string) {
  return parseStudioHtml(html);
}

export function serializeRootCompositionHtml(
  hf: Pick<HyperFramesProject, "id" | "width" | "height" | "duration">,
  elements: TimelineElement[],
  keyframes?: Record<string, Keyframe[]>,
): string {
  const resolution = hf.width >= hf.height ? "landscape" : "portrait";
  const html = generateHyperframesHtml(elements, hf.duration, {
    compositionId: hf.id,
    resolution,
    keyframes,
    includeStyles: true,
    includeScripts: true,
  });

  return normalizeNativeHyperframesHtml(ensureTimelineRegistration(html, hf.id), {
    width: hf.width,
    height: hf.height,
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
