import { unzipSync } from "fflate";
import {
  validateCompositionSourceHtml,
  type CompositionSourceValidation,
} from "./hyperframes/composition-source";
import { parseStudioHtml } from "./hyperframes/html";
import { validateHfProject } from "./hyperframes/validate";
import { uid } from "./db";
import type {
  ClipEditorMeta,
  HFAsset,
  MediaAsset,
  MediaBlobRow,
  Project,
  TrackMeta,
} from "./types";

interface ImportHyperframesProjectOptions {
  id?: string;
  name?: string;
  now?: number;
}

export interface ImportedHyperframesProject {
  project: Project;
  mediaFiles: ImportedProjectMediaFile[];
  clipCount: number;
  warnings: string[];
}

export interface ImportedProjectMediaFile {
  asset: MediaAsset;
  mediaBlob: MediaBlobRow;
}

export function createProjectFromHyperframesHtml(
  source: string,
  options: ImportHyperframesProjectOptions = {},
): ImportedHyperframesProject {
  const validation = validateCompositionSourceHtml(source, {
    duration: 30,
    width: 1920,
    height: 1080,
  });
  if (!validation.ok || !validation.html || !validation.compositionId) {
    throw new Error(formatImportErrors(validation));
  }

  const unsupportedRefs = collectUnsupportedReferences(validation.html);
  if (unsupportedRefs.length > 0) {
    throw new Error(
      `This import needs a project bundle importer first:\n${unsupportedRefs
        .map((message) => `- ${message}`)
        .join("\n")}`,
    );
  }

  const id = options.id ?? uid();
  const now = options.now ?? Date.now();
  const tracks = createDefaultTracks();
  const rootHtml = retargetCompositionId(validation.html, validation.compositionId, id);
  const { clips, warnings } = deriveImportedClipMeta(rootHtml);
  const name = options.name?.trim() || "Imported HyperFrames";

  return {
    clipCount: Object.keys(clips).length,
    mediaFiles: [],
    warnings,
    project: {
      id,
      name,
      createdAt: now,
      updatedAt: now,
      hf: {
        id,
        name,
        width: validation.width ?? 1920,
        height: validation.height ?? 1080,
        fps: 30,
        duration: validation.duration ?? 30,
        assets: [],
        rootHtml,
        compositionHtml: {},
      },
      editorMeta: {
        tracks,
        clips,
      },
    },
  };
}

