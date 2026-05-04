# Studio Boom

Studio Boom is a visual movie-building tool for making animated, HTML-first videos.

In plain language: it is a browser studio where you can add media, build simple
puppet-style characters, place them on a timeline, give them motion, add voice lines,
and export the result as a HyperFrames project.

The larger goal is simple:

> Studio Boom should let people author HyperFrames visually.

That means the app should not become a separate video editor that later converts its
own private format into HyperFrames. The visual editor should work with a project
model that maps clearly to HyperFrames concepts: clips, assets, compositions, HTML
elements, timing attributes, styles, and GSAP timelines.

## Current Status

Studio Boom is a work in progress. It is useful for exploring the editor, character
builder, motion presets, local media storage, and HyperFrames export direction, but
it should not yet be treated as a finished production tool.

What works today:

- A browser-based studio with a stage, timeline, media library, and inspector.
- Local projects saved in the browser.
- Uploading image, audio, and video assets.
- Building reusable layered characters from image parts.
- Adding characters and media to a timeline.
- Applying motion presets such as expressions, gestures, head turns, and camera moves.
- Generating ElevenLabs voice lines and lip-sync timing when an API key is configured.
- Exporting a HyperFrames ZIP package from the app.

What is still being shaped:

- The internal project model is being corrected so HyperFrames is the authored model,
  not just the final export target.
- In-app MP4 rendering is not the main priority yet. Rendering should come after the
  project model is properly HyperFrames-native.
- Local backup/import/export for the browser database still needs work.
- There is no cloud account, team sync, or hosted backend.

## Why HyperFrames?

HyperFrames treats HTML, CSS, media files, and animation timelines as video source
material. That is a good fit for Studio Boom because a visual editor can create the
same pieces a developer or AI agent would write by hand:

- HTML elements for clips and character parts.
- `data-start`, `data-duration`, and `data-track-index` timing attributes.
- CSS styles for position, size, opacity, and layering.
- GSAP timelines for motion and lip sync.
- Asset folders for images, audio, and video.

The intended architecture is:

```text
Studio Boom visual editor
  edits
HyperFrames-native project model
  serializes to
index.html + compositions/ + assets/
  renders with
HyperFrames CLI
```

So the guiding rule is:

```text
Studio Boom should not export to HyperFrames.
Studio Boom should author HyperFrames.
```

## Who This Is For

Studio Boom is meant for people who want to build animated videos without writing
HTML or animation code directly, while still producing a project that developers and
AI tools can understand.

It is especially aimed at:

- Creators who want a drag-and-drop scene builder.
- Teams experimenting with HTML-first video workflows.
- Developers building tools around HyperFrames.
- AI-assisted video workflows where structured project data matters.

## Quick Start

### Requirements

- Node.js 22 is recommended.
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

The terminal will print a local URL. Open that URL in your browser.

### Build

```bash
npm run build
```

### Preview A Production Build

```bash
npm run preview
```

### Tests And Formatting

```bash
npm run test
npm run lint
npm run format
```

## Basic Workflow

1. Start the app with `npm run dev`.
2. Open the local URL in your browser.
3. Use the Library panel to upload media or create a character.
4. Add media or characters to the timeline.
5. Select a clip on the stage or timeline.
6. Use the Inspector to change timing, position, size, opacity, layering, motion, or lip sync.
7. Use Save to store the project locally in your browser.
8. Use Export HyperFrames to create a HyperFrames ZIP package.

The app autosaves many edits, but Save is still useful as a clear checkpoint.

## Characters

Characters are layered image rigs. You can upload parts such as a head, body, eyes,
eyebrows, arms, legs, and mouth shapes. Once saved, the character behaves like one
clip on the main timeline.

A character can include:

- Body and head layers.
- Eye and eyebrow variants.
- Mouth shapes for lip sync.
- Optional limbs and accessories.
- A transform-based mouth rig for generated mouth movement.
- Motion settings such as parallax depth and anchor points.

The character builder keeps internal character-part images out of the normal media
gallery so the library stays focused on reusable user assets.

