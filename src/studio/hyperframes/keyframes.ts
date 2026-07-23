import type { Keyframe, KeyframeProperties } from "@hyperframes/core";
import { parseFiniteNumber, readStudioTransform } from "./transform";
import {
  buildPositionPath,
  normalizePathStyle,
  type PathStyle,
  type PositionCheckpoint,
  type PositionPathSample,
} from "./motion-path";

export type ClipKeyframeProperty = "position" | "scale" | "rotation" | "opacity";

export type ClipMotionEndpoint = "begin" | "end";

export interface ClipKeyframeBase {
  x: number;
  y: number;
  rotation: number;
  opacity: number;
  keyframes?: Keyframe[];
}

export interface ClipKeyframedState {
  x: number;
  y: number;
  scale: number;
  /** Per-axis mirror sign (1 or -1); default 1. Composed into emitted scale vars so a flip survives. */
  scaleX?: number;
  scaleY?: number;
  rotation: number;
  opacity: number;
}

export interface ClipKeyframeDisplayValues {
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  opacity?: number;
}

export interface ClipKeyframeMutation {
  keyframes: Keyframe[];
  keyframeId: string | null;
}

export interface ClipMotionStepMeta {
  id: string;
  checkpointIds: string[];
  name?: string;
  pathStyle?: PathStyle;
}

export interface ClipMotionStep extends ClipMotionStepMeta {
  checkpointIds: string[];
  checkpoints: ClipMotionCheckpoint[];
  startKeyframeId: string;
  endKeyframeId: string;
  startTime: number;
  endTime: number;
  ease?: string;
  label: string;
  pathStyle: PathStyle;
}

export type { PathStyle } from "./motion-path";

export interface ClipMotionCheckpoint {
  id: string;
  time: number;
  values: ClipKeyframeDisplayValues;
  ease?: string;
  label: string;
}

export interface ClipMotionStepMutation {
  keyframes: Keyframe[];
  motionSteps: ClipMotionStepMeta[];
  selection: {
    keyframeId: string;
    property: ClipKeyframeProperty;
  } | null;
}

export const CLIP_KEYFRAME_PROPERTIES: ClipKeyframeProperty[] = [
  "position",
  "scale",
  "rotation",
  "opacity",
];

export const CLIP_KEYFRAME_EASES = [
  "none",
  "power1.out",
  "power2.out",
  "power3.out",
  "power1.inOut",
  "power2.inOut",
  "back.out",
  "expo.out",
];

const STUDIO_TIMELINE_SCRIPT_ATTR = "data-studio-timeline";
const LEGACY_STUDIO_KEYFRAMES_SCRIPT_ATTR = "data-studio-keyframes";
const STUDIO_MOTION_STEPS_ATTR = "data-motion-steps";
const LEGACY_SYNTHETIC_MOTION_BASE_PREFIX = "__studio-motion-base";
const LEGACY_AUTO_MOTION_ID_PREFIX = "motion-";
const TIME_EPSILON = 0.001;
const MIN_SCALE = 0.01;
const DEFAULT_MOTION_DURATION = 0.9;

type StoredKeyframeValues = Partial<KeyframeProperties>;

export function readAllClipKeyframesFromHtml(html: string): Map<string, Keyframe[]> {
  const keyframesById = new Map<string, Keyframe[]>();
  if (!html || typeof DOMParser === "undefined") return keyframesById;

  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[id][data-keyframes]"))) {
    keyframesById.set(
      el.id,
      materializeMotionModelForElement(
        el,
        readClipKeyframesFromElement(el),
        readClipMotionStepMetasFromElement(el),
      ).keyframes,
    );
  }
  return keyframesById;
}

export function readClipKeyframesFromHtml(html: string, clipId: string): Keyframe[] {
  if (!html || typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const el = doc.getElementById(clipId);
  return el
    ? materializeMotionModelForElement(
        el,
        readClipKeyframesFromElement(el),
        readClipMotionStepMetasFromElement(el),
      ).keyframes
    : [];
}

export function readAllClipMotionStepMetasFromHtml(
  html: string,
): Map<string, ClipMotionStepMeta[]> {
  const motionStepsById = new Map<string, ClipMotionStepMeta[]>();
  if (!html || typeof DOMParser === "undefined") return motionStepsById;

  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of Array.from(
    doc.querySelectorAll<HTMLElement>(`[id][data-keyframes], [id][${STUDIO_MOTION_STEPS_ATTR}]`),
  )) {
    motionStepsById.set(
      el.id,
      materializeMotionModelForElement(
        el,
        readClipKeyframesFromElement(el),
        readClipMotionStepMetasFromElement(el),
      ).motionSteps,
    );
  }
  return motionStepsById;
}

