// Parametric "Studio Presenter" character — the seeded starter actor.
//
// This is a pure, db-free builder: it emits flat-vector SVG art and a fully rigged
// `CharacterPreset` for three angles (front + two three-quarter views). Every limb is a
// separate part with its pivot placed on its proximal joint, so the auto-rig in `rig.ts`
// derives a real FK skeleton (body → head → face, body → arm → lowerArm → hand,
// body → leg → lowerLeg → foot) without any hand-authored bones.
//
// Limb roles deliberately follow the motion vocabulary: the proximal segment is `arm`/`leg`
// (the role the built-in Wave/Point/Shrug/Jump presets drive at the shoulder/hip), and the
// distal segment is `lowerArm`/`lowerLeg`, which follows through FK. Using `upperArm`/`upperLeg`
// here would leave those presets with no matching slot, so the limbs would never move.
//
// Authoring happens in one shared 600×900 canvas coordinate space so joints line up trivially
// across parts, but each part is then cropped to a TIGHT frame and `viewBox` around its own art
// (every drawing primitive reports its bounding box, derived analytically — no rasterization).
// This makes a seeded part structurally identical to an uploaded one (tight artwork placed on the
// canvas), so the editor's selection/hit-testing is tight without relying on async alpha
// measurement. The explicit `pivot` stays in canvas space, so the rig and rendering are
// unchanged — only the part's frame/viewBox is cropped.
//
// The two 3/4 angles are produced by a parametric "turn" of the front construction
// (horizontal foreshortening + feature shift + near/far layering). They are a structural,
// editable starting point for each angle — the editor owns per-angle art refinement.
import type {
  CharacterAngle,
  CharacterPosePreset,
  CharacterPreset,
  CharacterSlotVariantPackage,
  EyeState,
  MouthViseme,
  PartRole,
} from "../types";
import { DEFAULT_PART_MANIFEST } from "../types";
import { createBlankCharacter, makePart, normalizeCharacterSlots } from "./character-utils";

export const PRESENTER_CANVAS_W = 600;
export const PRESENTER_CANVAS_H = 900;

/** Stamped onto the built character; bump whenever the generated art changes so the seeder
 * replaces an out-of-date persisted copy. */
export const PRESENTER_VERSION = 4;

export const PRESENTER_ANGLES: CharacterAngle[] = ["front", "3qL", "3qR"];

/** Body type the generator can produce. Colours stay shared; this only varies shape. */
export type PresenterVariant = "male" | "female";
export const PRESENTER_VARIANTS: PresenterVariant[] = ["male", "female"];

/** Per-variant joint layout (left-side x in canvas px; the right side mirrors about 300). */
function bodyLayout(variant: PresenterVariant) {
  if (variant === "female") {
    // Narrower shoulders and arms hanging a touch closer in; hips about the male width.
    return { shoulder: 244, elbow: 228, wrist: 224, hip: 272, knee: 266, ankle: 262, toe: 240 };
  }
  return { shoulder: 232, elbow: 214, wrist: 210, hip: 270, knee: 264, ankle: 260, toe: 236 };
}

/** turn ∈ [-1, 1]: 0 front, +1 three-quarter right (right side toward viewer), -1 mirror. */
const TURN: Record<CharacterAngle, number> = { front: 0, "3qL": -1, "3qR": 1 } as Record<
  CharacterAngle,
  number
>;

const VISEMES: MouthViseme[] = ["rest", "A", "E", "O", "U", "MBP", "FV", "L"];

type Side = "left" | "right";
interface Pt {
  x: number;
  y: number;
}

/** Tight bounding box in canvas pixels (min/max corners). */
interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A piece of SVG plus the canvas-space box it occupies, so parts can crop to their own art. */
interface Shape {
  svg: string;
  box: Box;
}

export interface PartFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

const COLOR = {
  skin: "#f2c49e",
  skinShade: "#e0a87f",
  skinLine: "#c98a63",
  hair: "#5b3b2a",
  hairShade: "#46291c",
  top: "#3f73b3",
  topShade: "#305c91",
  pants: "#3a4456",
  pantsShade: "#2c3442",
  shoe: "#2a2b30",
  white: "#ffffff",
  iris: "#3b322c",
  lip: "#c56b6b",
  mouthIn: "#6e3338",
  teeth: "#fbf3ec",
  tongue: "#d98a8a",
};

