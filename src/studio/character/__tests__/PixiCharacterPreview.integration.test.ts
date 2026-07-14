import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const componentPath = join(process.cwd(), "src/studio/character/PixiCharacterPreview.tsx");
const runtimePath = join(process.cwd(), "src/studio/character/pixi-preview-runtime.ts");

describe("PixiCharacterPreview source integration", () => {
  it("reuses a built scene when only recorder timeline data changes", () => {
    const component = readFileSync(componentPath, "utf8");
    const runtime = readFileSync(runtimePath, "utf8");

    expect(component).toContain("const scenePayloadKey = reuseScene ? null : payload");
    expect(component).toContain(
      "controllerRef.current?.updateTimelineScene(payload.timelineScene)",
    );
    expect(runtime).toContain("updateTimelineScene(nextTimelineScene: CharacterTimelineScene)");
    expect(runtime).toContain("timelineScene = nextTimelineScene");
  });

  it("destroys an initialized application when scene construction fails", () => {
    const runtime = readFileSync(runtimePath, "utf8");

    expect(runtime).toContain("let initialized = false");
    expect(runtime).toContain("if (initialized) {");
    expect(runtime).toContain(
      "app.destroy({ removeView: true, releaseGlobalResources: false }, { children: true })",
    );
  });
});
