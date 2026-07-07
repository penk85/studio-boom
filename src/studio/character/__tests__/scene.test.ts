import { describe, expect, it } from "vitest";
import {
  buildCharacterScene,
  characterSceneBoneNodeId,
  characterSceneSlotNodeId,
  type CharacterSceneBoneNode,
  type CharacterSceneMeshNode,
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
    const bodySlot = scene.nodes[scene.slotNodeIds["role:body"]] as CharacterSceneSlotNode;
    expect(armSlot.kind).toBe("slot");
    expect(armSlot.defaultVariantKey).toBe("bent");
    expect(armSlot.variantNodeIds.bent).toHaveLength(1);
    expect(armSlot.variantNodeIds.straight).toHaveLength(1);

    const bodyNodeId = bodySlot.variantNodeIds[bodySlot.defaultVariantKey]?.[0];
    expect(bodyNodeId).toBeDefined();
    const body = scene.nodes[bodyNodeId!] as CharacterSceneSpriteNode;
    expect(body.kind).toBe("sprite");

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

  it("emits a rope path mesh node for flexible limb-path parts", () => {
    const character = makeVariantArmCharacter();
    character.parts = character.parts.map((part) =>
      part.id === "arm-straight"
        ? {
            ...part,
            deform: {
              mode: "limb-path" as const,
              start: { x: 10, y: 10 },
              end: { x: 10, y: 180 },
              width: 60,
              segments: 8,
            },
          }
        : part,
    );
    const scene = buildCharacterScene({ character, width: 300, height: 450 });

    const armSlot = scene.nodes[scene.slotNodeIds["slot:right-arm"]] as CharacterSceneSlotNode;
    const straightArm = scene.nodes[armSlot.variantNodeIds.straight[0]] as CharacterSceneMeshNode;
    expect(straightArm.kind).toBe("mesh");
    expect(straightArm.meshKind).toBe("rope");
    expect(straightArm.pathPoints).toHaveLength(9);
    expect(straightArm.pathPoints?.[0]).toEqual({ x: 10, y: 10 });
    expect(straightArm.pathPoints?.[8]).toEqual({ x: 10, y: 180 });
    expect(straightArm.ropeWidth).toBe(60);
    // Rope geometry is in part-local px, so it carries the part's authoring
    // size for the runtime to scale by (not the texture's intrinsic size).
    expect(straightArm.sourceWidth).toBe(60);
    expect(straightArm.sourceHeight).toBe(180);
    expect(straightArm.assetRef).toBe("asset:arm-straight-media");

    // Rigid variants of the same slot stay sprites, and assets register once.
    const bentArm = scene.nodes[armSlot.variantNodeIds.bent[0]] as CharacterSceneSpriteNode;
    expect(bentArm.kind).toBe("sprite");
    expect(scene.assets.find((asset) => asset.id === "arm-straight-media")).toMatchObject({
      partIds: ["arm-straight"],
    });
  });
});
