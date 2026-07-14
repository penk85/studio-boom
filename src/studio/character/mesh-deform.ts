/**
 * Shared deformation math for flexible character parts.
 *
 * The point-based `limb-path` model (ribbon geometry, two-bone bend solve,
 * per-seek apply logic) lives in `limb-runtime.ts` as a single self-contained
 * factory shared verbatim between the editor preview runtime and the generated
 * composition script; this module re-exports it so existing import sites keep
 * working. What remains here is the legacy `mode: "bend"` MeshPlane math for
 * old saved parts, plus the mesh sizing/clamp constants.
 *
 * `bendPlanePositions` is embedded verbatim into the generated character
 * composition script via Function.prototype.toString(), so it must stay fully
 * self-contained: no imports, no outer-scope references, nothing TS-specific
 * beyond type annotations. mesh-deform.test.ts locks the embedded source to
 * the module build.
 */

import { createLimbRuntime } from "./limb-runtime";

export type { LimbRibbonPositionOptions, LimbRopeEntry, PathPoint } from "./limb-runtime";

const limb = createLimbRuntime();

export const limbRibbonPositions = limb.limbRibbonPositions;
export const limbRibbonUVs = limb.limbRibbonUVs;
export const limbRibbonIndices = limb.limbRibbonIndices;
export const limbPathLockFloor = limb.limbPathLockFloor;
export const limbPathEndWeight = limb.limbPathEndWeight;
export const limbPathCurveWeight = limb.limbPathCurveWeight;
export const limbPathProjectPointT = limb.limbPathProjectPointT;
export const limbPathPointAt = limb.limbPathPointAt;
export const limbPathTangentAngle = limb.limbPathTangentAngle;
export const limbPathBendPoints = limb.limbPathBendPoints;
export const limbPathDeformedPoint = limb.limbPathDeformedPoint;

export interface BendPlaneArgs {
  /** Plane width in texture pixels (MeshPlane uses texture dimensions). */
  width: number;
  /** Plane height in texture pixels. */
  height: number;
  verticesX: number;
  verticesY: number;
  /** Limb axis the art bends along ("y" = vertical limb such as an arm). */
  axis: "x" | "y";
  /** Which end of the limb axis stays fixed at the joint. */
  anchor: "start" | "end";
  /** Joint x in plane-local texture pixels. Defaults to the cross-axis center. */
  originX?: number;
  /** Joint y in plane-local texture pixels. Defaults to the selected edge. */
  originY?: number;
  /**
   * Total bend in degrees, applied as uniform curvature from the anchored
   * joint to the free end. Positive curves the free end toward +x for
   * vertical limbs and toward +y for horizontal limbs (screen right / down).
   */
  bend: number;
  /** Optional reusable output buffer of verticesX * verticesY * 2 floats. */
  out?: Float32Array;
}

export function bendPlanePositions(args: BendPlaneArgs): Float32Array {
  const verticesX = Math.max(2, Math.floor(args.verticesX) || 2);
  const verticesY = Math.max(2, Math.floor(args.verticesY) || 2);
  const width = Number(args.width) || 0;
  const height = Number(args.height) || 0;
  const floats = verticesX * verticesY * 2;
  const out = args.out && args.out.length === floats ? args.out : new Float32Array(floats);
  const sizeX = width / (verticesX - 1);
  const sizeY = height / (verticesY - 1);
  const theta = ((Number(args.bend) || 0) * Math.PI) / 180;
  const alongY = args.axis !== "x";
  const anchorAtEnd = args.anchor === "end";
  const originX =
    args.originX === undefined
      ? alongY
        ? width / 2
        : anchorAtEnd
          ? width
          : 0
      : Number(args.originX) || 0;
  const originY =
    args.originY === undefined
      ? alongY
        ? anchorAtEnd
          ? height
          : 0
        : height / 2
      : Number(args.originY) || 0;
  const anchorAlong = alongY ? originY : originX;
  const anchorCross = alongY ? originX : originY;
  const direction = anchorAtEnd ? -1 : 1;
  const freeEnd = anchorAtEnd ? 0 : alongY ? height : width;
  const length = Math.max(0, direction * (freeEnd - anchorAlong));
  if (Math.abs(theta) < 0.0001 || length <= 0) {
    for (let i = 0; i < verticesX * verticesY; i++) {
      out[i * 2] = (i % verticesX) * sizeX;
      out[i * 2 + 1] = Math.floor(i / verticesX) * sizeY;
    }
    return out;
  }
  const radius = length / theta;
  for (let i = 0; i < verticesX * verticesY; i++) {
    const gx = (i % verticesX) * sizeX;
    const gy = Math.floor(i / verticesX) * sizeY;
    const along = alongY ? gy : gx;
    const cross = (alongY ? gx : gy) - anchorCross;
    const dist = direction * (along - anchorAlong);
    if (dist <= 0) {
      out[i * 2] = gx;
      out[i * 2 + 1] = gy;
      continue;
    }
    const a = (theta * dist) / length;
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    // The spine is the cross-axis centerline swept along a circular arc from
    // the joint; each cross-section rides the arc rotated to the local tangent.
    const spineAlong = radius * sin;
    const spineSide = radius * (1 - cos);
    if (alongY) {
      out[i * 2] = originX + spineSide + cross * cos;
      out[i * 2 + 1] = originY + direction * spineAlong - direction * cross * sin;
    } else {
      out[i * 2] = originX + direction * spineAlong - direction * cross * sin;
      out[i * 2 + 1] = originY + spineSide + cross * cos;
    }
  }
  return out;
}

/**
 * Columns across the ribbon. Texture mapping inside each quad is affine per
 * triangle, so a bent 2-column ribbon kinks the art along every quad diagonal;
 * more columns spread that warp until it reads as a smooth curve.
 */
export const DEFAULT_LIMB_CROSS_VERTICES = 8;

/**
 * Minimum spine samples used to RENDER a limb-path mesh, independent of the
 * authored `segments` (which also drives gizmo dash density). Curvature is
 * concentrated at the rounded joint, so coarse sampling scallops the
 * silhouette there.
 */
export const LIMB_PATH_RENDER_SEGMENTS = 32;

/** Default number of bend segments along the limb axis. */
export const DEFAULT_BEND_SEGMENTS = 12;

/** Vertices across the limb (3 keeps a center spine column and batches fine). */
export const BEND_CROSS_VERTICES = 3;

/** Clamp for authored/animated bend so limbs stay readable, in degrees. */
export const MAX_BEND_DEGREES = 90;

export function clampBendDegrees(value: number): number {
  const bend = Number(value) || 0;
  if (bend > MAX_BEND_DEGREES) return MAX_BEND_DEGREES;
  if (bend < -MAX_BEND_DEGREES) return -MAX_BEND_DEGREES;
  return bend;
}
