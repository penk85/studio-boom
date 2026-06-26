# Studio Boom — Agent Instructions

Studio Boom is a React editor shell for HyperFrames. React provides the editing UI.
HyperFrames owns the film. The packages below are the implementation — read them
before writing any code.

---

## Installed packages

### `@hyperframes/core`

The data model and HTML utilities. **Always import from here before writing any
HTML generation, GSAP, or element mutation code.**

**Types:**

- `TimelineElement` — the in-memory model for a clip on the timeline
  - `TimelineMediaElement` — video / image / audio
  - `TimelineTextElement` — text
  - `TimelineCompositionElement` — nested sub-composition (e.g. a character)
- `GsapAnimation`, `GsapMethod`, `ParsedGsap` — GSAP animation data

**HTML generation — use these to create composition HTML:**

- `generateHyperframesHtml(elements, duration, opts)` — produces a full composition
  HTML string including GSAP CDN and `window.__timelines`. **This is the only correct
  way to create a new composition.** It enables the player's play button.
- `generateBaseHtml(...)` — scaffold an empty composition (lower-level)

**HTML parsing and mutation — use these to update a stored HTML string:**

- `parseHtml(html)` → `{ elements, gsapScript, keyframes, … }`
- `updateElementInHtml(html, id, updates)` → updated HTML string
- `addElementToHtml(html, element)` → `{ html, id }`
- `removeElementFromHtml(html, id)` → updated HTML string

`addElementToHtml` and `updateElementInHtml` use `TimelineElement` field names:
`startTime` (not `start`), `sourceWidth`/`sourceHeight` (not `width`/`height`),
`type` is required. Do not invent field names — read the type.

**GSAP script editing:**

- `parseGsapScript(script)` → `GsapAnimation[]`
- `serializeGsapAnimations(anims)` → script string
- `updateAnimationInScript(script, id, updates)` → updated script
- `addAnimationToScript(script, id, anims)` → updated script
- `keyframesToGsapAnimations(keyframes)` → `GsapAnimation[]`

**Validation:**

- `lintHyperframeHtml(html)` → lint findings

---

### `@hyperframes/studio`

React components and hooks for building HyperFrames editors. **Use these directly —
do not reimplement player, timeline, or controls.**

Studio Boom should wrap and extend HyperFrames Studio primitives rather than
recreating working generic editor mechanics. Before adding custom timeline,
preview, source-editing, property-panel, file-tree, nested composition, or playback
behavior, audit whether `@hyperframes/studio`, `@hyperframes/core`,
`@hyperframes/player`, the HyperFrames CLI, or registry tooling already provides a
solid primitive. Keep custom Studio Boom code focused on local-first persistence,
media/blob management, character rigs, speech/lip-sync workflows, dashboard/project
UX, import/export UX, and higher-level creator workflows.

**Components in use:**

- `PlayerControls` — play/pause/seek bar. Requires `onTogglePlay` and `onSeek`
  props; reads current time and duration from `usePlayerStore`.

**Hooks in use:**

- `useTimelinePlayer()` — call once in `Studio.tsx`. Returns `{ iframeRef,
togglePlay, seek, … }`. Polls the iframe for `window.__timelines` (GSAP) or
  `window.__player`; sets `timelineReady = true` when found. **The play button is
  only enabled when `timelineReady` is true, which requires `generateHyperframesHtml`
  to have produced the composition HTML.**
- `usePlayerStore` — Zustand store populated by `useTimelinePlayer`. Exposes
  `currentTime`, `duration`, `isPlaying`, `timelineReady`.
- `useElementPicker(iframeRef, opts)` — click-to-select inside the player iframe.
  Returns `{ pickedElement, enablePick, setStyle }`. `onSyncFiles` callback receives
  updated file contents when the picker modifies the HTML.

---

### `@hyperframes/player`

The `<hyperframes-player>` web component. Studio Boom uses it through one local
Stage adapter with `srcdoc`, then bridges its inner iframe with
`@hyperframes/studio`'s `resolveIframe`. Keep this direct usage isolated to
`Stage.tsx`; other editor code should talk to `useTimelinePlayer`,
`usePlayerStore`, `PlayerControls`, or `useElementPicker`.

---

## Architecture

### Data

```
Dexie (browser persistence)
  projects table:  { id, hf: { rootHtml, compositionHtml, assets }, editorMeta }
  media table:     blobs for video, audio, images
  characters:      character definitions (parts, layout, rig)
  motionPresets:   persisted action/expression presets (legacy table name)
  savedVoices:     pinned ElevenLabs voice ids/names for reuse

Zustand (in-memory UI state)
  project          ← loaded from Dexie, kept in sync
  selectedClipId, zoom, undo/redo history, drag state
  characters, motionPresets, mediaAssets  ← hydrated at project open
```

### Project schema

```typescript
Project {
  id: string
  name: string
  hf: HyperFramesProject {
    rootHtml: string                        // index.html — the film
    compositionHtml: Record<string, string> // sub-composition HTML strings keyed by id
    assets: HFAsset[]                       // { id, type } registry for export blob lookup
    width, height, fps, duration
  }
  editorMeta: ProjectEditorMeta             // editor-only authoring state (not exported)
}
```

