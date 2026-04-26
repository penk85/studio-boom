# Studio Boom

Studio Boom is a browser-based video editor for building animated, HTML-first scenes.
The long-term goal is a friendly visual wrapper around Hyperframes-style HTML video
generation: users compose scenes visually, while the project data remains structured
enough that an AI system can eventually generate full timelines, characters, actions,
and exportable HTML movies.

The current app is a work in progress. The strongest area today is the local-first
studio shell and character builder. Export is intentionally still disabled while the
editing model is being shaped.

## What The App Does Today

- Build projects on a 1920x1080 timeline with background, character, overlay, and audio tracks.
- Upload regular media assets into the user-facing media library.
- Create reusable layered characters from uploaded image parts.
- Treat a saved character as one object on the canvas and timeline.
- Keep internal character-part images out of the normal media gallery.
- Apply reusable action presets such as expressions, gestures, head turns, full-body moves, and camera moves.
- Generate ElevenLabs voice lines and character-level lip sync when an API key is configured.
- Save projects, media, characters, and presets locally in browser IndexedDB.
- Seed a built-in starter character and starter action presets on first use.

## What Is Not Done Yet

- Hyperframes/HTML export is not implemented yet.
- Project data is local to the current browser profile; there is no cloud account or backend sync.
- Character preset authoring exists, but the UX is still early.
- AI timeline generation is a future goal, not current functionality.
- Asset backup/import/export is not yet available, so clearing browser site data can remove local work.

## Quick Start

### Requirements

- Node.js 20 or newer.
- npm.
- A modern desktop browser with IndexedDB support.

### Install

```bash
npm install
```

### Run Locally

```bash
npm run dev
```

The terminal will print the local URL. In this workspace it usually runs at:

```text
http://localhost:8080/
```

### Build

```bash
npm run build
```

### Preview A Production Build

```bash
npm run preview
```

### Lint And Format

```bash
npm run lint
npm run format
```

## Optional ElevenLabs Setup

Voice generation and lip sync require an ElevenLabs API key.

Create a local environment file:

```bash
touch .env
```

Add:

```env
ELEVENLABS_API_KEY=your_api_key_here
```

Do not commit `.env`. The server function reads this key from `process.env`.

If the key is missing, the app still works, but the Voice & Lip Sync panel will fail
when trying to generate speech.

## Basic Studio Workflow

1. Start the dev server with `npm run dev`.
2. Open the studio in your browser.
3. Use the left Library panel to upload media, create characters, or browse actions.
4. Add media or characters to the timeline.
5. Select a clip on the stage or timeline.
6. Use the right Inspector panel to edit position, size, timing, opacity, z-index, actions, and lip sync.
7. Use Save in the top bar to persist the project locally.

The app also autosaves many edits after a short delay, but the Save button is useful
when you want a clear checkpoint.

## Character Builder Workflow

Characters are layered image rigs. The user uploads parts such as head, body, eyes,
brows, and mouth shapes. Once saved, the character behaves as one clip in the main
studio.

### Create Or Edit A Character

1. Open the Characters tab in the Library.
2. Click `+ New character`, or choose `Edit` on an existing character.
3. Use the `Has parts` checklist to decide which body-part groups this character uses.
4. Upload part images into the relevant categories.
5. Align, resize, rotate, hide, or layer parts in the character canvas.
6. Click `Save & close` when the rig is ready.
7. Back in the studio, click `Add to scene` to place the character on the timeline.

### Body Part Categories

- Head: main head image plus directional head variants.
- Body: torso/body image plus directional body variants.
- Face: eyes, individual left/right eyes, brows, individual left/right brows, and mouth shapes.
- Limbs: left arm, right arm, left leg, right leg.
- Extras: optional decorative or custom layers.

### Variants And Slots

Each animatable layer has a stable `slotId`. Variants of the same body part share a
slot, which lets actions target the same logical layer even when the visible image
changes.

Examples:

- A mouth slot can have `rest`, `A`, `E`, `I`, `O`, `U`, `MBP`, `FV`, and `L` shapes.
- An eye slot can have `open`, `half`, `closed`, and `wink` states.
- A head slot can have `front`, `3qL`, `3qR`, `sideL`, and `sideR` images.
- A body slot can also use matching directional variants for head-turn workflows.

Only one variant per slot should be visible in normal stage playback.

### Image Placement Rules

When an image is imported into the character builder:

- If it is larger than the character canvas, it is scaled down to fit.
- It is centered on the character canvas.
- Smaller images are not scaled up automatically.

This keeps large uploads manageable without destroying intentionally small parts like
eyes or mouth shapes.

### Editing Parts

Only the selected part is editable on the character canvas. The active part stays
selected while you interact with the canvas, and the editor shows an active-layer
label so it is clear which body part is being edited.

For the selected part, you can edit:

- Position.
- Width and height.
- Rotation.
- Opacity.
- Visibility.
- Anchor point.
- Z-index.
- Parallax depth.

Z-index controls visual stacking. For example, a body image can include extra neck
space for motion leeway while still staying behind the head.

## Action Presets

Action presets are reusable expressions and movements. They can target body-part
roles, exact slots, or the camera.

Built-in examples include:

