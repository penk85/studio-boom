# Phase 3 — Character Editor, Parallax & Preset System

## Hyperframes scope (honest answer)

The only confirmed Hyperframes touchpoint in this app is the **export target** (Phase 5 emits Hyperframes-compatible HTML). Everything else — TTS, lip sync, rigging, presets, parallax — is custom code in this studio. If Hyperframes ships an SDK/component library you want to target instead, share the docs and I'll wire it in. Until then I'll build native and let the exporter translate. I'll flag any future request that would require an external Hyperframes capability I can't confirm.

## Parallax — yes, supported

Each character part already has a `zIndex`. I'll add a `depth` value (-1…+1) per part. Depth drives:
- subtle motion offset when the **character clip** moves (parts further "back" lag, parts in "front" lead)
- optional scene-level **camera parallax** (pan/zoom on the stage shifts parts by depth)
- preserved on export as data attributes

This gives a 2.5D feel without requiring 3D assets.

## Character Editor

A new full-screen editor opened from Library → Characters → "New / Edit character". Saves to the existing `characters` Dexie table (`CharacterPreset`).

```text
┌─ Parts list ─┬──── Character canvas ────┬─ Part inspector ─┐
│ head         │                          │ media: [pick]    │
│  mouth (rest)│      [drag to align]     │ role: mouth      │
│  mouth (A)…  │      [resize handles]    │ pose / viseme    │
│ body (idle)  │      onion-skin toggle   │ x,y,w,h,rot      │
│  body (walk) │                          │ anchor x,y       │
│ armL / armR  │                          │ z-index          │
│ legL / legR  │                          │ depth (parallax) │
│ eye (open)…  │                          │ visible          │
│ + Add part   │                          │ optional toggle  │
└──────────────┴──────────────────────────┴──────────────────┘
```

Key behaviors:
- **Upload + align**: drop image → place freely on the canvas, drag/resize/rotate, set anchor point (used as pivot for rotation/scale presets).
- **Z-index ordering**: drag-reorder parts list = z-index; live preview shows occlusion. Solves the "nothing important overlaps" requirement.
- **Optional parts**: every role (arms, legs, eyes) can be toggled off if a character doesn't have them. Presets that target missing parts are ignored at runtime (no crash).
- **Variants**: a part can have multiple media (e.g. body_idle, body_walk, mouth_A, mouth_O, eye_open/half/closed). Variants share transform but swap image.
- **Parallax depth slider** per part (-1 back … 0 neutral … +1 front).
- **Onion skin** toggles the rest pose underneath while editing variants so you can match alignment.

Reusable: a `CharacterPreset` is referenced by `CharacterClip.characterId`, so editing a character updates everywhere it's used.

## Preset System — combined "Action Presets"

You asked whether expressions and movements should be one thing or two. Recommendation: **one unified primitive** called an **Action Preset**, with optional category tags (`expression`, `gesture`, `full-body`, `camera`). Reasons:

- Both are just "change these part properties over time".
- "Surprised" (mouth O larger + eyebrows up) and "wave" (armR rotates + hand swap) use the exact same data shape.
- A single picker is simpler than two parallel systems, and you can still filter by category.
- Lets you compose: e.g. apply "Surprised" + "Wave" simultaneously on overlapping ranges.

### Action Preset shape

```ts
ActionPreset {
  id, name, category: 'expression'|'gesture'|'full-body'|'camera'|'custom',
  duration: number,                // base duration; clip can stretch
  loop: boolean,                   // for idle gestures
  tracks: {
    partRole: string,              // e.g. 'mouth', 'armR', 'eye', 'head'
    poseSwap?: string,             // jump to a named variant (e.g. 'O', 'walk')
    keyframes: [
      { t, x?, y?, scale?, rotation?, opacity?, ease? }
    ]
  }[]
}
```

Stored in the existing `movements` Dexie table (renamed concept; keeping the table name for back-compat) plus a `category` field.

