import { describe, expect, it } from "vitest";
import { formatTimelineSeconds, roundTimelineValue } from "../timeline-display";

describe("timeline display helpers", () => {
  it("rounds draggable timeline values without floating-point tails", () => {
    expect(roundTimelineValue(1.234, 2)).toBe(1.23);
    expect(roundTimelineValue(1.235, 2)).toBe(1.24);
  });

  it("formats compact second labels consistently", () => {
    expect(formatTimelineSeconds(1.24)).toBe("1.2s");
    expect(formatTimelineSeconds(1.25)).toBe("1.3s");
  });
});
