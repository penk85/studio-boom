import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const stagePath = join(process.cwd(), "src/studio/components/Stage.tsx");
const overlaysPath = join(process.cwd(), "src/studio/components/StageOverlays.tsx");
const interactionsPath = join(process.cwd(), "src/studio/components/stage-interactions.ts");
const motionPathsPath = join(process.cwd(), "src/studio/components/stage-motion-paths.ts");
const previewPath = join(process.cwd(), "src/studio/hyperframes/preview.ts");
const renderPluginPath = join(process.cwd(), "src/studio/hyperframes/render-plugin.ts");

describe("Stage HyperFrames Studio integration", () => {
  it("uses srcdoc and resolves the inner iframe for @hyperframes/studio hooks", () => {
    const source = readFileSync(stagePath, "utf8");

    expect(source).toContain('from "@hyperframes/studio"');
    expect(source).toContain("resolveIframe");
    expect(source).toContain("useElementPicker");
    expect(source).toContain("resolveIframe(playerRef.current)");
    expect(source).toContain("<hyperframes-player");
    expect(source).toContain("srcdoc={resolvedHtml}");
    expect(source).toContain("preventPlayerClickToggle");
    expect(source).toContain('player.addEventListener("click", preventPlayerClickToggle');
    expect(source).not.toContain("directUrl=");
  });

  it("keeps stage interaction attached to the real player while drawing editor-only chrome", () => {
    const source = readFileSync(stagePath, "utf8");
    const overlaysSource = readFileSync(overlaysPath, "utf8");
    const interactionsSource = readFileSync(interactionsPath, "utf8");

    // Base transform edits (move/resize/rotate) route through the ONE stage-edit pipeline —
    // no scattered player-editing calls, no direct updateClip for base transforms.
    expect(source).toContain('from "../hyperframes/stage-edit"');
    expect(source).toContain("liveApplyStagePatch(");
    expect(source).toContain(
      "applyStageEdit(currentDrag.clipId, { x: nextX, y: nextY }, { persist: false })",
    );
    expect(source).toContain(
      "applyStageEdit(currentDrag.clipId, { rotation: finalRotation }, { persist: true })",
    );
    expect(source).toContain(
      "applyStageEdit(currentClip.id, { x: nextX, y: nextY }, { persist: true, history: false })",
    );
    expect(source).not.toContain("previewElementPosition(iframeRef.current");
    expect(source).not.toContain("commitElementPosition(iframeRef.current");
    expect(source).not.toContain("commitElementRect(iframeRef.current");
    expect(source).not.toContain("commitElementRotation(iframeRef.current");
    // Keyframe edits still persist through updateClipKeyframe (they need a real reload).
    expect(source).toContain("updateClipKeyframe(");
    expect(source).toContain("getStageKeyframeTarget(");
    expect(source).toContain("getSelectedMotionEndpoint(");
    expect(source).toContain("scaleForKeyframedResize(");
    expect(source).toContain("keyboardNudgeDelta(");
    expect(source).toContain("nudgeCheckpointedRef");
    expect(source).toContain('window.addEventListener("keydown", handleKeyDown, true)');
    expect(source).toContain("event.stopImmediatePropagation()");
    expect(source).toContain("isStageNudgeEventTarget(event.target)");
    expect(source).toContain('data-stage-selection-overlay=""');
    expect(source).toContain("const { pickedElement, enablePick, isPickMode } = useElementPicker");
    expect(source).toContain("if (!resolvedHtml || drag || isPickMode) return;");
    expect(source).toContain('doc.addEventListener("click", handleClick, true)');
    expect(source).toContain("resolveTargetClipId(");
    expect(source).toContain("<StageClickOverlay");
    expect(overlaysSource).toContain('data-stage-click-target=""');
    // Figma-style select/drag: the overlay rects are pure hit targets and the controller
    // reads the full z-stack under the pointer to drill, prefer the selection, and lock.
    expect(overlaysSource).toContain("data-clip-id={clip.id}");
    expect(source).toContain("useSelectDrag(");
    expect(source).toContain("hitTestClipIdsAtPoint(");
    expect(source).toContain("onCanvasPointerDown={onCanvasPointerDown}");
    expect(source).toContain("renderedClickRects");
    expect(source).toContain("getRenderedElementRect(iframe, clip.id)");
    expect(source).toContain("getRenderedPixelCompositionRect(");
    expect(source).toContain("compositionDomRectToCss(renderedElementRect, stageGeometry)");
    expect(source).toContain("<MotionPathOverlay");
    expect(source).toContain("paths={motionPaths}");
    expect(source).toContain("onCheckpointPointerDown=");
    expect(source).toContain("onPathPointerDown=");
    expect(overlaysSource).toContain('data-stage-motion-path=""');
    expect(source).toContain("getStageMotionPaths(");
    expect(overlaysSource).toContain('data-stage-motion-checkpoint=""');
    expect(overlaysSource).toContain('data-stage-motion-line-hit=""');
    expect(source).toContain('data-stage-move-handle=""');
    expect(interactionsSource).toContain("resizeCompositionRect({");
    expect(interactionsSource).toContain("scaleCompositionRectFromHandleRect(");
    expect(source).toContain("roundCompositionRect(previewClip)");
    expect(source).toContain("width: finalClip.width");
    expect(source).toContain("height: finalClip.height");
    expect(source).toContain("<SelectionCorner");
    expect(source).toContain('data-stage-rotate-handle=""');
    expect(source).toContain("getRotationPreview(");
    expect(interactionsSource).toContain("snapRotationDegrees(");
    expect(source).toContain("transform: `rotate(${previewRotation}deg)`");
    expect(source).toContain("compositionDeltaToLocal(");
    expect(source).toContain("getLayerShortcut(event)");
    expect(source).toContain("bringClipForward(currentClip.id)");
    expect(source).toContain("sendClipBackward(currentClip.id)");
    // Rubber-band (marquee) selection reuses the one select/drag controller's empty-space drag
    // branch and commits through selectClips — no second pointer/drag owner, no selecto.
    expect(source).toContain("beginMarquee:");
    expect(source).toContain("marqueeHitIds(box, targets)");
    expect(source).toContain('data-stage-marquee=""');
    expect(source).not.toContain('from "react-selecto"');
    expect(source).not.toContain('from "selecto"');
    // The Stage owns its own stacking context (`isolate`) so its chrome — react-moveable's
    // z-3000 control box in particular — stays contained and can't punch through a full-screen
    // modal. Containment, not a per-render stand-down flag.
    expect(source).toContain("isolate");
    expect(source).not.toContain("modalOpen");
    // Snapping reuses the SAME buildMoveSnapTargets + snapCompositionRect as the legacy handle
    // drag, wired into the moveable single + group paths through one shared guide overlay.
    expect(source).toContain("buildMoveSnapTargets");
    expect(source).toContain("snapCompositionRect(");
    expect(source).toContain("snapMove={(rect) => snapClipMove(stageEditableClip.id, rect)}");
    expect(source).toContain("snapGroupMove={snapGroupMove}");
    expect(source).toContain("onSnapGuidesChange={setMoveableSnapGuides}");
    expect(source).toContain('drag?.type === "move" ? drag.snapGuides : moveableSnapGuides');
  });

  it("keeps extracted Stage concerns behind focused sibling modules", () => {
    const source = readFileSync(stagePath, "utf8");
    const overlaysSource = readFileSync(overlaysPath, "utf8");
    const interactionsSource = readFileSync(interactionsPath, "utf8");
    const motionPathsSource = readFileSync(motionPathsPath, "utf8");

    expect(source).toContain('from "./StageOverlays"');
    expect(source).toContain('from "./stage-interactions"');
    expect(source).toContain('from "./stage-motion-paths"');
    expect(overlaysSource).toContain("export function MotionPathOverlay");
    expect(overlaysSource).toContain("export function StageClickOverlay");
    expect(overlaysSource).toContain("export function StageSnapGuideOverlay");
    expect(overlaysSource).toContain("export function SelectionCorner");
    expect(interactionsSource).toContain("export function getMovePreview");
    expect(interactionsSource).toContain("export function buildMoveSnapTargets");
    expect(interactionsSource).toContain("export function getLayerShortcut");
    expect(motionPathsSource).toContain("export function getStageMotionPaths");
    expect(motionPathsSource).toContain("export function motionPathData");
    expect(source).not.toContain("function MotionPathOverlay");
    expect(source).not.toContain("function getMovePreview");
    expect(source).not.toContain("function getStageMotionPaths");
  });

  it("stages srcdoc previews through the same HyperFrames project-file bundling contract", () => {
    const source = readFileSync(stagePath, "utf8");
    const previewSource = readFileSync(previewPath, "utf8");
    const pluginSource = readFileSync(renderPluginPath, "utf8");

    expect(source).toContain("resolvePreviewHtml(current)");
    expect(source).toContain("const projectHf = rootProject?.hf");
    expect(source).toContain("const state = useStudio.getState()");
    expect(source).toContain("[projectHf, repairTimelineLanes]");
    expect(source).toContain("HyperFrames preview failed");
    // The preview is the whole film, never one scene — this is what lets playback
    // cross scene boundaries. See docs/ux-followups.md §1.
    expect(source).not.toContain("buildSceneEditingProject");
    expect(source).toContain("const current = state.project");
    expect(previewSource).toContain("buildHyperframesProjectFiles(project)");
    expect(previewSource).toContain('fetch("/api/hyperframes/preview-bundle"');
    expect(previewSource).toContain("assertPreviewBundleResponseHtml(html)");
    expect(previewSource).toContain("Preview bundle endpoint returned the Studio app shell");
    expect(previewSource).toContain("resolvePreviewAssetPaths(html, assets, assetUrls)");
    expect(source).not.toContain("inlinePreviewScripts(");
    expect(source).not.toContain("gsap/dist/gsap.min.js?raw");
    expect(pluginSource).toContain('new URL(req.url ?? "/", "http://localhost").pathname');
    expect(pluginSource).toContain('pathname === "/api/hyperframes/preview-bundle"');
    expect(pluginSource).toContain("loadHyperframesBundler()");
    expect(pluginSource).toContain("await assertProjectFilesNoTrackOverlaps(projectDir)");
    expect(pluginSource).toContain('bundleToSingleHtml(projectDir, { runtime: "inline" })');
    expect(pluginSource).toContain("resolvePreviewRuntimeScriptRefs(");
    expect(pluginSource).toContain("pathname.startsWith(PREVIEW_RUNTIME_ROUTE_PREFIX)");
    expect(pluginSource).not.toContain("assertNoTrackOverlaps(html);");
    expect(pluginSource).not.toContain("assertNoTrackOverlaps(bundledHtml);");
  });
});
