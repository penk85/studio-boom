import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const inspectorPath = join(process.cwd(), "src/studio/components/Inspector.tsx");

describe("Inspector source integration", () => {
  it("shows editable composition source and read-only primitive root source", () => {
    const source = readFileSync(inspectorPath, "utf8");

    expect(source).toContain("<CompositionSourceInspector");
    expect(source).toContain("onApply={(html) => updateCompositionHtml");
    expect(source).toContain("<RootElementSourceInspector");
    expect(source).toContain("readRootElementSource(rootHtml, clip.id)");
    expect(source).toContain("readOnly");
  });

  it("shows motion controls for visual clips", () => {
    const source = readFileSync(inspectorPath, "utf8");

    expect(source).toContain("<MotionInspector");
    expect(source).toContain("addClipMotionStep(clip.id, time)");
    expect(source).toContain("addClipMotionCheckpoint(clip.id, motionId, time)");
    expect(source).toContain("updateClipKeyframe");
    expect(source).toContain("moveClipMotionCheckpoint");
    expect(source).toContain("renameClipMotionStep");
    expect(source).toContain("Motion name");
    expect(source).toContain("pointTimeForMotion(motion, localPlayheadTime)");
    expect(source).toContain("Point");
    expect(source).toContain("onSeek(checkpoint.time)");
    expect(source).toContain("removeClipMotionCheckpoint");
    expect(source).toContain("removeClipMotionStep");
    expect(source).toContain("sampleClipKeyframedState(clip, localPlayheadTime)");
  });
});
