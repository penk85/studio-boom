import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const timelinePath = join(process.cwd(), "src/studio/components/Timeline.tsx");

describe("Timeline selection integration", () => {
  it("keeps timeline clips explicitly selectable apart from drag movement", () => {
    const source = readFileSync(timelinePath, "utf8");

    expect(source).toContain("const CLIP_DRAG_THRESHOLD_PX = 4;");
    expect(source).toContain("data-timeline-clip-id={clip.id}");
    expect(source).toContain("Math.hypot(dx, dy) < CLIP_DRAG_THRESHOLD_PX");
    expect(source).toContain("onClick={(e) => {");
    expect(source).toContain("onSelect();");
  });
});
