import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const stagePath = join(process.cwd(), "src/studio/components/Stage.tsx");

describe("Stage HyperFrames Studio integration", () => {
  it("uses srcdoc and resolves the inner iframe for @hyperframes/studio hooks", () => {
    const source = readFileSync(stagePath, "utf8");

    expect(source).toContain('import { resolveIframe, useElementPicker } from "@hyperframes/studio"');
    expect(source).toContain("resolveIframe(playerRef.current)");
    expect(source).toContain("<hyperframes-player");
    expect(source).toContain("srcdoc={resolvedHtml}");
    expect(source).not.toContain("directUrl=");
  });

  it("inlines GSAP for srcdoc previews so timeline registration is not CDN-dependent", () => {
    const source = readFileSync(stagePath, "utf8");

    expect(source).toContain('import gsapRaw from "gsap/dist/gsap.min.js?raw"');
    expect(source).toContain("inlinePreviewScripts(rootHtml)");
    expect(source).toContain("inlinePreviewScripts(compHtml)");
  });
});
