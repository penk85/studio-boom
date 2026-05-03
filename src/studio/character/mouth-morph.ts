import type { MouthViseme } from "../types";

/**
 * Semantic mouth profile.
 *
 * Values describe the intention of the mouth shape.
 * They are converted into GSAP-safe transforms for separate mouth rig parts:
 * upper lip, lower lip, interior, corners, teeth, tongue.
 *
 * Do NOT animate SVG `d` — use the transform output from profileToMouthTransforms().
 */
export interface MouthMorphProfile {
  /** Overall horizontal expansion. Positive = wider. Negative = narrower. */
  width: number;
  /** Overall mouth opening. Positive = open. Negative = pressed closed. */
  openness: number;
  /** Round/pursed quality. Positive = puckered. Negative = spread. */
  pucker: number;
  /** Vertical corner lift. Positive = smile. Negative = frown. */
  cornerLift: number;
  /** Horizontal corner pull. Positive = corners pull outward. */
  cornerPull: number;
  /** Upper lip movement. Positive = upper lip lifts. */
  upperLift: number;
  /** Lower lip / jaw movement. Positive = lower lip drops. */
  lowerDrop: number;
  /** FV-style bite. Positive = lower lip rises toward upper teeth. */
  bite: number;
  /** Optional one-sided offset for L/smirk-like shapes. */
  asymmetry?: number;
}

/**
 * Transform output for a HyperFrames-safe mouth rig.
 * All values are GSAP-animatable: x, y, scaleX, scaleY, rotation, opacity.
 * No SVG path `d` animation required.
 */
export interface MouthRigTransforms {
  root: { scaleX: number; scaleY: number; skewX: number };
  upperLip: { y: number; scaleX: number; scaleY: number; rotation: number };
  lowerLip: { y: number; scaleX: number; scaleY: number; rotation: number };
  leftCorner: { x: number; y: number };
  rightCorner: { x: number; y: number };
  interior: { scaleX: number; scaleY: number; opacity: number };
  teeth: { opacity: number; y: number; scaleX: number; scaleY: number };
  tongue: { opacity: number; y: number; scaleX: number; scaleY: number };
}

/** Style multipliers — different mouth art styles can respond differently to the same viseme. */
export interface MouthRigResponse {
  widthScale: number;
  openScale: number;
  puckerScale: number;
  smileScale: number;
  biteScale: number;
  asymmetryScale: number;
}

export const DEFAULT_MOUTH_RIG_RESPONSE: MouthRigResponse = {
  widthScale: 1,
  openScale: 1,
  puckerScale: 1,
  smileScale: 1,
  biteScale: 1,
  asymmetryScale: 1,
};

/** Papagayo / Preston Blair-inspired viseme profiles. */
export const MOUTH_MORPH_PRESETS: Record<MouthViseme, MouthMorphProfile> = {
  rest: {
    width: 0,
    openness: 0.02,
    pucker: 0,
    cornerLift: 0,
    cornerPull: 0,
    upperLift: 0,
    lowerDrop: 0,
    bite: 0,
  },
  A: {
    width: 0.02,
    openness: 0.75,
    pucker: -0.04,
    cornerLift: -0.02,
    cornerPull: -0.02,
    upperLift: 0.12,
    lowerDrop: 0.62,
    bite: 0,
  },
  E: {
    width: 0.42,
    openness: 0.16,
    pucker: -0.24,
    cornerLift: 0.12,
    cornerPull: 0.28,
    upperLift: 0.03,
    lowerDrop: 0.08,
    bite: 0,
  },
  O: {
    width: -0.22,
    openness: 0.52,
    pucker: 0.58,
    cornerLift: 0,
    cornerPull: -0.18,
    upperLift: 0.08,
    lowerDrop: 0.34,
    bite: 0,
  },
  U: {
    width: -0.36,
    openness: 0.32,
    pucker: 0.72,
    cornerLift: 0,
    cornerPull: -0.26,
    upperLift: 0.04,
    lowerDrop: 0.18,
    bite: 0,
  },
  WQ: {
    width: -0.46,
    openness: 0.18,
    pucker: 0.85,
    cornerLift: 0,
    cornerPull: -0.34,
    upperLift: 0.02,
    lowerDrop: 0.08,
    bite: 0,
  },
  MBP: {
    width: 0.04,
    openness: -0.18,
    pucker: -0.04,
    cornerLift: 0,
    cornerPull: 0.02,
    upperLift: -0.06,
    lowerDrop: -0.08,
    bite: 0,
  },
  FV: {
    width: 0.12,
    openness: 0.08,
    pucker: -0.1,
    cornerLift: 0.02,
    cornerPull: 0.08,
    upperLift: -0.02,
    lowerDrop: 0.04,
    bite: 0.9,
  },
  L: {
    width: 0.04,
    openness: 0.42,
    pucker: -0.04,
    cornerLift: 0.04,
    cornerPull: 0,
    upperLift: 0.04,
    lowerDrop: 0.32,
    bite: 0,
    asymmetry: 0.14,
  },
  Smile: {
    width: 0.46,
    openness: 0.08,
    pucker: -0.18,
    cornerLift: 0.36,
    cornerPull: 0.36,
    upperLift: -0.02,
    lowerDrop: -0.02,
    bite: 0,
  },
};

/**
 * Convert a semantic mouth profile into GSAP-safe transform values.
 *
 * Assumes SVG viewBox ~0 0 100 60, mouth centered near x=50, resting lip line near y=30.
 * Apply the output to separate SVG groups/paths — one per layer.
 */
