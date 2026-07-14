# Studio Boom — Rules of the Road

Operational rulebook for anyone (human or agent) contributing to this repo.
`CLAUDE.md` is the architecture contract — read it before any architecture,
character, or export/render change. If this file and `CLAUDE.md` ever disagree
about architecture, `CLAUDE.md` wins; for commands and process, this file wins.
Flag any conflict you find instead of silently picking one.

Deep dives live in `docs/` (`ai-generated-hyperframes-clips-roadmap.md`,
`character-rig-architecture.md`, `character-json-rig-motion-architecture.md`,
`native-hyperframes-workflow-audit.md`). Known defects, risks, and smells are
catalogued with severity and fix order in `docs/code-audit-2026-07-07.md` —
check it before "fixing" something that is already documented there.

---

## 1. Orientation

Studio Boom is a local-first, browser-only editor for HyperFrames movies. There
is no backend and no CI — the Vite dev server plus its middleware is the whole
runtime, and the local commands below are the only quality gate.

The movie itself is **not React state**. It is `project.hf` — three fields:
`rootHtml` (the film's HTML), `compositionHtml` (sub-composition HTML strings
keyed by id), and `assets` (blob manifest). Editing, stage preview, playback,
and MP4 export all read and write that same source. Everything else is chrome.

| Area                      | Owns                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/studio/store.ts`     | Zustand store: every project mutation, undo/redo, debounced save (3k lines — the heart)                                            |
| `src/studio/types.ts`     | `Project`, `EditorClip`, character/preset types, `deriveEditorClips`                                                               |
| `src/studio/db.ts`        | Dexie (IndexedDB) persistence: projects, media blobs, characters, presets, voices                                                  |
| `src/studio/hyperframes/` | Boundary adapters over `@hyperframes/core`: HTML parse/mutate, keyframes, normalization, export validation, Vite render middleware |
| `src/studio/components/`  | Editor UI: `Stage`, `Timeline`, `Inspector`, `Library`, dashboard                                                                  |
| `src/studio/character/`   | Character rigs, renderer-neutral scene graph, Pixi composition builder + editor preview runtime                                    |
| `src/studio/presets/`     | Action/Expression presets, recorder, terminology                                                                                   |
| `src/studio/lipsync/`     | ElevenLabs TTS/alignment client helpers, viseme mapping                                                                            |
| `src/studio/interaction/` | Shared selection/transform box (react-moveable) used by Stage, character editor, and recorder                                      |
| `src/studio/export/`      | Stages `project.hf` into HyperFrames CLI project files for MP4 render                                                              |
| `src/studio/scenes.ts`    | Scene layer: root hosts scene composition clips; editing targets the active scene                                                  |
| `src/components/ui/`      | shadcn/ui primitives (new-york style) — generic, no studio logic                                                                   |
| `src/shims/`              | Browser shims for node builtins (`path`, `fs`, `url`, `esbuild`) required by bundled HyperFrames deps                              |

App flow: `src/main.tsx` → `src/App.tsx` (two-view SPA, no router:
`dashboard` ↔ `studio`) → `src/studio/Studio.tsx` (three-pane shell, owns the
single `useTimelinePlayer()` call).

---

## 2. Toolchain & Commands

Pinned toolchain — `engine-strict=true` makes mismatches fail at install:

- Node **22.22.2** (`.nvmrc`), npm **10.9.7** (`packageManager` in `package.json`)
- Package manager is **npm**. `bun.lockb` and `bunfig.toml` are stale leftovers
  (untouched since April 2026; `package-lock.json` is current). Never run bun
  here, never commit `bun.lockb` changes. [VERIFY: delete the bun files]

```bash
nvm use                  # picks up 22.22.2
npm ci                   # reproducible install from package-lock.json

npm run dev              # Vite dev server → http://localhost:8080
npm run build            # production build (vite build)
npm run preview          # serve the production build

npx vitest run           # run the full test suite ONCE  ← use this
npm test                 # = `vitest` = WATCH MODE — never terminates; do not use in automation
npx vitest run src/studio/hyperframes/__tests__/html.test.ts   # one file
npm run test:ui          # Vitest browser UI (humans only)

