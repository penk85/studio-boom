// Parses, describes, and applies a pasted AI suggestion.
//
// Nothing here mutates on its own. A suggestion becomes a list of reviewed
// operations, each of which knows how to describe itself in plain language and
// what it would change from and to. The person approves them one at a time; only
// then does `applyProjectOperations` run them through the normal store actions —
// the same ones the UI uses, so an AI edit is undoable exactly like a hand edit.
import type { MotionPreset, Project } from "../types";
import { isCharacterCompositionClip } from "../types";
import { deriveProjectTimelineClips } from "../scenes";
import { findTextBlock } from "../library-items";
import { findEffectPreset } from "../hyperframes/effect-presets";
import {
  PROJECT_OPERATION_NAMES,
  PROJECT_SUGGESTION_AI_IN_KIND,
  type ProjectOperationName,
} from "./project-control-surface";

export interface ProjectOperation {
  op: ProjectOperationName;
  clipId?: string;
  start?: number;
  duration?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  content?: string;
  actionId?: string;
  at?: number;
  intensity?: number;
  block?: string;
  effectId?: string;
  why?: string;
}

/** One reviewable row: what it would do, and whether it can be done at all. */
export interface ReviewedOperation {
  id: string;
  operation: ProjectOperation;
  /** Plain-language summary, e.g. 'Move "Alex" to x 400, y 120'. */
  summary: string;
  /** Human-readable current value, when the operation changes something existing. */
  before?: string;
  after?: string;
  why?: string;
  /** Set when the operation cannot be applied. Such rows are shown but not approvable. */
  error?: string;
}

