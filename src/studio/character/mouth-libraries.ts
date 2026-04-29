import type { MouthPose, MouthRig, MouthViseme } from "../types";

// ─── ViewBox ─────────────────────────────────────────────────────────────────
// All rig component paths are designed in this coordinate space.
// Paths are centered around x=50 and the mouth line y=30.
// This keeps scaleX/scaleY transforms predictable across styles.
export const MOUTH_VIEWBOX = "0 0 100 60";

// ─── Default colours ─────────────────────────────────────────────────────────
export const DEFAULT_LIP_COLOR = "#b35b68";
export const DEFAULT_TEETH_COLOR = "#fff2df";
export const DEFAULT_TONGUE_COLOR = "#d96b76";
export const DEFAULT_INTERIOR_COLOR = "#23090b";

// ─── Preston Blair / Papagayo-inspired viseme poses ───────────────────────────
// These are not drawings. They are semantic animation targets.
// The rig turns these values into GSAP-safe transforms.
//
// Important lip-sync note:
// Do not swap these too quickly. The mouth will usually look better with
// fewer stronger shapes and short holds than with constant rapid changes.
export const VISEME_POSES: Record<MouthViseme, MouthPose> = {
  rest: {
    open: 0.04,
    wide: 0,
    round: 0,
    smile: 0,
    teeth: 0,
    tongue: 0,
    fvBite: 0,
  },

  MBP: {
    open: -0.08,
    wide: 0,
    round: 0,
    smile: 0,
    teeth: 0,
    tongue: 0,
    fvBite: 0,
  },

  A: {
    open: 1.0,
    wide: 0.15,
    round: 0,
    smile: 0,
    teeth: 0.35,
    tongue: 0.65,
    fvBite: 0,
  },

  E: {
    open: 0.28,
    wide: 1.0,
    round: 0,
    smile: 0.35,
    teeth: 0.85,
    tongue: 0.05,
    fvBite: 0,
  },

  O: {
    open: 0.72,
    wide: -0.35,
    round: 0.85,
    smile: 0,
    teeth: 0.05,
    tongue: 0.05,
    fvBite: 0,
  },

  U: {
    open: 0.42,
    wide: -0.55,
    round: 1.0,
    smile: 0,
    teeth: 0,
    tongue: 0,
    fvBite: 0,
  },

  WQ: {
    open: 0.22,
    wide: -0.7,
    round: 1.0,
    smile: 0,
    teeth: 0,
    tongue: 0,
    fvBite: 0,
  },

  FV: {
    open: 0.16,
    wide: 0.15,
    round: 0,
    smile: 0.05,
    teeth: 0.9,
    tongue: 0,
    fvBite: 1,
  },

  L: {
    open: 0.55,
    wide: 0.15,
    round: 0,
    smile: 0.1,
    teeth: 0.45,
    tongue: 1,
    fvBite: 0,
  },

  Smile: {
    open: 0.08,
    wide: 0.95,
    round: 0,
    smile: 1,
    teeth: 0.55,
    tongue: 0,
    fvBite: 0,
  },
};

// ─── Transforms ───────────────────────────────────────────────────────────────
// All values are in SVG user units, based on viewBox 0 0 100 60.
// The timeline builder can multiply positional offsets by
// placement.height / 60 to convert into CSS pixels if needed.
export interface RigTransforms {
  upperLip: {
    y: number;
    scaleX: number;
    scaleY: number;
  };

  lowerLip: {
    y: number;
    scaleX: number;
    scaleY: number;
  };

  interior: {
    scaleX: number;
    scaleY: number;
    opacity: number;
  };

  teeth: {
    opacity: number;
    y: number;
    scaleX: number;
  };

  tongue: {
    opacity: number;
    y: number;
    scaleX: number;
    scaleY: number;
  };
}

// ─── Style definitions ───────────────────────────────────────────────────────
export interface RigStyle {
  id: string;
  label: string;

  // Component paths at rest, in viewBox 0 0 100 60.
  // These paths should remain static. Do not animate path d values.
  // Animate only transforms: x/y/scale/opacity/etc.
  upperLipPath: string;
  lowerLipPath: string;
  interiorPath: string;
  teethPath: string;
  tonguePath: string;

