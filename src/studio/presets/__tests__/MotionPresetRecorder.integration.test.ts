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
    expect(source).toContain("timeline?.seek?.(Math.max(0, time), false)");
    expect(source).toContain("characterAssetIds(character)");
    expect(source).toContain('sandbox="allow-scripts allow-same-origin"');
    expect(source).toContain("const [playbackPreset, setPlaybackPreset]");
    expect(source).toContain("commitRecorderPreviewToHtml");
    expect(source).toContain("setTime(0)");
    // stablePreviewPreset drives srcDoc (DOM + committed GSAP); editPreviewPreset drives
    // GSAP script injection so overrides/face-turn update without a DOM reload.
    expect(source).toContain("const stablePreviewPreset = useMemo");
    expect(source).toContain("const editPreviewPreset = useMemo");
    expect(source).toContain("preset={previewPlaying ? playbackPreset : stablePreviewPreset}");
    expect(source).toContain("editPreset={previewPlaying ? null : editPreviewPreset}");
    // GSAP script injection: buildCharacterGsapScript produces the IIFE directly (no HTML
    // serialization or DOMParser extraction), then applyEditScriptToIframe injects it.
    expect(source).toContain("buildCharacterGsapScript");
    expect(source).toContain("function applyEditScriptToIframe");
    expect(source).toContain("timeline.kill?.()");
    expect(source).toContain("timeline?.seek?.(Math.max(0, time), false)");
    expect(source).toContain("GeneratedEditorShell");
    expect(source).toContain("AiAddonPromptPanel");
    expect(source).toContain("useAiGeneratedArtifactAddon");
    expect(source).toContain("AiGeneratedFeatureAdapter");
    expect(source).toContain("buildMotionRequestPrompt");
    expect(source).toContain("buildRepairPrompt");
    // The preview iframe is built once and seeked — it must not reload on identical
    // composition HTML, otherwise the playhead loop trips React's update-depth guard.
    expect(source).toContain("prev === resolved ? prev : resolved");
    expect(source).toContain("const [previewCompileRevision, setPreviewCompileRevision]");
    expect(source).toContain("setPreviewCompileRevision((revision) => revision + 1)");
    expect(source).toContain("function recorderHtmlKey");
    expect(source).toContain("key={iframeKey}");
    expect(source).not.toContain("preset={draftPreviewPreset}");
    expect(source).not.toContain("function RiggedPosePreview");
    expect(source).not.toContain("applyRecorderEditPose");
    expect(source).not.toContain("editTargets=");
    expect(source).not.toContain("useMediaUrl(part.mediaId)");
    expect(source).not.toContain("JSON.stringify(\n          buildMotionRequest");
  });

  it("clamps interactive edits through the shared motion-constraint boundary", () => {
    const source = readFileSync(recorderPath, "utf8");

    // Every override edit (slider, rotate drag, plane drag) routes through resolveMotionDelta,
    // so the editor enforces the same reach/rotation limits as compiled playback.
    expect(source).toContain("buildCharacterRuntime(character)");
    expect(source).toContain("const constraintCtx = runtime.constraintContext");
    expect(source).toContain("resolveMotionDelta({");
    expect(source).toContain("resolveFkJointDelta({");
    expect(source).toContain("constrainRecorderOverrides({");
    expect(source).toContain("animatedBoneIdsForRecorderOverrides");
    expect(source).toContain("recorderMotionTargetForSlot");
    expect(source).toContain("const unclampedLayers = new Set(allowOutOfBounds);");
    expect(source).toContain("unclampedLayers,");
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

  it("lets the generated character composition own variant anchors", () => {
    const source = readFileSync(recorderPath, "utf8");

    expect(source).not.toContain("applyRecorderBoneAnchors");
    expect(source).not.toContain("applyRecorderVariantPreview");
    expect(source).not.toContain("recorderBaseLeft");
    expect(source).not.toContain("recorderBaseTop");
    // The anchor debugger is dev-only editor chrome.
    expect(source).toContain("AnchorDebugOverlay");
    expect(source).toContain("import.meta.env.DEV && showAnchorDebug");
  });

  it("derives editable slots from the active character angle", () => {
    const source = readFileSync(recorderPath, "utf8");

    expect(source).toContain("const slots = runtime.slots");
    expect(source).not.toContain("listCharacterSlots(character");
    expect(source).not.toContain("buildMotionConstraintContext({");
  });

  it("does not carry a second recorder-only variant visibility runtime", () => {
    const source = readFileSync(recorderPath, "utf8");

    expect(source).not.toContain("const matchingPartEls = partEls.filter");
    expect(source).not.toContain("recorderPartElementsForSlot");
    expect(source).not.toContain("recorderSlotTransformOrigin");
  });

  it("lets the selected slot drag even when runtime hit-testing misses blank canvas", () => {
    const source = readFileSync(recorderPath, "utf8");

    expect(source).toContain(
      "const subjectId = resolveDragSubject(candidateIds, selectedSlotId) ?? selectedSlotId;",
    );
  });

  it("does not expose rig pivot editing in the motion editor", () => {
    const source = readFileSync(recorderPath, "utf8");

    expect(source).toContain("!previewPlaying && selectedSlot && selectedPart && selectedOverride");
    expect(source).toContain("if (previewPlaying) return;");
    expect(source).not.toContain('title="Set pivot"');
    expect(source).not.toContain('label="Pivot X"');
    expect(source).not.toContain('label="Pivot Y"');
    expect(source).not.toContain("runtimePartFrameLocalPoint");
  });

  it("keeps recorder geometry aligned with rig-bound and swapped variants", () => {
    const source = readFileSync(recorderPath, "utf8");

    expect(source).toContain("resolveRuntimeSlotPart(slot, runtime, poseKey)");
    expect(source).toContain("function recorderPartPlacement");
    expect(source).toContain("runtimePartPlacement(slot, part, runtime");
    expect(source).toContain("resolveRuntimePosePartFrame({");
    expect(source).toContain("resolveTransformForSlot:");
    expect(source).toContain("canvasDeltaToMotionDelta(runtime");
    expect(source).toContain('{ target: "slot", boneId: target.boneId }');
    expect(source).toContain("defaultPoseForCharacter(character)");
    expect(source).toContain("poses: basePoses");
  });
});