export function readClipMotionStepMetasFromHtml(
  html: string,
  clipId: string,
): ClipMotionStepMeta[] {
  if (!html || typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const el = doc.getElementById(clipId);
  return el
    ? materializeMotionModelForElement(
        el,
        readClipKeyframesFromElement(el),
        readClipMotionStepMetasFromElement(el),
      ).motionSteps
    : [];
}

export function syncRootKeyframesHtml(html: string): string {
  if (!html || typeof DOMParser === "undefined") return html;

  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.documentElement;
  const rootCompositionId = resolveRootCompositionId(doc);
  if (!rootCompositionId) return html;

  const timedVisualClips = collectTimedVisualClips(doc, rootCompositionId);
  const animatedClips: Array<{
    el: HTMLElement;
    keyframes: Keyframe[];
    motionSteps: ClipMotionStepMeta[];
  }> = [];
  for (const el of Array.from(
    doc.querySelectorAll<HTMLElement>(`[id][data-keyframes], [id][${STUDIO_MOTION_STEPS_ATTR}]`),
  )) {
    if (isCompositionRoot(el, rootCompositionId)) continue;
    const materialized = materializeMotionModelForElement(
      el,
      readClipKeyframesFromElement(el),
      readClipMotionStepMetasFromElement(el),
    );
    writeClipKeyframesToElement(el, materialized.keyframes);
    writeClipMotionStepMetasToElement(el, materialized.motionSteps);
    if (materialized.keyframes.length > 0)
      animatedClips.push({
        el,
        keyframes: materialized.keyframes,
        motionSteps: materialized.motionSteps,
      });
  }

  doc
    .querySelectorAll(
      `script[${STUDIO_TIMELINE_SCRIPT_ATTR}="true"], script[${LEGACY_STUDIO_KEYFRAMES_SCRIPT_ATTR}="true"]`,
    )
    .forEach((script) => {
      script.remove();
    });

  if (timedVisualClips.length > 0 || animatedClips.length > 0) {
    const script = doc.createElement("script");
    script.setAttribute(STUDIO_TIMELINE_SCRIPT_ATTR, "true");
    script.textContent = buildStudioTimelineScript(
      rootCompositionId,
      timedVisualClips,
      animatedClips,
    );
    (doc.body || root).appendChild(script);
  }

  return "<!DOCTYPE html>\n" + root.outerHTML;
}

export function setClipKeyframesInRootHtml(
  html: string,
  clipId: string,
  keyframes: Keyframe[],
): string {
  if (!html || typeof DOMParser === "undefined") return html;

  const doc = new DOMParser().parseFromString(html, "text/html");
  const el = doc.getElementById(clipId);
  if (!el) return html;

  writeClipKeyframesToElement(el, normalizeKeyframesForElement(el, keyframes));
  return syncRootKeyframesHtml("<!DOCTYPE html>\n" + doc.documentElement.outerHTML);
}

export function setClipMotionModelInRootHtml(
  html: string,
  clipId: string,
  keyframes: Keyframe[],
  motionSteps: ClipMotionStepMeta[],
): string {
  if (!html || typeof DOMParser === "undefined") return html;

  const doc = new DOMParser().parseFromString(html, "text/html");
  const el = doc.getElementById(clipId);
  if (!el) return html;

  const materialized = materializeMotionModelForElement(el, keyframes, motionSteps);
  writeClipKeyframesToElement(el, materialized.keyframes);
  writeClipMotionStepMetasToElement(el, materialized.motionSteps);
  return syncRootKeyframesHtml("<!DOCTYPE html>\n" + doc.documentElement.outerHTML);
}

export function getKeyframesForProperty(
  keyframes: Keyframe[],
  property: ClipKeyframeProperty,
): Keyframe[] {
  return keyframes
    .filter((keyframe) => keyframeHasProperty(keyframe, property))
    .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

export function keyframeHasProperty(
  keyframe: Keyframe | null | undefined,
  property: ClipKeyframeProperty,
): boolean {
  if (!keyframe) return false;
  const props = keyframe.properties ?? {};
  switch (property) {
    case "position":
      return props.x !== undefined || props.y !== undefined;
    case "scale":
      return props.scale !== undefined;
    case "rotation":
      return props.rotation !== undefined;
    case "opacity":
      return props.opacity !== undefined;
  }
}

export function keyframeDisplayValues(
  clip: ClipKeyframeBase,
  keyframe: Keyframe,
): ClipKeyframeDisplayValues {
  const props = keyframe.properties ?? {};
  return {
    x: props.x !== undefined ? clip.x + props.x : undefined,
    y: props.y !== undefined ? clip.y + props.y : undefined,
    scale: props.scale,
    rotation: props.rotation,
    opacity: props.opacity,
  };
}

export function deriveClipMotionSteps(
  clip: ClipKeyframeBase & { duration: number },
  motionSteps: ClipMotionStepMeta[],
): ClipMotionStep[] {
  const keyframesById = new Map((clip.keyframes ?? []).map((keyframe) => [keyframe.id, keyframe]));
  const steps: ClipMotionStep[] = [];
  for (const meta of normalizeMotionStepMetas(clip.keyframes ?? [], motionSteps)) {
    const checkpoints = meta.checkpointIds
      .map((id) => keyframesById.get(id))
      .filter((keyframe): keyframe is Keyframe => !!keyframe)
      .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
    if (checkpoints.length < 2) continue;
    const start = checkpoints[0]!;
    const end = checkpoints[checkpoints.length - 1]!;
    if (end.time <= start.time + TIME_EPSILON) continue;
    steps.push({
      ...meta,
      checkpointIds: checkpoints.map((keyframe) => keyframe.id),
      checkpoints: checkpoints.map((keyframe, index) => ({
        id: keyframe.id,
        time: keyframe.time,
        values: keyframeDisplayValues(clip, keyframe),
        ease: keyframe.ease,
        label: checkpointLabel(index, checkpoints.length),
      })),
      startKeyframeId: start.id,
      endKeyframeId: end.id,
      startTime: start.time,
      endTime: end.time,
      ease: end.ease,
      label: meta.name ?? "Motion",
      pathStyle: normalizePathStyle(meta.pathStyle),
    });
  }
  return steps.sort(
    (a, b) => a.startTime - b.startTime || a.endTime - b.endTime || a.id.localeCompare(b.id),
  );
}

export function addMotionStepToClip(
  clip: ClipKeyframeBase & {
    duration: number;
    motionStepMetas?: ClipMotionStepMeta[];
  },
  args: {
    time: number;
    createId: () => string;
  },
): ClipMotionStepMutation {
  const { startTime, endTime } = defaultMotionTiming(args.time, clip.duration);
  const startState = sampleClipKeyframedState(clip, startTime);
  const startId = args.createId();
  const endId = args.createId();
  const startFrame: Keyframe = {
    id: startId,
    time: startTime,
    properties: storedValuesFromState(clip, startState),
  };
  const endFrame: Keyframe = {
    id: endId,
    time: endTime,
    properties: storedValuesFromState(clip, startState),
    ease: "power2.out",
  };
  const keyframes = sortAndPruneKeyframes(
    normalizeStandaloneKeyframes([...(clip.keyframes ?? []), startFrame, endFrame], clip.duration),
  );

  const motionStep: ClipMotionStepMeta = {
    id: args.createId(),
    checkpointIds: [startId, endId],
  };
  const motionSteps = normalizeMotionStepMetas(keyframes, [
    ...(clip.motionStepMetas ?? []),
    motionStep,
  ]);

  return {
    keyframes,
    motionSteps,
    selection: { keyframeId: endId, property: "position" },
  };
}

export function addMotionCheckpointToClip(
  clip: ClipKeyframeBase & {
    duration: number;
    motionStepMetas?: ClipMotionStepMeta[];
  },
  args: {
    motionId: string;
    time: number;
    createId: () => string;
  },
): ClipMotionStepMutation {
  const step = deriveClipMotionSteps(clip, clip.motionStepMetas ?? []).find(
    (candidate) => candidate.id === args.motionId,
  );
  if (!step) {
    return {
      keyframes: clip.keyframes ?? [],
      motionSteps: clip.motionStepMetas ?? [],
      selection: null,
    };
  }

  const time = clampTime(args.time, clip.duration);
  const existingCheckpoint = step.checkpoints.find(
    (checkpoint) => Math.abs(checkpoint.time - time) <= TIME_EPSILON,
  );
  if (existingCheckpoint) {
    return {
      keyframes: clip.keyframes ?? [],
      motionSteps: clip.motionStepMetas ?? [],
      selection: { keyframeId: existingCheckpoint.id, property: "position" },
    };
  }

  const state = sampleClipKeyframedState(clip, time);
  const checkpoint: Keyframe = {
    id: args.createId(),
    time,
    properties: storedValuesFromState(clip, state),
    ease: "power2.out",
  };
  const keyframes = sortAndPruneKeyframes(
    normalizeStandaloneKeyframes([...(clip.keyframes ?? []), checkpoint], clip.duration),
  );
  const motionSteps = normalizeMotionStepMetas(
    keyframes,
    (clip.motionStepMetas ?? []).map((meta) =>
      meta.id === step.id
        ? normalizeMotionStepMeta({
            ...meta,
            checkpointIds: [...step.checkpointIds, checkpoint.id],
          })
        : meta,
    ),
  );

  return {
    keyframes,
    motionSteps,
    selection: { keyframeId: checkpoint.id, property: "position" },
  };
}

export function moveMotionStep(
  clip: ClipKeyframeBase & {
    duration: number;
    motionStepMetas?: ClipMotionStepMeta[];
  },
  args: {
    motionId: string;
    startTime?: number;
    endTime?: number;
    selectEndpoint?: ClipMotionEndpoint;
  },
): ClipMotionStepMutation {
  const step = deriveClipMotionSteps(clip, clip.motionStepMetas ?? []).find(
    (candidate) => candidate.id === args.motionId,
  );
  if (!step) {
    return {
      keyframes: clip.keyframes ?? [],
      motionSteps: clip.motionStepMetas ?? [],
      selection: null,
    };
  }

  const rawStart = args.startTime ?? step.startTime;
  const rawEnd = args.endTime ?? step.endTime;
  const minSpan = 0.05;
  let startTime = clampTime(rawStart, clip.duration);
  let endTime = clampTime(rawEnd, clip.duration);
  if (endTime < startTime + minSpan) {
    if (args.startTime !== undefined) startTime = Math.max(0, endTime - minSpan);
    else endTime = Math.min(clip.duration, startTime + minSpan);
  }

  const span = Math.max(TIME_EPSILON, step.endTime - step.startTime);
  const nextKeyframes = (clip.keyframes ?? []).map((keyframe) => {
    if (!step.checkpointIds.includes(keyframe.id)) return keyframe;
    let time = keyframe.time;
    if (keyframe.id === step.startKeyframeId) time = startTime;
    else if (keyframe.id === step.endKeyframeId) time = endTime;
    else if (args.startTime !== undefined || args.endTime !== undefined) {
      const t = (keyframe.time - step.startTime) / span;
      time = startTime + (endTime - startTime) * t;
    }
    return { ...keyframe, time: clampTime(time, clip.duration) };
  });
  const keyframes = normalizeStandaloneKeyframes(nextKeyframes, clip.duration);
  const nextMetas = normalizeMotionStepMetas(keyframes, clip.motionStepMetas ?? []);
  const movedStep = deriveClipMotionSteps({ ...clip, keyframes }, nextMetas).find(
    (candidate) => candidate.id === step.id,
  );
  const selectedId =
    args.selectEndpoint === "begin"
      ? (movedStep?.startKeyframeId ?? step.startKeyframeId)
      : (movedStep?.endKeyframeId ?? step.endKeyframeId);

  return {
    keyframes,
    motionSteps: nextMetas,
    selection: { keyframeId: selectedId, property: "position" },
  };
}

export function moveMotionCheckpoint(
  clip: ClipKeyframeBase & {
    duration: number;
    motionStepMetas?: ClipMotionStepMeta[];
  },
  args: {
    motionId: string;
    checkpointId: string;
    time: number;
  },
): ClipMotionStepMutation {
  const step = deriveClipMotionSteps(clip, clip.motionStepMetas ?? []).find(
    (candidate) => candidate.id === args.motionId,
  );
  if (!step || !step.checkpointIds.includes(args.checkpointId)) {
    return {
      keyframes: clip.keyframes ?? [],
      motionSteps: clip.motionStepMetas ?? [],
      selection: null,
    };
  }

  const keyframes = normalizeStandaloneKeyframes(
    (clip.keyframes ?? []).map((keyframe) =>
      keyframe.id === args.checkpointId
        ? { ...keyframe, time: clampTime(args.time, clip.duration) }
        : keyframe,
    ),
    clip.duration,
  );
  return {
    keyframes,
    motionSteps: normalizeMotionStepMetas(keyframes, clip.motionStepMetas ?? []),
    selection: { keyframeId: args.checkpointId, property: "position" },
  };
}

export function removeMotionStep(
  clip: ClipKeyframeBase & {
    duration: number;
    motionStepMetas?: ClipMotionStepMeta[];
  },
  motionId: string,
): { keyframes: Keyframe[]; motionSteps: ClipMotionStepMeta[] } {
  const step = deriveClipMotionSteps(clip, clip.motionStepMetas ?? []).find(
    (candidate) => candidate.id === motionId,
  );
  if (!step) return { keyframes: clip.keyframes ?? [], motionSteps: clip.motionStepMetas ?? [] };

  const withoutStep = (clip.keyframes ?? []).filter(
    (keyframe) => !step.checkpointIds.includes(keyframe.id),
  );
  const motionSteps = normalizeMotionStepMetas(
    withoutStep,
    (clip.motionStepMetas ?? []).filter((meta) => meta.id !== motionId),
  );
  return { keyframes: withoutStep, motionSteps };
}

export function removeMotionCheckpoint(
  clip: ClipKeyframeBase & {
    duration: number;
    motionStepMetas?: ClipMotionStepMeta[];
  },
  motionId: string,
  checkpointId: string,
): { keyframes: Keyframe[]; motionSteps: ClipMotionStepMeta[] } {
  const step = deriveClipMotionSteps(clip, clip.motionStepMetas ?? []).find(
    (candidate) => candidate.id === motionId,
  );
  if (!step || !step.checkpointIds.includes(checkpointId) || step.checkpointIds.length <= 2) {
    return { keyframes: clip.keyframes ?? [], motionSteps: clip.motionStepMetas ?? [] };
  }

  const keyframes = (clip.keyframes ?? []).filter((keyframe) => keyframe.id !== checkpointId);
  const motionSteps = normalizeMotionStepMetas(
    keyframes,
    (clip.motionStepMetas ?? []).map((meta) =>
      meta.id === motionId
        ? {
            ...meta,
            checkpointIds: step.checkpointIds.filter((id) => id !== checkpointId),
          }
        : meta,
    ),
  );
  return { keyframes, motionSteps };
}

export function renameMotionStep(
  clip: ClipKeyframeBase & {
    motionStepMetas?: ClipMotionStepMeta[];
  },
  motionId: string,
  name: string,
): ClipMotionStepMeta[] {
  return normalizeMotionStepMetas(
    clip.keyframes ?? [],
    (clip.motionStepMetas ?? []).map((meta) =>
      meta.id === motionId ? normalizeMotionStepMeta({ ...meta, name }) : meta,
    ),
  );
}

export function setMotionStepPathStyle(
  clip: ClipKeyframeBase & {
    motionStepMetas?: ClipMotionStepMeta[];
  },
  motionId: string,
  pathStyle: PathStyle,
): ClipMotionStepMeta[] {
  return normalizeMotionStepMetas(
    clip.keyframes ?? [],
    (clip.motionStepMetas ?? []).map((meta) =>
      meta.id === motionId ? normalizeMotionStepMeta({ ...meta, pathStyle }) : meta,
    ),
  );
}

export function storedValuesFromDisplayValues(
  clip: ClipKeyframeBase,
  property: ClipKeyframeProperty,
  values: ClipKeyframeDisplayValues,
): StoredKeyframeValues {
  switch (property) {
    case "position":
      return {
        x: Number.isFinite(values.x) ? Number(values.x) - clip.x : 0,
        y: Number.isFinite(values.y) ? Number(values.y) - clip.y : 0,
      };
    case "scale":
      return {
        scale: clampScale(values.scale ?? 1),
      };
    case "rotation":
      return {
        rotation: clampFinite(values.rotation ?? clip.rotation, clip.rotation),
      };
    case "opacity":
      return {
        opacity: clampOpacity(values.opacity ?? clip.opacity),
      };
  }
}

function storedValuesFromState(
  clip: ClipKeyframeBase,
  state: ClipKeyframedState,
): Partial<KeyframeProperties> {
  return {
    x: round(state.x - clip.x),
    y: round(state.y - clip.y),
    scale: clampScale(state.scale),
    rotation: clampFinite(state.rotation, clip.rotation),
    opacity: clampOpacity(state.opacity),
  };
}

export function upsertKeyframeProperty(
  keyframes: Keyframe[],
  args: {
    property: ClipKeyframeProperty;
    time: number;
    duration: number;
    values: StoredKeyframeValues;
    ease?: string;
    createId: () => string;
  },
): ClipKeyframeMutation {
  const time = clampTime(args.time, args.duration);
  const next = normalizeStandaloneKeyframes(keyframes, args.duration);
  const existing = next.find((keyframe) => Math.abs(keyframe.time - time) <= TIME_EPSILON);
  const keyframe = existing ?? {
    id: args.createId(),
    time,
    properties: {},
  };

  keyframe.time = time;
  keyframe.properties = {
    ...(keyframe.properties ?? {}),
    ...filterStoredValues(args.property, args.values),
  };
  if (args.ease !== undefined) keyframe.ease = args.ease || undefined;
  if (!existing) next.push(keyframe);

  return {
    keyframes: sortAndPruneKeyframes(next),
    keyframeId: keyframe.id,
  };
}

export function updateKeyframeProperty(
  keyframes: Keyframe[],
  args: {
    keyframeId: string;
    property: ClipKeyframeProperty;
    duration: number;
    values?: StoredKeyframeValues;
    ease?: string;
  },
): ClipKeyframeMutation {
  let foundId: string | null = null;
  const next = normalizeStandaloneKeyframes(keyframes, args.duration).map((keyframe) => {
    if (keyframe.id !== args.keyframeId) return keyframe;
    foundId = keyframe.id;
    const properties = {
      ...(keyframe.properties ?? {}),
      ...(args.values ? filterStoredValues(args.property, args.values) : {}),
    };
    return {
      ...keyframe,
      ease: args.ease !== undefined ? args.ease || undefined : keyframe.ease,
      properties,
    };
  });

  return {
    keyframes: sortAndPruneKeyframes(next),
    keyframeId: foundId,
  };
}

export function moveKeyframeProperty(
  keyframes: Keyframe[],
  args: {
    keyframeId: string;
    property: ClipKeyframeProperty;
    time: number;
    duration: number;
  },
): ClipKeyframeMutation {
  const source = keyframes.find((keyframe) => keyframe.id === args.keyframeId);
  if (!source || !keyframeHasProperty(source, args.property)) {
    return { keyframes: normalizeStandaloneKeyframes(keyframes, args.duration), keyframeId: null };
  }

  const values = extractStoredValues(source, args.property);
  const ease = source.ease;
  const withoutProperty = removePropertyFromKeyframes(keyframes, args.keyframeId, args.property);
  const targetTime = clampTime(args.time, args.duration);
  const sourceRemainder = withoutProperty.find((keyframe) => keyframe.id === source.id);
  const canReuseSourceId =
    !sourceRemainder || Object.keys(sourceRemainder.properties ?? {}).length === 0;
  const keyframesAvailableForTarget = canReuseSourceId
    ? withoutProperty.filter((keyframe) => keyframe.id !== source.id)
    : withoutProperty;
  const target =
    keyframesAvailableForTarget.find(
      (keyframe) => Math.abs(keyframe.time - targetTime) <= TIME_EPSILON,
    ) ??
    ({
      id: canReuseSourceId ? source.id : `${source.id}-${args.property}`,
      time: targetTime,
      properties: {},
    } satisfies Keyframe);

  target.time = targetTime;
  target.properties = {
    ...(target.properties ?? {}),
    ...values,
  };
  if (ease !== undefined) target.ease = ease;
  if (!keyframesAvailableForTarget.includes(target)) keyframesAvailableForTarget.push(target);

  return {
    keyframes: sortAndPruneKeyframes(
      normalizeStandaloneKeyframes(keyframesAvailableForTarget, args.duration),
    ),
    keyframeId: target.id,
  };
}

export function removeKeyframeProperty(
  keyframes: Keyframe[],
  keyframeId: string,
  property: ClipKeyframeProperty,
): Keyframe[] {
  return sortAndPruneKeyframes(removePropertyFromKeyframes(keyframes, keyframeId, property));
}

export function sampleClipKeyframedState(
  clip: ClipKeyframeBase,
  localTime: number,
): ClipKeyframedState {
  const keyframes = clip.keyframes ?? [];
  return {
    x: clip.x + sampleProperty(keyframes, "position", localTime, 0, "x"),
    y: clip.y + sampleProperty(keyframes, "position", localTime, 0, "y"),
    scale: sampleProperty(keyframes, "scale", localTime, 1, "scale"),
    rotation: sampleProperty(keyframes, "rotation", localTime, clip.rotation, "rotation"),
    opacity: sampleProperty(keyframes, "opacity", localTime, clip.opacity, "opacity"),
  };
}

export function formatKeyframePropertyLabel(property: ClipKeyframeProperty): string {
  switch (property) {
    case "position":
      return "Position";
    case "scale":
      return "Scale";
    case "rotation":
      return "Rotation";
    case "opacity":
      return "Opacity";
  }
}

export function checkpointLabel(index: number, count: number): string {
  if (index <= 0) return "Begin";
  if (index >= count - 1) return "End";
  return `Point ${index}`;
}

function readClipKeyframesFromElement(el: Element): Keyframe[] {
  const raw = el.getAttribute("data-keyframes");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isKeyframeLike).map((keyframe) => ({
      id: keyframe.id,
      time: keyframe.time,
      properties: { ...keyframe.properties },
      ease: typeof keyframe.ease === "string" ? keyframe.ease : undefined,
    }));
  } catch {
    return [];
  }
}