export interface ParsedSuggestion {
  reviewed: ReviewedOperation[];
  /** Problems with the document as a whole, not with one operation. */
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function fmt(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * Turns pasted text into reviewable rows. Never throws: bad input becomes errors
 * the panel can show, because the repair loop depends on saying what was wrong.
 */
export function parseProjectSuggestion(
  raw: string,
  project: Project,
  actions: MotionPreset[],
): ParsedSuggestion {
  const text = raw.trim();
  if (!text) return { reviewed: [], errors: ["Paste a suggestion first."] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      reviewed: [],
      errors: [`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  if (!isRecord(parsed)) return { reviewed: [], errors: ["Expected a JSON object."] };

  const errors: string[] = [];
  const kind = parsed.kind;
  if (typeof kind === "string" && kind !== PROJECT_SUGGESTION_AI_IN_KIND) {
    errors.push(`Unexpected kind "${kind}". Expected "${PROJECT_SUGGESTION_AI_IN_KIND}".`);
  }

  const rawOperations = parsed.operations;
  if (!Array.isArray(rawOperations)) {
    errors.push('Missing an "operations" array.');
    return { reviewed: [], errors };
  }
  if (rawOperations.length === 0) errors.push("The suggestion contains no operations.");

  const clips = deriveProjectTimelineClips(project);
  const clipById = new Map(clips.map((clip) => [clip.id, clip] as const));
  const actionById = new Map(actions.map((action) => [action.id, action] as const));

  const reviewed = rawOperations.map((entry, index) =>
    reviewOperation(entry, index, clipById, actionById),
  );

  return { reviewed, errors };
}

function reviewOperation(
  entry: unknown,
  index: number,
  clipById: Map<string, ReturnType<typeof deriveProjectTimelineClips>[number]>,
  actionById: Map<string, MotionPreset>,
): ReviewedOperation {
  const id = `op-${index}`;
  if (!isRecord(entry)) {
    return {
      id,
      operation: { op: "setClipTiming" },
      summary: `Operation ${index + 1}`,
      error: "Not a JSON object.",
    };
  }

  const op = entry.op;
  const why = typeof entry.why === "string" ? entry.why : undefined;
  if (typeof op !== "string" || !PROJECT_OPERATION_NAMES.includes(op as ProjectOperationName)) {
    return {
      id,
      operation: { op: "setClipTiming", why },
      summary: `Operation ${index + 1}`,
      why,
      error: `Unknown op "${String(op)}". Expected one of: ${PROJECT_OPERATION_NAMES.join(", ")}.`,
    };
  }

  const operation: ProjectOperation = {
    op: op as ProjectOperationName,
    clipId: typeof entry.clipId === "string" ? entry.clipId : undefined,
    start: numberOrUndefined(entry.start),
    duration: numberOrUndefined(entry.duration),
    x: numberOrUndefined(entry.x),
    y: numberOrUndefined(entry.y),
    width: numberOrUndefined(entry.width),
    height: numberOrUndefined(entry.height),
    rotation: numberOrUndefined(entry.rotation),
    opacity: numberOrUndefined(entry.opacity),
    content: typeof entry.content === "string" ? entry.content : undefined,
    actionId: typeof entry.actionId === "string" ? entry.actionId : undefined,
    at: numberOrUndefined(entry.at),
    intensity: numberOrUndefined(entry.intensity),
    block: typeof entry.block === "string" ? entry.block : undefined,
    effectId: typeof entry.effectId === "string" ? entry.effectId : undefined,
    why,
  };

  const base = { id, operation, why };

  if (operation.op === "addTextBlock") {
    const block = operation.block ? findTextBlock(operation.block) : undefined;
    if (!block) {
      return {
        ...base,
        summary: "Add a text block",
        error: `Unknown text block "${operation.block ?? ""}".`,
      };
    }
    const content = operation.content?.trim() || block.content;
    return {
      ...base,
      summary: `Add a ${block.label.toLowerCase()}: "${content}"`,
      after: `starts at ${fmt(Math.max(0, operation.start ?? 0))}s`,
    };
  }

  // Everything else targets an existing clip.
  const clip = operation.clipId ? clipById.get(operation.clipId) : undefined;
  if (!clip) {
    return {
      ...base,
      summary: `Change clip ${operation.clipId ?? "(none)"}`,
      error: operation.clipId ? `No clip with id "${operation.clipId}".` : "Missing a clipId.",
    };
  }

  switch (operation.op) {
    case "setClipTiming": {
      if (operation.start === undefined && operation.duration === undefined) {
        return { ...base, summary: `Retime "${clip.name}"`, error: "Needs start or duration." };
      }
      const before: string[] = [];
      const after: string[] = [];
      if (operation.start !== undefined) {
        before.push(`starts ${fmt(clip.start)}s`);
        after.push(`starts ${fmt(Math.max(0, operation.start))}s`);
      }
      if (operation.duration !== undefined) {
        before.push(`lasts ${fmt(clip.duration)}s`);
        after.push(`lasts ${fmt(Math.max(0.1, operation.duration))}s`);
      }
      return {
        ...base,
        summary: `Retime "${clip.name}"`,
        before: before.join(", "),
        after: after.join(", "),
      };
    }

    case "setClipTransform": {
      const fields: [string, number | undefined, number][] = [
        ["x", operation.x, clip.x],
        ["y", operation.y, clip.y],
        ["width", operation.width, clip.width],
        ["height", operation.height, clip.height],
        ["rotation", operation.rotation, clip.rotation],
        ["opacity", operation.opacity, clip.opacity],
      ];
      const changed = fields.filter(([, next]) => next !== undefined);
      if (changed.length === 0) {
        return {
          ...base,
          summary: `Move "${clip.name}"`,
          error: "Needs at least one of x, y, width, height, rotation, opacity.",
        };
      }
      return {
        ...base,
        summary: `Move "${clip.name}"`,
        before: changed.map(([name, , current]) => `${name} ${fmt(current)}`).join(", "),
        after: changed.map(([name, next]) => `${name} ${fmt(next as number)}`).join(", "),
      };
    }

    case "setTextContent": {
      if (clip.kind !== "text") {
        return { ...base, summary: `Reword "${clip.name}"`, error: "That clip is not text." };
      }
      if (operation.content === undefined) {
        return { ...base, summary: `Reword "${clip.name}"`, error: "Missing content." };
      }
      return {
        ...base,
        summary: `Reword "${clip.name}"`,
        before: `"${clip.content ?? ""}"`,
        after: `"${operation.content}"`,
      };
    }

    case "addEffect": {
      const move = operation.effectId ? findEffectPreset(operation.effectId) : undefined;
      if (!move) {
        return {
          ...base,
          summary: `Add an effect to "${clip.name}"`,
          error: `No effect with id "${operation.effectId ?? ""}".`,
        };
      }
      return { ...base, summary: `${clip.name}: ${move.label}`, after: move.hint };
    }

    case "addAction": {
      if (!isCharacterCompositionClip(clip)) {
        return {
          ...base,
          summary: `Add an action to "${clip.name}"`,
          error: "That clip is not a character.",
        };
      }
      const action = operation.actionId ? actionById.get(operation.actionId) : undefined;
      if (!action) {
        return {
          ...base,
          summary: `Add an action to "${clip.name}"`,
          error: `No action with id "${operation.actionId ?? ""}".`,
        };
      }
      return {
        ...base,
        summary: `${clip.name}: ${action.name}`,
        after: `at ${fmt(Math.max(0, operation.at ?? 0))}s into the clip`,
      };
    }

    default:
      return { ...base, summary: `Operation ${index + 1}`, error: "Unsupported operation." };
  }
}

export interface ApplyContext {
  /** Points the store at the clip's own scene before mutating it. */
  activateClipScene: (clipId: string) => void;
  updateClip: (clipId: string, patch: Record<string, unknown>) => void;
  addTextBlock: (blockId: string, content: string | undefined, start: number) => Promise<void>;
  applyEffectPreset: (clipId: string, presetId: string) => void;
  project: Project;
  createId: () => string;
}

/**
 * Runs approved operations through the normal store actions. Sequential so each
 * one sees the previous one's result, and so the whole batch reads as one
 * coherent set of edits in the undo history.
 */
export async function applyProjectOperations(
  operations: ProjectOperation[],
  context: ApplyContext,
): Promise<void> {
  for (const operation of operations) {
    if (operation.op === "addTextBlock") {
      if (!operation.block) continue;
      await context.addTextBlock(
        operation.block,
        operation.content,
        Math.max(0, operation.start ?? 0),
      );
      continue;
    }

    const clipId = operation.clipId;
    if (!clipId) continue;
    context.activateClipScene(clipId);

    if (operation.op === "setClipTiming") {
      const patch: Record<string, unknown> = {};
      if (operation.start !== undefined) patch.start = Math.max(0, operation.start);
      if (operation.duration !== undefined) patch.duration = Math.max(0.1, operation.duration);
      if (Object.keys(patch).length > 0) context.updateClip(clipId, patch);
      continue;
    }

    if (operation.op === "setClipTransform") {
      const patch: Record<string, unknown> = {};
      if (operation.x !== undefined) patch.x = Math.round(operation.x);
      if (operation.y !== undefined) patch.y = Math.round(operation.y);
      if (operation.width !== undefined) patch.width = Math.max(1, Math.round(operation.width));
      if (operation.height !== undefined) patch.height = Math.max(1, Math.round(operation.height));
      if (operation.rotation !== undefined) patch.rotation = operation.rotation;
      if (operation.opacity !== undefined) {
        patch.opacity = Math.min(1, Math.max(0, operation.opacity));
      }
      if (Object.keys(patch).length > 0) context.updateClip(clipId, patch);
      continue;
    }

    if (operation.op === "addEffect") {
      if (operation.effectId) context.applyEffectPreset(clipId, operation.effectId);
      continue;
    }

    if (operation.op === "setTextContent") {
      if (operation.content !== undefined)
        context.updateClip(clipId, { content: operation.content });
      continue;
    }

    if (operation.op === "addAction") {
      const clip = deriveProjectTimelineClips(context.project).find(
        (candidate) => candidate.id === clipId,
      );
      if (!clip || !isCharacterCompositionClip(clip) || !operation.actionId) continue;
      const motions = [
        ...(clip.character.motions ?? []),
        {
          id: context.createId(),
          presetId: operation.actionId,
          offset: Math.max(0, Math.min(clip.duration, operation.at ?? 0)),
          intensity: Math.min(1, Math.max(0, operation.intensity ?? 1)),
        },
      ];
      context.updateClip(clipId, { character: { ...clip.character, motions } });
    }
  }
}
