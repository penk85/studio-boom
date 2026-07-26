// Frame-coalesced interaction updates shared by recorder canvas controls.
import { useEffect, useRef } from "react";
import type { RecorderPartState } from "./motion-recorder-state";

export interface RafCoalescedDispatcher<T> {
  queue(value: T): void;
  flush(): void;
  cancel(): void;
}

export function createRafCoalescedDispatcher<T>(
  apply: (value: T) => void,
): RafCoalescedDispatcher<T> {
  let frame: number | null = null;
  let queued: T | undefined;

  const applyQueued = () => {
    const value = queued;
    queued = undefined;
    if (value !== undefined) apply(value);
  };

  const cancelFrame = () => {
    if (frame === null) return;
    window.cancelAnimationFrame(frame);
    frame = null;
  };

  return {
    queue(value) {
      queued = value;
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        applyQueued();
      });
    },
    flush() {
      cancelFrame();
      applyQueued();
    },
    cancel() {
      cancelFrame();
      queued = undefined;
    },
  };
}

export function useRafCoalescedCallback<T>(
  callback: (value: T) => void,
): RafCoalescedDispatcher<T> {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const dispatcherRef = useRef<RafCoalescedDispatcher<T> | null>(null);

  if (!dispatcherRef.current) {
    dispatcherRef.current = createRafCoalescedDispatcher((value) => callbackRef.current(value));
  }

  useEffect(() => () => dispatcherRef.current?.cancel(), []);
  return dispatcherRef.current;
}

export function recorderPatchEqual(
  a: Partial<RecorderPartState> | null,
  b: Partial<RecorderPartState>,
): boolean {
  if (!a) return false;
  const keys = new Set<keyof RecorderPartState>();
  for (const key of Object.keys(a) as (keyof RecorderPartState)[]) keys.add(key);
  for (const key of Object.keys(b) as (keyof RecorderPartState)[]) keys.add(key);
  for (const key of keys) {
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}