function writeClipKeyframesToElement(el: Element, keyframes: Keyframe[]): void {
  if (keyframes.length === 0) {
    el.removeAttribute("data-keyframes");
    return;
  }
  el.setAttribute("data-keyframes", JSON.stringify(keyframes));
}

function readClipMotionStepMetasFromElement(el: Element): ClipMotionStepMeta[] {
  const raw = el.getAttribute(STUDIO_MOTION_STEPS_ATTR);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMotionStepMetaLike).map((step) => ({
      id: step.id,
      checkpointIds: checkpointIdsForMeta(step),
      name: sanitizeMotionStepName(step.name),
      pathStyle: normalizePathStyle(step.pathStyle),
    }));
  } catch {
    return [];
  }
}

function writeClipMotionStepMetasToElement(el: Element, motionSteps: ClipMotionStepMeta[]): void {
  if (motionSteps.length === 0) {
    el.removeAttribute(STUDIO_MOTION_STEPS_ATTR);
    return;
  }
  el.setAttribute(STUDIO_MOTION_STEPS_ATTR, JSON.stringify(motionSteps));
}

function normalizeKeyframesForElement(el: HTMLElement, keyframes: Keyframe[]): Keyframe[] {
  const duration = parseElementDuration(el);
  return normalizeStandaloneKeyframes(keyframes, duration);
}

