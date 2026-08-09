import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const timelinePath = join(process.cwd(), "src/studio/components/Timeline.tsx");
const clipBlockPath = join(process.cwd(), "src/studio/components/TimelineClipBlock.tsx");
const sceneStripPath = join(process.cwd(), "src/studio/components/TimelineSceneStrip.tsx");
const constantsPath = join(process.cwd(), "src/studio/components/timeline-constants.ts");
const clipUtilsPath = join(process.cwd(), "src/studio/components/timeline-clip-utils.ts");
const layoutPath = join(process.cwd(), "src/studio/components/timeline-layout.ts");
const compositionOutlinePath = join(
  process.cwd(),
  "src/studio/components/TimelineCompositionOutline.tsx",
);
const visualMotionPath = join(
  process.cwd(),
  "src/studio/components/TimelineVisualMotionTracks.tsx",
);
const characterTracksPath = join(
  process.cwd(),
  "src/studio/components/TimelineCharacterTracks.tsx",
);

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
    // Player time is film time, so seeking is absolute — no scene remapping.
    expect(source).toContain("liveTime.notify(boundedTime)");
    expect(source).toContain("seek(boundedTime)");
    expect(source).not.toContain("seek(localTime)");
    expect(source).toContain("autoScrollDuringSeekDrag");
    expect(source).toContain("isTimelineSeekTarget");
    expect(source).toContain("[data-timeline-clip-id]");
    expect(source).toContain("target instanceof Element");
    expect(source).not.toContain("target instanceof HTMLElement");
  });

  it("plays the whole film by default, and a scene can be played on its own", () => {
    const source = readFileSync(timelinePath, "utf8");
    const sceneStripSource = readFileSync(sceneStripPath, "utf8");

    expect(source).toContain("const projectCurrentTime = currentTime");
    // No scene offset remap — player time is film time.
    expect(source).not.toContain("timelineTimeOffsetRef");

    // "Play this scene" is an action on the scene, not a mode on the transport:
    // it arms a stop time for one run and leaves nothing toggled.
    expect(source).toContain("const playScene = useCallback");
    expect(source).toContain("playUntilRef.current = scene.start + scene.duration");
    expect(source).toContain("if (!usePlayerStore.getState().isPlaying) togglePlay()");
    expect(source).toContain("playUntilRef.current = null");
    expect(sceneStripSource).toContain("onPlayScene(scene.id)");
    expect(sceneStripSource).toContain('"Pause" : "Play this scene"');

    // Pressing it again pauses where it is rather than restarting the scene, and
    // the button follows the player so it stops showing Pause when playback ends
    // for any other reason.
    expect(source).toContain(
      "if (playingSceneId === sceneId && usePlayerStore.getState().isPlaying)",
    );
    expect(source).toContain("if (!isPlaying) setPlayingSceneId(null)");
    expect(sceneStripSource).toContain("scene.id === playingSceneId ? <Pause size={12} />");
    // No leftover mode state from earlier attempts at this control.
    expect(source).not.toContain("stopAtSceneEnd");
    expect(source).not.toContain("lockedSceneId");
  });

  it("renders beginner motion lanes as draggable motion bars", () => {
    const source = readFileSync(timelinePath, "utf8");
    const visualMotionSource = readFileSync(visualMotionPath, "utf8");

    expect(source).toContain("VisualMotionLaneSet");
    expect(source).toContain("addClipMotionStep(row.clip.id, time)");
    expect(source).toContain("addClipMotionCheckpoint(row.clip.id, motionId, time)");
    expect(source).toContain("moveClipMotionCheckpoint(row.clip.id, motionId, checkpointId, time");
    expect(source).toContain(
      "moveClipMotionStep(row.clip.id, motionId, patch, { history: false })",
    );
    expect(visualMotionSource).toContain("export function VisualMotionLaneSet");
    expect(visualMotionSource).toContain("function VisualMotionBlock");
    expect(visualMotionSource).toContain("packVisualMotionRows");
    expect(visualMotionSource).toContain("motion.label");
    expect(visualMotionSource).toContain("CheckpointMark");
    expect(visualMotionSource).toContain('aria-label="Add point at playhead"');
    expect(visualMotionSource).toContain("pointTimeForMotion(motion, localPlayheadTime)");
    expect(visualMotionSource).toContain("selectionForMotionEndpoint");
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
    const compositionOutlineSource = readFileSync(compositionOutlinePath, "utf8");
    const visualMotionSource = readFileSync(visualMotionPath, "utf8");
    const characterTracksSource = readFileSync(characterTracksPath, "utf8");

    expect(source).toContain('from "./TimelineClipBlock"');
    expect(source).toContain('from "./TimelineSceneStrip"');
    expect(source).toContain('from "./TimelineCompositionOutline"');
    expect(source).toContain('from "./TimelineVisualMotionTracks"');
    expect(source).toContain('from "./TimelineCharacterTracks"');
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
    expect(compositionOutlineSource).toContain("export function CompositionOutlineLaneSet");
    expect(visualMotionSource).toContain("export function VisualMotionLaneSet");
    expect(characterTracksSource).toContain("export function MotionLaneSet");
    expect(source).not.toContain("function SceneStrip");
    expect(source).not.toContain("function ClipBlock");
    expect(source).not.toContain("function CompositionOutlineLaneSet");
    expect(source).not.toContain("function VisualMotionLaneSet");
    expect(source).not.toContain("function MotionLaneSet");
    expect(source).not.toContain("function buildCompositionSourceErrors");
    expect(source).not.toContain("function buildTrackLayout");
    expect(source).not.toContain("function buildExpandedClipLayout");
  });
});
