import type { MouthViseme } from "../types";

export interface MouthMorphProfile {
  width: number;
  openness: number;
  pucker: number;
  cornerLift: number;
  cornerPull: number;
  upperLift: number;
  lowerDrop: number;
  bite: number;
  asymmetry?: number;
}

export const MOUTH_MORPH_PRESETS: Record<MouthViseme, MouthMorphProfile> = {
  rest: {
    width: 0,
    openness: 0,
    pucker: 0,
    cornerLift: 0,
    cornerPull: 0,
    upperLift: 0,
    lowerDrop: 0,
    bite: 0,
  },
  A: {
    width: -0.06,
    openness: 0.42,
    pucker: -0.04,
    cornerLift: -0.02,
    cornerPull: -0.04,
    upperLift: 0.08,
    lowerDrop: 0.28,
    bite: 0,
  },
  E: {
    width: 0.24,
    openness: 0.08,
    pucker: -0.18,
    cornerLift: 0.06,
    cornerPull: 0.12,
    upperLift: 0.02,
    lowerDrop: 0.03,
    bite: 0.02,
  },
  O: {
    width: -0.14,
    openness: 0.22,
    pucker: 0.24,
    cornerLift: -0.01,
    cornerPull: -0.08,
    upperLift: 0.04,
    lowerDrop: 0.12,
    bite: 0,
  },
  U: {
    width: -0.22,
    openness: 0.12,
    pucker: 0.36,
    cornerLift: 0,
    cornerPull: -0.12,
    upperLift: 0.02,
    lowerDrop: 0.04,
    bite: 0,
  },
  MBP: {
    width: 0.05,
    openness: -0.18,
    pucker: -0.04,
    cornerLift: 0.01,
    cornerPull: 0.02,
    upperLift: -0.02,
    lowerDrop: -0.08,
    bite: 0,
  },
  FV: {
    width: 0.1,
    openness: 0.03,
    pucker: -0.08,
    cornerLift: 0.01,
    cornerPull: 0.04,
    upperLift: -0.06,
    lowerDrop: 0.1,
    bite: 0.1,
  },
  L: {
    width: -0.04,
    openness: 0.18,
    pucker: -0.02,
    cornerLift: 0.02,
    cornerPull: -0.02,
    upperLift: 0.02,
    lowerDrop: 0.18,
    bite: 0,
    asymmetry: 0.08,
  },
  WQ: {
    width: -0.26,
    openness: 0.06,
    pucker: 0.44,
    cornerLift: 0,
    cornerPull: -0.16,
    upperLift: 0.01,
    lowerDrop: 0.03,
    bite: 0,
  },
  Smile: {
    width: 0.28,
    openness: 0.02,
    pucker: -0.12,
    cornerLift: 0.16,
    cornerPull: 0.18,
    upperLift: -0.02,
    lowerDrop: -0.02,
    bite: 0,
  },
};

export type PathCommand = { cmd: string; values: number[] };

const PATH_PARAM_COUNT: Record<string, number> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

function tokenizeSvgPath(path: string) {
  return path.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g) ?? [];
}

export function parseSvgPath(path: string): PathCommand[] {
  const tokens = tokenizeSvgPath(path);
  const commands: PathCommand[] = [];
  let i = 0;
  let currentCmd = "";
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) {
      currentCmd = tokens[i];
      i += 1;
    }
    if (!currentCmd) break;
    const upper = currentCmd.toUpperCase();
    const paramCount = PATH_PARAM_COUNT[upper];
    if (paramCount === 0) {
      commands.push({ cmd: upper, values: [] });
      currentCmd = "";
      continue;
    }
    if (i + paramCount > tokens.length) break;
    const values = tokens.slice(i, i + paramCount).map(Number);
    commands.push({ cmd: currentCmd, values });
    i += paramCount;
    if (upper === "M") currentCmd = currentCmd === "M" ? "L" : "l";
  }
  return commands;
}

export function parseViewBox(viewBox: string) {
  const [x = 0, y = 0, width = 100, height = 60] = viewBox.trim().split(/\s+/).map(Number);
  return { x, y, width, height };
}

export function resolvePoint(
  x: number,
  y: number,
  relative: boolean,
  state: { x: number; y: number },
  xOnly = false,
  yOnly = false,
) {
  return {
    x: xOnly ? (relative ? state.x + x : x) : relative ? state.x + x : x,
    y: yOnly ? (relative ? state.y + y : y) : relative ? state.y + y : y,
  };
}

