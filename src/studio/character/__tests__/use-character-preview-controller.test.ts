import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  amplitudeViseme,
  scriptedVisemeAtTime,
  useCharacterPreviewController,
} from "../use-character-preview-controller";

describe("character preview audio helpers", () => {
  it("maps scripted visemes across the full playback duration", () => {
    const visemes = ["rest", "A", "E", "rest"] as const;

    expect(scriptedVisemeAtTime([...visemes], -10, 400)).toBe("rest");
    expect(scriptedVisemeAtTime([...visemes], 100, 400)).toBe("A");
    expect(scriptedVisemeAtTime([...visemes], 250, 400)).toBe("E");
    expect(scriptedVisemeAtTime([...visemes], 400, 400)).toBe("rest");
    expect(scriptedVisemeAtTime([], 100, 400)).toBe("rest");
  });

  it("maps frequency amplitude to the existing coarse mouth shapes", () => {
    expect(amplitudeViseme(new Uint8Array())).toBe("rest");
    expect(amplitudeViseme(new Uint8Array([5, 5]))).toBe("rest");
    expect(amplitudeViseme(new Uint8Array([15, 15]))).toBe("MBP");
    expect(amplitudeViseme(new Uint8Array([30, 30]))).toBe("O");
    expect(amplitudeViseme(new Uint8Array([45, 45]))).toBe("E");
    expect(amplitudeViseme(new Uint8Array([60, 60]))).toBe("A");
  });

  it("aborts an in-flight audio fetch when the editor unmounts", () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    let controller: ReturnType<typeof useCharacterPreviewController> | null = null;
    const captured: { signal?: AbortSignal } = {};
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>(() => {
          captured.signal = init?.signal as AbortSignal;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    function Harness() {
      controller = useCharacterPreviewController({ onError: vi.fn() });
      return null;
    }

    act(() => root.render(React.createElement(Harness)));
    act(() => {
      void controller!.playMouthClip({
        slotId: "role:mouth",
        targetPartId: "mouth-rest",
        url: "/pending-audio.wav",
      });
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(captured.signal?.aborted).toBe(false);

    act(() => root.unmount());
    expect(captured.signal?.aborted).toBe(true);

    container.remove();
    vi.unstubAllGlobals();
  });
});