`rootHtml` and `compositionHtml` are the film. They are valid HyperFrames composition
HTML, ready to pass directly to the player or stage directly for MP4 rendering.

### Edit flow

```
User action (add clip, drag, resize, rotate, nudge, reorder layers, change timing)
  → record an undo checkpoint for the current Project snapshot
  → call updateElementInHtml / addElementToHtml / removeElementFromHtml
    from @hyperframes/core through Studio boundary adapters to mutate rootHtml
  → store dispatches updateRootHtml(newHtml) → Dexie save (debounced)
  → Stage effect resolves editor asset placeholders → player iframe re-renders
```

For live stage preview without reloading, use the local player-editing boundary.
It tries `PlayerAPI` first, then falls back to updating the real element in the
player iframe. Do not draw a React copy of the clip to fake movement, resize, or
rotation. On release, commit through `updateClip`, which persists `x`/`y`,
`width`/`height`, and base `rotation` into `rootHtml`. Width and height map to
`TimelineElement` fields (`sourceWidth`/`sourceHeight`); base rotation is
persisted by the Studio HTML boundary as `data-rotation` until
`@hyperframes/core` exposes it as a native base element field.

Visual layer order is `EditorClip.zIndex` persisted into `rootHtml` as CSS
`z-index` by the Studio HTML boundary. Editor timeline tracks and lanes stay in
`editorMeta`; do not make React track rows the render stack.

### Stage

`Stage.tsx` resolves `asset:ID` placeholders to Dexie blob URLs and passes the
complete HTML to `<hyperframes-player srcdoc>`. It must bridge the web component's
inner iframe to the single `useTimelinePlayer()` ref with `resolveIframe` from
`@hyperframes/studio`. This keeps playback, picking, and source sync attached to
the real HyperFrames iframe. React does not redraw the film.

Do not use a `blob:` URL as the player's `src`: `@hyperframes/player` appends
shader query params to `src`, which changes object URLs and can make the iframe
show a broken-file icon. `srcdoc` avoids that URL rewrite for editor preview.

Shader transition support is deferred. Do not add `shader-capture-scale`,
`shader-loading`, or shader-specific transition plumbing until Studio Boom has a
dedicated shader test composition and the standard preview/export path is stable.

`useElementPicker(iframeRef)` handles click-to-select inside the iframe. Its
`onSyncFiles` callback commits any in-iframe edits back to `rootHtml`.

React overlays are allowed only as editor chrome: selection outlines, resize
handles, move controls, labels, and other non-rendered affordances. They must not
draw duplicate media/content or become a second preview renderer. The selected and
edited object remains the real HyperFrames element inside the player iframe.
Stage drag/resize/rotate/nudge should preview through the player-editing boundary
and commit through `updateClip`. The rotate handle uses the selected visible
bounds center as its editor pivot and persists only base `rotation`, not
animation keyframes. Selection chrome may rotate with the selected clip, but it
must remain editor-only chrome. Visual layer shortcuts should mutate canonical
`rootHtml` layer fields, not reorder React-rendered previews.

Undo/redo restores stored `Project` snapshots, including `project.hf` and
`editorMeta`. It must not reconstruct output from React UI state. Interactive
mousemove-style edits should create one explicit checkpoint at interaction start,
then call mutation actions with history disabled until the interaction ends.

### Character compositions

Characters are first-class HyperFrames composition clips. A root character clip
uses `kind: "composition"` and `compositionKind: "character"` with a
`compositionId`; the renderable puppet rig lives in
`project.hf.compositionHtml[compositionId]`.

Reusable library identity stays in nested metadata:

```typescript
character: {
  characterId: string
  poses: Record<slotId, partId>
  motions?: AppliedMotion[] // applied Actions/Expressions; legacy field name
  visemes?: VisemeEntry[]
  autoBlink?: boolean
  lipSyncAudioId?: string
  voiceLine?: VoiceLineMeta
}
```

Speech audio is reusable media. Viseme timing and transcript metadata live on the
audio `MediaAsset`; character clips place one or more speech entries through
`character.speeches`. The character sub-composition serializes each placed speech
as a HyperFrames `<audio>` clip. Do not add locked root audio siblings for
character speech.

Character animation vocabulary:

- **Pose** is a held variant map with no timing. It chooses semantic slot variants
  such as standing, explaining, folded arms, or open hand.
- **Action** is repeatable timed body animation. An applied Action may be scoped
  to a body region (`fullBody`, `upperBody`, `lowerBody`, `hands`, etc.) so, for
  example, a walk can drive legs without overwriting folded arms.
- **Expression** is timed facial animation. Expressions live on their own timeline
  subtrack and override facial movement from Actions without double-applying it.
- **Speech / lip sync** is its own placed audio/viseme track and should remain
  separate from Actions and Expressions.
- **Stage motion** means moving a whole clip around the canvas. Do not confuse it
  with character Actions.

The current persisted names still include `MotionPreset`, `AppliedMotion`, and
`character.motions`; treat those as legacy internal names for Action/Expression
data until a mechanical schema rename is done.

