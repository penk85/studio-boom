# Studio Boom

Studio Boom is a local-first visual studio for making animated, HTML-based videos with
HyperFrames.

The goal is simple: let a human build a movie visually while keeping the movie source
as real HyperFrames HTML the whole time. You can upload media, build puppet-style
characters, add text and custom HyperFrames blocks, generate or import character
speech, edit clips on a timeline, preview the real project, and render an MP4.

The core rule:

```text
React is for editing the movie.
HyperFrames is the movie.
```

Studio Boom does not wait until export to convert React state into a video. The
project you edit is already a HyperFrames project:

```text
project.hf.rootHtml
project.hf.compositionHtml
project.hf.assets
```

The Stage preview and MP4 render both consume that same source.

## Current Status

Studio Boom is under active development, but the main editing loop is usable.

Working now:

- Local browser studio with Library, Stage, Timeline, Inspector, and playback controls.
- Projects, media, characters, motion presets, pinned voices, and generated/imported
  speech audio saved in IndexedDB.
- Image, audio, and video asset upload.
- First-class media clips, text clips, character composition clips, and custom
  HyperFrames composition blocks.
- Text presets for titles, captions, and lower thirds, with text styling in the Inspector.
- Paste/import of custom HyperFrames composition blocks through Library -> Blocks,
  with validation, sandbox preview, and repair-prompt copying.
- Source inspection for selected composition clips and primitive root elements.
- Stage selection, drag, resize, rotate, layer ordering, and keyboard nudging on the
  real HyperFrames iframe element.
- Undo/redo for project edits.
- Layered puppet character builder with parts, variants, eyes, brows, mouth shapes,
  generated mouth rigs, parallax, auto-blink, and motion behavior metadata.
- Character motion presets and clip motion checkpoints/steps.
- Speech tab for character clips:
  - lists ElevenLabs account voices by name
  - lets you pin voices for reuse
  - generates speech with timestamps
  - imports/drops audio files
  - saves generated and imported speech audio into the studio library
  - aligns uploaded audio from a transcript
  - lets one character clip hold multiple placed speech clips
- Character speech audio is serialized inside the character sub-composition as
  HyperFrames `<audio>` clips, not as separate root timeline siblings.
- MP4 download through the HyperFrames CLI render path.

Still in progress:

- The UI around custom blocks and source editing is intentionally minimal.
- Nested composition timeline editing is not built yet.
- Crop, mirror, richer keyframe editing, and shader transition support are deferred.
- Local backup/restore for the IndexedDB database still needs a product flow.
- There is no hosted backend, team sync, or cloud account.

## Quick Start

Requirements:

- Node.js 22+
- npm
- A modern desktop browser with IndexedDB support

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

## ElevenLabs Setup

Speech generation and forced alignment use ElevenLabs through the local Vite server.
Create a local `.env` file:

```bash
ELEVENLABS_API_KEY=your_api_key_here
```

Keep `.env` out of git. It is already ignored by `.gitignore`.

The key is read server-side by Vite middleware and is not bundled into the browser
client. After changing `.env`, restart `npm run dev`.

Without a key, the rest of Studio Boom still works. Voice listing, text-to-speech,
and forced alignment will show an error until the key is configured.

## Basic Workflow

1. Start the dev server with `npm run dev`.
2. Use Library -> Media to upload video, image, or audio assets.
3. Use Library -> Text to add a title, caption, or lower third.
4. Use Library -> Characters to create or add a character.
5. Use Library -> Blocks to paste a custom HyperFrames composition, validate it,
   preview it, and add it as one timeline clip.
6. Select clips on the Stage or Timeline.
7. Move, resize, rotate, trim, layer, and inspect clips.
8. For character speech, select a character clip and open Inspector -> Speech.
9. Use Save to checkpoint locally.
10. Use the render/download flow to export an MP4.

## Characters

Characters are layered image rigs stored as HyperFrames composition clips. A root
timeline character clip points to one character sub-composition in
`project.hf.compositionHtml`.

A character can include:

- Body, head, hair, accessory, limb, hand, foot, and custom parts.
- Eye and eyebrow variants, including auto-blink support.
- Mouth image variants mapped to visemes.
- A generated SVG mouth rig when no custom mouth shapes exist.
- Per-part transforms, pivots, alpha bounds, depth, and motion behavior.
- Head-direction variants for head turns.
- Parallax settings.
- Motion presets and clip-level motion steps/checkpoints.
- One or more placed speech clips.

The old static bake pipeline has been removed. Character tools now author native
HyperFrames sub-composition source directly.

