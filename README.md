# Studio Boom

Studio Boom is a browser-based visual editor for building animated, HTML-first videos
with HyperFrames.

In plain language: it is a studio where you can upload media, build layered
puppet-style characters, place them on a timeline, add motion and voice lines, and
export the result as a self-contained HyperFrames project.

The guiding principle:

> Studio Boom should not export to HyperFrames. Studio Boom should author HyperFrames.

That means the project you are editing in the studio is already a HyperFrames project.
The stage preview reads the same HTML the export will write. There is no hidden
conversion at the end.

---

## Current Status

Studio Boom is a work in progress. The core editing loop is functional, but some
areas are still being shaped.

**What works:**

- Browser-based studio with stage, timeline, library, and inspector.
- Local projects saved in the browser (IndexedDB).
- Uploading image, audio, and video assets.
- Building reusable layered characters from image parts.
- Adding characters and media to the timeline.
- Applying motion presets: expressions, gestures, head turns, camera moves.
- Generating ElevenLabs voice lines and lip-sync timing.
- Stage preview via the local `<hyperframes-player srcdoc>` adapter — the same
  HTML that export will produce, previewed directly in the browser.
- Playback controls (play, pause, seek) wired through `useTimelinePlayer`.
- HyperFrames ZIP export.

**Still being shaped:**

- Character compositions are being refactored away from a static baking step toward
  native HyperFrames compositions. The character builder works, but the internal
  representation is in transition.
- In-app MP4 rendering is not a priority yet. It will come after the character
  model is stable.
- Local backup and restore for the browser database still needs work.
- There is no cloud account, team sync, or hosted backend.

---

## Why HyperFrames?

HyperFrames treats HTML, CSS, media, and GSAP animation timelines as video source
material. That fits Studio Boom well: a visual editor produces the same HTML a
developer or AI agent would write by hand.

Every clip, character composition, and audio track is stored as an HTML string.
The stage preview loads that HTML directly. Export writes it to a ZIP. Nothing is
converted at export time — the project already is the output.

---

## Architecture

```
Dexie (browser storage)
  rootHtml                   ← the film: a HyperFrames composition HTML string
  compositionHtml            ← sub-compositions (characters) keyed by id
  assets[]                   ← { id, type } registry for blob lookup
  media blobs                ← binary assets (images, audio, video)
  characters / presets       ← authoring data for the character builder

Zustand (in-memory editor state)
  project                    ← loaded from Dexie, mutated in place
  selectedClipId, zoom       ← UI-only state

@hyperframes/studio (playback and interaction)
  useTimelinePlayer()        ← bridges iframeRef to playback state
  PlayerControls             ← play / pause / seek bar
  useElementPicker()         ← click-to-select inside the player iframe

@hyperframes/player (preview iframe)
  <hyperframes-player srcdoc> ← isolated Stage adapter for generated HTML preview

@hyperframes/core (data and HTML)
  generateHyperframesHtml()  ← creates a new composition with GSAP wired up
  addElementToHtml()         ← adds a clip element to rootHtml
  updateElementInHtml()      ← patches a clip element in rootHtml
  removeElementFromHtml()    ← removes a clip element from rootHtml
  parseHtml()                ← reads elements back from rootHtml
```

### Edit flow

```
User action (add clip, drag, resize, change timing)
  → @hyperframes/core HTML mutation → updated rootHtml
  → store saves rootHtml to Dexie (debounced)
  → Stage resolves editor-only asset placeholders → player iframe re-renders
```

For live drag preview (no reload), the `PlayerAPI` on
`iframeRef.current.contentWindow.__player` provides `previewElementPosition` and
similar methods that update the player without reloading the HTML.

### Stage

The Stage component resolves `asset:ID` placeholders to Dexie blob URLs and passes
the resulting complete HTML to `<hyperframes-player srcdoc>`. It bridges the
player's inner iframe with `@hyperframes/studio`'s `resolveIframe`, so the single
`useTimelinePlayer` instance and `useElementPicker` still drive the real
HyperFrames iframe. There are no React overlay divs drawing copies of what the
player already renders.

Shader transition support is intentionally not configured in the Studio Boom
stage yet. Standard HyperFrames playback, GSAP animation, media, and non-shader
transitions remain supported. Add shader-specific player attributes only when
shader transitions are introduced with a dedicated test composition.

---

## Quick Start

**Requirements:** Node.js 22+, npm, a modern desktop browser with IndexedDB support.

```bash
npm install
npm run dev
```

Open the URL printed in the terminal.

---

## Development Scripts

```bash
npm run dev       # Start local dev server
npm run build     # Build production bundle
npm run preview   # Preview production build
npm run test      # Run Vitest tests
npm run test:ui   # Vitest UI
npm run lint      # ESLint
npm run format    # Prettier
```

---

## Basic Workflow

1. `npm run dev` → open the local URL.
2. Use the Library panel to upload media or build a character.
3. Drag media or characters onto the timeline.
4. Select a clip on the stage or timeline.
5. Use the Inspector to adjust timing, position, size, opacity, motion, or lip sync.
6. Use Save to checkpoint locally.

---

## Characters

Characters are layered image rigs. Upload parts (head, body, eyes, eyebrows, mouth
shapes, limbs) and arrange them in the character builder. Once saved, the character
behaves as a single clip on the main timeline.

A character can include:

- Body and head layers.
- Eye and eyebrow variants (with auto-blink support).
- Mouth shapes for lip sync visemes.
- Optional limbs and accessories.
- A transform-based mouth rig for procedural mouth movement.

The character pipeline is being refactored. The builder and parts work; the internal
representation is in transition from a static bake step to native HyperFrames
composition authoring.

---

## Motion Presets

Motion presets are reusable movements — expressions, gestures, full-body animations,
head turns, and camera moves. Select a character clip, open motion controls, pick a
preset, and set the offset, duration, and intensity.

---

## Voice and Lip Sync

Voice generation uses ElevenLabs. Create a local `.env` file:

```bash
ELEVENLABS_API_KEY=your_api_key_here
```

Do not commit `.env`. The rest of the app works without a key; voice generation will
fail silently if the key is missing.

---

## Local Storage

Studio Boom is local-first. All data lives in browser IndexedDB.

- Your work is tied to the browser profile and local URL you used.
- Clearing site data deletes projects and media.
- There is no complete backup/restore workflow yet. Keep copies of source assets
  for anything irreplaceable.

---

## Technical Stack

- React — editing UI
- Vite — dev server and build
- Zustand — in-memory editor state
- Dexie / IndexedDB — browser persistence
- `@hyperframes/core` — HTML data model and mutation APIs
- `@hyperframes/studio` — PlayerControls, useTimelinePlayer, usePlayerStore, useElementPicker
- `@hyperframes/player` — isolated Stage preview web component
- GSAP — animation (embedded in composition HTML via @hyperframes/core)
- JSZip — export ZIP assembly
- Tailwind CSS — styling

---

## Troubleshooting

**Old work is gone after opening the app.**
Studio Boom stores data in browser IndexedDB. Check you are using the same browser,
profile, and local URL. Clearing site data removes local work.

**Voice generation fails.**
Confirm `ELEVENLABS_API_KEY` is set in `.env` and restart the dev server.

**Play button is greyed out.**
The playback controls require the composition HTML to include a GSAP timeline
(`window.__timelines`). This is produced automatically by `generateHyperframesHtml`.
If a project was created before this was wired up, create a new project.

**Stage preview and export look different.**
Both should read the same `rootHtml`. If they diverge, it is a bug — please open an
issue.
