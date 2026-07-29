import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("persistence boundaries", () => {
  it("keeps character writes in the character persistence module", () => {
    const persistenceSource = source("src/studio/character/character-persistence.ts");
    expect(persistenceSource).toContain("db.characters.put");
    expect(persistenceSource).toContain("db.characters.delete");

    const consumers = [
      "src/studio/character/CharacterEditor.tsx",
      "src/studio/character/starter.ts",
      "src/studio/character/use-character-document.ts",
      "src/studio/components/Inspector.tsx",
      "src/studio/components/Library.tsx",
      "src/studio/components/MotionPanel.tsx",
    ];

    for (const consumer of consumers) {
      expect(source(consumer), consumer).not.toMatch(/db\.characters\.(put|delete)/);
    }
  });

  it("keeps motion-preset writes in the preset persistence module", () => {
    expect(source("src/studio/presets/preset-persistence.ts")).toContain("db.motionPresets.put");

    for (const consumer of [
      "src/studio/presets/MotionPresetRecorder.tsx",
      "src/studio/presets/seed.ts",
    ]) {
      expect(source(consumer), consumer).not.toContain("db.motionPresets.put");
    }
  });

  it("keeps render-track HTML rewrites in the HyperFrames HTML boundary", () => {
    const timelineSource = source("src/studio/project-timeline.ts");
    const projectSource = source("src/studio/hyperframes/project-source.ts");
    const htmlSource = source("src/studio/hyperframes/html.ts");

    expect(timelineSource).toContain("updateStudioRenderTrackIndicesInHtml");
    expect(timelineSource).not.toContain("new DOMParser()");
    expect(timelineSource).not.toContain("document.documentElement.outerHTML");
    expect(projectSource).toContain("cloneStudioCompositionSource");
    expect(projectSource).not.toContain("new DOMParser()");
    expect(projectSource).not.toContain("document.documentElement.outerHTML");
    expect(htmlSource).toContain("export function cloneStudioCompositionSource");
    expect(htmlSource).toContain("export function updateStudioRenderTrackIndicesInHtml");
  });
});
