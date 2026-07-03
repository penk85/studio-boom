import type {
  CharacterAngle,
  CharacterHostConstraint,
  CharacterPart,
  CharacterPreset,
  CharacterRig,
  ID,
} from "../types";
import { pivotForPart } from "./alpha-bounds";
import { getPartSlotId, partAvailableForAngle } from "./character-utils";
import {
  setBoneDepth,
  setSlotDepth,
  setSlotHostConstraint,
  setSlotReach,
  setSlotRotReach,
  moveSlotBinding,
  moveSlotParts,
  normalizeCharacterRig,
  resolveSlotBinding,
  slotIdsForBoneSubtree,
} from "./rig";
import {
  moveCharacterBoneRest,
  setCharacterBoneRestTransform,
  setCharacterSlotParent,
} from "./rig-v2";
import {
  removeVariantPin,
  resetVariantPinToArtwork,
  setVariantPinRotation,
  upsertVariantPinAtPoint,
} from "./variant-pairing";

export interface CharacterSceneCommandResult {
  character: CharacterPreset;
  changed: boolean;
}

export interface MoveSlotCommand {
  kind: "move-slot";
  slotId: ID;
  dx: number;
  dy: number;
  angle?: CharacterAngle;
  rig?: CharacterRig;
  /** False for temporary preview poses such as reach sweeps. Defaults to true. */
  updateRig?: boolean;
}

export interface ScaleSlotCommand {
  kind: "scale-slot";
  slotId: ID;
  anchor: { x: number; y: number };
  scaleX: number;
  scaleY: number;
  angle?: CharacterAngle;
}

export interface RotateSlotCommand {
  kind: "rotate-slot";
  slotId: ID;
  anchor: { x: number; y: number };
  degrees: number;
  angle?: CharacterAngle;
  includeSubtree?: boolean;
  rig?: CharacterRig;
}

export interface SetSlotParentCommand {
  kind: "set-slot-parent";
  childSlotId: ID;
  parentSlotId?: ID;
  angle?: CharacterAngle;
}

export interface PlaceVariantPinCommand {
  kind: "place-variant-pin";
  parentSlotId: ID;
  variantKey: string;
  childSlotId: ID;
  anchorPoint: { x: number; y: number };
}

export interface ClearVariantPinCommand {
  kind: "clear-variant-pin";
  parentSlotId: ID;
  variantKey: string;
  childSlotId: ID;
}

export interface ResetVariantPinCommand {
  kind: "reset-variant-pin";
  parentSlotId: ID;
  variantKey: string;
  childSlotId: ID;
}

export interface SetVariantPinRotationCommand {
  kind: "set-variant-pin-rotation";
  parentSlotId: ID;
  variantKey: string;
  childSlotId: ID;
  rotation: number;
}

export interface MoveBoneRestCommand {
  kind: "move-bone-rest";
  boneId: ID;
  dx: number;
  dy: number;
  angle?: CharacterAngle;
  keepArtwork?: boolean;
  activeVariants?: ReadonlyMap<ID, string> | Readonly<Record<ID, string>>;
}

export interface SetBoneRestTransformCommand {
  kind: "set-bone-rest-transform";
  boneId: ID;
  patch: Partial<{ x: number; y: number; rotation: number }>;
  angle?: CharacterAngle;
  activeVariants?: ReadonlyMap<ID, string> | Readonly<Record<ID, string>>;
}

export interface SetBoneDepthCommand {
  kind: "set-bone-depth";
  boneId: ID;
  depth: number;
}

export interface SetSlotDepthCommand {
  kind: "set-slot-depth";
  slotId: ID;
  depth: number;
}

export interface SetSlotHostCommand {
  kind: "set-slot-host";
  slotId: ID;
  hostSlotId?: ID;
  mode?: CharacterHostConstraint["mode"];
  reachPolicy?: CharacterHostConstraint["reachPolicy"];
}

export interface ClearSlotReachCommand {
  kind: "clear-slot-reach";
  slotId: ID;
}

export interface SetSlotReachCommand {
  kind: "set-slot-reach";
  slotId: ID;
  reach?: Array<{ x: number; y: number }>;
}

export interface SetSlotRotReachCommand {
  kind: "set-slot-rot-reach";
  slotId: ID;
  rotReach?: { min: number; max: number };
}

export type CharacterSceneCommand =
  | MoveSlotCommand
  | ScaleSlotCommand
  | RotateSlotCommand
  | SetSlotParentCommand
  | PlaceVariantPinCommand
  | ClearVariantPinCommand
  | ResetVariantPinCommand
  | SetVariantPinRotationCommand
  | MoveBoneRestCommand
  | SetBoneRestTransformCommand
  | SetBoneDepthCommand
  | SetSlotDepthCommand
  | SetSlotHostCommand
  | ClearSlotReachCommand
  | SetSlotReachCommand
  | SetSlotRotReachCommand;

