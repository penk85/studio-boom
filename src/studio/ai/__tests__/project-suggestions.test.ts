import { describe, expect, it } from "vitest";
import { createBlankProject, useStudio } from "../../store";
import {
  buildProjectContextAiOut,
  PROJECT_SUGGESTION_AI_IN_KIND,
} from "../project-control-surface";
import { parseProjectSuggestion } from "../project-suggestions";
import { deriveProjectScenes, deriveProjectTimelineClips } from "../../scenes";
import type { MotionPreset } from "../../types";

const ACTIONS: MotionPreset[] = [
  {
    id: "wave",
    name: "Wave",
    category: "gesture",
    duration: 1.2,
    loop: false,
    tracks: [],
    createdAt: 0,
  } as unknown as MotionPreset,
];

/** A real project with one text clip, built through the store like the UI does. */
function projectWithTextClip() {
  const project = createBlankProject("AI suggestions");
  useStudio.setState({
    project,
    tracks: project.editorMeta.tracks,
    // Editing schedules a debounced save 500ms later. Persistence is not under
    // test and jsdom has no IndexedDB, so that timer would fire into a closed
    // Dexie after this test finished and reject unhandled.
    saveProject: async () => {},
  });
  const sceneId = deriveProjectScenes(project)[0]?.id ?? null;
  useStudio.setState({ activeSceneId: sceneId });
  useStudio.getState().addClip({
    id: "clip-title",
    kind: "text",
    name: "Title",
    content: "Original title",
    trackIndex: 1,
    start: 1,
    duration: 4,
    x: 100,
    y: 200,
    width: 400,
    height: 120,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
  });
  return useStudio.getState().project!;
}

function suggestion(operations: unknown[]) {
  return JSON.stringify({ kind: PROJECT_SUGGESTION_AI_IN_KIND, operations });
}

describe("project control surface", () => {
  it("advertises only operations the editor can actually apply", () => {
    const project = createBlankProject();
    const context = buildProjectContextAiOut(project, ACTIONS);

    expect(context.kind).toBe("studioBoom.projectContext.v1");
    expect(context.operations.map((entry) => entry.op)).toEqual([
      "setClipTiming",
      "setClipTransform",
      "setTextContent",
      "addAction",
      "addTextBlock",
      "addEffect",
    ]);
    // Effects give the model something better to propose than raw coordinates,
    // and the review row reads as a sentence rather than numbers.
    expect(context.library.effects.map((effect) => effect.id)).toContain("fade-in");
    expect(context.library.actions).toEqual([
      { id: "wave", name: "Wave", category: "gesture", duration: 1.2 },
    ]);
    // The model needs the IN kind to answer with, or the reply cannot validate.
    expect(context.instructions.join(" ")).toContain(PROJECT_SUGGESTION_AI_IN_KIND);
  });
});

