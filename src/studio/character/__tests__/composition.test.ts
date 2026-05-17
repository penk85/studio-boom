import { describe, expect, it } from "vitest";
import { validateCompositionSourceHtml } from "../../hyperframes/composition-source";
import type { CharacterClipMeta, MotionPreset } from "../../types";
import { createBlankCharacter, makePart } from "../character-utils";
import { buildCharacterCompositionHtml } from "../composition";

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
    expect(html).not.toMatch(/repeat\s*:\s*-1/);
    expect(html).not.toMatch(/\basync\b/);
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
    expect(html).toContain("mouthImageEvents");
    expect(html).toContain("motionSegments");
    expect(html).toContain('"y":12');
  });
});
