import type { MouthPose, MouthRig, MouthViseme } from "../types";

// ─── ViewBox ─────────────────────────────────────────────────────────────────
// All rig component paths are designed in this coordinate space.
export const MOUTH_VIEWBOX = "0 0 100 60";

// ─── Default colours ─────────────────────────────────────────────────────────
export const DEFAULT_LIP_COLOR = "#b05a6a";
export const DEFAULT_TEETH_COLOR = "#f0ede8";
export const DEFAULT_TONGUE_COLOR = "#c9566a";
export const DEFAULT_INTERIOR_COLOR = "#1a0808";

// ─── Preston Blair viseme poses ───────────────────────────────────────────────
// Values tuned to match the standard Papagayo / Preston Blair mouth chart.
export const VISEME_POSES: Record<MouthViseme, MouthPose> = {
  rest:  { open: 0,    wide: 0,    round: 0,   smile: 0,   teeth: 0,   tongue: 0,   fvBite: 0 },
  MBP:   { open: -0.1, wide: 0,    round: 0,   smile: 0,   teeth: 0,   tongue: 0,   fvBite: 0 },
  A:     { open: 1,    wide: 0.3,  round: 0,   smile: 0,   teeth: 0.8, tongue: 0.5, fvBite: 0 },
  E:     { open: 0.15, wide: 1,    round: 0,   smile: 0.4, teeth: 0.9, tongue: 0,   fvBite: 0 },
  O:     { open: 0.6,  wide: -0.2, round: 0.7, smile: 0,   teeth: 0,   tongue: 0,   fvBite: 0 },
  U:     { open: 0.3,  wide: -0.4, round: 0.9, smile: 0,   teeth: 0,   tongue: 0,   fvBite: 0 },
  WQ:    { open: 0.1,  wide: -0.5, round: 1,   smile: 0,   teeth: 0,   tongue: 0,   fvBite: 0 },
  FV:    { open: 0.1,  wide: 0.1,  round: 0,   smile: 0,   teeth: 0.8, tongue: 0,   fvBite: 1 },
  L:     { open: 0.5,  wide: 0.1,  round: 0,   smile: 0.1, teeth: 0.3, tongue: 1,   fvBite: 0 },
  Smile: { open: 0,    wide: 0.8,  round: 0,   smile: 1,   teeth: 0.5, tongue: 0,   fvBite: 0 },
};

// ─── Transforms ───────────────────────────────────────────────────────────────
// All values in SVG user units (viewBox 0 0 100 60).
// The timeline builder multiplies by (placement.height / 60) to get CSS pixels.

export interface RigTransforms {
  upperLip: { y: number; scaleX: number; scaleY: number };
  lowerLip: { y: number; scaleX: number; scaleY: number };
  interior:  { scaleX: number; scaleY: number; opacity: number };
  teeth:     { opacity: number; y: number };
  tongue:    { opacity: number; y: number };
}

// ─── Style definitions ────────────────────────────────────────────────────────
export interface RigStyle {
  id: string;
  label: string;
  // Component paths at rest, in viewBox 0 0 100 60.
  // Upper lip: cupid's bow — corners at (18,30)/(82,30), bow peak at (50,25).
  upperLipPath: string;
  // Lower lip: fuller arch — corners at (18,30)/(82,30), fullness at (50,38).
  lowerLipPath: string;
  // Interior cavity (dark): flat ellipse that scaleY-expands with opening.
  interiorPath: string;
  // Teeth strip: thin rectangle across the opening.
  teethPath: string;
  // Tongue: rounded oval below the opening.
  tonguePath: string;
  // Scale factors — controls how expressively each style reacts to pose params.
  openScale:  number;
  wideScale:  number;
  roundScale: number;
  smileScale: number;
}

// ─── Natural style ────────────────────────────────────────────────────────────
// Realistic proportions following Preston Blair's construction:
//   Upper lip: cupid's bow with philtrum dip, thin body
//   Lower lip: fuller, rounded, slightly wider than upper
const natural: RigStyle = {
  id: "natural",
  label: "Natural",

  // Upper lip: cupid's bow top edge, thin lip body
  // Left corner (18,30) → left peak (37,25) → philtrum dip (50,27) →
  // right peak (63,25) → right corner (82,30) → inner edge back to start
  upperLipPath:
    "M 18 30 C 26 27 33 24 37 25 C 42 26 47 27 50 27" +
    " C 53 27 58 26 63 25 C 67 24 74 27 82 30" +
    " C 70 32 55 33 50 33 C 45 33 30 32 18 30 Z",

  // Lower lip: single fuller arch
  // Left corner (18,30) → flat top → right corner (82,30) → bottom fullness (50,40)
  lowerLipPath:
    "M 18 30 C 30 30 45 30 50 30 C 55 30 70 30 82 30" +
    " C 74 37 60 41 50 41 C 40 41 26 37 18 30 Z",

  // Interior: thin dark ellipse centred at mouth line, expands vertically
  interiorPath:
    "M 22 30 C 35 28 65 28 78 30 C 65 32 35 32 22 30 Z",

  // Teeth: flat strip just inside upper lip
  teethPath:
    "M 30 29 C 40 28 60 28 70 29 L 70 33 C 60 34 40 34 30 33 Z",

  // Tongue: rounded oval sitting in lower opening
  tonguePath:
    "M 35 34 C 35 32 65 32 65 34 C 65 40 35 40 35 34 Z",

  openScale:  1.0,
  wideScale:  1.0,
  roundScale: 1.0,
  smileScale: 1.0,
};

