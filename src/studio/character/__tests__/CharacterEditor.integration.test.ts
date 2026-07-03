import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const editorPath = join(process.cwd(), "src/studio/character/CharacterEditor.tsx");

describe("CharacterEditor source integration", () => {
  it("works in Build / Rig / Pose phases with the legacy panels removed", () => {
    const source = readFileSync(editorPath, "utf8");

    // Phase scaffold: one switch drives panels, overlays, and the pose toolbar.
    expect(source).toContain('useState<"build" | "rig" | "pose">');
    expect(source).toContain("const switchPhase");
    expect(source).toContain('{editorPhase === "pose" && (');
    expect(source).toContain('{editorPhase === "build" && (');
    expect(source).toContain('{editorPhase === "rig" && (');

    // Removed legacy surfaces: AI rig paste panel, raw JSON export, prompt generator.
    expect(source).not.toContain("RigAssistant");
    expect(source).not.toContain("characterRigPrompt");
    expect(source).not.toContain("exportData");
    // Reset escape hatch survives, with a two-step confirm instead of a native dialog.
    expect(source).toContain("Reset skeleton to default");
    expect(source).toContain("function ConfirmButton");
    expect(source).not.toContain("window.confirm");
    expect(source).not.toContain("window.prompt");
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

  it("keeps the effortless layer wired", () => {
    const source = readFileSync(editorPath, "utf8");
    // Autosave honesty: Done button + live save indicator.
    expect(source).toContain('useState<"saved" | "saving">');
    expect(source).toContain("✓ Saved");
    // Hover identification, breadcrumbs, and thumbnails.
    expect(source).toContain("handleCanvasHover");
    expect(source).toContain("Select the whole layer group");
    expect(source).toContain("function VariantGridButton");
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

    expect(source).toContain("buildCharacterRenderPayload");
    expect(source).toContain("const mediaAssets = useStudio((state) => state.mediaAssets)");
    expect(source).toContain("mediaAssets,");
    expect(source).toContain("<PixiCharacterPreview");
    expect(source).toContain("resolveCharacterEditorPreviewAssetRef");
    expect(source).toContain("previewVariant(slotId, variantKeyForPart(part))");
    expect(source).toContain('data-character-editor-chrome="part-frame"');
    expect(source).toContain("applyCharacterSceneCommand");
    expect(source).not.toContain("pixiEditorPreviewActive");
    expect(source).not.toContain("pixiBacked=");
    expect(source).not.toContain("drawnByPixi");
    expect(source).toContain("error instanceof CharacterPinRigError");
    expect(source).toContain("renderBlockingRigIssues");
    expect(source).toContain("Render preview paused.");
    expect(source).toContain("renderBlockingRigFixForIssue");
    expect(source).toContain("Fix this pin");
    expect(source).toContain("armRenderBlockingRigFix");
    expect(source).toContain("Show rig tools");
    expect(source).toContain("CharacterPartMoveable");
    expect(source).toContain("RigBonesOverlay");
    expect(source).toContain("VariantAnchorOverlay");
  });

  it("consolidates the parts rail into one list with per-slot variant upload", () => {
    const source = readFileSync(editorPath, "utf8");

    // One rail: the layer list plus a single add-part menu; the legacy
    // structure/body-map/upload panels are gone.
    expect(source).toContain("function AddPartMenu");
    expect(source).toContain("listCharacterSlots(doc, { includeEmpty: true })");
    expect(source).toContain("withUpdatedCharacterSlot");
    expect(source).toContain("const armPartImport");
    expect(source).toContain("onAddVariant");
    expect(source).not.toContain("function BodyMapPanel");
    expect(source).not.toContain("function UploadSlots");
    expect(source).not.toContain("function StructureEditor");
    expect(source).not.toContain("roleEnabledByManifest");
  });

  it("uses authored bounds for editor art bounds and host clamping", () => {
    const source = readFileSync(editorPath, "utf8");

    expect(source).toContain("function unionEditorArtBounds");
    expect(source).toContain("localAuthoredBounds(p) ?? localAlphaBounds(p)");
    expect(source).toContain("localRectCanvasBounds(p, a)");
    expect(source).toContain("function unionHostClampBounds");
    expect(source).toContain("const subject = unionHostClampBounds(slotParts, constraint.mode)");
    expect(source).toContain("const host = unionHostClampBounds(hostParts, constraint.mode)");
  });

  it("uses the shared reach clamp for editor drag boundaries", () => {
    const source = readFileSync(editorPath, "utf8");

    expect(source).toContain("function clampSlotDragDelta");
    expect(source).toContain("const reachLimited = clampMotionDeltaToReach(reach, dx, dy, 0)");
    expect(source).toContain("return { dx: nextDx, dy: nextDy, clamped }");
  });

  it("supports both skeleton calibration and moving artwork with pin-driven joint drags", () => {
    const source = readFileSync(editorPath, "utf8");

    expect(source).toContain('useState<BoneDragMode>("calibrate")');
    expect(source).toContain('kind: "move-bone-rest"');
    expect(source).toContain("keepArtwork");
    expect(source).toContain("Calibrate");
    expect(source).toContain("Move art");
    expect(source).toContain("Drag bones onto the artwork while images stay pinned");
    expect(source).toContain("syncLiveCharacterPreset(latest)");
    expect(source).toContain('kind: "set-bone-rest-transform"');
    expect(source).not.toContain("const shouldMoveArt = false");
    expect(source).not.toContain("Bones drive the skeleton only; artwork stays put");
    expect(source).not.toContain("applyLiveBoneTransform");
    expect(source).not.toContain("applyLiveSlotBinding");
  });

  it("keeps rig captions quiet and derives upload occupancy from semantic slots", () => {
    const source = readFileSync(editorPath, "utf8");

    expect(source).toContain("group-hover:opacity-100");
    expect(source).toContain("setShowAnchors(false)");
    expect(source).toContain("showAnchors && !focusEditing");
    expect(source).toContain("matchesSlotDefinition(part, def)");
    expect(source).toContain("defaultSlotIdForDefinition(def)");
    expect(source).toContain("defaultSlotIdForRole(role, undefined, side)");
    expect(source).toContain("semanticSlotChanged");
    expect(source).toContain("slotLabelForRoleSide(nextRole, nextSide)");
    expect(source).toContain('aria-label="Artwork assigned"');
  });

  it("offers a full-frame fit action for the active angle", () => {
    const source = readFileSync(editorPath, "utf8");

    expect(source).toContain("fitActiveAngleToCanvas");
    expect(source).toContain("fitPartsToCanvasFrame");
    expect(source).toContain("unionFrameBounds(scopedParts)");
    expect(source).toContain("Fit active angle to canvas");
  });
});
