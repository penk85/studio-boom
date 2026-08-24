// Pure helpers for presenting the renderer-neutral character bone hierarchy in the editor.
import type { CharacterBone } from "../types";

export interface SkeletonTreeNode {
  bone: CharacterBone;
  children: SkeletonTreeNode[];
}

export interface SkeletonTree {
  roots: SkeletonTreeNode[];
  ikTargets: SkeletonTreeNode[];
}

const DETAIL_ROLES = new Set(["eye", "iris", "eyebrow", "nose", "mouth"]);

/** Facial feature joints are useful for calibration but too noisy for the default skeleton view. */
export function isSkeletonDetailBone(bone: CharacterBone): boolean {
  return DETAIL_ROLES.has(bone.role);
}

/** Build a stable tree from the same parent links used by runtime transforms. */
export function buildSkeletonTree(bones: CharacterBone[]): SkeletonTree {
  const byId = new Map(bones.map((bone) => [bone.id, bone]));
  const childrenByParent = new Map<string, CharacterBone[]>();

  for (const bone of bones) {
    if (bone.controlKind === "ikTarget") continue;
    if (!bone.parentId || !byId.has(bone.parentId)) continue;
    childrenByParent.set(bone.parentId, [...(childrenByParent.get(bone.parentId) ?? []), bone]);
  }

  const sortBones = (left: CharacterBone, right: CharacterBone) => {
    const leftRank = skeletonBoneRank(left);
    const rightRank = skeletonBoneRank(right);
    return leftRank - rightRank || left.name.localeCompare(right.name);
  };

  const build = (bone: CharacterBone, ancestors = new Set<string>()): SkeletonTreeNode => {
    if (ancestors.has(bone.id)) return { bone, children: [] };
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(bone.id);
    return {
      bone,
      children: (childrenByParent.get(bone.id) ?? [])
        .slice()
        .sort(sortBones)
        .map((child) => build(child, nextAncestors)),
    };
  };

  const roots = bones
    .filter((bone) => !bone.controlKind || bone.controlKind === "pelvis")
    .filter((bone) => !bone.parentId || !byId.has(bone.parentId))
    .sort(sortBones)
    .map((bone) => build(bone));
  const ikTargets = bones
    .filter((bone) => bone.controlKind === "ikTarget")
    .sort(sortBones)
    .map((bone) => build(bone));

  return { roots, ikTargets };
}

function skeletonBoneRank(bone: CharacterBone): number {
  if (bone.role === "root") return 0;
  if (bone.controlKind === "pelvis") return 10;
  if (bone.role === "body") return 20;
  if (bone.role === "head") return 30;
  if (bone.role === "arm" || bone.role === "upperArm") return 40;
  if (bone.role === "lowerArm") return 50;
  if (bone.role === "hand") return 60;
  if (bone.role === "leg" || bone.role === "upperLeg") return 70;
  if (bone.role === "lowerLeg") return 80;
  if (bone.role === "foot") return 90;
  if (bone.role === "hair") return 100;
  if (isSkeletonDetailBone(bone)) return 110;
  if (bone.controlKind === "ikTarget") return 200;
  return 120;
}
