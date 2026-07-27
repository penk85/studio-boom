// Shared formatting and precision helpers for expanded timeline tracks.
export function roundTimelineValue(value: number, digits: number): number {
  const scale = Math.pow(10, digits);
  return Math.round(value * scale) / scale;
}

export function formatTimelineSeconds(value: number): string {
  return `${roundTimelineValue(value, 1).toFixed(1)}s`;
}
