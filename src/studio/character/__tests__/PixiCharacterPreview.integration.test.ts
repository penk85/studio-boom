import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const componentPath = join(process.cwd(), "src/studio/character/PixiCharacterPreview.tsx");
const runtimePath = join(process.cwd(), "src/studio/character/pixi-preview-runtime.ts");
const assetsPath = join(process.cwd(), "src/studio/character/pixi-preview-assets.ts");

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
    expect(runtime).toContain("await textureLease?.release()");
  });

  it("releases shared Pixi Assets only after preview scene teardown", () => {
    const runtime = readFileSync(runtimePath, "utf8");
    const assets = readFileSync(assetsPath, "utf8");

    expect(runtime).toContain("acquirePixiPreviewTextures");
    expect(runtime).toContain("void lease?.release()");
    expect(assets).toContain("createPreviewAssetLeaseManager<Texture>");
    expect(assets).toContain("Assets.unload(key)");
  });

  it("falls back to sprites when the active renderer has no mesh pipe", () => {
    const runtime = readFileSync(runtimePath, "utf8");

    expect(runtime).toContain("const supportsMesh = hasPixiMeshPipe(app)");
    expect(runtime).toContain("createPixiNode(node, textures, supportsMesh)");
    expect(runtime).toContain(
      'typeof renderer.renderPipes?.mesh?.validateRenderable === "function"',
    );
    expect(runtime).toContain(
      'if (supportsMesh && node.kind === "mesh" && node.meshKind === "rope")',
    );
  });

  it("rasterizes SVG layers at their scene output size", () => {
    const assets = readFileSync(assetsPath, "utf8");

    expect(assets).toContain(
      "{ width: asset.rasterWidth, height: asset.rasterHeight, resolution: 1 }",
    );
    expect(assets).not.toContain("{ resolution: 2 }");
  });
});
