# Phase 3.5 — Head Turns, Dual Parallax, Preset Recorder

Building on the character editor + action presets already in place. Three additions, all designed to stay intuitive (no dopesheet, no keyframe grids).

## 1. Head Turn system

Head turns aren't real 3D rotation — they're variant swaps with subtle motion polish. I'll formalize this as its own concept.

**In the character editor:**
- New "Head Turn" section under the Head part group
- Slots for: `front`, `3q-left`, `3q-right`, `side-left`, `side-right` (you upload as many or few as you have)
- Optional: per-variant offset for eye/brow/mouth positions, so face features follow the turn

**As a preset:** new fifth category **"Head Turn"** (joining Expression / Gesture / Full-body / Camera). Built-in seeds: "Look left," "Look right," "Glance over shoulder," "Look up." Each one cross-fades between head variants over a chosen duration and adds a tiny parallax nudge for realism.

**On the timeline:** drop a head-turn action onto a character clip just like any other preset.

## 2. Parallax — both triggers, per-character toggle

- **Camera parallax** (already wired): scene camera pan/zoom shifts parts by depth.
- **Clip parallax** (new): when a character clip moves on stage, that character's own parts parallax against the motion.
- Per-character checkboxes in the character editor: `Parallax on camera` / `Parallax on movement`. Both default ON.
- Intensity slider per character (currently hardcoded at 0.15).

## 3. Preset Recorder (replaces the dopesheet idea)

A pose-and-capture flow. No timeline grid, no keyframe jargon.

**Flow:**
1. Open a character, click **"New action preset"**
2. Pick category (Expression / Gesture / Full-body / Camera / Head Turn) and name it
3. The character appears in rest pose. Drag parts, swap variants, resize the mouth, raise the brows — whatever the pose needs
4. Click **"Capture pose at 0.0s"**
5. A time slider appears. Drag it to e.g. 0.3s, change the pose, click **"Capture pose at 0.3s"**
6. Repeat for as many keyposes as you want (typically 1–3 is enough)
7. Click **Save** — the preset interpolates between captured poses

**Why this works for you:**
- You only ever see the character on a stage, posing it the way you want
- No rows, columns, or curve editors
- Captures *only the parts you changed* — so applying "Surprised" (mouth + brows) on top of "Wave" (arm) just works without conflicts
- Lives behind a single "+ Record preset" button; advanced users can still hand-edit the JSON later

**Quick-capture shortcut:** in the main studio, select a character, pose it, right-click → "Save current pose as preset" — same recorder, pre-filled with the current pose as keypose 1.

## Technical notes

- `CharacterPreset.headVariants: Record<HeadDirection, string>` (mediaId per direction); `HeadDirection = "front" | "3qL" | "3qR" | "sideL" | "sideR"`
- `ActionPreset.category` extended with `"headTurn"`; new `HeadTurnTrack` type with `{ from: HeadDirection, to: HeadDirection, easing }`
- `parallax.ts` gains `clipDelta` input alongside `cameraDelta`; `Stage.tsx` computes per-frame clip motion delta and passes both
- `CharacterPreset.parallax: { onCamera: boolean; onClip: boolean; intensity: number }`
- New `PresetRecorder.tsx` component (modal opened from character editor and main studio): keypose array `{ t: number; partOverrides: Partial<CharacterPart>[] }`, linear interpolation between keyposes at playback time
- `composeActionsAt` in `presets/apply.ts` extended to interpolate between recorded keyposes (currently it only blends static deltas)
- DB migration to v3 for `headVariants`, `parallax` config, and `keyposes[]` on action presets

## What's NOT in this phase (deferred)

- Curve editors / easing graphs
- Per-part timing offsets within one preset (everything in one preset shares the keypose timeline)
- IK / bone constraints — parts stay independent

## After this

Phase 4: scene camera keyframes + auto-blink + auto-breath idle. Phase 5: Hyperframes export.