export function morphPoint(
  x: number,
  y: number,
  box: ReturnType<typeof parseViewBox>,
  preset: MouthMorphProfile,
) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const halfW = Math.max(1, box.width / 2);
  const halfH = Math.max(1, box.height / 2);
  const nx = clamp((x - cx) / halfW, -1.2, 1.2);
  const ny = clamp((y - cy) / halfH, -1.2, 1.2);
  const absX = Math.abs(nx);
  const cornerWeight = smoothstep(0.42, 0.98, absX);
  const centerWeight = 1 - smoothstep(0.08, 0.78, absX);
  const upperWeight = smoothstep(-0.95, -0.05, -ny);
  const lowerWeight = smoothstep(-0.95, -0.05, ny);
  const lipLineWeight = 1 - Math.min(1, Math.abs(ny));
  const signX = nx === 0 ? 0 : Math.sign(nx);
  const asymmetry = preset.asymmetry ?? 0;

  const horizontal =
    nx * preset.width * centerWeight * 0.65 +
    signX * preset.cornerPull * cornerWeight +
    nx * preset.pucker * (0.55 + centerWeight * 0.35);
  const vertical =
    -preset.cornerLift * cornerWeight +
    -preset.upperLift * upperWeight +
    preset.lowerDrop * lowerWeight +
    preset.openness * (lowerWeight - upperWeight) * (0.55 + centerWeight * 0.45) -
    preset.bite * upperWeight * centerWeight * 0.8 +
    preset.bite * lowerWeight * lipLineWeight * 0.15 +
    asymmetry * nx * centerWeight * 0.35;

  return {
    x: x + horizontal * halfW,
    y: y + vertical * halfH,
  };
}

export function absolutizeAndMorphPath(
  path: string,
  box: ReturnType<typeof parseViewBox>,
  preset: MouthMorphProfile,
) {
  const commands = parseSvgPath(path);
  const out: string[] = [];
  const state = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    subpathX: box.x + box.width / 2,
    subpathY: box.y + box.height / 2,
  };

  for (const command of commands) {
    const upper = command.cmd.toUpperCase();
    const relative = command.cmd !== upper;
    switch (upper) {
      case "M":
      case "L":
      case "T": {
        const point = resolvePoint(command.values[0], command.values[1], relative, state);
        const morphed = morphPoint(point.x, point.y, box, preset);
        out.push(`${upper} ${fmt(morphed.x)} ${fmt(morphed.y)}`);
        state.x = point.x;
        state.y = point.y;
        if (upper === "M") {
          state.subpathX = point.x;
          state.subpathY = point.y;
        }
        break;
      }
      case "H": {
        const point = resolvePoint(command.values[0], 0, relative, state, true, false);
        const morphed = morphPoint(point.x, state.y, box, preset);
        out.push(`L ${fmt(morphed.x)} ${fmt(morphed.y)}`);
        state.x = point.x;
        break;
      }
      case "V": {
        const point = resolvePoint(0, command.values[0], relative, state, false, true);
        const morphed = morphPoint(state.x, point.y, box, preset);
        out.push(`L ${fmt(morphed.x)} ${fmt(morphed.y)}`);
        state.y = point.y;
        break;
      }
      case "C": {
        const p1 = resolvePoint(command.values[0], command.values[1], relative, state);
        const p2 = resolvePoint(command.values[2], command.values[3], relative, state);
        const p = resolvePoint(command.values[4], command.values[5], relative, state);
        const m1 = morphPoint(p1.x, p1.y, box, preset);
        const m2 = morphPoint(p2.x, p2.y, box, preset);
        const mp = morphPoint(p.x, p.y, box, preset);
        out.push(`C ${fmt(m1.x)} ${fmt(m1.y)} ${fmt(m2.x)} ${fmt(m2.y)} ${fmt(mp.x)} ${fmt(mp.y)}`);
        state.x = p.x;
        state.y = p.y;
        break;
      }
      case "S":
      case "Q": {
        const p1 = resolvePoint(command.values[0], command.values[1], relative, state);
        const p = resolvePoint(command.values[2], command.values[3], relative, state);
        const m1 = morphPoint(p1.x, p1.y, box, preset);
        const mp = morphPoint(p.x, p.y, box, preset);
        out.push(`${upper} ${fmt(m1.x)} ${fmt(m1.y)} ${fmt(mp.x)} ${fmt(mp.y)}`);
        state.x = p.x;
        state.y = p.y;
        break;
      }
      case "A": {
        const rx = command.values[0];
        const ry = command.values[1];
        const rotation = command.values[2];
        const largeArcFlag = command.values[3];
        const sweepFlag = command.values[4];
        const p = resolvePoint(command.values[5], command.values[6], relative, state);
        const mp = morphPoint(p.x, p.y, box, preset);
        const centerScale = 1 + preset.pucker * 0.35 - preset.width * 0.15;
        const openScale = 1 + preset.openness * 0.4;
        out.push(
          `A ${fmt(Math.max(0.01, rx * centerScale))} ${fmt(Math.max(0.01, ry * openScale))} ${fmt(rotation)} ${largeArcFlag} ${sweepFlag} ${fmt(mp.x)} ${fmt(mp.y)}`,
        );
        state.x = p.x;
        state.y = p.y;
        break;
      }
      case "Z":
        out.push("Z");
        state.x = state.subpathX;
        state.y = state.subpathY;
        break;
    }
  }

  return out.join(" ");
}

export function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function fmt(value: number) {
  return Number(value.toFixed(3)).toString();
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
