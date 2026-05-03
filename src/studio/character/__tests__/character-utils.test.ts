import { describe, it, expect } from "vitest";
import {
  listCharacterSlots,
  pickActivePart,
  pickActivePartForSlot,
  roleEnabledByManifest,
  normalizePartRole,
  getPartSlotId,
  defaultSlotIdForRole,
} from "../character-utils";
import type { CharacterPart, PartManifest } from "../../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _id = 0;
function makePart(overrides: Partial<CharacterPart>): CharacterPart {
  const id = `part-${++_id}`;
  const role = overrides.role ?? "head";
  return {
    id,
    slotId: overrides.slotId ?? `role:${role}`,
    slotName: overrides.slotName ?? "Head",
    role,
    name: overrides.name ?? "Part",
    mediaId: "media-1",
    x: 100,
    y: 100,
    width: 200,
    height: 200,
    rotation: 0,
    anchorX: 0.5,
    anchorY: 0.5,
    pivot: { x: 200, y: 200 },
    motionBehavior: "rotate",
    zIndex: overrides.zIndex ?? 0,
    depth: 0,
    visible: overrides.visible ?? true,
    ...overrides,
  };
}

// ─── defaultSlotIdForRole ──────────────────────────────────────────────────────

describe("defaultSlotIdForRole", () => {
  it("returns role:head for head", () => {
    expect(defaultSlotIdForRole("head")).toBe("role:head");
  });

  it("returns role:body for body", () => {
    expect(defaultSlotIdForRole("body")).toBe("role:body");
  });

  it("returns slot:left-eye for left-sided eye", () => {
    expect(defaultSlotIdForRole("eye", undefined, "left")).toBe("slot:left-eye");
  });

  it("returns slot:right-arm for right-sided arm", () => {
    expect(defaultSlotIdForRole("arm", undefined, "right")).toBe("slot:right-arm");
  });

  it("returns slot:front-hair for front-sided hair", () => {
    expect(defaultSlotIdForRole("hair", undefined, "front")).toBe("slot:front-hair");
  });

  it("returns custom:partId for custom role with partId", () => {
    expect(defaultSlotIdForRole("custom", "my-part-id")).toBe("custom:my-part-id");
  });

  it("returns role:custom when no partId for custom", () => {
    expect(defaultSlotIdForRole("custom")).toBe("role:custom");
  });
});

// ─── getPartSlotId ────────────────────────────────────────────────────────────

describe("getPartSlotId", () => {
  it("returns the part's slotId when not a generic sided slot", () => {
    const part = makePart({ role: "head", slotId: "my-custom-slot" });
    expect(getPartSlotId(part)).toBe("my-custom-slot");
  });

  it("returns default slot for sided eye with generic slotId", () => {
    // A part with slotId = "role:eye" and side = "left" is a generic sided slot
    const part = makePart({ role: "eye", slotId: "role:eye", side: "left" });
    expect(getPartSlotId(part)).toBe("slot:left-eye");
  });
});

// ─── normalizePartRole ────────────────────────────────────────────────────────

describe("normalizePartRole", () => {
  it("passes through canonical roles unchanged", () => {
    const canonical = [
      "head",
      "body",
      "eye",
      "eyebrow",
      "mouth",
      "arm",
      "hand",
      "leg",
      "foot",
      "hair",
      "accessory",
      "static",
      "custom",
    ] as const;
    for (const role of canonical) {
      expect(normalizePartRole(role)).toBe(role);
    }
  });

  it("maps legacy eyeL/eyeR → eye", () => {
    expect(normalizePartRole("eyeL")).toBe("eye");
    expect(normalizePartRole("eyeR")).toBe("eye");
  });

  it("maps legacy brow/browL/browR → eyebrow", () => {
    expect(normalizePartRole("brow")).toBe("eyebrow");
    expect(normalizePartRole("browL")).toBe("eyebrow");
    expect(normalizePartRole("browR")).toBe("eyebrow");
  });

  it("maps legacy armL/armR → arm", () => {
    expect(normalizePartRole("armL")).toBe("arm");
    expect(normalizePartRole("armR")).toBe("arm");
  });

  it("maps legacy extra → custom", () => {
    expect(normalizePartRole("extra")).toBe("custom");
  });

  it("maps unknown string → custom", () => {
    expect(normalizePartRole("totally-unknown")).toBe("custom");
    expect(normalizePartRole(undefined)).toBe("custom");
  });
});

// ─── roleEnabledByManifest ────────────────────────────────────────────────────

describe("roleEnabledByManifest", () => {
  const fullManifest: PartManifest = {
    hasHead: true,
    hasBody: true,
    hasArms: true,
    hasHands: true,
    hasLegs: true,
    hasFeet: true,
    hasEyes: true,
    hasBrows: true,
    hasMouth: true,
    hasHair: true,
    hasAccessories: true,
  };

  it("returns true for all roles in a full manifest", () => {
    const roles = [
      "head",
      "body",
      "arm",
      "hand",
      "leg",
      "foot",
      "eye",
      "eyebrow",
      "mouth",
      "hair",
      "accessory",
    ] as const;
    for (const role of roles) {
      expect(roleEnabledByManifest(role, fullManifest)).toBe(true);
    }
  });

  it("returns false for disabled roles", () => {
    const noLegs = { ...fullManifest, hasLegs: false };
    expect(roleEnabledByManifest("leg", noLegs)).toBe(false);
  });

  it("static and custom are always enabled regardless of manifest", () => {
    const emptyManifest = Object.fromEntries(
      Object.keys(fullManifest).map((k) => [k, false]),
    ) as PartManifest;
    expect(roleEnabledByManifest("static", emptyManifest)).toBe(true);
    expect(roleEnabledByManifest("custom", emptyManifest)).toBe(true);
  });

  it("uses DEFAULT_PART_MANIFEST when manifest is undefined", () => {
    // DEFAULT_PART_MANIFEST has all true
    expect(roleEnabledByManifest("head", undefined)).toBe(true);
  });
});