  // Style-level response multipliers.
  // These let the same viseme poses behave differently per mouth style.
  openScale: number;
  wideScale: number;
  roundScale: number;
  smileScale: number;
}

// ─── Soft Cartoon ─────────────────────────────────────────────────────────────
// Best default.
// Friendly, readable, and broad enough to work on children’s/cartoon faces.
const softCartoon: RigStyle = {
  id: "softCartoon",
  label: "Soft Cartoon",

  upperLipPath:
    "M 18 30 " +
    "C 28 25 39 24 50 26 " +
    "C 61 24 72 25 82 30 " +
    "C 72 33 60 34 50 34 " +
    "C 40 34 28 33 18 30 Z",

  lowerLipPath:
    "M 18 30 " +
    "C 30 31 42 31 50 31 " +
    "C 58 31 70 31 82 30 " +
    "C 75 39 62 44 50 44 " +
    "C 38 44 25 39 18 30 Z",

  // Bean/oval cavity. This scales better than a very thin slit.
  interiorPath:
    "M 24 30 " + "C 28 23 72 23 76 30 " + "C 75 39 64 45 50 45 " + "C 36 45 25 39 24 30 Z",

  teethPath: "M 28 29 " + "C 38 27 62 27 72 29 " + "L 72 35 " + "C 61 37 39 37 28 35 Z",

  tonguePath: "M 34 38 " + "C 38 34 62 34 66 38 " + "C 64 44 36 44 34 38 Z",

  openScale: 1.0,
  wideScale: 1.0,
  roundScale: 1.0,
  smileScale: 1.0,
};

// ─── Tiny Cute ────────────────────────────────────────────────────────────────
// For kawaii/simple faces.
// Less lip detail, smaller silhouette, works well at small sizes.
const tinyCute: RigStyle = {
  id: "tinyCute",
  label: "Tiny Cute",

  upperLipPath:
    "M 28 30 " +
    "C 35 27 43 26 50 27 " +
    "C 57 26 65 27 72 30 " +
    "C 64 32 57 33 50 33 " +
    "C 43 33 36 32 28 30 Z",

  lowerLipPath:
    "M 28 30 " +
    "C 36 31 44 31 50 31 " +
    "C 56 31 64 31 72 30 " +
    "C 66 36 58 39 50 39 " +
    "C 42 39 34 36 28 30 Z",

  interiorPath:
    "M 31 30 " + "C 34 25 66 25 69 30 " + "C 68 36 60 40 50 40 " + "C 40 40 32 36 31 30 Z",

  teethPath: "M 36 29 " + "C 43 28 57 28 64 29 " + "L 64 33 " + "C 57 34 43 34 36 33 Z",

  tonguePath: "M 39 36 " + "C 43 33 57 33 61 36 " + "C 59 40 41 40 39 36 Z",

  openScale: 0.82,
  wideScale: 0.85,
  roundScale: 1.05,
  smileScale: 0.9,
};

// ─── Big Expressive ───────────────────────────────────────────────────────────
// More elastic.
// Good for funny/kids characters and strong lip-sync readability.
const bigExpressive: RigStyle = {
  id: "bigExpressive",
  label: "Big Expressive",

  upperLipPath:
    "M 12 30 " +
    "C 24 23 38 22 50 25 " +
    "C 62 22 76 23 88 30 " +
    "C 76 34 62 36 50 36 " +
    "C 38 36 24 34 12 30 Z",

  lowerLipPath:
    "M 12 30 " +
    "C 26 31 40 32 50 32 " +
    "C 60 32 74 31 88 30 " +
    "C 80 42 65 49 50 49 " +
    "C 35 49 20 42 12 30 Z",

  interiorPath:
    "M 18 30 " + "C 22 21 78 21 82 30 " + "C 81 43 67 51 50 51 " + "C 33 51 19 43 18 30 Z",

  teethPath: "M 24 28 " + "C 36 25 64 25 76 28 " + "L 76 36 " + "C 63 39 37 39 24 36 Z",

  tonguePath: "M 29 40 " + "C 35 35 65 35 71 40 " + "C 68 48 32 48 29 40 Z",

  openScale: 1.18,
  wideScale: 1.12,
  roundScale: 0.95,
  smileScale: 1.18,
};

