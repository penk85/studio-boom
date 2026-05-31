import type { MouthViseme, EyeState } from "../types";

// Darken a hex color by a factor (0..1). Used for mouth interiors / shading.
function darken(hex: string, factor: number): string {
  const m = hex.replace("#", "");
  if (m.length !== 6) return hex;
  const r = Math.round(parseInt(m.slice(0, 2), 16) * (1 - factor));
  const g = Math.round(parseInt(m.slice(2, 4), 16) * (1 - factor));
  const b = Math.round(parseInt(m.slice(4, 6), 16) * (1 - factor));
  const to = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

const TEETH = "#fdfdf6";
const TONGUE = "#ef7d8c";
// Closed/winking eyelids read as a dark lash line, independent of the iris color.
const LID = "#2a2a2a";

// SVG preset shapes for eyes with color support. All states share a 0 0 100 100
// viewBox so swapped variants stay aligned in the same slot.
export const EYE_PRESETS = [
  {
    id: "circle",
    label: "Circle",
    generateForState: (eyeState: EyeState, color: string) => {
      if (eyeState === "closed") {
        return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <path d="M 22 52 Q 50 60 78 52" stroke="${LID}" stroke-width="7" fill="none" stroke-linecap="round"/>
</svg>`;
      }
      if (eyeState === "half") {
        return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <path d="M 20 50 A 30 30 0 0 1 80 50 Z" fill="${color}"/>
  <circle cx="58" cy="46" r="7" fill="${TEETH}" opacity="0.7"/>
</svg>`;
      }
      if (eyeState === "wink") {
        return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <path d="M 20 56 Q 50 40 80 56" stroke="${LID}" stroke-width="7" fill="none" stroke-linecap="round"/>
</svg>`;
      }
      return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <circle cx="50" cy="50" r="42" fill="${color}"/>
  <circle cx="62" cy="38" r="12" fill="${TEETH}" opacity="0.65"/>
</svg>`;
    },
  },
  {
    id: "oval",
    label: "Oval",
    generateForState: (eyeState: EyeState, color: string) => {
      if (eyeState === "closed") {
        return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <path d="M 24 52 Q 50 58 76 52" stroke="${LID}" stroke-width="6" fill="none" stroke-linecap="round"/>
</svg>`;
      }
      if (eyeState === "half") {
        return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <path d="M 26 50 A 24 30 0 0 1 74 50 Z" fill="${color}"/>
  <circle cx="56" cy="46" r="6" fill="${TEETH}" opacity="0.7"/>
</svg>`;
      }
      if (eyeState === "wink") {
        return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <path d="M 24 56 Q 50 42 76 56" stroke="${LID}" stroke-width="6" fill="none" stroke-linecap="round"/>
</svg>`;
      }
      return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="50" cy="50" rx="30" ry="42" fill="${color}"/>
  <circle cx="60" cy="38" r="10" fill="${TEETH}" opacity="0.6"/>
</svg>`;
    },
  },
  {
    id: "simple-dot",
    label: "Dot",
    generateForState: (eyeState: EyeState, color: string) => {
      if (eyeState === "closed") {
        return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <line x1="28" y1="50" x2="72" y2="50" stroke="${LID}" stroke-width="6" stroke-linecap="round"/>
</svg>`;
      }
      if (eyeState === "half") {
        return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <path d="M 30 50 A 20 20 0 0 1 70 50 Z" fill="${color}"/>
</svg>`;
      }
      if (eyeState === "wink") {
        return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <path d="M 30 54 Q 50 44 70 54" stroke="${LID}" stroke-width="6" fill="none" stroke-linecap="round"/>
</svg>`;
      }
      return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <circle cx="50" cy="50" r="30" fill="${color}"/>
</svg>`;
    },
  },
] as const;

// Mouth presets. "Cartoon" produces anatomically-correct lip-sync shapes per
// viseme; the others are simpler abstract styles that still vary per viseme.
// All shapes use a shared 0 0 100 100 viewBox centred on (50,52) so the swapped
// viseme frames line up in the same mouth slot.
export const MOUTH_PRESETS = [
  {
    id: "cartoon",
    label: "Cartoon",
    generateForViseme: (viseme: MouthViseme, color: string) => {
      const dark = darken(color, 0.45);
      const wrap = (inner: string) =>
        `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
      switch (viseme) {
        // Neutral resting mouth — gently closed, slight smile.
        case "rest":
          return wrap(
            `<path d="M 30 52 Q 50 58 70 52" stroke="${color}" stroke-width="5" fill="none" stroke-linecap="round"/>`,
          );
        // "ah" — jaw fully dropped, tall open oval with upper teeth.
        case "A":
          return wrap(
            `<ellipse cx="50" cy="55" rx="21" ry="27" fill="${dark}"/>
  <path d="M 31 38 Q 50 33 69 38 L 67 45 Q 50 41 33 45 Z" fill="${TEETH}"/>
  <ellipse cx="50" cy="74" rx="11" ry="7" fill="${TONGUE}"/>`,
          );
        // "ee" — stretched wide and flat, teeth showing.
        case "E":
          return wrap(
            `<path d="M 20 50 Q 50 41 80 50 Q 50 61 20 50 Z" fill="${dark}"/>
  <path d="M 27 48 Q 50 44 73 48 L 72 52 Q 50 48 28 52 Z" fill="${TEETH}"/>`,
          );
        // "oh" — rounded medium opening.
        case "O":
          return wrap(
            `<ellipse cx="50" cy="52" rx="17" ry="20" fill="${dark}"/>
  <ellipse cx="50" cy="52" rx="17" ry="20" fill="none" stroke="${color}" stroke-width="4"/>`,
          );
        // "oo" — small tight pucker pushed forward.
        case "U":
          return wrap(
            `<circle cx="50" cy="52" r="13" fill="${dark}"/>
  <circle cx="50" cy="52" r="13" fill="none" stroke="${color}" stroke-width="5"/>`,
          );
        // "m/b/p" — lips pressed together, closed.
        case "MBP":
          return wrap(
            `<path d="M 28 50 Q 50 46 72 50 Q 50 54 28 50 Z" fill="${color}"/>
  <line x1="30" y1="50" x2="70" y2="50" stroke="${dark}" stroke-width="1.5"/>`,
          );
        // "f/v" — upper teeth resting on the lower lip.
        case "FV":
          return wrap(
            `<rect x="30" y="44" width="40" height="8" rx="2" fill="${TEETH}" stroke="${color}" stroke-width="1.5"/>
  <path d="M 30 54 Q 50 61 70 54" stroke="${color}" stroke-width="6" fill="none" stroke-linecap="round"/>`,
          );
        // "l" — open with tongue tip raised.
        case "L":
          return wrap(
            `<ellipse cx="50" cy="55" rx="16" ry="19" fill="${dark}"/>
  <path d="M 31 41 Q 50 37 69 41 L 67 47 Q 50 44 33 47 Z" fill="${TEETH}"/>
  <path d="M 50 50 L 42 64 Q 50 68 58 64 Z" fill="${TONGUE}"/>`,
          );
        // "w/q" — very tight rounded pucker.
        case "WQ":
          return wrap(
            `<ellipse cx="50" cy="52" rx="10" ry="13" fill="${dark}"/>
  <ellipse cx="50" cy="52" rx="10" ry="13" fill="none" stroke="${color}" stroke-width="5"/>`,
          );
        // Happy smile expression with teeth.
        case "Smile":
          return wrap(
            `<path d="M 19 45 Q 50 73 81 45 Q 50 55 19 45 Z" fill="${dark}"/>
  <path d="M 27 47 Q 50 54 73 47 L 71 51 Q 50 50 29 51 Z" fill="${TEETH}"/>`,
          );
        default:
          return wrap(
            `<path d="M 30 52 Q 50 58 70 52" stroke="${color}" stroke-width="5" fill="none" stroke-linecap="round"/>`,
          );
      }
    },
  },
  {
    id: "line",
    label: "Line",
    generateForViseme: (viseme: MouthViseme, color: string) => {
      // Open vowels bow the line; closed consonants stay flat.
      const open: Partial<Record<MouthViseme, number>> = { A: 14, O: 9, E: 6, L: 8 };
      const drop = open[viseme] ?? 0;
      if (drop > 0) {
        return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <path d="M 24 50 Q 50 ${50 + drop} 76 50 Q 50 ${50 - drop / 2} 24 50 Z" fill="${color}"/>
</svg>`;
      }
      return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <line x1="26" y1="50" x2="74" y2="50" stroke="${color}" stroke-width="6" stroke-linecap="round"/>
</svg>`;
    },
  },
  {
    id: "oval-mouth",
    label: "Oval",
    generateForViseme: (viseme: MouthViseme, color: string) => {
      const heights: Record<MouthViseme, number> = {
        rest: 4,
        A: 28,
        E: 11,
        O: 22,
        U: 15,
        MBP: 4,
        FV: 14,
        L: 24,
        WQ: 14,
        Smile: 10,
      };
      const widths: Record<MouthViseme, number> = {
        rest: 26,
        A: 22,
        E: 34,
        O: 19,
        U: 12,
        MBP: 28,
        FV: 22,
        L: 17,
        WQ: 11,
        Smile: 32,
      };
      const ry = heights[viseme] ?? 8;
      const rx = widths[viseme] ?? 24;
      return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="50" cy="52" rx="${rx}" ry="${ry}" fill="${color}"/>
</svg>`;
    },
  },
  {
    id: "circle-mouth",
    label: "Circle",
    generateForViseme: (viseme: MouthViseme, color: string) => {
      const sizes: Record<MouthViseme, number> = {
        rest: 8,
        A: 28,
        E: 18,
        O: 22,
        U: 12,
        MBP: 7,
        FV: 14,
        L: 20,
        WQ: 11,
        Smile: 18,
      };
      const r = sizes[viseme] ?? 18;
      return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <circle cx="50" cy="52" r="${r}" fill="${color}"/>
</svg>`;
    },
  },
] as const;

export async function generatePresetBlob(svgString: string, filename: string): Promise<File> {
  const blob = new Blob([svgString], { type: "image/svg+xml" });
  return new File([blob], filename, { type: "image/svg+xml" });
}
