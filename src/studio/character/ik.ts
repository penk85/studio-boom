// Pure two-bone inverse-kinematics math shared by rig tests and composition baking.

export interface IkPoint {
  x: number;
  y: number;
}

export interface TwoBoneIkInput {
  root: IkPoint;
  mid: IkPoint;
  end: IkPoint;
  target: IkPoint;
  bendDirection: -1 | 1;
}

export interface TwoBoneIkResult {
  parentWorldRotation: number;
  childWorldRotation: number;
  reachableTarget: IkPoint;
  clamped: boolean;
}

const EPSILON = 0.0001;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Solve a two-segment chain without mutating rig state. Distances outside the chain's reachable
 * annulus are clamped, giving deterministic behavior for both editor previews and exports.
 */
export function solveTwoBoneIk(input: TwoBoneIkInput): TwoBoneIkResult | undefined {
  const upperLength = Math.hypot(input.mid.x - input.root.x, input.mid.y - input.root.y);
  const lowerLength = Math.max(
    EPSILON,
    Math.hypot(input.end.x - input.mid.x, input.end.y - input.mid.y),
  );
  if (upperLength <= EPSILON) return undefined;

  const dx = input.target.x - input.root.x;
  const dy = input.target.y - input.root.y;
  const requestedDistance = Math.hypot(dx, dy);
  const minDistance = Math.max(EPSILON, Math.abs(upperLength - lowerLength));
  const maxDistance = Math.max(minDistance, upperLength + lowerLength - EPSILON);
  const distance = clamp(requestedDistance, minDistance, maxDistance);
  const direction = requestedDistance > EPSILON ? Math.atan2(dy, dx) : 0;
  const reachableTarget = {
    x: input.root.x + Math.cos(direction) * distance,
    y: input.root.y + Math.sin(direction) * distance,
  };
  const parentAngle = Math.acos(
    clamp(
      (upperLength * upperLength + distance * distance - lowerLength * lowerLength) /
        (2 * upperLength * distance),
      -1,
      1,
    ),
  );
  const childAngle = Math.acos(
    clamp(
      (upperLength * upperLength + lowerLength * lowerLength - distance * distance) /
        (2 * upperLength * lowerLength),
      -1,
      1,
    ),
  );
  const parentWorldRotation = direction - input.bendDirection * parentAngle;
  const childWorldRotation = parentWorldRotation + input.bendDirection * (Math.PI - childAngle);
  return {
    parentWorldRotation,
    childWorldRotation,
    reachableTarget,
    clamped: Math.abs(distance - requestedDistance) > 0.0001,
  };
}
