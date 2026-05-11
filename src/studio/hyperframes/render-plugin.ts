import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

interface RenderResult {
  outputPath: string;
  createdAt: number;
  log: string;
}

const results = new Map<string, RenderResult>();

export function hyperframesRenderPlugin(): Plugin {
  return {
    name: "studio-boom-hyperframes-render",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          if (req.method === "POST" && req.url === "/api/hyperframes/render") {
            await handleRender(req, res);
            return;
          }

          if (req.method === "GET" && req.url?.startsWith("/api/hyperframes/result/")) {
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

async function handleRender(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const id = randomUUID();
  const rootDir = path.join(tmpdir(), "studio-boom-hyperframes", id);
  const projectDir = path.join(rootDir, "project");
  const outputPath = path.join(rootDir, "studio-boom.mp4");
  await mkdir(projectDir, { recursive: true });

  const request = await nodeRequestFromIncoming(req);
  const form = await request.formData();
  const files = form.getAll("file");
  if (files.length === 0) {
    throw new Error("Render request did not include any HyperFrames project files.");
  }

  for (const entry of files) {
    if (!(entry instanceof File)) continue;
    const relativePath = safeRelativeFilePath(entry.name);
    const filePath = path.join(projectDir, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, Buffer.from(await entry.arrayBuffer()));
  }

  let log = "";
  log += await runHyperframes(["render", projectDir, "--output", outputPath, "--format", "mp4"]);

  results.set(id, { outputPath, createdAt: Date.now(), log });
  sendJson(res, { url: `/api/hyperframes/result/${id}`, log });
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
