// HyperFrames-compliant character timeline builder.
// Builds a GSAP timeline from project data — no React imports.
// Used by both Stage.tsx (live preview via tl.seek) and the future export serializer.
import gsap from "gsap";
import type {
  ActionPreset,
  CharacterClip,
  CharacterPart,
  CharacterPreset,
  ColorTint,
  MouthViseme,
} from "../types";
import type { CharacterSlotRef } from "../character/character-utils";
import { RIG_STYLES, poseToTransforms } from "../character/mouth-libraries";
import {
  listCharacterSlots,
  pickActivePartForSlot,
  roleEnabledByManifest,
} from "../character/character-utils";
import {
  composeActionsAt,
  deltaFor,
  expandKeyposesWithAnticipation,
  generateLoopOccurrences,
} from "../presets/apply";

// ─── DOM ID scheme ─────────────────────────────────────────────────────────────
// Stage.tsx creates elements with these IDs; this module targets them via GSAP.
// Never hardcode these patterns elsewhere — always call these functions.

/** Container div for a slot. Receives action transforms (x/y/scale/rotation/opacity). */
export function slotDomId(clipId: string, slotId: string): string {
  return `char-${clipId}-${slotId.replace(/[^a-z0-9]/gi, "-")}`;
}

/** Individual mouth viseme image/svg inside a mouth slot container. */
export function visemeDomId(clipId: string, slotId: string, viseme: string): string {
  return `${slotDomId(clipId, slotId)}-v-${viseme}`;
}

/** Individual eye state image inside an eye slot container. */
export function eyeDomId(clipId: string, slotId: string, eyeState: string): string {
  return `${slotDomId(clipId, slotId)}-e-${eyeState}`;
}

/** DOM id for a transform-based mouth rig component element. */
export function rigComponentId(clipId: string, component: string): string {
  return `rig-${clipId}-${component}`;
}

// ─── Geometry helpers (mirrored from Stage.tsx — keep in sync) ─────────────────

function isFaceAttachedRole(role: CharacterPart["role"]): boolean {
  return role === "eye" || role === "eyebrow" || role === "mouth";
}

function partPivot(part: CharacterPart): { x: number; y: number } {
  return (
    part.pivot ?? {
      x: part.x + part.width * part.anchorX,
      y: part.y + part.height * part.anchorY,
    }
  );
}

