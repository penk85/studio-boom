// HyperFrames-compliant character timeline builder.
// Builds a GSAP timeline from project data — no React imports.
// Used by both Stage.tsx (live preview via tl.seek) and the future export serializer.
import gsap from "gsap";
import type { ActionPreset, CharacterClip, CharacterPart, CharacterPreset } from "../types";
import type { CharacterSlotRef } from "../character/character-utils";
import {
  listCharacterSlots,
  pickActivePartForSlot,
  roleEnabledByManifest,
} from "../character/character-utils";
import { composeActionsAt, deltaFor } from "../presets/apply";

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

// ─── Geometry helpers (mirrored from Stage.tsx — keep in sync) ─────────────────

function isFaceAttachedRole(role: CharacterPart["role"]): boolean {
  return role === "eye" || role === "eyebrow" || role === "mouth";
}

function partPivot(part: CharacterPart): { x: number; y: number } {
  return part.pivot ?? {
    x: part.x + part.width * part.anchorX,
    y: part.y + part.height * part.anchorY,
  };
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

  for (const action of clip.actions ?? []) {
    const preset = presets.get(action.presetId);
    if (!preset) continue;
    const dur = action.duration ?? preset.duration;

    times.add(Math.max(0, action.offset));
    times.add(Math.min(clip.duration, action.offset + dur));

    if (preset.keyposes?.length) {
      for (const kp of preset.keyposes) {
        const t = action.offset + kp.t;
        if (t > 0 && t < clip.duration) times.add(t);
      }
    } else {
      for (const track of preset.tracks) {
        for (const kf of track.keyframes) {
          const t = action.offset + kf.t * dur;
          if (t > 0 && t < clip.duration) times.add(t);
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
  rotation: number;
  opacity: number;
}

function sampleSlot(
  clip: CharacterClip,
  slot: CharacterSlotRef,
  defaultPart: CharacterPart,
  allSlots: CharacterSlotRef[],
  presets: Map<string, ActionPreset>,
  times: number[],
  scaleX: number,
  scaleY: number,
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
      x: (d.dx + inhDx) * scaleX,
      y: (d.dy + inhDy) * scaleY,
      scale: d.scale * inhScale,
      rotation: d.rotation + inhRotation,
      opacity: d.opacity ?? 1,
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
      { x: a.x, y: a.y, scale: a.scale, rotation: a.rotation, opacity: a.opacity },
      { x: b.x, y: b.y, scale: b.scale, rotation: b.rotation, opacity: b.opacity, duration, ease: "none" },
      a.t,
    );
  }
}

// ─── Viseme events ─────────────────────────────────────────────────────────────

function addVisemeEvents(
  tl: gsap.core.Timeline,
  clip: CharacterClip,
  slots: CharacterSlotRef[],
): void {
  const VISEMES: import("../types").MouthViseme[] = [
    "rest", "A", "E", "O", "U", "MBP", "FV", "L", "WQ", "Smile",
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

    const firstVisible = available.has("rest") ? "rest" : ([...available.keys()][0] ?? "rest");

    // Initial state.
    for (const [v] of available) {
      tl.set(`#${visemeDomId(clip.id, slot.id, v)}`, { opacity: v === firstVisible ? 1 : 0 }, 0);
    }

    let current = firstVisible;
    for (const { t, v } of [...(clip.visemes ?? [])].sort((a, b) => a.t - b.t)) {
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

    let t = ((cycle - blinkDuration - phaseOffset) % cycle + cycle) % cycle;
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
    if (slot.role === "mouth") continue; // handled by addVisemeEvents

    const defaultPart = pickActivePartForSlot(slot, {
      pose: undefined,
      eyeState: slot.role === "eye" ? "open" : undefined,
    });
    if (!defaultPart) continue;

    const frames = sampleSlot(clip, slot, defaultPart, slots, presets, times, scaleX, scaleY);
    emitTweens(tl, slotDomId(clip.id, slot.id), frames);
  }

  addBlinkEvents(tl, clip, slots);
  addVisemeEvents(tl, clip, slots);

  return tl;
}
