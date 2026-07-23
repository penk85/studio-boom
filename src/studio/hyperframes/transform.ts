export interface StudioTransformPatch {
  x?: number;
  y?: number;
  scale?: number;
  /** Per-axis mirror sign (1 or -1); default 1. Horizontal flip = -1. */
  scaleX?: number;
  /** Per-axis mirror sign (1 or -1); default 1. Vertical flip = -1. */
  scaleY?: number;
  rotation?: number;
}

export interface StudioTransformValues {
  x: number;
  y: number;
  scale: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

export const STUDIO_ROTATION_ATTR = "data-rotation";
export const STUDIO_SCALE_X_ATTR = "data-scale-x";
export const STUDIO_SCALE_Y_ATTR = "data-scale-y";

export function parseFiniteNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function readStudioTransform(
  el: Element,
  patch: StudioTransformPatch = {},
): StudioTransformValues {
  return {
    x: patch.x ?? parseFiniteNumber(el.getAttribute("data-x")) ?? 0,
    y: patch.y ?? parseFiniteNumber(el.getAttribute("data-y")) ?? 0,
    scale: patch.scale ?? parseFiniteNumber(el.getAttribute("data-scale")) ?? 1,
    scaleX: patch.scaleX ?? parseFiniteNumber(el.getAttribute(STUDIO_SCALE_X_ATTR)) ?? 1,
    scaleY: patch.scaleY ?? parseFiniteNumber(el.getAttribute(STUDIO_SCALE_Y_ATTR)) ?? 1,
    rotation: patch.rotation ?? parseFiniteNumber(el.getAttribute(STUDIO_ROTATION_ATTR)) ?? 0,
  };
}

export function hasStudioTransform(el: Element, patch: StudioTransformPatch = {}): boolean {
  return (
    patch.x !== undefined ||
    patch.y !== undefined ||
    patch.scale !== undefined ||
    patch.scaleX !== undefined ||
    patch.scaleY !== undefined ||
    patch.rotation !== undefined ||
    el.hasAttribute("data-x") ||
    el.hasAttribute("data-y") ||
    el.hasAttribute("data-scale") ||
    el.hasAttribute(STUDIO_SCALE_X_ATTR) ||
    el.hasAttribute(STUDIO_SCALE_Y_ATTR) ||
    el.hasAttribute(STUDIO_ROTATION_ATTR)
  );
}

export function composeStudioTransform(values: StudioTransformValues): string {
  const parts = [
    `translate(${formatTransformNumber(values.x)}px, ${formatTransformNumber(values.y)}px)`,
  ];
  if (values.rotation !== 0) parts.push(`rotate(${formatTransformNumber(values.rotation)}deg)`);
  // Uniform base scale folds the per-axis mirror signs in; a flip is scale × -1 on that axis.
  const sx = values.scale * values.scaleX;
  const sy = values.scale * values.scaleY;
  if (sx !== 1 || sy !== 1) {
    parts.push(
      sx === sy
        ? `scale(${formatTransformNumber(sx)})`
        : `scale(${formatTransformNumber(sx)}, ${formatTransformNumber(sy)})`,
    );
  }
  return parts.join(" ");
}

export function toGsapTransformVars(
  values: StudioTransformValues,
  force: Array<keyof StudioTransformPatch> = [],
): Record<string, number> {
  const vars: Record<string, number> = {
    x: values.x,
    y: values.y,
  };
  if (force.includes("rotation") || values.rotation !== 0) vars.rotation = values.rotation;
  const sx = values.scale * values.scaleX;
  const sy = values.scale * values.scaleY;
  const forceScale =
    force.includes("scale") || force.includes("scaleX") || force.includes("scaleY");
  if (sx !== sy) {
    // Per-axis (a mirror is present): set scaleX/scaleY explicitly so gsap doesn't collapse them.
    vars.scaleX = sx;
    vars.scaleY = sy;
  } else if (forceScale || sx !== 1) {
    vars.scale = sx;
  }
  return vars;
}

function formatTransformNumber(value: number): string {
  const normalized = Math.abs(value) < 0.000001 ? 0 : value;
  return String(Number(normalized.toFixed(4)));
}
