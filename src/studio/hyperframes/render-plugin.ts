import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build as buildWithEsbuild, transformSync } from "esbuild";
import type { IncomingMessage, ServerResponse } from "node:http";
import { parseHTML } from "linkedom";
import puppeteer from "puppeteer";
import type { Plugin } from "vite";
import { findInlineScripts } from "./script-blocks";

interface RenderResult {
  outputPath: string;
  rootDir: string;
  createdAt: number;
  log: string;
}

type BundleToSingleHtml = (
  projectDir: string,
  options?: { runtime?: "inline" | "external"; probeMediaDuration?: boolean },
) => Promise<string>;

const GSAP_RUNTIME_FILENAME = "gsap.min.js";
const PIXI_RUNTIME_FILENAME = "pixi.min.js";
const PREVIEW_RUNTIME_ROUTE_PREFIX = "/api/hyperframes/runtime/";
const RESULT_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_RESULTS = 32;
const results = new Map<string, RenderResult>();
let bundlerPromise: Promise<BundleToSingleHtml> | null = null;

interface HyperframesRenderPluginOptions {
  elevenLabsApiKey?: string;
}

async function rememberRenderResult(id: string, result: RenderResult): Promise<void> {
  await pruneExpiredResults();
  results.set(id, result);
  // Hard cap so a flood of renders can't grow the map unbounded.
  while (results.size > MAX_RESULTS) {
    const oldestKey = results.keys().next().value;
    if (!oldestKey) break;
    const oldestResult = results.get(oldestKey);
    if (oldestResult) await discardRenderResult(oldestKey, oldestResult);
  }
}

async function pruneExpiredResults(now = Date.now()): Promise<void> {
  const cutoff = now - RESULT_TTL_MS;
  const expired: Array<[string, RenderResult]> = [];
  for (const [id, result] of results) {
    if (result.createdAt <= cutoff) expired.push([id, result]);
  }
  await Promise.all(expired.map(([id, result]) => discardRenderResult(id, result)));
}

async function discardRenderResult(id: string, result: RenderResult): Promise<void> {
  if (results.get(id) === result) results.delete(id);
  await removeRenderTempDirectory(result.rootDir);
}

async function discardAllRenderResults(): Promise<void> {
  await Promise.all(
    Array.from(results.entries()).map(([id, result]) => discardRenderResult(id, result)),
  );
}

/** Remove one request's staged project and generated output. */
export async function removeRenderTempDirectory(rootDir: string): Promise<void> {
  await rm(rootDir, { recursive: true, force: true });
}

