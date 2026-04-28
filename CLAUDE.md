# Studio Boom — Architecture Guide

## Core principle: HyperFrames-compliant rendering

All animation in this project is expressed as GSAP timelines and driven by `tl.seek(t)`.
The live studio preview and the exported HTML package use the **same** rendering model.
Never add a second rendering path. Never compute animation state inside a React render function.

---

## What HyperFrames compliance means

### Timelines

- Every animated clip has exactly one GSAP timeline: `gsap.timeline({ paused: true })`
- Timelines are registered: `window.__timelines["<id>"] = tl`
- Playback is driven by `tl.seek(seconds)` — never by React state changes for visual output
- Timelines are built **synchronously** — no `async`/`await`, `setTimeout`, or Promises inside timeline construction
- No `Math.random()` or `Date.now()` inside timelines — use a seeded PRNG (mulberry32) for deterministic output

### Clips and tracks

- Each clip element carries `data-start`, `data-duration`, `data-track-index` attributes
- `data-track-index = clip.trackIndex * 10 + (clip.laneIndex ?? 0)` — prevents overlap-detection conflicts across lanes
- Visual layering uses CSS `z-index`, **not** `data-track-index`
- Character clips are sub-compositions: `data-composition-id`, `data-composition-src`, `data-width`, `data-height`

### Coordinate system and scaling (read before touching any position math)

- The project stage is **1920 × 1080**. All clip positions (`x`, `y`, `width`, `height`) are in stage pixels.
- Character rigs have a logical canvas (e.g. 600 × 900). Parts have positions on that canvas.
- **Never use CSS `transform: scale()` to fit a character canvas into its clip bounds.**
  This breaks hit-testing, selection handles, and sub-pixel rendering.
- Instead, scale all part coordinates explicitly when building the timeline or rendering parts:
  ```
  scaleX = clip.width  / character.canvasWidth
  scaleY = clip.height / character.canvasHeight
  scaledLeft  = part.x      * scaleX
  scaledTop   = part.y      * scaleY
  scaledWidth = part.width  * scaleX
  scaledHeight= part.height * scaleY
  ```
- GSAP `x`/`y` deltas from action presets must also be scaled by the same factors before being added to the timeline.
- Transform origins are set in CSS per part:
  `transform-origin: ${part.anchorX * 100}% ${part.anchorY * 100}%`
  GSAP respects this CSS value when applying `rotation` and `scale`.

### What GSAP may animate

Only animate visual transform properties:
`opacity`, `x`, `y`, `scale`, `scaleX`, `scaleY`, `rotation`, `color`, `backgroundColor`, `borderRadius`

Never animate: `display`, `visibility`, `width`, `height`, `left`, `top`.
Use `tl.set(el, { opacity: 0 }, time)` **inside** the timeline to toggle visibility — not `display: none`.

---

## Character animation pipeline

### Building a character timeline

`buildCharacterTimeline(clip, character, presets)` in `src/studio/export/timeline-builder.ts`
is the single source of truth for character animation. It is used by both the Stage preview and the exporter.

Steps:
1. `const tl = gsap.timeline({ paused: true })`
2. Compute `scaleX`, `scaleY` from clip vs character canvas
3. Collect **critical times**: action keyframe boundaries + viseme times (see `collectCriticalTimes`)
4. For each slot (non-mouth), at each consecutive critical-time pair:
   - Call `composeActionsAt(clip, t, presets)` → `deltaFor(composed, slot.role, slot.id)`
   - Compute **inherited delta** for face-attached parts (eye, eyebrow, mouth) via `transformPointAroundPivot`
   - Add `tl.to("#<domId>", { x, y, scale, rotation, opacity, duration, ease: "none" }, startTime)`
5. Mouth viseme events from `clip.visemes` → `tl.set()` opacity toggles
6. Auto-blink events (seeded by `clip.id`, deterministic) → `tl.set()` opacity toggles on eye variants

### Face-part inheritance (required — never skip)

Eyes, eyebrows, and mouth inherit the head's motion. When the head nods, all face parts follow.
At each critical time:
1. Get the head slot's composed delta
2. Call `transformPointAroundPivot(facePartPivot, headPivot, headDelta)` to get the transformed pivot
3. Add `(transformedPivot.x - facePartPivot.x) * scaleX` to the face part's GSAP `x` value

This mirrors the `inheritedMotionForPart` logic in Stage.tsx.

### Mouth and eye visibility

- All viseme variants are present in the DOM simultaneously, all `opacity: 0` initially
- The "rest" viseme starts `opacity: 1`
- At each viseme transition time `t`:
  ```js
  tl.set("#mouth-<clipId>-<prevViseme>", { opacity: 0 }, t)
  tl.set("#mouth-<clipId>-<nextViseme>", { opacity: 1 }, t)
  ```
- Eye "open" and "closed" variants work identically for auto-blink

### DOM element IDs

Use `slotDomId(clipId, slotId)` from `timeline-builder.ts` consistently everywhere:
```ts
// Returns: `char-${clipId}-${slotId.replace(/[^a-z0-9]/gi, "-")}`
```
The Stage and the exporter must use the exact same IDs so GSAP targets match the DOM.

---

## Adding a new clip type

Any new clip type must:
1. Have `data-start`, `data-duration`, `data-track-index` on its root element
2. Have a GSAP timeline registered in `window.__timelines` (or be a plain `<img>`/`<audio>`/`<video>`)
3. Be fully serializable from project data to HTML — no runtime-only state
4. Produce identical output when `tl.seek(t)` is called for any `t` in `[0, duration]`

---

## Export

Export = serialize the live DOM structure + copy media blobs + bundle GSAP locally from `node_modules`.
There is **no** separate export renderer. If the studio preview is correct, the export is correct.

- Bundle GSAP from `node_modules/gsap/dist/gsap.min.js` — never use a CDN in exported packages
- Character sub-compositions use `<template>` wrapper; the root `index.html` does not
- Asset paths: `assets/<mediaId>.<ext>` at the ZIP root; sub-compositions reference `../assets/`

---

## Key source files

| File | Role |
|------|------|
| `src/studio/types.ts` | All domain types (Project, Clip, CharacterPreset, ActionPreset…) |
| `src/studio/store.ts` | Zustand store — project state, playhead, selection |
| `src/studio/db.ts` | Dexie IndexedDB — projects, characters, presets, media blobs |
| `src/studio/components/Stage.tsx` | Visual canvas — renders clips, drives GSAP seek |
| `src/studio/export/timeline-builder.ts` | Builds GSAP timelines from project data (no React) |
| `src/studio/presets/apply.ts` | `composeActionsAt` — action composition engine |
| `src/studio/character/character-utils.ts` | `listCharacterSlots`, `pickActivePartForSlot` |
| `src/studio/lipsync/visemeMap.ts` | `visemeAt`, `visemeStateAt` |

---

## What not to do

- Do not call `composeActionsAt()` inside a React render to produce CSS transform strings
- Do not use CSS `transform: scale()` on character containers
- Do not use `display: none` / `display: block` via GSAP — use `opacity`
- Do not build timelines inside `async` functions or event handlers
- Do not use `repeat: -1` on any timeline — calculate explicit repeat counts from duration
- Do not add a new animation path that bypasses `timeline-builder.ts`
