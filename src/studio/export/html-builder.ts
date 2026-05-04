// Generates the root index.html for a HyperFrames-compliant export package.
// Reads from HyperFramesProject (Layer 2) only — pure serialization, no computation.
import type { HFClip, HyperFramesProject } from "../types";

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
  return `assets/${mediaId}${ext}`;
}

// ─── Clip renderer ────────────────────────────────────────────────────────────

function renderHFClip(clip: HFClip, mediaExtMap: Map<string, string>): string {
  const idPart = `id="clip-${escAttr(clip.id)}"`;
  const styleStr = styleToString(clip.style);
  const stylePart = styleStr ? `style="${escAttr(styleStr)}"` : "";

  const dataAttrs = Object.entries(clip.attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}="${escAttr(String(v))}"`)
    .join("\n  ");

  if (clip.tag === "audio") {
    const src = clip.mediaId ? assetPath(clip.mediaId, mediaExtMap) : "";
    return `<audio\n  ${idPart}\n  ${dataAttrs}\n  src="${escAttr(src)}"\n  preload="auto"\n></audio>`;
  }

  if (clip.tag === "video") {
    const src = clip.mediaId ? assetPath(clip.mediaId, mediaExtMap) : "";
    return `<video\n  ${idPart}\n  ${dataAttrs}\n  ${stylePart}\n  src="${escAttr(src)}"\n  muted\n  playsinline\n></video>`;
  }

  if (clip.tag === "img") {
    const src = clip.mediaId ? assetPath(clip.mediaId, mediaExtMap) : "";
    return `<img\n  ${idPart}\n  ${dataAttrs}\n  ${stylePart}\n  src="${escAttr(src)}"\n  alt=""\n>`;
  }

  // div — character clips and overlays; HyperFrames loads compositions from data-composition-src
  return `<div\n  ${idPart}\n  ${dataAttrs}\n  ${stylePart}\n></div>`;
}

// ─── Main timeline script ─────────────────────────────────────────────────────

function buildMainTimelineScript(clips: HFClip[]): string {
  const lines: string[] = [
    `window.__timelines=window.__timelines||{};`,
    `var mainTl=gsap.timeline({paused:true});`,
  ];

  for (const clip of clips) {
    if (clip.tag === "audio") continue;
    const start =
      typeof clip.attrs["data-start"] === "number"
        ? clip.attrs["data-start"]
        : parseFloat(String(clip.attrs["data-start"] ?? "0")) || 0;
    const duration = (clip.attrs["data-duration"] as number) ?? 0;
    const id = `#clip-${clip.id}`;
    lines.push(`mainTl.set(${safeJsonForScript(id)},{opacity:1},${start});`);
    lines.push(`mainTl.set(${safeJsonForScript(id)},{opacity:0},${start + duration});`);
  }

  lines.push(`window.__timelines[${safeJsonForScript("main")}]=mainTl;`);
  return lines.join("\n");
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const BASE_CSS = `*{margin:0;padding:0;box-sizing:border-box}body{background:#000;overflow:hidden;position:relative}`;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the content of the root index.html for the export package.
 * Reads from HyperFramesProject (Layer 2) — pure serialization of hf.clips.
 * `mediaExtMap` maps mediaId → file extension (e.g. ".png", ".mp3").
 * The <body> is the root HyperFrames composition: data-composition-id="root".
 */
export function buildMainHtml(
  hf: HyperFramesProject,
  mediaExtMap: Map<string, string>,
): string {
  const sortedClips = [...hf.clips].sort(
    (a, b) =>
      ((a.attrs["data-track-index"] as number) ?? 0) -
      ((b.attrs["data-track-index"] as number) ?? 0),
  );

  const clipsHtml = sortedClips.map((clip) => renderHFClip(clip, mediaExtMap)).join("\n");
  const mainScript = buildMainTimelineScript(hf.clips);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escAttr(hf.name)}</title>
<style>${BASE_CSS}</style>
</head>
<body data-composition-id="root" data-width="${hf.width}" data-height="${hf.height}">
${clipsHtml}
<script src="gsap.min.js"></script>
<script>
${mainScript}
</script>
</body>
</html>`;
}
