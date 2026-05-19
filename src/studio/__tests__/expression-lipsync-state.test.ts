import { describe, expect, it } from "vitest";
import { eyeVariantsForSlot, resolveEyeState } from "../character/eye-state";
import { listCharacterSlots, pickActivePartForSlot } from "../character/character-utils";
import { visemeAt } from "../lipsync/visemeMap";
import { composeMotionsAt, deltaFor, poseSwapFor } from "../presets/apply";
import { DEFAULT_PARALLAX_CONFIG, DEFAULT_PART_MANIFEST } from "../types";
import type {
  AppliedMotion,
  CharacterPart,
  CharacterPreset,
  MotionPreset,
  MouthViseme,
  PartRole,
} from "../types";

interface TestCharacterClip {
  duration: number;
  motions?: AppliedMotion[];
  visemes?: { t: number; v: MouthViseme }[];
}

const MOUTH_SLOT_ID = "role:mouth";
const EYE_SLOT_ID = "slot:left-eye";
const BROW_SLOT_ID = "slot:left-brow";

function makePart(overrides: Partial<CharacterPart>): CharacterPart {
  const role = overrides.role ?? "custom";
  return {
    id: `${role}-${overrides.pose ?? overrides.viseme ?? overrides.eyeState ?? "base"}`,
    slotId: overrides.slotId ?? `role:${role}`,
    slotName: overrides.slotName ?? role,
    role,
    name: overrides.name ?? `${role} part`,
    mediaId: "media-1",
    x: 100,
    y: 100,
    width: 120,
    height: 80,
    rotation: 0,
    anchorX: 0.5,
    anchorY: 0.5,
    pivot: { x: 160, y: 140 },
    motionBehavior: role === "mouth" ? "lipSync" : role === "eye" ? "blink" : "rotate",
    zIndex: 0,
    depth: 0,
    visible: true,
    ...overrides,
  };
}