function transformPointAroundPivot(
  point: { x: number; y: number },
  pivot: { x: number; y: number },
  motion: { dx: number; dy: number; scale: number; rotation: number },
): { x: number; y: number } {
  const rad = (motion.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const relX = (point.x - pivot.x) * motion.scale;
  const relY = (point.y - pivot.y) * motion.scale;
  return {
    x: pivot.x + motion.dx + relX * cos - relY * sin,
    y: pivot.y + motion.dy + relX * sin + relY * cos,
  };
}

function findSlotForPart(
  slots: CharacterSlotRef[],
  partId: string | undefined,
): CharacterSlotRef | undefined {
  if (!partId) return undefined;
  return slots.find((slot) => slot.parts.some((p) => p.id === partId));
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// ─── Critical time collection ──────────────────────────────────────────────────

/** Returns sorted times at every animation boundary within the clip. */
export function collectCriticalTimes(
  clip: CharacterClip,
  presets: Map<string, ActionPreset>,
): number[] {
  const times = new Set<number>([0, clip.duration]);
  const addTime = (t: number) => {
    if (t > 0 && t < clip.duration) times.add(t);
  };

  for (const action of clip.actions ?? []) {
    const preset = presets.get(action.presetId);
    if (!preset) continue;
    const dur = action.duration ?? preset.duration;
    const occurrences = generateLoopOccurrences(action, preset, clip.duration);

    if (preset.keyposes?.length) {
      const keyposes = expandKeyposesWithAnticipation(preset.keyposes);
      for (const occurrence of occurrences) {
        addTime(occurrence.start);
        addTime(occurrence.end);
        for (const kp of keyposes) addTime(occurrence.start + kp.t);
      }
    } else {
      for (const occurrence of occurrences) {
        addTime(occurrence.start);
        addTime(occurrence.end);
        for (const track of preset.tracks) {
          for (const kf of track.keyframes) addTime(occurrence.start + kf.t * dur);
        }
      }
    }
  }

  for (const v of clip.visemes ?? []) {
    if (v.t > 0 && v.t < clip.duration) times.add(v.t);
  }

  return [...times].sort((a, b) => a - b);
}

// ─── Per-part sample ───────────────────────────────────────────────────────────

interface PartFrame {
  t: number;
  x: number;
  y: number;
  scale: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  tint: ColorTint | null;
}

function sampleSlot(
  clip: CharacterClip,
  slot: CharacterSlotRef,
  defaultPart: CharacterPart,
  allSlots: CharacterSlotRef[],
  presets: Map<string, ActionPreset>,
  times: number[],
  canvasScaleX: number,
  canvasScaleY: number,
): PartFrame[] {
  return times.map((t) => {
    const composed = composeActionsAt(clip, t, presets);
    const d = deltaFor(composed, slot.role, slot.id);

    // Face parts inherit their parent's (head's) motion.
    let inhDx = 0,
      inhDy = 0,
      inhScale = 1,
      inhRotation = 0;
    const parentSlot =
      findSlotForPart(allSlots, defaultPart.parentId) ??
      (isFaceAttachedRole(slot.role) ? allSlots.find((s) => s.role === "head") : undefined);

    if (parentSlot) {
      const parentPart = pickActivePartForSlot(parentSlot, { pose: undefined });
      if (parentPart) {
        const pd = deltaFor(composed, parentSlot.role, parentSlot.id);
        const childPivot = partPivot(defaultPart);
        const transformed = transformPointAroundPivot(childPivot, partPivot(parentPart), pd);
        inhDx = transformed.x - childPivot.x;
        inhDy = transformed.y - childPivot.y;
        inhScale = pd.scale;
        inhRotation = pd.rotation;
      }
    }

    return {
      t,
      x: (d.dx + inhDx) * canvasScaleX,
      y: (d.dy + inhDy) * canvasScaleY,
      scale: d.scale * inhScale,
      scaleX: d.scaleX,
      scaleY: d.scaleY,
      rotation: d.rotation + inhRotation,
      opacity: d.opacity ?? 1,
      tint: d.colorTint,
    };
  });
}

// ─── Tween emission ────────────────────────────────────────────────────────────

// fromTo ensures correct state at any seek position regardless of what came before.
function emitTweens(tl: gsap.core.Timeline, domId: string, frames: PartFrame[]): void {
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    const duration = b.t - a.t;
    if (duration <= 0) continue;
    tl.fromTo(
      `#${domId}`,
      {
        x: a.x,
        y: a.y,
        scaleX: a.scale * a.scaleX,
        scaleY: a.scale * a.scaleY,
        rotation: a.rotation,
        opacity: a.opacity,
      },
      {
        x: b.x,
        y: b.y,
        scaleX: b.scale * b.scaleX,
        scaleY: b.scale * b.scaleY,
        rotation: b.rotation,
        opacity: b.opacity,
        duration,
        ease: "none",
      },
      a.t,
    );
  }
  emitTintTweens(tl, `${domId}-tint`, frames);
}

function rgbaFrom(tint: ColorTint | null): string {
  if (!tint) return "rgba(0, 0, 0, 0)";
  return `rgba(${Math.round(tint.r)}, ${Math.round(tint.g)}, ${Math.round(tint.b)}, ${Math.max(
    0,
    Math.min(1, tint.a),
  )})`;
}

function emitTintTweens(tl: gsap.core.Timeline, domId: string, frames: PartFrame[]): void {
  if (!frames.some((frame) => frame.tint && frame.tint.a > 0)) return;
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    const duration = b.t - a.t;
    if (duration <= 0) continue;
    tl.fromTo(
      `#${domId}`,
      {
        backgroundColor: rgbaFrom(a.tint),
        opacity: a.tint?.a ?? 0,
        mixBlendMode: a.tint?.blendMode ?? "multiply",
      },
      {
        backgroundColor: rgbaFrom(b.tint),
        opacity: b.tint?.a ?? 0,
        mixBlendMode: b.tint?.blendMode ?? a.tint?.blendMode ?? "multiply",
        duration,
        ease: "none",
      },
      a.t,
    );
  }
}