export function isTrustedStudioApiRequest(headers: { host?: string; origin?: string }): boolean {
  if (!headers.host) return false;
  try {
    const requestHost = new URL(`http://${headers.host}`);
    if (!isLoopbackHostname(requestHost.hostname)) return false;
    if (!headers.origin) return true;

    const origin = new URL(headers.origin);
    return isLoopbackHostname(origin.hostname) && origin.host === requestHost.host;
  } catch {
    return false;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function isStudioApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/hyperframes/") || pathname.startsWith("/api/elevenlabs/");
}

export function hyperframesRenderPlugin(options: HyperframesRenderPluginOptions = {}): Plugin {
  return {
    name: "studio-boom-hyperframes-render",
    apply: "serve",
    configureServer(server) {
      server.httpServer?.once("close", () => {
        void discardAllRenderResults();
      });
      server.middlewares.use(async (req, res, next) => {
        try {
          const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
          if (
            isStudioApiPath(pathname) &&
            !isTrustedStudioApiRequest({
              host: req.headers.host,
              origin: req.headers.origin,
            })
          ) {
            res.statusCode = 403;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end("Studio API requests must come from the local Studio origin.");
            return;
          }

          if (req.method === "POST" && pathname === "/api/hyperframes/render") {
            await handleRender(req, res);
            return;
          }

          if (req.method === "POST" && pathname === "/api/hyperframes/preview-bundle") {
            await handlePreviewBundle(req, res);
            return;
          }

          if (req.method === "GET" && pathname.startsWith(PREVIEW_RUNTIME_ROUTE_PREFIX)) {
            await handlePreviewRuntime(pathname.slice(PREVIEW_RUNTIME_ROUTE_PREFIX.length), res);
            return;
          }

          if (req.method === "POST" && pathname === "/api/hyperframes/thumbnail") {
            await handleThumbnail(req, res);
            return;
          }

          if (req.method === "GET" && pathname.startsWith("/api/hyperframes/result/")) {
            await handleResult(req, res);
            return;
          }

          if (req.method === "GET" && pathname === "/api/elevenlabs/voices") {
            await handleElevenLabsVoices(res, options);
            return;
          }

          if (
            req.method === "POST" &&
            pathname.startsWith("/api/elevenlabs/text-to-speech/") &&
            pathname.endsWith("/with-timestamps")
          ) {
            await handleElevenLabsTts(req, res, pathname, options);
            return;
          }

          if (req.method === "POST" && pathname === "/api/elevenlabs/forced-alignment") {
            await handleElevenLabsForcedAlignment(req, res, options);
            return;
          }

          next();
        } catch (error) {
          sendError(res, error);
        }
      });
    },
  };
}

async function handleElevenLabsVoices(
  res: ServerResponse,
  options: HyperframesRenderPluginOptions,
): Promise<void> {
  const upstream = await fetch("https://api.elevenlabs.io/v1/voices?show_legacy=true", {
    headers: {
      "xi-api-key": elevenLabsApiKey(options),
      Accept: "application/json",
    },
  });
  await pipeUpstreamResponse(res, upstream);
}

async function handleElevenLabsTts(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: HyperframesRenderPluginOptions,
): Promise<void> {
  const voiceId = decodeURIComponent(
    pathname.slice("/api/elevenlabs/text-to-speech/".length).replace(/\/with-timestamps$/, ""),
  );
  if (!voiceId.trim()) throw new Error("ElevenLabs voice id is required");

  const request = await nodeRequestFromIncoming(req);
  const body = await request.text();
  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
      voiceId,
    )}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": elevenLabsApiKey(options),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
    },
  );
  await pipeUpstreamResponse(res, upstream);
}

async function handleElevenLabsForcedAlignment(
  req: IncomingMessage,
  res: ServerResponse,
  options: HyperframesRenderPluginOptions,
): Promise<void> {
  const request = await nodeRequestFromIncoming(req);
  const form = await request.formData();
  const upstream = await fetch("https://api.elevenlabs.io/v1/forced-alignment", {
    method: "POST",
    headers: {
      "xi-api-key": elevenLabsApiKey(options),
      Accept: "application/json",
    },
    body: form,
  });
  await pipeUpstreamResponse(res, upstream);
}

function elevenLabsApiKey(options: HyperframesRenderPluginOptions): string {
  const apiKey = options.elevenLabsApiKey?.trim();
  if (!apiKey) {
    throw new Error(
      "ELEVENLABS_API_KEY is not configured. Add it to .env and restart the dev server.",
    );
  }
  return apiKey;
}

async function pipeUpstreamResponse(res: ServerResponse, upstream: Response): Promise<void> {
  res.statusCode = upstream.status;
  res.setHeader("Content-Type", upstream.headers.get("Content-Type") ?? "application/json");
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

async function handlePreviewBundle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const rootDir = path.join(tmpdir(), "studio-boom-hyperframes", randomUUID());
  const projectDir = path.join(rootDir, "project");
  try {
    await writePostedProjectFiles(req, projectDir);
    await assertProjectFilesNoTrackOverlaps(projectDir);
    const scaleHints = await readCompositionScaleHints(projectDir);
    const bundleToSingleHtml = await loadHyperframesBundler();
    const html = resolvePreviewRuntimeScriptRefs(
      applyCompositionScaleWrappers(
        await bundleToSingleHtml(projectDir, { runtime: "inline" }),
        scaleHints,
      ),
    );
    assertInlineScriptSyntax(html);
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html");
    res.end(html);
  } finally {
    await removeRenderTempDirectory(rootDir);
  }
}

async function handlePreviewRuntime(filename: string, res: ServerResponse): Promise<void> {
  const runtimePath = previewRuntimeFilePath(filename);
  if (!runtimePath) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain");
    res.end("Unknown HyperFrames preview runtime.");
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.end(await readFile(runtimePath));
}

