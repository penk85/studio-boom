import { describe, expect, it } from "vitest";
import { validateCompositionSourceHtml } from "../../hyperframes/composition-source";
import type { CharacterClipMeta, MotionPreset } from "../../types";
import { createBlankCharacter, makePart } from "../character-utils";
import { buildCharacterCompositionHtml } from "../composition";
import { blinkWindowsForClip } from "../eye-state";
import { createDefaultMouthRig } from "../mouth-libraries";
import { buildDefaultRig } from "../rig";

function makeCharacter() {
  return {
    ...createBlankCharacter("Actor"),
    id: "char-1",
    parts: [
      makePart("body", "body-media", {
        id: "body-idle",
        slotId: "role:body",
        pose: "idle",
        x: 100,
        y: 120,
        width: 220,
        height: 360,
        zIndex: 1,
      }),
      makePart("eye", "eye-open-media", {
        id: "eye-open",
        slotId: "slot:left-eye",
        eyeState: "open",
        side: "left",
        x: 180,
        y: 180,
        width: 48,
        height: 28,
        zIndex: 4,
      }),
      makePart("eye", "eye-closed-media", {
        id: "eye-closed",
        slotId: "slot:left-eye",
        eyeState: "closed",
        side: "left",
        x: 180,
        y: 184,
        width: 48,
        height: 12,
        zIndex: 4,
      }),
      makePart("mouth", "mouth-rest-media", {
        id: "mouth-rest",
        slotId: "role:mouth",
        viseme: "rest",
        x: 210,
        y: 260,
        width: 90,
        height: 42,
        zIndex: 5,
      }),
      makePart("mouth", "mouth-a-media", {
        id: "mouth-a",
        slotId: "role:mouth",
        viseme: "A",
        x: 210,
        y: 260,
        width: 90,
        height: 54,
        zIndex: 5,
      }),
      makePart("mouth", "mouth-raspberry-media", {
        id: "mouth-raspberry",
        slotId: "role:mouth",
        pose: "raspberry",
        x: 190,
        y: 250,
        width: 150,
        height: 70,
        zIndex: 5,
      }),
    ],
  };
}

function build(
  meta: Partial<CharacterClipMeta> = {},
  motionPresets = new Map<string, MotionPreset>(),
) {
  return buildCharacterCompositionHtml({
    compositionId: "char_clip-1",
    clipId: "clip-1",
    width: 300,
    height: 450,
    duration: 4,
    character: makeCharacter(),
    meta: {
      characterId: "char-1",
      poses: {},
      autoBlink: true,
      ...meta,
    },
    motionPresets,
  });
}

function extractScene(html: string) {
  const match = html.match(/const S = (\{.*?\});\n\s+const tl/s);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]) as {
    initialTargets: Array<{ selector: string; vars: Record<string, number | string> }>;
    motionSegments: Array<{
      targets: Array<{ selector: string; vars: Record<string, number | string> }>;
    }>;
    slotEvents: Array<{
      slotId: string;
      key: string;
      variant?: { show?: string };
      generatedMouth?: { components: Record<string, unknown> };
    }>;
  };
}

