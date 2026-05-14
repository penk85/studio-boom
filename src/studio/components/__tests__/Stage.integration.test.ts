import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const stagePath = join(process.cwd(), "src/studio/components/Stage.tsx");

describe("Stage HyperFrames Studio integration", () => {
  it("uses srcdoc and resolves the inner iframe for @hyperframes/studio hooks", () => {
    const source = readFileSync(stagePath, "utf8");

    expect(source).toContain('from "@hyperframes/studio"');
    expect(source).toContain("resolveIframe");
    expect(source).toContain("useElementPicker");
    expect(source).toContain("resolveIframe(playerRef.current)");
    expect(source).toContain("<hyperframes-player");
    expect(source).toContain("srcdoc={resolvedHtml}");
    expect(source).not.toContain("directUrl=");
  });

  it("keeps stage interaction attached to the real player while drawing editor-only chrome", () => {
    const source = readFileSync(stagePath, "utf8");

    expect(source).toContain('from "../hyperframes/player-editing"');
    expect(source).toContain("previewElementPosition(iframeRef.current");
    expect(source).toContain("commitElementPosition(iframeRef.current");
    expect(source).toContain("updateClip(currentDrag.clipId, { x: nextX, y: nextY })");
    expect(source).toContain('data-stage-selection-overlay=""');
    expect(source).toContain("const { pickedElement, enablePick, isPickMode } = useElementPicker");
    expect(source).toContain("if (!resolvedHtml || drag || isPickMode) return;");
    expect(source).toContain('doc.addEventListener("click", handleClick, true)');
    expect(source).toContain("resolveTargetClipId(");
    expect(source).toContain("getRenderedPixelRect(iframeRef.current, clipId)");
    expect(source).toContain("compositionDomRectToCss(renderedElementRect, stageGeometry)");
    expect(source).toContain('data-stage-move-handle=""');
    expect(source).toContain("resizeCompositionRect({");
    expect(source).toContain("width: previewClip.width");
    expect(source).toContain("height: previewClip.height");
    expect(source).toContain("<SelectionCorner");
  });

  it("inlines GSAP for srcdoc previews so timeline registration is not CDN-dependent", () => {
    const source = readFileSync(stagePath, "utf8");

    expect(source).toContain('import gsapRaw from "gsap/dist/gsap.min.js?raw"');
    expect(source).toContain("inlinePreviewScripts(rootHtml)");
    expect(source).toContain("inlinePreviewScripts(compHtml)");
  });
});
