// Builds the real HyperFrames project file tree from project.hf for MP4 rendering.
// This is an adapter for the HyperFrames CLI, not a second render model.
import gsapRaw from "gsap/dist/gsap.min.js?raw";
import { db } from "../db";
import type { HFAsset, Project } from "../types";
import { validateHfProject } from "../hyperframes/validate";
import { normalizeNativeHyperframesHtml } from "../hyperframes/native";

const GSAP_RUNTIME_FILENAME = "gsap.min.js";
const PIXI_RUNTIME_FILENAME = "pixi.min.js";

export interface HyperframesTextFile {
  path: string;
  contents: string;
  mimeType: string;
}

export interface HyperframesBinaryFile {
  path: string;
  blob: Blob;
  mimeType: string;
}

export interface HyperframesProjectFiles {
  textFiles: HyperframesTextFile[];
  binaryFiles: HyperframesBinaryFile[];
}

export function extFromAsset(filename: string, mimeType: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot !== -1) return filename.slice(dot).toLowerCase();
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/mp4": ".m4a",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
  };
  return map[mimeType] ?? "";
}

export function resolvePackagedAssetRefs(
  html: string,
  assets: HFAsset[],
  assetPrefix: "assets" | "../assets",
): string {
  const assetPathById = new Map(
    assets.map((asset) => [
      asset.id,
      `${assetPrefix}/${asset.id}${extFromAsset(asset.filename, asset.mimeType)}`,
    ]),
  );

  return html.replace(/asset:([a-zA-Z0-9_-]+)/g, (match, assetId: string) => {
    return assetPathById.get(assetId) ?? match;
  });
}

export function resolvePackagedRuntimeRefs(
  html: string,
  options: { gsap: "root" | "omit"; pixi?: "root" | "composition" | "omit" },
): string {
  if (!html) return html;

  if (typeof DOMParser === "undefined") {
    return resolvePackagedRuntimeRefsFallback(html, options);
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const link of Array.from(doc.querySelectorAll<HTMLLinkElement>("link[href]"))) {
    if (isRemoteFontLink(link)) link.remove();
  }

  for (const script of Array.from(doc.querySelectorAll<HTMLScriptElement>("script[src]"))) {
    const src = script.getAttribute("src") ?? "";
    if (isHyperframesRuntimeScriptSrc(src)) {
      script.remove();
      continue;
    }
    if (isPixiScriptSrc(src)) {
      if (options.pixi === "omit") {
        script.remove();
      } else if (options.pixi === "root") {
        script.setAttribute("src", PIXI_RUNTIME_FILENAME);
      } else if (options.pixi === "composition") {
        script.setAttribute("src", `../${PIXI_RUNTIME_FILENAME}`);
      }
      continue;
    }
    if (!isGsapScriptSrc(src)) continue;
    if (options.gsap === "omit") {
      script.remove();
    } else {
      script.setAttribute("src", GSAP_RUNTIME_FILENAME);
    }
  }

  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}

export async function buildHyperframesProjectFiles(
  project: Project,
): Promise<HyperframesProjectFiles> {
  const { hf } = project;

  validateHfProject(hf);

  const mediaExtMap = new Map<string, string>();
  for (const asset of hf.assets) {
    mediaExtMap.set(asset.id, extFromAsset(asset.filename, asset.mimeType));
  }
  const usesPixiRuntime = projectUsesPixiRuntime(project);

  const assetIds = hf.assets.map((asset) => asset.id);
  const mediaBlobs =
    assetIds.length > 0 ? await db.mediaBlobs.where("id").anyOf(assetIds).toArray() : [];
  const blobMap = new Map(mediaBlobs.map((row) => [row.id, row.blob]));
  assertExportBlobsPresent(hf.assets, blobMap);
  const pixiRuntimeRaw = usesPixiRuntime ? await loadPixiRuntimeRaw() : null;

  const compositionTextFiles: HyperframesTextFile[] = Object.entries(hf.compositionHtml).map(
    ([id, html]) => ({
      path: `compositions/${id}.html`,
      contents: resolvePackagedAssetRefs(
        resolvePackagedRuntimeRefs(normalizeNativeHyperframesHtml(html), {
          gsap: "omit",
          pixi: "composition",
        }),
        hf.assets,
        "../assets",
      ),
      mimeType: "text/html",
    }),
  );

  return {
    textFiles: [
      {
        path: "index.html",
        contents: resolvePackagedAssetRefs(
          resolvePackagedRuntimeRefs(
            normalizeNativeHyperframesHtml(hf.rootHtml, { width: hf.width, height: hf.height }),
            { gsap: "root", pixi: "root" },
          ),
          hf.assets,
          "assets",
        ),
        mimeType: "text/html",
      },
      { path: GSAP_RUNTIME_FILENAME, contents: gsapRaw, mimeType: "text/javascript" },
      ...(pixiRuntimeRaw
        ? [{ path: PIXI_RUNTIME_FILENAME, contents: pixiRuntimeRaw, mimeType: "text/javascript" }]
        : []),
      ...compositionTextFiles,
    ],
    binaryFiles: hf.assets.map((asset) => {
      const ext = mediaExtMap.get(asset.id) ?? "";
      return {
        path: `assets/${asset.id}${ext}`,
        blob: blobMap.get(asset.id)!,
        mimeType: asset.mimeType,
      };
    }),
  };
}

