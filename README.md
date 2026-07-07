# Studio Boom

Studio Boom is a local-first visual studio for making animated, HTML-based videos with
HyperFrames.

The goal is simple: let a human build a movie visually while keeping the movie source
as canonical, render-ready HyperFrames project source the whole time. You can upload
media, build rigged characters, add text and custom HyperFrames blocks, generate or
import character speech, edit clips on a timeline, preview the real project, and
render an MP4.

The core rule:

```text
One canonical project source drives editing, stage preview, playback, and MP4 export.

project.hf.rootHtml
project.hf.compositionHtml
project.hf.assets
```

The product rule:

```text
Wrap and extend HyperFrames Studio primitives.
Do not recreate working HyperFrames editor mechanics inside Studio Boom.
```

Studio Boom does not wait until export to convert React state into a video. The
project you edit is already the renderable movie document:

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
- Projects, media, characters, action/expression presets, pinned voices, and generated/imported
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
- Layered character builder with parts, variants, eyes, brows, mouth shapes,
  parallax, auto-blink, and motion behavior metadata.
- Guided character assembly: one Parts rail (layer list with a per-part "+" to
  add variant artwork, and a single add-part menu), imports that auto-place —
  new variants size and center onto the slot's existing art, first art lands in
  its body region — plus per-slot missing-shape upload chips (visemes, eye
  states), sibling-variant ghosts with one-click art alignment,
  mirror-to-other-side for sided slots, and the same react-moveable selection
  box as the stage for moving, resizing, and rotating parts.
- Pixi-backed character rendering inside generated HyperFrames character
  sub-compositions. Preview and MP4 export use the same stored character source.
- The Action/Expression recorder playback pane uses the same Pixi scene/timeline
  payload as generated character composition HTML, mounted in a persistent Pixi app.
- The character editor canvas renders character artwork through the shared Pixi
  scene/timeline payload; DOM/React remains editor chrome for selection frames,
  handles, anchors, reach tools, thumbnails, and form controls.
- Export-parity regression coverage for Pixi character source, local Pixi runtime
  packaging, image/SVG asset refs, and the current mesh-free default render path.
- Character Actions and Expressions:
  - reusable body actions, facial expressions, head turns, and camera cues
  - separate timeline subtracks for Actions, Expressions, and Voice/lip sync
  - per-clip scope controls such as full body, upper body, lower body, face, and head
- Stage motion checkpoints/steps for moving objects around the canvas.
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
- Flexible limb meshes are available as an opt-in per-slot character setting and
  are covered by preview/export parity tests. New flexible parts use a
  point-path Pixi `MeshRope` model; current Pixi character parts still render as
  sprites or vector nodes by default, and richer drag-handle authoring remains
  in progress.
- Pixi-native character authoring commands are still in progress. The editor
  artwork is Pixi-rendered, and slot move/scale/rotate, variant pin edits, bone
  rest edits, slot depth, host constraints, reach constraints, and Flexible
  deform edits now go through a renderer-neutral scene command boundary.
- Local backup/restore for the IndexedDB database still needs a product flow.
- There is no hosted backend, team sync, or cloud account.

## Quick Start

Requirements:

- Node.js 22.22.2
- npm 10.9.7
- A modern desktop browser with IndexedDB support

```bash
nvm use
npm ci
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

Characters are layered rigs stored as HyperFrames composition clips. A root
timeline character clip points to one character sub-composition in
`project.hf.compositionHtml`.

The current validated character render path is Pixi inside that generated
HyperFrames sub-composition. The rig vocabulary stays renderer-neutral:
bones, sockets/pins, slots, variants, poses, Actions, Expressions, and speech
describe character intent. Pixi is the renderer for that intent, not a second
movie model.

A character can include:

- Body, head, hair, accessory, limb, hand, foot, and custom parts.
- Eye and eyebrow variants, including auto-blink support.
- Mouth image variants mapped to visemes.
- Mouth image or SVG variants mapped to visemes. Legacy generated mouth rigs are
  load-only compatibility and no longer render.
- Per-part transforms, pivots, alpha bounds, depth, and motion behavior.
- Head-direction variants for head turns.
- Parallax settings.
- Action and expression presets, with optional per-clip body-region scope.
- Stage motion steps/checkpoints for moving the character clip itself through the scene.
- One or more placed speech clips.

The old static bake pipeline has been removed. Character tools now author native
HyperFrames sub-composition source directly.

Pixi is the only character renderer; the legacy DOM puppet renderer was removed.
New character rendering work targets the renderer-neutral character scene graph
and Pixi composition builder while preserving the same `project.hf`
source-parity rule. Characters that still reference the retired generated mouth
rig build without that mouth until they get mouth image or SVG parts.

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
  action/expression presets
  pinned ElevenLabs voices

Zustand
  loaded project
  selection
  undo/redo
  editor UI state
  hydrated media/character/action preset maps
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

### Reuse-First Audit Rule

Studio Boom should stay HyperFrames-first by using existing HyperFrames packages for
generic editor mechanics whenever they are solid and exposed. Before adding or
deepening timeline, preview, source-editing, property-panel, file-tree, nested
composition, or playback behavior, audit whether `@hyperframes/studio`,
`@hyperframes/core`, `@hyperframes/player`, the HyperFrames CLI, or registry tools
already provide the primitive.

Studio Boom should own the local-first product layer around those primitives:
dashboard/project library, IndexedDB persistence, media blob management, character
rigging, speech/lip-sync workflows, project import/export UX, creator-friendly
starters, and higher-level beat/scene workflows.

Custom Studio Boom editor code is justified when HyperFrames does not expose the
behavior, when local-first persistence requires app-specific plumbing, or when the
feature belongs to Studio Boom's creative workflow rather than generic HyperFrames
editing.

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

Use the pinned toolchain:

```bash
nvm use           # reads .nvmrc (22.22.2)
npm ci            # reproducible install from package-lock.json
```

`package.json` declares `packageManager: npm@10.9.7`, exact Node/npm engines, and
`.npmrc` enables `engine-strict=true` so mismatched versions fail early.

## Technical Stack

- React 19 - editing UI
- Vite - dev server, build, and local API middleware
- Zustand - in-memory editor state
- Dexie / IndexedDB - local persistence
- `@hyperframes/core` - HyperFrames HTML model and mutation helpers
- `@hyperframes/studio` - timeline player hooks and controls
- `@hyperframes/player` - Stage preview web component
- HyperFrames CLI - MP4 rendering
- PixiJS - current character renderer inside HyperFrames sub-compositions
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
