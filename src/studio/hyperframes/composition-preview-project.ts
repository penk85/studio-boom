import { addStudioElementToHtml, type StudioTimelineElement } from "./html";
import { createRootCompositionHtml } from "./root-composition";
import type { CompositionSourceValidation } from "./composition-source";
import type { Project } from "../types";

export function buildCompositionPreviewProject(
  baseProject: Project,
  validation: CompositionSourceValidation,
): Project | null {
  if (!validation.ok || !validation.html || !validation.compositionId) return null;

  const width = validation.width ?? baseProject.hf.width;
  const height = validation.height ?? baseProject.hf.height;
  const duration = validation.duration ?? 4;
  const rootId = "studio_composition_preview_root";
  const hostId = "studio-composition-preview-host";
  const rootHtml = createRootCompositionHtml(rootId, duration, width, height);
  const element: StudioTimelineElement = {
    id: hostId,
    type: "composition",
    name: validation.compositionId,
    startTime: 0,
    duration,
    zIndex: 0,
    renderTrackIndex: 0,
    x: 0,
    y: 0,
    src: `compositions/${validation.compositionId}.html`,
    compositionId: validation.compositionId,
    sourceWidth: width,
    sourceHeight: height,
    rotation: 0,
    opacity: 1,
  };
  const { html } = addStudioElementToHtml(rootHtml, element);

  return {
    ...baseProject,
    id: `${baseProject.id}-composition-preview`,
    name: `${baseProject.name} composition preview`,
    hf: {
      ...baseProject.hf,
      id: rootId,
      name: "Composition preview",
      width,
      height,
      duration,
      rootHtml: html,
      compositionHtml: {
        [validation.compositionId]: validation.html,
      },
    },
    editorMeta: {
      tracks: [],
      clips: {},
    },
  };
}
