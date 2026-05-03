// Compose all active Motion Presets at time `t` (relative to the character
// clip start) into a per-part transform delta + pose-swap map.
import type {
  MotionKeyframe,
  MotionPreset,
  AppliedMotion,
  CharacterClip,
  HeadDirection,
  PartRole,
  RecordedKeypose,
  RecordedPartOverride,
} from "../types";
import { EXCLUSIVE_MOTION_CATEGORIES } from "./motion-scheduling";

export interface ComposedDelta {
  dx: number;
  dy: number;
  scale: number; // uniform scale multiplier (1 = no change)
  scaleX: number; // horizontal squash multiplier (1 = no change)
  scaleY: number; // vertical stretch multiplier (1 = no change)
  skewX: number; // additive degrees
  skewY: number; // additive degrees
  rotation: number; // additive degrees
  originX: number | null; // null = inherit part anchor
  originY: number | null; // null = inherit part anchor
  opacity: number | null; // null = inherit
}

export interface ComposedMotions {
  /** role:<partRole> or slot:<slotId> -> delta */
  perPart: Map<string, ComposedDelta>;
  /** role:<partRole> or slot:<slotId> -> pose name to swap to */
  poseSwap: Map<string, string>;
  /** Camera transform (for scene parallax). */
  camera: { dx: number; dy: number; zoom: number };
  /** Active head direction (from headTurn presets), if any. */
  headDirection?: HeadDirection;
  /** Crossfade weight 0..1 between previous and current head direction. */
  headDirectionBlend?: { from: HeadDirection; to: HeadDirection; u: number };
  /** Semantic horizontal face turn, resolved to plain per-part transforms by render/export. */
  faceTurnX: number;
}

