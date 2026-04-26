## What we're fixing

1. **Stage selection keeps deselecting** — clicks bubble to the wrapper's `onClick={() => selectClip(null)}` and clear the selection right after you make it. Fix: only clear when the click is on the true empty background AND no drag occurred.
2. **Every body part row in the character editor shows an eye icon** — the visibility toggle on each part row in the parts list uses the `👁` emoji as its glyph, so every uploaded part looks like an eye. Fix: replace with `Eye` / `EyeOff` lucide icons.
3. **Character editor — parts on the canvas are all freely grabbable.** New rule: **the canvas is non-interactive; selection happens only from the left parts list.** Only the part selected in the list can be moved/resized.
4. **Head Variants is a top-level panel** — nest variants _inside_ their parent part group (Head, Body, Eye, Brow, Mouth) in the parts list.
5. **Timeline overlap** — multiple clips on the same track stack visually. Add **sub-tracks (lanes)** per top-level track so each clip gets its own lane.

## How it will work

### Stage selection stickiness (`Stage.tsx`)

- Track a `didDrag` ref set on pointer-move during a clip drag.
- Wrapper `onClick` clears selection only when `e.target === e.currentTarget` AND `!didDrag`.
- Stop propagation properly on clip clicks so the wrapper handler never sees them.

### Replace eye-emoji visibility toggle (`CharacterEditor.tsx`)

- Import `Eye` and `EyeOff` from `lucide-react`.
- In the parts list row (line ~346), replace `{p.visible ? "👁" : "—"}` with the corresponding lucide icon at `size={14}`.
- This removes the "every part looks like an eye" effect — now it's a small clear visibility toggle.

### Character editor — list-driven selection

- **Canvas parts are display-only.** Remove `onPointerDown` selection from `PartLayer`. The canvas surface itself doesn't change selection on click either.
- **Drag/resize only on the actively selected part.** When `selected === true`, the part renders its move/resize handles and accepts pointer drag. When not selected, it has `pointer-events: none` so clicks pass through (and do nothing).
- **Selection is exclusively from the left "Parts" list.** Clicking a row selects that part; clicking another row switches.
- **Parts list reorganized into role groups, with variants nested inside each group:**
  - **Head** → base head row + nested "Variants (turn directions)": `front`, `3qL`, `3qR`, `sideL`, `sideR`, each with "+ add variant"
  - **Body** → base body + nested "Variants (angles)": `front`, `3qL`, `3qR`, `sideL`, `sideR`, `back` (uses existing `pose` field)
  - **Eye** → "Variants (states)": `open`, `half`, `closed`, `wink` (we'll add `wink` to the `EyeState` union)
  - **Brow** → "Variants": `neutral`, `raised`, `furrowed`, `angry`, `sad`
  - **Mouth** → "Variants (visemes)" using existing viseme tags
  - **Arms / Legs / Extra** → free-form `pose` variants with "+ add variant"
- Remove the standalone `HeadVariantsEditor` panel from the right sidebar; its functionality moves into the Head group's nested variants section.
- Right inspector still shows transform/anchor/depth for the currently-selected part.

### Sub-tracks (lanes) on the main timeline

- Extend `Track` with `lanes: number` (default 1) and `BaseClip` with `laneIndex: number` (default 0).
- Render each track as N stacked lanes of `TRACK_HEIGHT`. Total track height = `lanes * TRACK_HEIGHT`.
- Track header shows lane labels (V1/V2 for video/overlay/character, A1/A2 for audio) and a "+ Lane" button.
- Dragging a clip vertically within its track snaps to the nearest lane and updates `laneIndex`. Horizontal drag still moves `start`.
- When adding new media at the playhead, auto-pick the lowest lane index that has no overlap; if none free, auto-add a new lane.
- Migration: clips without `laneIndex` default to `0`; tracks without `lanes` default to `1`.
- Stage rendering is unchanged — visual stacking still uses `zIndex`. Lanes are purely a timeline organization concept.

## Files to change

```text
src/studio/types.ts              + laneIndex on BaseClip; + lanes on Track; + 'wink' in EyeState
src/studio/store.ts              auto-assign laneIndex on add (find free lane / add lane)
src/studio/components/Stage.tsx  fix selection-clear logic (didDrag + target check)
src/studio/components/Timeline.tsx  render N lanes per track; vertical lane snap;
                                    +Lane button; lane labels in header
src/studio/character/CharacterEditor.tsx
                                  replace 👁 visibility glyph with lucide Eye/EyeOff;
                                  remove HeadVariantsEditor side panel;
                                  reorganize PartsList into role groups with nested variants;
                                  PartLayer: drag/resize only when selected, pointer-events:none otherwise;
                                  no canvas-click selection
src/studio/character/character-utils.ts  small grouping helpers if needed
```

## Out of scope (handled later if you want)

- Drag-reorder lanes themselves
- Per-lane mute/lock UI (data model already supports it via existing `Track.muted/locked`)
- Magnetic/ripple timeline behaviors
