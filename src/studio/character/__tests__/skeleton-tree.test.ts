import { describe, expect, it } from "vitest";
import type { CharacterBone } from "../../types";
import { buildSkeletonTree, isSkeletonDetailBone } from "../skeleton-tree";

const bone = (
  id: string,
  parentId?: string,
  patch: Partial<CharacterBone> = {},
): CharacterBone => ({
  id,
  name: id,
  role: "custom",
  parentId,
  x: 0,
  y: 0,
  rotation: 0,
  ...patch,
});

describe("skeleton tree", () => {
  it("keeps pelvis anatomy together and separates IK targets", () => {
    const tree = buildSkeletonTree([
      bone("bone:root", undefined, { role: "root", name: "Root" }),
      bone("bone:pelvis", "bone:root", { controlKind: "pelvis", name: "Pelvis" }),
      bone("bone:body", "bone:pelvis", { role: "body", name: "Torso" }),
      bone("bone:left-leg", "bone:pelvis", { role: "upperLeg", name: "Left upper leg" }),
      bone("bone:left-foot-target", "bone:root", {
        controlKind: "ikTarget",
        name: "Left Foot target",
      }),
    ]);

    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0].bone.id).toBe("bone:root");
    expect(tree.roots[0].children.map((child) => child.bone.id)).toEqual(["bone:pelvis"]);
    expect(tree.roots[0].children[0].children.map((child) => child.bone.id)).toEqual([
      "bone:body",
      "bone:left-leg",
    ]);
    expect(tree.ikTargets.map((target) => target.bone.id)).toEqual(["bone:left-foot-target"]);
  });

  it("identifies facial joints as optional detail", () => {
    expect(isSkeletonDetailBone(bone("eye", undefined, { role: "eye" }))).toBe(true);
    expect(isSkeletonDetailBone(bone("head", undefined, { role: "head" }))).toBe(false);
  });
});