### Authoring an Action Preset

A new **Preset Editor** route (`/presets`) opens with:
- pick a "stand-in" character (or generic skeleton) for previewing
- dopesheet/timeline: rows = part roles, cells = keyframes
- per-keyframe transform deltas (relative to the part's rest pose, so the preset works on any character)
- live scrub preview
- save with name + category + tags

### Applying on the timeline

On a `CharacterClip`, the Inspector gets a new **Actions** panel:
- list of applied presets with `start offset` (relative to clip), `duration` (override), `intensity` (0–1 scale)
- "+ Apply preset" → searchable picker filtered by category
- multiple presets can overlap; transforms compose additively, pose swaps follow last-write-wins per part
- visemes (lip sync) always win on the `mouth` role unless a preset explicitly locks the mouth

This satisfies "save Surprised, apply for X seconds to any character".

### Built-in starter library (shipped)

Seed a few presets so it's usable day one:
- expressions: Neutral, Surprised, Happy, Sad, Angry, Confused
- gestures: Wave, Nod, Shake head, Point, Shrug
- full-body: Idle bob, Walk-in-place, Jump
- camera: Slow zoom in, Pan left/right, Shake

## Data model changes

```ts
CharacterPart += { depth: number }        // -1..1 parallax
CharacterPreset += { hasArms, hasLegs, hasEyes, hasMouth }   // optional-parts manifest
ActionPreset (movements table) += {
  category, loop, tracks[]                 // replaces flat keyframes[]
}
CharacterClip += {
  actions: { presetId, offset, duration?, intensity? }[]   // replaces movements[]
  parallax: { camera?: { x:number, y:number, zoom:number } } // optional
}
Project += { camera?: { keyframes: [...] } }  // for scene-level parallax
```

Migration: old `MovementPreset.keyframes` → wrap into a single track with `partRole: '__root'` so existing data still plays.

## Files to create / edit

Create:
- `src/studio/character/CharacterEditor.tsx` (full editor surface)
- `src/studio/character/PartList.tsx`, `PartCanvas.tsx`, `PartInspector.tsx`
- `src/studio/character/parallax.ts` (depth → offset math, shared with Stage + export)
- `src/studio/presets/PresetEditor.tsx` (dopesheet)
- `src/studio/presets/PresetPicker.tsx`, `PresetList.tsx`
- `src/studio/presets/seed.ts` (built-in library, idempotent insert on first run)
- `src/studio/presets/apply.ts` (compose active presets at time `t` → per-part transform delta + pose map)
- `src/studio/components/ActionsPanel.tsx` (Inspector section for character clips)
- `src/routes/character.$id.tsx`, `src/routes/presets.tsx`, `src/routes/presets.$id.tsx`

Edit:
- `src/studio/types.ts` (additions above + migration helper)
- `src/studio/db.ts` (bump Dexie version, run seed on first open)
- `src/studio/components/Library.tsx` (Characters tab → list + "New" / "Edit"; Movements tab → real preset list filtered by category)
- `src/studio/components/Inspector.tsx` (mount `ActionsPanel` for character clips)
- `src/studio/components/Stage.tsx` (render real character rigs with z-index + depth-driven parallax; viseme mouth swap; apply composed action transforms)

## Open questions before I build

1. **Editor surface**: open the character editor in a **modal/sheet** over the studio, or as a **dedicated route** (`/character/:id`)? (Route preserves shareable URLs and back/forward.)
2. **Parallax trigger**: should parts parallax on (a) character clip movement only, (b) scene camera only, or (c) both? Default I'd ship: both, with per-character toggle.
3. **Preset categories visible to user**: the four above (expression / gesture / full-body / camera) — keep, simplify to two (face / body), or expand?
4. **Rest-pose convention**: each character must define a "rest" variant for every active part role (used as the baseline that presets offset from). Confirm OK that the editor enforces this on save.
