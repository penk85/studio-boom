import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const timelinePath = join(process.cwd(), "src/studio/components/Timeline.tsx");

describe("Timeline selection integration", () => {
  it("keeps timeline clips explicitly selectable apart from drag movement", () => {
    const source = readFileSync(timelinePath, "utf8");

    expect(source).toContain("const CLIP_DRAG_THRESHOLD_PX = 4;");
    expect(source).toContain("data-timeline-clip-id={clip.id}");
    expect(source).toContain("Math.hypot(dx, dy) < CLIP_DRAG_THRESHOLD_PX");
    expect(source).toContain("onClick={(e) => {");
    expect(source).toContain("onSelect();");
  });

  it("uses HyperFrames seek plumbing for a draggable timeline playhead", () => {
    const source = readFileSync(timelinePath, "utf8");

    expect(source).toContain("data-timeline-seek-surface");
    expect(source).toContain("data-timeline-playhead-handle");
    expect(source).toContain("seekDragRef");
    expect(source).toContain("liveTime.notify(nextTime)");
    expect(source).toContain("seek(nextTime)");
    expect(source).toContain("autoScrollDuringSeekDrag");
    expect(source).toContain("isTimelineSeekTarget");
    expect(source).toContain("[data-timeline-clip-id]");
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
});
