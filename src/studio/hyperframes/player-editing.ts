import type { PlayerAPI } from "@hyperframes/core";
import {
  STUDIO_ROTATION_ATTR,
  composeStudioTransform,
  readStudioTransform,
  toGsapTransformVars,
} from "./transform";

export type PlayerWindow = Window & {
  __player?: PlayerAPI;
  gsap?: {
    set: (target: Element | string, vars: Record<string, unknown>) => void;
  };
  __HF_PICKER_API?: {
    enable: () => void;
    disable: () => void;
    isActive?: () => boolean;
  };
};

export interface ElementRectPatch {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getPlayerApi(iframe: HTMLIFrameElement | null): PlayerAPI | undefined {
  return (iframe?.contentWindow as PlayerWindow | null)?.__player;
}

export function hasPickerApi(iframe: HTMLIFrameElement | null): boolean {
  return Boolean((iframe?.contentWindow as PlayerWindow | null)?.__HF_PICKER_API);
}

export function previewElementPosition(
  iframe: HTMLIFrameElement | null,
  elementId: string,
  x: number,
  y: number,
): boolean {
  const usedNativeApi = callNativePositionPreview(iframe, elementId, x, y);
  return setElementPositionInPlayerDom(iframe, elementId, x, y, false) || usedNativeApi;
}

export function commitElementPosition(
  iframe: HTMLIFrameElement | null,
  elementId: string,
  x: number,
  y: number,
): boolean {
  const usedNativeApi = callNativePositionCommit(iframe, elementId, x, y);
  return setElementPositionInPlayerDom(iframe, elementId, x, y, true) || usedNativeApi;
}

export function previewElementRect(
  iframe: HTMLIFrameElement | null,
  elementId: string,
  rect: ElementRectPatch,
): boolean {
  const usedPositionPreview = previewElementPosition(iframe, elementId, rect.x, rect.y);
  return setElementSizeInPlayerDom(iframe, elementId, rect, false) || usedPositionPreview;
}

export function commitElementRect(
  iframe: HTMLIFrameElement | null,
  elementId: string,
  rect: ElementRectPatch,
): boolean {
  const usedPositionCommit = commitElementPosition(iframe, elementId, rect.x, rect.y);
  return setElementSizeInPlayerDom(iframe, elementId, rect, true) || usedPositionCommit;
}

export function previewElementRotation(
  iframe: HTMLIFrameElement | null,
  elementId: string,
  rotation: number,
): boolean {
  return setElementRotationInPlayerDom(iframe, elementId, rotation, false);
}

export function commitElementRotation(
  iframe: HTMLIFrameElement | null,
  elementId: string,
  rotation: number,
): boolean {
  return setElementRotationInPlayerDom(iframe, elementId, rotation, true);
}

function callNativePositionPreview(
  iframe: HTMLIFrameElement | null,
  elementId: string,
  x: number,
  y: number,
): boolean {
  const api = getPlayerApi(iframe);
  if (!api?.previewElementPosition) return false;

  try {
    api.previewElementPosition(elementId, x, y);
    return true;
  } catch {
    return false;
  }
}

function callNativePositionCommit(
  iframe: HTMLIFrameElement | null,
  elementId: string,
  x: number,
  y: number,
): boolean {
  const api = getPlayerApi(iframe);
  if (!api) return false;

  try {
    if (api.updateElementBasePosition?.(elementId, x, y) === true) return true;
  } catch {
    // Fall through to setElementPosition/direct DOM.
  }

  try {
    if (api.setElementPosition) {
      api.setElementPosition(elementId, x, y);
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

function setElementPositionInPlayerDom(
  iframe: HTMLIFrameElement | null,
  elementId: string,
  x: number,
  y: number,
  persistAttrs: boolean,
): boolean {
  if (!iframe) return false;

  try {
    const win = iframe.contentWindow as PlayerWindow | null;
    const element = iframe.contentDocument?.getElementById(elementId);
    if (!element) return false;

    if (persistAttrs) {
      element.setAttribute("data-x", String(x));
      element.setAttribute("data-y", String(y));
    }

    const transform = readStudioTransform(element, { x, y });
    if (win?.gsap?.set) {
      win.gsap.set(element, toGsapTransformVars(transform));
      return true;
    }

    const style = (element as HTMLElement).style;
    if (style) {
      style.transform = composeStudioTransform(transform);
      style.transformOrigin = style.transformOrigin || "center center";
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

function setElementRotationInPlayerDom(
  iframe: HTMLIFrameElement | null,
  elementId: string,
  rotation: number,
  persistAttrs: boolean,
): boolean {
  if (!iframe) return false;

  try {
    const win = iframe.contentWindow as PlayerWindow | null;
    const element = iframe.contentDocument?.getElementById(elementId);
    if (!element) return false;

    if (persistAttrs) {
      element.setAttribute(STUDIO_ROTATION_ATTR, String(rotation));
    }

    const transform = readStudioTransform(element, { rotation });
    if (win?.gsap?.set) {
      win.gsap.set(element, toGsapTransformVars(transform, ["rotation"]));
      return true;
    }

    const style = (element as HTMLElement).style;
    if (!style) return false;

    style.transform = composeStudioTransform(transform);
    style.transformOrigin = style.transformOrigin || "center center";
    return true;
  } catch {
    return false;
  }
}

function setElementSizeInPlayerDom(
  iframe: HTMLIFrameElement | null,
  elementId: string,
  rect: ElementRectPatch,
  persistAttrs: boolean,
): boolean {
  if (!iframe) return false;

  try {
    const element = iframe.contentDocument?.getElementById(elementId);
    if (!element) return false;

    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);

    if (persistAttrs) {
      element.setAttribute("data-source-width", String(width));
      element.setAttribute("data-source-height", String(height));
      element.setAttribute("data-width", String(width));
      element.setAttribute("data-height", String(height));
    }

    const style = (element as HTMLElement).style;
    if (!style) return false;

    style.width = `${width}px`;
    style.height = `${height}px`;
    style.maxWidth = "none";
    style.maxHeight = "none";
    updateCompositionScaleWrapper(element, width, height);
    return true;
  } catch {
    return false;
  }
}

function updateCompositionScaleWrapper(element: Element, width: number, height: number): void {
  if (!isCompositionHost(element)) return;
  const wrapper = element.querySelector<HTMLElement>("[data-studio-composition-scale-root]");
  if (!wrapper) return;

  const naturalWidth = parsePositiveNumber(
    element.getAttribute("data-studio-composition-natural-width"),
  );
  const naturalHeight = parsePositiveNumber(
    element.getAttribute("data-studio-composition-natural-height"),
  );
  if (!naturalWidth || !naturalHeight) return;

  wrapper.style.width = `${naturalWidth}px`;
  wrapper.style.height = `${naturalHeight}px`;
  wrapper.style.transformOrigin = "0 0";
  wrapper.style.transform = `scale(${width / naturalWidth}, ${height / naturalHeight})`;
}

function isCompositionHost(element: Element): boolean {
  return (
    element.getAttribute("data-type") === "composition" ||
    element.hasAttribute("data-composition-id")
  );
}

function parsePositiveNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
