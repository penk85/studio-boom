import { describe, expect, it } from "vitest";
import { validateCompositionSourceHtml } from "../../hyperframes/composition-source";
import type { CharacterClipMeta, CharacterPreset, MotionPreset } from "../../types";
import { createBlankCharacter, makePart } from "../character-utils";
import { buildCharacterCompositionHtml } from "../composition";
import { blinkWindowsForClip } from "../eye-state";
import { createDefaultMouthRig } from "../mouth-libraries";
import { buildDefaultRig } from "../rig";
import { upsertVariantSocket } from "../variant-pairing";
import { makeVariantArmCharacter, withFistVariant } from "./fixtures";

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
  character = makeCharacter(),
) {
  return buildCharacterCompositionHtml({
    compositionId: "char_clip-1",
    clipId: "clip-1",
    width: 300,
    height: 450,
    duration: 4,
    character,
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
      variant?: { show?: string[] };
      boneAnchors?: Array<{ selector: string; left: number; top: number }>;
      generatedMouth?: { components: Record<string, unknown> };
    }>;
  };
}

function eventShowsVariant(event: { variant?: { show?: string[] } }, value: string) {
  return (event.variant?.show ?? []).some((id) => id.includes(value));
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
    expect(html).toContain("const resetInitialState = function()");
    expect(html).toContain("const originalSeek = tl.seek;");
    expect(html).toContain("tl.seek = function(time, suppressEvents)");
    expect(html).toContain('tl.eventCallback("onStart"');
    expect(html).not.toMatch(/repeat\s*:\s*-1/);
    expect(html).not.toMatch(/\basync\b/);
  });

  it("nests iris slots inside the open eye variant", () => {
    const character = {
      ...createBlankCharacter("Eye actor"),
      id: "eye-char",
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
        makePart("eye", "eye-open-media", {
          id: "eye-open",
          slotId: "slot:left-eye",
          side: "left",
          eyeState: "open",
          x: 140,
          y: 112,
          width: 32,
          height: 20,
          zIndex: 6,
        }),
        makePart("eye", "eye-closed-media", {
          id: "eye-closed",
          slotId: "slot:left-eye",
          side: "left",
          eyeState: "closed",
          x: 140,
          y: 116,
          width: 32,
          height: 8,
          zIndex: 6,
        }),
        makePart("iris", "iris-media", {
          id: "left-iris",
          slotId: "slot:left-iris",
          side: "left",
          x: 152,
          y: 116,
          width: 8,
          height: 8,
          zIndex: 7,
        }),
      ],
    };
    const html = buildCharacterCompositionHtml({
      compositionId: "char_iris_nested",
      clipId: "clip-iris-nested",
      width: 300,
      height: 450,
      duration: 4,
      character: { ...character, rig: buildDefaultRig(character) },
      meta: {
        characterId: "eye-char",
        poses: {},
        autoBlink: false,
      },
      motionPresets: new Map(),
    });

    const openIndex = html.indexOf('data-character-part-id="eye-open"');
    const irisIndex = html.indexOf('data-character-slot-id="slot:left-iris"');
    const closedIndex = html.indexOf('data-character-part-id="eye-closed"');
    expect(openIndex).toBeGreaterThan(-1);
    expect(irisIndex).toBeGreaterThan(openIndex);
    expect(closedIndex).toBeGreaterThan(irisIndex);
  });

  it("keeps nested iris slot motion on the iris target in compiled playback", () => {
    const characterBase = {
      ...createBlankCharacter("Eye actor"),
      id: "eye-char",
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
        makePart("eye", "eye-open-media", {
          id: "eye-open",
          slotId: "slot:left-eye",
          side: "left",
          eyeState: "open",
          x: 140,
          y: 112,
          width: 32,
          height: 20,
          zIndex: 6,
        }),
        makePart("eye", "eye-closed-media", {
          id: "eye-closed",
          slotId: "slot:left-eye",
          side: "left",
          eyeState: "closed",
          x: 140,
          y: 116,
          width: 32,
          height: 8,
          zIndex: 6,
        }),
        makePart("iris", "iris-media", {
          id: "left-iris",
          slotId: "slot:left-iris",
          side: "left",
          x: 152,
          y: 116,
          width: 8,
          height: 8,
          zIndex: 7,
        }),
      ],
    };
    const preset: MotionPreset = {
      id: "iris-look",
      name: "Iris look",
      category: "expression",
      duration: 1,
      loop: false,
      tracks: [],
      keyposes: [
        {
          t: 0,
          parts: [{ partRole: "iris", slotId: "slot:left-iris", dx: 10, dy: 4 }],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = buildCharacterCompositionHtml({
      compositionId: "char_iris_motion",
      clipId: "clip-iris-motion",
      width: characterBase.canvasWidth,
      height: characterBase.canvasHeight,
      duration: 1,
      character: { ...characterBase, rig: buildDefaultRig(characterBase) },
      meta: {
        characterId: "eye-char",
        poses: {},
        autoBlink: false,
        motions: [{ id: "applied-iris", presetId: preset.id, offset: 0, intensity: 1 }],
      },
      motionPresets: new Map([[preset.id, preset]]),
    });
    const scene = extractScene(html);
    const irisTarget = scene.initialTargets.find((target) =>
      target.selector.includes("char-slot-slot-left-iris"),
    );

    expect(irisTarget?.vars.x).toBe(10);
    expect(irisTarget?.vars.y).toBe(4);
  });

  it("renders any nested child slot through slotRelations and parent variant gates", () => {
    const characterBase = {
      ...createBlankCharacter("Mouth child actor"),
      id: "mouth-child-char",
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
        makePart("mouth", "mouth-rest-media", {
          id: "mouth-rest",
          slotId: "role:mouth",
          viseme: "rest",
          x: 120,
          y: 180,
          width: 70,
          height: 32,
          zIndex: 6,
        }),
        makePart("mouth", "mouth-a-media", {
          id: "mouth-a",
          slotId: "role:mouth",
          viseme: "A",
          x: 120,
          y: 180,
          width: 70,
          height: 50,
          zIndex: 6,
        }),
        makePart("custom", "tongue-media", {
          id: "tongue",
          slotId: "slot:tongue",
          slotName: "Tongue",
          x: 140,
          y: 202,
          width: 28,
          height: 16,
          zIndex: 7,
        }),
      ],
    };
    const defaultRig = buildDefaultRig(characterBase);
    const rig = {
      ...defaultRig,
      slotRelations: [
        ...defaultRig.slotRelations.filter((relation) => relation.childSlotId !== "slot:tongue"),
        {
          id: "relation:tongue-mouth-a",
          childSlotId: "slot:tongue",
          parentRef: { type: "slot" as const, id: "role:mouth" },
          relationType: "containedFeature" as const,
          activeWhenParentVariant: { keys: ["A"] },
          transformMode: "inheritParent" as const,
          visibilityMode: "withParentVariant" as const,
          renderMode: "nested" as const,
          clipMode: "none" as const,
        },
      ],
      angles: Object.fromEntries(
        Object.entries(defaultRig.angles ?? {}).map(([angle, angleRig]) => [
          angle,
          angleRig
            ? {
                ...angleRig,
                slotRelations: [
                  ...angleRig.slotRelations.filter(
                    (relation) => relation.childSlotId !== "slot:tongue",
                  ),
                  {
                    id: "relation:tongue-mouth-a",
                    childSlotId: "slot:tongue",
                    parentRef: { type: "slot" as const, id: "role:mouth" },
                    relationType: "containedFeature" as const,
                    activeWhenParentVariant: { keys: ["A"] },
                    transformMode: "inheritParent" as const,
                    visibilityMode: "withParentVariant" as const,
                    renderMode: "nested" as const,
                    clipMode: "none" as const,
                  },
                ],
              }
            : angleRig,
        ]),
      ),
    };
    const html = buildCharacterCompositionHtml({
      compositionId: "char_mouth_child",
      clipId: "clip-mouth-child",
      width: 300,
      height: 450,
      duration: 4,
      character: { ...characterBase, rig },
      meta: {
        characterId: "mouth-child-char",
        poses: {},
        autoBlink: false,
      },
      motionPresets: new Map(),
    });

    const restIndex = html.indexOf('data-character-part-id="mouth-rest"');
    const aIndex = html.indexOf('data-character-part-id="mouth-a"');
    const tongueIndex = html.indexOf('data-character-slot-id="slot:tongue"');
    expect(restIndex).toBeGreaterThan(-1);
    expect(aIndex).toBeGreaterThan(restIndex);
    expect(tongueIndex).toBeGreaterThan(aIndex);
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
    expect(html).toContain('data-character-host-mode="insideHostMask"');
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

    expect(scene.slotEvents.some((event) => eventShowsVariant(event, "3qL"))).toBe(true);
    expect(html).toContain('src="asset:body-3ql-media"');
  });

  it("renders active-angle images while preserving shared slot art", () => {
    const characterBase = {
      ...createBlankCharacter("Angle art actor"),
      id: "angle-art-char",
      angles: ["front", "sideL"] as CharacterPreset["angles"],
      parts: [
        makePart("body", "body-front-media", {
          id: "body-front",
          slotId: "role:body",
          angleIds: ["front"],
          x: 80,
          y: 120,
          width: 180,
          height: 280,
          zIndex: 1,
        }),
        makePart("body", "body-side-media", {
          id: "body-side",
          slotId: "role:body",
          angleIds: ["sideL"],
          x: 88,
          y: 120,
          width: 150,
          height: 280,
          zIndex: 1,
        }),
        makePart("hand", "shared-hand-media", {
          id: "shared-hand",
          slotId: "slot:left-hand",
          side: "left",
          x: 56,
          y: 270,
          width: 64,
          height: 80,
          zIndex: 4,
        }),
      ],
    };
    const rig = buildDefaultRig(characterBase, "sideL");
    const html = buildCharacterCompositionHtml({
      compositionId: "char_angle_art",
      clipId: "clip-angle-art",
      width: 300,
      height: 450,
      duration: 4,
      character: {
        ...characterBase,
        rig,
      },
      meta: {
        characterId: "angle-art-char",
        poses: {},
        autoBlink: false,
      },
      motionPresets: new Map(),
    });

    expect(html).toContain('src="asset:body-side-media"');
    expect(html).not.toContain('src="asset:body-front-media"');
    expect(html).toContain('src="asset:shared-hand-media"');
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

  it("emits 3D transform vars (rotationY + transformPerspective) for a 3D bone motion", () => {
    const character = {
      ...createBlankCharacter("Flipper"),
      id: "flipper-char",
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
      ],
    };
    const preset: MotionPreset = {
      id: "cardflip",
      name: "Card Flip",
      category: "gesture",
      duration: 1,
      loop: false,
      tracks: [
        {
          target: "bone",
          boneId: "bone:slot:left-leg",
          partRole: "leg",
          keyframes: [
            { t: 0, rotationY: 0, transformPerspective: 800, ease: "linear" },
            { t: 1, rotationY: 360, transformPerspective: 800, ease: "linear" },
          ],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = buildCharacterCompositionHtml({
      compositionId: "char_cardflip",
      clipId: "clip-cardflip",
      width: 300,
      height: 450,
      duration: 2,
      character,
      meta: {
        characterId: "flipper-char",
        poses: {},
        autoBlink: false,
        motions: [{ id: "applied-flip", presetId: "cardflip", offset: 0, intensity: 1 }],
      },
      motionPresets: new Map([["cardflip", preset]]),
    });
    const scene = extractScene(html);
    const allTargets = [
      ...scene.initialTargets,
      ...scene.motionSegments.flatMap((segment) => segment.targets),
    ];
    // 3D vars must reach the GSAP timeline, and the flip animates all the way to 360°.
    expect(allTargets.some((target) => typeof target.vars.rotationY === "number")).toBe(true);
    expect(allTargets.some((target) => target.vars.transformPerspective === 800)).toBe(true);
    expect(allTargets.some((target) => target.vars.rotationY === 360)).toBe(true);
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
    expect(scene.slotEvents.some((event) => eventShowsVariant(event, "raspberry"))).toBe(true);
    expect(mouthTarget?.vars.transformOrigin).toBe("61.111% 59.524%");
  });

  it("lets generic slot variants drive hand swaps without pose fields", () => {
    const base = makeCharacter();
    const character: CharacterPreset = {
      ...base,
      parts: [
        ...base.parts,
        makePart("hand", "hand-open-media", {
          id: "hand-open",
          slotId: "slot:right-hand",
          slotName: "Right hand",
          side: "right",
          variant: { key: "open", name: "Open hand", kind: "handShape" },
          x: 236,
          y: 320,
          width: 52,
          height: 58,
          zIndex: 8,
        }),
        makePart("hand", "hand-fist-media", {
          id: "hand-fist",
          slotId: "slot:right-hand",
          slotName: "Right hand",
          side: "right",
          variant: { key: "fist", name: "Fist", kind: "handShape" },
          x: 236,
          y: 320,
          width: 52,
          height: 58,
          zIndex: 8,
        }),
      ],
    };
    const preset: MotionPreset = {
      id: "generic-hand",
      name: "Make fist",
      category: "gesture",
      duration: 1,
      loop: false,
      tracks: [],
      keyposes: [
        {
          t: 0,
          parts: [{ partRole: "hand", slotId: "slot:right-hand", poseSwap: "fist" }],
        },
        {
          t: 1,
          parts: [{ partRole: "hand", slotId: "slot:right-hand", poseSwap: "fist" }],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = build(
      {
        autoBlink: false,
        motions: [{ id: "applied-hand", presetId: preset.id, offset: 0, intensity: 1 }],
      },
      new Map([[preset.id, preset]]),
      character,
    );
    const scene = extractScene(html);

    expect(html).toContain('data-character-variant="fist"');
    expect(html).toContain('data-character-variant-kind="handShape"');
    expect(scene.slotEvents.some((event) => eventShowsVariant(event, "fist"))).toBe(true);
  });

  it("shows every artwork layer that belongs to the active generic variant", () => {
    const base = makeCharacter();
    const character: CharacterPreset = {
      ...base,
      parts: [
        ...base.parts,
        makePart("arm", "upper-arm-open-media", {
          id: "upper-arm-open",
          slotId: "slot:right-arm",
          slotName: "Right arm",
          side: "right",
          variant: { key: "explaining", name: "Explaining arm", kind: "pose" },
          x: 220,
          y: 270,
          width: 48,
          height: 96,
          zIndex: 7,
        }),
        makePart("arm", "forearm-open-media", {
          id: "forearm-open",
          slotId: "slot:right-arm",
          slotName: "Right arm",
          side: "right",
          variant: { key: "explaining", name: "Explaining arm", kind: "pose" },
          x: 256,
          y: 330,
          width: 72,
          height: 42,
          zIndex: 8,
        }),
      ],
    };
    const preset: MotionPreset = {
      id: "explaining-arm",
      name: "Explaining arm",
      category: "gesture",
      duration: 1,
      loop: false,
      tracks: [],
      keyposes: [
        {
          t: 0,
          parts: [{ partRole: "arm", slotId: "slot:right-arm", poseSwap: "explaining" }],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = build(
      {
        autoBlink: false,
        motions: [{ id: "applied-arm", presetId: preset.id, offset: 0, intensity: 1 }],
      },
      new Map([[preset.id, preset]]),
      character,
    );
    const scene = extractScene(html);
    const event = scene.slotEvents.find((candidate) => candidate.key === "explaining");

    expect(event?.variant?.show?.filter((id) => id.includes("explaining"))).toHaveLength(2);
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
    expect(scene.slotEvents.some((event) => eventShowsVariant(event, "raspberry"))).toBe(true);
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

    expect(scene.slotEvents.some((event) => eventShowsVariant(event, "raspberry"))).toBe(false);
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

    expect(scene.slotEvents.some((event) => eventShowsVariant(event, "closed"))).toBe(true);
    expect(scene.slotEvents.every((event) => event.key !== "open")).toBe(true);
  });
});

describe("parent variant bone anchors", () => {
  // Canvas 600x900 rendered at 300x450 → scale 0.5. Hand bone base anchor is
  // (10, 175) canvas px (straight hand pivot − arm pivot); the bent arm carries
  // it to (80, 60). Scaled: base (5, 87.5), bent (40, 30).
  const bentArmPreset: MotionPreset = {
    id: "bend-arm",
    name: "Bend arm",
    category: "gesture",
    duration: 1,
    loop: false,
    tracks: [],
    keyposes: [
      { t: 0, parts: [{ partRole: "arm", slotId: "slot:right-arm", poseSwap: "bent" }] },
      { t: 1, parts: [{ partRole: "arm", slotId: "slot:right-arm", poseSwap: "bent" }] },
    ],
    createdAt: 0,
    updatedAt: 0,
  };

  function handBoneTag(html: string): string {
    const match = html.match(/<div id="char-bone-bone-slot-right-hand[^"]*"[^>]*>/);
    expect(match).not.toBeNull();
    return match![0];
  }

  it("emits scaled variant anchors on the child bone element", () => {
    const html = build({ autoBlink: false }, new Map(), makeVariantArmCharacter());
    const bone = handBoneTag(html);
    expect(bone).toContain("data-character-variant-anchors=");
    const attr = bone.match(/data-character-variant-anchors="([^"]+)"/);
    const parsed = JSON.parse(attr![1].replace(/&quot;/g, '"')) as {
      base: { left: number; top: number };
      anchors: Record<string, { left: number; top: number }>;
    };
    expect(parsed.base).toEqual({ left: 5, top: 87.5, rotation: 0 });
    expect(parsed.anchors.bent).toEqual({ left: 40, top: 30, rotation: 0 });
    // Aliases of the bent arm part resolve to the same anchor.
    expect(parsed.anchors["arm-bent"]).toEqual({ left: 40, top: 30, rotation: 0 });
    // The straight (representative) variant needs no entry — base applies.
    expect(bone).toContain("left:5px");
    expect(bone).toContain("top:87.5px");
  });

  it("bakes the initial bone anchor from the placed pose", () => {
    const html = build(
      { autoBlink: false, poses: { "slot:right-arm": "bent" } },
      new Map(),
      makeVariantArmCharacter(),
    );
    const bone = handBoneTag(html);
    expect(bone).toContain("left:40px");
    expect(bone).toContain("top:30px");
  });

  it("re-anchors the hand bone through variant slot events when a motion bends the arm", () => {
    const html = build(
      {
        autoBlink: false,
        motions: [{ id: "applied-bend", presetId: bentArmPreset.id, offset: 0, intensity: 1 }],
      },
      new Map([[bentArmPreset.id, bentArmPreset]]),
      makeVariantArmCharacter(),
    );
    const scene = extractScene(html);
    const armEvents = scene.slotEvents.filter((event) => event.slotId === "slot:right-arm");
    const bentEvent = armEvents.find((event) => event.key === "bent");
    expect(bentEvent?.boneAnchors).toBeDefined();
    const anchor = bentEvent!.boneAnchors!.find((entry) =>
      entry.selector.startsWith("#char-bone-bone-slot-right-hand"),
    );
    expect(anchor).toMatchObject({ left: 40, top: 30 });
    // After the motion ends the arm returns to straight, restoring the base anchor.
    const straightEvent = armEvents.find(
      (event) => event.key !== "bent" && event.boneAnchors?.length,
    );
    expect(
      straightEvent?.boneAnchors?.find((entry) =>
        entry.selector.startsWith("#char-bone-bone-slot-right-hand"),
      ),
    ).toMatchObject({ left: 5, top: 87.5 });
    // The runtime applies anchors on swap and reset.
    expect(html).toContain("event.boneAnchors");
  });

  it("emits no anchor attributes for variant-less characters", () => {
    const html = build();
    expect(html).not.toContain("data-character-variant-anchors=");
  });
});

describe("pivot-aligned variant placement", () => {
  // Canvas 600x900 rendered at 300x450 → scale 0.5. The contract under test: in a bone-bound
  // variant slot, the DISPLAYED art's pivot rides the joint (and therefore any pinned socket),
  // regardless of which variant is showing or where it was drawn on the canvas.
  function tagStyle(html: string, pattern: RegExp): string {
    const match = html.match(pattern);
    expect(match, `no element matching ${pattern}`).not.toBeNull();
    return match![0].match(/style="([^"]*)"/)![1];
  }

  function leftTop(style: string): { left: number; top: number } {
    const left = style.match(/left:(-?[\d.]+)px/);
    const top = style.match(/top:(-?[\d.]+)px/);
    expect(left, `no left in ${style}`).not.toBeNull();
    expect(top, `no top in ${style}`).not.toBeNull();
    return { left: Number(left![1]), top: Number(top![1]) };
  }

  function elementPos(html: string, idPrefix: string): { left: number; top: number } {
    return leftTop(tagStyle(html, new RegExp(`<div id="${idPrefix}[^"]*"[^>]*>`)));
  }

  function partPos(html: string, partId: string): { left: number; top: number } {
    return leftTop(
      tagStyle(html, new RegExp(`<[a-z]+ [^>]*data-character-part-id="${partId}"[^>]*>`)),
    );
  }

  it("lands the displayed non-rep variant's pivot exactly on the pinned socket", () => {
    // The user's reported bug: a wrist socket pinned for the bent arm, with the hand showing a
    // non-representative variant — the hand art used to sit offset from the socket by the
    // difference between its pivot and the representative's pivot.
    const socket = { x: 400, y: 250 };
    const character = upsertVariantSocket(makeVariantArmCharacter(), {
      parentSlotId: "slot:right-arm",
      variantKey: "bent",
      childSlotId: "slot:right-hand",
      ...socket,
    });
    const html = build(
      { autoBlink: false, poses: { "slot:right-arm": "bent", "slot:right-hand": "bent" } },
      new Map(),
      character,
    );
    const body = elementPos(html, "char-bone-bone-role-body");
    const arm = elementPos(html, "char-bone-bone-slot-right-arm");
    const handBone = elementPos(html, "char-bone-bone-slot-right-hand");
    const container = elementPos(html, "char-slot-slot-right-hand");
    const art = partPos(html, "hand-bent");
    // hand-bent pivot (370,230) − authored xy (360,220) = (10,10), scaled by 0.5.
    const pivotInArt = { x: 5, y: 5 };
    expect(body.left + arm.left + handBone.left + container.left + art.left + pivotInArt.x).toBe(
      socket.x * 0.5,
    );
    expect(body.top + arm.top + handBone.top + container.top + art.top + pivotInArt.y).toBe(
      socket.y * 0.5,
    );
  });

  it("rides a non-rep variant chosen at rest on the representative's joint instead of floating at its drawn spot", () => {
    // Bent-hand art picked while the arm stays straight: it must attach at the straight wrist
    // (the hand bone's base anchor), not display at its authored canvas position.
    const html = build(
      { autoBlink: false, poses: { "slot:right-hand": "bent" } },
      new Map(),
      makeVariantArmCharacter(),
    );
    const art = partPos(html, "hand-bent");
    // pivotAligned offset = pivotLocal(straight)(10,5) − pivotLocal(bent)(10,10) = (0,−5) × 0.5.
    expect(art).toEqual({ left: 0, top: -2.5 });
    // Full chain lands the displayed pivot on the straight wrist pivot (300,345) × 0.5.
    const body = elementPos(html, "char-bone-bone-role-body");
    const arm = elementPos(html, "char-bone-bone-slot-right-arm");
    const handBone = elementPos(html, "char-bone-bone-slot-right-hand");
    const container = elementPos(html, "char-slot-slot-right-hand");
    expect(body.left + arm.left + handBone.left + container.left + art.left + 5).toBe(150);
    expect(body.top + arm.top + handBone.top + container.top + art.top + 5).toBe(172.5);
  });

  it("keeps the representative group at its authored position (byte-stable placement)", () => {
    const html = build({ autoBlink: false }, new Map(), makeVariantArmCharacter());
    expect(partPos(html, "hand-straight")).toEqual({ left: 0, top: 0 });
    expect(partPos(html, "arm-straight")).toEqual({ left: 0, top: 0 });
  });

  it("aligns multi-layer variants as one group, preserving the layers' relative layout", () => {
    const base = makeVariantArmCharacter();
    const character: CharacterPreset = {
      ...base,
      parts: [
        ...base.parts,
        makePart("arm", "expl-upper-media", {
          id: "expl-upper",
          slotId: "slot:right-arm",
          side: "right",
          variant: { key: "explaining", name: "Explaining arm", kind: "pose" },
          x: 320,
          y: 200,
          width: 48,
          height: 96,
          zIndex: 7,
          pivot: { x: 340, y: 220 },
        }),
        makePart("arm", "expl-fore-media", {
          id: "expl-fore",
          slotId: "slot:right-arm",
          side: "right",
          variant: { key: "explaining", name: "Explaining arm", kind: "pose" },
          x: 356,
          y: 260,
          width: 72,
          height: 42,
          zIndex: 8,
          pivot: { x: 392, y: 281 },
        }),
      ],
    };
    const html = build({ autoBlink: false }, new Map(), character);
    const upper = partPos(html, "expl-upper");
    const fore = partPos(html, "expl-fore");
    // Group anchor = first matching layer (expl-upper): pivotLocal(rep arm)(10,10) −
    // pivotLocal(expl-upper)(20,20) = (−10,−10) × 0.5.
    expect(upper).toEqual({ left: -5, top: -5 });
    // The second layer moves by the SAME group delta: relative layout (36,60) × 0.5 preserved.
    expect(fore.left - upper.left).toBe(18);
    expect(fore.top - upper.top).toBe(30);
  });

  it("keeps face builders on authored placement (eyes and mouths are not joint attachments)", () => {
    const html = build({ autoBlink: false });
    // eye-closed authored offset from eye-open: (0,4) × 0.5 — NOT alpha/pivot aligned.
    expect(partPos(html, "eye-closed")).toEqual({ left: 0, top: 2 });
    // mouth-raspberry authored offset from mouth-rest: (−20,−10) × 0.5.
    expect(partPos(html, "mouth-raspberry")).toEqual({ left: -10, top: -5 });
  });

  it("rotates a swapped variant about the joint, not its authored canvas offset", () => {
    const preset: MotionPreset = {
      id: "bent-hand-twist",
      name: "Bent hand twist",
      category: "gesture",
      duration: 1,
      loop: false,
      tracks: [],
      keyposes: [
        {
          t: 0,
          parts: [
            {
              target: "slot",
              partRole: "hand",
              slotId: "slot:right-hand",
              poseSwap: "bent",
              rotation: 10,
            },
          ],
        },
        {
          t: 1,
          parts: [
            {
              target: "slot",
              partRole: "hand",
              slotId: "slot:right-hand",
              poseSwap: "bent",
              rotation: 10,
            },
          ],
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = build(
      {
        autoBlink: false,
        motions: [{ id: "applied-twist", presetId: preset.id, offset: 0, intensity: 1 }],
      },
      new Map([[preset.id, preset]]),
      makeVariantArmCharacter(),
    );
    const scene = extractScene(html);
    const origins = [
      ...scene.initialTargets,
      ...scene.motionSegments.flatMap((segment) => segment.targets),
    ]
      .filter((target) => target.selector.startsWith("#char-slot-slot-right-hand"))
      .map((target) => target.vars.transformOrigin)
      .filter((origin): origin is string => origin !== undefined);
    expect(origins.length).toBeGreaterThan(0);
    // The joint sits at container-local (10,5) of the 40×40 base box — for every frame,
    // including the ones displaying the swapped bent hand (which used to read "200% -275%").
    for (const origin of origins) expect(origin).toBe("25% 12.5%");
  });
});

describe("variant rotation limits in compiled playback", () => {
  // withFistVariant: the fist variant package limits hand rotation to [-15, 15], tighter than
  // anything the motion asks for. The motion holds the fist while rotating the hand to 60°.
  const rotatePastLimit: MotionPreset = {
    id: "fist-twist",
    name: "Fist twist",
    category: "gesture",
    duration: 1,
    loop: false,
    tracks: [],
    keyposes: [
      {
        t: 0,
        parts: [
          {
            target: "slot",
            partRole: "hand",
            slotId: "slot:right-hand",
            poseSwap: "fist",
            rotation: 60,
          },
        ],
      },
      {
        t: 1,
        parts: [
          {
            target: "slot",
            partRole: "hand",
            slotId: "slot:right-hand",
            poseSwap: "fist",
            rotation: 60,
          },
        ],
      },
    ],
    createdAt: 0,
    updatedAt: 0,
  };

  function handRotations(html: string): number[] {
    const scene = extractScene(html);
    const all = [
      ...scene.initialTargets,
      ...scene.motionSegments.flatMap((segment) => segment.targets),
    ];
    return all
      .filter((target) => target.selector.includes("right-hand"))
      .map((target) => target.vars.rotation)
      .filter((rotation): rotation is number => typeof rotation === "number");
  }

  it("clamps motion rotation to the active variant's rotation limits", () => {
    const html = build(
      {
        autoBlink: false,
        motions: [{ id: "applied-twist", presetId: rotatePastLimit.id, offset: 0, intensity: 1 }],
      },
      new Map([[rotatePastLimit.id, rotatePastLimit]]),
      withFistVariant(makeVariantArmCharacter()),
    );
    const rotations = handRotations(html);
    expect(rotations.length).toBeGreaterThan(0);
    expect(Math.max(...rotations)).toBe(15);
    expect(rotations.every((rotation) => rotation <= 15)).toBe(true);
  });

  it("lets allowOutOfBounds push past the variant limit", () => {
    const unclamped: MotionPreset = {
      ...rotatePastLimit,
      id: "fist-twist-free",
      allowOutOfBounds: ["slot:right-hand"],
    };
    const html = build(
      {
        autoBlink: false,
        motions: [{ id: "applied-free", presetId: unclamped.id, offset: 0, intensity: 1 }],
      },
      new Map([[unclamped.id, unclamped]]),
      withFistVariant(makeVariantArmCharacter()),
    );
    const rotations = handRotations(html);
    expect(Math.max(...rotations)).toBe(60);
  });

  it("treats a hand drawn inside the arm art as plain variants — no anchors, no warnings", () => {
    const base = makeVariantArmCharacter();
    const character = {
      ...base,
      // No hand slot at all: the hand pixels live inside each arm variant's artwork.
      parts: base.parts.filter((part) => part.slotId !== "slot:right-hand"),
    };
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...parts: unknown[]) => {
      warnings.push(parts.join(" "));
    };
    try {
      const html = build(
        { autoBlink: false, poses: { "slot:right-arm": "bent" } },
        new Map(),
        character,
      );
      expect(html).not.toContain("data-character-variant-anchors=");
      expect(warnings.filter((entry) => entry.includes("fallback anchor"))).toEqual([]);
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe("anchor rotation in compiled playback", () => {
  // The wrist joint is authored on the rig (bone-owned, per angle) — the post-refactor path.
  const rotatedSocketCharacter = (): CharacterPreset =>
    upsertVariantSocket(makeVariantArmCharacter(), {
      parentSlotId: "slot:right-arm",
      variantKey: "bent",
      childSlotId: "slot:right-hand",
      x: 352,
      y: 248,
      rotation: -35,
    });

  it("bakes the variant rotation into the initial bone transform for a placed pose", () => {
    const html = build(
      { autoBlink: false, poses: { "slot:right-arm": "bent" } },
      new Map(),
      rotatedSocketCharacter(),
    );
    const bone = html.match(/<div id="char-bone-bone-slot-right-hand[^"]*"[^>]*>/)![0];
    expect(bone).toContain("rotate(-35deg)");
  });

  it("carries rotation through variant slot events", () => {
    const preset: MotionPreset = {
      id: "bend-arm-rot",
      name: "Bend arm",
      category: "gesture",
      duration: 1,
      loop: false,
      tracks: [],
      keyposes: [
        { t: 0, parts: [{ partRole: "arm", slotId: "slot:right-arm", poseSwap: "bent" }] },
        { t: 1, parts: [{ partRole: "arm", slotId: "slot:right-arm", poseSwap: "bent" }] },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const html = build(
      {
        autoBlink: false,
        motions: [{ id: "applied-bend", presetId: preset.id, offset: 0, intensity: 1 }],
      },
      new Map([[preset.id, preset]]),
      rotatedSocketCharacter(),
    );
    const scene = extractScene(html);
    const bentEvent = scene.slotEvents.find(
      (event) => event.slotId === "slot:right-arm" && event.key === "bent",
    );
    const anchor = bentEvent?.boneAnchors?.find((entry) =>
      entry.selector.startsWith("#char-bone-bone-slot-right-hand"),
    ) as { rotation?: number } | undefined;
    expect(anchor?.rotation).toBe(-35);
    expect(html).toContain("rotation: anchor.rotation");
  });
});

describe("per-angle artwork in compiled output", () => {
  it("a side-view build contains no front-only parts (no stacked angle art)", () => {
    const base = makeVariantArmCharacter();
    const character: CharacterPreset = {
      ...base,
      angles: ["front", "sideL"],
      parts: [
        // Front-only drawings…
        ...base.parts.map((part) => ({ ...part, angleIds: ["front" as const] })),
        // …plus one side-view body in the same slot vocabulary.
        makePart("body", "side-body-media", {
          id: "side-body",
          slotId: "role:body",
          angleIds: ["sideL"],
          x: 120,
          y: 130,
          width: 160,
          height: 320,
          zIndex: 1,
        }),
      ],
      rig: undefined,
    };
    const sideRig = buildDefaultRig(character, "sideL");
    const html = buildCharacterCompositionHtml({
      compositionId: "char_side",
      clipId: "clip-side",
      width: 300,
      height: 450,
      duration: 4,
      character: { ...character, rig: { ...sideRig, activeAngle: "sideL" } },
      meta: { characterId: character.id, poses: {}, autoBlink: false },
      motionPresets: new Map(),
    });
    expect(html).toContain('src="asset:side-body-media"');
    // Front drawings must not stack into the side view's render/export.
    expect(html).not.toContain('src="asset:body-media"');
    expect(html).not.toContain('src="asset:arm-straight-media"');
    expect(html).not.toContain('src="asset:hand-straight-media"');
  });
});
