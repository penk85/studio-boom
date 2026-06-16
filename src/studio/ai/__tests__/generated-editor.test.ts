import { afterEach, describe, expect, it, vi } from "vitest";
import { buildJsonRepairPrompt, copyExternalAiPrompt } from "../external-ai";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("copyExternalAiPrompt", () => {
  it("copies prompt packages through the browser clipboard", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const result = await copyExternalAiPrompt("studio boom prompt");

    expect(result).toEqual({ ok: true });
    expect(writeText).toHaveBeenCalledWith("studio boom prompt");
  });

  it("returns a fallback result when clipboard access is unavailable", async () => {
    vi.stubGlobal("navigator", {});

    const result = await copyExternalAiPrompt("manual copy prompt");

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe("buildJsonRepairPrompt", () => {
  it("creates a copyable repair prompt for generated JSON artifacts", () => {
    const prompt = buildJsonRepairPrompt({
      featureName: "Studio Boom text editor",
      artifactLabel: "text animation JSON",
      errors: ["$.tracks[0]: Missing target.", "$.duration: Must be positive."],
      source: '{"kind":"bad"}',
    });

    expect(prompt).toContain("Fix this text animation JSON for Studio Boom text editor.");
    expect(prompt).toContain("- $.tracks[0]: Missing target.");
    expect(prompt).toContain('{"kind":"bad"}');
  });
});