The generated character source must contain explicit puppet DOM, stable
`data-character-*` attrs, `asset:<id>` media refs, base transforms/pivots, and a
finite paused GSAP timeline registered on `window.__timelines[compositionId]`.
Character source is generated from rig tools for v1; generic composition source
editing is for non-character compositions.

### Export

Export is: stage the HTML strings as a temporary HyperFrames project + fetch and
copy each blob in `assets[]`.

```
rootHtml          → index.html
compositionHtml   → compositions/<id>.html  (one file per entry)
assets[]          → fetch blob from Dexie → assets/<id>.<ext>
```

No serialization. No conversion. The HTML strings are already the output.

### `editorMeta`

Editor-only state. Not exported. Not rendered directly.

```typescript
ProjectEditorMeta {
  tracks: TrackMeta[]                      // track names, lock/mute for UI
  clips: Record<clipId, ClipEditorMeta>
}

ClipEditorMeta {
  name?: string
  kind?: "image" | "audio" | "video" | "text" | "composition"
  compositionId?: string
  compositionKind?: "ai-block" | "registry-block" | "character" | "user-composition"
  character?: CharacterClipMeta            // only for compositionKind: "character"
  mediaId?: string
  uiTrackIndex?: number                    // editor track row
  uiLaneIndex?: number                     // editor lane within track
}
```

---

## Important files

| File                                             | Role                                                                                                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/studio/types.ts`                            | `Project`, `HFAsset`, `ProjectEditorMeta`, `ClipEditorMeta`, `deriveEditorClips`                                                               |
| `src/studio/store.ts`                            | Zustand store: edit actions, HTML mutation, UI state                                                                                           |
| `src/studio/db.ts`                               | Dexie: project and blob persistence                                                                                                            |
| `src/studio/character/`                          | Character builder utilities and rig definitions                                                                                                |
| `src/studio/lipsync/elevenlabs.ts`               | Speech generation/import/alignment helpers; saves reusable audio media and rebuilds character speech                                           |
| `src/studio/lipsync/tts.functions.ts`            | Browser-side calls to local `/api/elevenlabs/*` endpoints                                                                                      |
| `src/studio/hyperframes/render-plugin.ts`        | Local render/preview-bundle middleware plus server-side ElevenLabs proxy                                                                       |
| `src/studio/components/Stage.tsx`                | HyperFrames player iframe via `srcdoc`, `resolveIframe`, `useElementPicker`, editor chrome only                                                |
| `src/studio/components/Timeline.tsx`             | Timeline UI; `PlayerControls`                                                                                                                  |
| `src/studio/components/VoiceLipSyncPanel.tsx`    | Character Speech inspector tab: voice library, TTS, upload, forced alignment, speech placement                                                 |
| `src/studio/components/Library.tsx`              | Media, text presets, characters, action/expression presets, and custom HyperFrames block import                                                |
| `src/studio/Studio.tsx`                          | Calls `useTimelinePlayer()` once; distributes `iframeRef`, `togglePlay`, `seek`                                                                |
| `src/studio/hyperframes/assets.ts`               | Generic `project.hf.assets` registration/pruning helpers                                                                                       |
| `src/studio/hyperframes/html.ts`                 | Parser adapter for current `@hyperframes/core` boundary behavior                                                                               |
| `src/studio/hyperframes/native.ts`               | Native HTML normalization boundary for root/stage/viewport metadata and export parity                                                          |
| `src/studio/hyperframes/player-editing.ts`       | Live player edit boundary for real iframe elements during stage manipulation                                                                   |
| `src/studio/hyperframes/root-composition.ts`     | Root composition creation and root metadata updates                                                                                            |
| `src/studio/character/composition.ts`            | Native character composition builder for puppet DOM, speech audio, visemes, blink, and Action/Expression timelines                             |
| `src/studio/presets/action-terminology.ts`       | Shared Action/Expression labels, lanes, regions, exclusivity, and role-to-region rules                                                         |
| `docs/ai-generated-hyperframes-clips-roadmap.md` | Roadmap for AI-generated clips, source-visible custom HyperFrames blocks, native text/composition clip support, and nested composition editing |

---

## Rules

- Never persist old timing/layer attributes (`data-end`, `data-layer`) as the
  canonical format. Normalize to `data-duration`, `data-track-index`, etc.
  `data-name` is allowed for clip labels.
- Never call `generateHyperframesHtml` with a shadow element list derived from React
  state. The source of truth is `rootHtml`.
- Never create a second `useTimelinePlayer()` call. It is called once in `Studio.tsx`
  and the returned `iframeRef` / `togglePlay` / `seek` are passed as props.
- Always use `@hyperframes/core` functions to mutate HTML — never string-splice.
- `@hyperframes/core` does not load in raw Node.js ESM (extensionless imports). Mock
  it in Vitest tests using `vi.mock('@hyperframes/core', ...)`.
- Keep provider API keys server-side. ElevenLabs uses `ELEVENLABS_API_KEY` through
  the local Vite middleware; do not read it from client code or a `VITE_` variable.
