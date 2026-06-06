import { describe, expect, it } from "vitest";
import {
  type DrillPick,
  exceedsDragThreshold,
  resolveDragSubject,
  resolveDrillSelection,
} from "../select-drag";

describe("resolveDragSubject", () => {
  it("prefers the selected id when it is under the pointer, even if covered", () => {
    // Rule 2: drag the selected element from anywhere, even when something overlaps it.
    expect(resolveDragSubject(["top", "selected", "bottom"], "selected")).toBe("selected");
  });

  it("falls back to the topmost candidate when the selection is not under the pointer", () => {
    // Rule 3: pressing an unselected stack targets the topmost element.
    expect(resolveDragSubject(["top", "bottom"], "elsewhere")).toBe("top");
    expect(resolveDragSubject(["top", "bottom"], null)).toBe("top");
  });

  it("returns null when nothing is under the pointer", () => {
    expect(resolveDragSubject([], "selected")).toBeNull();
  });
});

describe("resolveDrillSelection", () => {
  const point = { x: 100, y: 100 };

  it("selects the topmost candidate on a fresh click", () => {
    // Rule 1, first click: select the top element.
    const { id, nextPick } = resolveDrillSelection(["a", "b", "c"], null, point);
    expect(id).toBe("a");
    expect(nextPick).toEqual({ x: 100, y: 100, key: "a|b|c", index: 0 });
  });

  it("drills to the element underneath on a repeat click in the same spot", () => {
    let pick: DrillPick | null = null;
    const stack = ["a", "b", "c"];
    const first = resolveDrillSelection(stack, pick, point);
    pick = first.nextPick;
    expect(first.id).toBe("a");

    const second = resolveDrillSelection(stack, pick, point);
    pick = second.nextPick;
    expect(second.id).toBe("b");

    const third = resolveDrillSelection(stack, pick, point);
    pick = third.nextPick;
    expect(third.id).toBe("c");

    // Wraps back around to the top.
    const fourth = resolveDrillSelection(stack, pick, point);
    expect(fourth.id).toBe("a");
  });

  it("restarts from the top when the click moves to a new spot", () => {
    const first = resolveDrillSelection(["a", "b"], null, point);
    const moved = resolveDrillSelection(["a", "b"], first.nextPick, { x: 400, y: 400 });
    expect(moved.id).toBe("a");
  });

  it("restarts from the top when the stack under the pointer changes", () => {
    const first = resolveDrillSelection(["a", "b"], null, point);
    const changed = resolveDrillSelection(["x", "y"], first.nextPick, point);
    expect(changed.id).toBe("x");
  });

  it("returns null for empty space (deselect)", () => {
    const { id, nextPick } = resolveDrillSelection([], null, point);
    expect(id).toBeNull();
    expect(nextPick).toBeNull();
  });
});

describe("exceedsDragThreshold", () => {
  it("is false within the threshold and true once past it", () => {
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false);
    expect(exceedsDragThreshold({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(true);
  });
});
