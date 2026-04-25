// Built-in Action Preset library — seeded into IndexedDB on first run.
// These are character-agnostic: they target part roles and apply deltas
// relative to each part's rest pose, so they work on any character that
// has those roles enabled in its manifest.
import { db, uid } from "../db";
import type { ActionPreset, ActionTrack } from "../types";

const now = () => Date.now();

function preset(
  name: string,
  category: ActionPreset["category"],
  duration: number,
  tracks: ActionTrack[],
  opts: { loop?: boolean; description?: string; headTurn?: ActionPreset["headTurn"] } = {},
): ActionPreset {
  return {
    id: `builtin-${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    category,
    duration,
    loop: opts.loop ?? false,
    tracks,
    headTurn: opts.headTurn,
    description: opts.description,
    builtin: true,
    createdAt: now(),
    updatedAt: now(),
  };
}

const STARTERS: ActionPreset[] = [
  // Expressions ------------------------------------------------------------
  preset("Surprised", "expression", 0.6, [
    {
      partRole: "mouth",
      poseSwap: "O",
      lockMouth: true,
      keyframes: [
        { t: 0, scale: 1, ease: "easeOut" },
        { t: 0.3, scale: 1.5, ease: "easeOut" },
        { t: 1, scale: 1.4 },
      ],
    },
    {
      partRole: "brow",
      keyframes: [
        { t: 0, dy: 0 },
        { t: 0.3, dy: -18, ease: "easeOut" },
        { t: 1, dy: -16 },
      ],
    },
    {
      partRole: "eye",
      keyframes: [
        { t: 0, scale: 1 },
        { t: 0.3, scale: 1.2 },
        { t: 1, scale: 1.15 },
      ],
    },
  ], { description: "Wide eyes, raised brows, round mouth." }),

  preset("Happy", "expression", 0.5, [
    {
      partRole: "mouth",
      lockMouth: true,
      keyframes: [
        { t: 0, scale: 1 },
        { t: 1, scale: 1.2, dy: 2 },
      ],
    },
    {
      partRole: "eye",
      keyframes: [{ t: 0, scale: 1 }, { t: 1, scale: 0.85, dy: 2 }],
    },
  ], { description: "Smile + happy squint." }),

  preset("Sad", "expression", 0.6, [
    { partRole: "brow", keyframes: [{ t: 0, dy: 0, rotation: 0 }, { t: 1, dy: -4, rotation: -8 }] },
    { partRole: "mouth", lockMouth: true, keyframes: [{ t: 0, dy: 0, scale: 1 }, { t: 1, dy: 6, scale: 0.85 }] },
    { partRole: "head", keyframes: [{ t: 0, rotation: 0, dy: 0 }, { t: 1, rotation: -3, dy: 4 }] },
  ]),

  preset("Angry", "expression", 0.45, [
    { partRole: "brow", keyframes: [{ t: 0, dy: 0, rotation: 0 }, { t: 1, dy: -6, rotation: 12 }] },
    { partRole: "mouth", lockMouth: true, keyframes: [{ t: 0, scale: 1 }, { t: 1, scale: 0.9, dy: -2 }] },
    { partRole: "eye", keyframes: [{ t: 0, scale: 1 }, { t: 1, scale: 0.85 }] },
  ]),

  preset("Confused", "expression", 0.7, [
    { partRole: "brow", keyframes: [{ t: 0, rotation: 0 }, { t: 1, rotation: -10, dy: -4 }] },
    { partRole: "head", keyframes: [{ t: 0, rotation: 0 }, { t: 0.5, rotation: 6 }, { t: 1, rotation: 4 }] },
  ]),

  preset("Blink", "expression", 0.18, [
    {
      partRole: "eye",
      poseSwap: "closed",
      keyframes: [
        { t: 0, scale: 1 },
        { t: 0.5, scale: 0.05 },
        { t: 1, scale: 1 },
      ],
    },
  ], { description: "Quick blink." }),

  // Gestures ---------------------------------------------------------------
  preset("Wave", "gesture", 1.2, [
    {
      partRole: "armR",
      keyframes: [
        { t: 0, rotation: 0 },
        { t: 0.2, rotation: -60, ease: "easeOut" },
        { t: 0.45, rotation: -45 },
        { t: 0.65, rotation: -65 },
        { t: 0.85, rotation: -45 },
        { t: 1, rotation: 0, ease: "easeIn" },
      ],
    },
  ]),

  preset("Nod", "gesture", 0.7, [
    {
      partRole: "head",
      keyframes: [
        { t: 0, rotation: 0 },
        { t: 0.3, rotation: 8, ease: "easeOut" },
        { t: 0.6, rotation: -2 },
        { t: 1, rotation: 0, ease: "easeIn" },
      ],
    },
  ]),

  preset("Shake head", "gesture", 0.8, [
    {
      partRole: "head",
      keyframes: [
        { t: 0, dx: 0, rotation: 0 },
        { t: 0.25, dx: -8, rotation: -6 },
        { t: 0.5, dx: 8, rotation: 6 },
        { t: 0.75, dx: -6, rotation: -4 },
        { t: 1, dx: 0, rotation: 0 },
      ],
    },
  ]),

  preset("Shrug", "gesture", 0.9, [
    { partRole: "armL", keyframes: [{ t: 0, dy: 0, rotation: 0 }, { t: 0.5, dy: -10, rotation: -10 }, { t: 1, dy: 0, rotation: 0 }] },
    { partRole: "armR", keyframes: [{ t: 0, dy: 0, rotation: 0 }, { t: 0.5, dy: -10, rotation: 10 }, { t: 1, dy: 0, rotation: 0 }] },
    { partRole: "head", keyframes: [{ t: 0, dy: 0 }, { t: 0.5, dy: 4 }, { t: 1, dy: 0 }] },
  ]),

  preset("Point", "gesture", 0.8, [
    {
      partRole: "armR",
      keyframes: [
        { t: 0, rotation: 0 },
        { t: 0.4, rotation: -75, ease: "easeOut" },
        { t: 1, rotation: -75 },
      ],
    },
  ]),

  // Full-body --------------------------------------------------------------
  preset("Idle bob", "full-body", 2, [
    { partRole: "body", keyframes: [{ t: 0, dy: 0 }, { t: 0.5, dy: -4 }, { t: 1, dy: 0 }] },
    { partRole: "head", keyframes: [{ t: 0, dy: 0 }, { t: 0.5, dy: -3 }, { t: 1, dy: 0 }] },
  ], { loop: true, description: "Subtle breathing." }),

  preset("Jump", "full-body", 0.7, [
    { partRole: "body", keyframes: [{ t: 0, dy: 0, scale: 1 }, { t: 0.2, dy: 8, scale: 0.92 }, { t: 0.5, dy: -60, scale: 1.05 }, { t: 0.8, dy: 8, scale: 0.92 }, { t: 1, dy: 0, scale: 1 }] },
    { partRole: "head", keyframes: [{ t: 0, dy: 0 }, { t: 0.5, dy: -60 }, { t: 1, dy: 0 }] },
    { partRole: "armL", keyframes: [{ t: 0, rotation: 0 }, { t: 0.5, rotation: 30 }, { t: 1, rotation: 0 }] },
    { partRole: "armR", keyframes: [{ t: 0, rotation: 0 }, { t: 0.5, rotation: -30 }, { t: 1, rotation: 0 }] },
  ]),

  // Camera -----------------------------------------------------------------
  preset("Slow zoom in", "camera", 4, [
    {
      partRole: "__camera",
      keyframes: [
        { t: 0, scale: 1 },
        { t: 1, scale: 1.15, ease: "easeInOut" },
      ],
    },
  ]),

  preset("Pan left", "camera", 3, [
    { partRole: "__camera", keyframes: [{ t: 0, dx: 0 }, { t: 1, dx: -120, ease: "easeInOut" }] },
  ]),

  preset("Camera shake", "camera", 0.6, [
    {
      partRole: "__camera",
      keyframes: [
        { t: 0, dx: 0, dy: 0 },
        { t: 0.15, dx: 6, dy: -4 },
        { t: 0.3, dx: -8, dy: 6 },
        { t: 0.5, dx: 5, dy: -3 },
        { t: 0.7, dx: -4, dy: 4 },
        { t: 1, dx: 0, dy: 0 },
      ],
    },
  ]),
];

let seedPromise: Promise<void> | null = null;

export function ensurePresetsSeeded(): Promise<void> {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    for (const p of STARTERS) {
      const existing = await db.movements.get(p.id);
      if (!existing) {
        await db.movements.put(p);
      } else if (existing.builtin) {
        // Refresh builtin definitions in case we ship updates.
        await db.movements.put({ ...p, createdAt: existing.createdAt });
      }
    }
  })();
  return seedPromise;
}

/** Create a fresh user-defined preset (not built-in). */
export function createUserPreset(
  name: string,
  category: ActionPreset["category"],
): ActionPreset {
  const t = Date.now();
  return {
    id: uid(),
    name,
    category,
    duration: 1,
    loop: false,
    tracks: [],
    builtin: false,
    createdAt: t,
    updatedAt: t,
  };
}
