# Hyperframes Movie Studio

A friendly, drag-and-drop video studio in the browser that authors valid Hyperframes compositions (HTML + GSAP timelines + assets), with reusable puppet characters and automatic phoneme lip sync. Final MP4 rendering happens on the user's own machine via the Hyperframes CLI; the studio exports a ready-to-render project.

## Core concept

- Everything is local-only (IndexedDB for projects/characters/movement presets, OPFS / IndexedDB blobs for media). No accounts, no cloud.
- A project is a Hyperframes-compliant scene authored visually. On export, the studio writes `meta.json`, `index.html` with proper `data-composition-id / width / height / class="clip" / data-start / data-duration / data-track-index`, registers a paused GSAP timeline on `window.__timelines`, and bundles all media under `assets/`.
- Users render to MP4 by unzipping the export and running `npx hyperframes render --output output.mp4` (instructions shown after export).

## Main UI (one-screen studio)

```text
┌──────────────────────────────────────────────────────────────────┐
│  Top bar:  Project name · Resolution · Duration · Export ▼       │
├──────────┬─────────────────────────────────────────────┬─────────┤
│ Library  │              Preview Stage                  │ Inspect │
│  Chars   │   (canvas, drag/resize, snap, z-order)      │  props  │
│  Moves   │                                             │  for    │
│  BG      │                                             │ select. │
│  Audio   │                                             │ clip    │
│  Blocks  │                                             │         │
├──────────┴─────────────────────────────────────────────┴─────────┤
│  Timeline (multi-track):  [Background] [Char A] [Char B] [Audio] │
│  Drag presets/media onto tracks · trim · split · ripple          │
└──────────────────────────────────────────────────────────────────┘
```

- Click or drag any library item to add it to the stage and a timeline track at the playhead.
- Preview stage matches the project resolution; transport controls (play/pause, scrub, in/out) drive a live GSAP timeline so what you see is what gets rendered.
- Inspector shows position/size/rotation/opacity, in/out time, track, z-index, plus per-clip extras (e.g. character pose, audio for lip sync).

## Character system (puppet rig with optional parts)

Character editor is a dedicated modal opened from the Library. Layered like Toon Boom:

- **Parts (all optional, toggleable):** head base, mouth shapes (rest, A, E, I, O, U, M/B/P, F/V, L), eye states (open / half / closed), body, arm L, arm R, leg L, leg R, plus an unlimited number of named "extra parts."
- **Pose variants:** each part can hold multiple media variants (e.g. body → `idle`, `walking`, `cheering`). Switching a pose at a timeline keyframe is one click.
- **Alignment editor:** every part is placed on a shared character canvas with drag/resize, rotation, anchor point (the pivot used when arms swing or head turns), and explicit z-index. A ghost overlay of neighboring parts stays visible so the user can see proportion. Snap-to-pixel and onion-skin toggle.
- **Save to library:** characters are stored in IndexedDB and reusable across all projects. Duplicate / version / export-as-JSON supported.

## Movement presets (reusable animations)

- Author once in a "Movement editor": pick a target rig (or generic transform), define keyframes (position, rotation, scale, opacity, part swaps, easing) on a mini timeline.
- Save to the Movements library with a name + thumbnail loop.
- Drag onto any character clip on the main timeline to apply; presets retarget by part name so they work on any compatible character.
- Built-in starter presets: walk-cycle, idle-breath, wave, jump, head-turn, enter-from-left, exit-up, talk-gesture.

## Lip sync (phoneme-based, automatic)

1. User drops an audio file on a character clip (or assigns from inspector).
2. Studio runs phoneme analysis in the browser:
  - Decode audio with Web Audio API.
  - Use a WASM phoneme/viseme detector (e.g. a small ONNX model + onnxruntime-web, or formant-based fallback) to produce a viseme timeline mapped to the character's mouth-shape set (rest, A, E, I, O, U, M/B/P, F/V, L).
3. Generated viseme keyframes appear as an editable sub-track under the character clip — user can nudge, delete, or add manually.
4. Auto-blink (random 2–6s intervals) toggle if the character has eye states.
5. On export, viseme keyframes become GSAP `set()` calls on the character's mouth `<img>` swapping `src` at the right times.

