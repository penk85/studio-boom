import { describe, expect, it } from "vitest";
import type { CharacterClipMeta } from "../../types";
import { createBlankCharacter, makePart } from "../../character/character-utils";
import { buildCharacterCompositionHtml } from "../../character/composition";
import { createDefaultMouthRig } from "../../character/mouth-libraries";
import { applyCharacterCommand } from "../commands";
import { lintCharacterDocument } from "../lint";
import { parseCharacterDocument, parseHtmlDocument } from "../parse";

function makeCharacter() {
  return {
    ...createBlankCharacter("Document Actor"),
    id: "char-doc-1",
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
      makePart("head", "head-media", {
        id: "head-idle",
        slotId: "role:head",
        pose: "idle",
        x: 135,
        y: 48,
        width: 150,
        height: 120,
        zIndex: 3,
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
        x: 202,
        y: 240,
        width: 86,
        height: 36,
        zIndex: 5,
      }),
      makePart("hand", "hand-open-media", {
        id: "right-hand-open",
        slotId: "slot:right-hand",
        pose: "openPalm",
        side: "right",
        x: 285,
        y: 305,
        width: 70,
        height: 80,
        zIndex: 6,
      }),
      makePart("hand", "hand-fist-media", {
        id: "right-hand-fist",
        slotId: "slot:right-hand",
        pose: "closedFist",
        side: "right",
        x: 285,
        y: 305,
        width: 68,
        height: 72,
        zIndex: 6,
      }),
    ],
  };
}

function build(meta: Partial<CharacterClipMeta> = {}) {
  return buildCharacterCompositionHtml({
    compositionId: "char_doc_comp",
    clipId: "clip-doc",
    width: 300,
    height: 450,
    duration: 4,
    character: makeCharacter(),
    meta: {
      characterId: "char-doc-1",
      poses: {},
      autoBlink: false,
      ...meta,
    },
    motionPresets: new Map(),
  });
}