function normalizeStandaloneKeyframes(keyframes: Keyframe[], duration: number): Keyframe[] {
  return sortAndPruneKeyframes(
    keyframes.map((keyframe) => ({
      id: keyframe.id,
      time: clampTime(keyframe.time, duration),
      properties: sanitizeProperties(keyframe.properties ?? {}),
      ease: typeof keyframe.ease === "string" && keyframe.ease ? keyframe.ease : undefined,
    })),
  );
}

function sortAndPruneKeyframes(keyframes: Keyframe[]): Keyframe[] {
  return keyframes
    .filter((keyframe) => Object.keys(keyframe.properties ?? {}).length > 0)
    .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

function normalizeMotionStepMetas(
  keyframes: Keyframe[],
  motionSteps: ClipMotionStepMeta[],
): ClipMotionStepMeta[] {
  const keyframesById = new Map(keyframes.map((keyframe) => [keyframe.id, keyframe]));
  const seenMotionIds = new Set<string>();
  const usedCheckpointIds = new Set<string>();
  const normalized: ClipMotionStepMeta[] = [];

  for (const step of motionSteps) {
    if (!isAuthoredMotionStepMeta(step) || seenMotionIds.has(step.id)) continue;

    const checkpointIds = checkpointIdsForMeta(step)
      .filter((id, index, ids) => ids.indexOf(id) === index)
      .filter((id) => keyframesById.has(id))
      .filter((id) => !isLegacySyntheticKeyframeId(id))
      .filter((id) => !usedCheckpointIds.has(id))
      .sort((a, b) => {
        const aTime = keyframesById.get(a)?.time ?? 0;
        const bTime = keyframesById.get(b)?.time ?? 0;
        return aTime - bTime || a.localeCompare(b);
      });
    if (checkpointIds.length < 2) continue;

    seenMotionIds.add(step.id);
    checkpointIds.forEach((id) => usedCheckpointIds.add(id));
    normalized.push(normalizeMotionStepMeta({ ...step, checkpointIds }));
  }

  return normalized;
}

function materializeMotionModelForElement(
  el: HTMLElement,
  keyframes: Keyframe[],
  motionSteps: ClipMotionStepMeta[],
): { keyframes: Keyframe[]; motionSteps: ClipMotionStepMeta[] } {
  const duration = parseElementDuration(el);
  const normalized = normalizeStandaloneKeyframes(
    keyframes.filter((keyframe) => !isLegacySyntheticKeyframeId(keyframe.id)),
    duration,
  );
  return {
    keyframes: normalized,
    motionSteps: normalizeMotionStepMetas(normalized, motionSteps),
  };
}

function normalizeMotionStepMeta(step: ClipMotionStepMeta): ClipMotionStepMeta {
  const name = sanitizeMotionStepName(step.name);
  const pathStyle = normalizePathStyle(step.pathStyle);
  return {
    id: step.id,
    checkpointIds: checkpointIdsForMeta(step),
    ...(name ? { name } : {}),
    // Only persist non-default to keep stored JSON tidy.
    ...(pathStyle === "smooth" ? { pathStyle } : {}),
  };
}

function sanitizeMotionStepName(name: unknown): string | undefined {
  if (typeof name !== "string") return undefined;
  const trimmed = name.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, 80) : undefined;
}

