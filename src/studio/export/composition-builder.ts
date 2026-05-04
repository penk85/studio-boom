// Serializes an HFComposition to HyperFrames-compliant sub-composition HTML.
// Reads from HFComposition (Layer 2) only — no CharacterPreset, no MotionPreset, no recording.
// All pixel values are already in clip-pixel space (scaled once during bake).
import type { HFComposition, HFElement, HFTimelineCall } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DIMENSIONLESS_PROPS = new Set(["opacity", "z-index", "zoom", "flex", "order"]);

function styleToString(style: Record<string, string | number>): string {
  return Object.entries(style)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => {
      if (typeof v === "number") {
        return `${k}:${v}${DIMENSIONLESS_PROPS.has(k) ? "" : "px"}`;
      }
      return `${k}:${v}`;
    })
    .join(";");
}

function escAttr(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function attrsToHtml(attrs: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== false)
    .map(([k, v]) => (v === true ? k : `${k}="${escAttr(String(v))}"`))
    .join(" ");
}

/** Embed JSON in a <script> block without risk of </script> or U+2028/2029 breakout.
 *  fromCharCode avoids embedding literal U+2028/U+2029 (line terminators) in source. */
function safeJsonForScript(value: unknown): string {
  const ls = String.fromCharCode(0x2028); // U+2028 LINE SEPARATOR
  const ps = String.fromCharCode(0x2029); // U+2029 PARAGRAPH SEPARATOR
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .split(ls).join("\\u2028")
    .split(ps).join("\\u2029");
}

function assetPath(mediaId: string, mediaExtMap: Map<string, string>): string {
  const ext = mediaExtMap.get(mediaId) ?? "";
  return `../assets/${mediaId}${ext}`;
}

// ─── Element renderer ─────────────────────────────────────────────────────────

function renderElement(el: HFElement, mediaExtMap: Map<string, string>): string {
  const idAttr = el.id ? `id="${escAttr(el.id)}"` : "";
  const styleStr = styleToString(el.style);
  const styleAttr = styleStr ? `style="${escAttr(styleStr)}"` : "";
  const extraAttrs = el.attrs && Object.keys(el.attrs).length > 0 ? attrsToHtml(el.attrs) : "";
  const parts = [idAttr, extraAttrs, styleAttr].filter(Boolean).join(" ");

  if (el.tag === "img") {
    const src = el.mediaId ? assetPath(el.mediaId, mediaExtMap) : "";
    return `<img ${parts} src="${escAttr(src)}">`;
  }

  if (el.tag === "svg") {
    return `<svg ${parts}>${el.svgContent ?? ""}</svg>`;
  }

  // div
  const children = (el.children ?? []).map((c) => renderElement(c, mediaExtMap)).join("\n");
  return `<div ${parts}>${children}</div>`;
}

// ─── Timeline serializer ──────────────────────────────────────────────────────

function serializeCall(call: HFTimelineCall): string {
  if (call.method === "fromTo") {
    return `tl.fromTo(${safeJsonForScript(call.targets)},${safeJsonForScript(call.fromVars)},${safeJsonForScript(call.toVars)},${call.position});`;
  }
  return `tl.${call.method}(${safeJsonForScript(call.targets)},${safeJsonForScript(call.vars)},${call.position});`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Serializes an HFComposition to a HyperFrames sub-composition HTML file.
 * The output is wrapped in <template data-composition-id="{id}"> as required by the spec.
 * All element pixel values are already in clip-pixel space — no scaling occurs here.
 */
export function buildCompositionHtml(
  composition: HFComposition,
  mediaExtMap: Map<string, string>,
): string {
  const { root, elements, timelineCalls, id } = composition;

  const rootStyleStr = styleToString(root.style);
  const rootAttrsStr = attrsToHtml(root.attrs);
  const elementsHtml = elements.map((el) => renderElement(el, mediaExtMap)).join("\n");

  const stage = `<div ${rootAttrsStr} style="${escAttr(rootStyleStr)}">${elementsHtml}</div>`;

  const tlLines = timelineCalls.map(serializeCall).join("\n  ");
  const tlJs = `(function(){
  var tl=gsap.timeline({paused:true});
  ${tlLines}
  (window.__timelines||(window.__timelines={}))[${safeJsonForScript(id)}]=tl;
})();`;

  return `<template data-composition-id="${escAttr(id)}">
${stage}
<script>${tlJs}</script>
</template>`;
}
