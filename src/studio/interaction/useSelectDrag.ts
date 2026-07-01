// The shared Figma-style select/drag controller. Given a per-substrate adapter, it
// returns a single `onPointerDown` handler that runs the gesture state machine so all
// six interaction rules behave identically across every canvas (Stage, CharacterEditor,
// MotionPresetRecorder). The substrate-specific details — how to hit-test, how to read
// and write the selection, how to move an object, and which document to listen on —
// live entirely in the adapter. Pure logic lives in select-drag.ts.
import { useCallback, useRef } from "react";
import {
  DEFAULT_DRAG_THRESHOLD,
  type DrillPick,
  exceedsDragThreshold,
  resolveDragSubject,
  resolveDrillSelection,
} from "./select-drag";

/** The minimal pointer-event shape both React and native pointer events satisfy. */
export interface PointerEventLike {
  clientX: number;
  clientY: number;
  button: number;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  pointerId: number;
  target: EventTarget | null;
  preventDefault(): void;
  stopPropagation(): void;
}

/** A live move begun by the adapter; the controller pumps it until pointerup. */
export interface MoveSession {
  move(event: PointerEvent): void;
  end(event: PointerEvent): void;
}

export interface SelectDragAdapter {
  /** Selectable ids under the pointer, ordered top→bottom. Locked ids must be excluded. */
  hitTest(down: PointerEventLike): string[];
  getSelectedId(): string | null;
  /** Resolve a click into a selection. `additive` is true when shift/⌘/ctrl is held (toggle). */
  selectId(id: string | null, additive: boolean): void;
  /** Begin moving `id`. Return null to make this gesture select-only (no drag). */
  beginMove(id: string, down: PointerEventLike): MoveSession | null;
  /**
   * Begin a rubber-band (marquee) selection when a drag starts on empty space (no subject).
   * `additive` is true when shift/⌘/ctrl is held (union with the current selection). Return null
   * to leave empty-space drags as no-ops. Omit entirely to disable marquee for this substrate.
   */
  beginMarquee?(down: PointerEventLike, additive: boolean): MoveSession | null;
  /** Where pointermove/up are attached. Default `window`; the Stage returns the event's document. */
  eventRoot?(down: PointerEventLike): Document | Window;
  /** Capture the pointer once a drag actually starts (e.g. setPointerCapture across an iframe). */
  capturePointer?(down: PointerEventLike, pointerId: number): void;
  /** Pixels of movement before a press becomes a drag rather than a click. */
  threshold?: number;
  /** Pixels within which a repeat click counts as "the same spot" for drill-through. */
  drillRadius?: number;
  /** Alt-click handler (e.g. the motion editor's candidate popover). When present, alt-click defers to it. */
  onAltPick?(down: PointerEventLike): void;
}

/**
 * Returns a stable `onPointerDown(event)` that implements the full select/drag model.
 * Attach it as a React `onPointerDown` or a native pointerdown listener.
 */
export function useSelectDrag(adapter: SelectDragAdapter): (event: PointerEventLike) => void {
  // Keep the latest adapter without re-creating the handler on every render.
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;
  // Remembers the last click so a repeat click in the same spot drills the z-stack.
  const lastPickRef = useRef<DrillPick | null>(null);

  return useCallback((event: PointerEventLike) => {
    if (event.button !== 0) return;
    const a = adapterRef.current;
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;
    const candidates = a.hitTest(event);
    // Shift / ⌘ / Ctrl held → additive selection (toggle into the multi-selection).
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;

    // Alt-click defers to the adapter (candidate popover) — never a drag or drill.
    if (event.altKey && a.onAltPick) {
      a.onAltPick(event);
      return;
    }

    const subject = resolveDragSubject(candidates, a.getSelectedId());
    if (subject) {
      // Suppress native text selection / image-drag once there's something to act on.
      event.preventDefault();
      // Capture immediately so pointermoves still arrive even when the pointer travels
      // over an embedded iframe (the Stage player) — released automatically on pointerup.
      a.capturePointer?.(event, pointerId);
    }
    const threshold = a.threshold ?? DEFAULT_DRAG_THRESHOLD;
    const root: Document | Window = a.eventRoot?.(event) ?? window;

    let dragging = false;
    let session: MoveSession | null = null;

    const cleanup = () => {
      root.removeEventListener("pointermove", handleMove as EventListener);
      root.removeEventListener("pointerup", handleUp as EventListener);
      root.removeEventListener("pointercancel", handleUp as EventListener);
    };

    function handleMove(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      if (!dragging) {
        if (
          !exceedsDragThreshold(
            { x: startX, y: startY },
            { x: ev.clientX, y: ev.clientY },
            threshold,
          )
        ) {
          return;
        }
        dragging = true;
        // Rule 3: selecting an unselected subject happens exactly once, at drag start —
        // so selection never changes again mid-drag (rule 4). A drag is a plain (non-additive)
        // select of the subject.
        if (subject && subject !== a.getSelectedId()) a.selectId(subject, false);
        if (subject) {
          session = a.beginMove(subject, event);
        } else if (a.beginMarquee) {
          // Empty-space drag becomes a rubber-band selection. Capture the pointer now — we
          // couldn't at pointerdown because we didn't yet know this press would become a drag —
          // so moves keep arriving even as the marquee sweeps over the embedded player iframe.
          a.capturePointer?.(event, pointerId);
          session = a.beginMarquee(event, additive);
        }
      }
      session?.move(ev);
    }

    function handleUp(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      cleanup();
      if (dragging) {
        session?.end(ev);
        return;
      }
      // Additive click (shift/⌘): toggle the top element into the selection; empty space is a
      // no-op so the multi-selection survives. Never drills.
      if (additive) {
        const topId = candidates[0] ?? null;
        if (topId) a.selectId(topId, true);
        return;
      }
      // A plain click: rule 1 — select the top element, drilling to the element underneath on a
      // repeat click in the same spot; empty space clears the selection.
      const { id, nextPick } = resolveDrillSelection(
        candidates,
        lastPickRef.current,
        { x: startX, y: startY },
        a.drillRadius,
      );
      lastPickRef.current = nextPick;
      a.selectId(id, false);
    }

    root.addEventListener("pointermove", handleMove as EventListener);
    root.addEventListener("pointerup", handleUp as EventListener);
    root.addEventListener("pointercancel", handleUp as EventListener);
  }, []);
}
