import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const timelinePath = join(process.cwd(), "src/studio/components/Timeline.tsx");
const clipBlockPath = join(process.cwd(), "src/studio/components/TimelineClipBlock.tsx");
const sceneStripPath = join(process.cwd(), "src/studio/components/TimelineSceneStrip.tsx");
const constantsPath = join(process.cwd(), "src/studio/components/timeline-constants.ts");
const clipUtilsPath = join(process.cwd(), "src/studio/components/timeline-clip-utils.ts");
const layoutPath = join(process.cwd(), "src/studio/components/timeline-layout.ts");

describe("Timeline selection integration", () => {
  it("keeps timeline clips explicitly selectable apart from drag movement", () => {
    const clipBlockSource = readFileSync(clipBlockPath, "utf8");
    const constantsSource = readFileSync(constantsPath, "utf8");

    expect(constantsSource).toContain("export const CLIP_DRAG_THRESHOLD_PX = 4;");
    expect(clipBlockSource).toContain("data-timeline-clip-id={clip.id}");
    expect(clipBlockSource).toContain("Math.hypot(dx, dy) < CLIP_DRAG_THRESHOLD_PX");
    expect(clipBlockSource).toContain("onClick={(event) => {");
    expect(clipBlockSource).toContain("onSelect();");
  });

  it("uses HyperFrames seek plumbing for a draggable timeline playhead", () => {
    const source = readFileSync(timelinePath, "utf8");

    expect(source).toContain("data-timeline-seek-surface");
    expect(source).toContain("data-timeline-playhead-handle");
    expect(source).toContain("seekDragRef");
    expect(source).toContain("seekProjectTime(nextTime)");
    expect(source).toContain("liveTime.notify(localTime)");
    expect(source).toContain("seek(localTime)");
    expect(source).toContain("autoScrollDuringSeekDrag");
    expect(source).toContain("isTimelineSeekTarget");
    expect(source).toContain("[data-timeline-clip-id]");
    expect(source).toContain("target instanceof Element");
    expect(source).not.toContain("target instanceof HTMLElement");
  });

  it("renders beginner motion lanes as draggable motion bars", () => {
    const source = readFileSync(timelinePath, "utf8");

    expect(source).toContain("VisualMotionLaneSet");
    expect(source).toContain("VisualMotionBlock");
    expect(source).toContain("packVisualMotionRows");
    expect(source).toContain("motion.label");
    expect(source).toContain("addClipMotionStep(row.clip.id, time)");
    expect(source).toContain("addClipMotionCheckpoint(row.clip.id, motionId, time)");
    expect(source).toContain("moveClipMotionCheckpoint(row.clip.id, motionId, checkpointId, time");
    expect(source).toContain(
      "moveClipMotionStep(row.clip.id, motionId, patch, { history: false })",
    );
    expect(source).toContain("CheckpointMark");
    expect(source).toContain('aria-label="Add point at playhead"');
    expect(source).toContain("pointTimeForMotion(motion, localPlayheadTime)");
    expect(source).toContain("selectionForMotionEndpoint");
  });

  it("labels applied character actions directly on the parent clip", () => {
    const source = readFileSync(timelinePath, "utf8");
    const clipBlockSource = readFileSync(clipBlockPath, "utf8");

    expect(source).toContain("const storePresetMap = useStudio((s) => s.motionPresets);");
    expect(clipBlockSource).toContain("characterActionBadgeLabel");
    expect(clipBlockSource).toContain("characterActionTitle");
    expect(clipBlockSource).toContain("motionBadge.label");
    expect(clipBlockSource).toContain("actionBadgeFallback(1)");
    expect(clipBlockSource).toContain("actionBadgeFallback(motions.length)");
  });

  it("keeps Timeline state ownership while extracting callback-driven chrome and pure helpers", () => {
    const source = readFileSync(timelinePath, "utf8");
    const clipBlockSource = readFileSync(clipBlockPath, "utf8");
    const sceneStripSource = readFileSync(sceneStripPath, "utf8");
    const clipUtilsSource = readFileSync(clipUtilsPath, "utf8");
    const layoutSource = readFileSync(layoutPath, "utf8");

    expect(source).toContain('from "./TimelineClipBlock"');
    expect(source).toContain('from "./TimelineSceneStrip"');
    expect(source).toContain('from "./timeline-clip-utils"');
    expect(source).toContain('from "./timeline-layout"');
    expect(source).toContain("<TimelineClipBlock");
    expect(source).toContain("<SceneStrip");
    expect(source).toContain("<TimelineRuler");
    expect(clipBlockSource).toContain("export function TimelineClipBlock");
    expect(sceneStripSource).toContain("export function SceneStrip");
    expect(sceneStripSource).toContain("export function SceneBoundaryOverlay");
    expect(sceneStripSource).toContain("export function TimelineRuler");
    expect(clipUtilsSource).toContain("export function buildCompositionSourceErrors");
    expect(clipUtilsSource).toContain("export function buildCompositionOutlines");
    expect(clipUtilsSource).toContain("export function toSceneLocalClipPatch");
    expect(layoutSource).toContain("export function buildTrackLayout");
    expect(layoutSource).toContain("export function packVisualMotionRows");
    expect(layoutSource).toContain("export function buildExpandedClipLayout");
    expect(source).not.toContain("function SceneStrip");
    expect(source).not.toContain("function ClipBlock");
    expect(source).not.toContain("function buildCompositionSourceErrors");
    expect(source).not.toContain("function buildTrackLayout");
    expect(source).not.toContain("function buildExpandedClipLayout");
  });
});
