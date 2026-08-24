// Minimal seeded character for learning the canonical Root → Pelvis → limb rig and testing IK.
import { importMediaFile, uid } from "../db";
import { DEFAULT_PART_MANIFEST, type CharacterPreset, type PartRole } from "../types";
import { createBlankCharacter, makePart, normalizeCharacterSlots } from "./character-utils";
import { loadCharacter, saveCharacter } from "./character-persistence";

export const RIG_TEST_CHARACTER_ID = "builtin-ik-rig-test";
export const RIG_TEST_CHARACTER_VERSION = 1;

interface TestPartSpec {
  key: string;
  role: PartRole;
  name: string;
  side?: "left" | "right";
  x: number;
  y: number;
  width: number;
  height: number;
  pivot: { x: number; y: number };
  zIndex: number;
  fill: string;
  shape: string;
}

const specs: TestPartSpec[] = [
  {
    key: "body",
    role: "body",
    name: "Torso",
    x: 220,
    y: 250,
    width: 160,
    height: 270,
    pivot: { x: 300, y: 500 },
    zIndex: 40,
    fill: "#4f7cac",
    shape: '<rect x="8" y="8" width="144" height="254" rx="42"/>',
  },
  {
    key: "head",
    role: "head",
    name: "Head",
    x: 240,
    y: 90,
    width: 120,
    height: 150,
    pivot: { x: 300, y: 230 },
    zIndex: 70,
    fill: "#f2c49e",
    shape: '<circle cx="60" cy="72" r="56"/>',
  },
  ...limbSpecs("left", 255, 277, 10),
  ...limbSpecs("right", 300, 323, 12),
];

function limbSpecs(side: "left" | "right", x: number, centerX: number, z: number) {
  const fill = side === "left" ? "#6b7280" : "#858b98";
  return [
    {
      key: `${side}-upper-leg`,
      role: "upperLeg" as const,
      name: `${side === "left" ? "Left" : "Right"} upper leg`,
      side,
      x,
      y: 500,
      width: 45,
      height: 140,
      pivot: { x: centerX, y: 510 },
      zIndex: z,
      fill,
      shape: '<rect x="7" y="7" width="31" height="126" rx="15"/>',
    },
    {
      key: `${side}-lower-leg`,
      role: "lowerLeg" as const,
      name: `${side === "left" ? "Left" : "Right"} lower leg`,
      side,
      x,
      y: 630,
      width: 45,
      height: 140,
      pivot: { x: centerX, y: 640 },
      zIndex: z - 1,
      fill,
      shape: '<rect x="7" y="7" width="31" height="126" rx="15"/>',
    },
    {
      key: `${side}-foot`,
      role: "foot" as const,
      name: `${side === "left" ? "Left" : "Right"} foot`,
      side,
      x: side === "left" ? x - 12 : x - 2,
      y: 750,
      width: 82,
      height: 45,
      pivot: { x: centerX, y: 765 },
      zIndex: z - 2,
      fill: "#30343b",
      shape: '<path d="M10 20 Q34 6 62 18 L74 29 Q76 37 65 38 H16 Q5 36 10 20Z"/>',
    },
  ];
}

function partSvg(spec: TestPartSpec): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" viewBox="0 0 ${spec.width} ${spec.height}"><g fill="${spec.fill}">${spec.shape}</g></svg>`;
}

/** Build the small, one-angle character without touching persistence or media storage. */
export function buildRigTestCharacter(
  id: string,
  mediaIdForKey: (key: string) => string,
): CharacterPreset {
  const base = createBlankCharacter("IK Rig Test");
  return normalizeCharacterSlots({
    ...base,
    id,
    builtinVersion: RIG_TEST_CHARACTER_VERSION,
    canvasWidth: 600,
    canvasHeight: 900,
    angles: ["front"],
    manifest: {
      ...DEFAULT_PART_MANIFEST,
      hasEyes: false,
      hasIrises: false,
      hasBrows: false,
      hasNose: false,
      hasMouth: false,
      hasHair: false,
      hasAccessories: false,
    },
    parts: specs.map((spec) =>
      makePart(spec.role, mediaIdForKey(spec.key), {
        name: spec.name,
        side: spec.side,
        x: spec.x,
        y: spec.y,
        width: spec.width,
        height: spec.height,
        pivot: spec.pivot,
        zIndex: spec.zIndex,
        angleIds: ["front"],
      }),
    ),
  });
}

async function materializeRigTestCharacter(id: string): Promise<CharacterPreset> {
  const mediaIdByKey = new Map<string, string>();
  await Promise.all(
    specs.map(async (spec) => {
      const file = new File([partSvg(spec)], `${spec.key}.svg`, { type: "image/svg+xml" });
      const asset = await importMediaFile(file, { scope: "character-part" });
      mediaIdByKey.set(spec.key, asset.id);
    }),
  );
  return buildRigTestCharacter(id, (key) => {
    const mediaId = mediaIdByKey.get(key);
    if (!mediaId) throw new Error(`Missing IK test media for "${key}"`);
    return mediaId;
  });
}

/** Seed the intentionally simple test actor used by the Characters library. */
export async function ensureRigTestCharacterSeeded(): Promise<CharacterPreset> {
  const existing = await loadCharacter(RIG_TEST_CHARACTER_ID);
  if (
    existing?.builtinVersion === RIG_TEST_CHARACTER_VERSION &&
    existing.parts.length === specs.length
  ) {
    return existing;
  }
  return saveCharacter(await materializeRigTestCharacter(RIG_TEST_CHARACTER_ID));
}

/** Create a user-owned copy of the simple IK test actor. */
export async function createRigTestCharacter(): Promise<CharacterPreset> {
  return saveCharacter(await materializeRigTestCharacter(uid()));
}
