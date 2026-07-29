import { vi } from "vitest";

// Mock GSAP: timeline-builder uses it at module level.
// The mock records all calls so tests can inspect what was emitted.
vi.mock("gsap", () => {
  const makeTimeline = () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const tl = {
      _calls: calls,
      to: vi.fn((...args: unknown[]) => {
        calls.push({ method: "to", args });
        return tl;
      }),
      set: vi.fn((...args: unknown[]) => {
        calls.push({ method: "set", args });
        return tl;
      }),
      fromTo: vi.fn((...args: unknown[]) => {
        calls.push({ method: "fromTo", args });
        return tl;
      }),
      seek: vi.fn(() => tl),
      kill: vi.fn(() => tl),
      duration: vi.fn(() => 0),
    };
    return tl;
  };
  return {
    default: {
      timeline: vi.fn(makeTimeline),
      set: vi.fn(),
      to: vi.fn(),
      registerPlugin: vi.fn(),
    },
  };
});
