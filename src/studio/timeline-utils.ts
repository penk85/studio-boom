// Helper: which clips are active at a given time on the project timeline.
import type { AnyClip } from "./types";

export function clipActiveAt(clip: AnyClip, t: number): boolean {
  return t >= clip.start && t < clip.start + clip.duration;
}

export function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s - Math.floor(s)) * 100);
  return `${m.toString().padStart(2, "0")}:${sec
    .toString()
    .padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}