// ─── Simple Line ──────────────────────────────────────────────────────────────
// Minimal style for very simple characters.
// Cleaner silhouette, less lip body, less mature/realistic.
const simpleLine: RigStyle = {
  id: "simpleLine",
  label: "Simple Line",

  upperLipPath:
    "M 20 30 " + "C 32 27 68 27 80 30 " + "C 68 32 58 33 50 33 " + "C 42 33 32 32 20 30 Z",

  lowerLipPath:
    "M 20 30 " + "C 32 31 68 31 80 30 " + "C 72 36 60 39 50 39 " + "C 40 39 28 36 20 30 Z",

  interiorPath:
    "M 25 30 " + "C 30 26 70 26 75 30 " + "C 73 36 62 40 50 40 " + "C 38 40 27 36 25 30 Z",

  teethPath: "M 31 29 " + "C 40 28 60 28 69 29 " + "L 69 33 " + "C 60 34 40 34 31 33 Z",

  tonguePath: "M 36 36 " + "C 40 33 60 33 64 36 " + "C 62 40 38 40 36 36 Z",

  openScale: 0.95,
  wideScale: 1.0,
  roundScale: 1.0,
  smileScale: 0.95,
};

// ─── Wide Smile ───────────────────────────────────────────────────────────────
// Good for friendly characters with broad faces.
const wideSmile: RigStyle = {
  id: "wideSmile",
  label: "Wide Smile",

  upperLipPath:
    "M 8 30 " +
    "C 22 25 38 24 50 26 " +
    "C 62 24 78 25 92 30 " +
    "C 78 33 62 35 50 35 " +
    "C 38 35 22 33 8 30 Z",

  lowerLipPath:
    "M 8 30 " +
    "C 24 31 40 31 50 31 " +
    "C 60 31 76 31 92 30 " +
    "C 82 39 66 44 50 44 " +
    "C 34 44 18 39 8 30 Z",

  interiorPath:
    "M 14 30 " + "C 20 24 80 24 86 30 " + "C 84 38 68 44 50 44 " + "C 32 44 16 38 14 30 Z",

  teethPath: "M 20 28 " + "C 34 26 66 26 80 28 " + "L 80 35 " + "C 66 37 34 37 20 35 Z",

  tonguePath: "M 28 38 " + "C 34 34 66 34 72 38 " + "C 69 44 31 44 28 38 Z",

  openScale: 1.0,
  wideScale: 1.18,
  roundScale: 0.82,
  smileScale: 1.15,
};

// ─── Round Puppet ─────────────────────────────────────────────────────────────
// Best for characters where O/U/WQ shapes need to read clearly.
const roundPuppet: RigStyle = {
  id: "roundPuppet",
  label: "Round Puppet",

  upperLipPath:
    "M 20 30 " +
    "C 30 24 40 23 50 26 " +
    "C 60 23 70 24 80 30 " +
    "C 70 34 60 36 50 36 " +
    "C 40 36 30 34 20 30 Z",

  lowerLipPath:
    "M 20 30 " +
    "C 30 31 42 32 50 32 " +
    "C 58 32 70 31 80 30 " +
    "C 74 42 62 48 50 48 " +
    "C 38 48 26 42 20 30 Z",

  interiorPath:
    "M 27 30 " + "C 28 22 72 22 73 30 " + "C 73 43 63 50 50 50 " + "C 37 50 27 43 27 30 Z",

  teethPath: "M 32 28 " + "C 40 26 60 26 68 28 " + "L 68 34 " + "C 60 36 40 36 32 34 Z",

  tonguePath: "M 36 40 " + "C 40 36 60 36 64 40 " + "C 62 46 38 46 36 40 Z",

  openScale: 1.05,
  wideScale: 0.92,
  roundScale: 1.22,
  smileScale: 0.85,
};

export const RIG_STYLES: RigStyle[] = [
  softCartoon,
  tinyCute,
  bigExpressive,
  simpleLine,
  wideSmile,
  roundPuppet,
];

