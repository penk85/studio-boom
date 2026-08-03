# Studio Boom — Agent Instructions

Studio Boom is an editor for a canonical, render-ready movie document. Today the
application shell is React and the durable movie source is `project.hf`
(`rootHtml`, `compositionHtml`, and `assets`), but the load-bearing rule is source
parity: editing, stage preview, playback, and MP4 export must all read and write
the same canonical project source. UI state and renderer adapters may support
authoring, but they must not become a second movie model or a late export compiler.

The packages below are the implementation — read them before writing any code.

## Current package baseline (2026-07-27)

The HyperFrames family is pinned together at exact version **0.7.73** across
core, engine, player, producer, studio, and the CLI; Vite remains **7.3.6**.
HyperFrames 0.7 validation is asynchronous and its StaticGuard contract requires
each composition file to have exactly one `data-composition-id`, owned by the
stage root. Studio Boom's `native.ts` normalization and composition-source
validation preserve that contract. The current dependency advisories and the
approval-gated remediation proposal are recorded in
`docs/code-audit-2026-07-07.md`.

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

- `await lintHyperframeHtml(html)` → lint findings

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

`rootHtml`, `compositionHtml`, and `assets` are the film. They must stay
render-ready for preview, stage playback, and MP4 export without compiling from
React state, `editorMeta`, or any other parallel UI model at export time.

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
player iframe. Do not draw a UI copy of the clip to fake movement, resize, or
rotation. On release, commit through the canonical project mutation boundary
(`updateClip` for root clips), which persists render-affecting changes into
`project.hf`. Width and height map to `TimelineElement` fields
(`sourceWidth`/`sourceHeight`); base rotation is persisted by the Studio HTML
boundary as `data-rotation` until `@hyperframes/core` exposes it as a native base
element field.

Visual layer order is `EditorClip.zIndex` persisted into `rootHtml` as CSS
`z-index` by the Studio HTML boundary. Editor timeline tracks and lanes stay in
`editorMeta`; do not make React track rows the render stack.

### Stage

`Stage.tsx` resolves `asset:ID` placeholders to Dexie blob URLs and passes the
complete HTML to `<hyperframes-player srcdoc>`. It must bridge the web component's
inner iframe to the single `useTimelinePlayer()` ref with `resolveIframe` from
`@hyperframes/studio`. This keeps playback, picking, and source sync attached to
the real render-ready project source. The editor UI does not redraw the film.

Do not use a `blob:` URL as the player's `src`: `@hyperframes/player` appends
shader query params to `src`, which changes object URLs and can make the iframe
show a broken-file icon. `srcdoc` avoids that URL rewrite for editor preview.

Known limitation: when a scene is active, Stage previews
`buildSceneEditingProject(...)`, so the player document holds one scene and its
duration. Playback therefore stops at the scene boundary while the transport
still shows whole-film duration. Whole-film playback is the `activeSceneId ===
null` path. See `docs/ux-followups.md` §1 before changing scene scoping.

Shader transition support is deferred. Do not add `shader-capture-scale`,
`shader-loading`, or shader-specific transition plumbing until Studio Boom has a
dedicated shader test composition and the standard preview/export path is stable.

`useElementPicker(iframeRef)` handles click-to-select inside the iframe. Its
`onSyncFiles` callback commits any in-iframe edits back to `rootHtml`.

Editor overlays are allowed only as chrome: selection outlines, resize handles,
move controls, labels, and other non-rendered affordances. They must not draw
duplicate media/content or become a second preview renderer. The selected and
edited object remains the real renderable element or composition data represented
inside `project.hf`. Stage drag/resize/rotate/nudge should preview through the
player-editing boundary and commit through canonical project mutations such as
`updateClip`. The rotate handle uses the selected visible bounds center as its
editor pivot and persists only base `rotation`, not animation keyframes.
Selection chrome may rotate with the selected clip, but it must remain
editor-only chrome. Visual layer shortcuts should mutate canonical `rootHtml`
layer fields, not reorder UI-rendered previews.