// ─── Wide style ───────────────────────────────────────────────────────────────
const wide: RigStyle = {
  id: "wide",
  label: "Wide",
  upperLipPath:
    "M 10 30 C 20 27 29 23 34 24 C 40 25 46 27 50 27" +
    " C 54 27 60 25 66 24 C 71 23 80 27 90 30" +
    " C 76 32 56 33 50 33 C 44 33 24 32 10 30 Z",
  lowerLipPath:
    "M 10 30 C 24 30 42 30 50 30 C 58 30 76 30 90 30" +
    " C 80 38 64 43 50 43 C 36 43 20 38 10 30 Z",
  interiorPath:
    "M 14 30 C 30 27 70 27 86 30 C 70 33 30 33 14 30 Z",
  teethPath:
    "M 22 29 C 36 27 64 27 78 29 L 78 33 C 64 35 36 35 22 33 Z",
  tonguePath:
    "M 30 34 C 30 31 70 31 70 34 C 70 41 30 41 30 34 Z",
  openScale:  1.1,
  wideScale:  1.1,
  roundScale: 0.8,
  smileScale: 1.1,
};

// ─── Petite style ─────────────────────────────────────────────────────────────
const petite: RigStyle = {
  id: "petite",
  label: "Petite",
  upperLipPath:
    "M 24 30 C 31 27 37 24 42 25 C 46 26 48 27 50 27" +
    " C 52 27 54 26 58 25 C 63 24 69 27 76 30" +
    " C 66 32 56 33 50 33 C 44 33 34 32 24 30 Z",
  lowerLipPath:
    "M 24 30 C 34 30 44 30 50 30 C 56 30 66 30 76 30" +
    " C 68 36 58 39 50 39 C 42 39 32 36 24 30 Z",
  interiorPath:
    "M 28 30 C 38 28 62 28 72 30 C 62 32 38 32 28 30 Z",
  teethPath:
    "M 34 29 C 42 28 58 28 66 29 L 66 33 C 58 34 42 34 34 33 Z",
  tonguePath:
    "M 38 34 C 38 32 62 32 62 34 C 62 39 38 39 38 34 Z",
  openScale:  0.85,
  wideScale:  0.85,
  roundScale: 1.1,
  smileScale: 0.9,
};

// ─── Cartoon style ────────────────────────────────────────────────────────────
// Exaggerated — bigger opening, more pronounced bow, wider lower lip
const cartoon: RigStyle = {
  id: "cartoon",
  label: "Cartoon",
  upperLipPath:
    "M 14 30 C 24 25 31 21 37 22 C 43 23 47 26 50 26" +
    " C 53 26 57 23 63 22 C 69 21 76 25 86 30" +
    " C 72 33 56 34 50 34 C 44 34 28 33 14 30 Z",
  lowerLipPath:
    "M 14 30 C 26 30 42 30 50 30 C 58 30 74 30 86 30" +
    " C 76 39 62 45 50 45 C 38 45 24 39 14 30 Z",
  interiorPath:
    "M 18 30 C 32 27 68 27 82 30 C 68 33 32 33 18 30 Z",
  teethPath:
    "M 24 28 C 37 26 63 26 76 28 L 76 33 C 63 35 37 35 24 33 Z",
  tonguePath:
    "M 30 34 C 30 31 70 31 70 34 C 70 42 30 42 30 34 Z",
  openScale:  1.3,
  wideScale:  1.2,
  roundScale: 0.9,
  smileScale: 1.3,
};