export async function createProjectFromHyperframesZip(
  file: File,
  options: ImportHyperframesProjectOptions = {},
): Promise<ImportedHyperframesProject> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes);
  } catch {
    throw new Error("ZIP could not be read. Choose a valid HyperFrames project ZIP.");
  }

  const entries = normalizeZipEntries(unzipped);
  const rootPath = findRootIndexPath(entries);
  if (!rootPath) {
    throw new Error('ZIP import needs an "index.html" file.');
  }

  const rootPrefix = dirname(rootPath);
  const compositionPaths = findCompositionPaths(entries, rootPrefix);
  const mediaFiles = new Map<string, ImportedProjectMediaFile>();
  const rootRaw = decodeZipText(entries, rootPath);

  const rootRewritten = rewriteZipHtmlReferences(rootRaw, {
    entries,
    htmlPath: rootPath,
    rootPrefix,
    compositionPaths,
    mediaFiles,
  });

  const rootValidation = validateCompositionSourceHtml(rootRewritten, {
    duration: 30,
    width: 1920,
    height: 1080,
  });
  if (!rootValidation.ok || !rootValidation.html || !rootValidation.compositionId) {
    throw new Error(formatImportErrors(rootValidation));
  }

  const id = options.id ?? uid();
  const now = options.now ?? Date.now();
  const name = options.name?.trim() || stripExtension(file.name) || "Imported HyperFrames";
  const compositionHtml: Record<string, string> = {};

  for (const compositionPath of compositionPaths) {
    const raw = decodeZipText(entries, compositionPath);
    const rewritten = rewriteZipHtmlReferences(raw, {
      entries,
      htmlPath: compositionPath,
      rootPrefix,
      compositionPaths,
      mediaFiles,
    });
    const validation = validateCompositionSourceHtml(rewritten, {
      duration: rootValidation.duration ?? 30,
      width: rootValidation.width ?? 1920,
      height: rootValidation.height ?? 1080,
      isSubComposition: true,
    });
    if (!validation.ok || !validation.html || !validation.compositionId) {
      throw new Error(
        `Composition "${relativeZipPath(compositionPath, rootPrefix)}" could not be imported:\n${formatImportErrors(validation)}`,
      );
    }

    const expectedId = compositionIdFromPath(relativeZipPath(compositionPath, rootPrefix));
    if (expectedId && validation.compositionId !== expectedId) {
      throw new Error(
        `Composition file "${relativeZipPath(
          compositionPath,
          rootPrefix,
        )}" declares id "${validation.compositionId}", but Studio Boom expects "${expectedId}".`,
      );
    }
    compositionHtml[validation.compositionId] = validation.html;
  }

  const rootHtml = retargetCompositionId(rootValidation.html, rootValidation.compositionId, id);
  const missingRefs = collectMissingPackagedReferences(rootHtml, compositionHtml, mediaFiles);
  if (missingRefs.length > 0) {
    throw new Error(
      `ZIP import is missing required files:\n${missingRefs
        .map((message) => `- ${message}`)
        .join("\n")}`,
    );
  }

  const { clips, warnings } = deriveImportedClipMeta(rootHtml);
  const project: Project = {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    hf: {
      id,
      name,
      width: rootValidation.width ?? 1920,
      height: rootValidation.height ?? 1080,
      fps: 30,
      duration: rootValidation.duration ?? 30,
      assets: Array.from(mediaFiles.values()).map(({ asset }) => mediaAssetToHfAsset(asset)),
      rootHtml,
      compositionHtml,
    },
    editorMeta: {
      tracks: createDefaultTracks(),
      clips,
    },
  };

  validateHfProject(project.hf);

  return {
    project,
    mediaFiles: Array.from(mediaFiles.values()),
    clipCount: Object.keys(clips).length,
    warnings,
  };
}

function formatImportErrors(validation: CompositionSourceValidation): string {
  if (validation.errors.length === 0) return "HyperFrames HTML could not be imported.";
  return `HyperFrames HTML could not be imported:\n${validation.errors
    .map((message) => `- ${message}`)
    .join("\n")}`;
}

function collectUnsupportedReferences(html: string): string[] {
  if (typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const issues: string[] = [];
  const assetRefs = Array.from(doc.querySelectorAll<HTMLElement>("[src]"))
    .map((element) => element.getAttribute("src")?.trim() ?? "")
    .filter((src) => src.startsWith("asset:"));
  if (assetRefs.length > 0) {
    issues.push(`Missing local media assets: ${Array.from(new Set(assetRefs)).join(", ")}`);
  }

  const compositionRefs = Array.from(
    doc.querySelectorAll<HTMLElement>("[data-composition-src], [data-composition-file]"),
  )
    .map(
      (element) =>
        element.getAttribute("data-composition-src")?.trim() ||
        element.getAttribute("data-composition-file")?.trim() ||
        "",
    )
    .filter(Boolean);
  if (compositionRefs.length > 0) {
    issues.push(
      `Missing nested composition files: ${Array.from(new Set(compositionRefs)).join(", ")}`,
    );
  }

  return issues;
}

interface RewriteZipReferencesArgs {
  entries: Map<string, Uint8Array>;
  htmlPath: string;
  rootPrefix: string;
  compositionPaths: string[];
  mediaFiles: Map<string, ImportedProjectMediaFile>;
}

function normalizeZipEntries(unzipped: Record<string, Uint8Array>): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();
  for (const [rawPath, bytes] of Object.entries(unzipped)) {
    const path = normalizeZipPath(rawPath);
    if (!path || path.endsWith("/") || path.includes("__MACOSX/")) continue;
    entries.set(path, bytes);
  }
  return entries;
}