const r = (n: number) => Math.round(n);
const n2 = (n: number) => Math.round(n * 100) / 100;

// ── Bounding-box helpers ───────────────────────────────────────────────────────
const unionBoxes = (...boxes: Box[]): Box => ({
  minX: Math.min(...boxes.map((b) => b.minX)),
  minY: Math.min(...boxes.map((b) => b.minY)),
  maxX: Math.max(...boxes.map((b) => b.maxX)),
  maxY: Math.max(...boxes.map((b) => b.maxY)),
});
const padBox = (b: Box, p: number): Box => ({
  minX: b.minX - p,
  minY: b.minY - p,
  maxX: b.maxX + p,
  maxY: b.maxY + p,
});
const merge = (...shapes: Shape[]): Shape => ({
  svg: shapes.map((s) => s.svg).join(""),
  box: unionBoxes(...shapes.map((s) => s.box)),
});

/**
 * Bounding box of an SVG path's coordinates. Assumes the `d` uses only absolute M/L/C/Q commands
 * whose numbers come in x,y pairs (true for every path here). A Bézier curve lies within the
 * convex hull of its control points, so the min/max of all listed coordinates is a valid bound.
 */
function pathBounds(d: string): Box {
  const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = nums[i];
    const y = nums[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** Integer frame fully containing a box, clamped to the canvas. */
function boxToFrame(box: Box): PartFrame {
  const x = Math.max(0, Math.floor(box.minX));
  const y = Math.max(0, Math.floor(box.minY));
  const right = Math.min(PRESENTER_CANVAS_W, Math.ceil(box.maxX));
  const bottom = Math.min(PRESENTER_CANVAS_H, Math.ceil(box.maxY));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

// ── SVG primitives (each reports its canvas box) ───────────────────────────────
/** Round-capped thick stroke between two joints — a clean stylized limb capsule. */
const seg = (a: Pt, b: Pt, w: number, fill: string): Shape => ({
  svg: `<path d="M${r(a.x)} ${r(a.y)} L${r(b.x)} ${r(b.y)}" fill="none" stroke="${fill}" stroke-width="${r(w)}" stroke-linecap="round"/>`,
  box: {
    minX: Math.min(a.x, b.x) - w / 2,
    minY: Math.min(a.y, b.y) - w / 2,
    maxX: Math.max(a.x, b.x) + w / 2,
    maxY: Math.max(a.y, b.y) + w / 2,
  },
});
const dot = (c: Pt, radius: number, fill: string): Shape => ({
  svg: `<circle cx="${r(c.x)}" cy="${r(c.y)}" r="${r(radius)}" fill="${fill}"/>`,
  box: { minX: c.x - radius, minY: c.y - radius, maxX: c.x + radius, maxY: c.y + radius },
});
const ell = (c: Pt, rx: number, ry: number, fill: string): Shape => ({
  svg: `<ellipse cx="${r(c.x)}" cy="${r(c.y)}" rx="${r(rx)}" ry="${r(ry)}" fill="${fill}"/>`,
  box: { minX: c.x - rx, minY: c.y - ry, maxX: c.x + rx, maxY: c.y + ry },
});
const fillPath = (d: string, fill: string): Shape => ({
  svg: `<path d="${d}" fill="${fill}"/>`,
  box: pathBounds(d),
});
const strokePath = (d: string, w: number, stroke: string): Shape => ({
  svg: `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${r(w)}" stroke-linecap="round"/>`,
  box: padBox(pathBounds(d), w / 2),
});

// ── Turn geometry ──────────────────────────────────────────────────────────────
function isFar(side: Side, turn: number) {
  return (turn > 0 && side === "left") || (turn < 0 && side === "right");
}
function isNear(side: Side, turn: number) {
  return (turn > 0 && side === "right") || (turn < 0 && side === "left");
}

/** Foreshorten a front-view x toward the body axis; near side stays wide, far side tucks in. */
function turnedX(x: number, side: Side | "c", turn: number) {
  if (turn === 0) return x;
  const dx = x - 300;
  const k =
    side !== "c" && isFar(side, turn) ? 0.62 : side !== "c" && isNear(side, turn) ? 1.06 : 0.9;
  return 300 + dx * k + turn * 10;
}
function joint(x: number, y: number, side: Side, turn: number): Pt {
  return { x: turnedX(x, side, turn), y };
}
/** Far-side limbs are thinner (receding) and the near side a touch heavier. */
function widthScale(side: Side, turn: number) {
  return isFar(side, turn) ? 0.86 : 1;
}
/** Push the near arm/leg forward and tuck the far one behind the torso when turned. */
function zAdj(side: Side, turn: number) {
  if (turn === 0) return 0;
  return isFar(side, turn) ? -18 : 8;
}

interface FaceGeom {
  faceCx: number;
  eyeY: number;
  leftEye: Pt;
  rightEye: Pt;
  leftRx: number;
  rightRx: number;
}
function faceGeom(turn: number): FaceGeom {
  const faceCx = 300 + turn * 14;
  const eyeY = 146;
  const leftOff = turn > 0 ? 20 : turn < 0 ? 30 : 27;
  const rightOff = turn > 0 ? 30 : turn < 0 ? 20 : 27;
  const leftRx = (turn > 0 ? 0.82 : 1) * 15;
  const rightRx = (turn < 0 ? 0.82 : 1) * 15;
  return {
    faceCx,
    eyeY,
    leftEye: { x: faceCx - leftOff, y: eyeY },
    rightEye: { x: faceCx + rightOff, y: eyeY },
    leftRx,
    rightRx,
  };
}

// ── Body part art ────────────────────────────────────────────────────────────
function torso(turn: number, variant: PresenterVariant): Shape {
  const X = (x: number) => r(turnedX(x, "c", turn));
  // The neck belongs to the body (drawn behind the shirt) so the head pivots on top of it for
  // clean head turns. It reads through the shirt's neckline; the head covers its top. The shirt
  // sits high (a crew neck) so only a short stretch of neck shows below the chin.
  const neckCx = 300 + turn * 12;
  const neck = `M${r(neckCx - 18)} 230 L${r(neckCx - 16)} 272 L${r(neckCx + 16)} 272 L${r(neckCx + 18)} 230Z`;
  const body =
    variant === "female"
      ? // Narrower shoulders tapering through a gentle waist to a soft rounded hem.
        `M${X(256)} 262 C${X(242)} 266 ${X(230)} 304 ${X(232)} 360 ` +
        `C${X(238)} 432 ${X(248)} 498 ${X(300)} 516 ` +
        `C${X(352)} 498 ${X(362)} 432 ${X(368)} 360 ` +
        `C${X(370)} 304 ${X(358)} 266 ${X(344)} 262 Q${X(300)} 270 ${X(256)} 262Z`
      : `M${X(250)} 262 C${X(232)} 266 ${X(214)} 306 ${X(214)} 364 ` +
        `L${X(224)} 520 Q${X(300)} 558 ${X(376)} 520 L${X(386)} 364 ` +
        `C${X(386)} 306 ${X(368)} 266 ${X(350)} 262 Q${X(300)} 270 ${X(250)} 262Z`;
  const collar = `M${X(262)} 263 Q${X(300)} 278 ${X(338)} 263 Q${X(300)} 270 ${X(262)} 263Z`;
  return merge(
    fillPath(neck, COLOR.skin),
    fillPath(body, COLOR.top),
    fillPath(collar, COLOR.topShade),
  );
}

function head(turn: number): Shape {
  const cx = 300 + turn * 12;
  const shapes: Shape[] = [ell({ x: cx, y: 150 }, 78, 92, COLOR.skin)];
  // Ears: both on front, only the near ear when turned.
  if (!isFar("left", turn)) shapes.push(ell({ x: cx - 76, y: 156 }, 11, 16, COLOR.skinShade));
  if (!isFar("right", turn)) shapes.push(ell({ x: cx + 76, y: 156 }, 11, 16, COLOR.skinShade));
  return merge(...shapes);
}

function hair(turn: number, variant: PresenterVariant): Shape {
  return variant === "female" ? hairFemale(turn) : hairMale(turn);
}

function hairMale(turn: number): Shape {
  const cx = 300 + turn * 12;
  // A short, styled male cut: volume on top with a slight off-centre quiff, tapering down the
  // sides to the temples, and a clean forehead hairline swept gently to one side. The fringe
  // sits above the brows; a small shade under the front edge adds depth (kept subtle).
  const main =
    `M${r(cx - 78)} 152 ` +
    `C${r(cx - 84)} 98 ${r(cx - 74)} 52 ${r(cx - 36)} 46 ` +
    `C${r(cx - 10)} 41 ${r(cx + 22)} 42 ${r(cx + 48)} 52 ` +
    `C${r(cx + 74)} 62 ${r(cx + 84)} 102 ${r(cx + 78)} 152 ` +
    `C${r(cx + 62)} 124 ${r(cx + 42)} 115 ${r(cx + 20)} 117 ` +
    `C${r(cx + 4)} 118 ${r(cx - 6)} 109 ${r(cx - 22)} 111 ` +
    `C${r(cx - 44)} 113 ${r(cx - 62)} 121 ${r(cx - 78)} 152Z`;
  const shade =
    `M${r(cx - 22)} 111 C${r(cx - 6)} 109 ${r(cx + 4)} 118 ${r(cx + 20)} 117 ` +
    `C${r(cx + 8)} 124 ${r(cx - 8)} 124 ${r(cx - 22)} 119Z`;
  return merge(fillPath(main, COLOR.hair), fillPath(shade, COLOR.hairShade));
}

function hairFemale(turn: number): Shape {
  const cx = 300 + turn * 12;
  // Long hair: over the crown, framing the face, and draping down both sides to shoulder level.
  // The outer silhouette runs left-up, over the top, and right-down; the inner edge comes back up
  // to the forehead hairline (leaving the face open) and down the other side.
  const main =
    `M${r(cx - 88)} 332 ` +
    `C${r(cx - 100)} 214 ${r(cx - 96)} 98 ${r(cx - 66)} 64 ` +
    `C${r(cx - 38)} 38 ${r(cx + 38)} 38 ${r(cx + 66)} 64 ` +
    `C${r(cx + 96)} 98 ${r(cx + 100)} 214 ${r(cx + 88)} 332 ` +
    `C${r(cx + 78)} 256 ${r(cx + 70)} 156 ${r(cx + 60)} 134 ` +
    `C${r(cx + 50)} 118 ${r(cx + 28)} 112 ${r(cx + 10)} 114 ` +
    `C${r(cx - 8)} 116 ${r(cx - 30)} 110 ${r(cx - 50)} 120 ` +
    `C${r(cx - 60)} 150 ${r(cx - 74)} 250 ${r(cx - 88)} 332Z`;
  return fillPath(main, COLOR.hair);
}

/** One eye's center + radius for the active turn — eyes/brows are per-side so each gets a bone. */
function eyeGeom(turn: number, side: Side): { c: Pt; rx: number } {
  const g = faceGeom(turn);
  return side === "left" ? { c: g.leftEye, rx: g.leftRx } : { c: g.rightEye, rx: g.rightRx };
}

function eyeOpen(turn: number, side: Side): Shape {
  const { c, rx } = eyeGeom(turn, side);
  return merge(
    ell(c, rx, rx * 0.72, COLOR.white),
    dot({ x: c.x + turn * 2, y: c.y + 1 }, rx * 0.46, COLOR.iris),
    dot({ x: c.x + turn * 2 - rx * 0.16, y: c.y - rx * 0.2 }, rx * 0.14, COLOR.white),
  );
}

function eyeClosed(turn: number, side: Side): Shape {
  const { c, rx } = eyeGeom(turn, side);
  return strokePath(
    `M${r(c.x - rx)} ${r(c.y)} Q${r(c.x)} ${r(c.y + rx * 0.7)} ${r(c.x + rx)} ${r(c.y)}`,
    4,
    COLOR.skinLine,
  );
}

function browY(turn: number, raised: boolean) {
  return faceGeom(turn).eyeY - (raised ? 30 : 21);
}

function brow(turn: number, side: Side, raised: boolean): Shape {
  const { c, rx } = eyeGeom(turn, side);
  const y = browY(turn, raised);
  return strokePath(
    `M${r(c.x - rx - 3)} ${r(y + 3)} Q${r(c.x)} ${r(y - 4)} ${r(c.x + rx + 3)} ${r(y + 2)}`,
    7,
    COLOR.hairShade,
  );
}

function nose(turn: number): Shape {
  const faceCx = 300 + turn * 14;
  const tipX = faceCx + turn * 5;
  const y = 176;
  return strokePath(
    `M${r(faceCx)} ${r(y - 14)} Q${r(tipX + 4)} ${r(y)} ${r(tipX)} ${r(y + 6)} Q${r(tipX - 6)} ${r(y + 9)} ${r(faceCx - 6)} ${r(y + 5)}`,
    5,
    COLOR.skinShade,
  );
}

/** Mouth viseme shapes authored around a local origin, then placed at the face center. */
const MOUTH_SHAPES: Record<MouthViseme, string> = {
  rest: `<path d="M-26 -2 Q0 10 26 -2" fill="none" stroke="${COLOR.lip}" stroke-width="7" stroke-linecap="round"/>`,
  A: `<ellipse cx="0" cy="2" rx="22" ry="24" fill="${COLOR.mouthIn}"/><ellipse cx="0" cy="13" rx="12" ry="7" fill="${COLOR.tongue}"/>`,
  E: `<path d="M-28 -4 Q0 18 28 -4 Q0 24 -28 -4Z" fill="${COLOR.mouthIn}"/><rect x="-22" y="-4" width="44" height="8" rx="3" fill="${COLOR.teeth}"/>`,
  O: `<ellipse cx="0" cy="0" rx="16" ry="20" fill="${COLOR.mouthIn}"/>`,
  U: `<ellipse cx="0" cy="0" rx="13" ry="15" fill="${COLOR.mouthIn}"/>`,
  MBP: `<path d="M-26 0 Q0 7 26 0" fill="none" stroke="${COLOR.lip}" stroke-width="8" stroke-linecap="round"/>`,
  FV: `<path d="M-26 -2 Q0 14 26 -2 Q0 18 -26 -2Z" fill="${COLOR.mouthIn}"/><rect x="-22" y="-2" width="44" height="7" rx="3" fill="${COLOR.teeth}"/>`,
  L: `<path d="M-22 -2 Q0 18 22 -2 L22 8 Q0 20 -22 8Z" fill="${COLOR.mouthIn}"/><path d="M-8 7 Q0 -3 8 7" fill="none" stroke="${COLOR.tongue}" stroke-width="8" stroke-linecap="round"/>`,
  WQ: `<ellipse cx="0" cy="0" rx="11" ry="13" fill="${COLOR.mouthIn}"/>`,
  Smile: `<path d="M-26 -4 Q0 16 26 -4" fill="none" stroke="${COLOR.lip}" stroke-width="7" stroke-linecap="round"/>`,
};
// Generous local extent covering every viseme shape (incl. strokes), placed at the face center.
const MOUTH_LOCAL: Box = { minX: -32, minY: -26, maxX: 32, maxY: 28 };
function mouth(turn: number, viseme: MouthViseme): Shape {
  const faceCx = 300 + turn * 14;
  const my = 200;
  const sx = n2(1 - 0.12 * Math.abs(turn));
  return {
    svg: `<g transform="translate(${r(faceCx)} ${my}) scale(${sx} 1)">${MOUTH_SHAPES[viseme]}</g>`,
    box: {
      minX: faceCx + MOUTH_LOCAL.minX * sx,
      maxX: faceCx + MOUTH_LOCAL.maxX * sx,
      minY: my + MOUTH_LOCAL.minY,
      maxY: my + MOUTH_LOCAL.maxY,
    },
  };
}

function armUpper(a: Pt, b: Pt, side: Side, turn: number): Shape {
  return seg(a, b, 32 * widthScale(side, turn), COLOR.top);
}
function armLower(a: Pt, b: Pt, side: Side, turn: number): Shape {
  return seg(a, b, 24 * widthScale(side, turn), COLOR.skin);
}
/** Open hand: palm + four fanned fingers pointing down (the arm hangs), plus a thumb. */
function handOpen(wrist: Pt, side: Side, turn: number): Shape {
  const ws = widthScale(side, turn);
  const finger = (dxBase: number, dxTip: number, len: number) =>
    seg(
      { x: wrist.x + dxBase * ws, y: wrist.y + 3 * ws },
      { x: wrist.x + dxTip * ws, y: wrist.y + len * ws },
      5 * ws,
      COLOR.skin,
    );
  const thumbX = side === "left" ? -12 : 12;
  return merge(
    dot(wrist, 11 * ws, COLOR.skin),
    seg(wrist, { x: wrist.x + thumbX * ws, y: wrist.y - 3 * ws }, 6 * ws, COLOR.skin),
    finger(-6, -9, 15),
    finger(-2, -3, 18),
    finger(2, 3, 18),
    finger(6, 9, 15),
  );
}
/** Closed hand: a compact rounded fist with a knuckle crease and a thumb curled across. */
function handClosed(wrist: Pt, side: Side, turn: number): Shape {
  const ws = widthScale(side, turn);
  const knuckles = `M${r(wrist.x - 12 * ws)} ${r(wrist.y - 3 * ws)} L${r(wrist.x + 12 * ws)} ${r(wrist.y - 3 * ws)}`;
  const thumbX = side === "left" ? -11 : 11;
  return merge(
    dot(wrist, 14 * ws, COLOR.skin),
    strokePath(knuckles, 3, COLOR.skinLine),
    seg(wrist, { x: wrist.x + thumbX * ws, y: wrist.y + 6 * ws }, 6 * ws, COLOR.skin),
  );
}
function legUpper(a: Pt, b: Pt, side: Side, turn: number): Shape {
  return seg(a, b, 46 * widthScale(side, turn), COLOR.pants);
}
function legLower(a: Pt, b: Pt, side: Side, turn: number): Shape {
  return seg(a, b, 34 * widthScale(side, turn), COLOR.pants);
}
function foot(ankle: Pt, toe: Pt, side: Side, turn: number): Shape {
  const ws = widthScale(side, turn);
  return merge(seg(ankle, toe, 22 * ws, COLOR.shoe), ell(toe, 14 * ws, 8 * ws, COLOR.shoe));
}

// ── Part specs ───────────────────────────────────────────────────────────────
export interface PresenterPartSpec {
  key: string;
  angle: CharacterAngle;
  role: PartRole;
  side?: Side;
  name: string;
  zIndex: number;
  pivot: Pt;
  svg: string;
  /** Tight frame (canvas px) cropping this part to its own art. */
  frame: PartFrame;
  viseme?: MouthViseme;
  eyeState?: EyeState;
  pose?: string;
}

type PartBase = Omit<PresenterPartSpec, "angle" | "svg" | "frame">;

const key = (angle: CharacterAngle, name: string) => `${angle}:${name}`;

function partsForAngle(
  angle: CharacterAngle,
  turn: number,
  variant: PresenterVariant,
): PresenterPartSpec[] {
  const sides: Side[] = ["left", "right"];
  const out: PresenterPartSpec[] = [];
  const make = (base: PartBase, shape: Shape) =>
    out.push({ ...base, angle, svg: shape.svg, frame: boxToFrame(shape.box) });

  // Joints (turned per angle). Left-side x's come from the variant layout; right mirrors about 300.
  const L = bodyLayout(variant);
  const at = (leftX: number, y: number) => (s: Side) =>
    joint(s === "left" ? leftX : 600 - leftX, y, s, turn);
  const shoulder = at(L.shoulder, 292);
  const elbow = at(L.elbow, 414);
  const wrist = at(L.wrist, 528);
  const hip = at(L.hip, 532);
  const knee = at(L.knee, 700);
  const ankle = at(L.ankle, 832);
  const toe = at(L.toe, 856);

  // Torso.
  make(
    {
      key: key(angle, "body"),
      role: "body",
      name: "Torso",
      zIndex: 40,
      pivot: { x: turnedX(300, "c", turn), y: 470 },
    },
    torso(turn, variant),
  );

  // Legs (behind torso).
  for (const s of sides) {
    const z = (base: number) => base + zAdj(s, turn);
    make(
      {
        key: key(angle, `leg-${s}`),
        role: "leg",
        side: s,
        name: `Thigh ${s}`,
        zIndex: z(30),
        pivot: hip(s),
      },
      legUpper(hip(s), knee(s), s, turn),
    );
    make(
      {
        key: key(angle, `lowerLeg-${s}`),
        role: "lowerLeg",
        side: s,
        name: `Lower leg ${s}`,
        zIndex: z(29),
        pivot: knee(s),
      },
      legLower(knee(s), ankle(s), s, turn),
    );
    make(
      {
        key: key(angle, `foot-${s}`),
        role: "foot",
        side: s,
        name: `Foot ${s}`,
        zIndex: z(28),
        pivot: ankle(s),
      },
      foot(ankle(s), toe(s), s, turn),
    );
  }

  // Arms, all above the torso. The lower arm sits BEHIND the upper arm so the sleeve reads over
  // the forearm at the elbow; hands stay above the lower arm. (Far arm still tucks behind the
  // torso when turned.)
  for (const s of sides) {
    const z = (base: number) => base + zAdj(s, turn);
    make(
      {
        key: key(angle, `lowerArm-${s}`),
        role: "lowerArm",
        side: s,
        name: `Lower arm ${s}`,
        zIndex: z(48),
        pivot: elbow(s),
      },
      armLower(elbow(s), wrist(s), s, turn),
    );
    make(
      {
        key: key(angle, `arm-${s}`),
        role: "arm",
        side: s,
        name: `Upper arm ${s}`,
        zIndex: z(50),
        pivot: shoulder(s),
      },
      armUpper(shoulder(s), elbow(s), s, turn),
    );
    make(
      {
        key: key(angle, `hand-${s}-open`),
        role: "hand",
        side: s,
        pose: "open",
        name: `Hand ${s} — open`,
        zIndex: z(56),
        pivot: wrist(s),
      },
      handOpen(wrist(s), s, turn),
    );
    make(
      {
        key: key(angle, `hand-${s}-closed`),
        role: "hand",
        side: s,
        pose: "closed",
        name: `Hand ${s} — closed`,
        zIndex: z(56),
        pivot: wrist(s),
      },
      handClosed(wrist(s), s, turn),
    );
  }

  // Head + hair.
  make(
    {
      key: key(angle, "head"),
      role: "head",
      name: "Head",
      zIndex: 70,
      pivot: { x: 300 + turn * 12, y: 238 },
    },
    head(turn),
  );
  make(
    {
      key: key(angle, "hair"),
      role: "hair",
      name: "Hair",
      zIndex: 74,
      pivot: { x: 300 + turn * 12, y: 110 },
    },
    hair(turn, variant),
  );

  // Face features. Eyes and brows are per-side so each lands its own bone over its eye.
  const g = faceGeom(turn);
  for (const s of sides) {
    const eye = eyeGeom(turn, s);
    make(
      {
        key: key(angle, `eye-${s}-open`),
        role: "eye",
        side: s,
        eyeState: "open",
        name: `Eye ${s} open`,
        zIndex: 84,
        pivot: eye.c,
      },
      eyeOpen(turn, s),
    );
    make(
      {
        key: key(angle, `eye-${s}-closed`),
        role: "eye",
        side: s,
        eyeState: "closed",
        name: `Eye ${s} closed`,
        zIndex: 84,
        pivot: eye.c,
      },
      eyeClosed(turn, s),
    );
    make(
      {
        key: key(angle, `brow-${s}-neutral`),
        role: "eyebrow",
        side: s,
        pose: "neutral",
        name: `Brow ${s} neutral`,
        zIndex: 86,
        pivot: { x: eye.c.x, y: browY(turn, false) },
      },
      brow(turn, s, false),
    );
    make(
      {
        key: key(angle, `brow-${s}-raised`),
        role: "eyebrow",
        side: s,
        pose: "raised",
        name: `Brow ${s} raised`,
        zIndex: 86,
        pivot: { x: eye.c.x, y: browY(turn, true) },
      },
      brow(turn, s, true),
    );
  }
  make(
    {
      key: key(angle, "nose"),
      role: "nose",
      name: "Nose",
      zIndex: 80,
      pivot: { x: g.faceCx, y: 176 },
    },
    nose(turn),
  );
  for (const v of VISEMES) {
    make(
      {
        key: key(angle, `mouth-${v}`),
        role: "mouth",
        viseme: v,
        name: `Mouth ${v}`,
        zIndex: 82,
        pivot: { x: g.faceCx, y: 200 },
      },
      mouth(turn, v),
    );
  }

  return out;
}

/** All part specs across every angle, in draw order within each angle. */
export function presenterPartSpecs(variant: PresenterVariant = "male"): PresenterPartSpec[] {
  return PRESENTER_ANGLES.flatMap((angle) => partsForAngle(angle, TURN[angle], variant));
}

/** Wrap a part's inner SVG body in a document cropped to the part's tight frame. */
export function presenterPartSvg(svgBody: string, frame: PartFrame): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="${frame.x} ${frame.y} ${frame.width} ${frame.height}">${svgBody}</svg>`;
}

const POSE_PRESETS: CharacterPosePreset[] = [
  {
    id: "pose:relaxed",
    name: "Relaxed",
    poses: {
      "slot:left-eyebrow": "neutral",
      "slot:right-eyebrow": "neutral",
      "slot:left-hand": "open",
      "slot:right-hand": "open",
    },
  },
  {
    id: "pose:confident",
    name: "Confident",
    poses: {
      "slot:left-eyebrow": "neutral",
      "slot:right-eyebrow": "neutral",
      "slot:left-hand": "closed",
      "slot:right-hand": "closed",
    },
  },
  {
    id: "pose:surprised",
    name: "Surprised",
    poses: {
      "slot:left-eyebrow": "raised",
      "slot:right-eyebrow": "raised",
      "slot:left-hand": "open",
      "slot:right-hand": "open",
    },
  },
];

/** AI-readable variant metadata for the poseable variants (consumed by AI context export). */
const VARIANT_PACKAGES: CharacterSlotVariantPackage[] = [
  {
    id: "vp:brows-neutral",
    slotId: "slot:left-eyebrow",
    key: "neutral",
    displayName: "Neutral brows",
    aiMetadata: {
      plainDescription: "Eyebrows resting at their natural height — calm and conversational.",
      tags: ["brows", "neutral", "calm"],
      goodFor: ["talking", "narration", "calm"],
      lessIdealFor: ["surprise", "shock"],
    },
  },
  {
    id: "vp:brows-raised",
    slotId: "slot:left-eyebrow",
    key: "raised",
    displayName: "Raised brows",
    aiMetadata: {
      plainDescription: "Eyebrows lifted high — surprised, curious, or emphatic.",
      tags: ["brows", "raised", "surprised"],
      goodFor: ["surprise", "emphasis", "questions"],
      lessIdealFor: ["calm", "neutral"],
    },
  },
  {
    id: "vp:hand-open",
    slotId: "slot:right-hand",
    key: "open",
    displayName: "Open hand",
    aiMetadata: {
      plainDescription: "Relaxed open hand — neutral, friendly, ready to gesture.",
      tags: ["hand", "open", "relaxed"],
      goodFor: ["waving", "presenting", "explaining"],
    },
  },
  {
    id: "vp:hand-closed",
    slotId: "slot:right-hand",
    key: "closed",
    displayName: "Closed hand",
    aiMetadata: {
      plainDescription: "Hand closed into a fist — determined, assertive, or celebratory.",
      tags: ["hand", "closed", "fist", "determined"],
      goodFor: ["determination", "celebration", "power"],
      lessIdealFor: ["waving", "calm"],
    },
  },
];

/**
 * Build the fully-rigged presenter `CharacterPreset`. `mediaIdForKey` resolves each part spec's
 * `key` to a stored media id (the seeder imports one SVG per spec). Pure: no db access here.
 */
export function presenterCharacterName(variant: PresenterVariant): string {
  return variant === "female" ? "Studio Presenter (Female)" : "Studio Presenter";
}

export function buildPresenterCharacter(
  id: string,
  variant: PresenterVariant,
  mediaIdForKey: (key: string) => string,
): CharacterPreset {
  const name = presenterCharacterName(variant);
  const base = createBlankCharacter(name);
  const parts = presenterPartSpecs(variant).map((spec) =>
    makePart(spec.role, mediaIdForKey(spec.key), {
      name: spec.name,
      side: spec.side,
      viseme: spec.viseme,
      eyeState: spec.eyeState,
      pose: spec.pose,
      x: spec.frame.x,
      y: spec.frame.y,
      width: spec.frame.width,
      height: spec.frame.height,
      pivot: spec.pivot,
      zIndex: spec.zIndex,
      angleIds: [spec.angle],
    }),
  );

  const character: CharacterPreset = {
    ...base,
    id,
    name,
    builtinVersion: PRESENTER_VERSION,
    canvasWidth: PRESENTER_CANVAS_W,
    canvasHeight: PRESENTER_CANVAS_H,
    angles: [...PRESENTER_ANGLES],
    manifest: { ...DEFAULT_PART_MANIFEST, hasIrises: false, hasAccessories: false },
    parts,
    posePresets: POSE_PRESETS,
    defaultPoseId: "pose:relaxed",
    variantPackages: VARIANT_PACKAGES,
  };

  return normalizeCharacterSlots(character);
}
