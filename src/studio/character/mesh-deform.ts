/**
 * Shared deformation math for flexible character parts.
 *
 * New Flexible authoring uses the point-based `limb-path` model, rendered as a
 * MeshSimple textured ribbon via `limbRibbon*` below. `bendPlanePositions`
 * remains for old saved `mode: "bend"` parts (Pixi MeshPlane). Both sets of
 * functions are embedded verbatim into the generated character composition
 * script via Function.prototype.toString(), so they must stay fully
 * self-contained: no imports, no outer-scope references, nothing TS-specific
 * beyond type annotations. mesh-deform.test.ts locks the embedded source to
 * the module build.
 */

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
 * Textured-ribbon geometry for `limb-path` flexible parts. A MeshRope pancakes
 * limb art (it crams the texture's whole cross axis into the rope thickness),
 * so instead we build a MeshSimple ribbon: a strip of `crossVertices` columns
 * running ALONG the spine, with the full visible texture mapped across it. The
 * positions functions are embedded verbatim into the generated composition
 * script via Function.prototype.toString(), so they must stay self-contained
 * (no imports, no outer-scope references).
 */

/** Columns across the ribbon; 2 is enough for a flat cross-section. */
export const DEFAULT_LIMB_CROSS_VERTICES = 2;

/** Ribbon vertex positions (part-local px) for a spine sampled into points. */
export function limbRibbonPositions(
  points: Array<{ x: number; y: number }>,
  width: number,
  crossVertices: number,
  out?: Float32Array,
): Float32Array {
  const rows = points.length;
  const cross = Math.max(2, Math.floor(crossVertices) || 2);
  const floats = rows * cross * 2;
  const result = out && out.length === floats ? out : new Float32Array(floats);
  const half = (Number(width) || 0) / 2;
  for (let i = 0; i < rows; i += 1) {
    const prev = points[i > 0 ? i - 1 : 0];
    const next = points[i < rows - 1 ? i + 1 : rows - 1];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    // Left-hand normal to the tangent gives the cross direction.
    const nx = -ty;
    const ny = tx;
    const p = points[i];
    for (let j = 0; j < cross; j += 1) {
      const s = cross === 1 ? 0.5 : j / (cross - 1);
      const off = (s - 0.5) * half * 2;
      const idx = (i * cross + j) * 2;
      result[idx] = p.x + nx * off;
      result[idx + 1] = p.y + ny * off;
    }
  }
  return result;
}

/**
 * Static UVs mapping the visible texture sub-rect across the ribbon: the long
 * axis runs along the spine, the short axis across the columns. `vertical`
 * means the limb's long axis is the texture's v (height).
 *
 * The cross-axis mapping must agree with the LEFT-hand normal used in
 * `limbRibbonPositions`. For a vertical limb the cross axis is x, and the left
 * normal puts column `s = 0` on the +x (screen-right) side, so `u` has to run
 * high→low across `s` (`1 - s`) to keep the texture un-mirrored — u0 lands on
 * the left column, u1 on the right. For a horizontal limb the cross axis is y
 * and column `s = 0` already lands on -y (screen-top), so `v` maps straight.
 */
export function limbRibbonUVs(
  rows: number,
  crossVertices: number,
  uv: { u0: number; v0: number; u1: number; v1: number },
  vertical: boolean,
  out?: Float32Array,
): Float32Array {
  const cross = Math.max(2, Math.floor(crossVertices) || 2);
  const rowCount = Math.max(2, Math.floor(rows) || 2);
  const floats = rowCount * cross * 2;
  const result = out && out.length === floats ? out : new Float32Array(floats);
  for (let i = 0; i < rowCount; i += 1) {
    const t = rowCount === 1 ? 0 : i / (rowCount - 1);
    for (let j = 0; j < cross; j += 1) {
      const s = cross === 1 ? 0 : j / (cross - 1);
      const idx = (i * cross + j) * 2;
      if (vertical) {
        result[idx] = uv.u0 + (uv.u1 - uv.u0) * (1 - s);
        result[idx + 1] = uv.v0 + (uv.v1 - uv.v0) * t;
      } else {
        result[idx] = uv.u0 + (uv.u1 - uv.u0) * t;
        result[idx + 1] = uv.v0 + (uv.v1 - uv.v0) * s;
      }
    }
  }
  return result;
}

/** Static triangle indices for the ribbon grid. */
export function limbRibbonIndices(rows: number, crossVertices: number): Uint32Array {
  const cross = Math.max(2, Math.floor(crossVertices) || 2);
  const rowCount = Math.max(2, Math.floor(rows) || 2);
  const out = new Uint32Array((rowCount - 1) * (cross - 1) * 6);
  let k = 0;
  for (let i = 0; i < rowCount - 1; i += 1) {
    for (let j = 0; j < cross - 1; j += 1) {
      const a = i * cross + j;
      const b = a + 1;
      const c = a + cross;
      const d = c + 1;
      out[k++] = a;
      out[k++] = b;
      out[k++] = c;
      out[k++] = b;
      out[k++] = d;
      out[k++] = c;
    }
  }
  return out;
}

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