function isAuthoredMotionStepMeta(step: ClipMotionStepMeta): boolean {
  return (
    !step.id.startsWith(LEGACY_AUTO_MOTION_ID_PREFIX) &&
    checkpointIdsForMeta(step).every((id) => !isLegacySyntheticKeyframeId(id))
  );
}

function isLegacySyntheticKeyframeId(id: string): boolean {
  return id.startsWith(`${LEGACY_SYNTHETIC_MOTION_BASE_PREFIX}-`);
}

function sanitizeProperties(properties: Partial<KeyframeProperties>): Partial<KeyframeProperties> {
  const out: Partial<KeyframeProperties> = {};
  if (Number.isFinite(properties.x)) out.x = Number(properties.x);
  if (Number.isFinite(properties.y)) out.y = Number(properties.y);
  if (typeof properties.scale === "number" && Number.isFinite(properties.scale)) {
    out.scale = clampScale(properties.scale);
  }
  if (Number.isFinite(properties.rotation)) out.rotation = Number(properties.rotation);
  if (typeof properties.opacity === "number" && Number.isFinite(properties.opacity)) {
    out.opacity = clampOpacity(properties.opacity);
  }
  return out;
}

function filterStoredValues(
  property: ClipKeyframeProperty,
  values: StoredKeyframeValues,
): StoredKeyframeValues {
  const sanitized = sanitizeProperties(values);
  switch (property) {
    case "position":
      return { x: sanitized.x ?? 0, y: sanitized.y ?? 0 };
    case "scale":
      return { scale: sanitized.scale ?? 1 };
    case "rotation":
      return { rotation: sanitized.rotation ?? 0 };
    case "opacity":
      return { opacity: sanitized.opacity ?? 1 };
  }
}

