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