// ─── Viseme smoothing ──────────────────────────────────────────────────────────

// Vowels rank highest so they survive when rapid events get collapsed.
const VISEME_PRIORITY: Record<MouthViseme, number> = {
  A: 10,
  O: 9,
  U: 8,
  E: 7,
  WQ: 6,
  Smile: 5,
  L: 4,
  FV: 3,
  MBP: 2,
  rest: 1,
};

/**
 * Cap viseme rate at maxPerSec (default 8). Within each time window, the
 * highest-priority (vowel-preferring) viseme wins. Keeps natural-feeling lip
 * sync without rapid consonant chatter.
 */
function smoothVisemes(
  raw: { t: number; v: MouthViseme }[],
  maxPerSec = 8,
): { t: number; v: MouthViseme }[] {
  if (raw.length === 0) return [];
  const minGap = 1 / maxPerSec;
  const sorted = [...raw].sort((a, b) => a.t - b.t);
  const out: { t: number; v: MouthViseme }[] = [];
  let lastT = -Infinity;
  let i = 0;

  while (i < sorted.length) {
    // Skip events still inside the dead zone of the last emission.
    if (sorted[i].t - lastT < minGap) {
      i++;
      continue;
    }

    // Collect all events in this window and pick the highest-priority one.
    const windowStart = sorted[i].t;
    let best = sorted[i];
    let j = i + 1;
    while (j < sorted.length && sorted[j].t - windowStart < minGap) {
      if ((VISEME_PRIORITY[sorted[j].v] ?? 0) > (VISEME_PRIORITY[best.v] ?? 0)) {
        best = sorted[j];
      }
      j++;
    }
    out.push({ t: windowStart, v: best.v });
    lastT = windowStart;
    i = j;
  }
  return out;
}

// ─── Viseme events ─────────────────────────────────────────────────────────────

function addVisemeEvents(
  tl: gsap.core.Timeline,
  clip: CharacterClip,
  slots: CharacterSlotRef[],
): void {
  const VISEMES: import("../types").MouthViseme[] = [
    "rest",
    "A",
    "E",
    "O",
    "U",
    "MBP",
    "FV",
    "L",
    "WQ",
    "Smile",
  ];

  for (const slot of slots) {
    if (slot.role !== "mouth") continue;

    // Index which viseme parts actually exist in this slot.
    const available = new Map<string, true>();
    for (const v of VISEMES) {
      if (slot.parts.some((p) => p.visible && (p.viseme === v || p.pose === v))) {
        available.set(v, true);
      }
    }
    if (available.size === 0) continue;

    // When all visible viseme parts have morph path data, Stage.tsx renders them
    // as a single React-interpolated SVG — no per-viseme DOM elements to target.
    const allHaveMorphPaths = [...available.keys()].every((v) =>
      slot.parts.some((p) => p.visible && (p.viseme === v || p.pose === v) && p.morph?.primaryPath),
    );
    if (allHaveMorphPaths) continue;

    const firstVisible = available.has("rest") ? "rest" : ([...available.keys()][0] ?? "rest");

    // Initial state.
    for (const [v] of available) {
      tl.set(`#${visemeDomId(clip.id, slot.id, v)}`, { opacity: v === firstVisible ? 1 : 0 }, 0);
    }

    let current = firstVisible;
    const smoothed = smoothVisemes(clip.visemes ?? []);
    for (const { t, v } of smoothed) {
      if (t < 0 || t > clip.duration) continue;
      const next = available.has(v) ? v : available.has("rest") ? "rest" : current;
      if (next === current) continue;
      tl.set(`#${visemeDomId(clip.id, slot.id, current)}`, { opacity: 0 }, t);
      tl.set(`#${visemeDomId(clip.id, slot.id, next)}`, { opacity: 1 }, t);
      current = next;
    }
  }
}