describe("buildCharacterCompositionHtml", () => {
  it("generates explicit puppet DOM, asset refs, dimensions, and timeline registration", () => {
    const html = build();
    const validation = validateCompositionSourceHtml(html, {
      compositionId: "char_clip-1",
      duration: 4,
      width: 300,
      height: 450,
    });

    expect(validation.ok).toBe(true);
    expect(html).toContain('data-composition-id="char_clip-1"');
    expect(html).toContain('data-width="300"');
    expect(html).toContain('data-height="450"');
    expect(html).toContain('data-character-root="true"');
    expect(html).toContain('data-character-slot-id="role:body"');
    expect(html).toContain('data-character-part-id="body-idle"');
    expect(html).toContain('src="asset:body-media"');
    expect(html).toContain('src="asset:eye-open-media"');
    expect(html).toContain('window.__timelines["char_clip-1"]');
    // The duration anchor is load-bearing: the hyperframes runtime clamps a
    // composition clip's visibility window to min(data-duration, timeline.duration()),
    // so the character timeline must span the full composition duration.
    expect(html).toContain("tl.to({}, { duration: S.duration }, 0);");
    expect(html).not.toMatch(/repeat\s*:\s*-1/);
    expect(html).not.toMatch(/\basync\b/);
  });

  it("emits nested rig, host, depth, angle, and draw-order metadata", () => {
    const characterBase = {
      ...createBlankCharacter("Rig actor"),
      id: "rig-char",
      parts: [
        makePart("body", "body-media", {
          id: "body",
          slotId: "role:body",
          x: 80,
          y: 130,
          width: 180,
          height: 280,
          zIndex: 1,
        }),
        makePart("head", "head-media", {
          id: "head",
          slotId: "role:head",
          x: 110,
          y: 70,
          width: 120,
          height: 120,
          zIndex: 4,
        }),
        makePart("eye", "eye-media", {
          id: "eye",
          slotId: "slot:left-eye",
          side: "left",
          eyeState: "open",
          x: 140,
          y: 112,
          width: 32,
          height: 20,
          zIndex: 6,
          depth: 5,
        }),
      ],
    };
    const rig = buildDefaultRig(characterBase);
    const character = {
      ...characterBase,
      rig: {
        ...rig,
        activeAngle: "3qL" as const,
        slotBindings: rig.slotBindings.map((binding) =>
          binding.slotId === "slot:left-eye"
            ? { ...binding, depth: 5, angleOverrides: { "3qL": { depth: 7 } } }
            : binding,
        ),
      },
    };
    const html = buildCharacterCompositionHtml({
      compositionId: "char_rig_meta",
      clipId: "clip-rig-meta",
      width: 300,
      height: 450,
      duration: 4,
      character,
      meta: {
        characterId: "rig-char",
        poses: {},
        autoBlink: false,
      },
      motionPresets: new Map(),
    });

    expect(html).toContain('data-character-rig-version="1"');
    expect(html).toContain('data-character-angle="3qL"');
    expect(html).toContain('data-character-bone="true"');
    expect(html).toContain('data-character-bone-id="bone:role:head"');
    expect(html).toContain('data-character-parent-bone-id="bone:role:body"');
    expect(html).toContain('data-character-slot-id="slot:left-eye"');
    expect(html).toContain('data-character-bound-bone-id="bone:slot:left-eye"');
    expect(html).toContain('data-character-host-slot-id="role:head"');
    expect(html).toContain('data-character-host-bone-id="bone:role:head"');
    expect(html).toContain('data-character-depth="7"');
    expect(html).toContain('data-character-draw-order-index="');
  });

  it("uses an active angle part override for slot variants", () => {
    const characterBase = {
      ...createBlankCharacter("Angle actor"),
      id: "angle-char",
      parts: [
        makePart("body", "body-front-media", {
          id: "body-front",
          slotId: "role:body",
          pose: "front",
          x: 80,
          y: 120,
          width: 180,
          height: 280,
          zIndex: 1,
        }),
        makePart("body", "body-3ql-media", {
          id: "body-3ql",
          slotId: "role:body",
          pose: "3qL",
          x: 82,
          y: 120,
          width: 176,
          height: 280,
          zIndex: 1,
        }),
      ],
    };
    const rig = buildDefaultRig(characterBase);
    const html = buildCharacterCompositionHtml({
      compositionId: "char_angle_variant",
      clipId: "clip-angle-variant",
      width: 300,
      height: 450,
      duration: 4,
      character: {
        ...characterBase,
        rig: {
          ...rig,
          activeAngle: "3qL",
          slotBindings: rig.slotBindings.map((binding) =>
            binding.slotId === "role:body"
              ? { ...binding, angleOverrides: { "3qL": { partId: "body-3ql" } } }
              : binding,
          ),
        },
      },
      meta: {
        characterId: "angle-char",
        poses: {},
        autoBlink: false,
      },
      motionPresets: new Map(),
    });
    const scene = extractScene(html);

    expect(scene.slotEvents.some((event) => event.variant?.show?.includes("3qL"))).toBe(true);
    expect(html).toContain('src="asset:body-3ql-media"');
  });

  it("targets bone groups for bone-aware motion while descendants inherit through DOM nesting", () => {
    const character = {
      ...createBlankCharacter("Walker"),
      id: "walker-char",
      parts: [
        makePart("body", "body-media", {
          id: "body",
          slotId: "role:body",
          x: 100,
          y: 120,
          width: 180,
          height: 260,
          zIndex: 1,
        }),
        makePart("leg", "leg-media", {
          id: "left-leg",
          slotId: "slot:left-leg",
          side: "left",
          x: 120,
          y: 350,
          width: 44,
          height: 140,
          zIndex: 0,
        }),
        makePart("foot", "foot-media", {
          id: "left-foot",
          slotId: "slot:left-foot",
          side: "left",
          x: 120,
          y: 480,
          width: 72,
          height: 32,
          zIndex: 0,
        }),
      ],
    };
    const preset: MotionPreset = {
      id: "kick",
      name: "Kick",
      category: "gesture",
      duration: 1,
      loop: false,
      tracks: [
        {
          target: "bone",
          boneId: "bone:slot:left-leg",
          partRole: "leg",
          keyframes: [
            { t: 0, rotation: 0, ease: "linear" },
            { t: 1, rotation: -30, ease: "linear" },
          ],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = buildCharacterCompositionHtml({
      compositionId: "char_bone_motion",
      clipId: "clip-bone-motion",
      width: 300,
      height: 450,
      duration: 2,
      character,
      meta: {
        characterId: "walker-char",
        poses: {},
        autoBlink: false,
        motions: [{ id: "applied-kick", presetId: "kick", offset: 0, intensity: 1 }],
      },
      motionPresets: new Map([["kick", preset]]),
    });
    const scene = extractScene(html);
    const legBoneIndex = html.indexOf('data-character-bone-id="bone:slot:left-leg"');
    const footSlotIndex = html.indexOf('data-character-slot-id="slot:left-foot"');
    const animatedSelectors = scene.motionSegments.flatMap((segment) =>
      segment.targets.map((target) => target.selector),
    );

    expect(legBoneIndex).toBeGreaterThan(-1);
    expect(footSlotIndex).toBeGreaterThan(legBoneIndex);
    expect(
      animatedSelectors.some((selector) => selector.includes("char-bone-bone-slot-left-leg")),
    ).toBe(true);
    expect(
      animatedSelectors.some((selector) => selector.includes("char-slot-slot-left-foot")),
    ).toBe(false);
  });

  it("keeps generated DOM ids unique when slot ids sanitize to the same text", () => {
    const character = {
      ...createBlankCharacter("Actor"),
      id: "char-collision",
      parts: [
        makePart("body", "body-colon-media", {
          id: "body-colon",
          slotId: "slot:body",
          pose: "idle",
          x: 80,
          y: 100,
          zIndex: 1,
        }),
        makePart("body", "body-hyphen-media", {
          id: "body-hyphen",
          slotId: "slot-body",
          pose: "idle",
          x: 160,
          y: 120,
          zIndex: 2,
        }),
      ],
    };
    const html = buildCharacterCompositionHtml({
      compositionId: "char_collision",
      clipId: "clip-collision",
      width: 300,
      height: 450,
      duration: 4,
      character,
      meta: {
        characterId: "char-collision",
        poses: {},
        autoBlink: false,
      },
      motionPresets: new Map(),
    });
    const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);

    expect(new Set(ids).size).toBe(ids.length);
    expect(html).toContain('data-character-slot-id="slot:body"');
    expect(html).toContain('data-character-slot-id="slot-body"');
  });

  it("uses mouth variants by default when a generated rig also exists", () => {
    const character = {
      ...makeCharacter(),
      mouthRig: createDefaultMouthRig("natural", {
        x: 190,
        y: 250,
        width: 150,
        height: 70,
        zIndex: 5,
      }),
    };
    const html = buildCharacterCompositionHtml({
      compositionId: "char_mouth_variants",
      clipId: "clip-mouth-variants",
      width: 300,
      height: 450,
      duration: 4,
      character,
      meta: {
        characterId: "char-1",
        poses: {},
        autoBlink: false,
      },
      motionPresets: new Map(),
    });
    const scene = extractScene(html);

    expect(html).toContain('data-character-part-id="mouth-rest"');
    expect(html).not.toContain('data-character-generated-mouth="true"');
    expect(scene.slotEvents.some((event) => event.slotId === "role:mouth" && event.variant)).toBe(
      true,
    );
  });

  it("renders an explicit generated mouth rig through the same slot event stream", () => {
    const character = {
      ...makeCharacter(),
      mouthStyle: "rig" as const,
      mouthRig: createDefaultMouthRig("natural", {
        x: 190,
        y: 250,
        width: 150,
        height: 70,
        zIndex: 5,
      }),
    };
    const html = buildCharacterCompositionHtml({
      compositionId: "char_mouth_rig",
      clipId: "clip-mouth-rig",
      width: 300,
      height: 450,
      duration: 4,
      character,
      meta: {
        characterId: "char-1",
        poses: {},
        autoBlink: false,
        visemes: [{ t: 0.3, v: "A" }],
      },
      motionPresets: new Map(),
    });
    const scene = extractScene(html);

    expect(html).toContain('data-character-generated-mouth="true"');
    expect(html).toContain("slotEvents");
    expect(html).not.toContain("mouthRigEvents");
    expect(
      scene.slotEvents.some((event) => event.slotId === "role:mouth" && event.generatedMouth),
    ).toBe(true);
  });

  it("serializes speech audio, viseme swaps, and finite applied motion data", () => {
    const preset: MotionPreset = {
      id: "motion-1",
      name: "Body dip",
      category: "gesture",
      duration: 1,
      loop: false,
      tracks: [
        {
          partRole: "body",
          keyframes: [
            { t: 0, dy: 0 },
            { t: 1, dy: 24 },
          ],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = build(
      {
        lipSyncAudioId: "voice-audio",
        visemes: [
          { t: 0, v: "rest" },
          { t: 0.3, v: "A" },
        ],
        motions: [{ id: "applied-1", presetId: preset.id, offset: 0, intensity: 1 }],
      },
      new Map([[preset.id, preset]]),
    );

    expect(html).toContain('data-character-speech="true"');
    expect(html).toContain('src="asset:voice-audio"');
    expect(html).toContain("slotEvents");
    expect(html).toContain("motionSegments");
    expect(html).toContain('"y":12');
  });

  it("emits one audio per speech at its own start time", () => {
    const html = buildCharacterCompositionHtml({
      compositionId: "char_clip-1",
      clipId: "clip-1",
      width: 300,
      height: 450,
      duration: 10,
      character: makeCharacter(),
      meta: { characterId: "char-1", poses: {}, autoBlink: false },
      motionPresets: new Map(),
      speeches: [
        { audioId: "voice-a", start: 0, duration: 2, visemes: [{ t: 0.4, v: "A" }] },
        { audioId: "voice-b", start: 4, duration: 3, visemes: [{ t: 0.4, v: "O" }] },
      ],
    });

    expect((html.match(/data-character-speech="true"/g) ?? []).length).toBe(2);
    expect(html).toContain('src="asset:voice-a"');
    expect(html).toContain('src="asset:voice-b"');
    // Second speech sits at its start offset, not at 0.
    expect(html).toContain('data-start="4"');
  });

  it("allows time-overlapping speeches (distinct track lanes, no composition error)", () => {
    // buildCharacterCompositionHtml runs @hyperframes/core validation and throws if
    // the HTML is invalid — so a successful build proves overlapping audio is fine.
    const html = buildCharacterCompositionHtml({
      compositionId: "char_clip-1",
      clipId: "clip-1",
      width: 300,
      height: 450,
      duration: 10,
      character: makeCharacter(),
      meta: { characterId: "char-1", poses: {}, autoBlink: false },
      motionPresets: new Map(),
      speeches: [
        { audioId: "voice-a", start: 0, duration: 6, visemes: [{ t: 1, v: "A" }] },
        { audioId: "voice-b", start: 3, duration: 6, visemes: [{ t: 1, v: "O" }] }, // overlaps A
      ],
    });

    expect((html.match(/data-character-speech="true"/g) ?? []).length).toBe(2);
    // Each clip on its own track lane, so overlapping in time is not a same-track clash.
    expect(html).toContain('data-track-index="0"');
    expect(html).toContain('data-track-index="1"');
  });

  it("emits data-volume on a speech below full volume, none at 1", () => {
    const html = buildCharacterCompositionHtml({
      compositionId: "char_clip-1",
      clipId: "clip-1",
      width: 300,
      height: 450,
      duration: 10,
      character: makeCharacter(),
      meta: { characterId: "char-1", poses: {}, autoBlink: false },
      motionPresets: new Map(),
      speeches: [
        { audioId: "voice-quiet", start: 0, duration: 3, visemes: [{ t: 1, v: "A" }], volume: 0.4 },
        { audioId: "voice-full", start: 4, duration: 3, visemes: [{ t: 1, v: "O" }], volume: 1 },
      ],
    });

    expect(html).toContain('data-volume="0.4"');
    // Full-volume speech omits data-volume (matches the core generator's rule).
    expect(html).not.toContain('data-volume="1"');
  });

  it("emits data-media-start on a trimmed (in-pointed) speech, none at 0", () => {
    const html = buildCharacterCompositionHtml({
      compositionId: "char_clip-1",
      clipId: "clip-1",
      width: 300,
      height: 450,
      duration: 10,
      character: makeCharacter(),
      meta: { characterId: "char-1", poses: {}, autoBlink: false },
      motionPresets: new Map(),
      speeches: [
        // In-point 1.5s into the source, plays for 2s.
        {
          audioId: "voice-trim",
          start: 0,
          duration: 2,
          visemes: [{ t: 1, v: "A" }],
          mediaStartTime: 1.5,
        },
        { audioId: "voice-head", start: 4, duration: 2, visemes: [{ t: 0.4, v: "O" }] },
      ],
    });

    expect(html).toContain('data-media-start="1.5"');
    // The untrimmed speech omits data-media-start.
    expect((html.match(/data-media-start=/g) ?? []).length).toBe(1);
  });

  it("clamps a trimmed speech's audio duration to the trimmed length", () => {
    const html = buildCharacterCompositionHtml({
      compositionId: "char_clip-1",
      clipId: "clip-1",
      width: 300,
      height: 450,
      duration: 10,
      character: makeCharacter(),
      meta: { characterId: "char-1", poses: {}, autoBlink: false },
      motionPresets: new Map(),
      speeches: [
        // Full source is 8s, but trimmed to play only 3s from an in-point of 2s.
        {
          audioId: "voice-trim",
          start: 1,
          duration: 3,
          visemes: [{ t: 2.5, v: "A" }],
          mediaStartTime: 2,
        },
      ],
    });

    // The emitted <audio> plays the trimmed length, not the full source.
    expect(html).toMatch(/data-character-speech="true"[^>]*data-duration="3"/);
    expect(html).toMatch(/data-character-speech="true"[^>]*data-media-start="2"/);
  });

  it("matches expression recorder face turns in the generated timeline", () => {
    const preset: MotionPreset = {
      id: "expression-turn",
      name: "Look right",
      category: "expression",
      duration: 1,
      loop: false,
      tracks: [],
      keyposes: [
        { t: 0, faceTurnX: 1, parts: [] },
        { t: 1, faceTurnX: 1, parts: [] },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = build(
      {
        autoBlink: false,
        motions: [{ id: "applied-turn", presetId: preset.id, offset: 0, intensity: 1 }],
      },
      new Map([[preset.id, preset]]),
    );
    const scene = extractScene(html);

    expect(
      scene.initialTargets.some(
        (target) => target.selector.includes("left-eye") && target.vars.skewY === -2,
      ),
    ).toBe(true);
  });

  it("lets expression mouth variant swaps drive the mouth when lip sync is inactive", () => {
    const preset: MotionPreset = {
      id: "expression-mouth",
      name: "Raspberry",
      category: "expression",
      duration: 1,
      loop: false,
      tracks: [],
      keyposes: [
        {
          t: 0,
          parts: [{ partRole: "mouth", slotId: "role:mouth", poseSwap: "raspberry" }],
        },
        {
          t: 1,
          parts: [{ partRole: "mouth", slotId: "role:mouth", poseSwap: "raspberry" }],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = build(
      {
        autoBlink: false,
        motions: [{ id: "applied-mouth", presetId: preset.id, offset: 0, intensity: 1 }],
      },
      new Map([[preset.id, preset]]),
    );
    const scene = extractScene(html);
    const mouthTarget = scene.initialTargets.find((target) =>
      target.selector.includes("role-mouth"),
    );

    expect(html).toContain('data-character-part-id="mouth-raspberry"');
    expect(scene.slotEvents.some((event) => event.variant?.show?.includes("raspberry"))).toBe(true);
    expect(mouthTarget?.vars.transformOrigin).toBe("61.111% 59.524%");
  });

  it("lets expression mouth swaps continue when speech audio has no viseme timing", () => {
    const preset: MotionPreset = {
      id: "expression-mouth",
      name: "Raspberry",
      category: "expression",
      duration: 1,
      loop: false,
      tracks: [],
      keyposes: [
        {
          t: 0,
          parts: [{ partRole: "mouth", slotId: "role:mouth", poseSwap: "raspberry" }],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = build(
      {
        autoBlink: false,
        lipSyncAudioId: "imported-voice-audio",
        motions: [{ id: "applied-mouth", presetId: preset.id, offset: 0, intensity: 1 }],
      },
      new Map([[preset.id, preset]]),
    );
    const scene = extractScene(html);

    expect(html).toContain('data-character-speech="true"');
    expect(html).toContain('src="asset:imported-voice-audio"');
    expect(scene.slotEvents.some((event) => event.variant?.show?.includes("raspberry"))).toBe(true);
  });

  it("keeps lip sync in charge of mouth variant swaps when voice visemes exist", () => {
    const preset: MotionPreset = {
      id: "expression-mouth",
      name: "Raspberry",
      category: "expression",
      duration: 1,
      loop: false,
      tracks: [],
      keyposes: [
        {
          t: 0,
          parts: [{ partRole: "mouth", slotId: "role:mouth", poseSwap: "raspberry" }],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = build(
      {
        autoBlink: false,
        lipSyncAudioId: "voice-audio",
        visemes: [{ t: 0, v: "A" }],
        motions: [{ id: "applied-mouth", presetId: preset.id, offset: 0, intensity: 1 }],
      },
      new Map([[preset.id, preset]]),
    );
    const scene = extractScene(html);

    expect(scene.slotEvents.some((event) => event.variant?.show?.includes("raspberry"))).toBe(
      false,
    );
  });

  it("does not let auto blink override an active expression eye pose", () => {
    const preset: MotionPreset = {
      id: "expression-eye",
      name: "Closed eyes",
      category: "expression",
      duration: 10,
      loop: false,
      tracks: [],
      keyposes: [
        {
          t: 0,
          parts: [{ partRole: "eye", slotId: "slot:left-eye", poseSwap: "closed" }],
        },
        {
          t: 10,
          parts: [{ partRole: "eye", slotId: "slot:left-eye", poseSwap: "closed" }],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const clipId = "clip-blink-expression";
    expect(
      blinkWindowsForClip({ id: clipId, duration: 10, autoBlink: true }).length,
    ).toBeGreaterThan(0);
    const html = buildCharacterCompositionHtml({
      compositionId: "char_blink_expression",
      clipId,
      width: 300,
      height: 450,
      duration: 10,
      character: makeCharacter(),
      meta: {
        characterId: "char-1",
        poses: {},
        autoBlink: true,
        motions: [{ id: "applied-eye", presetId: preset.id, offset: 0, intensity: 1 }],
      },
      motionPresets: new Map([[preset.id, preset]]),
    });
    const scene = extractScene(html);

    expect(scene.slotEvents.some((event) => event.variant?.show?.includes("closed"))).toBe(true);
    expect(scene.slotEvents.every((event) => event.key !== "open")).toBe(true);
  });
});