/**
 * Pure renderer-neutral authoring command boundary. The editor can drive these
 * commands from DOM chrome, Pixi events, keyboard nudges, or AI suggestions; the
 * output is still character data that rebuilds the canonical Pixi composition.
 */
export function applyCharacterSceneCommand(
  character: CharacterPreset,
  command: CharacterSceneCommand,
): CharacterSceneCommandResult {
  switch (command.kind) {
    case "move-slot":
      return moveSlot(character, command);
    case "scale-slot":
      return scaleSlot(character, command);
    case "rotate-slot":
      return rotateSlot(character, command);
    case "set-slot-parent":
      return fromCharacterUpdate(
        character,
        setCharacterSlotParent(character, command.childSlotId, command.parentSlotId, command.angle),
      );
    case "place-variant-pin":
      return fromCharacterUpdate(
        character,
        upsertVariantPinAtPoint(character, {
          parentSlotId: command.parentSlotId,
          variantKey: command.variantKey,
          childSlotId: command.childSlotId,
          anchorPoint: command.anchorPoint,
        }),
      );
    case "clear-variant-pin":
      return fromCharacterUpdate(
        character,
        removeVariantPin(character, {
          parentSlotId: command.parentSlotId,
          variantKey: command.variantKey,
          childSlotId: command.childSlotId,
        }),
      );
    case "reset-variant-pin":
      return fromCharacterUpdate(
        character,
        resetVariantPinToArtwork(character, {
          parentSlotId: command.parentSlotId,
          variantKey: command.variantKey,
          childSlotId: command.childSlotId,
        }),
      );
    case "set-variant-pin-rotation":
      return fromCharacterUpdate(
        character,
        setVariantPinRotation(character, {
          parentSlotId: command.parentSlotId,
          variantKey: command.variantKey,
          childSlotId: command.childSlotId,
          rotation: command.rotation,
        }),
      );
    case "move-bone-rest":
      return fromCharacterUpdate(
        character,
        moveCharacterBoneRest(
          character,
          command.boneId,
          finite(command.dx),
          finite(command.dy),
          command.angle,
          {
            keepArtwork: command.keepArtwork,
            activeVariants: command.activeVariants,
          },
        ),
      );
    case "set-bone-rest-transform":
      return fromCharacterUpdate(
        character,
        setCharacterBoneRestTransform(character, command.boneId, command.patch, command.angle, {
          activeVariants: command.activeVariants,
        }),
      );
    case "set-bone-depth":
      return withRigUpdate(
        character,
        setBoneDepth(normalizeCharacterRig(character), command.boneId, finite(command.depth)),
      );
    case "set-slot-depth":
      return withRigUpdate(
        character,
        setSlotDepth(normalizeCharacterRig(character), command.slotId, finite(command.depth)),
      );
    case "set-slot-host": {
      const rig = normalizeCharacterRig(character);
      const current = rig.hostConstraints.find(
        (constraint) => constraint.slotId === command.slotId,
      );
      return withRigUpdate(
        character,
        setSlotHostConstraint(
          rig,
          command.slotId,
          command.hostSlotId,
          command.mode ?? current?.mode,
          command.reachPolicy ?? current?.reachPolicy,
        ),
      );
    }
    case "clear-slot-reach": {
      const rig = normalizeCharacterRig(character);
      return withRigUpdate(
        character,
        setSlotRotReach(setSlotReach(rig, command.slotId, undefined), command.slotId, undefined),
      );
    }
    case "set-slot-reach":
      return withRigUpdate(
        character,
        setSlotReach(normalizeCharacterRig(character), command.slotId, command.reach),
      );
    case "set-slot-rot-reach":
      return withRigUpdate(
        character,
        setSlotRotReach(normalizeCharacterRig(character), command.slotId, command.rotReach),
      );
  }
}

function moveSlot(
  character: CharacterPreset,
  command: MoveSlotCommand,
): CharacterSceneCommandResult {
  const dx = finite(command.dx);
  const dy = finite(command.dy);
  if (dx === 0 && dy === 0) return { character, changed: false };
  const rig = command.rig ?? normalizeCharacterRig(character);
  const angle = command.angle ?? rig.activeAngle;
  const parts = moveSlotParts(character, command.slotId, dx, dy, angle);
  const nextRig =
    command.updateRig === false
      ? character.rig
      : moveSlotBinding(rig, command.slotId, dx, dy, angle);
  return {
    character: {
      ...character,
      parts,
      ...(nextRig ? { rig: nextRig } : {}),
      updatedAt: Date.now(),
    },
    changed: parts !== character.parts || nextRig !== character.rig,
  };
}

