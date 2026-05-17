import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const libraryPath = join(process.cwd(), "src/studio/components/Library.tsx");
const previewPanelPath = join(process.cwd(), "src/studio/components/HyperFramesPreviewPanel.tsx");
const previewHelperPath = join(process.cwd(), "src/studio/hyperframes/preview.ts");

describe("Library Blocks integration", () => {
  it("previews validated custom composition source through the bundled HyperFrames path", () => {
    const librarySource = readFileSync(libraryPath, "utf8");
    const panelSource = readFileSync(previewPanelPath, "utf8");
    const helperSource = readFileSync(previewHelperPath, "utf8");

    expect(librarySource).toContain("buildCompositionPreviewProject(project, validated)");
    expect(librarySource).toContain("<HyperFramesPreviewPanel");
    expect(librarySource).toContain('previewStatus === "ready"');
    expect(librarySource).toContain("onStatusChange={handlePreviewStatusChange}");
    expect(panelSource).toContain("resolvePreviewHtml(project)");
    expect(panelSource).toContain('sandbox="allow-scripts"');
    expect(panelSource).toContain('referrerPolicy="no-referrer"');
    expect(panelSource).toContain("withPreviewSeekDriver");
    expect(panelSource).toContain("window.__timelines");
    expect(panelSource).toContain("timeline.seek(nextTime)");
    expect(panelSource).toContain("postMessage");
    expect(panelSource).toContain('action: "play"');
    expect(panelSource).toContain('hasStartedRef.current ? "play" : "restart"');
    expect(panelSource).toContain("timeline.play()");
    expect(panelSource).toContain("timeline.restart()");
    expect(panelSource).toContain("new ResizeObserver(updateScale)");
    expect(panelSource).toContain("transform: `scale(${scale})`");
    expect(helperSource).toContain('fetch("/api/hyperframes/preview-bundle"');
    expect(panelSource).not.toContain('sandbox="allow-scripts allow-same-origin"');
  });
});