describe("character document boundary", () => {
  it("parses generated HyperFrames character HTML as the character document", () => {
    const html = build();
    const document = parseCharacterDocument(html);

    expect(document.compositionId).toBe("char_doc_comp");
    expect(document.root.characterId).toBe("char-doc-1");
    expect(document.root.rigVersion).toBe(2);
    expect(document.root.activeAngle).toBe("front");
    expect(document.bones.some((bone) => bone.boneId === "bone:role:body")).toBe(true);
    expect(document.slots.some((slot) => slot.slotId === "slot:left-eye")).toBe(true);
    expect(document.parts.some((part) => part.partId === "right-hand-open")).toBe(true);
    expect(document.assetIds).toEqual(
      expect.arrayContaining(["body-media", "eye-open-media", "hand-open-media"]),
    );
  });

  it("applies bone and slot commands to the HyperFrames character document", () => {
    const html = build();
    const withBone = applyCharacterCommand(html, {
      type: "setBoneTransform",
      boneId: "bone:role:head",
      x: 12,
      y: 34,
      rotation: 15,
      depth: 3,
    });
    const withSlot = applyCharacterCommand(withBone, {
      type: "setSlotBinding",
      slotId: "slot:right-hand",
      boneId: "bone:role:head",
      x: 8,
      y: 9,
      rotation: -12,
      scaleX: 1.2,
      scaleY: 0.9,
      depth: 5,
    });

    const document = parseCharacterDocument(withSlot);
    const head = document.bones.find((bone) => bone.boneId === "bone:role:head");
    const hand = document.slots.find((slot) => slot.slotId === "slot:right-hand");
    expect(head).toMatchObject({ x: 12, y: 34, rotation: 15, depth: 3 });
    expect(hand).toMatchObject({
      boundBoneId: "bone:role:head",
      x: 8,
      y: 9,
      rotation: -12,
      scaleX: 1.2,
      scaleY: 0.9,
      depth: 5,
    });

    const doc = parseHtmlDocument(withSlot);
    const handEl = doc.querySelector('[data-character-slot-id="slot:right-hand"]');
    expect(handEl?.parentElement?.getAttribute("data-character-bone-id")).toBe("bone:role:head");
    expect(lintCharacterDocument(withSlot).ok).toBe(true);
  });

  it("applies slot variant commands without creating a duplicate puppet renderer", () => {
    const html = build();
    const updated = applyCharacterCommand(html, {
      type: "setSlotVariant",
      slotId: "slot:right-hand",
      variantId: "closedFist",
    });

    const document = parseCharacterDocument(updated);
    const open = document.parts.find((part) => part.partId === "right-hand-open");
    const fist = document.parts.find((part) => part.partId === "right-hand-fist");
    expect(open?.visible).toBe(false);
    expect(fist?.visible).toBe(true);
    expect(updated).toContain('data-character-slot-id="slot:right-hand"');
  });

  it("binds generated mouth slots into the bone tree", () => {
    const base = makeCharacter();
    const withoutMouth = {
      ...base,
      parts: base.parts.filter((part) => part.role !== "mouth"),
    };

    // Characters without any mouth configuration must not get a phantom SVG mouth —
    // the fallback is only rendered when the user explicitly opts into rig-style mode.
    const noMouthHtml = buildCharacterCompositionHtml({
      compositionId: "char_doc_no_mouth",
      clipId: "clip-no-mouth",
      width: 300,
      height: 450,
      duration: 4,
      character: withoutMouth,
      meta: { characterId: "char-doc-1", poses: {}, autoBlink: false },
      motionPresets: new Map(),
    });
    const noMouthDocument = parseCharacterDocument(noMouthHtml);
    expect(noMouthDocument.slots.find((slot) => slot.slotId === "fallback:mouth")).toBeUndefined();

    // With explicit mouthStyle:"rig", the fallback SVG mouth is generated and bound to the head.
    const fallbackHtml = buildCharacterCompositionHtml({
      compositionId: "char_doc_fallback_mouth",
      clipId: "clip-fallback-mouth",
      width: 300,
      height: 450,
      duration: 4,
      character: { ...withoutMouth, mouthStyle: "rig" as const },
      meta: {
        characterId: "char-doc-1",
        poses: {},
        autoBlink: false,
      },
      motionPresets: new Map(),
    });

    const fallbackDocument = parseCharacterDocument(fallbackHtml);
    const fallbackSlot = fallbackDocument.slots.find((slot) => slot.slotId === "fallback:mouth");
    expect(fallbackSlot?.boundBoneId).toBe("bone:role:head");
    expect(lintCharacterDocument(fallbackHtml).ok).toBe(true);

    const generatedHtml = buildCharacterCompositionHtml({
      compositionId: "char_doc_generated_mouth",
      clipId: "clip-generated-mouth",
      width: 300,
      height: 450,
      duration: 4,
      character: {
        ...withoutMouth,
        fallbackMouth: undefined,
        mouthStyle: "rig" as const,
        mouthRig: createDefaultMouthRig("natural", {
          x: 190,
          y: 250,
          width: 150,
          height: 70,
          zIndex: 5,
        }),
      },
      meta: {
        characterId: "char-doc-1",
        poses: {},
        autoBlink: false,
      },
      motionPresets: new Map(),
    });

    const generatedDocument = parseCharacterDocument(generatedHtml);
    const generatedSlot = generatedDocument.slots.find((slot) => slot.slotId === "role:mouth");
    const generatedDom = parseHtmlDocument(generatedHtml);
    const generatedEl = generatedDom.querySelector('[data-character-slot-id="role:mouth"]');
    expect(generatedSlot?.boundBoneId).toBe("bone:role:head");
    expect(generatedEl?.parentElement?.getAttribute("data-character-bone-id")).toBe(
      "bone:role:head",
    );
    expect(lintCharacterDocument(generatedHtml).ok).toBe(true);
  });

  it("lints missing character bindings before a document is accepted", () => {
    const html = build();
    const broken = html.replace(
      /data-character-bound-bone-id="[^"]+"/,
      'data-character-bound-bone-id="bone:missing"',
    );

    const result = lintCharacterDocument(broken);
    expect(result.ok).toBe(false);
    expect(result.errors.map((issue) => issue.message).join("\n")).toContain(
      'references missing bone "bone:missing"',
    );
  });
});