function scaleSlot(
  character: CharacterPreset,
  command: ScaleSlotCommand,
): CharacterSceneCommandResult {
  const scaleX = finite(command.scaleX, 1);
  const scaleY = finite(command.scaleY, 1);
  if (scaleX === 1 && scaleY === 1) return { character, changed: false };
  const rig = normalizeCharacterRig(character);
  const angle = command.angle ?? rig.activeAngle;
  const targetIds = new Set(
    character.parts
      .filter(
        (part) => getPartSlotId(part) === command.slotId && partAvailableForAngle(part, angle),
      )
      .map((part) => part.id),
  );
  if (targetIds.size === 0) return { character, changed: false };
  return {
    character: {
      ...character,
      parts: character.parts.map((part) =>
        targetIds.has(part.id) ? scalePartAroundAnchor(part, command.anchor, scaleX, scaleY) : part,
      ),
      updatedAt: Date.now(),
    },
    changed: true,
  };
}

function rotateSlot(
  character: CharacterPreset,
  command: RotateSlotCommand,
): CharacterSceneCommandResult {
  const degrees = finite(command.degrees);
  if (degrees === 0) return { character, changed: false };
  const rig = command.rig ?? normalizeCharacterRig(character);
  const angle = command.angle ?? rig.activeAngle;
  const targetIds =
    command.includeSubtree === false
      ? new Set(
          character.parts
            .filter(
              (part) =>
                getPartSlotId(part) === command.slotId && partAvailableForAngle(part, angle),
            )
            .map((part) => part.id),
        )
      : partIdsForSlotSubtree(character.parts, rig, command.slotId, angle);
  if (targetIds.size === 0) return { character, changed: false };
  return {
    character: {
      ...character,
      parts: character.parts.map((part) =>
        targetIds.has(part.id) ? rotatePartAroundAnchor(part, command.anchor, degrees) : part,
      ),
      updatedAt: Date.now(),
    },
    changed: true,
  };
}

function scalePartAroundAnchor(
  part: CharacterPart,
  anchor: { x: number; y: number },
  scaleX: number,
  scaleY: number,
): CharacterPart {
  const pivot = pivotForPart(part);
  return {
    ...part,
    x: Math.round(anchor.x + (part.x - anchor.x) * scaleX),
    y: Math.round(anchor.y + (part.y - anchor.y) * scaleY),
    width: Math.max(4, Math.round(part.width * scaleX)),
    height: Math.max(4, Math.round(part.height * scaleY)),
    pivot: {
      x: Math.round(anchor.x + (pivot.x - anchor.x) * scaleX),
      y: Math.round(anchor.y + (pivot.y - anchor.y) * scaleY),
    },
  };
}

function rotatePartAroundAnchor(
  part: CharacterPart,
  anchor: { x: number; y: number },
  degrees: number,
): CharacterPart {
  const pivot = pivotForPart(part);
  const rotatedPivot = rotatePointAroundAnchor(pivot, anchor, degrees);
  return {
    ...part,
    x: Math.round(part.x + (rotatedPivot.x - pivot.x)),
    y: Math.round(part.y + (rotatedPivot.y - pivot.y)),
    pivot: {
      x: Math.round(rotatedPivot.x),
      y: Math.round(rotatedPivot.y),
    },
    rotation: Math.round(part.rotation + degrees),
  };
}

export function rotatePointAroundAnchor(
  point: { x: number; y: number },
  anchor: { x: number; y: number },
  degrees: number,
): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const relX = point.x - anchor.x;
  const relY = point.y - anchor.y;
  return {
    x: anchor.x + relX * cos - relY * sin,
    y: anchor.y + relX * sin + relY * cos,
  };
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function fromCharacterUpdate(
  previous: CharacterPreset,
  next: CharacterPreset,
): CharacterSceneCommandResult {
  const changed = next !== previous || next.parts !== previous.parts || next.rig !== previous.rig;
  return {
    character: changed ? { ...next, updatedAt: Date.now() } : previous,
    changed,
  };
}

function withRigUpdate(character: CharacterPreset, rig: CharacterRig): CharacterSceneCommandResult {
  const changed = rig !== character.rig;
  return {
    character: changed ? { ...character, rig, updatedAt: Date.now() } : character,
    changed,
  };
}

function partIdsForSlotSubtree(
  parts: CharacterPart[],
  rig: CharacterRig,
  slotId: ID,
  angle: CharacterAngle,
): Set<ID> {
  const binding = resolveSlotBinding(rig, slotId, angle);
  const slotIds = binding
    ? slotIdsForBoneSubtree(rig, binding.effectiveBoneId, angle)
    : new Set<ID>([slotId]);
  return new Set(
    parts
      .filter((part) => slotIds.has(getPartSlotId(part)) && partAvailableForAngle(part, angle))
      .map((part) => part.id),
  );
}
