import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const editorPath = join(process.cwd(), "src/studio/character/CharacterEditor.tsx");
const artworkImportPath = join(process.cwd(), "src/studio/character/CharacterArtworkImport.tsx");
const layerListPath = join(process.cwd(), "src/studio/character/CharacterLayerList.tsx");
const variantControlsPath = join(
  process.cwd(),
  "src/studio/character/CharacterVariantControls.tsx",
);
const inspectorFieldsPath = join(
  process.cwd(),
  "src/studio/character/CharacterInspectorFields.tsx",
);
const rigSetupPath = join(process.cwd(), "src/studio/character/CharacterRigSetupControls.tsx");
const inspectorPanelsPath = join(
  process.cwd(),
  "src/studio/character/CharacterInspectorPanels.tsx",
);
const partInspectorPath = join(process.cwd(), "src/studio/character/CharacterPartInspector.tsx");
const groupInspectorPath = join(process.cwd(), "src/studio/character/CharacterGroupInspector.tsx");
const movementInspectorPath = join(
  process.cwd(),
  "src/studio/character/CharacterMovementInspector.tsx",
);
const flexibleSectionPath = join(
  process.cwd(),
  "src/studio/character/CharacterFlexibleSection.tsx",
);
const overlaysPath = join(process.cwd(), "src/studio/character/CharacterEditorOverlays.tsx");
const canvasChromePath = join(
  process.cwd(),
  "src/studio/character/CharacterEditorCanvasChrome.tsx",
);
const toolbarPath = join(process.cwd(), "src/studio/character/CharacterEditorToolbar.tsx");
const editorPreviewPath = join(process.cwd(), "src/studio/character/character-editor-preview.ts");
const previewControllerPath = join(
  process.cwd(),
  "src/studio/character/use-character-preview-controller.ts",
);
const documentControllerPath = join(
  process.cwd(),
  "src/studio/character/use-character-document.ts",
);
const artworkAnalysisPath = join(
  process.cwd(),
  "src/studio/character/use-character-artwork-analysis.ts",
);
const editorGeometryPath = join(process.cwd(), "src/studio/character/character-editor-geometry.ts");
const editorInteractionsPath = join(
  process.cwd(),
  "src/studio/character/character-editor-interactions.ts",
);
const pointerDragPath = join(process.cwd(), "src/studio/interaction/pointer-drag.ts");
const partImportPath = join(process.cwd(), "src/studio/character/character-part-import.ts");