Undo/redo restores stored `Project` snapshots, including `project.hf` and
`editorMeta`. It must not reconstruct output from React UI state. Interactive
mousemove-style edits should create one explicit checkpoint at interaction start,
then call mutation actions with history disabled until the interaction ends.

### Character compositions

Characters are first-class HyperFrames composition clips. A root character clip
uses `kind: "composition"` and `compositionKind: "character"` with a
`compositionId`; the renderable character rig lives in
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

Character animation vocabulary (see `docs/ui-vocabulary.md` for the full canon):

- **Pose** is a held variant map with no timing. It chooses semantic slot variants
  such as standing, explaining, folded arms, or open hand.
- **Action** is repeatable timed body animation. An applied Action may be scoped
  to a body region (`fullBody`, `upperBody`, `lowerBody`, `hands`, etc.) so, for
  example, a walk can drive legs without overwriting folded arms.
- **Expression** is timed facial animation. Expressions live on their own timeline
  subtrack and override facial movement from Actions without double-applying it.
- **Speech / lip sync** is its own placed audio/viseme track and should remain
  separate from Actions and Expressions.
- **Move** means travelling a whole clip around the canvas over time. The UI calls
  this a Move and its stops Points; it is never called "motion". Do not confuse it
  with character Actions — a character walking across frame is a Move (the clip
  travels) plus an Action (the legs walk), authored in two different tabs.

The current persisted names still include `MotionPreset`, `AppliedMotion`,
`character.motions`, `ClipMotionStep`, and `ClipMotionCheckpoint`; treat those as
legacy internal names for Action/Expression/Move/Point data until a mechanical
schema rename is done. They must not surface in any user-visible string.

The generated character source must contain explicit renderable character data:
stable node identity, `asset:<id>` media refs, base transforms/pivots, and a
finite paused timeline registered on `window.__timelines[compositionId]` (or the
equivalent seekable composition contract supported by the player).

Current status (July 2026): Pixi-backed character compositions are the validated
renderer baseline. The generated source carries renderer-neutral
`CharacterSceneGraph` / `CharacterTimelineScene` data, initializes Pixi inside the
character HyperFrames composition, loads assets through `PIXI.Assets.load`, renders
textured parts as `Sprite` leaves and morph paths as vector/Graphics nodes, and
registers a synchronous HyperFrames timeline plus a Pixi readiness gate. Preview
and MP4 export stage this same stored composition source.

Pixi is the only character renderer. The DOM puppet renderer, the per-clip
`character.renderer` switch (a legacy saved value is stripped on save), the
Inspector render-engine control, and the DOM character-document command boundary
(`applyCharacterDocumentCommand`, `src/studio/character-document/`) were removed
in July 2026. Old projects' stored DOM compositions remain valid HyperFrames
source and keep playing until their clip rebuilds as Pixi.

The legacy generated/fallback mouth rig (`character.mouthRig`,
`mouthStyle: "rig"`) is retired: it existed only as puppet DOM. Characters that
still reference it build without that mouth (one console warning); mouth image or
SVG parts restore the mouth and drive lip sync. Character composition generation
now builds renderer-neutral timeline inputs directly; it no longer emits
unstaged legacy DOM strings. Typed character document commands should return as
renderer-neutral scene-graph operations when an editor consumer needs them.

Mesh deformation is opt-in per part (July 2026): a part with
`CharacterPart.deform` ("Flexible" in the slot inspector) renders as a Pixi mesh
inside the generated character composition. New flexible parts use the
point-based `limb-path` model: a rig-attached start point, a draggable end point
for stretch/reach, and an optional curve point for bend. The generated source
renders this as a seek-updated `MeshSimple` ribbon (the scene node keeps the
semantic `meshKind: "rope"` label), with a rigid `Sprite` fallback if the mesh
class is unavailable. `MeshSimple` preserves the full artwork while its vertex
grid changes; `MeshRope` compresses that artwork into its rope-width mapping.
Parts without `deform` stay `Sprite` leaves and default characters remain
mesh-free end to end. Legacy saved `mode: "bend"` parts still read through
the old `MeshPlane` path and shared math in `src/studio/character/mesh-deform.ts`,
but new UI should not author that model. Flexible edits route through
`applyCharacterSceneCommand` (`set-slot-deform`) like other rig/scene authoring
operations. Preview/export mesh parity is locked by `preview-parity.test.ts`;
mesh features must keep living inside canonical `project.hf.compositionHtml` —
never in an editor-only canvas.