function makeCharacter(parts: CharacterPart[]): CharacterPreset {
  return {
    id: "character-1",
    name: "Test Character",
    canvasWidth: 600,
    canvasHeight: 900,
    parts,
    manifest: { ...DEFAULT_PART_MANIFEST },
    parallax: { ...DEFAULT_PARALLAX_CONFIG },
    headVariants: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

function makeClip(overrides: Partial<TestCharacterClip> = {}): TestCharacterClip {
  return {
    duration: 4,
    motions: [],
    ...overrides,
  };
}

function makeExpressionPreset({
  eyePose,
  mouthPose,
}: {
  eyePose: string;
  mouthPose: string;
}): MotionPreset {
  return {
    id: "expression-1",
    name: "Surprised Closed Eyes",
    category: "expression",
    duration: 2,
    loop: false,
    tracks: [],
    keyposes: [
      {
        t: 0,
        parts: [
          { partRole: "eye", slotId: EYE_SLOT_ID, poseSwap: eyePose },
          { partRole: "mouth", slotId: MOUTH_SLOT_ID, poseSwap: mouthPose, dy: -12, scaleY: 0.82 },
          { partRole: "eyebrow", slotId: BROW_SLOT_ID, dy: -8 },
        ],
      },
      {
        t: 2,
        parts: [
          { partRole: "eye", slotId: EYE_SLOT_ID, poseSwap: eyePose },
          { partRole: "mouth", slotId: MOUTH_SLOT_ID, poseSwap: mouthPose, dy: -12, scaleY: 0.82 },
          { partRole: "eyebrow", slotId: BROW_SLOT_ID, dy: -8 },
        ],
      },
    ],
    createdAt: 0,
    updatedAt: 0,
  };
}

function getSlot(character: CharacterPreset, role: PartRole, slotId: string) {
  const slot = listCharacterSlots(character.parts).find((candidate) => {
    return candidate.role === role && candidate.id === slotId;
  });
  if (!slot) throw new Error(`Missing ${role} slot ${slotId}`);
  return slot;
}

function resolveAppliedState({
  character,
  clip,
  presets,
  t,
}: {
  character: CharacterPreset;
  clip: TestCharacterClip;
  presets: Map<string, MotionPreset>;
  t: number;
}) {
  const composed = composeMotionsAt(clip, t, presets);
  const eyeSlot = getSlot(character, "eye", EYE_SLOT_ID);
  const mouthSlot = getSlot(character, "mouth", MOUTH_SLOT_ID);

  const activeEyeState = resolveEyeState({
    expressionPoseSwap: poseSwapFor(composed, "eye", eyeSlot.id),
    proceduralPoseSwap: "closed",
    availableStates: new Set(eyeVariantsForSlot(eyeSlot).map((variant) => variant.state)),
  });
  const activeViseme = visemeAt(clip.visemes, t);

  return {
    activeEyeState,
    activeEyePart: pickActivePartForSlot(eyeSlot, {
      eyeState: activeEyeState,
      pose: activeEyeState,
    }),
    expressionMouthPose: poseSwapFor(composed, "mouth", mouthSlot.id),
    activeMouthViseme: activeViseme,
    activeMouthPart: pickActivePartForSlot(mouthSlot, {
      viseme: activeViseme,
      pose: activeViseme,
    }),
    mouthDelta: deltaFor(composed, "mouth", mouthSlot.id),
    browDelta: deltaFor(composed, "eyebrow", BROW_SLOT_ID),
  };
}

describe("applied expression state with lip sync", () => {
  it("matches the expression preset while lip sync owns only the active mouth shape", () => {
    const customExpressionMouth = "raspberry";
    const lipSyncViseme: MouthViseme = "O";
    const closedEye = makePart({
      id: "eye-closed",
      role: "eye",
      slotId: EYE_SLOT_ID,
      slotName: "Left eye",
      eyeState: "closed",
      side: "left",
    });
    const lipSyncMouth = makePart({
      id: "mouth-o",
      role: "mouth",
      slotId: MOUTH_SLOT_ID,
      slotName: "Mouth",
      viseme: lipSyncViseme,
    });
    const character = makeCharacter([
      makePart({
        id: "eye-open",
        role: "eye",
        slotId: EYE_SLOT_ID,
        slotName: "Left eye",
        eyeState: "open",
        side: "left",
      }),
      makePart({
        id: "eye-wink-extra",
        role: "eye",
        slotId: EYE_SLOT_ID,
        slotName: "Left eye",
        eyeState: "wink",
        side: "left",
      }),
      closedEye,
      makePart({
        id: "mouth-rest",
        role: "mouth",
        slotId: MOUTH_SLOT_ID,
        slotName: "Mouth",
        viseme: "rest",
      }),
      makePart({
        id: "mouth-custom-expression",
        role: "mouth",
        slotId: MOUTH_SLOT_ID,
        slotName: "Mouth",
        pose: customExpressionMouth,
      }),
      lipSyncMouth,
      makePart({
        id: "mouth-extra-smile",
        role: "mouth",
        slotId: MOUTH_SLOT_ID,
        slotName: "Mouth",
        viseme: "Smile",
      }),
      makePart({
        id: "brow-left",
        role: "eyebrow",
        slotId: BROW_SLOT_ID,
        slotName: "Left brow",
      }),
    ]);
    const preset = makeExpressionPreset({
      eyePose: "closed",
      mouthPose: customExpressionMouth,
    });
    const clip = makeClip({
      motions: [{ id: "motion-1", presetId: preset.id, offset: 0, intensity: 1 }],
      visemes: [
        { t: 0, v: "rest" },
        { t: 0.25, v: lipSyncViseme },
      ],
    });

    const state = resolveAppliedState({
      character,
      clip,
      presets: new Map([[preset.id, preset]]),
      t: 1,
    });

    expect(state.activeEyeState).toBe("closed");
    expect(state.activeEyePart?.id).toBe(closedEye.id);
    expect(state.expressionMouthPose).toBe(customExpressionMouth);
    expect(state.activeMouthViseme).toBe(lipSyncViseme);
    expect(state.activeMouthPart?.id).toBe(lipSyncMouth.id);
    expect(state.mouthDelta.dy).toBeCloseTo(-12);
    expect(state.mouthDelta.scaleY).toBeCloseTo(0.82);
    expect(state.browDelta.dy).toBeCloseTo(-8);
  });

  it("allows expression eye pose swaps from the slot variants instead of a fixed test list", () => {
    const customEyePose = "sparkle";
    const customEye = makePart({
      id: "eye-sparkle",
      role: "eye",
      slotId: EYE_SLOT_ID,
      slotName: "Left eye",
      pose: customEyePose,
      side: "left",
    });
    const character = makeCharacter([
      makePart({
        id: "eye-open",
        role: "eye",
        slotId: EYE_SLOT_ID,
        slotName: "Left eye",
        eyeState: "open",
        side: "left",
      }),
      makePart({
        id: "eye-closed",
        role: "eye",
        slotId: EYE_SLOT_ID,
        slotName: "Left eye",
        eyeState: "closed",
        side: "left",
      }),
      customEye,
      makePart({
        id: "mouth-rest",
        role: "mouth",
        slotId: MOUTH_SLOT_ID,
        slotName: "Mouth",
        viseme: "rest",
      }),
    ]);
    const preset = makeExpressionPreset({
      eyePose: customEyePose,
      mouthPose: "rest",
    });
    const clip = makeClip({
      motions: [{ id: "motion-1", presetId: preset.id, offset: 0, intensity: 1 }],
    });

    const state = resolveAppliedState({
      character,
      clip,
      presets: new Map([[preset.id, preset]]),
      t: 1,
    });

    expect(state.activeEyeState).toBe(customEyePose);
    expect(state.activeEyePart?.id).toBe(customEye.id);
  });
});
