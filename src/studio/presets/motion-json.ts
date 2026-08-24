import type {
  AngleRigJson,
  MotionDraftJson,
  MotionDraftKeyframe,
  MotionDraftTrack,
  MotionJson,
  MotionJsonKeyframe,
  MotionJsonTrack,
  MotionTargetJson,
  MotionTrackChannel,
} from "../character-json/schema";
import {
  CHARACTER_JSON_SCHEMA_VERSION,
  MOTION_JSON_KIND,
  MOTION_TRANSFORM_FIELD_NAMES,
  normalizeMotionCategoryForImport,
} from "../character-json/schema";
import { motionJsonFromPreset, motionJsonFilename, slugifyName } from "../character-json/normalize";
import { resolveMotionTarget, validateMotionJsonForAngle } from "../character-json/validate";
import type {
  ID,
  MotionKeyframe,
  MotionPreset,
  PartRole,
  RecordedKeypose,
  RecordedPartOverride,
} from "../types";

export { motionJsonFromPreset };
export {
  parseJsonArtifact,
  validateMotionJson,
  validateMotionJsonForAngle,
  resolveMotionTarget,
} from "../character-json/validate";
export type { MotionJson, MotionTargetJson, ResolvedMotionTarget } from "../character-json/schema";

export interface MotionJsonToPresetOptions {
  id: ID;
  createdAt?: number;
  updatedAt?: number;
}

export function motionJsonToPreset(
  motion: MotionJson,
  angleRig: AngleRigJson,
  options: MotionJsonToPresetOptions,
): { preset?: MotionPreset; errors: string[]; warnings: string[] } {
  const validation = validateMotionJsonForAngle(motion, angleRig);
  if (!validation.ok) {
    return {
      errors: validation.errors.map((issue) => `${issue.path}: ${issue.message}`),
      warnings: validation.warnings.map((issue) => `${issue.path}: ${issue.message}`),
    };
  }

  const duration = Math.max(0.1, motion.duration);
  const now = options.updatedAt ?? Date.now();
  const keyposes = keyposesFromMotionJson(motion, angleRig, duration);
  const category = normalizeMotionCategoryForImport(motion.category).category;
  const preset: MotionPreset = {
    id: options.id,
    name: motion.name.trim() || "AI motion",
    category,
    angleIds: motion.angleIds,
    duration,
    loop: motion.loop,
    kinematics: motion.kinematics ?? "fk",
    tracks: [],
    keyposes,
    allowOutOfBounds: allowOutOfBoundsIds(motion, angleRig),
    description: motion.description,
    builtin: false,
    createdAt: options.createdAt ?? now,
    updatedAt: now,
  };

  return {
    preset,
    errors: [],
    warnings: validation.warnings.map((issue) => `${issue.path}: ${issue.message}`),
  };
}

export function motionSuggestionFilename(motionName: string): string {
  return `${slugifyName(motionName, "motion")}.motion-suggestion.ai-in.json`;
}

export function motionSuggestionJsonText(motion: MotionJson): string {
  return JSON.stringify(
    {
      kind: "studioBoom.ai.motionSuggestion.v1",
      schemaVersion: 1,
      suggestedFilename: motionSuggestionFilename(motion.name),
      motion: {
        ...motion,
        suggestedFilename: motionJsonFilename(motion.name),
      },
    },
    null,
    2,
  );
}

function keyposesFromMotionJson(
  motion: MotionJson,
  angleRig: AngleRigJson,
  duration: number,
): RecordedKeypose[] {
  const times = new Set<number>([0, 1]);
  for (const track of motion.tracks) {
    for (const keyframe of track.keyframes) times.add(clamp01(keyframe.t));
  }

  return Array.from(times)
    .sort((a, b) => a - b)
    .map((tNorm) => {
      const parts: RecordedPartOverride[] = [];
      let camera: RecordedKeypose["camera"];
      // Carry the AI's per-keyframe easing into the keypose so apply.ts shapes the curve into it
      // (a RecordedKeypose holds one ease for all parts; take the first defined source ease here).
      let keyposeEase: string | undefined;
      for (const track of motion.tracks) {
        const resolved = resolveMotionTarget(track.target, angleRig);
        if (!resolved.ok) continue;
        const sample = sampleMotionJsonTrack(track, tNorm);
        if (keyposeEase === undefined && typeof sample.ease === "string") keyposeEase = sample.ease;
        if (resolved.target.kind === "camera") {
          camera = {
            dx: sample.dx,
            dy: sample.dy,
            zoom: sample.scale,
          };
          continue;
        }
        const role = roleForResolvedTrack(resolved.target.id, resolved.target.kind, angleRig);
        if (!role) continue;
        const part: RecordedPartOverride = { partRole: role };
        if (resolved.target.kind === "angleBone") {
          part.target = "bone";
          part.boneId = resolved.target.id;
        } else {
          part.target = "slot";
          part.slotId = resolved.target.id;
        }
        assignSampleToOverride(part, sample, track.channel);
        parts.push(part);
      }
      return {
        t: round(tNorm * duration, 4),
        parts,
        camera,
        ease: keyposeEase ?? "easeInOut",
      };
    })
    .filter((keypose) => keypose.parts.length > 0 || keypose.camera);
}

