import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRafCoalescedDispatcher, recorderPatchEqual } from "../motion-recorder-interactions";

describe("motion recorder interaction helpers", () => {
  let nextFrameId: number;
  let frames: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    nextFrameId = 1;
    frames = new Map();
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        const id = nextFrameId++;
        frames.set(id, callback);
        return id;
      }),
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((id: number) => {
        frames.delete(id);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("coalesces queued drag updates to the latest value in one frame", () => {
    const applied: number[] = [];
    const dispatcher = createRafCoalescedDispatcher<number>((value) => applied.push(value));

    dispatcher.queue(1);
    dispatcher.queue(2);

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    frames.get(1)?.(16);
    expect(applied).toEqual([2]);
  });

  it("flushes the latest update immediately and cancels the pending frame", () => {
    const applied: number[] = [];
    const dispatcher = createRafCoalescedDispatcher<number>((value) => applied.push(value));

    dispatcher.queue(3);
    dispatcher.flush();

    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(applied).toEqual([3]);
    expect(frames.size).toBe(0);
  });

  it("cancels a pending update without applying it", () => {
    const apply = vi.fn();
    const dispatcher = createRafCoalescedDispatcher<number>(apply);

    dispatcher.queue(4);
    dispatcher.cancel();

    expect(apply).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it("compares only the recorder patch keys that are present", () => {
    expect(recorderPatchEqual({ dx: 2 }, { dx: 2 })).toBe(true);
    expect(recorderPatchEqual({ dx: 2 }, { dx: 3 })).toBe(false);
    expect(recorderPatchEqual({ dx: 2 }, { dx: 2, dy: 1 })).toBe(false);
    expect(recorderPatchEqual(null, { dx: 2 })).toBe(false);
  });
});
