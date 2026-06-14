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

  it("clamps interactive edits through the shared motion-constraint boundary", () => {
    const source = readFileSync(recorderPath, "utf8");

    // Every override edit (slider, rotate drag, plane drag) routes through resolveMotionDelta,
    // so the editor enforces the same reach/rotation limits as compiled playback.
    expect(source).toContain("buildMotionConstraintContext");
    expect(source).toContain("resolveMotionDelta({");
    expect(source).toContain("unclampedLayers: new Set(allowOutOfBounds)");
    // The escape hatch is carried from the loaded preset, saved back, and mirrored in preview.
    expect(source).toContain("initialPreset?.allowOutOfBounds ?? []");
    expect(source).toContain(
      "allowOutOfBounds: allowOutOfBounds.length ? [...allowOutOfBounds] : undefined",
    );
    expect(source).toContain("allowOutOfBounds: allowOutOfBounds?.length");
    // The override panel surfaces the effective limit and the per-slot toggle.
    expect(source).toContain("effectiveReachForSlot");
    expect(source).toContain("Allow out of bounds");
  });

  it("re-anchors child bones on variant swaps using composition data attributes", () => {
    const source = readFileSync(recorderPath, "utf8");

    expect(source).toContain("applyRecorderBoneAnchors");
    expect(source).toContain("data-character-variant-anchors");
    expect(source).toContain("recorderBaseLeft");
    expect(source).toContain("recorderBaseTop");
    // The anchor debugger is dev-only editor chrome.
    expect(source).toContain("AnchorDebugOverlay");
    expect(source).toContain("import.meta.env.DEV && showAnchorDebug");
  });

  it("derives editable slots from the active character angle", () => {
    const source = readFileSync(recorderPath, "utf8");

    expect(source).toContain("partsAvailableForAngle(character.parts, rig.activeAngle)");
  });

  it("keeps recorder geometry aligned with rig-bound and swapped variants", () => {
    const source = readFileSync(recorderPath, "utf8");

    expect(source).toContain("resolveSlotBinding(rig, slot.id)?.effectivePartId");
    expect(source).toContain("function recorderPartPlacement");
    expect(source).toContain("pivotAlignedPartOffset");
    expect(source).toContain("recorderSlotTransformOrigin");
    expect(source).toContain("recorderBaseTransformOrigin");
    expect(source).toContain('transformTarget.kind === "bone"');
    expect(source).toContain("defaultPoseForCharacter(character)");
    expect(source).toContain("poseKey: override?.poseSwap ?? basePoses[slot.id]");
    expect(source).toContain("poses: basePoses");
  });
});
