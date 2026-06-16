import { describe, expect, it } from "vitest";
import { inferCharacterSideFromText, inferPartSide, isSidedSlotRole } from "../side-utils";

describe("character side utilities", () => {
  it("infers sides from slot ids, labels, and camelCase names", () => {
    expect(inferCharacterSideFromText("slot:rightHand Right hand")).toBe("right");
    expect(inferCharacterSideFromText("slot:arm-left Left arm")).toBe("left");
    expect(inferCharacterSideFromText("front hair")).toBe("front");
  });

  it("only applies inferred sides to roles that can use them", () => {
    expect(
      inferPartSide({
        id: "right-hand",
        name: "Right hand",
        role: "hand",
        slotId: "slot:rightHand",
      }),
    ).toBe("right");
    expect(
      inferPartSide({
        id: "right-body",
        name: "Right body",
        role: "body",
        slotId: "slot:rightBody",
      }),
    ).toBeUndefined();
    expect(isSidedSlotRole("hand")).toBe(true);
    expect(isSidedSlotRole("body")).toBe(false);
  });
});
