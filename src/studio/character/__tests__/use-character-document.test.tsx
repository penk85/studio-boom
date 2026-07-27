import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createBlankCharacter } from "../character-utils";
import { useCharacterDocument, type CharacterDocumentController } from "../use-character-document";

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let controller: CharacterDocumentController | null = null;
const onRestore = vi.fn();
const onStatus = vi.fn();

beforeAll(() => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.useFakeTimers();
  controller = null;
  onRestore.mockReset();
  onStatus.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<Harness />);
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  controller = null;
  vi.clearAllTimers();
  vi.useRealTimers();
});

function Harness() {
  controller = useCharacterDocument({ onRestore, onStatus });
  return null;
}

describe("character document controller", () => {
  it("restores undo and redo snapshots with selection/status callbacks", () => {
    const first = { ...createBlankCharacter(), id: "character-a", name: "First" };
    const second = { ...first, name: "Second", updatedAt: first.updatedAt + 1 };

    act(() => controller!.setDoc(first));
    act(() => {
      controller!.pushUndoSnapshot();
      controller!.setDoc(second);
    });
    expect(controller?.doc?.name).toBe("Second");
    expect(controller?.canUndo).toBe(true);

    act(() => controller!.undoCharacterHistory());
    expect(controller?.doc?.name).toBe("First");
    expect(controller?.canRedo).toBe(true);
    expect(onRestore).toHaveBeenLastCalledWith(first);
    expect(onStatus).toHaveBeenLastCalledWith("Undone");

    act(() => controller!.redoCharacterHistory());
    expect(controller?.doc?.name).toBe("Second");
    expect(onRestore).toHaveBeenLastCalledWith(second);
    expect(onStatus).toHaveBeenLastCalledWith("Redone");
  });

  it("clears both history directions when a different character loads", () => {
    const first = { ...createBlankCharacter(), id: "character-a", name: "First" };
    const second = { ...first, name: "Second", updatedAt: first.updatedAt + 1 };

    act(() => controller!.setDoc(first));
    act(() => {
      controller!.pushUndoSnapshot();
      controller!.setDoc(second);
    });
    act(() => controller!.undoCharacterHistory());
    expect(controller?.canRedo).toBe(true);

    act(() => controller!.resetHistory());
    expect(controller?.canUndo).toBe(false);
    expect(controller?.canRedo).toBe(false);
  });
});
