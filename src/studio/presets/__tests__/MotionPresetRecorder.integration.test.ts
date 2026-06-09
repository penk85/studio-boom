import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const recorderPath = join(process.cwd(), "src/studio/presets/MotionPresetRecorder.tsx");

describe("MotionPresetRecorder source integration", () => {
  it("previews motion through generated HyperFrames character composition HTML", () => {
    const source = readFileSync(recorderPath, "utf8");

    expect(source).toContain("buildCharacterCompositionHtml");
    expect(source).toContain("<RecorderHyperFramesPreview");
    expect(source).toContain("__timelines?");
    expect(source).toContain("timeline.seek(Math.max(0, time), false)");
    expect(source).toContain("characterAssetIds(character)");
    expect(source).toContain('sandbox="allow-scripts allow-same-origin"');
    expect(source).toContain("const [playbackPreset, setPlaybackPreset]");
    expect(source).toContain("commitRecorderPreviewToHtml");
    expect(source).toContain("applyRecorderEditPose");
    expect(source).toContain("preset={previewPlaying ? playbackPreset : null}");
    // The preview iframe is built once and seeked — it must not reload on identical
    // composition HTML, otherwise the playhead loop trips React's update-depth guard.
    expect(source).toContain("prev === resolved ? prev : resolved");
    expect(source).not.toContain("preset={draftPreviewPreset}");
    expect(source).not.toContain("function RiggedPosePreview");
    expect(source).not.toContain("useMediaUrl(part.mediaId)");
  });
});