function normalizeZipPath(path: string): string | null {
  let next = path.replace(/\\/g, "/").replace(/^\/+/, "");
  while (next.startsWith("./")) next = next.slice(2);
  if (!next || next.split("/").some((part) => part === "..")) return null;
  return next;
}

function findRootIndexPath(entries: Map<string, Uint8Array>): string | null {
  const candidates = Array.from(entries.keys())
    .filter((path) => basename(path).toLowerCase() === "index.html")
    .sort((a, b) => a.split("/").length - b.split("/").length || a.length - b.length);
  return candidates[0] ?? null;
}

function findCompositionPaths(entries: Map<string, Uint8Array>, rootPrefix: string): string[] {
  return Array.from(entries.keys())
    .filter((path) => {
      const relative = relativeZipPath(path, rootPrefix);
      return /^compositions\/[^/]+\.html$/i.test(relative);
    })
    .sort((a, b) => a.localeCompare(b));
}

function decodeZipText(entries: Map<string, Uint8Array>, path: string): string {
  const bytes = entries.get(path);
  if (!bytes) throw new Error(`ZIP import is missing "${path}".`);
  return new TextDecoder().decode(bytes);
}

function rewriteZipHtmlReferences(source: string, args: RewriteZipReferencesArgs): string {
  if (typeof DOMParser === "undefined") return source;
  const doc = new DOMParser().parseFromString(source, "text/html");
  const errors: string[] = [];
  const compositionPaths = new Set(args.compositionPaths);

  for (const root of getHtmlReferenceRoots(doc)) {
    for (const element of Array.from(
      root.querySelectorAll<HTMLElement>("[data-composition-src]"),
    )) {
      rewriteCompositionSrc(element, "data-composition-src", args, compositionPaths, errors);
    }

    for (const element of Array.from(
      root.querySelectorAll<HTMLElement>("[data-composition-file]"),
    )) {
      rewriteCompositionSrc(element, "data-composition-file", args, compositionPaths, errors);
      const src = element.getAttribute("data-composition-file");
      if (src && !element.hasAttribute("data-composition-src")) {
        element.setAttribute("data-composition-src", src);
      }
    }

    for (const host of Array.from(
      root.querySelectorAll<HTMLElement>('[data-type="composition"]'),
    )) {
      if (host.hasAttribute("data-composition-src")) continue;
      if (host.hasAttribute("src")) {
        rewriteCompositionSrc(host, "src", args, compositionPaths, errors);
        const src = host.getAttribute("src");
        if (src) host.setAttribute("data-composition-src", src);
      }
      const iframe = host.querySelector<HTMLIFrameElement>("iframe[src]");
      if (iframe) {
        rewriteCompositionSrc(iframe, "src", args, compositionPaths, errors);
        const src = iframe.getAttribute("src");
        if (src) host.setAttribute("data-composition-src", src);
      }
    }

    for (const element of Array.from(
      root.querySelectorAll<
        HTMLImageElement | HTMLVideoElement | HTMLAudioElement | HTMLSourceElement
      >("img[src], video[src], audio[src], source[src]"),
    )) {
      rewriteMediaSrc(element, "src", args, errors);
    }

    for (const element of Array.from(root.querySelectorAll<HTMLElement>("[style]"))) {
      const value = element.getAttribute("style");
      if (!value) continue;
      element.setAttribute("style", rewriteCssUrls(value, args, errors));
    }

    for (const style of Array.from(root.querySelectorAll<HTMLStyleElement>("style"))) {
      if (!style.textContent) continue;
      style.textContent = rewriteCssUrls(style.textContent, args, errors);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `ZIP import could not resolve project files:\n${errors
        .map((message) => `- ${message}`)
        .join("\n")}`,
    );
  }

  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
}