npx tsc --noEmit         # typecheck (there is NO npm script for this)
npm run lint             # eslint . — Prettier runs as an ESLint rule, so this is also the format check
npx eslint . --fix       # autofix lint + formatting
npm run format           # prettier --write . (rarely needed; lint --fix covers it)
```

### Known baseline failures (as of 2026-07-07)

Verify against these before blaming your own change — and never add to them:

- `npx tsc --noEmit` reports **13 pre-existing errors, all in
  `src/studio/store.ts`**, all one root cause: `activeSceneId` is used in state
  but missing from the `StudioState` interface (declared in `HistoryEntry` at
  `store.ts:1062`, absent from the interface starting `store.ts:1075`). Runtime
  is unaffected. The fix is one line (`activeSceneId: string | null;` in
  `StudioState`) but land it as its own commit, not inside a feature diff.
  [VERIFY: human should confirm and land this fix]
- `npm run lint` reports **4 auto-fixable prettier errors**
  (`StageMoveable.tsx`, `keyframes.ts` ×2, `transform.ts`) and 2 react-hooks
  warnings. Files **you** touch must come out lint-clean.
- `npx vitest run` is fully green: 60 files / 621 tests, ~35 s.

Definition of done for any change: `npx vitest run` green, `npx tsc --noEmit`
introduces **zero new** errors, touched files lint-clean — plus §10's human
handoff for anything user-visible.

---

## 3. Golden rules

1. **`project.hf` is the movie.** `rootHtml` + `compositionHtml` + `assets`
   must stay render-ready at all times. Never build a parallel movie model in
   React state, never compile UI state into output at export time, never make a
   feature work only in preview or only in export. `preview-parity.test.ts`
   enforces byte-identical staging — keep it passing.
2. **Mutate HyperFrames HTML only through the boundary layer.** Use
   `parseStudioHtml` / `addStudioElementToHtml` / `updateStudioElementInHtml`
   from `src/studio/hyperframes/html.ts` (and `removeElementFromHtml` from
   `@hyperframes/core`). Never string-splice HTML, never regex-edit it, and
   never import core mutation functions anywhere new — today exactly four
   files import values from `@hyperframes/core` (`hyperframes/html.ts`,
   `hyperframes/root-composition.ts`, `character/pixi-composition.ts`,
   `store.ts`) and that list should not grow casually.
3. **Never call `generateHyperframesHtml` with an element list derived from UI
   state.** It is only for creating _new_ compositions
   (`root-composition.ts`, `pixi-composition.ts`). The source of truth for
   existing content is the stored HTML.
4. **One `useTimelinePlayer()` call, in `Studio.tsx`, forever.** Everything
   else receives `iframeRef` / `togglePlay` / `seek` as props.
5. **React draws chrome, not movie.** Selection boxes, handles, labels — yes.
   A second copy of a clip's media/content to fake motion — never. Stage edits
   preview against the real iframe element (`hyperframes/player-editing.ts`)
   and commit through store mutations.
6. **Pixi is the only character renderer**, and it lives _inside generated
   HyperFrames composition source_. No editor-only canvas render paths, no DOM
   puppet revival, no per-clip renderer switches.
7. **HyperFrames-first.** Before writing timeline/player/HTML/GSAP/Pixi code,
   check `@hyperframes/core` exports, `@hyperframes/studio` hooks, and the
   installed skills in `.claude/skills/` / `.agents/skills/` (hyperframes,
   gsap, pixijs-\*). Reimplementing something a package exposes is a review
   reject.
8. **Match the nearest existing pattern; keep diffs focused.** Copy the
   adjacent store action / boundary helper / test file structure. Do not
   reformat, rename, or "clean up" code you aren't changing — unused-var
   warnings are deliberately off, leave them alone.
9. **No new dependencies without explicit human sign-off**, and write against
   the versions actually installed (§12) — not whatever API your training data
   prefers.
10. **If a bug traces to an architecture violation** (a second source of truth,
    a bypassed boundary, drifted parity), report the violation as the fix.
    Don't stack patches on top of it.
11. **Legacy persisted names stay.** `MotionPreset`, `AppliedMotion`,
    `character.motions`, the `motionPresets` Dexie table are the _storage_
    names for Action/Expression data. Rename only UI labels (see
    `presets/action-terminology.ts`); never rename the schema ad hoc.
12. **Never persist `data-end` or `data-layer`.** Canonical timing/layer attrs
    are `data-duration` and `data-track-index` (`hyperframes/native.ts`
    normalizes; `data-name` is allowed for labels).

---

## 4. The canonical edit flow (memorize this)

Every mutation that changes the movie follows one shape. Reference
implementation: `applyClipLayerMove` in `store.ts:1277`.

```ts
const state = get();
const p = state.project;
const editingProject = getEditingProject(state); // scene-aware view (see below)
if (!p || !editingProject) return;