describe("parsing a suggestion", () => {
  it("rejects text that is not JSON, with the reason", () => {
    const project = createBlankProject();
    const result = parseProjectSuggestion("Sure! Here you go:", project, ACTIONS);
    expect(result.reviewed).toEqual([]);
    expect(result.errors[0]).toContain("Not valid JSON");
  });

  it("flags a wrong kind but still reviews the operations", () => {
    const project = createBlankProject();
    const raw = JSON.stringify({ kind: "something.else", operations: [] });
    const result = parseProjectSuggestion(raw, project, ACTIONS);
    expect(result.errors.some((error) => error.includes("Unexpected kind"))).toBe(true);
  });

  it("reports an unknown op instead of silently dropping it", () => {
    const project = createBlankProject();
    const result = parseProjectSuggestion(
      suggestion([{ op: "deleteEverything", clipId: "x" }]),
      project,
      ACTIONS,
    );
    expect(result.reviewed).toHaveLength(1);
    expect(result.reviewed[0].error).toContain("Unknown op");
  });

  it("refuses to target a clip that does not exist", () => {
    const project = createBlankProject();
    const result = parseProjectSuggestion(
      suggestion([{ op: "setClipTiming", clipId: "ghost", start: 2 }]),
      project,
      ACTIONS,
    );
    expect(result.reviewed[0].error).toContain('No clip with id "ghost"');
  });

  it("describes a retime with its before and after", () => {
    const project = projectWithTextClip();
    const target = deriveProjectTimelineClips(project)[0]!;

    const result = parseProjectSuggestion(
      suggestion([{ op: "setClipTiming", clipId: target.id, start: 3, duration: 2 }]),
      project,
      ACTIONS,
    );

    expect(result.reviewed[0].error).toBeUndefined();
    expect(result.reviewed[0].summary).toBe('Retime "Title"');
    expect(result.reviewed[0].before).toBe("starts 1s, lasts 4s");
    expect(result.reviewed[0].after).toBe("starts 3s, lasts 2s");
  });

  it("shows only the transform fields the suggestion actually changes", () => {
    const project = projectWithTextClip();
    const target = deriveProjectTimelineClips(project)[0]!;

    const result = parseProjectSuggestion(
      suggestion([{ op: "setClipTransform", clipId: target.id, x: 400 }]),
      project,
      ACTIONS,
    );

    expect(result.reviewed[0].before).toBe("x 100");
    expect(result.reviewed[0].after).toBe("x 400");
  });

  it("rewords a text clip and refuses a non-text one", () => {
    const project = projectWithTextClip();
    const target = deriveProjectTimelineClips(project)[0]!;

    const result = parseProjectSuggestion(
      suggestion([{ op: "setTextContent", clipId: target.id, content: "New words" }]),
      project,
      ACTIONS,
    );

    expect(result.reviewed[0].error).toBeUndefined();
    expect(result.reviewed[0].before).toBe('"Original title"');
    expect(result.reviewed[0].after).toBe('"New words"');
  });

  it("describes an effect by name and rejects an unknown one", () => {
    const project = projectWithTextClip();
    const target = deriveProjectTimelineClips(project)[0]!;

    const good = parseProjectSuggestion(
      suggestion([{ op: "addEffect", clipId: target.id, effectId: "fade-in" }]),
      project,
      ACTIONS,
    );
    expect(good.reviewed[0].error).toBeUndefined();
    expect(good.reviewed[0].summary).toBe("Title: Fade in");

    const bad = parseProjectSuggestion(
      suggestion([{ op: "addEffect", clipId: target.id, effectId: "explode" }]),
      project,
      ACTIONS,
    );
    expect(bad.reviewed[0].error).toContain('No effect with id "explode"');
  });

  it("will not add an action to a clip that is not a character", () => {
    const project = projectWithTextClip();
    const target = deriveProjectTimelineClips(project)[0]!;

    const result = parseProjectSuggestion(
      suggestion([{ op: "addAction", clipId: target.id, actionId: "wave" }]),
      project,
      ACTIONS,
    );

    expect(result.reviewed[0].error).toBe("That clip is not a character.");
  });

  it("requires at least one field on a transform", () => {
    const project = createBlankProject();
    const clips = deriveProjectTimelineClips(project);
    const clipId = clips[0]?.id ?? "none";
    const result = parseProjectSuggestion(
      suggestion([{ op: "setClipTransform", clipId }]),
      project,
      ACTIONS,
    );
    expect(result.reviewed[0].error).toBeTruthy();
  });

  it("validates a text block name before offering to add it", () => {
    const project = createBlankProject();
    const bad = parseProjectSuggestion(
      suggestion([{ op: "addTextBlock", block: "banner" }]),
      project,
      ACTIONS,
    );
    expect(bad.reviewed[0].error).toContain("Unknown text block");

    const good = parseProjectSuggestion(
      suggestion([{ op: "addTextBlock", block: "title", content: "Hello", start: 2 }]),
      project,
      ACTIONS,
    );
    expect(good.reviewed[0].error).toBeUndefined();
    expect(good.reviewed[0].summary).toContain("Hello");
    expect(good.reviewed[0].after).toContain("2s");
  });

  it("carries the model's reasoning through to the review row", () => {
    const project = createBlankProject();
    const result = parseProjectSuggestion(
      suggestion([
        { op: "addTextBlock", block: "title", content: "Hi", why: "The film opens cold." },
      ]),
      project,
      ACTIONS,
    );
    expect(result.reviewed[0].why).toBe("The film opens cold.");
  });
});
