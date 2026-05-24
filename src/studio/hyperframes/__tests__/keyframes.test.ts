import { describe, expect, it } from "vitest";
import {
  addMotionCheckpointToClip,
  addMotionStepToClip,
  deriveClipMotionSteps,
  moveKeyframeProperty,
  moveMotionCheckpoint,
  moveMotionStep,
  removeMotionCheckpoint,
  readClipKeyframesFromHtml,
  readClipMotionStepMetasFromHtml,
  renameMotionStep,
  removeMotionStep,
  removeKeyframeProperty,
  setClipMotionModelInRootHtml,
  setClipKeyframesInRootHtml,
  syncRootKeyframesHtml,
  updateKeyframeProperty,
  upsertKeyframeProperty,
} from "../keyframes";

function rootHtml() {
  return `<!DOCTYPE html>
<html data-composition-id="project-1" data-composition-duration="6">
  <head>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <script>
      const tl = gsap.timeline({ paused: true });
      window.__timelines = window.__timelines || {};
      window.__timelines["project-1"] = tl;
    </script>
  </head>
  <body>
    <div id="stage" data-composition-id="project-1" data-start="0" data-duration="6">
      <img
        id="clip-1"
        src="asset:image-1"
        data-start="1"
        data-duration="4"
        data-track-index="1000"
        data-x="100"
        data-y="50"
        data-rotation="10"
        data-opacity="0.9"
      />
    </div>
  </body>
</html>`;
}

