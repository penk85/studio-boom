import { describe, expect, it } from "vitest";
import type { RecordedKeypose } from "../../types";
import { sampleKeyposesAtTime } from "../keypose-sampling";

describe("motion keypose sampling", () => {
  it("preserves exact bone and slot identity while interpolating", () => {
    const keyposes: RecordedKeypose[] = [
      {
        t: 0,
        parts: [
          {
            target: "bone",
            boneId: "bone:left-arm",
            slotId: "slot:left-arm",
            partRole: "arm",
            dx: 0,
          },
        ],
      },
      {
        t: 1,
        parts: [
          {
            target: "bone",
            boneId: "bone:left-arm",
            slotId: "slot:left-arm",
            partRole: "arm",
            dx: 20,
          },
        ],
      },
    ];

    const sampled = sampleKeyposesAtTime(keyposes, 0.5).parts.get("bone:bone:left-arm");
    expect(sampled).toMatchObject({
      target: "bone",
      boneId: "bone:left-arm",
      slotId: "slot:left-arm",
      partRole: "arm",
      dx: 10,
    });
  });
});
