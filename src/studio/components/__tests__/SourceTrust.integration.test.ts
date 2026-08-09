import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

describe("executable HyperFrames source trust boundary", () => {
  const trustSource = readSource("src/studio/components/SourceTrustConfirmation.tsx");
  const dashboardSource = readSource("src/studio/components/ProjectDashboard.tsx");
  const inspectorSource = readSource("src/studio/components/Inspector.tsx");
  const librarySource = readSource("src/studio/components/Library.tsx");
  const previewSource = readSource("src/studio/components/HyperFramesPreviewPanel.tsx");

  it("explains the capability boundary and requires explicit consent", () => {
    expect(trustSource).toContain("HyperFrames HTML can run JavaScript");
    expect(trustSource).toContain("local projects and local API");
    expect(trustSource).toContain('type="checkbox"');
  });

  it("requires a sandbox preview and trust confirmation for pasted root projects", () => {
    expect(dashboardSource).toContain("previewHyperframesProject");
    expect(dashboardSource).toContain('importPreviewStatus !== "ready"');
    expect(dashboardSource).toContain("if (!importTrustConfirmed)");
    expect(dashboardSource).toContain("preparedHtmlImport");
    expect(dashboardSource.match(/<SourceTrustConfirmation/g)).toHaveLength(2);
    expect(previewSource).toContain('sandbox="allow-scripts"');
    expect(previewSource).not.toContain('sandbox="allow-scripts allow-same-origin"');
  });

  it("does not expose a separate pasted block trust surface after retirement", () => {
    expect(librarySource).not.toContain("BlocksTab");
    expect(librarySource).not.toContain("sourceTrusted");
    expect(librarySource).not.toContain("SourceTrustConfirmation");
  });

  it("requires sandbox preview readiness and trust before applying composition source", () => {
    expect(inspectorSource).toContain(
      'validatedHtml && previewStatus === "ready" && sourceTrusted',
    );
    expect(inspectorSource).toContain('previewStatus !== "ready" || !sourceTrusted');
    expect(inspectorSource).toContain("<SourceTrustConfirmation");
    expect(inspectorSource).toContain("setSourceTrusted(false)");
  });
});
