import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const stagePath = join(process.cwd(), "src/studio/components/Stage.tsx");
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

    expect(source).toContain('from "../hyperframes/player-editing"');
    expect(source).toContain("previewElementPosition(iframeRef.current");
    expect(source).toContain("commitElementPosition(iframeRef.current");
    expect(source).toContain("previewElementRect(iframeRef.current");
    expect(source).toContain("commitElementRect(iframeRef.current");
    expect(source).toContain("previewElementRotation(iframeRef.current");
    expect(source).toContain("commitElementRotation(iframeRef.current");
    expect(source).toContain("updateClip(currentDrag.clipId, { x: nextX, y: nextY })");
    expect(source).toContain("updateClip(currentDrag.clipId, { rotation: finalRotation })");
    expect(source).toContain("updateClipKeyframe(");
    expect(source).toContain("getStageKeyframeTarget(");
    expect(source).toContain("getSelectedMotionEndpoint(");
    expect(source).toContain("scaleForKeyframedResize(");
    expect(source).toContain("keyboardNudgeDelta(");
    expect(source).toContain(
      "updateClip(currentClip.id, { x: nextX, y: nextY }, { history: false })",
    );
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
    expect(source).toContain('data-stage-click-target=""');
    // Figma-style select/drag: the overlay rects are pure hit targets and the controller
    // reads the full z-stack under the pointer to drill, prefer the selection, and lock.
    expect(source).toContain("data-clip-id={clip.id}");
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
    expect(source).toContain('data-stage-motion-path=""');
    expect(source).toContain("getStageMotionPaths(");
    expect(source).toContain('data-stage-motion-checkpoint=""');
    expect(source).toContain('data-stage-motion-line-hit=""');
    expect(source).toContain('data-stage-move-handle=""');
    expect(source).toContain("resizeCompositionRect({");
    expect(source).toContain("scaleCompositionRectFromHandleRect(");
    expect(source).toContain("roundCompositionRect(previewClip)");
    expect(source).toContain("width: finalClip.width");
    expect(source).toContain("height: finalClip.height");
    expect(source).toContain("<SelectionCorner");
    expect(source).toContain('data-stage-rotate-handle=""');
    expect(source).toContain("getRotationPreview(");
    expect(source).toContain("snapRotationDegrees(");
    expect(source).toContain("transform: `rotate(${previewRotation}deg)`");
    expect(source).toContain("compositionDeltaToLocal(");
    expect(source).toContain("getLayerShortcut(event)");
    expect(source).toContain("bringClipForward(currentClip.id)");
    expect(source).toContain("sendClipBackward(currentClip.id)");
  });

  it("stages srcdoc previews through the same HyperFrames project-file bundling contract", () => {
    const source = readFileSync(stagePath, "utf8");
    const previewSource = readFileSync(previewPath, "utf8");
    const pluginSource = readFileSync(renderPluginPath, "utf8");

    expect(source).toContain("resolvePreviewHtml(current)");
    expect(source).toContain("HyperFrames preview failed");
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
    expect(pluginSource).toContain('pathname.startsWith(PREVIEW_RUNTIME_ROUTE_PREFIX)');
    expect(pluginSource).not.toContain("assertNoTrackOverlaps(html);");
    expect(pluginSource).not.toContain("assertNoTrackOverlaps(bundledHtml);");
  });
});
