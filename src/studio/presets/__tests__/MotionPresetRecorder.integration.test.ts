import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const recorderPath = join(process.cwd(), "src/studio/presets/MotionPresetRecorder.tsx");
const panelsPath = join(process.cwd(), "src/studio/presets/MotionPresetRecorderPanels.tsx");
const previewPath = join(process.cwd(), "src/studio/presets/MotionPresetRecorderPreview.tsx");
const geometryPath = join(process.cwd(), "src/studio/presets/motion-recorder-geometry.ts");
const interactionsPath = join(process.cwd(), "src/studio/presets/motion-recorder-interactions.ts");
const statePath = join(process.cwd(), "src/studio/presets/motion-recorder-state.ts");

describe("MotionPresetRecorder source integration", () => {
  it("previews stamped playback through a persistent Pixi render payload", () => {
    const source = readFileSync(recorderPath, "utf8");
    const panelsSource = readFileSync(panelsPath, "utf8");
    const previewSource = readFileSync(previewPath, "utf8");
    const stateSource = readFileSync(statePath, "utf8");
    const recorderRenderSource = `${source}\n${previewSource}`;

    expect(previewSource).toContain("buildCharacterRenderPayload");
    expect(previewSource).toContain("const mediaAssets = useStudio((state) => state.mediaAssets)");
    expect(previewSource).toContain("mediaAssets,");
    expect(source).toContain("<RecorderPixiPreview");
    expect(previewSource).toContain("<PixiCharacterPreview");
    expect(previewSource).toContain("reuseScene");
    expect(previewSource).toContain("resolveAssetRef={resolveRecorderPreviewAssetRef}");
    expect(previewSource).toContain("getMediaUrl(asset.id)");
    expect(source).toContain("const [playbackTime, setPlaybackTime]");
    expect(source).toContain("const playbackPreviewPreset = useMemo");
    expect(source).toContain("commitRecorderPreviewToHtml");
    expect(source).toContain("setPlaybackTime(0)");
    // Playback is compiled from stamped keyframes only. The pose editor is an
    // editor-only React draft surface that stamps into the same keypose model.
    expect(source).toContain("preset={playbackPreviewPreset}");
    expect(previewSource).toContain("export function ReactPoseCanvas");
    expect(previewSource).toContain("function ReactPosePart");
    expect(previewSource).toContain("matrixToCss(frame.matrix)");
    expect(previewSource).toContain("useMediaUrl(part.mediaId)");
    expect(previewSource).toContain('maxWidth: "none"');
    expect(previewSource).toContain('maxHeight: "none"');
    expect(panelsSource).toContain("export function KeyposeStrip");
    expect(source).toContain("beforeunload");
    expect(source).toContain("Save without the unstamped pose edits?");
    // Playback seeking renders the stamped Pixi payload directly, but the pose
    // editor must not inject or mutate GSAP live while dragging.
    expect(recorderRenderSource).not.toContain("function seekRecorderPlaybackIframe");
    expect(recorderRenderSource).not.toContain("timeline.seek?.(Math.max(0, time), false)");
    expect(recorderRenderSource).not.toContain("buildCharacterGsapScript");
    expect(recorderRenderSource).not.toContain("function applyEditScriptToIframe");
    expect(recorderRenderSource).not.toContain("data-recorder-live-script");
    expect(recorderRenderSource).not.toContain("forceEditScript");
    expect(source).toContain("GeneratedEditorShell");
    expect(source).toContain("AiAddonPromptPanel");
    expect(source).toContain("useAiGeneratedArtifactAddon");
    expect(source).toContain("AiGeneratedFeatureAdapter");
    expect(source).toContain("buildMotionRequestPrompt");
    expect(source).toContain("buildRepairPrompt");
    // The playback pane must not rebuild a full HyperFrames iframe for recorder
    // playback; it keeps a Pixi app and renders explicit time seeks.
    expect(recorderRenderSource).not.toContain("<iframe");
    expect(recorderRenderSource).not.toContain("srcDoc");
    expect(recorderRenderSource).not.toContain('sandbox="allow-scripts allow-same-origin"');
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
    expect(previewSource).toContain("export function RecorderPixiPreview");
    expect(source).toContain("selectAdjacentKeypose");
    expect(recorderRenderSource).not.toContain("preset={draftPreviewPreset}");
    expect(recorderRenderSource).not.toContain("function RiggedPosePreview");
    expect(recorderRenderSource).not.toContain("applyRecorderEditPose");
    expect(recorderRenderSource).not.toContain("editTargets=");
    expect(recorderRenderSource).not.toContain("usesGeneratedMouth");
    expect(recorderRenderSource).not.toContain("generatedMouthPreviewPart");
    expect(recorderRenderSource).not.toContain("__generated-mouth-preview");
    expect(recorderRenderSource).not.toContain("Generated mouth");
    expect(recorderRenderSource).not.toContain("JSON.stringify(\n          buildMotionRequest");
  });

  it("clamps interactive edits through the shared motion-constraint boundary", () => {
    const source = readFileSync(recorderPath, "utf8");
    const panelsSource = readFileSync(panelsPath, "utf8");
    const geometrySource = readFileSync(geometryPath, "utf8");
    const stateSource = readFileSync(statePath, "utf8");

    // Every override edit (slider, rotate drag, plane drag) routes through resolveMotionDelta,
    // so the editor enforces the same reach/rotation limits as compiled playback.
    expect(source).toContain("buildCharacterRuntime(character)");
    expect(source).toContain("const constraintCtx = runtime.constraintContext");
    expect(geometrySource).toContain("resolveMotionDelta({");
    expect(geometrySource).toContain("resolveFkJointDelta({");
    expect(source).toContain("constrainRecorderOverrides({");
    expect(geometrySource).toContain("animatedBoneIdsForRecorderOverrides");
    expect(geometrySource).toContain("recorderMotionTargetForSlot");
    expect(geometrySource).toContain("const unclampedLayers = new Set(allowOutOfBounds);");
    expect(geometrySource).toContain("unclampedLayers,");
    // The escape hatch is carried from the loaded preset, saved back, and mirrored in preview.
    expect(source).toContain("initialPreset?.allowOutOfBounds ?? []");
    expect(source).toContain(
      "allowOutOfBounds: allowOutOfBounds.length ? [...allowOutOfBounds] : undefined",
    );
    expect(stateSource).toContain("allowOutOfBounds: allowOutOfBounds?.length");
    // The override panel surfaces the effective limit and the per-slot toggle.
    expect(source).toContain("effectiveReachForSlot");
    expect(panelsSource).toContain("Allow out of bounds");
  });

  it("lets the generated character composition own variant anchors", () => {
    const source = readFileSync(recorderPath, "utf8");
    const previewSource = readFileSync(previewPath, "utf8");
    const anchorSources = `${source}\n${previewSource}`;

    expect(anchorSources).not.toContain("applyRecorderBoneAnchors");
    expect(anchorSources).not.toContain("applyRecorderVariantPreview");
    expect(anchorSources).not.toContain("recorderBaseLeft");
    expect(anchorSources).not.toContain("recorderBaseTop");
    // The anchor debugger is dev-only editor chrome.
    expect(previewSource).toContain("export function AnchorDebugOverlay");
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
    const previewSource = readFileSync(previewPath, "utf8");
    const recorderRenderSource = `${source}\n${previewSource}`;

    expect(recorderRenderSource).not.toContain("const matchingPartEls = partEls.filter");
    expect(recorderRenderSource).not.toContain("recorderPartElementsForSlot");
    expect(recorderRenderSource).not.toContain("recorderSlotTransformOrigin");
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
    const previewSource = readFileSync(previewPath, "utf8");
    const geometrySource = readFileSync(geometryPath, "utf8");

    expect(source).toContain("resolveRuntimeSlotPart(slot, runtime, poseKey)");
    expect(geometrySource).toContain("export function recorderPartPlacement");
    expect(geometrySource).toContain("runtimePartPlacement(slot, part, runtime");
    expect(geometrySource).toContain("resolveRuntimePosePartFrame({");
    expect(geometrySource).toContain("resolveTransformForSlot:");
    expect(geometrySource).toContain("canvasDeltaToMotionDelta(");
    expect(geometrySource).toContain('{ target: "slot", boneId: target.boneId }');
    expect(source).toContain("defaultPoseForCharacter(character)");
    expect(previewSource).toContain("poses: basePoses");
  });

  it("keeps Flexible mesh authoring out of the action editor", () => {
    const source = readFileSync(recorderPath, "utf8");
    const panelsSource = readFileSync(panelsPath, "utf8");
    const previewSource = readFileSync(previewPath, "utf8");
    const stateSource = readFileSync(statePath, "utf8");
    const recorderFeatureSource = `${source}\n${previewSource}\n${stateSource}`;

    // The action editor may animate an already-flexible limb, but structural
    // mesh setup belongs to the character builder.
    expect(recorderFeatureSource).not.toContain("roleSupportsBend(selectedSlot.role)");
    expect(recorderFeatureSource).not.toContain("defaultFlexibleDeformForRecorderPart");
    expect(stateSource).toContain("export function recorderActionLimbPathForPart");
    expect(stateSource).toContain("const neutral = defaultLimbPathDeformForPart(part)");
    expect(stateSource).toContain("...deform");
    expect(stateSource).toContain("width: deform.width ?? neutral.width");
    expect(previewSource).toContain("const flexibleActionPath");
    expect(stateSource).toContain("export function constrainFlexibleCurvePatch");
    expect(recorderFeatureSource).not.toContain("registrationForPart(part)");
    expect(recorderFeatureSource).not.toContain('kind: "set-slot-deform"');
    expect(recorderFeatureSource).not.toContain("onCharacterChange(result.character)");
    expect(recorderFeatureSource).not.toContain("〰 Flexible");
    expect(recorderFeatureSource).not.toContain("checked={!!part?.deform}");
    expect(recorderFeatureSource).not.toContain("onSetFlexible");
    expect(panelsSource).toContain('label="Bend"');
    expect(panelsSource).toContain('label="Reach"');
    expect(panelsSource).toContain("flexibleActionControlState");
    expect(panelsSource).toContain("flexibleBendPatch");
    expect(panelsSource).toContain("flexibleReachPatch");
    expect(panelsSource).toContain("onReset={() => onChange({ pathCurveX: 0, pathCurveY: 0 })}");
    expect(panelsSource).toContain("onReset={() => onChange({ pathEndX: 0, pathEndY: 0 })}");
    expect(recorderFeatureSource).not.toContain("MAX_BEND_DEGREES");
    expect(source).toContain("pathEndX");
    expect(source).toContain("pathCurveX");
    expect(recorderFeatureSource).not.toContain("Mesh points");
    expect(recorderFeatureSource).not.toContain("Add lock");
    expect(recorderFeatureSource).not.toContain("Snap sockets");
    expect(recorderFeatureSource).not.toContain("snapSelectedMeshToSockets");
    expect(recorderFeatureSource).not.toContain("meshSetup");
    expect(recorderFeatureSource).not.toContain("startMeshSetupPointDrag");
    expect(recorderFeatureSource).not.toContain("locks: [...locks, nextLock]");
    expect(recorderFeatureSource).not.toContain("onDeformChange");
    expect(previewSource).toContain("startFlexiblePointDrag");
    expect(source).toContain("onFlexiblePointChange");
    expect(recorderFeatureSource).not.toContain("pinNameForChildSlot");
    expect(recorderFeatureSource).not.toContain("flexibleEndpointDragRef");
    expect(recorderFeatureSource).not.toContain("force: true");
    expect(recorderFeatureSource).not.toContain(
      "updateOverrides([{ slotId: selectedSlotId, patch }, ...followerUpdates])",
    );
    expect(previewSource).toContain("frame.inverseMatrix");
    expect(previewSource).toContain(
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
    const previewSource = readFileSync(previewPath, "utf8");
    const recorderRenderSource = `${source}\n${previewSource}`;

    expect(recorderRenderSource).not.toContain("RecorderSelectionBox");
    expect(recorderRenderSource).not.toContain("TransformMoveable");
    expect(source).toContain("handlePlanePointerDown");
    expect(source).toContain("slotsAtPoint(e.clientX, e.clientY)");
    expect(source).toContain(
      "const subjectId = resolveDragSubject(candidateIds, selectedSlotId) ?? selectedSlotId;",
    );
    expect(previewSource).toContain("startRotationDrag");
    expect(previewSource).toContain("onPointerDown={startRotationDrag}");
    expect(previewSource).toContain("<RotateCw");
  });

  it("keeps recorder state and panels behind focused sibling modules", () => {
    const source = readFileSync(recorderPath, "utf8");
    const panelsSource = readFileSync(panelsPath, "utf8");
    const previewSource = readFileSync(previewPath, "utf8");
    const geometrySource = readFileSync(geometryPath, "utf8");
    const interactionsSource = readFileSync(interactionsPath, "utf8");
    const stateSource = readFileSync(statePath, "utf8");

    expect(source).toContain('from "./MotionPresetRecorderPanels"');
    expect(source).toContain('from "./MotionPresetRecorderPreview"');
    expect(source).toContain('from "./motion-recorder-geometry"');
    expect(source).toContain('from "./motion-recorder-interactions"');
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
    expect(previewSource).toContain("export function RecorderPixiPreview");
    expect(geometrySource).toContain("export function constrainRecorderOverrides");
    expect(interactionsSource).toContain("export function useRafCoalescedCallback");
    expect(source).not.toContain("function KeyposeStrip");
    expect(source).not.toContain("function PropertiesPanel");
    expect(source).not.toContain("function RecorderPixiPreview");
    expect(source).not.toContain("function constrainRecorderOverrides");
    expect(source).not.toContain("function createRafCoalescedDispatcher");
    expect(source).not.toContain("function initialKeyposesForPreset");
    expect(source).not.toContain("function defaultOverride");
  });
});