function extractStoredValues(
  keyframe: Keyframe,
  property: ClipKeyframeProperty,
): StoredKeyframeValues {
  const props = keyframe.properties ?? {};
  switch (property) {
    case "position":
      return { x: props.x ?? 0, y: props.y ?? 0 };
    case "scale":
      return { scale: props.scale ?? 1 };
    case "rotation":
      return { rotation: props.rotation ?? 0 };
    case "opacity":
      return { opacity: props.opacity ?? 1 };
  }
}

function removePropertyFromKeyframes(
  keyframes: Keyframe[],
  keyframeId: string,
  property: ClipKeyframeProperty,
): Keyframe[] {
  return keyframes.map((keyframe) => {
    if (keyframe.id !== keyframeId) return { ...keyframe, properties: { ...keyframe.properties } };
    const properties = { ...(keyframe.properties ?? {}) };
    switch (property) {
      case "position":
        delete properties.x;
        delete properties.y;
        break;
      case "scale":
        delete properties.scale;
        break;
      case "rotation":
        delete properties.rotation;
        break;
      case "opacity":
        delete properties.opacity;
        break;
    }
    return { ...keyframe, properties };
  });
}

function buildStudioTimelineScript(
  compositionId: string,
  timedVisualClips: HTMLElement[],
  clips: Array<{ el: HTMLElement; keyframes: Keyframe[]; motionSteps: ClipMotionStepMeta[] }>,
): string {
  const lines: string[] = [
    "(function(){",
    "  window.__timelines = window.__timelines || {};",
    `  const tl = window.__timelines[${JSON.stringify(compositionId)}];`,
    '  if (!tl || typeof tl.set !== "function" || typeof tl.to !== "function") return;',
  ];

  for (const el of timedVisualClips) {
    lines.push(...compileClipLifecycle(el));
  }

  for (const { el, keyframes, motionSteps } of clips) {
    lines.push(...compileElementKeyframes(el, keyframes, motionSteps));
  }

  lines.push("})();");
  return lines.join("\n");
}

function compileElementKeyframes(
  el: HTMLElement,
  keyframes: Keyframe[],
  motionSteps: ClipMotionStepMeta[],
): string[] {
  const lines: string[] = [];
  const selector = JSON.stringify(`#${el.id}`);
  const clipStart = parseElementStart(el);
  const base = readElementBaseState(el);

  for (const property of CLIP_KEYFRAME_PROPERTIES) {
    const propertyKeyframes = getKeyframesForProperty(keyframes, property);
    if (propertyKeyframes.length === 0) continue;
    if (property === "position") {
      lines.push(
        ...compilePositionKeyframes({
          selector,
          clipStart,
          keyframes: propertyKeyframes,
          base,
          motionSteps,
        }),
      );
      continue;
    }
    lines.push(
      ...compilePropertyKeyframes({
        selector,
        clipStart,
        property,
        keyframes: propertyKeyframes,
        base,
      }),
    );
  }

  return lines;
}

function compileClipLifecycle(el: HTMLElement): string[] {
  const selector = JSON.stringify(`#${el.id}`);
  const clipStart = parseElementStart(el);
  const clipDuration = parseElementDuration(el);
  const base = readElementBaseState(el);
  const lines = [];
  if (clipStart > TIME_EPSILON) lines.push(formatSet(selector, { visibility: "hidden" }, 0));
  lines.push(formatSet(selector, { visibility: "visible", opacity: base.opacity }, clipStart));
  if (clipDuration > TIME_EPSILON) {
    lines.push(formatSet(selector, { visibility: "hidden" }, clipStart + clipDuration));
  }
  return lines;
}

