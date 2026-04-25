// Parallax math — converts a part's depth into a translation offset
// based on the current camera/clip motion.
// Depth is -1 (background, lags) .. 0 (neutral) .. +1 (foreground, leads).
//
// The "delta" (dx,dy) is the displacement of the camera or clip from its
// resting position. We multiply that by `depth * intensity` and apply with
// inverted sign for background depth (so far things shift opposite to the
// camera, near things shift along with it more).
export function parallaxOffset(
  depth: number,
  delta: { dx: number; dy: number },
  intensity = 0.15,
): { dx: number; dy: number } {
  const k = depth * intensity;
  return { dx: delta.dx * k, dy: delta.dy * k };
}
