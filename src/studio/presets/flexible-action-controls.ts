// Human-facing Action Editor controls over renderer-neutral limb-path offsets.

import type { CharacterPartLimbPathDeform } from "../types";

export interface FlexiblePathOffsets {
  pathEndX: number;
  pathEndY: number;
  pathCurveX: number;
  pathCurveY: number;
}

export interface FlexibleActionControlState {
  bend: number;
  reach: number;
  bendLimit: number;
  reachLimit: number;
  bendModified: boolean;
  reachModified: boolean;
}

interface PathBasis {
  ux: number;
  uy: number;
  nx: number;
  ny: number;
  length: number;
}

/** Project raw path offsets into the Action Editor's Bend and Reach controls. */
export function flexibleActionControlState(
  path: CharacterPartLimbPathDeform,
  offsets: FlexiblePathOffsets,
  bendSide?: number,
): FlexibleActionControlState {
  const basis = pathBasis(path);
  const side = bendSide && bendSide < 0 ? -1 : 1;
  const bendCross = offsets.pathCurveX * basis.nx + offsets.pathCurveY * basis.ny;
  const reach = offsets.pathEndX * basis.ux + offsets.pathEndY * basis.uy;
  return {
    bend: round(Math.abs(bendCross * side), 1),
    reach: round(reach, 1),
    bendLimit: round(
      Math.max(12, Math.min(basis.length * 0.72, Math.max(basis.length * 0.38, path.width ?? 0))),
      1,
    ),
    reachLimit: round(Math.max(12, basis.length), 1),
    bendModified: offsets.pathCurveX !== 0 || offsets.pathCurveY !== 0,
    reachModified: offsets.pathEndX !== 0 || offsets.pathEndY !== 0,
  };
}

/** Set bend depth while preserving any along-path curve adjustment made on canvas. */
export function flexibleBendPatch(
  path: CharacterPartLimbPathDeform,
  offsets: FlexiblePathOffsets,
  bend: number,
  bendSide?: number,
): Pick<FlexiblePathOffsets, "pathCurveX" | "pathCurveY"> {
  const basis = pathBasis(path);
  const side = bendSide && bendSide < 0 ? -1 : 1;
  const along = offsets.pathCurveX * basis.ux + offsets.pathCurveY * basis.uy;
  const cross = Math.max(0, Number(bend) || 0) * side;
  return {
    pathCurveX: round(basis.ux * along + basis.nx * cross, 1),
    pathCurveY: round(basis.uy * along + basis.ny * cross, 1),
  };
}

/** Set reach while preserving any sideways endpoint adjustment made on canvas. */
export function flexibleReachPatch(
  path: CharacterPartLimbPathDeform,
  offsets: FlexiblePathOffsets,
  reach: number,
): Pick<FlexiblePathOffsets, "pathEndX" | "pathEndY"> {
  const basis = pathBasis(path);
  const cross = offsets.pathEndX * basis.nx + offsets.pathEndY * basis.ny;
  const along = Number(reach) || 0;
  return {
    pathEndX: round(basis.ux * along + basis.nx * cross, 1),
    pathEndY: round(basis.uy * along + basis.ny * cross, 1),
  };
}

function pathBasis(path: CharacterPartLimbPathDeform): PathBasis {
  const dx = path.end.x - path.start.x;
  const dy = path.end.y - path.start.y;
  const length = Math.max(0.0001, Math.hypot(dx, dy));
  const ux = dx / length;
  const uy = dy / length;
  return { ux, uy, nx: -uy, ny: ux, length };
}

function round(value: number, places: number) {
  const p = 10 ** places;
  return Math.round(value * p) / p;
}
