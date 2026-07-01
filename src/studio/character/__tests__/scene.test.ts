import { describe, expect, it } from "vitest";
import {
  buildCharacterScene,
  characterSceneBoneNodeId,
  characterSceneSlotNodeId,
  type CharacterSceneBoneNode,
  type CharacterSceneSlotNode,
  type CharacterSceneSpriteNode,
} from "../scene";
import { runtimeMotionTargetForSlot } from "../motion-targets";
import { buildCharacterRuntime } from "../runtime";
import { makeVariantArmCharacter } from "./fixtures";

describe("buildCharacterScene", () => {
  it("builds a renderer-neutral slot and sprite graph from the character runtime", () => {
    const scene = buildCharacterScene({
      character: makeVariantArmCharacter(),
      poses: {
        "slot:right-arm": "bent",
        "slot:right-hand": "bent",
      },
      width: 300,
      height: 450,
    });

    expect(scene.output).toEqual({ width: 300, height: 450, scaleX: 0.5, scaleY: 0.5 });
    expect(scene.rootNodeId).toBe("character-scene:root");

    const armSlot = scene.nodes[scene.slotNodeIds["slot:right-arm"]] as CharacterSceneSlotNode;
    expect(armSlot.kind).toBe("slot");
    expect(armSlot.defaultVariantKey).toBe("bent");
    expect(armSlot.variantNodeIds.bent).toHaveLength(1);
    expect(armSlot.variantNodeIds.straight).toHaveLength(1);

    const bentArm = scene.nodes[armSlot.variantNodeIds.bent[0]] as CharacterSceneSpriteNode;
    expect(bentArm.kind).toBe("sprite");
    expect(bentArm.partId).toBe("arm-bent");
    expect(bentArm.assetRef).toBe("asset:arm-bent-media");
    expect(bentArm.frame.width).toBeCloseTo(45);
    expect(bentArm.frame.height).toBeCloseTo(60);
    expect(bentArm.opacity).toBe(1);

    const straightArm = scene.nodes[armSlot.variantNodeIds.straight[0]] as CharacterSceneSpriteNode;
    expect(straightArm.kind).toBe("sprite");
    expect(straightArm.partId).toBe("arm-straight");
    expect(straightArm.opacity).toBe(0);

    expect(scene.assets.map((asset) => asset.id)).toEqual(
      expect.arrayContaining(["body-media", "arm-straight-media", "arm-bent-media"]),
    );
    expect(scene.assets.find((asset) => asset.id === "arm-bent-media")).toMatchObject({
      ref: "asset:arm-bent-media",
      parser: "texture",
      partIds: ["arm-bent"],
    });
  });

  it("maps runtime motion targets to scene nodes instead of DOM selectors", () => {
    const character = makeVariantArmCharacter();
    const runtime = buildCharacterRuntime(character);
    const scene = buildCharacterScene({ character, runtime });

    for (const slot of runtime.slots) {
      const runtimeTarget = runtimeMotionTargetForSlot(runtime, slot.id);
      const sceneTarget = scene.motionTargetsBySlotId[slot.id];
      expect(sceneTarget.runtimeTarget).toEqual(runtimeTarget);
      expect(sceneTarget.address).toBe(
        runtimeTarget.kind === "bone" ? `bone:${runtimeTarget.boneId}` : `slot:${slot.id}`,
      );
      expect(sceneTarget.nodeId).toBe(
        runtimeTarget.kind === "bone"
          ? characterSceneBoneNodeId(runtimeTarget.boneId)
          : characterSceneSlotNodeId(slot.id),
      );
    }
  });

  it("records parent-variant bone anchors in the shared scene contract", () => {
    const scene = buildCharacterScene({
      character: makeVariantArmCharacter(),
      poses: {
        "slot:right-arm": "bent",
      },
      width: 300,
      height: 450,
    });
    const handBone = scene.nodes[
      scene.boneNodeIds["bone:slot:right-hand"]
    ] as CharacterSceneBoneNode;

    expect(handBone.kind).toBe("bone");
    expect(handBone.variantAnchors?.parentSlotId).toBe("slot:right-arm");
    expect(handBone.variantAnchors?.anchors.bent).toBeDefined();
    expect(handBone.frame.x).toBeCloseTo(handBone.variantAnchors!.anchors.bent.x);
    expect(handBone.frame.y).toBeCloseTo(handBone.variantAnchors!.anchors.bent.y);
    expect(handBone.frame.rotation).toBeCloseTo(handBone.variantAnchors!.anchors.bent.rotation);
  });
});
