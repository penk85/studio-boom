import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build as buildWithEsbuild, transformSync } from "esbuild";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

interface RenderResult {
  outputPath: string;
  createdAt: number;
  log: string;
}

type BundleToSingleHtml = (
  projectDir: string,
  options?: { runtime?: "inline" | "external"; probeMediaDuration?: boolean },
) => Promise<string>;

const results = new Map<string, RenderResult>();
let bundlerPromise: Promise<BundleToSingleHtml> | null = null;

export function hyperframesRenderPlugin(): Plugin {
  return {
    name: "studio-boom-hyperframes-render",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

          if (req.method === "POST" && pathname === "/api/hyperframes/render") {
            await handleRender(req, res);
            return;
          }

          if (req.method === "POST" && pathname === "/api/hyperframes/preview-bundle") {
            await handlePreviewBundle(req, res);
            return;
          }

          if (req.method === "GET" && pathname.startsWith("/api/hyperframes/result/")) {
            await handleResult(req, res);
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

async function handlePreviewBundle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const projectDir = await writePostedProjectFiles(req);
  const bundleToSingleHtml = await loadHyperframesBundler();
  const html = await bundleToSingleHtml(projectDir, { runtime: "inline" });
  assertNoTrackOverlaps(html);
  assertInlineScriptSyntax(html);
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html");
  res.end(html);
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
  await writePostedProjectFiles(req, projectDir);
  const bundleToSingleHtml = await loadHyperframesBundler();
  const bundledHtml = await bundleToSingleHtml(projectDir, { runtime: "inline" });
  assertNoTrackOverlaps(bundledHtml);
  assertInlineScriptSyntax(bundledHtml);

  let log = "";
  log += await runHyperframes(["render", projectDir, "--output", outputPath, "--format", "mp4"]);

  results.set(id, { outputPath, createdAt: Date.now(), log });
  sendJson(res, { url: `/api/hyperframes/result/${id}`, log });
}

async function writePostedProjectFiles(
  req: IncomingMessage,
  projectDir = path.join(tmpdir(), "studio-boom-hyperframes", randomUUID(), "project"),
): Promise<string> {
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
  const result = results.get(id);
  if (!result) {
    res.statusCode = 404;
    res.end("Render result not found.");
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", 'attachment; filename="studio-boom.mp4"');
  createReadStream(result.outputPath).pipe(res);
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

interface TimedHtmlClip {
  label: string;
  track: string;
  start: number;
  end: number;
}

function assertNoTrackOverlaps(html: string): void {
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
        `Track ${track}: ${current.label} (${current.start}s-${current.end}s) overlaps ${next.label} (${next.start}s-${next.end}s).`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Bundled HyperFrames preview has same-track overlaps:\n${errors.join(
        "\n",
      )}\n\nMove one of the listed clips to a different editor lane/track or give internal block clips distinct data-track-index values.`,
    );
  }
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
  let scriptIndex = 0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = match[1] ?? "";
    const source = match[2] ?? "";
    if (readAttr(attrs, "src") !== null) continue;
    if (!isClassicJavaScriptType(readAttr(attrs, "type"))) continue;

    scriptIndex += 1;
    try {
      transformSync(source, {
        loader: "js",
        logLevel: "silent",
        target: "es2022",
      });
    } catch (error) {
      const htmlLine = html.slice(0, match.index ?? 0).split(/\r\n|\r|\n/).length;
      throw new Error(formatScriptSyntaxError(error, scriptIndex, htmlLine, source));
    }
  }
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
