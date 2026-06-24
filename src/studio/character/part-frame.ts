import type { CharacterPart } from "../types";
import {
  boundsForPoints,
  composeMatrices,
  IDENTITY_MATRIX,
  invertMatrix,
  matrixAroundPoint,
  pointInTransformedRect,
  transformPoint,
  transformRect,
  translationMatrix,
  type AffineMatrix,
  type Bounds,
  type Point,
  type Rect,
} from "./geometry";
import {
  motionDeltaToCanvasDelta,
  motionTargetPivot,
  runtimeAncestorMotionTargets,
  type RuntimeMotionTarget,
} from "./motion-targets";
import type { CharacterRuntime, RuntimePartPlacement } from "./runtime";
import type { BoneWorldTransform } from "./rig";

export interface PartFrameTransform {
  dx: number;
  dy: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
  skewY: number;
  originX: number;
  originY: number;
}

export interface RuntimePartFrame {
  matrix: AffineMatrix;
  inverseMatrix: AffineMatrix;
  pivot: Point;
  quad: [Point, Point, Point, Point];
  bounds: Bounds;
  localBounds: Rect;
}

export interface RuntimeInheritedFrameTransform {
  target: RuntimeMotionTarget;
  transform: PartFrameTransform;
}

export function resolveRuntimePartFrame({
  part,
  placement,
  runtime,
  target,
  transform,
  localBounds,
  inheritedTransforms = [],
  worldByBone = runtime.worldByBone,
}: {
  part: CharacterPart;
  placement: RuntimePartPlacement;
  runtime: CharacterRuntime;
  target: RuntimeMotionTarget;
  transform: PartFrameTransform;
  localBounds: Rect;
  inheritedTransforms?: RuntimeInheritedFrameTransform[];
  worldByBone?: ReadonlyMap<string, BoneWorldTransform>;
}): RuntimePartFrame {
  const originLocal = {
    x: transform.originX * part.width,
    y: transform.originY * part.height,
  };
  const motionCanvas = motionDeltaToCanvasDelta(
    runtime,
    target,
    {
      x: transform.dx,
      y: transform.dy,
    },
    worldByBone,
  );
  const baseMatrix = composeMatrices(
    translationMatrix(placement.x + originLocal.x, placement.y + originLocal.y),
    matrixAroundPoint(
      { x: 0, y: 0 },
      {
        rotation: placement.rotation,
        scaleX: placement.scaleX,
        scaleY: placement.scaleY,
      },
    ),
    translationMatrix(-originLocal.x, -originLocal.y),
  );

  const inheritedMatrix = composeMatrices(
    ...inheritedTransforms.map(({ target: inheritedTarget, transform: inheritedTransform }) =>
      runtimeTargetMotionMatrix(runtime, inheritedTarget, inheritedTransform, worldByBone),
    ),
  );
  let localMatrix: AffineMatrix;
  let localPivot: Point;
  if (target.kind === "bone") {
    const joint = motionTargetPivot(runtime, target, worldByBone) ?? {
      x: placement.pivotX,
      y: placement.pivotY,
    };
    localPivot = { x: joint.x + motionCanvas.x, y: joint.y + motionCanvas.y };
    localMatrix = composeMatrices(
      translationMatrix(motionCanvas.x, motionCanvas.y),
      matrixAroundPoint(joint, {
        rotation: transform.rotation,
        scaleX: transform.scaleX,
        scaleY: transform.scaleY,
        skewX: transform.skewX,
        skewY: transform.skewY,
      }),
      baseMatrix,
    );
  } else {
    localPivot = {
      x: placement.x + originLocal.x + motionCanvas.x,
      y: placement.y + originLocal.y + motionCanvas.y,
    };
    localMatrix = composeMatrices(
      translationMatrix(localPivot.x, localPivot.y),
      matrixAroundPoint(
        { x: 0, y: 0 },
        {
          rotation: placement.rotation + transform.rotation,
          scaleX: placement.scaleX * transform.scaleX,
          scaleY: placement.scaleY * transform.scaleY,
          skewX: transform.skewX,
          skewY: transform.skewY,
        },
      ),
      translationMatrix(-originLocal.x, -originLocal.y),
    );
  }
  const matrix = composeMatrices(inheritedMatrix, localMatrix);
  const pivot = transformPoint(inheritedMatrix, localPivot);
  const quad = transformRect(matrix, localBounds);
  return {
    matrix,
    inverseMatrix: invertMatrix(matrix),
    pivot,
    quad,
    bounds: boundsForPoints(quad),
    localBounds,
  };
}

export function resolveRuntimePosePartFrame({
  slotId,
  resolveTransformForSlot,
  ...frame
}: Omit<Parameters<typeof resolveRuntimePartFrame>[0], "inheritedTransforms"> & {
  slotId: string;
  resolveTransformForSlot: (slotId: string) => PartFrameTransform | undefined;
}): RuntimePartFrame {
  const inheritedTransforms = runtimeAncestorMotionTargets(frame.runtime, slotId).flatMap(
    (target) => {
      const transform = resolveTransformForSlot(target.slotId);
      return transform ? [{ target, transform }] : [];
    },
  );
  return resolveRuntimePartFrame({ ...frame, inheritedTransforms });
}

export function runtimePartFrameContains(frame: RuntimePartFrame, point: Point): boolean {
  return pointInTransformedRect(point, frame.matrix, frame.localBounds);
}

export function runtimePartFrameLocalPoint(frame: RuntimePartFrame, point: Point): Point {
  return transformPoint(frame.inverseMatrix, point);
}

function runtimeTargetMotionMatrix(
  runtime: CharacterRuntime,
  target: RuntimeMotionTarget,
  transform: PartFrameTransform,
  worldByBone: ReadonlyMap<string, BoneWorldTransform>,
): AffineMatrix {
  if (target.kind !== "bone") return IDENTITY_MATRIX;
  const joint = motionTargetPivot(runtime, target, worldByBone);
  if (!joint) return IDENTITY_MATRIX;
  const motionCanvas = motionDeltaToCanvasDelta(
    runtime,
    target,
    {
      x: transform.dx,
      y: transform.dy,
    },
    worldByBone,
  );
  return composeMatrices(
    translationMatrix(motionCanvas.x, motionCanvas.y),
    matrixAroundPoint(joint, {
      rotation: transform.rotation,
      scaleX: transform.scaleX,
      scaleY: transform.scaleY,
      skewX: transform.skewX,
      skewY: transform.skewY,
    }),
  );
}