// ─── Pose → transforms ────────────────────────────────────────────────────────
// Converts semantic pose values into SVG-unit transforms.
// These transform values should be applied through GSAP timelines.
// Do not use CSS transitions for lip sync, and do not animate SVG d paths.
export function poseToTransforms(
  pose: MouthPose,
  style: RigStyle,
  options?: { upperCurve?: number; lowerCurve?: number },
): RigTransforms {
  const os = style.openScale;
  const ws = style.wideScale;
  const rs = style.roundScale;
  const ss = style.smileScale;

  const open = Math.max(0, pose.open);
  const closedPress = Math.min(0, pose.open);

  // Wide and round fight each other.
  // Round gets a stronger narrowing effect so O/U/WQ read clearly.
  const baseScaleX = 1 + pose.wide * 0.34 * ws - pose.round * 0.38 * rs;

  const lipScaleX = Math.max(0.38, baseScaleX);

  // Upper lip moves, but less than the lower jaw.
  // Too much upper movement makes the whole mouth look like it floats.
  const upperY = -open * 5.5 * os - pose.smile * 2.5 * ss + closedPress * 3;

  // Lower lip carries most jaw action.
  // FV pulls the lower lip upward toward the teeth.
  const lowerY = open * 15.5 * os - pose.fvBite * 8 + closedPress * 2;

  // Interior:
  // - Rest has a tiny visible slit.
  // - Open expands vertically.
  // - Round narrows horizontally and slightly increases verticality.
  const interiorScaleX = Math.max(0.28, lipScaleX * (1 - pose.round * 0.24 * rs));

  const interiorScaleY = Math.max(0.04, 0.08 + open * 1.95 * os + pose.round * 0.28 * rs);

  const interiorOpacity = open > 0.025 ? 1 : pose.open < 0 ? 0 : 0.55;

  // Teeth should appear late/subtly, not constantly.
  // This prevents creepy flashing teeth during fast lip sync.
  const teethOpacity = pose.teeth <= 0 ? 0 : open < 0.08 && pose.smile < 0.5 ? 0 : pose.teeth;

  const teethY = upperY * 0.55 + pose.fvBite * 1.5;

  const teethScaleX = Math.max(0.45, lipScaleX * (1 - pose.round * 0.25));

  // Tongue is mostly for A/L, and should sit low in the mouth.
  const tongueOpacity = pose.tongue <= 0 ? 0 : open < 0.25 ? pose.tongue * 0.35 : pose.tongue;

  const tongueY = lowerY * 0.45 + open * 2.5;

  const tongueScaleX = Math.max(0.45, lipScaleX * (1 - pose.round * 0.15));

  const tongueScaleY = Math.max(0.55, 1 + open * 0.15 - pose.round * 0.25);

  // User style controls.
  // These are rig-level art controls, not per-viseme controls.
  const upperScaleY = Math.max(0.25, 1 + (options?.upperCurve ?? 0) * 0.45);

  const lowerScaleY = Math.max(0.25, 1 + (options?.lowerCurve ?? 0) * 0.45);

  return {
    upperLip: {
      y: upperY,
      scaleX: lipScaleX,
      scaleY: upperScaleY,
    },

    lowerLip: {
      y: lowerY,
      scaleX: lipScaleX,
      scaleY: lowerScaleY,
    },

    interior: {
      scaleX: interiorScaleX,
      scaleY: interiorScaleY,
      opacity: interiorOpacity,
    },

    teeth: {
      opacity: teethOpacity,
      y: teethY,
      scaleX: teethScaleX,
    },

    tongue: {
      opacity: tongueOpacity,
      y: tongueY,
      scaleX: tongueScaleX,
      scaleY: tongueScaleY,
    },
  };
}

// ─── Default rig factory ──────────────────────────────────────────────────────
export function createDefaultMouthRig(
  styleId = "softCartoon",
  placement = { x: 210, y: 310, width: 180, height: 108, zIndex: 60 },
): MouthRig {
  return {
    styleId,
    lipColor: DEFAULT_LIP_COLOR,
    teethColor: DEFAULT_TEETH_COLOR,
    tongueColor: DEFAULT_TONGUE_COLOR,
    interiorColor: DEFAULT_INTERIOR_COLOR,

    widthScale: 1.0,
    upperCurve: 0,
    lowerCurve: 0,

    placement,

    poses: { ...VISEME_POSES },
  };
}