// ─── Blink events ──────────────────────────────────────────────────────────────

function addBlinkEvents(
  tl: gsap.core.Timeline,
  clip: CharacterClip,
  slots: CharacterSlotRef[],
): void {
  if (clip.autoBlink === false) return;

  for (const slot of slots) {
    if (slot.role !== "eye") continue;

    const hasClosedVariant = slot.parts.some(
      (p) => p.visible && (p.eyeState === "closed" || p.pose === "closed"),
    );
    if (!hasClosedVariant) continue;

    const openId = `#${eyeDomId(clip.id, slot.id, "open")}`;
    const closedId = `#${eyeDomId(clip.id, slot.id, "closed")}`;

    const hash = hashString(clip.id);
    const cycle = 3.2 + (hash % 140) / 100;
    const phaseOffset = (((hash >>> 8) % 100) / 100) * cycle;
    const blinkDuration = 0.14;

    // Initial: open visible, closed hidden.
    tl.set(openId, { opacity: 1 }, 0);
    tl.set(closedId, { opacity: 0 }, 0);

    let t = (((cycle - blinkDuration - phaseOffset) % cycle) + cycle) % cycle;
    while (t < clip.duration) {
      if (t > 0) {
        const blinkEnd = Math.min(t + blinkDuration, clip.duration);
        tl.set(openId, { opacity: 0 }, t);
        tl.set(closedId, { opacity: 1 }, t);
        if (blinkEnd < clip.duration) {
          tl.set(openId, { opacity: 1 }, blinkEnd);
          tl.set(closedId, { opacity: 0 }, blinkEnd);
        }
      }
      t += cycle;
    }
  }
}

// ─── Main entry point ──────────────────────────────────────────────────────────

/**
 * Build a paused GSAP timeline for a character clip.
 *
 * The timeline targets DOM elements created by CharacterRig in Stage.tsx using
 * the shared ID scheme (slotDomId / visemeDomId / eyeDomId).
 *
 * Usage in Stage:
 *   const tl = buildCharacterTimeline(clip, character, presetMap);
 *   tl.seek(playhead - clip.start, false);
 */
export function buildCharacterTimeline(
  clip: CharacterClip,
  character: CharacterPreset,
  presets: Map<string, ActionPreset>,
): gsap.core.Timeline {
  const tl = gsap.timeline({ paused: true });

  const scaleX = clip.width / character.canvasWidth;
  const scaleY = clip.height / character.canvasHeight;

  const slots = listCharacterSlots(character.parts).filter((slot) =>
    roleEnabledByManifest(slot.role, character.manifest),
  );
  const times = collectCriticalTimes(clip, presets);

  for (const slot of slots) {
    const defaultPart = pickActivePartForSlot(slot, {
      pose: undefined,
      viseme: slot.role === "mouth" ? "rest" : undefined,
      eyeState: slot.role === "eye" ? "open" : undefined,
    });
    if (!defaultPart) continue;

    const frames = sampleSlot(clip, slot, defaultPart, slots, presets, times, scaleX, scaleY);
    emitTweens(tl, slotDomId(clip.id, slot.id), frames);
  }

  addBlinkEvents(tl, clip, slots);

  if (character.mouthRig && character.mouthStyle !== "images") {
    addRigVisemeEvents(tl, clip, character);
  } else {
    addVisemeEvents(tl, clip, slots);
  }

  return tl;
}

// ─── Rig viseme events ────────────────────────────────────────────────────────

type RigTransforms = ReturnType<typeof poseToTransforms>;

