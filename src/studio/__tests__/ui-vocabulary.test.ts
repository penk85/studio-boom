import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the canon in docs/ui-vocabulary.md.
 *
 * Studio Boom's audience is people who have never animated anything. The single
 * biggest onboarding hazard is one noun meaning several things: "motion" used to
 * name both travelling a clip across the canvas and a character's body animation.
 * Those are now Move and Action, and this test keeps the old spellings from
 * creeping back into labels.
 *
 * Internal identifiers are deliberately untouched — `MotionPreset`, `motionSteps`,
 * and `checkpoint` remain valid in code. Only *prose* spellings are banned, which
 * is why every pattern below contains a space or is an explicit label literal.
 * That includes prose in comments: comments are how retired naming reaches the
 * next contributor, who then writes it into a label.
 */
const BANNED: { pattern: RegExp; why: string }[] = [
  {
    pattern: /motion preset/i,
    why: 'call these "actions" and "expressions" — users are choosing a thing, not a saved config',
  },
  {
    pattern: /label: "Motion"/,
    why: '"Motion" is ambiguous — use "Move" (clip travels) or "Acting" (character performs)',
  },
  {
    pattern: /"Add motion"|"Delete motion"|"Motion name"|>Motion</,
    why: 'stage motion is called a "Move" in the UI',
  },
  {
    pattern: /title="[^"]*\bcheckpoint\b|>Checkpoint</,
    why: 'a stop inside a Move is a "Point" (or "Begin"/"End")',
  },
];

function tsxFilesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === "__tests__" ? [] : tsxFilesIn(full);
    }
    return full.endsWith(".tsx") ? [full] : [];
  });
}

describe("UI vocabulary", () => {
  const files = tsxFilesIn(join(process.cwd(), "src"));

  it("scans a meaningful number of components", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const { pattern, why } of BANNED) {
    it(`never renders ${pattern} — ${why}`, () => {
      const offenders = files.filter((file) => pattern.test(readFileSync(file, "utf8")));
      expect(offenders, `${pattern} found in:\n${offenders.join("\n")}\n\n${why}`).toEqual([]);
    });
  }
});
