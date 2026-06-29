import { describe, expect, it } from "vitest";
import type { CharacterAngle, PartRole } from "../../types";
import {
  buildPresenterCharacter,
  PRESENTER_ANGLES,
  PRESENTER_CANVAS_H,
  PRESENTER_CANVAS_W,
  PRESENTER_VARIANTS,
  PRESENTER_VERSION,
  presenterPartSpecs,
  type PresenterVariant,
} from "../presenter";
import { listCharacterSlots } from "../character-utils";
import {
  availableCharacterAngles,
  buildDefaultRig,
  normalizeCharacterRig,
  validateCharacterRig,
} from "../rig";
import { applyPosePreset, poseableSlotIds } from "../pose-presets";

/** Each spec key resolves to a stable fake media id so the builder is pure/offline. */
const build = (variant: PresenterVariant) =>
  buildPresenterCharacter("test-presenter", variant, (key) => `media:${key}`);

describe.each(PRESENTER_VARIANTS)("presenter character (%s)", (variant) => {
  it("spans the three configured angles with one angle per part", () => {
    const character = build(variant);
    expect(character.angles).toEqual(PRESENTER_ANGLES);
    // Stamped so the seeder can detect an out-of-date persisted copy and replace it.
    expect(character.builtinVersion).toBe(PRESENTER_VERSION);
    expect(availableCharacterAngles(character)).toEqual(PRESENTER_ANGLES);
    for (const part of character.parts) {
      expect(part.angleIds).toHaveLength(1);
      expect(PRESENTER_ANGLES).toContain(part.angleIds![0]);
    }
    // Every spec key is unique (no media collisions across angles/variants).
    const keys = presenterPartSpecs(variant).map((spec) => spec.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("crops every part to a tight frame within the canvas (not the full canvas)", () => {
    for (const spec of presenterPartSpecs(variant)) {
      const { x, y, width, height } = spec.frame;
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
      // Tight: no part fills the whole canvas in either dimension.
      expect(width, `${spec.key} width`).toBeLessThan(PRESENTER_CANVAS_W);
      expect(height, `${spec.key} height`).toBeLessThan(PRESENTER_CANVAS_H);
      // Frame stays inside the canvas.
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + width).toBeLessThanOrEqual(PRESENTER_CANVAS_W);
      expect(y + height).toBeLessThanOrEqual(PRESENTER_CANVAS_H);
    }
    // The built parts carry the tight frame (and the pivot stays in canvas space, inside it).
    const character = build(variant);
    for (const part of character.parts) {
      expect(part.width).toBeLessThan(PRESENTER_CANVAS_W);
      expect(part.height).toBeLessThan(PRESENTER_CANVAS_H);
    }
  });

  it("gives each angle a full, separately-rigged limb skeleton", () => {
    const character = build(variant);
    const requiredRoles: PartRole[] = [
      "body",
      "head",
      "hair",
      "eye",
      "eyebrow",
      "nose",
      "mouth",
      "arm",
      "lowerArm",
      "hand",
      "leg",
      "lowerLeg",
      "foot",
    ];
    for (const angle of PRESENTER_ANGLES) {
      const roles = new Set(
        listCharacterSlots(character, { angle, includeEmpty: false }).map((slot) => slot.role),
      );
      for (const role of requiredRoles) {
        expect(roles, `${angle} missing role ${role}`).toContain(role);
      }
      // Both sides present for limbs and for the per-side eyes/brows.
      const slots = listCharacterSlots(character, { angle, includeEmpty: false });
      for (const role of ["arm", "lowerArm", "hand", "leg", "lowerLeg", "foot", "eye", "eyebrow"]) {
        const sides = slots.filter((slot) => slot.role === role).map((slot) => slot.side);
        expect(sides, `${angle} ${role} sides`).toEqual(expect.arrayContaining(["left", "right"]));
      }
    }
  });

  it("derives a valid FK rig for every angle", () => {
    const character = build(variant);
    const normalized = normalizeCharacterRig(character);
    expect(validateCharacterRig(normalized).errors).toEqual([]);
    for (const angle of availableCharacterAngles(character)) {
      const rig = buildDefaultRig(character, angle as CharacterAngle);
      const result = validateCharacterRig(rig);
      expect(result.errors, `${angle} rig errors`).toEqual([]);
      // Full FK chain: hand → lowerArm → arm → body, and foot → lowerLeg → leg → body.
      const boneRole = (id: string | undefined) => rig.bones.find((b) => b.id === id)?.role;
      const handBone = rig.bones.find((b) => b.role === "hand");
      expect(handBone, `${angle} hand bone`).toBeDefined();
      expect(boneRole(handBone!.parentId)).toBe("lowerArm");
      const lowerArmBone = rig.bones.find((b) => b.role === "lowerArm");
      expect(boneRole(lowerArmBone!.parentId)).toBe("arm");
      expect(boneRole(rig.bones.find((b) => b.role === "arm")!.parentId)).toBe("body");
      const footBone = rig.bones.find((b) => b.role === "foot");
      expect(boneRole(footBone!.parentId)).toBe("lowerLeg");
      const lowerLegBone = rig.bones.find((b) => b.role === "lowerLeg");
      expect(boneRole(lowerLegBone!.parentId)).toBe("leg");
      expect(boneRole(rig.bones.find((b) => b.role === "leg")!.parentId)).toBe("body");
    }
  });

  it("exposes poseable slots and resolvable pose presets", () => {
    const character = build(variant);
    const poseable = new Set(poseableSlotIds(character));
    expect(poseable).toContain("slot:left-eyebrow");
    expect(poseable).toContain("slot:right-eyebrow");
    expect(poseable).toContain("slot:left-hand");
    expect(poseable).toContain("slot:right-hand");

    expect(character.defaultPoseId).toBe("pose:relaxed");
    for (const preset of character.posePresets ?? []) {
      const applied = applyPosePreset(character, preset);
      // Every slot the preset names still resolves to a real variant.
      expect(Object.keys(applied).sort()).toEqual(Object.keys(preset.poses).sort());
    }
  });
});

describe("presenter variants", () => {
  it("produces distinct art for male vs female (e.g. hair and torso differ)", () => {
    const svgByKey = (variant: PresenterVariant) =>
      new Map(presenterPartSpecs(variant).map((spec) => [spec.key, spec.svg]));
    const male = svgByKey("male");
    const female = svgByKey("female");
    for (const key of ["front:hair", "front:body"]) {
      expect(male.get(key), `${key} should exist`).toBeDefined();
      expect(female.get(key)).not.toBe(male.get(key));
    }
  });

  it("names the female variant distinctly", () => {
    expect(build("female").name).not.toBe(build("male").name);
  });
});
