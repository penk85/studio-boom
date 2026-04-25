// Parallax math — converts a part's depth into a translation offset
// based on camera and/or clip motion.
// Depth is -1 (background, lags) .. 0 (neutral) .. +1 (foreground, leads).
import type { ParallaxConfig } from "../types";

export interface ParallaxInputs {
  /** Scene-camera delta from rest. */
  cameraDelta?: { dx: number; dy: number };
  /** Character clip delta from rest. */
  clipDelta?: { dx: number; dy: number };
}

export function parallaxOffset(
  depth: number,
  delta: { dx: number; dy: number },
  intensity = 0.15,
): { dx: number; dy: number } {
  const k = depth * intensity;
  return { dx: delta.dx * k, dy: delta.dy * k };
}

/** Combined parallax taking per-character config into account. */
export function combinedParallax(
  depth: number,
  cfg: ParallaxConfig,
  inputs: ParallaxInputs,
): { dx: number; dy: number } {
  let dx = 0;
  let dy = 0;
  if (cfg.onCamera && inputs.cameraDelta) {
    const o = parallaxOffset(depth, inputs.cameraDelta, cfg.intensity);
    dx += o.dx; dy += o.dy;
  }
  if (cfg.onClip && inputs.clipDelta) {
    const o = parallaxOffset(depth, inputs.clipDelta, cfg.intensity);
    dx += o.dx; dy += o.dy;
  }
  return { dx, dy };
}
