import type {
  AngleRigJson,
  MotionJson,
  MotionJsonKeyframe,
  MotionJsonTrack,
  MotionTargetJson,
} from "../character-json/schema";
import { motionJsonFromPreset, motionJsonFilename, slugifyName } from "../character-json/normalize";
import { resolveMotionTarget, validateMotionJsonForAngle } from "../character-json/validate";
import type {
  ID,
  MotionCategory,
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
  const preset: MotionPreset = {
    id: options.id,
    name: motion.name.trim() || "AI motion",
    category: motion.category as MotionCategory,
    duration,
    loop: motion.loop,
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
      for (const track of motion.tracks) {
        const resolved = resolveMotionTarget(track.target, angleRig);
        if (!resolved.ok) continue;
        const sample = sampleMotionJsonTrack(track, tNorm);
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
        ease: "easeInOut",
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
  for (const key of [
    "dx",
    "dy",
    "scale",
    "scaleX",
    "scaleY",
    "skewX",
    "skewY",
    "rotation",
    "originX",
    "originY",
    "opacity",
  ] as const) {
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
  for (const key of [
    "dx",
    "dy",
    "scale",
    "scaleX",
    "scaleY",
    "skewX",
    "skewY",
    "rotation",
    "originX",
    "originY",
    "opacity",
  ] as const) {
    const av = a[key];
    const bv = b[key];
    if (av === undefined && bv === undefined) continue;
    if (av === undefined) out[key] = bv;
    else if (bv === undefined) out[key] = av;
    else out[key] = av + (bv - av) * u;
  }
  return out;
}

function sortedKeyframes(track: MotionJsonTrack): MotionJsonKeyframe[] {
  return [...track.keyframes].sort((a, b) => a.t - b.t);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(n: number, digits: number): number {
  const k = Math.pow(10, digits);
  return Math.round(n * k) / k;
}