// ─── listCharacterSlots ───────────────────────────────────────────────────────

describe("listCharacterSlots", () => {
  it("returns empty array for no parts", () => {
    expect(listCharacterSlots([])).toEqual([]);
  });

  it("groups multiple variants into a single slot", () => {
    const head1 = makePart({ role: "head", slotId: "role:head", viseme: undefined });
    const head2 = makePart({ role: "head", slotId: "role:head", name: "Head variant 2" });
    const slots = listCharacterSlots([head1, head2]);
    expect(slots.length).toBe(1);
    expect(slots[0].parts.length).toBe(2);
  });

  it("creates separate slots for head and body", () => {
    const head = makePart({ role: "head", slotId: "role:head" });
    const body = makePart({ role: "body", slotId: "role:body" });
    const slots = listCharacterSlots([head, body]);
    expect(slots.length).toBe(2);
    const roles = slots.map((s) => s.role);
    expect(roles).toContain("head");
    expect(roles).toContain("body");
  });

  it("creates separate slots for left and right eye", () => {
    const leftEye = makePart({ role: "eye", slotId: "slot:left-eye", side: "left" });
    const rightEye = makePart({ role: "eye", slotId: "slot:right-eye", side: "right" });
    const slots = listCharacterSlots([leftEye, rightEye]);
    expect(slots.length).toBe(2);
  });

  it("sorts slots by ascending zIndex", () => {
    const high = makePart({ role: "head", slotId: "role:head", zIndex: 10 });
    const low = makePart({ role: "body", slotId: "role:body", zIndex: 0 });
    const slots = listCharacterSlots([high, low]);
    expect(slots[0].role).toBe("body");
    expect(slots[1].role).toBe("head");
  });
});

// ─── pickActivePart ───────────────────────────────────────────────────────────

describe("pickActivePart", () => {
  it("returns undefined when no visible parts exist", () => {
    const hidden = makePart({ role: "head", visible: false });
    expect(pickActivePart([hidden], "head", {})).toBeUndefined();
  });

  it("returns the first visible part for generic role", () => {
    const p1 = makePart({ role: "arm", slotId: "role:arm", zIndex: 0 });
    const p2 = makePart({ role: "arm", slotId: "role:arm", zIndex: 1 });
    const result = pickActivePart([p1, p2], "arm", {});
    expect(result?.id).toBe(p1.id);
  });

  it("selects mouth part by viseme", () => {
    const rest = makePart({ role: "mouth", slotId: "role:mouth", viseme: "rest" });
    const aPart = makePart({ role: "mouth", slotId: "role:mouth", viseme: "A" });
    expect(pickActivePart([rest, aPart], "mouth", { viseme: "A" })?.id).toBe(aPart.id);
  });

  it("falls back to rest mouth when viseme not found", () => {
    const rest = makePart({ role: "mouth", slotId: "role:mouth", viseme: "rest" });
    const aPart = makePart({ role: "mouth", slotId: "role:mouth", viseme: "A" });
    expect(pickActivePart([rest, aPart], "mouth", { viseme: "O" })?.id).toBe(rest.id);
  });

  it("selects eye part by eyeState", () => {
    const open = makePart({ role: "eye", slotId: "role:eye", eyeState: "open" });
    const closed = makePart({ role: "eye", slotId: "role:eye", eyeState: "closed" });
    expect(pickActivePart([open, closed], "eye", { eyeState: "closed" })?.id).toBe(closed.id);
  });

  it("falls back to open eye when eyeState not found", () => {
    const open = makePart({ role: "eye", slotId: "role:eye", eyeState: "open" });
    const half = makePart({ role: "eye", slotId: "role:eye", eyeState: "half" });
    expect(pickActivePart([open, half], "eye", { eyeState: "wink" })?.id).toBe(open.id);
  });

  it("selects part by pose for generic roles", () => {
    const idle = makePart({ role: "body", slotId: "role:body", pose: "idle" });
    const walk = makePart({ role: "body", slotId: "role:body", pose: "walk" });
    expect(pickActivePart([idle, walk], "body", { pose: "walk" })?.id).toBe(walk.id);
  });
});

// ─── pickActivePartForSlot ────────────────────────────────────────────────────

describe("pickActivePartForSlot", () => {
  it("delegates to pickActivePart with slot role and id", () => {
    const rest = makePart({ role: "mouth", slotId: "role:mouth", viseme: "rest" });
    const aPart = makePart({ role: "mouth", slotId: "role:mouth", viseme: "A" });
    const slot = { id: "role:mouth", role: "mouth" as const, name: "Mouth", parts: [rest, aPart] };
    const result = pickActivePartForSlot(slot, { viseme: "A" });
    expect(result?.id).toBe(aPart.id);
  });
});