function allowOutOfBoundsIds(motion: MotionJson, angleRig: AngleRigJson): string[] | undefined {
  const ids = new Set<string>();
  for (const item of motion.constraints?.allowOutOfBounds ?? []) {
    const resolved = resolveMotionTarget(item.target, angleRig);
    if (!resolved.ok) continue;
    if (resolved.target.kind === "angleSlot") ids.add(resolved.target.id);
    else if (resolved.target.kind === "angleBone") ids.add(resolved.target.id);
  }
  return ids.size > 0 ? Array.from(ids) : undefined;
}

function roleForResolvedTrack(
  id: string,
  kind: "angleBone" | "angleSlot" | "camera",
  angleRig: AngleRigJson,
): PartRole | null {
  if (kind === "camera") return null;
  if (kind === "angleSlot") return angleRig.slots.find((slot) => slot.id === id)?.role ?? null;
  const bone = angleRig.bones.find((candidate) => candidate.id === id);
  return bone?.role && bone.role !== "root" && bone.role !== "custom" ? bone.role : "custom";
}

function assignSampleToOverride(
  out: RecordedPartOverride,
  sample: Partial<MotionJsonKeyframe>,
  channel: MotionJsonTrack["channel"],
) {
  const writable = out as RecordedPartOverride & Partial<MotionKeyframe>;
  for (const key of MOTION_TRANSFORM_FIELD_NAMES) {
    const value = sample[key];
    if (typeof value === "number" && Number.isFinite(value)) writable[key] = round(value, 4);
  }
  if (channel === "variant" && sample.variant) out.poseSwap = sample.variant;
  if (channel === "visibility" && typeof sample.visible === "boolean") {
    out.opacity = sample.visible ? 1 : 0;
  }
}

function sampleMotionJsonTrack(track: MotionJsonTrack, tNorm: number): Partial<MotionJsonKeyframe> {
  if (track.channel === "variant" || track.channel === "visibility") {
    return sampleHeldTrack(track, tNorm);
  }
  return sampleInterpolatedTrack(track, tNorm);
}

function sampleHeldTrack(track: MotionJsonTrack, tNorm: number): Partial<MotionJsonKeyframe> {
  const sorted = sortedKeyframes(track);
  let selected = sorted[0];
  for (const keyframe of sorted) {
    if (keyframe.t <= tNorm) selected = keyframe;
    else break;
  }
  return selected ? { ...selected } : {};
}

function sampleInterpolatedTrack(
  track: MotionJsonTrack,
  tNorm: number,
): Partial<MotionJsonKeyframe> {
  const sorted = sortedKeyframes(track);
  if (sorted.length === 0) return {};
  if (sorted.length === 1) return { ...sorted[0] };
  let a = sorted[0];
  let b = sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    if (sorted[i + 1].t >= tNorm) {
      a = sorted[i];
      b = sorted[i + 1];
      break;
    }
  }
  const span = Math.max(0.0001, b.t - a.t);
  const u = Math.max(0, Math.min(1, (tNorm - a.t) / span));
  const out: Partial<MotionJsonKeyframe> = { t: tNorm };
  for (const key of MOTION_TRANSFORM_FIELD_NAMES) {
    const av = a[key];
    const bv = b[key];
    if (av === undefined && bv === undefined) continue;
    if (av === undefined) out[key] = bv;
    else if (bv === undefined) out[key] = av;
    else out[key] = av + (bv - av) * u;
  }
  // The keyframe at/after tNorm governs the easing into this sample (apply.ts uses keypose ease).
  const ease = b.ease ?? a.ease;
  if (typeof ease === "string") out.ease = ease;
  return out;
}