const EASE: Record<string, (x: number) => number> = {
  linear: (x) => x,
  easeIn: (x) => x * x,
  easeOut: (x) => 1 - (1 - x) * (1 - x),
  easeInOut: (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
  // friendly aliases
  soft: (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
  snappy: (x) => 1 - Math.pow(1 - x, 4),
  overshoot: (x) => {
    const c = 1.70158;
    return (c + 1) * x * x * x - c * x * x;
  },
  bounce: (x) => {
    const n1 = 7.5625,
      d1 = 2.75;
    if (x < 1 / d1) return n1 * x * x;
    if (x < 2 / d1) {
      x -= 1.5 / d1;
      return n1 * x * x + 0.75;
    }
    if (x < 2.5 / d1) {
      x -= 2.25 / d1;
      return n1 * x * x + 0.9375;
    }
    x -= 2.625 / d1;
    return n1 * x * x + 0.984375;
  },
  elastic: (x) =>
    x === 0
      ? 0
      : x === 1
        ? 1
        : -Math.pow(2, 10 * x - 10) * Math.sin((x * 10 - 10.75) * ((2 * Math.PI) / 3)),
  hold: (x) => (x < 1 ? 0 : 1),
};

export function ease(name: string | undefined, x: number) {
  return (EASE[name ?? "easeInOut"] ?? EASE.easeInOut)(Math.max(0, Math.min(1, x)));
}

function emptyDelta(): ComposedDelta {
  return {
    dx: 0,
    dy: 0,
    scale: 1,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
    skewY: 0,
    rotation: 0,
    originX: null,
    originY: null,
    opacity: null,
  };
}

function interpKf(a: MotionKeyframe, b: MotionKeyframe, u: number): ComposedDelta {
  const e = ease(b.ease ?? a.ease, u);
  const lerp = (av?: number, bv?: number, def = 0) => {
    if (av === undefined && bv === undefined) return def;
    if (av === undefined) return bv!;
    if (bv === undefined) return av;
    return av + (bv - av) * e;
  };
  return {
    dx: lerp(a.dx, b.dx, 0),
    dy: lerp(a.dy, b.dy, 0),
    scale: lerp(a.scale, b.scale, 1),
    scaleX: lerp(a.scaleX, b.scaleX, 1),
    scaleY: lerp(a.scaleY, b.scaleY, 1),
    skewX: lerp(a.skewX, b.skewX, 0),
    skewY: lerp(a.skewY, b.skewY, 0),
    rotation: lerp(a.rotation, b.rotation, 0),
    originX:
      a.originX === undefined && b.originX === undefined ? null : lerp(a.originX, b.originX, 0.5),
    originY:
      a.originY === undefined && b.originY === undefined ? null : lerp(a.originY, b.originY, 0.5),
    opacity:
      a.opacity === undefined && b.opacity === undefined ? null : lerp(a.opacity, b.opacity, 1),
  };
}

export function sampleTrack(
  keyframes: MotionKeyframe[],
  u: number, // 0..1 within preset
): ComposedDelta {
  if (keyframes.length === 0) return emptyDelta();
  if (keyframes.length === 1) {
    const k = keyframes[0];
    return {
      dx: k.dx ?? 0,
      dy: k.dy ?? 0,
      scale: k.scale ?? 1,
      scaleX: k.scaleX ?? 1,
      scaleY: k.scaleY ?? 1,
      skewX: k.skewX ?? 0,
      skewY: k.skewY ?? 0,
      rotation: k.rotation ?? 0,
      originX: k.originX ?? null,
      originY: k.originY ?? null,
      opacity: k.opacity ?? null,
    };
  }
  // find segment
  let i = 0;
  for (; i < keyframes.length - 1; i++) {
    if (keyframes[i + 1].t >= u) break;
  }
  const a = keyframes[i];
  const b = keyframes[Math.min(i + 1, keyframes.length - 1)];
  const span = Math.max(0.0001, b.t - a.t);
  const local = Math.max(0, Math.min(1, (u - a.t) / span));
  return interpKf(a, b, local);
}

export function applyIntensity(d: ComposedDelta, intensity: number): ComposedDelta {
  return {
    dx: d.dx * intensity,
    dy: d.dy * intensity,
    scale: 1 + (d.scale - 1) * intensity,
    scaleX: 1 + (d.scaleX - 1) * intensity,
    scaleY: 1 + (d.scaleY - 1) * intensity,
    skewX: d.skewX * intensity,
    skewY: d.skewY * intensity,
    rotation: d.rotation * intensity,
    originX: d.originX,
    originY: d.originY,
    opacity: d.opacity,
  };
}

export function combine(a: ComposedDelta, b: ComposedDelta): ComposedDelta {
  return {
    dx: a.dx + b.dx,
    dy: a.dy + b.dy,
    scale: a.scale * b.scale,
    scaleX: a.scaleX * b.scaleX,
    scaleY: a.scaleY * b.scaleY,
    skewX: a.skewX + b.skewX,
    skewY: a.skewY + b.skewY,
    rotation: a.rotation + b.rotation,
    originX: b.originX ?? a.originX,
    originY: b.originY ?? a.originY,
    opacity: b.opacity ?? a.opacity,
  };
}

function roleKey(role: PartRole) {
  return `role:${role}`;
}

function slotKey(slotId: string) {
  return `slot:${slotId}`;
}

function trackTargetKey(track: { partRole: PartRole | "__camera"; slotId?: string }) {
  return track.slotId ? slotKey(track.slotId) : roleKey(track.partRole as PartRole);
}

function overrideTargetKey(override: { partRole: PartRole; slotId?: string }) {
  return override.slotId ? slotKey(override.slotId) : roleKey(override.partRole);
}

export function composeMotionsAt(
  clip: CharacterClip,
  tInClip: number,
  presets: Map<string, MotionPreset>,
): ComposedMotions {
  const out: ComposedMotions = {
    perPart: new Map(),
    poseSwap: new Map(),
    camera: { dx: 0, dy: 0, zoom: 1 },
    faceTurnX: 0,
  };
  const motions: AppliedMotion[] = clip.motions ?? [];
  const activeExclusiveMotionIds = activeExclusiveMotionsAt(
    motions,
    tInClip,
    presets,
    clip.duration,
  );
  for (const a of motions) {
    const preset = presets.get(a.presetId);
    if (!preset) continue;
    if (
      EXCLUSIVE_MOTION_CATEGORIES.has(preset.category) &&
      activeExclusiveMotionIds.get(preset.category) !== a.id
    ) {
      continue;
    }
    const dur = a.duration ?? preset.duration;
    const occurrences = generateMotionOccurrences(a, preset, clip.duration);
    const occurrence = occurrences.find((o) => tInClip >= o.start && tInClip <= o.end);
    if (!occurrence) continue;
    const local = tInClip - occurrence.start;
    const u = dur > 0 ? Math.max(0, Math.min(1, local / dur)) : 0;
    const intensity = a.intensity ?? 1;

    if (preset.category === "headTurn" && preset.headTurn) {
      out.headDirection = u >= 0.5 ? preset.headTurn.to : preset.headTurn.from;
      out.poseSwap.set(roleKey("body"), out.headDirection);
      out.headDirectionBlend = {
        from: preset.headTurn.from,
        to: preset.headTurn.to,
        u: ease(preset.headTurn.ease, u),
      };
    }

    if (preset.keyposes && preset.keyposes.length > 0) {
      applyKeyposes(out, expandKeyposesWithAnticipation(preset.keyposes), dur, local, intensity);
      continue;
    }

    for (const track of preset.tracks) {
      const sample = applyIntensity(sampleTrack(track.keyframes, u), intensity);
      if (track.partRole === "__camera") {
        out.camera.dx += sample.dx;
        out.camera.dy += sample.dy;
        out.camera.zoom *= sample.scale;
        continue;
      }
      const key = trackTargetKey(track);
      const prev = out.perPart.get(key) ?? emptyDelta();
      out.perPart.set(key, combine(prev, sample));
      if (track.poseSwap) out.poseSwap.set(key, track.poseSwap);
    }
  }
  return out;
}

function activeExclusiveMotionsAt(
  motions: AppliedMotion[],
  tInClip: number,
  presets: Map<string, MotionPreset>,
  clipDuration: number,
): Map<string, string> {
  const active = new Map<string, { id: string; occurrenceStart: number; index: number }>();
  motions.forEach((motion, index) => {
    const preset = presets.get(motion.presetId);
    if (!preset || !EXCLUSIVE_MOTION_CATEGORIES.has(preset.category)) return;
    const occurrence = generateMotionOccurrences(motion, preset, clipDuration).find(
      (entry) => tInClip >= entry.start && tInClip <= entry.end,
    );
    if (!occurrence) return;
    const current = active.get(preset.category);
    if (
      !current ||
      occurrence.start > current.occurrenceStart ||
      (occurrence.start === current.occurrenceStart && index > current.index)
    ) {
      active.set(preset.category, { id: motion.id, occurrenceStart: occurrence.start, index });
    }
  });
  return new Map(Array.from(active.entries()).map(([category, entry]) => [category, entry.id]));
}

/** Linearly interpolate between recorded keyposes and merge into ComposedMotions. */
function applyKeyposes(
  out: ComposedMotions,
  keyposes: RecordedKeypose[],
  dur: number,
  local: number,
  intensity: number,
) {
  if (keyposes.length === 0) return;
  const sorted = [...keyposes].sort((a, b) => a.t - b.t);
  const t = Math.max(0, Math.min(dur, local));
  let a = sorted[0];
  let b = sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1].t >= t) {
      a = sorted[i];
      b = sorted[i + 1];
      break;
    }
  }
  const span = Math.max(0.0001, b.t - a.t);
  const u = ease(b.ease ?? a.ease, Math.max(0, Math.min(1, (t - a.t) / span)));

  const aCam = a.camera ?? {};
  const bCam = b.camera ?? {};
  const cdx = (aCam.dx ?? 0) + ((bCam.dx ?? 0) - (aCam.dx ?? 0)) * u;
  const cdy = (aCam.dy ?? 0) + ((bCam.dy ?? 0) - (aCam.dy ?? 0)) * u;
  const cz = (aCam.zoom ?? 1) + ((bCam.zoom ?? 1) - (aCam.zoom ?? 1)) * u;
  const lerp = (av?: number, bv?: number, def = 0) => {
    if (av === undefined && bv === undefined) return def;
    if (av === undefined) return (bv as number) * u + def * (1 - u);
    if (bv === undefined) return av * (1 - u) + def * u;
    return av + (bv - av) * u;
  };
  out.camera.dx += cdx * intensity;
  out.camera.dy += cdy * intensity;
  out.camera.zoom *= 1 + (cz - 1) * intensity;
  out.faceTurnX += lerp(a.faceTurnX, b.faceTurnX, 0) * intensity;

  const targets = new Set<string>();
  for (const p of a.parts) targets.add(overrideTargetKey(p));
  for (const p of b.parts) targets.add(overrideTargetKey(p));
  for (const key of targets) {
    const pa = a.parts.find((p) => overrideTargetKey(p) === key);
    const pb = b.parts.find((p) => overrideTargetKey(p) === key);
    const role = (pa ?? pb)?.partRole;
    if (!role) continue;
    const sample: ComposedDelta = {
      dx: lerp(pa?.dx, pb?.dx, 0),
      dy: lerp(pa?.dy, pb?.dy, 0),
      scale: lerp(pa?.scale, pb?.scale, 1),
      scaleX: lerp(pa?.scaleX, pb?.scaleX, 1),
      scaleY: lerp(pa?.scaleY, pb?.scaleY, 1),
      skewX: lerp(pa?.skewX, pb?.skewX, 0),
      skewY: lerp(pa?.skewY, pb?.skewY, 0),
      rotation: lerp(pa?.rotation, pb?.rotation, 0),
      originX:
        pa?.originX === undefined && pb?.originX === undefined
          ? null
          : lerp(pa?.originX, pb?.originX, 0.5),
      originY:
        pa?.originY === undefined && pb?.originY === undefined
          ? null
          : lerp(pa?.originY, pb?.originY, 0.5),
      opacity:
        pa?.opacity === undefined && pb?.opacity === undefined
          ? null
          : lerp(pa?.opacity, pb?.opacity, 1),
    };
    const scaled = applyIntensity(sample, intensity);
    const prev = out.perPart.get(key) ?? emptyDelta();
    out.perPart.set(key, combine(prev, scaled));
    const swap = (u >= 0.5 ? pb?.poseSwap : pa?.poseSwap) ?? pa?.poseSwap ?? pb?.poseSwap;
    if (swap) out.poseSwap.set(key, swap);
  }
}

