import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Enforces the single-reader invariant: a clip transform may only be read out of the DOM
// through transform.ts (readStudioTransform). The flip flash existed because keyframes.ts had
// its own hand-rolled reader that disagreed about which fields exist. This test fails the build
// if any consumer reads a transform data-attr directly, so a second reader can't creep back in.
//
// Allowed boundary: transform.ts is the reader; html.ts is the HTML parse boundary that does
// present-vs-absent override-merge (semantics readStudioTransform intentionally doesn't express).
// Everything else must call readStudioTransform.

const STUDIO_DIR = join(process.cwd(), "src/studio");

// data-attr reads, both as string literals and via the STUDIO_*_ATTR constants.
const FORBIDDEN = [
  /getAttribute\(\s*"data-(x|y|scale|scale-x|scale-y|rotation)"\s*\)/,
  /getAttribute\(\s*STUDIO_(ROTATION|SCALE_X|SCALE_Y)_ATTR\s*\)/,
];

const ALLOWED_FILES = new Set([
  join(STUDIO_DIR, "hyperframes/transform.ts"),
  join(STUDIO_DIR, "hyperframes/html.ts"),
]);

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      out.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("canonical transform reader invariant", () => {
  it("no consumer reads a transform data-attr directly — only transform.ts / html.ts", () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(STUDIO_DIR)) {
      if (ALLOWED_FILES.has(file)) continue;
      const source = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN) {
        if (pattern.test(source)) {
          offenders.push(`${file.replace(process.cwd() + "/", "")} matched ${pattern}`);
        }
      }
    }
    expect(
      offenders,
      `Transform must be read through readStudioTransform (transform.ts), not hand-rolled:\n${offenders.join(
        "\n",
      )}`,
    ).toEqual([]);
  });
});