export function profileToMouthTransforms(
  profile: MouthMorphProfile,
  response: Partial<MouthRigResponse> = {},
): MouthRigTransforms {
  const r: MouthRigResponse = { ...DEFAULT_MOUTH_RIG_RESPONSE, ...response };

  const width = profile.width * r.widthScale;
  const openness = profile.openness * r.openScale;
  const pucker = profile.pucker * r.puckerScale;
  const cornerLift = profile.cornerLift * r.smileScale;
  const cornerPull = profile.cornerPull * r.widthScale;
  const upperLift = profile.upperLift * r.openScale;
  const lowerDrop = profile.lowerDrop * r.openScale;
  const bite = profile.bite * r.biteScale;
  const asymmetry = (profile.asymmetry ?? 0) * r.asymmetryScale;

  const open = Math.max(0, openness);
  const closed = Math.min(0, openness);

  const mouthScaleX = clamp(1 + width * 0.9 - pucker * 0.38, 0.45, 1.65);
  const rootScaleY = clamp(1 + open * 0.08 - pucker * 0.03, 0.9, 1.12);
  const rootSkewX = clamp(asymmetry * 8, -5, 5);

  const upperY = clamp(-upperLift * 18 - open * 2.5 + closed * 6 - bite * 1.5, -10, 5);
  const lowerY = clamp(lowerDrop * 26 + open * 8 + closed * 6 - bite * 9, -8, 28);

  const lipScaleX = clamp(mouthScaleX + cornerPull * 0.15, 0.42, 1.7);
  const upperScaleY = clamp(1 + upperLift * 0.15 - bite * 0.08, 0.8, 1.25);
  const lowerScaleY = clamp(1 + lowerDrop * 0.22 + open * 0.08, 0.82, 1.4);

  const cornerX = clamp(cornerPull * 24 + width * 14 - pucker * 9, -16, 18);
  const cornerY = clamp(-cornerLift * 22 + open * 2 + pucker * 1.5, -11, 8);

  const interiorScaleX = clamp(1 + width * 0.75 - pucker * 0.55 + cornerPull * 0.15, 0.28, 1.55);
  const interiorScaleY = clamp(0.08 + open * 2.15 + pucker * 0.28 + lowerDrop * 0.6, 0.03, 2.7);
  const interiorOpacity = openness < -0.08 ? 0 : open < 0.03 ? 0.55 : 1;

  const wantsTeeth =
    profile.bite > 0.2 ||
    profile.cornerLift > 0.08 ||
    profile.width > 0.18 ||
    profile.openness > 0.55;
  const teethOpacity =
    wantsTeeth && openness > -0.05
      ? clamp(
          profile.bite * 0.95 +
            Math.max(0, profile.cornerLift) * 1.5 +
            Math.max(0, profile.width) * 0.8 +
            Math.max(0, profile.openness - 0.55) * 0.35,
          0,
          1,
        )
      : 0;
  const teethY = clamp(upperY * 0.45 + bite * 2 - open * 0.8, -6, 6);
  const teethScaleX = clamp(interiorScaleX * (1 - Math.max(0, pucker) * 0.2), 0.42, 1.45);

  const wantsTongue = profile.openness > 0.35 && profile.pucker < 0.25 && profile.bite < 0.2;
  const tongueOpacity = wantsTongue
    ? clamp(open * 0.9 + Math.max(0, profile.lowerDrop) * 0.5, 0, 1)
    : 0;
  const tongueY = clamp(lowerY * 0.45 + open * 7, 2, 22);
  const tongueScaleX = clamp(interiorScaleX * (1 - Math.max(0, pucker) * 0.25), 0.45, 1.35);
  const tongueScaleY = clamp(1 + open * 0.18 - Math.max(0, pucker) * 0.25, 0.55, 1.35);

  const upperRotation = clamp(asymmetry * -4, -3, 3);
  const lowerRotation = clamp(asymmetry * 5, -4, 4);

  return {
    root: { scaleX: mouthScaleX, scaleY: rootScaleY, skewX: rootSkewX },
    upperLip: { y: upperY, scaleX: lipScaleX, scaleY: upperScaleY, rotation: upperRotation },
    lowerLip: { y: lowerY, scaleX: lipScaleX, scaleY: lowerScaleY, rotation: lowerRotation },
    leftCorner: { x: -cornerX, y: cornerY + asymmetry * 3 },
    rightCorner: { x: cornerX, y: cornerY - asymmetry * 3 },
    interior: { scaleX: interiorScaleX, scaleY: interiorScaleY, opacity: interiorOpacity },
    teeth: { opacity: teethOpacity, y: teethY, scaleX: teethScaleX, scaleY: 1 },
    tongue: { opacity: tongueOpacity, y: tongueY, scaleX: tongueScaleX, scaleY: tongueScaleY },
  };
}

/** Convenience: look up a viseme and convert directly to transforms. */
export function visemeToMouthTransforms(
  viseme: MouthViseme,
  response?: Partial<MouthRigResponse>,
): MouthRigTransforms {
  return profileToMouthTransforms(MOUTH_MORPH_PRESETS[viseme], response);
}

/** Blend two profiles linearly. Useful for manual sampling between visemes. */
export function blendMouthProfiles(
  from: MouthMorphProfile,
  to: MouthMorphProfile,
  t: number,
): MouthMorphProfile {
  const u = clamp(t, 0, 1);
  return {
    width: lerp(from.width, to.width, u),
    openness: lerp(from.openness, to.openness, u),
    pucker: lerp(from.pucker, to.pucker, u),
    cornerLift: lerp(from.cornerLift, to.cornerLift, u),
    cornerPull: lerp(from.cornerPull, to.cornerPull, u),
    upperLift: lerp(from.upperLift, to.upperLift, u),
    lowerDrop: lerp(from.lowerDrop, to.lowerDrop, u),
    bite: lerp(from.bite, to.bite, u),
    asymmetry: lerp(from.asymmetry ?? 0, to.asymmetry ?? 0, u),
  };
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
