import { describe, expect, it } from "vitest";
import {
  commitElementRotation,
  commitElementPosition,
  commitElementRect,
  previewElementPosition,
  previewElementRect,
  previewElementRotation,
} from "../player-editing";

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

  it("previews and commits rotation on the real iframe element", () => {
    const iframe = createIframeWithClip();

    expect(previewElementRotation(iframe, "clip-1", 15)).toBe(true);
    const element = iframe.contentDocument?.getElementById("clip-1") as HTMLElement | null;
    expect(element?.style.transform).toContain("rotate(15deg)");
    expect(element?.getAttribute("data-rotation")).toBeNull();

    expect(commitElementRotation(iframe, "clip-1", 0)).toBe(true);
    expect(element?.getAttribute("data-rotation")).toBe("0");
    expect(element?.style.transform).not.toContain("rotate(");

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

  it("previews resize on the real iframe element without persisting attrs", () => {
    const iframe = createIframeWithClip();

    expect(previewElementRect(iframe, "clip-1", { x: 64, y: 32, width: 320, height: 180 })).toBe(
      true,
    );
    const element = iframe.contentDocument?.getElementById("clip-1") as HTMLElement | null;
    expect(element?.style.transform).toContain("translate(64px, 32px)");
    expect(element?.style.width).toBe("320px");
    expect(element?.style.height).toBe("180px");
    expect(element?.getAttribute("data-width")).toBeNull();

    iframe.remove();
  });

  it("commits resize attrs and styles on the real iframe element", () => {
    const iframe = createIframeWithClip();

    expect(commitElementRect(iframe, "clip-1", { x: 64, y: 32, width: 320, height: 180 })).toBe(
      true,
    );
    const element = iframe.contentDocument?.getElementById("clip-1") as HTMLElement | null;
    expect(element?.getAttribute("data-x")).toBe("64");
    expect(element?.getAttribute("data-y")).toBe("32");
    expect(element?.getAttribute("data-source-width")).toBe("320");
    expect(element?.getAttribute("data-source-height")).toBe("180");
    expect(element?.getAttribute("data-width")).toBe("320");
    expect(element?.getAttribute("data-height")).toBe("180");
    expect(element?.style.maxWidth).toBe("none");
    expect(element?.style.maxHeight).toBe("none");

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
