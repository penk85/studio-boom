// What the studio tells an LLM about the film, and what it will accept back.
//
// The AI half of Studio Boom is "paste a JSON suggestion, review it, approve it".
// That needs two halves that cannot drift: a context document describing what
// exists and what may be changed (OUT), and a suggestion format the editor
// validates and applies (IN). Both are built from the constants below, so what we
// advertise is exactly what we accept.
import type { Project } from "../types";
import { deriveProjectScenes, deriveProjectTimelineClips } from "../scenes";
import { isCharacterCompositionClip } from "../types";
import { TEXT_BLOCKS } from "../library-items";
import { EFFECT_PRESETS } from "../hyperframes/effect-presets";
import type { MotionPreset } from "../types";

export const PROJECT_CONTEXT_AI_OUT_KIND = "studioBoom.projectContext.v1";
export const PROJECT_SUGGESTION_AI_IN_KIND = "studioBoom.projectSuggestion.v1";
export const PROJECT_AI_SCHEMA_VERSION = 1;

/** Every operation the editor knows how to review and apply. */
export const PROJECT_OPERATIONS = [
  {
    op: "setClipTiming",
    doc: "Change when a clip starts and how long it lasts.",
    fields: "clipId, start? (seconds), duration? (seconds)",
  },
  {
    op: "setClipTransform",
    doc: "Move, resize, rotate, or fade a clip. Coordinates are canvas pixels, origin top-left.",
    fields: "clipId, x?, y?, width?, height?, rotation? (degrees), opacity? (0-1)",
  },
  {
    op: "setTextContent",
    doc: "Replace the words in a text clip.",
    fields: "clipId, content",
  },
  {
    op: "addAction",
    doc: "Give a character an action or expression from the library.",
    fields: "clipId, actionId, at? (seconds from clip start), intensity? (0-1)",
  },
  {
    op: "addTextBlock",
    doc: "Add a new text clip using one of the built-in blocks.",
    fields: "block, content?, start? (seconds)",
  },
  {
    op: "addEffect",
    doc: "Give a clip a ready-made effect (fade in, slide in, pop, slow zoom). Prefer this over hand-built transforms — it reads better in review and lands correctly for any clip size.",
    fields: "clipId, effectId",
  },
] as const;

export type ProjectOperationName = (typeof PROJECT_OPERATIONS)[number]["op"];

export const PROJECT_OPERATION_NAMES: ProjectOperationName[] = PROJECT_OPERATIONS.map(
  (entry) => entry.op,
);

export interface ProjectContextClip {
  id: string;
  name: string;
  kind: string;
  sceneId: string | null;
  start: number;
  duration: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  /** Present for text clips so the model can rewrite copy in place. */
  content?: string;
  /** Present for character clips so the model knows what it can make act. */
  characterId?: string;
}

export interface ProjectContextAiOut {
  kind: typeof PROJECT_CONTEXT_AI_OUT_KIND;
  schemaVersion: number;
  project: { name: string; width: number; height: number; fps: number; duration: number };
  scenes: { id: string; name: string; start: number; duration: number }[];
  clips: ProjectContextClip[];
  library: {
    actions: { id: string; name: string; category: string; duration: number }[];
    textBlocks: { id: string; label: string }[];
    effects: { id: string; label: string; doc: string }[];
  };
  operations: typeof PROJECT_OPERATIONS;
  instructions: string[];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildProjectContextAiOut(
  project: Project,
  actions: MotionPreset[],
): ProjectContextAiOut {
  const scenes = deriveProjectScenes(project);
  const clips = deriveProjectTimelineClips(project);

  return {
    kind: PROJECT_CONTEXT_AI_OUT_KIND,
    schemaVersion: PROJECT_AI_SCHEMA_VERSION,
    project: {
      name: project.name,
      width: project.hf.width,
      height: project.hf.height,
      fps: project.hf.fps,
      duration: project.hf.duration,
    },
    scenes: scenes.map((scene) => ({
      id: scene.id,
      name: scene.name || `Scene ${scene.index + 1}`,
      start: round(scene.start),
      duration: round(scene.duration),
    })),
    clips: clips.map((clip) => ({
      id: clip.id,
      name: clip.name,
      kind: isCharacterCompositionClip(clip) ? "character" : clip.kind,
      sceneId: clip.sceneId,
      start: round(clip.start),
      duration: round(clip.duration),
      x: Math.round(clip.x),
      y: Math.round(clip.y),
      width: Math.round(clip.width),
      height: Math.round(clip.height),
      rotation: round(clip.rotation),
      opacity: round(clip.opacity),
      ...(clip.kind === "text" ? { content: clip.content ?? "" } : {}),
      ...(isCharacterCompositionClip(clip) ? { characterId: clip.character.characterId } : {}),
    })),
    library: {
      actions: actions.map((action) => ({
        id: action.id,
        name: action.name,
        category: action.category,
        duration: action.duration,
      })),
      textBlocks: TEXT_BLOCKS.map((block) => ({ id: block.id, label: block.label })),
      effects: EFFECT_PRESETS.map((preset) => ({
        id: preset.id,
        label: preset.label,
        doc: preset.hint,
      })),
    },
    operations: PROJECT_OPERATIONS,
    instructions: [
      "Return only valid JSON. No prose, no code fences.",
      `Use kind "${PROJECT_SUGGESTION_AI_IN_KIND}".`,
      'Shape: { "kind": "...", "operations": [ ... ] }.',
      "Every operation needs an `op` field naming one of the operations listed above.",
      "Only reference clip ids and action ids that appear in this document.",
      "Times are seconds in film time — the same clock as the `start` values above.",
      "Give each operation a short `why` so the person reviewing it can judge it quickly.",
      "Prefer a few deliberate changes over many small ones. Every operation is reviewed by hand.",
    ],
  };
}

export function buildProjectAiPrompt(context: ProjectContextAiOut, request: string): string {
  const ask = request.trim() || "Suggest improvements to this film.";
  return [
    "You are helping edit a video project in Studio Boom.",
    "",
    "What the person wants:",
    ask,
    "",
    "Here is the current film and the operations you may propose:",
    JSON.stringify(context, null, 2),
  ].join("\n");
}
