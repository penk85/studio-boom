import type { RecordedKeypose, RecordedPartOverride } from "../types";
import { recordedOverrideTargetKey } from "../character/motion-targets";
import { expandKeyposesWithAnticipation } from "./apply";
import { sampleMotionEase } from "./easing";

const VALUE_KEYS = [
  "dx",
  "dy",
  "scale",
  "scaleX",
  "scaleY",
  "skewX",
  "skewY",
  "rotation",
  "rotationX",
  "rotationY",
  "transformPerspective",
  "originX",
  "originY",
  "opacity",
] as const;

type ValueKey = (typeof VALUE_KEYS)[number];

const VALUE_DEFAULTS: Record<ValueKey, number> = {
  dx: 0,
  dy: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  skewX: 0,
  skewY: 0,
  rotation: 0,
  rotationX: 0,
  rotationY: 0,
  transformPerspective: 0,
  originX: 0.5,
  originY: 0.5,
  opacity: 1,
};

export interface SampledKeypose {
  parts: Map<string, RecordedPartOverride>;
  faceTurnX: number;
  faceTurnY: number;
}

export function sampleKeyposesAtTime(keyposes: RecordedKeypose[], time: number): SampledKeypose {
  const parts = new Map<string, RecordedPartOverride>();
  if (keyposes.length === 0) return { parts, faceTurnX: 0, faceTurnY: 0 };
  const sorted = expandKeyposesWithAnticipation(keyposes);
  let a = sorted[0];
  let b = sorted[sorted.length - 1];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    if (sorted[index + 1].t >= time) {
      a = sorted[index];
      b = sorted[index + 1];
      break;
    }
  }
  const span = Math.max(0.0001, b.t - a.t);
  const raw = Math.max(0, Math.min(1, (time - a.t) / span));
  const amount = sampleMotionEase(b.ease ?? a.ease, raw);
  const lerp = (from?: number, to?: number, fallback = 0) => {
    if (from === undefined && to === undefined) return fallback;
    if (from === undefined) return (to as number) * amount + fallback * (1 - amount);
    if (to === undefined) return from * (1 - amount) + fallback * amount;
    return from + (to - from) * amount;
  };
  const targetKeys = new Set<string>();
  for (const part of a.parts) targetKeys.add(recordedOverrideTargetKey(part));
  for (const part of b.parts) targetKeys.add(recordedOverrideTargetKey(part));

  for (const targetKey of targetKeys) {
    const from = a.parts.find((part) => recordedOverrideTargetKey(part) === targetKey);
    const to = b.parts.find((part) => recordedOverrideTargetKey(part) === targetKey);
    const source = from ?? to;
    if (!source) continue;
    const sampled: RecordedPartOverride = {
      target: source.target,
      boneId: source.boneId,
      slotId: source.slotId,
      partRole: source.partRole,
      poseSwap: (amount >= 0.5 ? to?.poseSwap : from?.poseSwap) ?? from?.poseSwap ?? to?.poseSwap,
    };
    const writable = sampled as RecordedPartOverride & Partial<Record<ValueKey, number>>;
    for (const key of VALUE_KEYS) {
      if (from?.[key] === undefined && to?.[key] === undefined) continue;
      writable[key] = lerp(from?.[key], to?.[key], VALUE_DEFAULTS[key]);
    }
    parts.set(targetKey, sampled);
  }
  return {
    parts,
    faceTurnX: lerp(a.faceTurnX, b.faceTurnX, 0),
    faceTurnY: lerp(a.faceTurnY, b.faceTurnY, 0),
  };
}