function getHtmlReferenceRoots(doc: Document): ParentNode[] {
  const roots: ParentNode[] = [doc];
  for (const template of collectTemplates(doc)) {
    roots.push(template.content);
  }
  return roots;
}

function collectTemplates(root: ParentNode): HTMLTemplateElement[] {
  const templates = Array.from(root.querySelectorAll<HTMLTemplateElement>("template"));
  for (const template of [...templates]) {
    templates.push(...collectTemplates(template.content));
  }
  return templates;
}

function rewriteCompositionSrc(
  element: Element,
  attr: string,
  args: RewriteZipReferencesArgs,
  compositionPaths: Set<string>,
  errors: string[],
): void {
  const ref = element.getAttribute(attr)?.trim();
  if (!ref) return;
  const resolved = resolveLocalZipReference(ref, args.htmlPath, args.rootPrefix);
  if (!resolved) return;
  if (!compositionPaths.has(resolved.path)) {
    errors.push(
      `Missing nested composition file "${ref}" from "${relativeZipPath(args.htmlPath, args.rootPrefix)}".`,
    );
    return;
  }

  const compositionId = compositionIdFromPath(resolved.relative);
  if (!compositionId) {
    errors.push(`Nested composition "${ref}" must live under compositions/<id>.html.`);
    return;
  }
  element.setAttribute(attr, `compositions/${compositionId}.html`);
  if (element instanceof HTMLElement && !element.getAttribute("data-composition-id")) {
    element.setAttribute("data-composition-id", compositionId);
  }
}

function rewriteMediaSrc(
  element: Element,
  attr: string,
  args: RewriteZipReferencesArgs,
  errors: string[],
): void {
  const ref = element.getAttribute(attr)?.trim();
  if (!ref) return;
  const resolved = resolveLocalZipReference(ref, args.htmlPath, args.rootPrefix);
  if (!resolved) return;
  if (!args.entries.has(resolved.path)) {
    errors.push(
      `Missing media file "${ref}" from "${relativeZipPath(args.htmlPath, args.rootPrefix)}".`,
    );
    return;
  }

  const mediaFile = getOrCreateImportedMediaFile(resolved.path, args);
  if (!mediaFile) {
    errors.push(
      `Unsupported local asset "${ref}". ZIP import supports image, audio, and video files.`,
    );
    return;
  }
  element.setAttribute(attr, `asset:${mediaFile.asset.id}`);
}

