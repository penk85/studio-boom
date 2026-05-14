import type { PlayerAPI } from "@hyperframes/core";

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

    if (win?.gsap?.set) {
      win.gsap.set(element, { x, y });
      return true;
    }

    const style = (element as HTMLElement).style;
    if (style) {
      style.transform = `translate(${x}px, ${y}px)`;
      return true;
    }
  } catch {
    return false;
  }

  return false;
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
    return true;
  } catch {
    return false;
  }
}