function sortedKeyframes(track: MotionJsonTrack): MotionJsonKeyframe[] {
  return [...track.keyframes].sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------------
// Lean AI authoring shape ("motion draft")
//
// What the AI actually writes is movement, nothing else. Everything that is
// format identity (kind/schemaVersion/id/suggestedFilename/targetSpace), editor
// concern (final name/category), or rig knowledge (joint pivots) is filled in by
// `normalizeMotionInput` below, which expands a draft into the canonical
// `MotionJson` that the rest of the pipeline already validates and renders.
//
// The expander is deliberately tolerant: it ingests the lean draft, a fully
// verbose `studioBoom.motion.v1`, the legacy `motionSuggestion` envelope, and
// anything in between, and always emits a complete `MotionJson`. The OUT prompt
// advertises only the lean end of that spectrum.
// ---------------------------------------------------------------------------

/** Resolve a bare target string to a `MotionTargetJson`. Returns null for an unknown shape. */
export function parseMotionTargetString(raw: string): MotionTargetJson | null {
  const id = raw.trim();
  if (!id) return null;
  if (id === "camera" || id === "__camera") return { kind: "camera", id: "__camera" };
  if (id.startsWith("bone:")) return { kind: "semanticBone", id };
  if (id.startsWith("slot:") || id.startsWith("role:")) return { kind: "semanticSlot", id };
  return null;
}

function coerceTarget(target: unknown): MotionTargetJson | null {
  if (typeof target === "string") return parseMotionTargetString(target);
  if (isRecord(target) && typeof target.kind === "string") return target as MotionTargetJson;
  return null;
}

/**
 * Channel is fully derivable from which key a keyframe carries — `variant` (string) is a stepped
 * pose swap, `visible` (boolean) is a stepped on/off, and everything else (incl. `opacity` as a
 * smooth number) is an interpolated transform. So the AI never declares it.
 */
function inferChannel(keyframes: MotionDraftKeyframe[]): MotionTrackChannel {
  if (keyframes.some((kf) => isRecord(kf) && typeof kf.variant === "string")) return "variant";
  if (keyframes.some((kf) => isRecord(kf) && typeof kf.visible === "boolean")) return "visibility";
  return "transform";
}

const MOTION_EASE_SYNONYMS: Record<string, string> = {
  bouncy: "bounce",
  springy: "elastic",
  rubbery: "elastic",
  smooth: "soft",
  gentle: "soft",
  sharp: "snappy",
  punchy: "snappy",
  weighty: "easeInOut",
  heavy: "easeInOut",
  floaty: "easeOut",
};

/** Map an optional "feel" word to an ease name; pass valid ease names straight through. */
function feelToEase(feel: unknown): string | undefined {
  if (typeof feel !== "string") return undefined;
  const key = feel.trim().toLowerCase();
  return MOTION_EASE_SYNONYMS[key] ?? (key || undefined);
}

function expandDraftKeyframe(
  kf: MotionDraftKeyframe,
  track: MotionDraftTrack,
  trackEase: string | undefined,
): MotionJsonKeyframe {
  const raw = kf as unknown as Record<string, unknown>;
  const out: MotionJsonKeyframe = { t: typeof kf.t === "number" ? kf.t : 0 };
  for (const key of MOTION_TRANSFORM_FIELD_NAMES) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  if (typeof kf.variant === "string") out.variant = kf.variant;
  if (typeof kf.visible === "boolean") out.visible = kf.visible;
  // Track-level perspective expands down onto each keyframe unless the keyframe set its own.
  if (out.transformPerspective === undefined && typeof track.perspective === "number") {
    out.transformPerspective = track.perspective;
  }
  const ease = kf.ease ?? trackEase;
  if (typeof ease === "string") out.ease = ease;
  return out;
}

/**
 * Expand a lean draft into the canonical `MotionJson`. Backfills all format/identity fields,
 * infers channels, resolves bare-string targets, and cascades feel/track ease defaults onto
 * keyframes. Returns authoring warnings (e.g. tracks that will start displaced for lack of a t≤0
 * keyframe) — these are advisory; the existing validator owns hard errors after expansion.
 */
export function expandMotionDraft(draft: MotionDraftJson): {
  motion: MotionJson;
  warnings: string[];
} {
  const source = draft as unknown as Record<string, unknown>;
  const warnings: string[] = [];
  const name = (typeof draft.name === "string" && draft.name.trim()) || "AI motion";
  const defaultEase = feelToEase(draft.feel);
  const draftTracks = Array.isArray(draft.tracks) ? draft.tracks : [];

  const tracks: MotionJsonTrack[] = draftTracks.map((track, index) => {
    const rawTrack = track as unknown as Record<string, unknown>;
    const target = coerceTarget(track.target);
    const keyframes = Array.isArray(track.keyframes) ? track.keyframes : [];
    const channel: MotionTrackChannel =
      typeof rawTrack.channel === "string"
        ? (rawTrack.channel as MotionTrackChannel)
        : inferChannel(keyframes);
    // Ease only shapes interpolation, so it is meaningless on stepped variant/visibility tracks —
    // don't cascade the track ease or the `feel` default onto them.
    const trackEase = channel === "transform" ? (track.ease ?? defaultEase) : undefined;
    const expanded = keyframes.map((kf) => expandDraftKeyframe(kf, track, trackEase));

    const times = expanded.map((kf) => kf.t).filter((t) => Number.isFinite(t));
    if (channel === "transform" && times.length > 0 && Math.min(...times) > 0) {
      warnings.push(
        `$.tracks[${index}] (${stringifyTarget(track.target)}) has no keyframe at t<=0; it will ` +
          `start at its first authored value instead of easing in from rest. Add a t:0 keyframe ` +
          `at the neutral pose if you want it to animate in.`,
      );
    }

    return {
      id: typeof rawTrack.id === "string" ? (rawTrack.id as string) : `track:${index + 1}`,
      // A null target is left as a best-effort value so the validator reports it at the right path.
      target:
        target ?? ({ kind: "semanticSlot", id: stringifyTarget(track.target) } as MotionTargetJson),
      channel,
      keyframes: expanded,
    };
  });

  const motion: MotionJson = {
    kind: MOTION_JSON_KIND,
    schemaVersion: CHARACTER_JSON_SCHEMA_VERSION,
    suggestedFilename:
      typeof source.suggestedFilename === "string"
        ? (source.suggestedFilename as string)
        : motionJsonFilename(name),
    id:
      typeof source.id === "string" && source.id.trim()
        ? (source.id as string)
        : `motion:${slugifyName(name, "ai")}`,
    name,
    category: normalizeMotionCategoryForImport(
      typeof draft.category === "string" ? draft.category : "custom",
    ).category,
    duration:
      typeof draft.duration === "number" && Number.isFinite(draft.duration) && draft.duration > 0
        ? draft.duration
        : 1,
    loop: typeof source.loop === "boolean" ? (source.loop as boolean) : false,
    kinematics: source.kinematics === "ik" ? "ik" : "fk",
    targetSpace: "parentRelative",
    tracks,
  };
  if (Array.isArray(source.angleIds)) motion.angleIds = source.angleIds as MotionJson["angleIds"];
  if (isRecord(source.constraints))
    motion.constraints = source.constraints as MotionJson["constraints"];
  if (typeof source.description === "string") motion.description = source.description;

  return { motion, warnings };
}

/**
 * Normalize any pasted motion input into a canonical `MotionJson`. Accepts the lean draft (current
 * authoring shape), a full `studioBoom.motion.v1`, and the legacy `motionSuggestion` envelope.
 */
export function normalizeMotionInput(value: unknown): {
  motion: MotionJson | null;
  warnings: string[];
} {
  // A bare array is accepted as the tracks list (a model that dropped the object wrapper).
  if (Array.isArray(value)) {
    return expandMotionDraft({ tracks: value } as unknown as MotionDraftJson);
  }
  if (!isRecord(value)) return { motion: null, warnings: [] };
  // Unwrap a nested motion object: the legacy `motionSuggestion` envelope, or any stray
  // `{ motion: {...} }` wrapper a model may add despite the instructions.
  if (!Array.isArray(value.tracks) && isRecord(value.motion)) {
    return normalizeMotionInput(value.motion);
  }
  // Lean draft, full `studioBoom.motion.v1`, or anything else carrying a tracks array.
  if (Array.isArray(value.tracks)) {
    return expandMotionDraft(value as unknown as MotionDraftJson);
  }
  return { motion: null, warnings: [] };
}

function stringifyTarget(target: unknown): string {
  if (typeof target === "string") return target;
  if (isRecord(target) && typeof target.id === "string") return target.id;
  return "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(n: number, digits: number): number {
  const k = Math.pow(10, digits);
  return Math.round(n * k) / k;
}
