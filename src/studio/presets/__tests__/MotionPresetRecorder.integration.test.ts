import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const recorderPath = join(process.cwd(), "src/studio/presets/MotionPresetRecorder.tsx");
const panelsPath = join(process.cwd(), "src/studio/presets/MotionPresetRecorderPanels.tsx");
const statePath = join(process.cwd(), "src/studio/presets/motion-recorder-state.ts");

describe("MotionPresetRecorder source integration", () => {
  it("previews stamped playback through a persistent Pixi render payload", () => {
    const source = readFileSync(recorderPath, "utf8");
    const panelsSource = readFileSync(panelsPath, "utf8");
    const stateSource = readFileSync(statePath, "utf8");

    expect(source).toContain("buildCharacterRenderPayload");
    expect(source).toContain("const mediaAssets = useStudio((state) => state.mediaAssets)");
    expect(source).toContain("mediaAssets,");
    expect(source).toContain("<RecorderPixiPreview");
    expect(source).toContain("<PixiCharacterPreview");
    expect(source).toContain("reuseScene");
    expect(source).toContain("resolveAssetRef={resolveRecorderPreviewAssetRef}");
    expect(source).toContain("getMediaUrl(asset.id)");
    expect(source).toContain("const [playbackTime, setPlaybackTime]");
    expect(source).toContain("const playbackPreviewPreset = useMemo");
    expect(source).toContain("commitRecorderPreviewToHtml");
    expect(source).toContain("setPlaybackTime(0)");
    // Playback is compiled from stamped keyframes only. The pose editor is an
    // editor-only React draft surface that stamps into the same keypose model.
    expect(source).toContain("preset={playbackPreviewPreset}");
    expect(source).toContain("function ReactPoseCanvas");
    expect(source).toContain("function ReactPosePart");
    expect(source).toContain("matrixToCss(frame.matrix)");
    expect(source).toContain("useMediaUrl(part.mediaId)");
    expect(source).toContain('maxWidth: "none"');
    expect(source).toContain('maxHeight: "none"');
    expect(panelsSource).toContain("export function KeyposeStrip");
    expect(source).toContain("beforeunload");
    expect(source).toContain("Save the action without the current unstamped pose edits?");
    // Playback seeking renders the stamped Pixi payload directly, but the pose
    // editor must not inject or mutate GSAP live while dragging.
    expect(source).not.toContain("function seekRecorderPlaybackIframe");
    expect(source).not.toContain("timeline.seek?.(Math.max(0, time), false)");
    expect(source).not.toContain("buildCharacterGsapScript");
    expect(source).not.toContain("function applyEditScriptToIframe");
    expect(source).not.toContain("data-recorder-live-script");
    expect(source).not.toContain("forceEditScript");
    expect(source).toContain("GeneratedEditorShell");
    expect(source).toContain("AiAddonPromptPanel");
    expect(source).toContain("useAiGeneratedArtifactAddon");
    expect(source).toContain("AiGeneratedFeatureAdapter");
    expect(source).toContain("buildMotionRequestPrompt");
    expect(source).toContain("buildRepairPrompt");
    // The playback pane must not rebuild a full HyperFrames iframe for recorder
    // playback; it keeps a Pixi app and renders explicit time seeks.
    expect(source).not.toContain("<iframe");
    expect(source).not.toContain("srcDoc");
    expect(source).not.toContain('sandbox="allow-scripts allow-same-origin"');
    expect(source).toContain("const [playbackCompileRevision, setPlaybackCompileRevision]");
    expect(source).toContain("setPlaybackCompileRevision((revision) => revision + 1)");
    expect(source).toContain('staleBehavior="blank"');
    expect(source).toContain('loadingLabel="Updating playback..."');
    expect(source).toContain("const primaryStampAction =");
    expect(source).toContain("Time already stamped");
    expect(source).toContain("No changes to update");
    expect(source).toContain("const initialRecorderKeyposes = useMemo");
    expect(stateSource).toContain("export function initialRestKeypose");
    expect(stateSource).toContain("export function ensureInitialRestKeypose");
    expect(stateSource).toContain("return [initialRestKeypose(), ...sorted]");
    expect(source).toContain("function RecorderPixiPreview");
    expect(source).toContain("selectAdjacentKeypose");
    expect(source).not.toContain("preset={draftPreviewPreset}");
    expect(source).not.toContain("function RiggedPosePreview");
    expect(source).not.toContain("applyRecorderEditPose");
    expect(source).not.toContain("editTargets=");
    expect(source).not.toContain("usesGeneratedMouth");
    expect(source).not.toContain("generatedMouthPreviewPart");
    expect(source).not.toContain("__generated-mouth-preview");
    expect(source).not.toContain("Generated mouth");
    expect(source).not.toContain("JSON.stringify(\n          buildMotionRequest");
  });

  it("clamps interactive edits through the shared motion-constraint boundary", () => {
    const source = readFileSync(recorderPath, "utf8");
    const panelsSource = readFileSync(panelsPath, "utf8");

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
    expect(panelsSource).toContain("Allow out of bounds");
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

    expect(source).toContain("selectedSlot && selectedPart && selectedOverride");
    expect(source).toContain("stamped keyframes only");
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

  it("keeps Flexible mesh authoring out of the action editor", () => {
    const source = readFileSync(recorderPath, "utf8");
    const panelsSource = readFileSync(panelsPath, "utf8");
    const stateSource = readFileSync(statePath, "utf8");

    // The action editor may animate an already-flexible limb, but structural
    // mesh setup belongs to the character builder.
    expect(source).not.toContain("roleSupportsBend(selectedSlot.role)");
    expect(source).not.toContain("defaultFlexibleDeformForRecorderPart");
    expect(stateSource).toContain("export function recorderActionLimbPathForPart");
    expect(stateSource).toContain("const neutral = defaultLimbPathDeformForPart(part)");
    expect(stateSource).toContain("...deform");
    expect(stateSource).toContain("width: deform.width ?? neutral.width");
    expect(source).toContain("const flexibleActionPath");
    expect(stateSource).toContain("export function constrainFlexibleCurvePatch");
    expect(source).not.toContain("registrationForPart(part)");
    expect(source).not.toContain('kind: "set-slot-deform"');
    expect(source).not.toContain("onCharacterChange(result.character)");
    expect(source).not.toContain("〰 Flexible");
    expect(source).not.toContain("checked={!!part?.deform}");
    expect(source).not.toContain("onSetFlexible");
    expect(panelsSource).toContain('label="Bend"');
    expect(panelsSource).toContain('label="Reach"');
    expect(panelsSource).toContain("flexibleActionControlState");
    expect(panelsSource).toContain("flexibleBendPatch");
    expect(panelsSource).toContain("flexibleReachPatch");
    expect(panelsSource).toContain("onReset={() => onChange({ pathCurveX: 0, pathCurveY: 0 })}");
    expect(panelsSource).toContain("onReset={() => onChange({ pathEndX: 0, pathEndY: 0 })}");
    expect(source).not.toContain("MAX_BEND_DEGREES");
    expect(source).toContain("pathEndX");
    expect(source).toContain("pathCurveX");
    expect(source).not.toContain("Mesh points");
    expect(source).not.toContain("Add lock");
    expect(source).not.toContain("Snap sockets");
    expect(source).not.toContain("snapSelectedMeshToSockets");
    expect(source).not.toContain("meshSetup");
    expect(source).not.toContain("startMeshSetupPointDrag");
    expect(source).not.toContain("locks: [...locks, nextLock]");
    expect(source).not.toContain("onDeformChange");
    expect(source).toContain("startFlexiblePointDrag");
    expect(source).toContain("onFlexiblePointChange");
    expect(source).not.toContain("pinNameForChildSlot");
    expect(source).not.toContain("flexibleEndpointDragRef");
    expect(source).not.toContain("force: true");
    expect(source).not.toContain(
      "updateOverrides([{ slotId: selectedSlotId, patch }, ...followerUpdates])",
    );
    expect(source).toContain("frame.inverseMatrix");
    expect(source).toContain(
      "const dragStartCanvas = transformPoint(frame.matrix, dragStartPoint)",
    );
    expect(source).toContain("const livePreviewPreset = useMemo");
    expect(source).toContain("preset={livePreviewPreset}");
    expect(panelsSource).toContain("Mirror");
    expect(panelsSource).toContain("Flip");
    expect(stateSource).toContain("toggleSignedScale");
    expect(stateSource).toContain("signedScaleValue");
  });

  it("keeps action-editor selection boxes hidden while preserving canvas drag and rotate", () => {
    const source = readFileSync(recorderPath, "utf8");

    expect(source).not.toContain("RecorderSelectionBox");
    expect(source).not.toContain("TransformMoveable");
    expect(source).toContain("handlePlanePointerDown");
    expect(source).toContain("slotsAtPoint(e.clientX, e.clientY)");
    expect(source).toContain(
      "const subjectId = resolveDragSubject(candidateIds, selectedSlotId) ?? selectedSlotId;",
    );
    expect(source).toContain("startRotationDrag");
    expect(source).toContain("onPointerDown={startRotationDrag}");
    expect(source).toContain("<RotateCw");
  });

  it("keeps recorder state and panels behind focused sibling modules", () => {
    const source = readFileSync(recorderPath, "utf8");
    const panelsSource = readFileSync(panelsPath, "utf8");
    const stateSource = readFileSync(statePath, "utf8");

    expect(source).toContain('from "./MotionPresetRecorderPanels"');
    expect(source).toContain('from "./motion-recorder-state"');
    expect(source).toContain("<KeyposeStrip");
    expect(source).toContain("<PartList");
    expect(source).toContain("<PropertiesPanel");
    expect(panelsSource).toContain("export function KeyposeStrip");
    expect(panelsSource).toContain("export function PartList");
    expect(panelsSource).toContain("export function PropertiesPanel");
    expect(stateSource).toContain("export function initialKeyposesForPreset");
    expect(stateSource).toContain("export function defaultOverride");
    expect(stateSource).toContain("export function recorderOverrideMapsEqual");
    expect(source).not.toContain("function KeyposeStrip");
    expect(source).not.toContain("function PropertiesPanel");
    expect(source).not.toContain("function initialKeyposesForPreset");
    expect(source).not.toContain("function defaultOverride");
  });
});