function rigPropsUpper(t: RigTransforms, pxY: number, widthScale: number) {
  return {
    y: t.upperLip.y * pxY,
    scaleX: t.upperLip.scaleX * widthScale,
    scaleY: t.upperLip.scaleY,
  };
}
function rigPropsLower(t: RigTransforms, pxY: number, widthScale: number) {
  return {
    y: t.lowerLip.y * pxY,
    scaleX: t.lowerLip.scaleX * widthScale,
    scaleY: t.lowerLip.scaleY,
  };
}
function rigPropsInterior(t: RigTransforms, widthScale: number) {
  return {
    scaleY: t.interior.scaleY,
    scaleX: t.interior.scaleX * widthScale,
    opacity: t.interior.opacity,
  };
}
function rigPropsTeeth(t: RigTransforms, pxY: number) {
  return { opacity: t.teeth.opacity, y: t.teeth.y * pxY };
}
function rigPropsTongue(t: RigTransforms, pxY: number) {
  return { opacity: t.tongue.opacity, y: t.tongue.y * pxY };
}

function addRigVisemeEvents(
  tl: gsap.core.Timeline,
  clip: CharacterClip,
  character: CharacterPreset,
): void {
  const { mouthRig } = character;
  if (!mouthRig) return;

  const rigStyle = RIG_STYLES.find((s) => s.id === mouthRig.styleId) ?? RIG_STYLES[0];
  const { placement } = mouthRig;
  const pxPerSvgY = placement.height / 60;
  const widthScale = mouthRig.widthScale;

  const ids = {
    upperLip: `#${rigComponentId(clip.id, "upper-lip")}`,
    lowerLip: `#${rigComponentId(clip.id, "lower-lip")}`,
    interior: `#${rigComponentId(clip.id, "interior")}`,
    teeth: `#${rigComponentId(clip.id, "teeth")}`,
    tongue: `#${rigComponentId(clip.id, "tongue")}`,
  };

  const curveOpts = {
    upperCurve: mouthRig.upperCurve ?? 0,
    lowerCurve: mouthRig.lowerCurve ?? 0,
  };

  // Set initial rest state at t=0.
  const restT = poseToTransforms(mouthRig.poses.rest, rigStyle, curveOpts);
  tl.set(ids.upperLip, rigPropsUpper(restT, pxPerSvgY, widthScale), 0);
  tl.set(ids.lowerLip, rigPropsLower(restT, pxPerSvgY, widthScale), 0);
  tl.set(ids.interior, rigPropsInterior(restT, widthScale), 0);
  tl.set(ids.teeth, rigPropsTeeth(restT, pxPerSvgY), 0);
  tl.set(ids.tongue, rigPropsTongue(restT, pxPerSvgY), 0);

  // fromTo tweens: bake prev→next so backward scrubbing is correct.
  const BLEND = 0.075;
  const sortedVisemes = smoothVisemes(clip.visemes ?? []);
  let prev = restT;

  for (const { t, v } of sortedVisemes) {
    if (t < 0 || t > clip.duration) continue;
    const pose = mouthRig.poses[v as MouthViseme] ?? mouthRig.poses.rest;
    const next = poseToTransforms(pose, rigStyle, curveOpts);
    const startAt = Math.max(0, t - BLEND);
    const dur = Math.min(BLEND, t);

    tl.fromTo(
      ids.upperLip,
      rigPropsUpper(prev, pxPerSvgY, widthScale),
      { ...rigPropsUpper(next, pxPerSvgY, widthScale), duration: dur, ease: "power1.out" },
      startAt,
    );
    tl.fromTo(
      ids.lowerLip,
      rigPropsLower(prev, pxPerSvgY, widthScale),
      { ...rigPropsLower(next, pxPerSvgY, widthScale), duration: dur, ease: "power1.out" },
      startAt,
    );
    tl.fromTo(
      ids.interior,
      rigPropsInterior(prev, widthScale),
      { ...rigPropsInterior(next, widthScale), duration: dur, ease: "power1.out" },
      startAt,
    );
    tl.fromTo(
      ids.teeth,
      rigPropsTeeth(prev, pxPerSvgY),
      { ...rigPropsTeeth(next, pxPerSvgY), duration: dur * 0.7 },
      startAt,
    );
    tl.fromTo(
      ids.tongue,
      rigPropsTongue(prev, pxPerSvgY),
      { ...rigPropsTongue(next, pxPerSvgY), duration: dur * 0.7 },
      startAt,
    );

    prev = next;
  }
}
