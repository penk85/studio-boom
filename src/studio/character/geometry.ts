export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Canvas-compatible 2D affine matrix. */
export interface AffineMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY_MATRIX: AffineMatrix = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
};

export function multiplyMatrices(left: AffineMatrix, right: AffineMatrix): AffineMatrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

export function composeMatrices(...matrices: AffineMatrix[]): AffineMatrix {
  return matrices.reduce(multiplyMatrices, IDENTITY_MATRIX);
}

export function translationMatrix(x: number, y: number): AffineMatrix {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

export function rotationMatrix(degrees: number): AffineMatrix {
  const radians = degreesToRadians(degrees);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

export function scaleMatrix(scaleX: number, scaleY = scaleX): AffineMatrix {
  return { a: scaleX, b: 0, c: 0, d: scaleY, e: 0, f: 0 };
}

/**
 * Matches the editor's authored two-axis skew: X is derived from the pre-skew Y value and Y from
 * the pre-skew X value. Keeping this in one primitive prevents each surface choosing a different
 * CSS transform order.
 */
export function skewMatrix(skewX: number, skewY: number): AffineMatrix {
  return {
    a: 1,
    b: Math.tan(degreesToRadians(skewY)),
    c: Math.tan(degreesToRadians(skewX)),
    d: 1,
    e: 0,
    f: 0,
  };
}

export function matrixAroundPoint(
  pivot: Point,
  transform: {
    rotation?: number;
    scaleX?: number;
    scaleY?: number;
    skewX?: number;
    skewY?: number;
  },
): AffineMatrix {
  return composeMatrices(
    translationMatrix(pivot.x, pivot.y),
    rotationMatrix(transform.rotation ?? 0),
    skewMatrix(transform.skewX ?? 0, transform.skewY ?? 0),
    scaleMatrix(transform.scaleX ?? 1, transform.scaleY ?? transform.scaleX ?? 1),
    translationMatrix(-pivot.x, -pivot.y),
  );
}

export function invertMatrix(matrix: AffineMatrix): AffineMatrix {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (Math.abs(determinant) < 1e-10) return IDENTITY_MATRIX;
  return {
    a: matrix.d / determinant,
    b: -matrix.b / determinant,
    c: -matrix.c / determinant,
    d: matrix.a / determinant,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
  };
}

export function transformPoint(matrix: AffineMatrix, point: Point): Point {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

export function transformVector(matrix: AffineMatrix, vector: Point): Point {
  return {
    x: matrix.a * vector.x + matrix.c * vector.y,
    y: matrix.b * vector.x + matrix.d * vector.y,
  };
}

export function rotateVector(vector: Point, degrees: number): Point {
  return transformVector(rotationMatrix(degrees), vector);
}

export function rectCorners(rect: Rect): [Point, Point, Point, Point] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
}

export function transformRect(matrix: AffineMatrix, rect: Rect): [Point, Point, Point, Point] {
  return rectCorners(rect).map((point) => transformPoint(matrix, point)) as [
    Point,
    Point,
    Point,
    Point,
  ];
}

export function boundsForPoints(points: Point[]): Bounds {
  return {
    left: Math.min(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    right: Math.max(...points.map((point) => point.x)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
}

export function pointInTransformedRect(point: Point, matrix: AffineMatrix, rect: Rect): boolean {
  const local = transformPoint(invertMatrix(matrix), point);
  return (
    local.x >= rect.x &&
    local.x <= rect.x + rect.width &&
    local.y >= rect.y &&
    local.y <= rect.y + rect.height
  );
}

export function matrixToCss(matrix: AffineMatrix): string {
  return `matrix(${matrix.a}, ${matrix.b}, ${matrix.c}, ${matrix.d}, ${matrix.e}, ${matrix.f})`;
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
