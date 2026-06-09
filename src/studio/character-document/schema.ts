import type { CharacterAngle, EyeState, ID, MouthViseme, PartRole } from "../types";

export interface CharacterDocument {
  html: string;
  compositionId: ID;
  duration: number;
  width: number;
  height: number;
  root: CharacterDocumentRoot;
  bones: CharacterDocumentBone[];
  slots: CharacterDocumentSlot[];
  parts: CharacterDocumentPart[];
  assetIds: string[];
}

export interface CharacterDocumentRoot {
  elementId?: ID;
  characterId?: ID;
  rigVersion?: number;
  activeAngle?: CharacterAngle;
}

export interface CharacterDocumentBone {
  elementId: ID;
  boneId: ID;
  parentBoneId?: ID;
  role?: PartRole | "root";
  depth?: number;
  drawOrderIndex?: number;
  x: number;
  y: number;
  rotation: number;
}

export interface CharacterDocumentSlot {
  elementId: ID;
  slotId: ID;
  boundBoneId?: ID;
  hostSlotId?: ID;
  hostBoneId?: ID;
  role?: PartRole;
  side?: string;
  depth?: number;
  drawOrderIndex?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export interface CharacterDocumentPart {
  elementId: ID;
  partId: ID;
  slotId: ID;
  role?: PartRole;
  variant?: string;
  pose?: string;
  viseme?: MouthViseme;
  eyeState?: EyeState;
  assetId?: ID;
  visible: boolean;
}

export type CharacterCommand =
  | {
      type: "setBoneTransform";
      boneId: ID;
      x?: number;
      y?: number;
      rotation?: number;
      depth?: number;
    }
  | {
      type: "setSlotBinding";
      slotId: ID;
      boneId?: ID;
      x?: number;
      y?: number;
      rotation?: number;
      scaleX?: number;
      scaleY?: number;
      depth?: number;
    }
  | {
      type: "setSlotVariant";
      slotId: ID;
      variantId: ID;
    }
  | {
      type: "setActiveAngle";
      angleId: CharacterAngle;
    };

export interface CharacterDocumentIssue {
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface CharacterDocumentLintResult {
  ok: boolean;
  errors: CharacterDocumentIssue[];
  warnings: CharacterDocumentIssue[];
}