## Library tabs

- **Characters** — saved puppet rigs, drag onto stage to add a character clip.
- **Movements** — saved animation presets, drag onto a character clip.
- **Backgrounds** — image/video media, full-stage by default.
- **Audio** — music, SFX, dialogue (dialogue items get a "Use for lip sync on…" action).
- **Blocks** — Hyperframes catalog blocks (titles, lower-thirds, transitions) wrapped as draggable presets.

All library items live in IndexedDB and are project-independent, so they appear in every new project.

## Project & timeline mechanics

- Multi-track timeline with drag-to-trim, split at playhead, ripple delete, snap to playhead/clip edges, zoom.
- Tracks are typed (background, character, audio, overlay) for sensible defaults; z-order on stage is editable per clip.
- Playhead-driven preview drives a real, paused GSAP timeline — same engine Hyperframes uses — so the preview is faithful.
- Project autosaves to IndexedDB. Manual save creates a named snapshot. JSON import/export of the project (without media) for sharing.

## Hyperframes export

"Export" produces a `.zip` containing:

- `meta.json` (name, id, created date)
- `index.html` — root composition with `data-composition-id`, `data-width`, `data-height`, `data-start`, all clips marked `class="clip"` with `data-start / data-duration / data-track-index`, GSAP loaded from CDN, a single paused timeline registered on `window.__timelines[<id>]`.
- `compositions/` — each character instance compiled to a sub-composition loaded via `data-composition-src` (keeps `index.html` clean).
- `assets/` — every image, audio, and video used, with stable filenames.
- `README.md` — one-liner: `cd project && npx hyperframes preview` to inspect, `npx hyperframes render --output output.mp4` to produce MP4.

The output passes Hyperframes' three rules (root data attributes, timed-element attributes, paused timeline registration) by construction.

## Render path (user's own machine)

- Primary: download the `.zip`, unzip, run `npx hyperframes render`. The README and an in-app "How to render" dialog walk through it (Node 22, FFmpeg, one command).
- Optional later: a small companion script (provided) that watches a folder and renders any zip dropped in — documented but not required for v1.

## Out of scope for v1

- Cloud accounts / cross-device sync.
- Server-side MP4 rendering inside Lovable (incompatible with Hyperframes' Node+FFmpeg requirement).
- AI character generation.
- Collaborative multi-user editing.

## Technical notes (for the build)

- TanStack Start front-end only; no Lovable Cloud needed.
- State: Zustand for editor state; Dexie (IndexedDB) for projects, characters, movements; OPFS or Dexie blob storage for media.
- Rendering preview: a layered DOM stage (absolute-positioned `<img>`/`<video>`/`<audio>`) animated by a real GSAP timeline — identical model to Hyperframes runtime.
- Lip sync: Web Audio decode → viseme detector (onnxruntime-web with a small viseme model; amplitude fallback if model fails to load) → keyframe list.
- Export: JSZip in-browser to assemble the project; deterministic filename hashing for assets.
- Character editor: HTML canvas + DOM handles for transform/anchor; per-part z-index slider; onion-skin via reduced opacity.
- All Hyperframes-specific patterns (required `class="clip"`, GSAP `{paused: true}`, `window.__timelines` registration, `data-composition-src`) are encoded in the exporter.

## Build phases

1. Studio shell: layout, project model, IndexedDB persistence, stage + timeline with simple media (image/audio/video).
2. Hyperframes exporter (zip with valid `index.html`, GSAP timeline, assets) — verify output renders via `npx hyperframes render`.
3. Character editor (parts, alignment, z-index, anchor, pose variants, optional parts) + Characters library. There should be very clear defined size alignment etc on character parts so its easy to change and swap out.
4. Movement preset editor + library + retargeting onto characters.
5. Lip sync: audio assignment, phoneme analysis, editable viseme sub-track, auto-blink.
6. Polish: snapping, split/trim, blocks tab with a few catalog presets, in-app render guide.