## Motion Presets

Motion presets are reusable movements. A preset can describe an expression, gesture,
full-body movement, head turn, or camera move.

Examples include:

- Blink.
- Happy or surprised expression.
- Nod.
- Wave.
- Idle bob.
- Jump.
- Look left or right.
- Slow zoom.
- Camera shake.

To apply one, select a character clip, open the motion controls, choose a preset, and
adjust when it starts, how long it lasts, and how strong it should be.

## Voice And Lip Sync

Voice generation uses ElevenLabs. Lip sync turns speech timing into mouth shapes.

To use it, create a local `.env` file:

```bash
touch .env
```

Add:

```env
ELEVENLABS_API_KEY=your_api_key_here
```

Do not commit `.env`.

If the key is missing, the rest of the app still works, but voice generation will fail.

## Local Storage

Studio Boom is local-first. It stores data in your browser using IndexedDB.

Stored locally:

- Projects.
- Uploaded media.
- Media blobs.
- Characters.
- Motion presets.
- Generated voice audio.

Important:

- Your work is stored in the browser profile you used.
- A different browser, profile, or local URL may show a different database.
- Clearing site data can delete projects and media.
- There is not yet a complete backup/restore workflow, so do not rely on the app for
  irreplaceable work without keeping your own copies of source assets.

## Technical Overview

The app is built with:

- React for the interface.
- Vite for local development and builds.
- TanStack Router for routes.
- Zustand for current editor state.
- Dexie and IndexedDB for local persistence.
- GSAP for timeline animation.
- JSZip for HyperFrames ZIP export.
- Tailwind CSS and Radix UI primitives for styling and UI controls.

Important directories:

- `src/studio/Studio.tsx`: main studio shell.
- `src/studio/components`: stage, timeline, library, inspector, top bar, and lip sync UI.
- `src/studio/character`: character builder and character utilities.
- `src/studio/presets`: motion presets and preset recorder.
- `src/studio/lipsync`: ElevenLabs and viseme mapping.
- `src/studio/export`: HyperFrames export builders.
- `src/studio/db.ts`: local database setup and media helpers.
- `src/studio/store.ts`: current editor actions and state.
- `src/studio/types.ts`: project, media, character, clip, and motion types.

## Architecture Direction

The project is being corrected toward three clear layers:

```text
Authoring state
  Friendly editing data such as selected motions, visemes, track names, and character choices.

HyperFrames render model
  The actual renderable project: clips, assets, composition elements, timing attrs, styles, and timelines.

Export
  A thin serializer that writes the HyperFrames render model to files.
```

This matters because export should not be a large hidden conversion step. If the app
is authoring HyperFrames correctly, export should mostly copy structured render data
into `index.html`, `compositions/`, and `assets/`.

## Development Scripts

```bash
npm run dev       # Start local dev server
npm run build     # Build production bundle
npm run build:dev # Build in development mode
npm run preview   # Preview production build
npm run test      # Run tests
npm run test:ui   # Run Vitest UI
npm run lint      # Run ESLint
npm run format    # Format with Prettier
```

## Troubleshooting

### The app opens but my old work is gone

Studio Boom stores data in browser IndexedDB. Check that you are using the same
browser, browser profile, and local URL. Clearing site data can remove local work.

### Voice generation fails

Confirm `ELEVENLABS_API_KEY` is set in `.env`, then restart the dev server.

### Character mouth movement looks wrong

Check that the character has the mouth shapes needed for lip sync. Current mouth
visemes include:

```text
rest, A, E, O, U, MBP, FV, L, WQ, Smile
```

### Exported HyperFrames output looks different from the stage

That is exactly the drift the current architecture work is meant to remove. The goal
is for the stage preview and export to read the same HyperFrames render model.

## Near-Term Priorities

- Finish the HyperFrames-native project model correction.
- Make export a thin serializer over that model.
- Add stronger validation for assets, clips, compositions, and timelines.
- Improve local backup and restore.
- Add in-app MP4 rendering only after the HyperFrames model is stable.
