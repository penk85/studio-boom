// Compose all active Action Presets at time `t` (relative to the character
// clip start) into a per-part transform delta + pose-swap map.
import type {
  ActionKeyframe,
  ActionPreset,
  AppliedAction,
  CharacterClip,
  HeadDirection,
  PartRole,
  RecordedKeypose,
} from "../types";

export interface ComposedDelta {
  dx: number;
  dy: number;
  scale: number;     // 1 = no change
  rotation: number;  // additive degrees
  opacity: number | null; // null = inherit
}

export interface ComposedActions {
  /** partRole -> delta */
  perPart: Map<string, ComposedDelta>;
  /** partRole -> pose name to swap to */
  poseSwap: Map<string, string>;
  /** partRoles whose mouth visemes should be ignored. */
  mouthLocked: boolean;
  /** Camera transform (for scene parallax). */
  camera: { dx: number; dy: number; zoom: number };
  /** Active head direction (from headTurn presets), if any. */
  headDirection?: HeadDirection;
  /** Crossfade weight 0..1 between previous and current head direction. */
  headDirectionBlend?: { from: HeadDirection; to: HeadDirection; u: number };
}

const EASE: Record<string, (x: number) => number> = {
  linear: (x) => x,
  easeIn: (x) => x * x,
  easeOut: (x) => 1 - (1 - x) * (1 - x),
  easeInOut: (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
};

function ease(name: string | undefined, x: number) {
  return (EASE[name ?? "easeInOut"] ?? EASE.easeInOut)(Math.max(0, Math.min(1, x)));
}

function emptyDelta(): ComposedDelta {
  return { dx: 0, dy: 0, scale: 1, rotation: 0, opacity: null };
}

function interpKf(a: ActionKeyframe, b: ActionKeyframe, u: number): ComposedDelta {
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
    rotation: lerp(a.rotation, b.rotation, 0),
    opacity:
      a.opacity === undefined && b.opacity === undefined
        ? null
        : lerp(a.opacity, b.opacity, 1),
  };
}

function sampleTrack(
  keyframes: ActionKeyframe[],
  u: number, // 0..1 within preset
): ComposedDelta {
  if (keyframes.length === 0) return emptyDelta();
  if (keyframes.length === 1) {
    const k = keyframes[0];
    return {
      dx: k.dx ?? 0,
      dy: k.dy ?? 0,
      scale: k.scale ?? 1,
      rotation: k.rotation ?? 0,
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

function applyIntensity(d: ComposedDelta, intensity: number): ComposedDelta {
  return {
    dx: d.dx * intensity,
    dy: d.dy * intensity,
    scale: 1 + (d.scale - 1) * intensity,
    rotation: d.rotation * intensity,
    opacity: d.opacity,
  };
}

function combine(a: ComposedDelta, b: ComposedDelta): ComposedDelta {
  return {
    dx: a.dx + b.dx,
    dy: a.dy + b.dy,
    scale: a.scale * b.scale,
    rotation: a.rotation + b.rotation,
    opacity: b.opacity ?? a.opacity,
  };
}

export function composeActionsAt(
  clip: CharacterClip,
  tInClip: number,
  presets: Map<string, ActionPreset>,
): ComposedActions {
  const out: ComposedActions = {
    perPart: new Map(),
    poseSwap: new Map(),
    mouthLocked: false,
    camera: { dx: 0, dy: 0, zoom: 1 },
  };
  const actions: AppliedAction[] = clip.actions ?? [];
  for (const a of actions) {
    const preset = presets.get(a.presetId);
    if (!preset) continue;
    const dur = a.duration ?? preset.duration;
    let local = tInClip - a.offset;
    if (local < 0 || (!preset.loop && local > dur)) continue;
    if (preset.loop && local > dur) local = local % dur;
    const u = dur > 0 ? Math.max(0, Math.min(1, local / dur)) : 0;

    for (const track of preset.tracks) {
      const sample = applyIntensity(
        sampleTrack(track.keyframes, u),
        a.intensity ?? 1,
      );
      if (track.partRole === "__camera") {
        out.camera.dx += sample.dx;
        out.camera.dy += sample.dy;
        out.camera.zoom *= sample.scale;
        continue;
      }
      const role = track.partRole as PartRole;
      const prev = out.perPart.get(role) ?? emptyDelta();
      out.perPart.set(role, combine(prev, sample));
      if (track.poseSwap) out.poseSwap.set(role, track.poseSwap);
      if (role === "mouth" && track.lockMouth) out.mouthLocked = true;
    }
  }
  return out;
}

/** Get composed delta for a specific role with sensible defaults. */
export function deltaFor(
  composed: ComposedActions,
  role: PartRole,
): ComposedDelta {
  return composed.perPart.get(role) ?? emptyDelta();
}