export function assertExportBlobsPresent(assets: HFAsset[], blobMap: Map<string, Blob>): void {
  const missing = assets.filter((asset) => !blobMap.has(asset.id));
  if (missing.length === 0) return;

  throw new Error(
    `Export is missing media blobs:\n${missing
      .map((asset) => `- ${asset.id}${asset.filename ? ` (${asset.filename})` : ""}`)
      .join("\n")}`,
  );
}

function isRemoteFontLink(link: HTMLLinkElement): boolean {
  const href = (link.getAttribute("href") ?? "").trim().toLowerCase();
  if (link.hasAttribute("data-hf-fonts")) return true;
  return href.includes("fonts.googleapis.com") || href.includes("fonts.gstatic.com");
}

function isGsapScriptSrc(src: string): boolean {
  const value = src.trim().toLowerCase();
  if (!value) return false;
  if (value.includes("cdn.jsdelivr.net/npm/gsap@") && value.includes("/dist/gsap")) return true;
  if (value.includes("unpkg.com/gsap@") && value.includes("/dist/gsap")) return true;
  return /(?:^|\/)gsap(?:\.min)?\.js(?:[?#].*)?$/.test(value);
}

function isPixiScriptSrc(src: string): boolean {
  const value = src.trim().toLowerCase();
  if (!value) return false;
  if (value.includes("pixijs.download") && /\/pixi(?:\.min)?\.(?:m?js)/.test(value)) return true;
  if (value.includes("cdn.jsdelivr.net/npm/pixi.js")) return true;
  if (value.includes("unpkg.com/pixi.js")) return true;
  return /(?:^|\/)pixi(?:\.min)?\.(?:m?js)(?:[?#].*)?$/.test(value);
}

function isHyperframesRuntimeScriptSrc(src: string): boolean {
  const value = src.trim().toLowerCase();
  return /(?:^|\/)hyperframes?-runtime(?:\.min)?\.js(?:[?#].*)?$/.test(value);
}

function resolvePackagedRuntimeRefsFallback(
  html: string,
  options: { gsap: "root" | "omit"; pixi?: "root" | "composition" | "omit" },
): string {
  const withoutFonts = html.replace(
    /<link\b(?=[^>]*\bhref=["'][^"']*fonts\.(?:googleapis|gstatic)\.com[^"']*["'])[^>]*>\s*/gi,
    "",
  );
  const withoutHyperframesRuntime = withoutFonts.replace(
    /<script\b(?=[^>]*\bsrc=["'][^"']*hyperframes?-runtime(?:\.min)?\.js(?:[?#][^"']*)?["'])[^>]*>\s*<\/script>/gi,
    "",
  );
  const pixiSrc =
    options.pixi === "root"
      ? PIXI_RUNTIME_FILENAME
      : options.pixi === "composition"
        ? `../${PIXI_RUNTIME_FILENAME}`
        : "";
  const withPixi = withoutHyperframesRuntime.replace(
    /<script\b([^>]*?)\bsrc=["']([^"']*(?:pixijs\.download[^"']*\/pixi(?:\.min)?\.(?:m?js)|cdn\.jsdelivr\.net\/npm\/pixi\.js[^"']*|unpkg\.com\/pixi\.js[^"']*|(?:^|\/)pixi(?:\.min)?\.(?:m?js))[^"']*)["']([^>]*)>\s*<\/script>/gi,
    options.pixi === "omit" ? "" : pixiSrc ? `<script$1src="${pixiSrc}"$3></script>` : "$&",
  );
  return withPixi.replace(
    /<script\b([^>]*?)\bsrc=["']([^"']*(?:cdn\.jsdelivr\.net\/npm\/gsap@[^"']*\/dist\/gsap|unpkg\.com\/gsap@[^"']*\/dist\/gsap|(?:^|\/)gsap(?:\.min)?\.js)[^"']*)["']([^>]*)>\s*<\/script>/gi,
    options.gsap === "omit" ? "" : `<script$1src="${GSAP_RUNTIME_FILENAME}"$3></script>`,
  );
}

async function loadPixiRuntimeRaw(): Promise<string> {
  const runtime = await import("../../../node_modules/pixi.js/dist/pixi.min.js?raw");
  return runtime.default;
}

function projectUsesPixiRuntime(project: Project): boolean {
  return (
    hasPixiRuntimeRef(project.hf.rootHtml) ||
    Object.values(project.hf.compositionHtml).some((html) => hasPixiRuntimeRef(html))
  );
}

function hasPixiRuntimeRef(html: string): boolean {
  if (!html) return false;
  if (typeof DOMParser === "undefined") {
    return /<script\b[^>]*\bsrc=["'][^"']*(?:pixijs\.download[^"']*\/pixi(?:\.min)?\.(?:m?js)|cdn\.jsdelivr\.net\/npm\/pixi\.js[^"']*|unpkg\.com\/pixi\.js[^"']*|(?:^|\/)pixi(?:\.min)?\.(?:m?js))/i.test(
      html,
    );
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll<HTMLScriptElement>("script[src]")).some((script) =>
    isPixiScriptSrc(script.getAttribute("src") ?? ""),
  );
}