function invertOverrideForAnticipation(
  part: RecordedPartOverride,
  amount: number,
): RecordedPartOverride {
  const invertAroundOne = (value: number | undefined) =>
    value === undefined ? undefined : 1 - (value - 1) * amount;
  return {
    ...part,
    dx: part.dx === undefined ? undefined : -part.dx * amount,
    dy: part.dy === undefined ? undefined : -part.dy * amount,
    scale: invertAroundOne(part.scale),
    scaleX: invertAroundOne(part.scaleX),
    scaleY: invertAroundOne(part.scaleY),
    skewX: part.skewX === undefined ? undefined : -part.skewX * amount,
    skewY: part.skewY === undefined ? undefined : -part.skewY * amount,
    rotation: part.rotation === undefined ? undefined : -part.rotation * amount,
    originX: part.originX,
    originY: part.originY,
    opacity: part.opacity,
    poseSwap: undefined,
  };
}

export function expandKeyposesWithAnticipation(keyposes: RecordedKeypose[]): RecordedKeypose[] {
  const expanded: RecordedKeypose[] = [];
  for (const keypose of keyposes) {
    const spec = keypose.anticipation;
    if (spec && spec.amount > 0 && spec.duration > 0 && keypose.t > 0) {
      expanded.push({
        t: Math.max(0, keypose.t - spec.duration),
        ease: "easeOut",
        parts: keypose.parts.map((part) =>
          invertOverrideForAnticipation(part, Math.max(0, Math.min(1, spec.amount))),
        ),
        faceTurnX: keypose.faceTurnX === undefined ? undefined : -keypose.faceTurnX * spec.amount,
        camera: keypose.camera
          ? {
              dx: keypose.camera.dx === undefined ? undefined : -keypose.camera.dx * spec.amount,
              dy: keypose.camera.dy === undefined ? undefined : -keypose.camera.dy * spec.amount,
              zoom:
                keypose.camera.zoom === undefined
                  ? undefined
                  : 1 - (keypose.camera.zoom - 1) * spec.amount,
            }
          : undefined,
      });
    }
    expanded.push(keypose);
  }
  return expanded.sort((a, b) => a.t - b.t);
}