if (options?.history !== false) get().checkpointHistory(); // undo snapshot FIRST

let rootHtml = editingProject.hf.rootHtml;
rootHtml = updateStudioElementInHtml(rootHtml, clipId, { zIndex }); // boundary mutation

const newProject = commitEditingRootHtml(p, state.activeSceneId, rootHtml);
set({ project: newProject });
scheduleSave(get, set); // debounced 500 ms Dexie save
```

Rules that fall out of this:

- **Scenes:** the root timeline hosts scene clips (`compositionKind: "scene"`,
  composition id `comp_<sceneId>` via `sceneCompositionId`). When a scene is
  active, "rootHtml" edits actually target that scene's entry in
  `compositionHtml` — always go through `getEditingProject` /
  `commitEditingRootHtml`, never index `project.hf` directly in a mutation.
- **Undo:** `checkpointHistory()` snapshots the whole `Project` (limit 50).
  Interactive drags checkpoint **once** at pointer-down, then pass
  `{ history: false }` for every mousemove-driven call until release.
- **Persistence:** never call `db.projects.put` yourself from UI code;
  `scheduleSave` → `saveProject` owns it (with a generation guard against
  stale saves).
- **Field names:** `TimelineElement` uses `startTime` (not `start`),
  `sourceWidth`/`sourceHeight` (not `width`/`height`), and `type` is required.
  `EditorClip` (the parsed, UI-facing view from `deriveEditorClips`) uses
  `start`/`width`/`height`. Do not confuse the two vocabularies.
- **Ids:** always `uid()` from `db.ts` — it prefixes `e` so ids are valid HTML
  element ids/selectors. Never `crypto.randomUUID()` directly for element ids.
- **Layering:** render order is `zIndex` persisted into `rootHtml`; editor
  rows/lanes are `editorMeta.clips[id].uiTrackIndex`/`uiLaneIndex`. Never make
  UI track rows the render stack.

---

## 5. Conventions

- **Formatting:** Prettier (via ESLint): 100-col width, double quotes,
  semicolons, trailing commas. Don't hand-format; run `npx eslint . --fix`.
- **Lint config:** flat `eslint.config.js` (ESLint 9). Notable: prettier
  violations are _errors_; `@typescript-eslint/no-unused-vars` is **off**.
- **File names:** React components `PascalCase.tsx` (`Stage.tsx`,
  `CharacterEditor.tsx`); everything else `kebab-case.ts`
  (`stage-helpers.ts`, `pixi-composition.ts`). Tests in a `__tests__/`
  directory next to the code, named `<subject>.test.ts` or
  `<Component>.integration.test.ts`.
- **Exports:** named exports for components (`export function Stage(...)`);
  the only app-code default export is `App.tsx` (shims emulating node modules
  don't count).
- **Imports:** inside `src/studio/**` use relative paths (`../store`,
  `./types`). The `@/*` alias (→ `src/*`) is used at the `src/` root and by
  shadcn files (`@/components/ui/button`, `@/lib/utils`). Follow whichever the
  surrounding file uses.
- **Comments:** a one-to-three-line header at the top of each module stating
  its role, JSDoc on exported helpers with non-obvious contracts. Match that
  density; don't narrate implementation lines.
- **State access:** one Zustand selector per value:
  `const undo = useStudio((s) => s.undo);`. Outside React, use
  `useStudio.getState()`.
- **Styling:** Tailwind CSS v4, CSS-first — there is **no**
  `tailwind.config.js`. Theme tokens live in `src/styles.css` under
  `@theme inline`; that file documents the exact two-step recipe for adding a
  color. UI primitives come from `src/components/ui` (shadcn new-york, cva,
  `cn()` from `@/lib/utils`); icons from `lucide-react`.
- **Commits:** short lowercase summary line, present tense, no
  conventional-commit prefixes (`add mesh behavior on characters`,
  `migrate from dom to pixi js`).

---

## 6. Testing

Environment: Vitest 4 + jsdom, config in `vitest.config.ts`, global setup in
`src/test-setup.ts`. `globals: true` is on, but every existing test imports
explicitly from `"vitest"` — do the same.

The repo's four test idioms — pick the one that matches your change:

1. **Pure-function unit tests** (the default): test boundary helpers and math
   directly with real inputs — `html.test.ts`, `transform-box.test.ts`,
   `scenes`-adjacent tests. Most code here is written as pure functions
   precisely so it can be tested this way; put logic in a pure helper module
   (like `stage-helpers.ts`) rather than inside a component, then test the
   helper.
2. **Store tests with a mocked core** (`store.test.ts`): `vi.hoisted()`
   counters + `vi.mock("@hyperframes/core", ...)` to assert _which_ mutation
   helpers get called. This is the **only** place core is mocked — everywhere
   else uses the real package, which works because `vitest.config.ts` inlines
   `@hyperframes/core` and `@hyperframes/studio` through Vite. (The `CLAUDE.md`
   line saying core must always be mocked predates that config — real-core is
   the canonical pattern now. [VERIFY: update CLAUDE.md wording])
3. **Source-contract "integration" tests**
   (`*.integration.test.ts`, e.g. `Inspector.integration.test.ts`): they
   `readFileSync` the component's `.tsx` source and assert wiring markers
   exist (`expect(source).toContain("<VoiceLipSyncPanel")`). **When you edit a
   component, expect its integration test to need matching marker updates —
   update the markers to describe the new truth; never delete assertions just
   to go green.** When you add significant wiring, add markers for it.
4. **Parity locks**: `preview-parity.test.ts` (preview and export stage
   byte-identical files), `mesh-deform.test.ts` (embedded mesh source matches
   the module), `transform-reader-invariant.test.ts`. If one of these fails,
   your change broke a cross-cutting contract — fix the change, not the test.

Fixed test facts:

- GSAP is **globally mocked** in `src/test-setup.ts`; timelines record calls in
  `_calls` for inspection. Never import real gsap behavior in tests.
- There is no fake-indexeddb. Test `db.ts` logic through its pure exports
  (`db.test.ts`), or `vi.mock("../../db", ...)` where blob access matters
  (`preview-parity.test.ts`, `project-files.test.ts`). Never drive a live
  Dexie instance in a test.
- Character test fixtures live in
  `src/studio/character/__tests__/fixtures.ts` plus `character-utils.ts`
  helpers (`createBlankCharacter`, `makePart`) — reuse them.

**What tests cannot verify:** anything visual or interactive — stage
drag/resize/rotate feel, Pixi character rendering output, playback sync,
lip-sync mouth motion, MP4 output, ElevenLabs round-trips, layout/theme. Any
change touching those is **not done** until a human confirms it per §10.

---

## 7. Recipes

### Add a store mutation that edits the movie

1. Add the signature to the `StudioState` interface (`store.ts:1075`), with
   `options?: ProjectMutationOptions` if UI may drive it interactively.
2. Implement using the §4 shape exactly (checkpoint → boundary mutation →
   `commitEditingRootHtml` → `set` → `scheduleSave`).
3. Test in `src/studio/__tests__/store.test.ts` (mock-core call counting) or,
   if the interesting logic is HTML-shaping, extract it into
   `src/studio/hyperframes/` and unit-test it there with real core.

### Add a persisted per-clip attribute

1. Extend `StudioTimelineElement` and the read/write patch logic in
   `src/studio/hyperframes/html.ts` (write in `patchStudioElementInHtml`, read
   in `parseStudioHtml`'s native-attr patch).
2. Surface it on `EditorClip` in `types.ts` + `deriveEditorClips`.
3. If export needs it normalized, handle it in `hyperframes/native.ts`.
4. Add cases to `html.test.ts` (and `native.test.ts`); run
   `preview-parity.test.ts`.
   Never invent a new `data-*` spelling when a native HyperFrames attr exists.

### Change the Dexie schema

Append a new `this.version(10).stores({ ... })` block in `db.ts` — copy the
whole table map forward; **never edit an existing version block** (v8/v9 show
the pattern, including the `movements: null` tombstone for dropping a table).
Add an `.upgrade()` only for data rewrites. If the stored `Project` shape
breaks compatibility, extend the `isCurrentProjectShape` load guard.

### Add a local API endpoint

Add a `pathname` branch in the middleware in
`src/studio/hyperframes/render-plugin.ts` (existing routes:
`POST /api/hyperframes/render|preview-bundle|thumbnail`,
`GET /api/hyperframes/result/<id>`, `GET /api/hyperframes/runtime/*`,
`GET /api/elevenlabs/voices`,
`POST /api/elevenlabs/text-to-speech/<voiceId>[/with-timestamps]`,
`POST /api/elevenlabs/forced-alignment`). Client wrappers live in
`lipsync/tts.functions.ts` / `export/render-client.ts`. This file is the only
Node-side code in the app; provider keys stay here (§9). Cover it in
`render-plugin.test.ts`. MP4 rendering shells out via
`spawn("npx", ["hyperframes", ...])` with `HYPERFRAMES_NO_UPDATE_CHECK: "1"`.

### Character rig / authoring change

1. Author operations go through `applyCharacterSceneCommand`
   (`character/scene-commands.ts`) as renderer-neutral scene-graph commands —
   never poke Pixi objects or composition HTML from the editor.
2. Rendering changes must land in **both** runtimes by hand:
   `character/pixi-preview-runtime.ts` (editor preview/recorder) and the inline
   script template in `character/pixi-composition.ts` (generated composition).
   They are deliberately mirrored; changing one without the other is the #1
   character regression.
3. Rebuild flows through `refreshCharacterCompositions` /
   `buildCharacterCompositionHtml` — the stored composition source is what
   preview _and_ export render.
4. Character part artwork is **SVG-only** (`importMediaFile` throws otherwise).
5. Mesh/flexible parts: new work uses the `limb-path` model (a seek-updated
   `MeshSimple` ribbon; scene nodes retain `meshKind: "rope"`);
   `mode: "bend"` is legacy read-only. Keep mesh features inside the generated
   composition source and keep `preview-parity.test.ts` +
   `mesh-deform.test.ts` green.

### Speech / lip sync change

Viseme timing and transcript belong to the **audio `MediaAsset`**
(`setMediaVoiceData` in `db.ts`), never to the character clip. Clips place
speech via `character.speeches`; the character composition serializes each as a
HyperFrames `<audio>` clip. Never add root-timeline audio siblings for
character speech. After changing an asset's visemes, call
`rebuildClipsUsingAudio(audioId)`.

### New editor panel / component

`PascalCase.tsx` in `src/studio/components/`, named export, `useStudio`
selectors, shadcn primitives + Tailwind classes, lucide icons. Selection/
transform interactions must reuse `interaction/TransformMoveable` +
`interaction/transform-box.ts` — the box math is shared across Stage,
character editor, and recorder on purpose; do not fork a fourth copy. Add a
source-contract integration test if the panel wires store actions.

---

## 8. Anti-patterns (each of these has actually been rejected here)

- Drawing a React/DOM copy of a clip to preview drag/resize/rotate instead of
  editing the real iframe element through `player-editing.ts`.
- Using a `blob:` URL as the player `src`. The player appends shader query
  params to `src`, which breaks object URLs — Stage must use `srcdoc`.
- Adding shader-transition plumbing (`shader-capture-scale`, `shader-loading`)
  — explicitly deferred until there's a shader test composition.
- A second `useTimelinePlayer()` call "for convenience".
- Editing composition HTML with string `.replace()` instead of boundary
  helpers.
- Reintroducing DOM character rendering, `character.renderer` switches, or the
  retired generated mouth rig (`mouthStyle: "rig"` is load-only legacy).
- Writing `VITE_ELEVENLABS_API_KEY` or reading the key client-side.
- Renaming `motionPresets`/`MotionPreset`/`character.motions` in storage.
- "Fixing" a source-contract integration test by deleting its assertions.
- Running `npm test` in automation and waiting forever (it's watch mode).
- Fixing the tsc/lint baseline inside an unrelated feature diff.

---

## 9. Errors, logging, config & secrets

- **Errors:** store actions validate preconditions and return early (`if (!p)
return;`). Async persistence surfaces failures through store state
  (`saveStatus: "error"`, `saveError`) — follow that pattern for anything the
  user must see; don't `alert()` and don't swallow. `saveProject` rethrows
  after recording the error. Typed domain errors exist where recovery differs
  (`CharacterPinRigError`).
- **Logging:** sparse `console.warn` for degraded-but-working situations (e.g.
  a character whose retired mouth rig is skipped). No logging framework; don't
  add one. Remove debug `console.log` before finishing.
- **Config:** all env config is server-side via `loadEnv` in `vite.config.ts`.
  The only variable is `ELEVENLABS_API_KEY` in untracked `.env`. It is read by
  the render-plugin middleware; changing `.env` requires restarting
  `npm run dev`. Never expose a provider key with a `VITE_` prefix and never
  put keys in client code. The app works without the key (speech features show
  errors).
- **User data:** everything lives in the browser's IndexedDB (database
  `hyperframes-studio`). There is no backup flow; treat destructive Dexie
  operations (table drops, migrations) as danger-zone changes.

---

## 10. Human verification & handoff summary (required)

End **every** change with a plain-language summary containing:

1. **What changed** — files and behavior, one short paragraph.
2. **What was verified automatically** — the exact commands run
   (`npx vitest run`, `npx tsc --noEmit`, `npm run lint`) and their results,
   including "no new tsc errors beyond the store.ts baseline".
3. **Manual test steps** — for anything UI- or output-affecting, explicit
   steps a human can follow blind:
   - which command starts the app (`npm run dev`, open
     `http://localhost:8080`),
   - where to go (Dashboard → open/create a project → which panel: Library /
     Stage / Timeline / Inspector tab / character editor),
   - what to click, drag, or type,
   - the expected visible result (and the expected _export_ result if render
     is affected — MP4 via the TopBar render/download flow).
4. **The flag**: any change touching UI, playback, character rendering,
   speech, or export must state explicitly:
   **"Needs human confirmation — not done until manually verified."**
   Automated green is not done for user-visible work.

---

## 11. Dependencies

Adding or upgrading anything requires human sign-off first. The installed
majors you must write against (see `package.json` for exact ranges):

| Package           | Version                                                 | Watch out for                                                                                                                                               |
| ----------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| react / react-dom | 19.x                                                    | —                                                                                                                                                           |
| zustand           | 5.x                                                     | `create<T>()(...)`-style store already set up; extend, don't re-create                                                                                      |
| dexie             | 4.x                                                     | schema versioning rules in §7                                                                                                                               |
| pixi.js           | **8.x**                                                 | v8 API only: `new Application()` + `await app.init()`, `Assets.load`, `MeshRope`/`MeshPlane`. No v7 idioms. Consult `.claude/skills/pixijs-*`               |
| gsap              | 3.x                                                     | inside compositions it must stay seek-driven/deterministic                                                                                                  |
| tailwindcss       | **4.x**                                                 | CSS-first; no config file; `@theme inline` in `src/styles.css`                                                                                              |
| @hyperframes/\*   | **0.5.3** (core, studio, player, producer, engine, CLI) | pinned family — upgrade all together, then re-audit the `hyperframes/html.ts` + `native.ts` patch layers, which exist specifically to paper over 0.5.3 gaps |
| eslint            | 9.x flat config                                         | edit `eslint.config.js`, not `.eslintrc`                                                                                                                    |
| vitest            | 4.x                                                     | config in `vitest.config.ts`; keep `server.deps.inline` for hyperframes packages                                                                            |
| react-moveable    | 0.56.x                                                  | only via `interaction/TransformMoveable`                                                                                                                    |
| vite              | 7.x                                                     | dev-server middleware pattern in `render-plugin.ts`                                                                                                         |

Banned/discouraged: bun (stale artifacts only), any second animation runtime in
editor code, routing libraries (two-view SPA is deliberate), state libraries
other than Zustand, CSS-in-JS, logging frameworks, fake-indexeddb.

Node builtins in client code are shimmed (`src/shims/`) for bundled deps —
never import `node:fs`/`node:path`/etc. in app code; only
`render-plugin.ts` (Vite middleware) and test files may use Node APIs.

---

## 12. Danger zones

- **`src/studio/store.ts` (3k lines).** Every mutation, the save-generation
  guard, and undo live here. Deviating from the §4 shape breaks undo or
  autosave silently. Also currently carries the known tsc baseline (§2).
- **`character/pixi-composition.ts` inline script + `mesh-deform.ts`.**
  Functions from `mesh-deform.ts` are embedded into generated HTML via
  `Function.prototype.toString()` — they must stay fully self-contained: no
  imports, no outer-scope references, no TS-only syntax beyond type
  annotations. `mesh-deform.test.ts` locks this.
- **The hand-mirrored Pixi pair** (`pixi-preview-runtime.ts` ↔ the inline
  script in `pixi-composition.ts`). No shared import ties them; only
  discipline and the parity tests do.
- **`hyperframes/html.ts` + `hyperframes/native.ts` patch layers.** They
  compensate for `@hyperframes/core@0.5.3` dropping native attrs. Attribute
  spellings here are load-bearing for preview _and_ export; change with tests
  on both sides.
- **`hyperframes/keyframes.ts`.** Rewrites GSAP scripts inside `rootHtml`;
  guarded by `transform-reader-invariant.test.ts` and `keyframes.test.ts`.
- **Undo correctness** depends on every mutation checkpointing before
  mutating, and interactive paths passing `{ history: false }` mid-gesture.
- **Source-contract integration tests** fail on refactors that are otherwise
  correct — update markers deliberately, in the same commit.
- **`dist/` is build output** — never edit it. `character-previews/` holds
  two starter-character SVGs that nothing in `src/` references today — leave
  it alone. [VERIFY: possibly deletable]

---

## 13. Glossary

- **HyperFrames** — the HTML-based video framework (`@hyperframes/*`); a movie
  is HTML + GSAP timelines registered on `window.__timelines`.
- **Composition** — one renderable HTML document; the root composition is the
  film, sub-compositions live in `project.hf.compositionHtml[id]`.
- **Clip / element** — a timed element (`data-start`, `data-duration`) in a
  composition; parsed form is `TimelineElement` (core) / `EditorClip` (studio).
- **Scene** — a root-level composition clip (`compositionKind: "scene"`,
  id `comp_<sceneId>`) that holds a segment of the movie; most editing targets
  the _active_ scene.
- **`asset:<id>`** — placeholder media ref in stored HTML; Stage resolves it to
  a Dexie blob URL for preview, export rewrites it to `assets/<id>.<ext>`.
- **Boundary adapter** — a `src/studio/hyperframes/*` module that wraps a
  `@hyperframes/core` seam (`html.ts`, `native.ts`, `player-editing.ts`).
- **Chrome** — editor-only overlay UI (selection boxes, handles, guides);
  allowed; must never render movie content.
- **Source parity** — the invariant that preview, playback, and export consume
  identical `project.hf` bytes.
- **Character composition** — generated Pixi-in-HyperFrames source for a
  character clip; rebuilt from `CharacterPreset` + `CharacterClipMeta`.
- **Rig / slot / variant / part** — renderer-neutral character anatomy:
  bones + sockets (rig), semantic positions (slots), interchangeable artwork
  (variants/parts).
- **Pose** — untimed slot→variant selection. **Action** — timed body
  animation, optionally region-scoped. **Expression** — timed facial animation
  on its own subtrack. **Speech** — placed audio + visemes. **Stage motion** —
  moving a whole clip across the canvas (checkpoints/steps). Stored under
  legacy names `MotionPreset`/`AppliedMotion`/`character.motions`.
- **Viseme** — mouth shape keyed to audio time (`VisemeEntry { t, v }`), owned
  by the audio `MediaAsset`.
- **`editorMeta`** — editor-only project state (track rows, lanes, names,
  scene list); never exported, never rendered.
- **Flexible / limb-path** — opt-in mesh deformation for a part
  (`CharacterPart.deform`), rendered as a seek-updated `MeshSimple` ribbon;
  legacy `bend` mode reads through `MeshPlane`.

---

## 14. If you're unsure

- **Default behavior:** find the nearest existing example of what you're
  attempting (same directory first, then §7's recipes), mirror it, and keep
  the diff minimal. If no example exists, that is a signal — say so in your
  handoff summary rather than inventing a new approach.
- **Architecture doubts** (a second source of truth? a new boundary? a
  renderer change?): stop and write the question + your recommendation in the
  handoff summary instead of coding it. `CLAUDE.md` and `docs/` probably
  already answer it.
- **A parity/lock test fails and you don't see why:** treat your change as
  wrong until proven otherwise. These tests encode the product's core
  invariant.
- **You can't verify a user-visible behavior yourself:** ship it explicitly as
  "needs human confirmation" (§10). Never mark UI work done on green tests
  alone.
- **Something in this file looks wrong or stale:** it might be — anything
  tagged [VERIFY] awaits human confirmation. Flag discrepancies in your
  summary; don't silently diverge.