## Speech And Lip Sync

Character speech lives in the Inspector -> Speech tab.

You can create speech in three ways:

- Generate a new voice line with ElevenLabs text-to-speech.
- Upload or drop an audio file, optionally with a transcript.
- Add an existing audio item from the voice library to the selected character.

Generated and uploaded speech audio is saved as normal audio media in the studio
library. Lip-sync timing is stored on the audio asset as viseme keys, so the same
voice can be reused without regenerating timing.

If an uploaded audio file does not have timing yet, select it under "Voices on this
character", paste the transcript, and choose "Generate lip sync". Studio Boom sends
the audio and transcript to ElevenLabs forced alignment, then rebuilds the character
sub-composition with timed visemes.

Multiple speech clips can be attached to a single character clip. Each speech entry
has its own start time and appears as internal character audio when previewing or
rendering.

Pinned voices are only saved voice IDs and names for convenience. They are separate
from generated/imported speech audio files.

## Text And Custom Blocks

Text clips are first-class HyperFrames text elements. Add them from Library -> Text,
then edit copy, color, font size, font weight, alignment, and related clip controls in
the Inspector.

Custom blocks are self-contained HyperFrames compositions. Use Library -> Blocks to
paste HTML, validate it, preview it, and add it to the timeline. Studio Boom stores
the block in `project.hf.compositionHtml` and hosts it with one root composition clip.

For selected composition clips, the Inspector exposes a Source panel. Source edits
must validate and preview before they update `project.hf.compositionHtml`.

## Architecture

Studio Boom keeps two kinds of state:

```text
Dexie / IndexedDB
  projects
  media metadata and blobs
  characters
  motion presets
  pinned ElevenLabs voices

Zustand
  loaded project
  selection
  undo/redo
  editor UI state
  hydrated media/character/preset maps
```

The durable movie source lives on the project:

```text
project.hf.rootHtml          -> index.html
project.hf.compositionHtml   -> compositions/<id>.html
project.hf.assets            -> asset manifest used to stage blobs for render
project.editorMeta           -> editor-only intent and timeline organization
```

Edit flow:

```text
User edits in React
  -> Studio actions mutate real HyperFrames HTML through boundary helpers
  -> project.hf is saved to IndexedDB
  -> Stage resolves asset:<id> placeholders for browser preview
  -> Render stages the same project.hf files for hyperframes render
```

React may draw editor chrome such as outlines, handles, and controls. It must not draw
a second copy of the movie. Stage edits preview against the real player iframe element
and commit back into canonical HTML.

## Development Scripts

```bash
npm run dev       # Start local Vite dev server
npm run build     # Build production bundle
npm run preview   # Preview production build
npm run test      # Run Vitest tests
npm run test:ui   # Vitest UI
npm run lint      # ESLint
npm run format    # Prettier
```

## Technical Stack

- React 19 - editing UI
- Vite - dev server, build, and local API middleware
- Zustand - in-memory editor state
- Dexie / IndexedDB - local persistence
- `@hyperframes/core` - HyperFrames HTML model and mutation helpers
- `@hyperframes/studio` - timeline player hooks and controls
- `@hyperframes/player` - Stage preview web component
- HyperFrames CLI - MP4 rendering
- GSAP - animation timelines inside composition HTML
- Tailwind CSS - styling
- ElevenLabs - optional speech generation and forced alignment

## Local Storage

Studio Boom is local-first:

- Work is tied to the browser profile and local URL.
- Clearing site data deletes projects and media.
- Generated/imported speech audio is stored locally like other media.
- There is no complete backup/restore workflow yet, so keep copies of important
  source assets.

## Troubleshooting

**Old work is gone after opening the app.**

Check that you are using the same browser, browser profile, and local URL. Studio
Boom stores data in IndexedDB, and clearing site data removes it.

**Voice generation or lip sync says the API key is not configured.**

Confirm `.env` contains `ELEVENLABS_API_KEY=...` and restart `npm run dev`. Do not
use a `VITE_` prefix for this key.

**Generated/uploaded audio plays, but the mouth does not move.**

The audio is attached, but it does not have viseme timing yet. In Inspector -> Speech,
select the voice, paste the transcript, and click "Generate lip sync".

**Play button is greyed out.**

The playback controls require valid HyperFrames composition HTML with
`window.__timelines`. New projects and validated blocks should include this
automatically.

**Stage preview and MP4 render look different.**

Both paths should read the same `project.hf` source. If they diverge, treat it as a
bug in the Studio boundary layer.
