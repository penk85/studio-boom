import { getMediaUrl } from "../db";
import { buildHyperframesProjectFiles, extFromAsset } from "../export/project-files";
import type { HFAsset, Project } from "../types";

export interface ResolvedPreviewHtml {
  html: string;
  revoke: () => void;
}

export async function resolvePreviewHtml(project: Project): Promise<ResolvedPreviewHtml> {
  const { assets } = project.hf;
  const assetEntries = await Promise.all(
    assets.map(async (a) => [a.id, await getMediaUrl(a.id)] as const),
  );
  const assetUrls = new Map(assetEntries.filter((e): e is [string, string] => Boolean(e[1])));
  let html = await bundlePreviewProject(project);
  html = resolvePreviewAssetPaths(html, assets, assetUrls);
  assertPreviewScriptSyntax(html);

  return {
    html,
    revoke: () => {},
  };
}

export async function bundlePreviewProject(project: Project): Promise<string> {
  const files = await buildHyperframesProjectFiles(project);
  const form = new FormData();
  for (const file of files.textFiles) {
    form.append("file", new File([file.contents], file.path, { type: file.mimeType }));
  }
  for (const file of files.binaryFiles) {
    form.append("file", new File([file.blob], file.path, { type: file.mimeType }));
  }

  const response = await fetch("/api/hyperframes/preview-bundle", {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const html = await response.text();
  assertPreviewBundleResponseHtml(html);
  return html;
}

export function assertPreviewBundleResponseHtml(html: string): void {
  const looksLikeStudioShell =
    /<title>\s*Studio Boom\s*<\/title>/i.test(html) ||
    (/<div\s+id=["']root["']\s*><\/div>/i.test(html) &&
      /<script\b[^>]+src=["'][^"']*(?:\/src\/main\.tsx|\/assets\/index-)/i.test(html));

  if (looksLikeStudioShell) {
    throw new Error(
      "Preview bundle endpoint returned the Studio app shell instead of HyperFrames HTML. Restart the dev server and make sure the HyperFrames preview-bundle API is active.",
    );
  }

  if (!/\bdata-composition-id\s*=/.test(html)) {
    throw new Error(
      "Preview bundle endpoint returned HTML without a HyperFrames composition. The preview was blocked so the Studio app cannot render recursively inside the stage.",
    );
  }
}

export function resolvePreviewAssetPaths(
  html: string,
  assets: HFAsset[],
  assetUrls: Map<string, string>,
): string {
  let resolved = html;
  for (const asset of assets) {
    const url = assetUrls.get(asset.id);
    if (!url) continue;
    const ext = extFromAsset(asset.filename, asset.mimeType);
    resolved = resolved.replaceAll(`asset:${asset.id}`, url);
    resolved = resolved.replaceAll(`assets/${asset.id}${ext}`, url);
    resolved = resolved.replaceAll(`../assets/${asset.id}${ext}`, url);
  }
  return resolved;
}

export function assertPreviewScriptSyntax(html: string): void {
  let scriptIndex = 0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = match[1] ?? "";
    const source = match[2] ?? "";
    if (readHtmlAttr(attrs, "src") !== null) continue;
    if (!isClassicJavaScriptType(readHtmlAttr(attrs, "type"))) continue;

    scriptIndex += 1;
    try {
      // Parse only. This does not execute the preview script.
      new Function(source);
    } catch (error) {
      if (error instanceof EvalError) continue;
      const htmlLine = html.slice(0, match.index ?? 0).split(/\r\n|\r|\n/).length;
      throw new Error(formatPreviewScriptSyntaxError(error, scriptIndex, htmlLine, source));
    }
  }
}

function readHtmlAttr(attrs: string, attr: string): string | null {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = attrs.match(new RegExp(`\\s${escaped}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, "i"));
  if (!match?.[1]) return null;
  return match[1].replace(/^["']|["']$/g, "");
}

function isClassicJavaScriptType(type: string | null): boolean {
  if (type === null || type.trim() === "") return true;
  const normalized = type.trim().toLowerCase();
  return (
    normalized === "text/javascript" ||
    normalized === "application/javascript" ||
    normalized === "text/ecmascript" ||
    normalized === "application/ecmascript"
  );
}

function formatPreviewScriptSyntaxError(
  error: unknown,
  scriptIndex: number,
  htmlLine: number,
  source: string,
): string {
  const message = error instanceof Error ? error.message : String(error);
  return `HyperFrames preview contains invalid inline JavaScript in script block ${scriptIndex} near HTML line ${htmlLine}:\n${message}\n\n${scriptSnippet(source)}`;
}

function scriptSnippet(source: string): string {
  const lines = source
    .split(/\r\n|\r|\n/)
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim().length > 0)
    .slice(0, 6);
  return lines
    .map(({ line, lineNumber }) => `  ${String(lineNumber).padStart(4, " ")} | ${line}`)
    .join("\n");
}
