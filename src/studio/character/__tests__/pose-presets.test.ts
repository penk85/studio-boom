import { describe, expect, it } from "vitest";
import type { CharacterPreset } from "../../types";
import { createBlankCharacter, makePart } from "../character-utils";
import {
  applyPosePreset,
  capturePosePreset,
  defaultPoseForCharacter,
  poseMatchesPreview,
  poseableSlotIds,
  posePresetsForAngle,
  seedDefaultPosePreset,
} from "../pose-presets";
import { makeVariantArmCharacter, withFistVariant } from "./fixtures";

function withFace(character: CharacterPreset): CharacterPreset {
  return {
    ...character,
    parts: [
      ...character.parts,
      makePart("mouth", "mouth-rest-media", {
        id: "mouth-rest",
        slotId: "role:mouth",
        viseme: "rest",
        x: 200,
        y: 100,
        zIndex: 6,
      }),
      makePart("mouth", "mouth-a-media", {
        id: "mouth-a",
        slotId: "role:mouth",
        viseme: "A",
        x: 200,
        y: 100,
        zIndex: 6,
      }),
      makePart("eye", "eye-open-media", {
        id: "eye-open",
        slotId: "slot:left-eye",
        eyeState: "open",
        side: "left",
        x: 180,
        y: 80,
        zIndex: 7,
      }),
      makePart("eye", "eye-closed-media", {
        id: "eye-closed",
        slotId: "slot:left-eye",
        eyeState: "closed",
        side: "left",
        x: 180,
        y: 80,
        zIndex: 7,
      }),
    ],
  };
}

describe("poseableSlotIds", () => {
  it("includes multi-variant limb slots, excludes single-variant and face slots", () => {
    const ids = poseableSlotIds(withFace(makeVariantArmCharacter()));
    expect(ids).toContain("slot:right-arm");
    expect(ids).toContain("slot:right-hand");
    expect(ids).not.toContain("role:body");
    expect(ids).not.toContain("role:mouth");
    expect(ids).not.toContain("slot:left-eye");
  });
});

describe("capturePosePreset", () => {
  it("captures densely: previewed keys win, defaults fill untouched poseable slots", () => {
    const preset = capturePosePreset(
      makeVariantArmCharacter(),
      { "slot:right-arm": "bent" },
      { name: "Waving" },
    );
    expect(preset.name).toBe("Waving");
    expect(preset.poses).toEqual({
      "slot:right-arm": "bent",
      "slot:right-hand": "straight",
    });
    expect(preset.angleIds).toBeUndefined();
  });

  it("passes angle scoping through and never records face slots", () => {
    const preset = capturePosePreset(
      withFace(makeVariantArmCharacter()),
      { "role:mouth": "A" },
      { name: "Side wave", angleIds: ["sideL"] },
    );
    expect(preset.angleIds).toEqual(["sideL"]);
    expect(preset.poses["role:mouth"]).toBeUndefined();
    expect(preset.poses["slot:left-eye"]).toBeUndefined();
  });
});

describe("applyPosePreset", () => {
  it("round-trips a captured pose", () => {
    const character = withFistVariant(makeVariantArmCharacter());
    const preset = capturePosePreset(
      character,
      { "slot:right-arm": "bent", "slot:right-hand": "fist" },
      { name: "Punch" },
    );
    expect(applyPosePreset(character, preset)).toEqual({
      "slot:right-arm": "bent",
      "slot:right-hand": "fist",
    });
  });

  it("drops entries whose slot or key no longer resolves", () => {
    const character = makeVariantArmCharacter();
    const preset = capturePosePreset(
      character,
      { "slot:right-arm": "bent", "slot:right-hand": "bent" },
      { name: "Old pose" },
    );
    const withoutBent = {
      ...character,
      parts: character.parts.filter((part) => !part.id.endsWith("-bent")),
    };
    expect(applyPosePreset(withoutBent, preset)).toEqual({});
  });
});

describe("defaultPoseForCharacter", () => {
  it("honors defaultPoseId, falls back to the first preset, and degrades to {}", () => {
    const character = makeVariantArmCharacter();
    const standing = capturePosePreset(character, {}, { name: "Standing" });
    const waving = capturePosePreset(character, { "slot:right-arm": "bent" }, { name: "Waving" });
    const withPoses = { ...character, posePresets: [standing, waving] };

    expect(defaultPoseForCharacter({ ...withPoses, defaultPoseId: waving.id })).toEqual(
      applyPosePreset(character, waving),
    );
    expect(defaultPoseForCharacter({ ...withPoses, defaultPoseId: "missing" })).toEqual(
      applyPosePreset(character, standing),
    );
    expect(defaultPoseForCharacter(character)).toEqual({});
  });
});

describe("posePresetsForAngle", () => {
  it("treats undefined angleIds as every angle and respects scoping", () => {
    const character = makeVariantArmCharacter();
    const everywhere = capturePosePreset(character, {}, { name: "Standing" });
    const frontOnly = capturePosePreset(character, {}, { name: "Front pose", angleIds: ["front"] });
    const withPoses = { ...character, posePresets: [everywhere, frontOnly] };
    expect(posePresetsForAngle(withPoses, "front").map((preset) => preset.name)).toEqual([
      "Standing",
      "Front pose",
    ]);
    expect(posePresetsForAngle(withPoses, "sideL").map((preset) => preset.name)).toEqual([
      "Standing",
    ]);
  });
});

describe("seedDefaultPosePreset", () => {
  it("seeds one Standing pose with default keys and sets it as default", () => {
    const seeded = seedDefaultPosePreset(makeVariantArmCharacter());
    expect(seeded).not.toBeNull();
    expect(seeded?.posePresets).toHaveLength(1);
    const preset = seeded!.posePresets![0];
    expect(preset.name).toBe("Standing");
    expect(preset.poses).toEqual({
      "slot:right-arm": "straight",
      "slot:right-hand": "straight",
    });
    expect(seeded?.defaultPoseId).toBe(preset.id);
  });

  it("does nothing when presets exist or there is nothing to pose", () => {
    const seeded = seedDefaultPosePreset(makeVariantArmCharacter())!;
    expect(seedDefaultPosePreset(seeded)).toBeNull();
    expect(seedDefaultPosePreset(createBlankCharacter("Empty"))).toBeNull();
  });
});

describe("poseMatchesPreview", () => {
  it("is true for the pose's map, false on deviation, true again when reverted", () => {
    const character = makeVariantArmCharacter();
    const waving = capturePosePreset(character, { "slot:right-arm": "bent" }, { name: "Waving" });
    const applied = applyPosePreset(character, waving);
    expect(poseMatchesPreview(waving, applied, character)).toBe(true);
    expect(
      poseMatchesPreview(waving, { ...applied, "slot:right-hand": "bent" }, character),
    ).toBe(false);
    expect(
      poseMatchesPreview(waving, { ...applied, "slot:right-hand": "straight" }, character),
    ).toBe(true);
  });

  it("ignores face slots when comparing", () => {
    const character = withFace(makeVariantArmCharacter());
    const pose = capturePosePreset(character, {}, { name: "Standing" });
    expect(
      poseMatchesPreview(pose, { ...applyPosePreset(character, pose), "role:mouth": "A" }, character),
    ).toBe(true);
  });
});