/**
 * Position is special: it's the one property whose path can be smoothed across
 * a motion step. Builds samples via the same `buildPositionPath` the stage
 * overlay uses, so the runtime tweens through the exact points the user saw on
 * the canvas. Pinned by motion-path.test.ts.
 */
function compilePositionKeyframes(args: {
  selector: string;
  clipStart: number;
  keyframes: Keyframe[];
  base: ClipKeyframedState;
  motionSteps: ClipMotionStepMeta[];
}): string[] {
  const lines: string[] = [];
  if (args.keyframes.length === 0) return lines;

  const stepByCheckpointId = new Map<string, ClipMotionStepMeta>();
  for (const step of args.motionSteps) {
    for (const id of step.checkpointIds) stepByCheckpointId.set(id, step);
  }

  // Walk the (time-sorted) position keyframes, peeling off smooth-step runs as
  // contiguous samples and falling back to per-keyframe sampling otherwise. The
  // result is one flat list of samples that the emit loop converts to tweens.
  const samples: PositionPathSample[] = [];
  const emittedStepIds = new Set<string>();
  let i = 0;
  while (i < args.keyframes.length) {
    const kf = args.keyframes[i]!;
    const step = stepByCheckpointId.get(kf.id);
    if (step?.pathStyle === "smooth" && !emittedStepIds.has(step.id)) {
      const runKeyframes = args.keyframes.filter((candidate) =>
        step.checkpointIds.includes(candidate.id),
      );
      // The run must start at this index to be valid (other runs anchor at
      // their own start keyframe).
      if (runKeyframes.length >= 3 && runKeyframes[0]?.id === kf.id) {
        const checkpoints: PositionCheckpoint[] = runKeyframes.map((rk) => ({
          id: rk.id,
          time: rk.time,
          x: args.base.x + (rk.properties.x ?? 0),
          y: args.base.y + (rk.properties.y ?? 0),
          ease: rk.ease,
        }));
        samples.push(...buildPositionPath(checkpoints, "smooth"));
        emittedStepIds.add(step.id);
        const lastInRun = runKeyframes[runKeyframes.length - 1]!;
        i = args.keyframes.indexOf(lastInRun) + 1;
        continue;
      }
    }

    samples.push({
      time: kf.time,
      x: args.base.x + (kf.properties.x ?? 0),
      y: args.base.y + (kf.properties.y ?? 0),
      checkpointId: kf.id,
      ease: kf.ease,
    });
    i += 1;
  }

  return emitPositionSamples(args.selector, args.clipStart, args.base, samples);
}

function emitPositionSamples(
  selector: string,
  clipStart: number,
  base: ClipKeyframedState,
  samples: PositionPathSample[],
): string[] {
  const lines: string[] = [];
  if (samples.length === 0) return lines;

  const baseVars = { x: base.x, y: base.y };
  if (samples[0]!.time > TIME_EPSILON) {
    lines.push(formatSet(selector, baseVars, clipStart));
  }

  let previousTime = 0;
  for (const sample of samples) {
    const vars = { x: sample.x, y: sample.y };
    const duration = Math.max(0, sample.time - previousTime);
    if (duration <= TIME_EPSILON) {
      lines.push(formatSet(selector, vars, clipStart + sample.time));
    } else {
      lines.push(formatTo(selector, vars, clipStart + previousTime, duration, sample.ease));
    }
    previousTime = sample.time;
  }

  return lines;
}

/**
 * Compose the base per-axis mirror into an emitted uniform-scale var, so animating `scale` (or the
 * base set that precedes it) preserves a flip instead of resetting scaleX/scaleY to +scale. Mirrors
 * the composition in transform.ts's toGsapTransformVars. Carry-forward keeps the logical uniform
 * `scale` (pre-flip); only the emitted gsap vars are composed.
 */
function withFlip(vars: Record<string, number>, base: ClipKeyframedState): Record<string, number> {
  if (!("scale" in vars)) return vars;
  const fx = base.scaleX ?? 1;
  const fy = base.scaleY ?? 1;
  if (fx === 1 && fy === 1) return vars;
  const { scale, ...rest } = vars;
  const sx = scale * fx;
  const sy = scale * fy;
  return sx === sy ? { ...rest, scale: sx } : { ...rest, scaleX: sx, scaleY: sy };
}

function compilePropertyKeyframes(args: {
  selector: string;
  clipStart: number;
  property: ClipKeyframeProperty;
  keyframes: Keyframe[];
  base: ClipKeyframedState;
}): string[] {
  const lines: string[] = [];
  const baseVars = varsForProperty(args.property, args.base);
  let previousTime = 0;
  let previousVars = baseVars;

  const first = args.keyframes[0];
  if (!first) return lines;

  if (first.time > TIME_EPSILON) {
    lines.push(formatSet(args.selector, withFlip(baseVars, args.base), args.clipStart));
  }

  for (const keyframe of args.keyframes) {
    const nextVars = varsForKeyframe(args.property, keyframe, previousVars, args.base);
    const position = args.clipStart + previousTime;
    const duration = Math.max(0, keyframe.time - previousTime);
    if (duration <= TIME_EPSILON) {
      lines.push(
        formatSet(args.selector, withFlip(nextVars, args.base), args.clipStart + keyframe.time),
      );
    } else {
      lines.push(
        formatTo(args.selector, withFlip(nextVars, args.base), position, duration, keyframe.ease),
      );
    }
    previousTime = keyframe.time;
    previousVars = nextVars;
  }

  return lines;
}

function varsForProperty(
  property: ClipKeyframeProperty,
  state: ClipKeyframedState,
): Record<string, number> {
  switch (property) {
    case "position":
      return { x: state.x, y: state.y };
    case "scale":
      return { scale: state.scale };
    case "rotation":
      return { rotation: state.rotation };
    case "opacity":
      return { opacity: state.opacity };
  }
}

function varsForKeyframe(
  property: ClipKeyframeProperty,
  keyframe: Keyframe,
  previousVars: Record<string, number>,
  base: ClipKeyframedState,
): Record<string, number> {
  const props = keyframe.properties ?? {};
  switch (property) {
    case "position":
      return {
        x: base.x + (props.x ?? previousVars.x ?? 0),
        y: base.y + (props.y ?? previousVars.y ?? 0),
      };
    case "scale":
      return { scale: props.scale ?? previousVars.scale ?? base.scale };
    case "rotation":
      return { rotation: props.rotation ?? previousVars.rotation ?? base.rotation };
    case "opacity":
      return { opacity: props.opacity ?? previousVars.opacity ?? base.opacity };
  }
}