describe("CharacterEditor source integration", () => {
  it("works in Build / Rig / Pose phases with the legacy panels removed", () => {
    const source = readFileSync(editorPath, "utf8");
    const rigSetupSource = readFileSync(rigSetupPath, "utf8");
    const toolbarSource = readFileSync(toolbarPath, "utf8");

    // Phase scaffold: one switch drives panels, overlays, and the pose toolbar.
    expect(source).toContain('useState<"build" | "rig" | "pose">');
    expect(source).toContain("const switchPhase");
    expect(toolbarSource).toContain('{phase === "pose" && (');
    expect(source).toContain('{editorPhase === "build" && (');
    expect(source).toContain('{editorPhase === "rig" && (');

    // Removed legacy surfaces: AI rig paste panel, raw JSON export, prompt generator.
    expect(source).not.toContain("RigAssistant");
    expect(source).not.toContain("characterRigPrompt");
    expect(source).not.toContain("exportData");
    // Reset escape hatch survives, with a two-step confirm instead of a native dialog.
    expect(rigSetupSource).toContain("Reset skeleton to default");
    expect(rigSetupSource).toContain("function ConfirmButton");
    expect(source).not.toContain("window.confirm");
    expect(source).not.toContain("window.prompt");
  });

  it("keeps canvas and skeleton setup behind shared inspector fields", () => {
    const source = readFileSync(editorPath, "utf8");
    const inspectorFieldsSource = readFileSync(inspectorFieldsPath, "utf8");
    const rigSetupSource = readFileSync(rigSetupPath, "utf8");

    expect(source).toContain('from "./CharacterRigSetupControls"');
    expect(source).toContain("<CanvasSection");
    expect(source).toContain("<SkeletonCard");
    expect(inspectorFieldsSource).toContain("export function Field");
    expect(inspectorFieldsSource).toContain("export function NumberField");
    expect(rigSetupSource).toContain('from "./CharacterInspectorFields"');
    expect(rigSetupSource).toContain("export function CanvasSection");
    expect(rigSetupSource).toContain("export function SkeletonCard");
    expect(rigSetupSource).toContain('{ label: "Portrait", width: 600, height: 900 }');
    expect(rigSetupSource).toContain('{ label: "Square", width: 1000, height: 1000 }');
    expect(source).not.toContain("function CanvasSection");
    expect(source).not.toContain("function SkeletonCard");
    expect(source).not.toContain("function NumberField");
  });

  it("keeps header and angle/pose presentation behind a callback-only boundary", () => {
    const source = readFileSync(editorPath, "utf8");
    const toolbarSource = readFileSync(toolbarPath, "utf8");
    const documentControllerSource = readFileSync(documentControllerPath, "utf8");

    expect(source).toContain('from "./CharacterEditorToolbar"');
    expect(source).toContain('from "./use-character-document"');
    expect(source).toContain("<CharacterEditorHeader");
    expect(source).toContain("<CharacterAnglePoseToolbar");
    expect(source).toContain("void saveNow().then");
    expect(documentControllerSource).toContain("export function useCharacterDocument");
    expect(documentControllerSource).toContain("saveCharacter(doc).then");
    expect(documentControllerSource).toContain("const undoCharacterHistory = useCallback");
    expect(documentControllerSource).toContain("const redoCharacterHistory = useCallback");
    expect(toolbarSource).toContain("export function CharacterEditorHeader");
    expect(toolbarSource).toContain("export function CharacterAnglePoseToolbar");
    expect(toolbarSource).toContain("onDone: () => void");
    expect(toolbarSource).not.toContain("useStudio");
    expect(toolbarSource).not.toContain("saveCharacter");
    expect(toolbarSource).not.toContain("../db");
  });

  it("explains every armed mode through the single ModeBanner", () => {
    const source = readFileSync(editorPath, "utf8");
    expect(source).toContain("const modeBanner");
    // All four armed modes feed the banner.
    expect(source).toContain("if (anchorDrag)");
    expect(source).toContain("if (pinPlacement)");
    expect(source).toContain("if (rangeEdit)");
    expect(source).toContain('if (mode === "pivot")');
    // Esc backs out; toasts auto-dismiss; destructive toasts offer Undo.
    expect(source).toContain('e.key === "Escape"');
    expect(source).toContain("setStatusUndoable");
    expect(source).toContain("undoCharacterHistory();");
  });

  it("hides the selection boxes while a one-shot tool is armed so its click reaches the canvas", () => {
    const source = readFileSync(editorPath, "utf8");
    // The part transform box and the group box both overlay the selected art and
    // would swallow the pivot / bounds placement click; they render only in
    // select mode so `handleCanvasPointerDown` can position the tool.
    expect(source).toContain(
      'selectedEditorPart && !focusEditing && !meshPathEditing && mode === "select" && (',
    );
    // The group box is gated on select mode between its selectedSlotBounds test and render.
    expect(source).toMatch(
      /selectedSlotBounds &&[\s\S]{0,520}?mode === "select" &&[\s\S]{0,120}?GroupControlsOverlay/,
    );
    // Bone / anchor handles are also descendants of the canvas; the capture handler gives armed
    // one-shot tools first claim on the click before those handles can stop propagation.
    expect(source).toContain("const handleCanvasPointerDownCapture");
    expect(source).toContain("onPointerDownCapture={handleCanvasPointerDownCapture}");
    expect(source).toContain('{showBones && !focusEditing && mode === "select" && (');
    expect(source).toContain('{showAnchors && !focusEditing && mode === "select" && (');
    // And the armed-tool click path actually places the pivot / bounds.
    expect(source).toContain('if (mode === "pivot") setPivotForParts(ids, point);');
  });

  it("keeps the effortless layer wired", () => {
    const source = readFileSync(editorPath, "utf8");
    const partInspectorSource = readFileSync(partInspectorPath, "utf8");
    const groupInspectorSource = readFileSync(groupInspectorPath, "utf8");
    const variantControlsSource = readFileSync(variantControlsPath, "utf8");
    const toolbarSource = readFileSync(toolbarPath, "utf8");
    const documentControllerSource = readFileSync(documentControllerPath, "utf8");
    // Autosave honesty: Done button + live save indicator.
    expect(documentControllerSource).toContain('useState<"saved" | "saving">');
    expect(source).toContain("saveState={saveState}");
    expect(toolbarSource).toContain("✓ Saved");
    // Hover identification, breadcrumbs, and thumbnails.
    expect(source).toContain("handleCanvasHover");
    expect(partInspectorSource).toContain("Select the whole layer group");
    expect(groupInspectorSource).toContain('from "./CharacterVariantControls"');
    expect(groupInspectorSource).toContain("<VariantGridButton");
    expect(variantControlsSource).toContain("export function VariantGridButton");
  });

  it("keeps variant diagnostics and pin controls behind one presentation boundary", () => {
    const source = readFileSync(editorPath, "utf8");
    const inspectorSources =
      readFileSync(partInspectorPath, "utf8") + readFileSync(groupInspectorPath, "utf8");
    const variantControlsSource = readFileSync(variantControlsPath, "utf8");
    const overlaysSource = readFileSync(overlaysPath, "utf8");

    expect(source).toContain("<RigHealthPanel");
    expect(inspectorSources).toContain("<VariantKeyChip");
    expect(inspectorSources).toContain("<VariantAnchorSection");
    expect(overlaysSource).toContain("ANCHOR_SOURCE_COLORS[source]");
    expect(variantControlsSource).toContain("export function RigHealthPanel");
    expect(variantControlsSource).toContain("export function VariantKeyChip");
    expect(variantControlsSource).toContain("export function VariantAnchorSection");
    expect(variantControlsSource).toContain("export const ANCHOR_SOURCE_COLORS");
    expect(source).not.toContain("function RigHealthPanel");
    expect(source).not.toContain("function VariantKeyChip");
    expect(source).not.toContain("function VariantAnchorSection");
  });

  it("keeps part, group, and movement inspectors behind one callback-only boundary", () => {
    const source = readFileSync(editorPath, "utf8");
    const inspectorPanelsSource = readFileSync(inspectorPanelsPath, "utf8");
    const partInspectorSource = readFileSync(partInspectorPath, "utf8");
    const groupInspectorSource = readFileSync(groupInspectorPath, "utf8");
    const movementInspectorSource = readFileSync(movementInspectorPath, "utf8");

    expect(source).toContain('from "./CharacterInspectorPanels"');
    expect(source).toContain("<Inspector");
    expect(source).toContain("<GroupInspector");
    expect(source).toContain("<RestrictMovementPanel");
    expect(inspectorPanelsSource).toContain('export { Inspector } from "./CharacterPartInspector"');
    expect(inspectorPanelsSource).toContain(
      'export { GroupInspector } from "./CharacterGroupInspector"',
    );
    expect(inspectorPanelsSource).toContain(
      'export { RestrictMovementPanel } from "./CharacterMovementInspector"',
    );
    expect(partInspectorSource).toContain("export function Inspector");
    expect(groupInspectorSource).toContain("export function GroupInspector");
    expect(movementInspectorSource).toContain("export function RestrictMovementPanel");
    expect(source).not.toContain("function Inspector");
    expect(source).not.toContain("function GroupInspector");
    expect(source).not.toContain("function RestrictMovementPanel");
  });

  it("keeps canvas variant visibility scoped to the active angle", () => {
    const source = readFileSync(editorPath, "utf8");

    expect(source).toContain("const editorAngleParts = orderedParts.filter");
    expect(source).toContain("partAvailableForAngle(part, editorActiveAngle)");
    expect(source).toContain("allParts={editorAngleParts}");
    expect(source).not.toContain("allParts={doc.parts}");
  });

  it("uses Pixi as the editor artwork renderer while React owns chrome only", () => {
    const source = readFileSync(editorPath, "utf8");
    const canvasChromeSource = readFileSync(canvasChromePath, "utf8");
    const editorPreviewSource = readFileSync(editorPreviewPath, "utf8");
    const previewControllerSource = readFileSync(previewControllerPath, "utf8");
    const renderSources = `${source}\n${canvasChromeSource}\n${editorPreviewSource}`;

    expect(source).toContain("buildCharacterRenderPayload");
    expect(source).toContain('from "./use-character-preview-controller"');
    expect(source).toContain("useCharacterPreviewController");
    expect(source).toContain("const mediaAssets = useStudio((state) => state.mediaAssets)");
    expect(source).toContain("mediaAssets,");
    expect(source).toContain("<PixiCharacterPreview");
    expect(source).toContain("resolveCharacterEditorPreviewAssetRef");
    expect(source).toContain("previewVariant(slotId, variantKeyForPart(part))");
    expect(canvasChromeSource).toContain('data-character-editor-chrome="part-frame"');
    expect(source).toContain("applyCharacterSceneCommand");
    expect(renderSources).not.toContain("pixiEditorPreviewActive");
    expect(renderSources).not.toContain("pixiBacked=");
    expect(renderSources).not.toContain("drawnByPixi");
    expect(source).toContain("error instanceof CharacterPinRigError");
    expect(source).toContain("renderBlockingRigIssues");
    expect(source).toContain("Render preview paused.");
    expect(source).toContain("renderBlockingRigFixForIssue");
    expect(source).toContain("Fix this pin");
    expect(source).toContain("armRenderBlockingRigFix");
    expect(source).toContain("Show rig tools");
    expect(source).toContain("CharacterPartMoveable");
    expect(previewControllerSource).toContain("abort.signal.aborted");
    expect(previewControllerSource).toContain("stopAudioResources(false)");
    expect(previewControllerSource).toContain("cancelAnimationFrame(audio.raf)");
    expect(source).not.toContain("new AudioContext()");
    expect(canvasChromeSource).toContain("export function CharacterPartMoveable");
    expect(source).toContain("RigBonesOverlay");
    expect(source).toContain("VariantAnchorOverlay");
  });

  it("consolidates the parts rail into one list with per-slot variant upload", () => {
    const source = readFileSync(editorPath, "utf8");
    const artworkImportSource = readFileSync(artworkImportPath, "utf8");
    const layerListSource = readFileSync(layerListPath, "utf8");

    // One rail: the layer list plus a single add-part menu; the legacy
    // structure/body-map/upload panels are gone.
    expect(source).toContain("<AddPartMenu");
    expect(source).toContain('from "./CharacterArtworkImport"');
    expect(source).toContain("<CharacterLayerList");
    expect(source).toContain('from "./CharacterLayerList"');
    expect(artworkImportSource).toContain("export function AddPartMenu");
    expect(artworkImportSource).toContain("listCharacterSlots(doc, { includeEmpty: true })");
    expect(artworkImportSource).toContain("export function SlotUpload");
    expect(artworkImportSource).toContain("<MouthPresetSelector");
    expect(layerListSource).toContain("export function CharacterLayerList");
    expect(layerListSource).toContain("listCharacterSlots({ parts, slots }");
    expect(layerListSource).toContain("parentSlotIdForEditorRelation");
    expect(layerListSource).toContain("orderCharacterVariants(group.slotParts)");
    expect(source).toContain("withUpdatedCharacterSlot");
    expect(source).toContain("const armPartImport");
    expect(source).toContain("onAddVariant");
    expect(source).toContain("pivot: smartPlacement.pivot");
    expect(source).not.toContain("function LayerList");
    expect(source).not.toContain("function LayerPartRow");
    expect(source).not.toContain("function EyePresetSelector");
    expect(source).not.toContain("function BodyMapPanel");
    expect(source).not.toContain("function UploadSlots");
    expect(source).not.toContain("function StructureEditor");
    expect(source).not.toContain("roleEnabledByManifest");
  });

  it("offers a slot-level Flexible limb-path control reachable from both inspectors", () => {
    const source = readFileSync(editorPath, "utf8");
    const flexibleSectionSource = readFileSync(flexibleSectionPath, "utf8");
    const overlaysSource = readFileSync(overlaysPath, "utf8");
    const inspectorSources =
      readFileSync(partInspectorPath, "utf8") + readFileSync(groupInspectorPath, "utf8");

    // Flexible is slot-level (every variant gets the same deform model), face
    // roles are excluded, and new saves use the point-based limb path model
    // instead of the retired bend slider experiment.
    expect(source).toContain("const setSlotDeform");
    expect(source).toContain('kind: "set-slot-deform"');
    expect(source).not.toContain("getPartSlotId(part) === slotId ? { ...part, deform } : part");
    expect(flexibleSectionSource).toContain("defaultLimbPathDeformForPart");
    expect(flexibleSectionSource).toContain("defaultLimbPathDeformForSlot");
    expect(flexibleSectionSource).toContain("Reset to artwork");
    expect(flexibleSectionSource).toContain("Fit mesh to rig");
    expect(flexibleSectionSource).toContain("const neutralDeform");
    expect(flexibleSectionSource).toContain("const fittedDeform");
    expect(source).toContain("const selectedDeformPathPart");
    expect(overlaysSource).toContain("export function DeformPathOverlay");
    expect(overlaysSource).toContain("function deformPathSamples");
    expect(flexibleSectionSource).toContain(
      "onSetDeform(e.target.checked ? neutralDeform() : undefined)",
    );
    expect(flexibleSectionSource).toContain("onClick={() => onSetDeform(neutralDeform())}");
    expect(flexibleSectionSource).toContain("onClick={() => onSetDeform(fittedDeform())}");
    expect(source).not.toContain("function FlexiblePathOverlay");
    expect(source).not.toContain("startFlexiblePathDrag");
    expect(source).not.toContain("onDeformEditStart");
    expect(source).not.toContain("span>Curve</span>");
    expect(source).not.toContain("MAX_BEND_DEGREES");
    expect(flexibleSectionSource).toContain("const faceRole");

    // The control is one shared component rendered by BOTH the part Inspector
    // (single-image limbs) and the GroupInspector (multi-variant slots) — a
    // plain one-image arm must be able to reach it, not just multi-variant
    // slots. Two render sites.
    expect(flexibleSectionSource).toContain("export function FlexibleSection");
    expect(inspectorSources.match(/<FlexibleSection/g)?.length).toBe(2);
  });

  it("uses authored bounds for editor art bounds and host clamping", () => {
    const geometrySource = readFileSync(editorGeometryPath, "utf8");

    expect(geometrySource).toContain("function unionEditorArtBounds");
    expect(geometrySource).toContain("localAuthoredBounds(p) ?? localAlphaBounds(p)");
    expect(geometrySource).toContain("localRectCanvasBounds(p, a)");
    expect(geometrySource).toContain("function unionHostClampBounds");
    expect(geometrySource).toContain(
      "const subject = unionHostClampBounds(slotParts, constraint.mode)",
    );
    expect(geometrySource).toContain(
      "const host = unionHostClampBounds(hostParts, constraint.mode)",
    );
  });

  it("uses the shared reach clamp for editor drag boundaries", () => {
    const geometrySource = readFileSync(editorGeometryPath, "utf8");

    expect(geometrySource).toContain("function clampSlotDragDelta");
    expect(geometrySource).toContain(
      "const reachLimited = clampMotionDeltaToReach(reach, dx, dy, 0)",
    );
    expect(geometrySource).toContain("return { dx: nextDx, dy: nextDy, clamped }");
  });

  it("keeps editor chrome and its transform geometry behind focused boundaries", () => {
    const source = readFileSync(editorPath, "utf8");
    const overlaysSource = readFileSync(overlaysPath, "utf8");
    const canvasChromeSource = readFileSync(canvasChromePath, "utf8");
    const geometrySource = readFileSync(editorGeometryPath, "utf8");
    const interactionsSource = readFileSync(editorInteractionsPath, "utf8");
    const pointerDragSource = readFileSync(pointerDragPath, "utf8");
    const artworkAnalysisSource = readFileSync(artworkAnalysisPath, "utf8");
    const previewSource = readFileSync(editorPreviewPath, "utf8");

    expect(source).toContain('from "./CharacterEditorOverlays"');
    expect(source).toContain('from "./CharacterEditorCanvasChrome"');
    expect(source).toContain('from "./CharacterEditorToolbar"');
    expect(source).toContain('from "./character-editor-geometry"');
    expect(source).toContain('from "./character-editor-interactions"');
    expect(source).toContain('from "../interaction/pointer-drag"');
    expect(source).toContain('from "./use-character-artwork-analysis"');
    expect(overlaysSource).toContain("export function ReachOverlay");
    expect(overlaysSource).toContain("export function DeformPathOverlay");
    expect(overlaysSource).toContain("export function RotationReachOverlay");
    expect(overlaysSource).toContain("export function VariantAnchorOverlay");
    expect(overlaysSource).toContain("export function RigBonesOverlay");
    expect(overlaysSource).toContain("export function GroupControlsOverlay");
    expect(geometrySource).toContain("export function convexHull");
    expect(geometrySource).toContain("export function composeEditorPartTransform");
    expect(geometrySource).toContain("export function normalizePartPatch");
    expect(interactionsSource).toContain("export function hitTestCharacterEditorParts");
    expect(interactionsSource).toContain("export function scaleCharacterPartsFromSnapshot");
    expect(interactionsSource).toContain("export function rotateCharacterPartsFromSnapshot");
    expect(artworkAnalysisSource).toContain("export function useCharacterArtworkAnalysis");
    expect(artworkAnalysisSource).toContain("measureAlphaBoundsFromBlob");
    expect(artworkAnalysisSource).toContain("createAlphaHitMaskFromBlob");
    expect(pointerDragSource).toContain('window.addEventListener("pointercancel", cancel)');
    expect(pointerDragSource).toContain('window.addEventListener("blur", blur)');
    expect(source.match(/startWindowPointerDrag/g)?.length).toBeGreaterThanOrEqual(9);
    expect(source).not.toContain('window.addEventListener("pointermove"');
    expect(canvasChromeSource).toContain("export function PartLayer");
    expect(canvasChromeSource).toContain("export function CharacterPartMoveable");
    expect(previewSource).toContain("export function previewDelta");
    expect(previewSource).toContain("export function activePreviewVariantForPart");
    expect(source).not.toContain("function ReachOverlay");
    expect(source).not.toContain("function DeformPathOverlay");
    expect(source).not.toContain("function RotationReachOverlay");
    expect(source).not.toContain("function VariantAnchorOverlay");
    expect(source).not.toContain("function RigBonesOverlay");
    expect(source).not.toContain("function GroupControlsOverlay");
    expect(source).not.toContain("function PartLayer");
    expect(source).not.toContain("function CharacterPartMoveable");
    expect(source).not.toContain("function previewDelta");
  });

  it("supports both skeleton calibration and moving artwork with pin-driven joint drags", () => {
    const source = readFileSync(editorPath, "utf8");
    const rigSetupSource = readFileSync(rigSetupPath, "utf8");

    expect(source).toContain('useState<BoneDragMode>("calibrate")');
    expect(source).toContain('kind: "move-bone-rest"');
    expect(source).toContain("keepArtwork");
    expect(source).toContain("Calibrate");
    expect(source).toContain("Move art");
    expect(source).toContain("Drag bones onto the artwork while images stay pinned");
    expect(source).toContain("syncLiveCharacterPreset(latest)");
    expect(rigSetupSource).toContain('kind: "set-bone-rest-transform"');
    expect(source).not.toContain("const shouldMoveArt = false");
    expect(source).not.toContain("Bones drive the skeleton only; artwork stays put");
    expect(source).not.toContain("applyLiveBoneTransform");
    expect(source).not.toContain("applyLiveSlotBinding");
  });

  it("keeps rig captions quiet and derives upload occupancy from semantic slots", () => {
    const source = readFileSync(editorPath, "utf8");
    const overlaysSource = readFileSync(overlaysPath, "utf8");
    const artworkImportSource = readFileSync(artworkImportPath, "utf8");
    const partImportSource = readFileSync(partImportPath, "utf8");

    expect(overlaysSource).toContain("group-hover:opacity-100");
    expect(source).toContain("setShowAnchors(false)");
    expect(source).toContain("showAnchors && !focusEditing");
    expect(artworkImportSource).toContain("matchesSlotDefinition(part, definition)");
    expect(artworkImportSource).toContain("defaultSlotIdForRole(definition.role");
    expect(partImportSource).toContain("defaultSlotIdForRole(role, undefined, side)");
    expect(source).toContain("semanticSlotChanged");
    expect(source).toContain("slotLabelForRoleSide(nextRole, nextSide)");
    expect(artworkImportSource).toContain('aria-label="Artwork assigned"');
  });

  it("offers a full-frame fit action for the active angle", () => {
    const source = readFileSync(editorPath, "utf8");
    const rigSetupSource = readFileSync(rigSetupPath, "utf8");
    const geometrySource = readFileSync(editorGeometryPath, "utf8");

    expect(source).toContain("fitActiveAngleToCanvas");
    expect(source).toContain("fitPartsToCanvasFrame");
    expect(geometrySource).toContain("unionFrameBounds(scopedParts)");
    expect(rigSetupSource).toContain("Fit active angle to canvas");
  });
});
