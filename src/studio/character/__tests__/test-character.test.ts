import { describe, expect, it } from "vitest";
import { buildRigTestCharacter } from "../test-character";
import { buildCharacterRuntime } from "../runtime";

describe("IK rig test character", () => {
  it("is deliberately small and produces a pelvis plus two foot targets", () => {
    const character = buildRigTestCharacter("test", (key) => `media:${key}`);
    const runtime = buildCharacterRuntime(character);
    const bones = runtime.angleRig.bones;

    expect(character.parts).toHaveLength(8);
    expect(bones.find((bone) => bone.controlKind === "pelvis")?.name).toBe("Pelvis");
    expect(bones.filter((bone) => bone.controlKind === "ikTarget")).toHaveLength(2);
    expect(runtime.angleRig.ikConstraints).toHaveLength(2);
  });
});
