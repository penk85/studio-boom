import { describe, expect, it, vi } from "vitest";
import { startWindowPointerDrag } from "../pointer-drag";

describe("window pointer drag lifecycle", () => {
  it("routes movement and ends once on pointer release", () => {
    const onMove = vi.fn();
    const onEnd = vi.fn();
    const move = new Event("pointermove") as PointerEvent;
    const end = new Event("pointerup") as PointerEvent;

    startWindowPointerDrag({ onMove, onEnd });
    window.dispatchEvent(move);
    window.dispatchEvent(end);
    window.dispatchEvent(move);
    window.dispatchEvent(end);

    expect(onMove).toHaveBeenCalledOnce();
    expect(onMove).toHaveBeenCalledWith(move);
    expect(onEnd).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledWith(end);
  });

  it("cancels without committing on pointer cancellation", () => {
    const onMove = vi.fn();
    const onEnd = vi.fn();
    const onCancel = vi.fn();

    startWindowPointerDrag({ onMove, onEnd, onCancel });
    window.dispatchEvent(new Event("pointercancel"));
    window.dispatchEvent(new Event("pointermove"));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onEnd).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });

  it("ends with no pointer event when the window loses focus", () => {
    const onMove = vi.fn();
    const onEnd = vi.fn();

    startWindowPointerDrag({ onMove, onEnd });
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("pointermove"));

    expect(onEnd).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledWith(null);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("returns an idempotent cleanup function", () => {
    const onMove = vi.fn();
    const cleanup = startWindowPointerDrag({ onMove });

    cleanup();
    cleanup();
    window.dispatchEvent(new Event("pointermove"));

    expect(onMove).not.toHaveBeenCalled();
  });
});
