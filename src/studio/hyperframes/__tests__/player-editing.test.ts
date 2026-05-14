import { describe, expect, it } from "vitest";
import { commitElementPosition, previewElementPosition } from "../player-editing";

describe("player editing boundary", () => {
  it("previews movement on the real iframe element when player position APIs are unavailable", () => {
    const iframe = createIframeWithClip();

    expect(previewElementPosition(iframe, "clip-1", 128, 96)).toBe(true);
    expect(iframe.contentDocument?.getElementById("clip-1")?.getAttribute("style")).toContain(
      "translate(128px, 96px)",
    );

    iframe.remove();
  });

  it("uses iframe GSAP for movement previews when available", () => {
    const iframe = createIframeWithClip();
    const calls: unknown[] = [];
    Object.defineProperty(iframe.contentWindow, "gsap", {
      configurable: true,
      value: {
        set: (...args: unknown[]) => calls.push(args),
      },
    });

    expect(previewElementPosition(iframe, "clip-1", 128, 96)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([iframe.contentDocument?.getElementById("clip-1"), { x: 128, y: 96 }]);

    iframe.remove();
  });

  it("commits movement attrs on the real iframe element as a package fallback", () => {
    const iframe = createIframeWithClip();

    expect(commitElementPosition(iframe, "clip-1", 42, 24)).toBe(true);
    const element = iframe.contentDocument?.getElementById("clip-1");
    expect(element?.getAttribute("data-x")).toBe("42");
    expect(element?.getAttribute("data-y")).toBe("24");

    iframe.remove();
  });
});

function createIframeWithClip(): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  iframe.contentDocument?.open();
  iframe.contentDocument?.write(`<!DOCTYPE html><html><body>
    <img id="clip-1" src="asset:clip-1" />
  </body></html>`);
  iframe.contentDocument?.close();
  return iframe;
}