function previewRuntimeFilePath(filename: string): string | null {
  const normalized = path.basename(filename.split(/[?#]/, 1)[0] ?? "");
  if (normalized === GSAP_RUNTIME_FILENAME) {
    return path.join(process.cwd(), "node_modules", "gsap", "dist", GSAP_RUNTIME_FILENAME);
  }
  if (normalized === PIXI_RUNTIME_FILENAME) {
    return path.join(process.cwd(), "node_modules", "pixi.js", "dist", PIXI_RUNTIME_FILENAME);
  }
  return null;
}

export function resolvePreviewRuntimeScriptRefs(html: string): string {
  return resolveRuntimeScriptRefs(html, (runtimeFilename) => {
    return `${PREVIEW_RUNTIME_ROUTE_PREFIX}${runtimeFilename}`;
  });
}

export function resolveRenderRuntimeScriptRefs(html: string): string {
  return resolveRuntimeScriptRefs(html, (runtimeFilename) => runtimeFilename);
}

function resolveRuntimeScriptRefs(
  html: string,
  runtimeSrcForFilename: (runtimeFilename: string) => string,
): string {
  if (!html || !/<script\b/i.test(html)) return html;

  const { document } = parseHTML(html);
  let changed = false;
  for (const script of Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"))) {
    const runtimeFilename = runtimeFilenameFromSrc(script.getAttribute("src") ?? "");
    if (!runtimeFilename) continue;
    script.setAttribute("src", runtimeSrcForFilename(runtimeFilename));
    changed = true;
  }

  return changed ? "<!DOCTYPE html>\n" + document.documentElement.outerHTML : html;
}

function runtimeFilenameFromSrc(src: string): string | null {
  const value = src.trim().toLowerCase();
  if (!value) return null;
  if (value.includes("pixijs.download") && /\/pixi(?:\.min)?\.(?:m?js)/.test(value)) {
    return PIXI_RUNTIME_FILENAME;
  }
  if (value.includes("cdn.jsdelivr.net/npm/pixi.js")) return PIXI_RUNTIME_FILENAME;
  if (value.includes("unpkg.com/pixi.js")) return PIXI_RUNTIME_FILENAME;
  if (/(?:^|\/)\.\.\/pixi(?:\.min)?\.(?:m?js)(?:[?#].*)?$/.test(value)) {
    return PIXI_RUNTIME_FILENAME;
  }
  if (/(?:^|\/)pixi(?:\.min)?\.(?:m?js)(?:[?#].*)?$/.test(value)) {
    return PIXI_RUNTIME_FILENAME;
  }
  if (value.includes("cdn.jsdelivr.net/npm/gsap@") && value.includes("/dist/gsap")) {
    return GSAP_RUNTIME_FILENAME;
  }
  if (value.includes("unpkg.com/gsap@") && value.includes("/dist/gsap")) {
    return GSAP_RUNTIME_FILENAME;
  }
  if (/(?:^|\/)\.\.\/gsap(?:\.min)?\.js(?:[?#].*)?$/.test(value)) return GSAP_RUNTIME_FILENAME;
  if (/(?:^|\/)gsap(?:\.min)?\.js(?:[?#].*)?$/.test(value)) return GSAP_RUNTIME_FILENAME;
  return null;
}

async function loadHyperframesBundler(): Promise<BundleToSingleHtml> {
  bundlerPromise ??= (async () => {
    const entry = path.join(
      process.cwd(),
      "node_modules",
      "@hyperframes",
      "core",
      "dist",
      "compiler",
      "htmlBundler.js",
    );
    const outfile = path.join(tmpdir(), "studio-boom-hyperframes", "htmlBundler.cjs");

    await mkdir(path.dirname(outfile), { recursive: true });
    await buildWithEsbuild({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: "cjs",
      platform: "node",
      target: "node22",
      logLevel: "silent",
      external: ["node:*"],
    });

    const module = (await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`)) as {
      default?: { bundleToSingleHtml?: BundleToSingleHtml };
      bundleToSingleHtml?: BundleToSingleHtml;
    };
    const bundleToSingleHtml = module.bundleToSingleHtml ?? module.default?.bundleToSingleHtml;
    if (typeof bundleToSingleHtml !== "function") {
      throw new Error("HyperFrames bundler did not expose bundleToSingleHtml.");
    }
    return bundleToSingleHtml;
  })();

  return bundlerPromise;
}

async function handleRender(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const id = randomUUID();
  const rootDir = path.join(tmpdir(), "studio-boom-hyperframes", id);
  const projectDir = path.join(rootDir, "project");
  const outputPath = path.join(rootDir, "studio-boom.mp4");
  try {
    await writePostedProjectFiles(req, projectDir);
    await assertProjectFilesNoTrackOverlaps(projectDir);
    const renderPixiArgs = await renderPixiArgsForProject(projectDir);
    const scaleHints = await readCompositionScaleHints(projectDir);
    const bundleToSingleHtml = await loadHyperframesBundler();
    const bundledHtml = resolveRenderRuntimeScriptRefs(
      applyCompositionScaleWrappers(
        await bundleToSingleHtml(projectDir, { runtime: "inline" }),
        scaleHints,
      ),
    );
    assertInlineScriptSyntax(bundledHtml);
    await writeFile(path.join(projectDir, "index.html"), bundledHtml);

    let log = "";
    log += await runHyperframes([
      "render",
      projectDir,
      "--output",
      outputPath,
      "--format",
      "mp4",
      ...renderPixiArgs,
    ]);

    await rememberRenderResult(id, { outputPath, rootDir, createdAt: Date.now(), log });
    sendJson(res, { url: `/api/hyperframes/result/${id}`, log });
  } catch (error) {
    const result = results.get(id);
    if (result) await discardRenderResult(id, result);
    else await removeRenderTempDirectory(rootDir);
    throw error;
  }
}

async function handleThumbnail(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const id = randomUUID();
  const rootDir = path.join(tmpdir(), "studio-boom-hyperframes", id);
  const projectDir = path.join(rootDir, "project");
  try {
    await writePostedProjectFiles(req, projectDir);
    await assertProjectFilesNoTrackOverlaps(projectDir);
    const scaleHints = await readCompositionScaleHints(projectDir);
    const bundleToSingleHtml = await loadHyperframesBundler();
    const bundledHtml = resolveRenderRuntimeScriptRefs(
      applyCompositionScaleWrappers(
        await bundleToSingleHtml(projectDir, { runtime: "inline" }),
        scaleHints,
      ),
    );
    assertInlineScriptSyntax(bundledHtml);
    await writeFile(path.join(projectDir, "index.html"), bundledHtml);

    const png = await captureProjectThumbnail(projectDir, bundledHtml);
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.end(png);
  } finally {
    await removeRenderTempDirectory(rootDir);
  }
}

async function captureProjectThumbnail(projectDir: string, html: string): Promise<Buffer> {
  const dimensions = readRootCompositionDimensions(html);
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-crash-reporter"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: dimensions.width,
      height: dimensions.height,
      deviceScaleFactor: 0.25,
    });
    await page.goto(pathToFileURL(path.join(projectDir, "index.html")).href, {
      waitUntil: "networkidle0",
      timeout: 10000,
    });
    await page.evaluate(() => {
      const hyperframesWindow = window as typeof window & {
        __timelines?: Record<string, unknown>;
      };
      const timelines = Object.values(hyperframesWindow.__timelines ?? {}) as Array<{
        pause?: () => void;
        seek?: (time: number) => void;
      }>;
      for (const timeline of timelines) {
        timeline.pause?.();
        timeline.seek?.(0);
      }
    });
    const png = await page.screenshot({ type: "png" });
    return Buffer.from(png);
  } finally {
    await browser.close();
  }
}

function readRootCompositionDimensions(html: string): { width: number; height: number } {
  const { document } = parseHTML(html);
  const root = document.querySelector("[data-composition-id]") ?? document.documentElement;
  return {
    width:
      parsePositiveNumber(root.getAttribute("data-width")) ??
      parsePositiveNumber(document.documentElement.getAttribute("data-width")) ??
      1920,
    height:
      parsePositiveNumber(root.getAttribute("data-height")) ??
      parsePositiveNumber(document.documentElement.getAttribute("data-height")) ??
      1080,
  };
}

async function writePostedProjectFiles(req: IncomingMessage, projectDir: string): Promise<string> {
  await mkdir(projectDir, { recursive: true });

  const request = await nodeRequestFromIncoming(req);
  const form = await request.formData();
  const files = form.getAll("file");
  if (files.length === 0) {
    throw new Error("Request did not include any HyperFrames project files.");
  }

  for (const entry of files) {
    if (!(entry instanceof File)) continue;
    const relativePath = safeRelativeFilePath(entry.name);
    const filePath = path.join(projectDir, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, Buffer.from(await entry.arrayBuffer()));
  }

  return projectDir;
}

async function handleResult(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const id = decodeURIComponent(req.url?.split("/").pop() ?? "");
  await pruneExpiredResults();
  const result = results.get(id);
  if (!result) {
    res.statusCode = 404;
    res.end("Render result not found.");
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", 'attachment; filename="studio-boom.mp4"');
  const stream = createReadStream(result.outputPath);
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    void discardRenderResult(id, result);
  };
  res.once("finish", cleanup);
  res.once("close", cleanup);
  stream.once("error", (error) => {
    cleanup();
    if (res.headersSent) res.destroy(error);
    else sendError(res, error);
  });
  stream.pipe(res);
}

async function nodeRequestFromIncoming(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  return new Request(`http://localhost${req.url ?? "/"}`, {
    method: req.method,
    headers,
    body: Buffer.concat(chunks),
  });
}

function safeRelativeFilePath(filename: string): string {
  const normalized = filename.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) throw new Error("Render request included an empty filename.");
  if (parts.some((part) => part === "." || part === ".." || part.includes("\0"))) {
    throw new Error(`Render request included an unsafe filename: ${filename}`);
  }
  return path.join(...parts);
}

interface CompositionScaleHint {
  hostId: string;
  naturalWidth: number;
  naturalHeight: number;
}

async function readCompositionScaleHints(projectDir: string): Promise<CompositionScaleHint[]> {
  const rootHtml = await readFile(path.join(projectDir, "index.html"), "utf8");
  const { document } = parseHTML(rootHtml);
  const hints: CompositionScaleHint[] = [];

  for (const host of Array.from(document.querySelectorAll("[data-composition-src]"))) {
    const hostId = host.getAttribute("id")?.trim();
    const src = host.getAttribute("data-composition-src")?.trim();
    const compositionId = host.getAttribute("data-composition-id")?.trim();
    if (!hostId || !src) continue;

    const compPath = safeProjectPath(projectDir, src);
    if (!compPath) continue;

    let compHtml = "";
    try {
      compHtml = await readFile(compPath, "utf8");
    } catch {
      continue;
    }

    const dimensions = readCompositionNaturalDimensions(compHtml, compositionId);
    if (!dimensions) continue;
    hints.push({ hostId, ...dimensions });
  }

  return hints;
}

function readCompositionNaturalDimensions(
  html: string,
  compositionId: string | undefined,
): { naturalWidth: number; naturalHeight: number } | null {
  const { document } = parseHTML(html);
  const selector = compositionId
    ? `[data-composition-id="${escapeCssAttributeValue(compositionId)}"]`
    : "[data-composition-id]";
  const root = document.querySelector(selector) ?? document.querySelector("[data-composition-id]");
  const width =
    parsePositiveNumber(root?.getAttribute("data-width")) ??
    parsePositiveNumber(document.documentElement.getAttribute("data-width")) ??
    parsePositiveNumber(document.documentElement.getAttribute("data-composition-width"));
  const height =
    parsePositiveNumber(root?.getAttribute("data-height")) ??
    parsePositiveNumber(document.documentElement.getAttribute("data-height")) ??
    parsePositiveNumber(document.documentElement.getAttribute("data-composition-height"));
  if (!width || !height) return null;
  return { naturalWidth: width, naturalHeight: height };
}

function applyCompositionScaleWrappers(html: string, hints: CompositionScaleHint[]): string {
  if (hints.length === 0) return html;
  const hintByHostId = new Map(hints.map((hint) => [hint.hostId, hint] as const));
  const { document } = parseHTML(html);

  for (const host of Array.from(
    document.querySelectorAll<HTMLElement>("[data-type='composition']"),
  )) {
    const hostId = host.getAttribute("id")?.trim();
    const hint = hostId ? hintByHostId.get(hostId) : undefined;
    if (!hint) continue;

    const width =
      parsePositiveNumber(host.getAttribute("data-width")) ??
      parsePositiveNumber(host.getAttribute("data-source-width")) ??
      hint.naturalWidth;
    const height =
      parsePositiveNumber(host.getAttribute("data-height")) ??
      parsePositiveNumber(host.getAttribute("data-source-height")) ??
      hint.naturalHeight;

    host.setAttribute("data-studio-composition-natural-width", String(hint.naturalWidth));
    host.setAttribute("data-studio-composition-natural-height", String(hint.naturalHeight));
    host.style.overflow = "hidden";

    let wrapper = host.querySelector<HTMLElement>("[data-studio-composition-scale-root]");
    if (!wrapper) {
      wrapper = document.createElement("div");
      wrapper.setAttribute("data-studio-composition-scale-root", "");
      const children = Array.from(host.childNodes);
      for (const child of children) wrapper.appendChild(child);
      host.appendChild(wrapper);
    }

    wrapper.style.width = `${hint.naturalWidth}px`;
    wrapper.style.height = `${hint.naturalHeight}px`;
    wrapper.style.transformOrigin = "0 0";
    wrapper.style.transform = `scale(${width / hint.naturalWidth}, ${height / hint.naturalHeight})`;
  }

  return "<!DOCTYPE html>\n" + document.documentElement.outerHTML;
}

function safeProjectPath(projectDir: string, relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.some((part) => part === "." || part === ".." || part.includes("\0"))) return null;
  return path.join(projectDir, ...parts);
}

function escapeCssAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function parsePositiveNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

interface TimedHtmlClip {
  label: string;
  track: string;
  start: number;
  end: number;
}

interface ProjectHtmlSource {
  label: string;
  html: string;
}

async function readProjectHtmlSources(projectDir: string): Promise<ProjectHtmlSource[]> {
  const sources: ProjectHtmlSource[] = [
    { label: "index.html", html: await readFile(path.join(projectDir, "index.html"), "utf8") },
  ];
  const compositionsDir = path.join(projectDir, "compositions");

  try {
    const entries = await readdir(compositionsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
      const label = `compositions/${entry.name}`;
      sources.push({
        label,
        html: await readFile(path.join(compositionsDir, entry.name), "utf8"),
      });
    }
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }

  return sources;
}

async function assertProjectFilesNoTrackOverlaps(projectDir: string): Promise<void> {
  const sources = await readProjectHtmlSources(projectDir);

  const errors = sources.flatMap(({ label, html }) => findTrackOverlapErrors(html, label));
  if (errors.length > 0) {
    throw new Error(
      `HyperFrames project has same-track overlaps:\n${errors.join(
        "\n",
      )}\n\nMove one of the listed clips to a different editor lane/track or give internal block clips distinct data-track-index values.`,
    );
  }
}

/** Select safe CLI capture settings from the staged project before bundling rewrites its HTML. */
export async function renderPixiArgsForProject(projectDir: string): Promise<string[]> {
  const sources = await readProjectHtmlSources(projectDir);
  for (const { html } of sources) {
    const args = renderPixiArgsForHtml(html);
    if (args.length > 0) return args;
  }
  return [];
}

export function assertNoTrackOverlaps(html: string, sourceLabel = "HTML"): void {
  const errors = findTrackOverlapErrors(html, sourceLabel);
  if (errors.length > 0) {
    throw new Error(
      `HyperFrames ${sourceLabel} has same-track overlaps:\n${errors.join(
        "\n",
      )}\n\nMove one of the listed clips to a different editor lane/track or give internal block clips distinct data-track-index values.`,
    );
  }
}

/** Keep Pixi meshes on deterministic software WebGL and avoid per-worker context exhaustion. */
export function renderPixiArgsForHtml(html: string): string[] {
  return /data-character-renderer\s*=\s*["']pixi["']/i.test(html)
    ? ["--workers", "1", "--no-browser-gpu"]
    : [];
}

function findTrackOverlapErrors(html: string, sourceLabel: string): string[] {
  const clipsByTrack = new Map<string, TimedHtmlClip[]>();

  for (const rawTag of html.matchAll(/<([a-zA-Z][\w:-]*)(?:\s[^<>]*)?>/g)) {
    const tag = rawTag[0] ?? "";
    const tagName = rawTag[1]?.toLowerCase() ?? "element";
    if (tagName === "script" || tagName === "style" || tagName === "template") continue;

    const start = parseNumericAttr(tag, "data-start");
    const duration = parseNumericAttr(tag, "data-duration");
    const track = readAttr(tag, "data-track-index");
    if (start === null || duration === null || track === null) continue;

    const clips = clipsByTrack.get(track) ?? [];
    clips.push({
      label: formatTimedClipLabel(tagName, tag),
      track,
      start,
      end: start + duration,
    });
    clipsByTrack.set(track, clips);
  }

  const errors: string[] = [];
  for (const [track, clips] of clipsByTrack) {
    clips.sort((a, b) => a.start - b.start || a.label.localeCompare(b.label));
    for (let i = 0; i < clips.length - 1; i += 1) {
      const current = clips[i];
      const next = clips[i + 1];
      if (!current || !next || current.end <= next.start) continue;
      errors.push(
        `${sourceLabel} track ${track}: ${current.label} (${current.start}s-${current.end}s) overlaps ${next.label} (${next.start}s-${next.end}s).`,
      );
    }
  }

  return errors;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function parseNumericAttr(tag: string, attr: string): number | null {
  const value = readAttr(tag, attr);
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readAttr(tag: string, attr: string): string | null {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`\\s${escaped}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, "i"));
  if (!match?.[1]) return null;
  return match[1].replace(/^["']|["']$/g, "");
}

function formatTimedClipLabel(tagName: string, tag: string): string {
  const id = readAttr(tag, "id");
  const compositionId = readAttr(tag, "data-composition-id");
  const source = readAttr(tag, "data-composition-src");
  const name = readAttr(tag, "data-name");
  const parts = [`<${tagName}`];
  if (id) parts.push(` id="${id}"`);
  if (name) parts.push(` data-name="${name}"`);
  if (compositionId) parts.push(` data-composition-id="${compositionId}"`);
  if (source) parts.push(` data-composition-src="${source}"`);
  parts.push(">");
  return parts.join("");
}

function assertInlineScriptSyntax(html: string): void {
  for (const script of findInlineScripts(html)) {
    try {
      transformSync(script.source, {
        loader: "js",
        logLevel: "silent",
        target: "es2022",
      });
    } catch (error) {
      throw new Error(formatScriptSyntaxError(error, script.index, script.htmlLine, script.source));
    }
  }
}

function formatScriptSyntaxError(
  error: unknown,
  scriptIndex: number,
  htmlLine: number,
  source: string,
): string {
  const location = getEsbuildErrorLocation(error);
  const locationText = location
    ? `script line ${location.line}, column ${location.column + 1}, approximate HTML line ${
        htmlLine + location.line
      }`
    : `approximate HTML line ${htmlLine}`;
  const snippet = scriptSnippet(source, location?.line);
  const message = error instanceof Error ? error.message : String(error);
  return `Bundled HyperFrames preview contains invalid inline JavaScript in script block ${scriptIndex} (${locationText}):\n${message}\n\n${snippet}`;
}

function getEsbuildErrorLocation(error: unknown): { line: number; column: number } | null {
  const errors = (error as { errors?: Array<{ location?: { line: number; column: number } }> })
    ?.errors;
  const location = errors?.[0]?.location;
  if (!location) return null;
  return { line: location.line, column: location.column };
}

function scriptSnippet(source: string, line: number | undefined): string {
  const lines = source.split(/\r\n|\r|\n/);
  const center = line && line > 0 ? line : 1;
  const start = Math.max(1, center - 2);
  const end = Math.min(lines.length, center + 2);
  return lines
    .slice(start - 1, end)
    .map((text, index) => {
      const lineNumber = start + index;
      const marker = lineNumber === center ? ">" : " ";
      return `${marker} ${String(lineNumber).padStart(4, " ")} | ${text}`;
    })
    .join("\n");
}

function runHyperframes(args: string[]): Promise<string> {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";

  return new Promise((resolve, reject) => {
    const child = spawn(command, ["hyperframes", ...args], {
      env: { ...process.env, HYPERFRAMES_NO_UPDATE_CHECK: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(output);
        return;
      }
      reject(new Error(`hyperframes ${args.join(" ")} failed:\n${output}`));
    });
  });
}

function sendJson(res: ServerResponse, value: unknown): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(value));
}

function sendError(res: ServerResponse, error: unknown): void {
  res.statusCode = 500;
  res.setHeader("Content-Type", "text/plain");
  res.end(error instanceof Error ? error.message : String(error));
}