### Export

Export is: stage the HTML strings as a temporary HyperFrames project + fetch and
copy each blob in `assets[]`.

```
rootHtml          → index.html
compositionHtml   → compositions/<id>.html  (one file per entry)
assets[]          → fetch blob from Dexie → assets/<id>.<ext>
```

No serialization from UI state. No late conversion from a separate renderer
model. Export may stage files, copy assets, rewrite file paths, and package local
runtimes, but the stored `project.hf` strings/assets are already the output.

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

| File                                                       | Role                                                                                                                                                              |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/studio/types.ts`                                      | `Project`, `HFAsset`, `ProjectEditorMeta`, `ClipEditorMeta`, `deriveEditorClips`                                                                                  |
| `src/studio/store.ts`                                      | Zustand runtime: edit actions, history, save scheduling, and UI state ownership                                                                                   |
| `src/studio/store-types.ts`                                | Public Zustand state/action type contract                                                                                                                         |
| `src/studio/project-assets.ts`                             | Canonical asset-manifest registration and pruning                                                                                                                 |
| `src/studio/project-timeline.ts`                           | Pure editor-lane/render-track and timeline-element projection                                                                                                     |
| `src/studio/db.ts`                                         | Dexie: project and blob persistence                                                                                                                               |
| `src/studio/character/`                                    | Character builder utilities and rig definitions                                                                                                                   |
| `src/studio/lipsync/elevenlabs.ts`                         | Speech generation/import/alignment helpers; saves reusable audio media and rebuilds character speech                                                              |
| `src/studio/lipsync/tts.functions.ts`                      | Browser-side calls to local `/api/elevenlabs/*` endpoints                                                                                                         |
| `src/studio/hyperframes/render-plugin.ts`                  | Local render/preview-bundle middleware plus server-side ElevenLabs proxy                                                                                          |
| `src/studio/components/Stage.tsx`                          | HyperFrames player iframe via `srcdoc`, `resolveIframe`, `useElementPicker`, editor chrome only                                                                   |
| `src/studio/components/Timeline.tsx`                       | Timeline state, seek/playback orchestration, and `PlayerControls`; expanded rows live in focused `Timeline*Tracks.tsx` siblings                                   |
| `src/studio/components/VoiceLipSyncPanel.tsx`              | Character Speech inspector tab: voice library, TTS, upload, forced alignment, speech placement                                                                    |
| `src/studio/components/Library.tsx`                        | Media, text presets, characters, action/expression presets, and custom HyperFrames block import                                                                   |
| `src/studio/Studio.tsx`                                    | Calls `useTimelinePlayer()` once; distributes `iframeRef`, `togglePlay`, `seek`                                                                                   |
| `src/studio/hyperframes/assets.ts`                         | Generic `project.hf.assets` registration/pruning helpers                                                                                                          |
| `src/studio/hyperframes/html.ts`                           | Parser adapter for current `@hyperframes/core` boundary behavior                                                                                                  |
| `src/studio/hyperframes/native.ts`                         | Native HTML normalization boundary for root/stage/viewport metadata and export parity                                                                             |
| `src/studio/hyperframes/player-editing.ts`                 | Live player edit boundary for real iframe elements during stage manipulation                                                                                      |
| `src/studio/hyperframes/project-source.ts`                 | Scene-aware HTML commits, composition validation/cloning, and scene source synchronization                                                                        |
| `src/studio/hyperframes/root-composition.ts`               | Root composition creation and root metadata updates                                                                                                               |
| `src/studio/character/composition.ts`                      | Character composition entry point; builds the Pixi-backed HyperFrames character source                                                                            |
| `src/studio/character/CharacterEditor.tsx`                 | Character authoring orchestrator; persistence/resource lifecycles and pure pointer calculations live in focused `use-character-*` / `character-editor-*` siblings |
| `src/studio/character/scene.ts`                            | Renderer-neutral character scene graph: bones, slots, parts, assets, pivots, placements, and motion targets                                                       |
| `src/studio/character/timeline-scene.ts`                   | Renderer-neutral character timeline payload consumed by Pixi composition source                                                                                   |
| `src/studio/character/pixi-composition.ts`                 | Pixi-backed character composition builder; registers a synchronous HyperFrames timeline and Pixi readiness gate                                                   |
| `src/studio/character/pixi-preview-runtime.ts`             | Shared editor-side Pixi runtime (same semantics as the composition script); drives `PixiCharacterPreview` in the editor and recorder                              |
| `src/studio/character/use-character-document.ts`           | Character Editor document refs, bounded undo/redo, keyboard history, debounced save, and explicit save-now lifecycle                                              |
| `src/studio/character/use-character-preview-controller.ts` | Character Editor preview timing plus cancellable Web Audio/RAF mouth-test lifecycle                                                                               |
| `src/studio/character/use-character-artwork-analysis.ts`   | Async alpha-bounds backfill and cached pixel hit masks for Character Editor artwork                                                                               |
| `src/studio/character/character-editor-interactions.ts`    | Pure canvas hit testing and group resize/rotate snapshot calculations                                                                                             |
| `src/studio/character/mesh-deform.ts`                      | Legacy Plane-bend math for old saved flexible parts; embedded only for compatibility with legacy `mode: "bend"` mesh nodes                                        |
| `src/studio/presets/action-terminology.ts`                 | Shared Action/Expression labels, lanes, regions, exclusivity, and role-to-region rules                                                                            |
| `docs/ai-generated-hyperframes-clips-roadmap.md`           | Roadmap for AI-generated clips, source-visible custom HyperFrames blocks, native text/composition clip support, and nested composition editing                    |
| `docs/ui-vocabulary.md`                                    | **Canonical user-facing labels.** Read before writing any label, tooltip, placeholder, empty state, or status message                                             |
| `docs/ux-followups.md`                                     | Open UX/UI issues in priority order, including the scene-scoped playback limitation                                                                              |

---

## Rules

- Every user-visible string must use the canon in `docs/ui-vocabulary.md`. One
  noun per concept, and no noun used for two concepts. Legacy internal names
  (`MotionPreset`, `motionSteps`, `checkpoint`, `keyframe`) stay in the schema and
  never reach a label. If a concept is missing from that file, add it there first.
- Never persist old timing/layer attributes (`data-end`, `data-layer`) as the
  canonical format. Normalize to `data-duration`, `data-track-index`, etc.
  `data-name` is allowed for clip labels.
- Preview, stage playback, and MP4 export must consume the same canonical
  `project.hf` source. If a feature works only in an editor-only renderer or only
  in an export-only compiler, it violates the source-parity rule.
- Pixi character rendering is allowed only as generated HyperFrames composition
  source. Do not add a separate canvas preview path backed by React/editor state.
- Never call `generateHyperframesHtml` with a shadow element list derived from UI
  state. The source of truth is `rootHtml`.
- Never create a second `useTimelinePlayer()` call. It is called once in `Studio.tsx`
  and the returned `iframeRef` / `togglePlay` / `seek` are passed as props.
- Always use `@hyperframes/core` functions to mutate HTML — never string-splice.
- `@hyperframes/core` does not load in raw Node.js ESM because of extensionless
  imports. Vitest inlines the HyperFrames packages through Vite, so real-core
  tests are canonical. Mock core only where a test intentionally counts boundary
  calls (the store suite is the existing example).
- Keep provider API keys server-side. ElevenLabs uses `ELEVENLABS_API_KEY` through
  the local Vite middleware; do not read it from client code or a `VITE_` variable.