function rewriteCssUrls(css: string, args: RewriteZipReferencesArgs, errors: string[]): string {
  return css.replace(/url\((["']?)([^"')]+)\1\)/g, (match, quote: string, ref: string) => {
    const trimmed = ref.trim();
    const resolved = resolveLocalZipReference(trimmed, args.htmlPath, args.rootPrefix);
    if (!resolved) return match;
    if (!args.entries.has(resolved.path)) {
      errors.push(
        `Missing media file "${trimmed}" from "${relativeZipPath(args.htmlPath, args.rootPrefix)}".`,
      );
      return match;
    }
    const mediaFile = getOrCreateImportedMediaFile(resolved.path, args);
    if (!mediaFile) {
      errors.push(
        `Unsupported local asset "${trimmed}". ZIP import supports image, audio, and video files.`,
      );
      return match;
    }
    const nextQuote = quote || '"';
    return `url(${nextQuote}asset:${mediaFile.asset.id}${nextQuote})`;
  });
}

function getOrCreateImportedMediaFile(
  path: string,
  args: RewriteZipReferencesArgs,
): ImportedProjectMediaFile | null {
  const existing = args.mediaFiles.get(path);
  if (existing) return existing;

  const bytes = args.entries.get(path);
  if (!bytes) return null;
  const mimeType = mimeTypeFromPath(path);
  const kind = mediaKindFromMimeType(mimeType);
  if (!kind) return null;

  const filename = basename(path);
  const asset: MediaAsset = {
    id: uid(),
    name: stripExtension(filename),
    kind,
    scope: "library",
    mimeType,
    filename,
    createdAt: Date.now(),
  };
  const mediaFile = {
    asset,
    mediaBlob: {
      id: asset.id,
      blob: new Blob([copyToArrayBuffer(bytes)], { type: mimeType }),
    },
  };
  args.mediaFiles.set(path, mediaFile);
  return mediaFile;
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function collectMissingPackagedReferences(
  rootHtml: string,
  compositionHtml: Record<string, string>,
  mediaFiles: Map<string, ImportedProjectMediaFile>,
): string[] {
  const assetIds = new Set(Array.from(mediaFiles.values()).map(({ asset }) => asset.id));
  const compositionIds = new Set(Object.keys(compositionHtml));
  const issues = [
    ...collectMissingReferencesFromHtml(rootHtml, "index.html", assetIds, compositionIds),
  ];
  for (const [compositionId, html] of Object.entries(compositionHtml)) {
    issues.push(
      ...collectMissingReferencesFromHtml(
        html,
        `compositions/${compositionId}.html`,
        assetIds,
        compositionIds,
      ),
    );
  }
  return Array.from(new Set(issues));
}

function collectMissingReferencesFromHtml(
  html: string,
  label: string,
  assetIds: Set<string>,
  compositionIds: Set<string>,
): string[] {
  if (typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const issues: string[] = [];

  for (const root of getHtmlReferenceRoots(doc)) {
    for (const element of Array.from(root.querySelectorAll<HTMLElement>("[src]"))) {
      const src = element.getAttribute("src")?.trim() ?? "";
      if (!src.startsWith("asset:")) continue;
      const assetId = src.slice("asset:".length);
      if (!assetIds.has(assetId)) issues.push(`${label} references missing asset "${assetId}".`);
    }

    for (const element of Array.from(
      root.querySelectorAll<HTMLElement>("[data-composition-src]"),
    )) {
      const src = element.getAttribute("data-composition-src")?.trim() ?? "";
      const compositionId = compositionIdFromPath(src);
      if (compositionId && !compositionIds.has(compositionId)) {
        issues.push(`${label} references missing composition "${src}".`);
      }
    }

    for (const element of Array.from(
      root.querySelectorAll<HTMLElement>("[data-composition-file]"),
    )) {
      const src = element.getAttribute("data-composition-file")?.trim() ?? "";
      const compositionId = compositionIdFromPath(src);
      if (compositionId && !compositionIds.has(compositionId)) {
        issues.push(`${label} references missing composition "${src}".`);
      }
    }
  }

  return issues;
}

function resolveLocalZipReference(
  ref: string,
  htmlPath: string,
  rootPrefix: string,
): { path: string; relative: string } | null {
  const stripped = stripRefHashAndQuery(ref.trim());
  if (!stripped || isExternalOrSpecialRef(stripped)) return null;
  const path = stripped.startsWith("/")
    ? joinZipPath(rootPrefix, stripped.slice(1))
    : joinZipPath(dirname(htmlPath), stripped);
  return { path, relative: relativeZipPath(path, rootPrefix) };
}

function isExternalOrSpecialRef(ref: string): boolean {
  if (ref.startsWith("#")) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return true;
  return false;
}

function stripRefHashAndQuery(ref: string): string {
  const hash = ref.indexOf("#");
  const query = ref.indexOf("?");
  const cut = Math.min(...[hash, query].filter((index) => index >= 0));
  return cut === Infinity ? ref : ref.slice(0, cut);
}

function joinZipPath(base: string, ref: string): string {
  const parts = base ? base.split("/").filter(Boolean) : [];
  for (const part of ref.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function relativeZipPath(path: string, rootPrefix: string): string {
  if (!rootPrefix) return path;
  return path.startsWith(`${rootPrefix}/`) ? path.slice(rootPrefix.length + 1) : path;
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^/.]+$/, "");
}

function compositionIdFromPath(path: string): string | null {
  return path.match(/^compositions\/([^/]+)\.html$/i)?.[1] ?? null;
}

function mimeTypeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    mp4: "video/mp4",
    webm: "video/webm",
  };
  return map[ext] ?? "application/octet-stream";
}

function mediaKindFromMimeType(mimeType: string): MediaAsset["kind"] | null {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return null;
}

function mediaAssetToHfAsset(asset: MediaAsset): HFAsset {
  return {
    id: asset.id,
    filename: asset.filename,
    mimeType: asset.mimeType,
    kind: asset.kind,
    width: asset.width,
    height: asset.height,
    duration: asset.duration,
  };
}

function deriveImportedClipMeta(rootHtml: string): {
  clips: Record<string, ClipEditorMeta>;
  warnings: string[];
} {
  const warnings: string[] = [];
  const clips: Record<string, ClipEditorMeta> = {};

  try {
    const { elements } = parseStudioHtml(rootHtml);
    for (const element of elements) {
      const kind = clipKindForElementType(element.type);
      if (!kind) {
        warnings.push(`Element "${element.id}" uses unsupported type "${element.type}".`);
        continue;
      }
      const meta: ClipEditorMeta = {
        kind,
        name: element.name || element.id,
        uiTrackIndex: trackIndexForKind(kind),
        uiLaneIndex: 0,
      };
      if (kind === "composition") {
        const compositionId =
          "compositionId" in element && typeof element.compositionId === "string"
            ? element.compositionId
            : undefined;
        meta.compositionKind = "user-composition";
        meta.compositionId = compositionId;
      }
      clips[element.id] = meta;
    }
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
  }

  if (Object.keys(clips).length === 0) {
    warnings.push("No top-level timeline clips were recognized.");
  }

  return {
    clips,
    warnings: warnings.filter(Boolean),
  };
}

function createDefaultTracks(): TrackMeta[] {
  return [
    { id: uid(), name: "Characters", kind: "character", lanes: 1 },
    { id: uid(), name: "Overlay", kind: "overlay", lanes: 1 },
    { id: uid(), name: "Background", kind: "background", lanes: 1 },
    { id: uid(), name: "Audio", kind: "audio", lanes: 1 },
  ];
}

function trackIndexForKind(kind: ClipEditorMeta["kind"]): number {
  switch (kind) {
    case "audio":
      return 3;
    case "image":
    case "video":
      return 2;
    case "text":
    case "composition":
    default:
      return 1;
  }
}

function clipKindForElementType(type: string): ClipEditorMeta["kind"] | null {
  if (
    type === "image" ||
    type === "video" ||
    type === "audio" ||
    type === "text" ||
    type === "composition"
  ) {
    return type;
  }
  return null;
}

function retargetCompositionId(html: string, previousId: string, nextId: string): string {
  if (previousId === nextId) return html;
  if (typeof DOMParser === "undefined") return replaceTimelineKey(html, previousId, nextId);

  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const element of doc.querySelectorAll("[data-composition-id]")) {
    if (element.getAttribute("data-composition-id") === previousId) {
      element.setAttribute("data-composition-id", nextId);
    }
  }

  return replaceTimelineKey(
    `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`,
    previousId,
    nextId,
  );
}

function replaceTimelineKey(html: string, previousId: string, nextId: string): string {
  const previousJson = JSON.stringify(previousId);
  const nextJson = JSON.stringify(nextId);
  let next = html.split(previousJson).join(nextJson);
  if (!previousId.includes("'")) {
    next = next.split(`'${previousId}'`).join(`'${nextId}'`);
  }
  return next;
}
