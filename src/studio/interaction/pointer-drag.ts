export interface PointerDragHandlers {
  onMove: (event: PointerEvent) => void;
  onEnd?: (event: PointerEvent | null) => void;
  onCancel?: () => void;
}

/**
 * Shared pointer lifecycle for editor chrome. Geometry and state ownership stay with each tool;
 * this helper only guarantees that move/end/cancel listeners are installed and removed together.
 */
export function startWindowPointerDrag({
  onMove,
  onEnd,
  onCancel,
}: PointerDragHandlers): () => void {
  let active = true;
  const cleanup = () => {
    if (!active) return;
    active = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("blur", blur);
  };
  const end = (event: PointerEvent) => {
    cleanup();
    onEnd?.(event);
  };
  const cancel = () => {
    cleanup();
    onCancel?.();
  };
  const blur = () => {
    cleanup();
    onEnd?.(null);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("blur", blur);
  return cleanup;
}