// ─── Straight style ───────────────────────────────────────────────────────────
// No cupid's bow — single smooth arch on the upper lip.
// Works for adult male, neutral, or stylised characters.
const straight: RigStyle = {
  id: "straight",
  label: "Straight",
  // Upper lip: single arch, no double peak, no philtrum dip.
  // Left corner (18,30) → uniform arch peaking at (50,26) → right corner (82,30)
  upperLipPath:
    "M 18 30 C 32 25 68 25 82 30" +
    " C 70 32 55 33 50 33 C 45 33 30 32 18 30 Z",
  lowerLipPath:
    "M 18 30 C 30 30 45 30 50 30 C 55 30 70 30 82 30" +
    " C 74 37 60 41 50 41 C 40 41 26 37 18 30 Z",
  interiorPath:
    "M 22 30 C 35 28 65 28 78 30 C 65 32 35 32 22 30 Z",
  teethPath:
    "M 30 29 C 40 28 60 28 70 29 L 70 33 C 60 34 40 34 30 33 Z",
  tonguePath:
    "M 35 34 C 35 32 65 32 65 34 C 65 40 35 40 35 34 Z",
  openScale:  1.0,
  wideScale:  1.0,
  roundScale: 0.95,
  smileScale: 0.9,
};

// ─── Broad style ──────────────────────────────────────────────────────────────
// Wide, thick, straight upper lip — suited to strong masculine or cartoon male.
// Corners extend to (12,30)/(88,30); both lips are fuller than Natural.
const broad: RigStyle = {
  id: "broad",
  label: "Broad",
  upperLipPath:
    "M 12 30 C 28 25 72 25 88 30" +
    " C 74 33 56 34 50 34 C 44 34 26 33 12 30 Z",
  lowerLipPath:
    "M 12 30 C 26 30 44 30 50 30 C 56 30 74 30 88 30" +
    " C 78 39 62 44 50 44 C 38 44 22 39 12 30 Z",
  interiorPath:
    "M 16 30 C 30 27 70 27 84 30 C 70 33 30 33 16 30 Z",
  teethPath:
    "M 22 29 C 36 27 64 27 78 29 L 78 33 C 64 35 36 35 22 33 Z",
  tonguePath:
    "M 28 34 C 28 31 72 31 72 34 C 72 42 28 42 28 34 Z",
  openScale:  1.1,
  wideScale:  1.15,
  roundScale: 0.8,
  smileScale: 0.95,
};

export const RIG_STYLES: RigStyle[] = [natural, straight, wide, broad, petite, cartoon];

// ─── Pose → transforms ────────────────────────────────────────────────────────
// Returns SVG-unit offsets. Timeline builder converts to CSS px using placement size.
// curve options are rig-level (character shape), not per-viseme.
export function poseToTransforms(
  pose: MouthPose,
  style: RigStyle,
  options?: { upperCurve?: number; lowerCurve?: number },
): RigTransforms {
  const os = style.openScale;
  const ws = style.wideScale;
  const rs = style.roundScale;
  const ss = style.smileScale;

  // Wide and round pull in opposite directions on scaleX.
  const lipScaleX = 1 + pose.wide * 0.28 * ws - pose.round * 0.28 * rs;

  // Upper lip moves up with open and smile; pressed down slightly for MBP.
  const upperY = -pose.open * 10 * os - pose.smile * 3 * ss + (pose.open < 0 ? pose.open * 2 : 0);

  // Lower lip moves down with open; rises for fvBite (lower lip toward upper teeth).
  const lowerY = pose.open * 13 * os - pose.fvBite * 7;

  // Interior scales vertically with openness, narrowed by round.
  const interiorScaleY = Math.max(0, pose.open) * 3.5 * os;
  const interiorScaleX = lipScaleX * (1 - pose.round * 0.2 * rs);
  const interiorOpacity = Math.max(0, pose.open) > 0.05 ? 1 : 0;

  // Teeth track the upper lip, appear with teeth param.
  const teethY = upperY * 0.6;

  // Tongue sits in the lower opening.
  const tongueY = lowerY * 0.4;

  // Bow curve: scaleY > 1 = more arched, < 1 = flatter.
  // Scaled from cy=30 (the lip line), which is 50% of the 60-unit viewBox.
  const upperScaleY = 1 + (options?.upperCurve ?? 0) * 0.6;
  const lowerScaleY = 1 + (options?.lowerCurve ?? 0) * 0.6;

  return {
    upperLip: { y: upperY, scaleX: lipScaleX, scaleY: Math.max(0.1, upperScaleY) },
    lowerLip: { y: lowerY, scaleX: lipScaleX, scaleY: Math.max(0.1, lowerScaleY) },
    interior: { scaleX: interiorScaleX, scaleY: interiorScaleY, opacity: interiorOpacity },
    teeth:    { opacity: pose.teeth,  y: teethY },
    tongue:   { opacity: pose.tongue, y: tongueY },
  };
}

// ─── Default rig factory ──────────────────────────────────────────────────────
export function createDefaultMouthRig(
  styleId = "natural",
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