/** Get composed delta for a specific role with sensible defaults. */
export function deltaFor(
  composed: ComposedMotions,
  role: PartRole,
  slotId?: string,
): ComposedDelta {
  const roleDelta = composed.perPart.get(roleKey(role)) ?? emptyDelta();
  const slotDelta = slotId ? composed.perPart.get(slotKey(slotId)) : undefined;
  return slotDelta ? combine(roleDelta, slotDelta) : roleDelta;
}

export function poseSwapFor(
  composed: ComposedMotions,
  role: PartRole,
  slotId?: string,
): string | undefined {
  return (
    (slotId ? composed.poseSwap.get(slotKey(slotId)) : undefined) ??
    composed.poseSwap.get(roleKey(role))
  );
}

// ─── Loop occurrence engine ────────────────────────────────────────────────────

export interface LoopOccurrence {
  start: number;
  end: number;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Returns a deterministic list of {start, end} occurrences for an applied motion.
 * Non-looping motions return a single occurrence. Looping motions unroll all
 * repetitions within clipDuration.
 *
 * Both collectCriticalTimes() and composeMotionsAt() must call this with the
 * same arguments to guarantee identical occurrence schedules.
 */
export function generateMotionOccurrences(
  motion: AppliedMotion,
  preset: MotionPreset,
  clipDuration: number,
): LoopOccurrence[] {
  const dur = Math.max(0.0001, motion.duration ?? preset.duration);
  const looping = motion.loop ?? preset.loop;
  if (!looping) {
    return [{ start: motion.offset, end: motion.offset + dur }];
  }
  const gap = Math.max(0, motion.loopGap ?? 0);
  const gapMax = motion.loopMode === "random" ? Math.max(gap, motion.loopGapMax ?? gap) : gap;
  const rng = mulberry32(hashString(motion.id));
  const occurrences: LoopOccurrence[] = [];
  let t = motion.offset;
  let guard = 0;
  while (t < clipDuration && guard < 1000) {
    occurrences.push({ start: t, end: t + dur });
    const nextGap = gap >= gapMax ? gap : gap + rng() * (gapMax - gap);
    t += dur + nextGap;
    guard++;
  }
  return occurrences;
}