function formatSet(
  selector: string,
  vars: Record<string, number | string>,
  position: number,
): string {
  return `  tl.set(${selector}, ${formatVars(vars)}, ${formatNumber(position)});`;
}

function formatTo(
  selector: string,
  vars: Record<string, number>,
  position: number,
  duration: number,
  ease: string | undefined,
): string {
  return `  tl.to(${selector}, ${formatVars({
    ...vars,
    duration,
    ...(ease ? { ease } : {}),
  })}, ${formatNumber(position)});`;
}

function formatVars(vars: Record<string, number | string>): string {
  const entries = Object.entries(vars).map(([key, value]) => {
    if (typeof value === "string") return `${key}: ${JSON.stringify(value)}`;
    return `${key}: ${formatNumber(value)}`;
  });
  return `{ ${entries.join(", ")} }`;
}

function sampleProperty(
  keyframes: Keyframe[],
  property: ClipKeyframeProperty,
  localTime: number,
  baseValue: number,
  propName: keyof KeyframeProperties,
): number {
  const relevant = getKeyframesForProperty(keyframes, property);
  if (relevant.length === 0) return baseValue;

  const first = relevant[0]!;
  const firstValue = numericProperty(first, propName, baseValue);
  if (localTime <= first.time) {
    if (first.time <= TIME_EPSILON) return firstValue;
    return lerp(baseValue, firstValue, clamp01(localTime / first.time));
  }

  for (let i = 1; i < relevant.length; i += 1) {
    const previous = relevant[i - 1]!;
    const next = relevant[i]!;
    if (localTime > next.time) continue;
    const previousValue = numericProperty(previous, propName, baseValue);
    const nextValue = numericProperty(next, propName, previousValue);
    const span = Math.max(TIME_EPSILON, next.time - previous.time);
    return lerp(previousValue, nextValue, clamp01((localTime - previous.time) / span));
  }

  return numericProperty(relevant[relevant.length - 1]!, propName, baseValue);
}

function numericProperty(
  keyframe: Keyframe,
  propName: keyof KeyframeProperties,
  fallback: number,
): number {
  const value = keyframe.properties?.[propName];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isKeyframeLike(value: unknown): value is Keyframe {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Keyframe;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.time === "number" &&
    Number.isFinite(candidate.time) &&
    typeof candidate.properties === "object" &&
    candidate.properties !== null
  );
}

function isMotionStepMetaLike(value: unknown): value is ClipMotionStepMeta {
  if (!value || typeof value !== "object") return false;
  const candidate = value as ClipMotionStepMeta;
  if (typeof candidate.id !== "string") return false;
  return (
    Array.isArray(candidate.checkpointIds) &&
    candidate.checkpointIds.every((id) => typeof id === "string")
  );
}

function checkpointIdsForMeta(step: ClipMotionStepMeta): string[] {
  return Array.isArray(step.checkpointIds) ? step.checkpointIds : [];
}

function readElementBaseState(el: HTMLElement): ClipKeyframedState {
  // Transform fields come through the ONE canonical reader — no hand-rolled getAttribute here,
  // so the timeline can't disagree with the rest of the app about a flip (or any future field).
  const t = readStudioTransform(el);
  return {
    x: t.x,
    y: t.y,
    scale: t.scale,
    scaleX: t.scaleX,
    scaleY: t.scaleY,
    rotation: t.rotation,
    // Opacity is a non-transform visual field; it stays a local read (not part of transform.ts).
    opacity:
      parseFiniteNumber(el.getAttribute("data-opacity")) ??
      parseFiniteNumber(el.style.opacity) ??
      1,
  };
}

function parseElementStart(el: Element): number {
  return Math.max(0, parseFiniteNumber(el.getAttribute("data-start")) ?? 0);
}

function parseElementDuration(el: Element): number {
  const start = parseElementStart(el);
  const duration = parseFiniteNumber(el.getAttribute("data-duration"));
  if (duration !== null && duration > 0) return duration;
  const end = parseFiniteNumber(el.getAttribute("data-end"));
  if (end !== null && end > start) return end - start;
  return 0;
}

function collectTimedVisualClips(doc: Document, rootCompositionId: string): HTMLElement[] {
  return Array.from(doc.querySelectorAll<HTMLElement>("[id][data-start]")).filter((el) => {
    if (isCompositionRoot(el, rootCompositionId)) return false;
    if (["AUDIO", "SCRIPT", "STYLE", "TEMPLATE"].includes(el.tagName)) return false;
    return parseElementDuration(el) > TIME_EPSILON;
  });
}

function resolveRootCompositionId(doc: Document): string | null {
  const rootId = doc.documentElement.getAttribute("data-composition-id");
  if (rootId) return rootId;
  return doc.getElementById("stage")?.getAttribute("data-composition-id") ?? null;
}

function isCompositionRoot(el: Element, rootCompositionId: string): boolean {
  return el.id === "stage" && el.getAttribute("data-composition-id") === rootCompositionId;
}

function clampTime(time: number, duration: number): number {
  if (!Number.isFinite(time)) return 0;
  return round(Math.max(0, Math.min(Math.max(0, duration), time)));
}

function defaultMotionTiming(
  time: number,
  duration: number,
): { startTime: number; endTime: number } {
  const startTime = clampTime(time, duration);
  const remaining = Math.max(0, duration - startTime);
  if (remaining >= 0.2) {
    return {
      startTime,
      endTime: clampTime(startTime + Math.min(DEFAULT_MOTION_DURATION, remaining), duration),
    };
  }
  return {
    startTime: clampTime(Math.max(0, duration - DEFAULT_MOTION_DURATION), duration),
    endTime: clampTime(duration, duration),
  };
}

function clampOpacity(value: number): number {
  return round(Math.max(0, Math.min(1, clampFinite(value, 1))));
}

function clampScale(value: number): number {
  return round(Math.max(MIN_SCALE, clampFinite(value, 1)));
}

function clampFinite(value: number, fallback: number): number {
  return Number.isFinite(value) ? round(value) : fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function formatNumber(value: number): string {
  return String(round(value));
}