- Surprised.
- Happy.
- Sad.
- Angry.
- Blink.
- Wave.
- Nod.
- Shake head.
- Idle bob.
- Jump.
- Look left.
- Look right.
- Slow zoom in.
- Camera shake.

To apply an action:

1. Add a character to the scene.
2. Select the character clip.
3. Open the Actions section in the Inspector.
4. Click `+ Apply`.
5. Choose a preset.
6. Adjust offset, duration, and intensity.

Offset is when the action starts inside the character clip. Duration controls how
long it lasts.

## Lip Sync

Lip sync is based on mouth visemes. The current expected mouth shapes are:

```text
rest, A, E, I, O, U, MBP, FV, L
```

To generate speech and lip sync:

1. Configure `ELEVENLABS_API_KEY`.
2. Add a character clip to the scene.
3. Select the character clip.
4. Open Voice & Lip Sync in the Inspector.
5. Confirm the character has the needed mouth shapes.
6. Type the line.
7. Choose a voice and model.
8. Click `Generate voice + lip sync`.

The generated audio is added to the timeline and stored as internal generated media.
It is hidden from the normal media gallery so the gallery stays focused on reusable
user assets.

## Local Persistence

The app stores working data in IndexedDB using Dexie.

Stored locally:

- Projects.
- Characters.
- Action presets.
- Media metadata.
- Media blobs.

Important details:

- Data is stored in the browser, not in Git.
- Data is not currently synced to a server.
- Clearing site data can delete projects and uploaded media.
- Using a different browser or browser profile will have a different local database.
- A backup/export feature should be added before relying on the app for production work.

## Project Architecture

Key directories:

- `src/routes`: TanStack Router routes.
- `src/studio/Studio.tsx`: Main three-pane studio shell.
- `src/studio/components`: Library, stage, inspector, timeline, actions, and lip sync UI.
- `src/studio/character`: Character builder, character utilities, starter character seed, and parallax helpers.
- `src/studio/presets`: Built-in action presets, preset application, and preset recorder.
- `src/studio/lipsync`: ElevenLabs integration, voice options, and viseme mapping.
- `src/studio/db.ts`: Dexie database, media import, blob URL helpers, and migrations.
- `src/studio/store.ts`: Zustand editor state for the current project, selection, transport, and clip operations.
- `src/studio/types.ts`: Core project, media, character, clip, and action data models.
- `src/components/ui`: Generated UI primitives.

## Core Data Model

The most important entities are:

- `Project`: Timeline document with dimensions, FPS, duration, tracks, clips, and optional camera data.
- `Track`: Timeline row such as background, character, overlay, or audio.
- `MediaAsset`: Uploaded or generated image, audio, or video metadata.
- `MediaBlobRow`: Actual binary Blob for a media asset.
- `CharacterPreset`: Reusable character rig with canvas size, parts, manifest, parallax config, and variants.
- `CharacterPart`: One layered image part inside a character rig.
- `ActionPreset`: Reusable expression, gesture, full-body motion, head turn, or camera move.
- `CharacterClip`: A timeline clip pointing to a saved character, with applied actions and optional lip sync.
- `MediaClip`: A timeline clip pointing to an image, audio, or video asset.

## HTML And Hyperframes Direction

The intended export model is HTML-first:

1. The editor stores structured project data.
2. Characters are layered DOM/image elements with transforms.
3. Actions become time-based transform and visibility changes.
4. Lip sync becomes timed mouth-shape swaps.
5. Export should serialize the full project into Hyperframes-compatible HTML, CSS, JS, and assets.

That future export should make it possible for an AI system to generate a full movie
by producing project data or HTML that follows the app's supported presets and
timeline schema.

## Development Scripts

```bash
npm run dev       # Start local dev server
npm run build     # Build production bundle
npm run build:dev # Build in development mode
npm run preview   # Preview production build
npm run lint      # Run ESLint
npm run format    # Format the repo with Prettier
```

## Deployment Notes

The project includes Cloudflare-oriented config through `wrangler.jsonc` and the
Lovable TanStack/Vite config wrapper. Deployment should be revisited after export,
backup, and environment variable handling are finalized.

## Recommended Next Milestones

1. Add project backup/import/export for IndexedDB data.
2. Define the final Hyperframes export schema.
3. Implement export to standalone HTML plus asset bundle.
4. Improve the preset recorder into a polished expression and movement designer.
5. Add a stronger character preview thumbnail and character library management.
6. Add AI-facing schema documentation so generated movies can populate timelines safely.
7. Add automated tests around character slot normalization, action application, and lip sync viseme mapping.

## Troubleshooting

### The app opens but my old work is gone

The app stores data in browser IndexedDB. Check that you are using the same browser,
same profile, and same local URL. Clearing site data can remove projects and media.

### Voice generation fails

Confirm `ELEVENLABS_API_KEY` is configured in `.env`, then restart the dev server.

### Uploaded character parts show in the wrong place

Large images are automatically scaled down and centered. Smaller images keep their
original size. Select the active part in the character editor and adjust its transform
from the canvas or right-side inspector.

### Character mouth does not animate

Check that the character has mouth parts for the expected visemes:

```text
rest, A, E, I, O, U, MBP, FV, L
```

The Voice & Lip Sync panel highlights which shapes are available or missing.
