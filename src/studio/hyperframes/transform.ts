export interface StudioTransformPatch {
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
}

export interface StudioTransformValues {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export const STUDIO_ROTATION_ATTR = "data-rotation";

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
    rotation: patch.rotation ?? parseFiniteNumber(el.getAttribute(STUDIO_ROTATION_ATTR)) ?? 0,
  };
}

export function hasStudioTransform(el: Element, patch: StudioTransformPatch = {}): boolean {
  return (
    patch.x !== undefined ||
    patch.y !== undefined ||
    patch.scale !== undefined ||
    patch.rotation !== undefined ||
    el.hasAttribute("data-x") ||
    el.hasAttribute("data-y") ||
    el.hasAttribute("data-scale") ||
    el.hasAttribute(STUDIO_ROTATION_ATTR)
  );
}

export function composeStudioTransform(values: StudioTransformValues): string {
  const parts = [
    `translate(${formatTransformNumber(values.x)}px, ${formatTransformNumber(values.y)}px)`,
  ];
  if (values.rotation !== 0) parts.push(`rotate(${formatTransformNumber(values.rotation)}deg)`);
  if (values.scale !== 1) parts.push(`scale(${formatTransformNumber(values.scale)})`);
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
  if (force.includes("scale") || values.scale !== 1) vars.scale = values.scale;
  return vars;
}

function formatTransformNumber(value: number): string {
  const normalized = Math.abs(value) < 0.000001 ? 0 : value;
  return String(Number(normalized.toFixed(4)));
}