describe("native clip keyframes", () => {
  it("serializes data-keyframes and generates a Studio-owned GSAP script", () => {
    const html = setClipKeyframesInRootHtml(rootHtml(), "clip-1", [
      {
        id: "kf-1",
        time: 2,
        properties: { x: 40, y: 20, scale: 1.2, rotation: 35, opacity: 0.5 },
        ease: "power2.out",
      },
    ]);

    expect(readClipKeyframesFromHtml(html, "clip-1")).toEqual(
      expect.arrayContaining([
        {
          id: "kf-1",
          time: 2,
          properties: { x: 40, y: 20, scale: 1.2, rotation: 35, opacity: 0.5 },
          ease: "power2.out",
        },
      ]),
    );
    expect(readClipMotionStepMetasFromHtml(html, "clip-1")).toEqual([]);
    expect(html).toContain('data-studio-keyframes="true"');
    expect(html).toContain('window.__timelines["project-1"]');
    expect(html).toContain('tl.set("#clip-1", { x: 100, y: 50 }, 1);');
    expect(html).toContain(
      'tl.to("#clip-1", { x: 140, y: 70, duration: 2, ease: "power2.out" }, 1);',
    );
    expect(html).toContain('tl.to("#clip-1", { scale: 1.2, duration: 2, ease: "power2.out" }, 1);');
    expect(html).not.toContain("visibility");
    expect(html).not.toContain("display");
  });

  it("removes the generated script when no keyframes remain", () => {
    const withKeyframes = setClipKeyframesInRootHtml(rootHtml(), "clip-1", [
      { id: "kf-1", time: 0, properties: { opacity: 0.25 } },
    ]);
    const withoutKeyframes = setClipKeyframesInRootHtml(withKeyframes, "clip-1", []);

    expect(withoutKeyframes).not.toContain('data-keyframes="');
    expect(withoutKeyframes).not.toContain('data-studio-keyframes="true"');
  });

  it("removes stale motion metadata when the clip has no keyframes", () => {
    const html = syncRootKeyframesHtml(`<!DOCTYPE html>
<html data-composition-id="project-1" data-composition-duration="5">
  <body>
    <div id="stage" data-composition-id="project-1"></div>
    <img id="clip-1" data-start="0" data-duration="3" data-motion-steps='[
      {"id":"motion-1","checkpointIds":["missing-a","missing-b"]}
    ]' />
  </body>
</html>`);

    expect(html).not.toContain("data-motion-steps");
    expect(html).not.toContain('data-studio-keyframes="true"');
  });

  it("clamps and prunes malformed or out-of-range values", () => {
    const html = syncRootKeyframesHtml(`<!DOCTYPE html>
<html data-composition-id="project-1" data-composition-duration="5">
  <body>
    <div id="stage" data-composition-id="project-1"></div>
    <img id="clip-1" data-start="0" data-duration="3" data-keyframes='[
      {"id":"late","time":9,"properties":{"opacity":2,"scale":-4,"rotation":15}},
      {"id":"empty","time":1,"properties":{"width":200}}
    ]' />
  </body>
</html>`);

    expect(readClipKeyframesFromHtml(html, "clip-1")).toEqual(
      expect.arrayContaining([
        { id: "late", time: 3, properties: { scale: 0.01, rotation: 15, opacity: 1 } },
      ]),
    );
  });

  it("merges, splits, moves, and removes sparse property keyframes", () => {
    const createId = () => "created";
    const added = upsertKeyframeProperty([], {
      property: "position",
      time: 1,
      duration: 4,
      values: { x: 10, y: 20 },
      createId,
    });
    const merged = updateKeyframeProperty(added.keyframes, {
      keyframeId: added.keyframeId!,
      property: "opacity",
      duration: 4,
      values: { opacity: 0.4 },
    });
    const moved = moveKeyframeProperty(merged.keyframes, {
      keyframeId: added.keyframeId!,
      property: "position",
      time: 2,
      duration: 4,
    });

    expect(moved.keyframes).toEqual([
      { id: "created", time: 1, properties: { opacity: 0.4 } },
      { id: "created-position", time: 2, properties: { x: 10, y: 20 } },
    ]);

    expect(removeKeyframeProperty(moved.keyframes, "created", "opacity")).toEqual([
      { id: "created-position", time: 2, properties: { x: 10, y: 20 } },
    ]);
  });

  it("groups native keyframes into user-facing motion steps", () => {
    let id = 0;
    const clip = {
      x: 100,
      y: 50,
      scale: 1,
      rotation: 10,
      opacity: 0.9,
      duration: 4,
      keyframes: [],
      motionStepMetas: [],
    };
    const added = addMotionStepToClip(clip, {
      time: 0.5,
      createId: () => `id-${++id}`,
    });
    const html = setClipMotionModelInRootHtml(
      rootHtml(),
      "clip-1",
      added.keyframes,
      added.motionSteps,
    );

    expect(html).toContain("data-keyframes=");
    expect(html).toContain("data-motion-steps=");
    expect(readClipMotionStepMetasFromHtml(html, "clip-1")).toEqual(added.motionSteps);

    const steps = deriveClipMotionSteps({ ...clip, keyframes: added.keyframes }, added.motionSteps);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      startTime: 0.5,
      endTime: 1.4,
      label: "Motion",
    });
    expect(steps[0]?.checkpointIds).toHaveLength(2);
    expect(steps[0]?.checkpoints.map((checkpoint) => checkpoint.label)).toEqual(["Begin", "End"]);
    expect(steps[0]?.checkpoints[0]?.values).toMatchObject({ x: 100, y: 50, scale: 1 });
    expect(steps[0]?.checkpoints[1]?.values).toMatchObject({ x: 100, y: 50, scale: 1 });

    const namedMotionSteps = renameMotionStep(
      { ...clip, keyframes: added.keyframes, motionStepMetas: added.motionSteps },
      added.motionSteps[0]!.id,
      "Hero glide",
    );
    expect(
      deriveClipMotionSteps({ ...clip, keyframes: added.keyframes }, namedMotionSteps)[0],
    ).toMatchObject({ name: "Hero glide", label: "Hero glide" });
    const namedHtml = setClipMotionModelInRootHtml(
      rootHtml(),
      "clip-1",
      added.keyframes,
      namedMotionSteps,
    );
    expect(readClipMotionStepMetasFromHtml(namedHtml, "clip-1")[0]).toMatchObject({
      name: "Hero glide",
    });

    const withCheckpoint = addMotionCheckpointToClip(
      { ...clip, keyframes: added.keyframes, motionStepMetas: added.motionSteps },
      {
        motionId: added.motionSteps[0]!.id,
        time: 1,
        createId: () => `id-${++id}`,
      },
    );
    const checkpointStep = deriveClipMotionSteps(
      { ...clip, keyframes: withCheckpoint.keyframes },
      withCheckpoint.motionSteps,
    )[0]!;
    expect(checkpointStep.checkpoints.map((checkpoint) => checkpoint.label)).toEqual([
      "Begin",
      "Point 1",
      "End",
    ]);

    const movedCheckpoint = moveMotionCheckpoint(
      { ...clip, keyframes: withCheckpoint.keyframes, motionStepMetas: withCheckpoint.motionSteps },
      {
        motionId: withCheckpoint.motionSteps[0]!.id,
        checkpointId: checkpointStep.checkpoints[1]!.id,
        time: 1.1,
      },
    );
    expect(
      deriveClipMotionSteps(
        { ...clip, keyframes: movedCheckpoint.keyframes },
        movedCheckpoint.motionSteps,
      )[0]?.checkpoints[1]?.time,
    ).toBe(1.1);

    const withoutCheckpoint = removeMotionCheckpoint(
      {
        ...clip,
        keyframes: movedCheckpoint.keyframes,
        motionStepMetas: movedCheckpoint.motionSteps,
      },
      movedCheckpoint.motionSteps[0]!.id,
      checkpointStep.checkpoints[1]!.id,
    );
    expect(
      deriveClipMotionSteps(
        { ...clip, keyframes: withoutCheckpoint.keyframes },
        withoutCheckpoint.motionSteps,
      )[0]?.checkpoints,
    ).toHaveLength(2);

    const moved = moveMotionStep(
      { ...clip, keyframes: added.keyframes, motionStepMetas: added.motionSteps },
      { motionId: added.motionSteps[0]!.id, startTime: 1, endTime: 1.9 },
    );
    expect(
      deriveClipMotionSteps({ ...clip, keyframes: moved.keyframes }, moved.motionSteps)[0],
    ).toMatchObject({ startTime: 1, endTime: 1.9 });

    const movedBegin = moveMotionStep(
      { ...clip, keyframes: added.keyframes, motionStepMetas: added.motionSteps },
      {
        motionId: added.motionSteps[0]!.id,
        startTime: 0.8,
        endTime: 1.7,
        selectEndpoint: "begin",
      },
    );
    expect(movedBegin.selection?.keyframeId).toBe(added.motionSteps[0]!.checkpointIds[0]);

    const removed = removeMotionStep(
      { ...clip, keyframes: moved.keyframes, motionStepMetas: moved.motionSteps },
      moved.motionSteps[0]!.id,
    );
    expect(removed.keyframes).toEqual([]);
    expect(removed.motionSteps).toEqual([]);
  });
});
