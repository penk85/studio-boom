# Studio Boom — Code Audit (2026-07-07)

Full-repo review and audit: correctness, data safety, security, performance,
memory/resource lifecycle, and maintainability. Companion to `AGENTS.md`
(operational rules) and `CLAUDE.md` (architecture contract).

**Original scope & method.** Manual review of the store, persistence, boundary adapters,
Vite middleware, Stage/Timeline/Inspector/CharacterEditor/Recorder, the Pixi
character pipeline, export/import, and the then-current uncommitted working-tree
diff. At audit time, verification was 60 files / 621 tests green, with 13 known
TypeScript errors and four formatting errors. Those gate failures were
subsequently fixed; this paragraph is historical evidence, not the current
baseline.

**Historical tree state at audit time:** commit `ed41ff0` plus a ~1,400-line uncommitted
diff (in-progress flexible-limb "mesh locks" feature; reviewed in §5).

**Current status (2026-07-26):** H1–H4 and M1–M6 are addressed. Project
editing now takes an origin-scoped Web Lock before load-time writes; Dashboard
rename, duplicate, and delete use the same exclusive boundary and re-read the
latest stored project after acquiring it. A second tab is refused while the
first edits, then can open the project after the first saves and returns to the
Dashboard. M7's dedicated cleanup is complete for this cycle: its remaining
controller-heavy files have explicit ownership, and Character Editor's safe
document, resource, and interaction seams have been extracted without creating
a second renderer or prop-dump façade. M8 is mitigated with an explicitly
documented architectural remainder. M9 is reserved for the dedicated compatibility process in
`docs/hyperframes-upgrade-safety-plan.md`. L1-L3, L6, and L8 are addressed; L4,
L5, and part of L7 remain open. L9 is a future-path guard rather than a currently
reachable defect.

**Current validation (2026-07-26):** `npx vitest run` passes 84 files / 746
tests; `npx tsc --noEmit`, `npm run lint`, `npm run build`, and
`git diff --check` are clean. The build retains only the known dependency
annotation and large-chunk warnings.

Severity scale: **High** = data loss, security exposure, or broken gate.
**Medium** = will bite users/devs under normal use as the app grows.
**Low** = smell or foot-gun; cheap to fix, not urgent. Each finding has a
failure scenario so it can be re-verified or dismissed deliberately.

---

## 1. High

### H1. `loadProject` silently deletes projects that fail the shape guard

**Addressed 2026-07-19:** incompatible project rows are preserved instead of
deleted, and source-contract coverage prevents the destructive load path from
returning.

- **Where:** `src/studio/store.ts:1358-1366`
- **What:** if `isCurrentProjectShape(storedProject)` returns false, the code
  runs `db.projects.delete(id)`, deletes the thumbnail, and opens a blank
  project. The user's data is gone permanently — this is a local-first app
  with **no backup/restore flow** (README states this).
- **Failure scenario:** any future edit that makes `isCurrentProjectShape`
  stricter (it already rejects several legacy meta shapes,
  `src/studio/db.ts:211-246`) turns "open old project" into "erase old
  project" for every project created before the change. No error, no undo, no
  export path first. A single wrong predicate tweak = mass data loss.
- **Recommendation:** never delete on load. Quarantine instead: keep the row,
  mark it incompatible, surface a "this project needs migration / export raw
  data" card in the dashboard. At minimum, copy the row to a
  `projectsQuarantine` table (or download a JSON dump) before deleting.
  Treat `isCurrentProjectShape` changes as danger-zone diffs requiring a
  migration plan.

### H2. Dev middleware is network-exposed with no origin checks

**Addressed 2026-07-19:** Vite binds to `127.0.0.1` by default and the local API
middleware rejects requests from untrusted origins. Integration tests lock the
host/origin boundary.

- **Where:** `vite.config.ts:20` (`server: { host: "::", port: 8080 }`) +
  `src/studio/hyperframes/render-plugin.ts:61-113` (no Origin/Host validation,
  no CORS headers, no auth).
- **What:** the dev server binds all interfaces. The middleware exposes, to
  anyone who can reach port 8080:
  - `/api/elevenlabs/*` — a proxy that spends **your ElevenLabs API key**;
  - `/api/hyperframes/render|thumbnail` — accepts arbitrary file uploads into
    the temp dir and spawns `npx hyperframes render` (headless browser +
    ffmpeg-class CPU work);
  - `/api/hyperframes/preview-bundle` — bundling of posted HTML.
- **Failure scenario:** (a) anyone on the same LAN/coffee-shop network drains
  ElevenLabs credits or turns the laptop into a render farm; (b) CSRF-style —
  responses aren't readable cross-origin (no CORS headers, which is good), but
  a malicious web page open in the user's own browser can still _fire_ blind
  `multipart/form-data` POSTs at `http://localhost:8080/api/...`, triggering
  key spend and render jobs without reading the results. Vite's own
  `allowedHosts` protection does not cover these routes: `configureServer`
  middlewares run before Vite's internal middleware stack.
- **What is already done right:** path traversal is handled
  (`safeRelativeFilePath` rejects `.`/`..`/NUL and rebuilds relative paths);
  `handleResult` looks up results by server-generated UUID only; runtime file
  serving uses `path.basename` against a two-name allowlist.
- **Recommendation:** default `host` to `127.0.0.1` (make LAN exposure an
  explicit opt-in env flag); reject `/api/*` requests whose `Origin`/`Referer`
  is present and not the dev origin, or require a simple shared token header
  the client injects. This is a dev-only server today, but it is also the only
  server this product has.

### H3. Render temp artifacts are never deleted from disk

**Addressed 2026-07-19:** result eviction/expiry and failed renders clean staged
directories, and stale temp roots are swept. Render-plugin tests cover the
cleanup lifecycle.

- **Where:** `src/studio/hyperframes/render-plugin.ts:29-54, 330-353`
- **What:** every render/thumbnail stages the _entire_ project (all media
  blobs) into `tmpdir()/studio-boom-hyperframes/<uuid>/` and writes an MP4.
  `rememberRenderResult` caps and TTL-prunes the in-memory `results` **map**,
  but nothing ever `rm -rf`s the evicted/expired directories or the staged
  project files of failed renders.
- **Failure scenario:** a user iterating on a 500 MB-asset movie renders 20
  times in a session → ~10 GB of orphaned temp data per day. On Linux, `/tmp`
  may be RAM-backed (tmpfs): this eats memory, not just disk, until reboot.
- **Recommendation:** delete `rootDir` when a result is evicted from the map,
  when TTL pruning removes it, and in a `finally` when render throws. A
  startup sweep of `tmpdir()/studio-boom-hyperframes/*` older than the TTL
  would clean up after crashes.

### H4. Typecheck gate is broken by a known one-line hole

**Addressed 2026-07-22:** `activeSceneId` is part of the state contract and
`npx tsc --noEmit` is clean. The public contract now lives in `store-types.ts`.

- **Where:** `src/studio/store.ts:1075` (interface), errors at 13 sites.
- **What:** `activeSceneId` is used in state and in
  `Pick<StudioState, "project" | "activeSceneId">` helpers but is not declared
  on the `StudioState` interface, so `npx tsc --noEmit` fails on main. (Also
  recorded in `AGENTS.md`.)
- **Failure scenario:** while the baseline is red, "tsc must pass" cannot be
  enforced mechanically; new type errors hide in the noise, and every
  contributor has to eyeball 13 known errors to spot the 14th. The scene
  feature — load-bearing for all editing — is exactly where the type checker
  is blind.
- **Recommendation:** land `activeSceneId: string | null;` in `StudioState`
  as its own commit, then treat any red `tsc` as a hard stop from that day on.

---

## 2. Medium

### M1. Per-keystroke / per-tick commits flood undo and thrash the preview

**Addressed 2026-07-19:** continuous speech/text controls checkpoint once and
use history-disabled intermediate updates or local drafts, preserving useful
undo granularity and avoiding unnecessary reload/rebuild churn.

The store's `updateClip` checkpoints history and rebuilds on every call unless
told otherwise. Three UI surfaces call it in tight loops with **no**
`{ history: false }` and no local draft state:

- **Text content, per keystroke:** `src/studio/components/Inspector.tsx:1399`
  `onChange={(e) => update({ content: e.target.value })}`. Typing a 40-char
  title = 40 undo checkpoints (the entire `HISTORY_LIMIT = 50` wiped by one
  sentence), 40 root-HTML mutations, and — because `hf` changes each time —
  40 Stage srcdoc reloads (black flash + GSAP reboot each, see M3).
  Ctrl+Z afterwards un-types one character at a time.
- **Speech volume, per slider tick:** `src/studio/components/VoiceLipSyncPanel.tsx:332`
  (`input type="range"` → `setSpeechVolume`, which has no options parameter at
  all, `store.ts:2181-2194`). Every tick also **rebuilds the character Pixi
  composition** via `updateClip` → `rebuildCharacterCompositionInProject`.
- **Speech start, per keystroke:** `VoiceLipSyncPanel.tsx:301` number input →
  `moveSpeech` without options.

The codebase already contains the correct patterns to copy: Stage keyboard
nudge (checkpoint once + reset timer, `Stage.tsx:1387-1419`) and the
Timeline's speech drags (`onVoiceHistoryCheckpoint` + per-move
`{ history: false }`, `Timeline.tsx:755-771`).

- **Recommendation:** give `setSpeechVolume` an options parameter; drive
  continuous widgets with checkpoint-on-pointer-down + `{ history: false }`
  during movement; hold text in local state and commit on blur/Enter (or
  debounce-commit with the nudge-timer pattern).

### M2. Failed Pixi preview init leaks the WebGL context

**Addressed 2026-07-19:** failed preview initialization destroys the Pixi
application and releases partially acquired texture leases before rethrowing.

- **Where:** `src/studio/character/pixi-preview-runtime.ts`,
  `createPixiCharacterPreview` (~line 96).
- **What:** `new Application()` + `await app.init()` succeed, then
  `loadPreviewTextures` or `buildPixiScene` can throw (e.g. one broken/missing
  asset ref — the code path that throws
  `"Failed to load character texture …"`). The rejection propagates with no
  `try/catch`, so the initialized `Application` (canvas + WebGL context) is
  never destroyed and the caller has no handle to destroy it.
- **Failure scenario:** `PixiCharacterPreview` re-runs its effect on every
  payload change. A character with one bad asset ref means every edit retries
  init and leaks one WebGL context. Browsers cap contexts (~8–16); when the
  cap is hit the browser starts killing the _oldest_ contexts — including the
  "hold" fallback canvas and the Stage player's rendering — with console
  errors and blank canvases.
- **Recommendation:** wrap everything after `app.init()` in
  `try { … } catch (e) { app.destroy({ removeView: true }, { children: true }); throw e; }`.
  Same review for the inline composition script in `pixi-composition.ts`
  (iframe teardown usually saves it there, but preview-bundle iframes get
  recreated too).

### M3. Stage srcdoc effect: comment and dependencies disagree; every save re-resolves

**Addressed 2026-07-19:** the resolve effect is keyed to the rendered
`project.hf` reference and reads the latest project from the store, so timestamp
only saves do not trigger redundant source resolution.

- **Where:** `src/studio/components/Stage.tsx:678-717`
- **What:** the comment says the resolve effect is "Keyed on `project.hf`, NOT
  the whole `project`", but the dep array is
  `[project, projectHf, repairTimelineLanes]` — it re-fires on every `project`
  identity change, including the pure `updatedAt` bump `saveProject` makes
  after each debounced save. Each firing re-runs `resolvePreviewHtml`
  (DOMParser over the whole movie + blob-URL resolution). The only thing
  preventing an iframe reload on those no-op firings is that React compares
  the `srcdoc` string by value.
- **Failure scenario:** correctness currently survives by accident of string
  equality; anyone who adds a nondeterministic byte to `resolvePreviewHtml`
  output (timestamp comment, random id) converts every autosave into a full
  iframe reload. And on large projects the redundant parse work runs ~every
  500 ms during active editing.
- **Also worth knowing:** by design, every _real_ `hf` change (any discrete
  non-stage edit) swaps srcdoc and fully reboots the player iframe (flash +
  GSAP re-init + `timelineReady` re-poll). Combined with M1 this is the main
  perceived-performance risk as movies grow.
- **Recommendation:** make the deps match the intent (`projectHf` only, read
  the latest project via `useStudio.getState()` inside), or early-return when
  `projectHf` is reference-equal to the last resolved one.

### M4. `updateClip` is a monolith; interactive paths pay for everything

**Addressed 2026-07-19:** character composition rebuilds are gated by
`characterCompositionPatchRequiresRebuild`; position, timing placement,
opacity, rotation, and other host-only changes keep the cheap HTML patch path.

- **Where:** `src/studio/store.ts:2034-2125`
- **What:** one function updates editor meta, mutates HTML, recomputes render
  track indices, **rebuilds the character composition**, and prunes assets —
  on every call, even mid-gesture calls with `{ history: false }` (e.g.
  timeline speech drags rebuild the full Pixi composition HTML + validation on
  every pointer move).
- **Failure scenario:** character complexity (more parts/variants/meshes)
  linearly degrades every drag in the app, and the cost is hidden inside a
  generic-sounding store call.
- **Recommendation:** split the "cheap patch" path from the "rebuild" path
  (only rebuild when character-affecting fields changed — the code already
  computes exactly which fields changed), or debounce the rebuild during
  `history: false` bursts and run one rebuild on commit.

### M5. No multi-tab coordination — silent last-write-wins

**Addressed 2026-07-19:** project editing and Dashboard mutations use the shared
origin-scoped Web Lock boundary and re-read stored state after acquiring it.

- **Where:** `src/studio/db.ts` / `store.ts` (absence); no `BroadcastChannel`,
  `navigator.locks`, or Dexie observability anywhere in `src/`.
- **Failure scenario:** the same project open in two tabs (trivially easy —
  middle-click the dashboard): both tabs autosave the whole `Project` row on a
  500 ms debounce; whichever saved last wins and the other tab's edits are
  overwritten wholesale at the next save. No warning, no merge, and both tabs
  _look_ saved. Same story for the media/characters tables hydrating maps at
  open time only.
- **Recommendation:** cheapest meaningful fix is a `navigator.locks` (or
  BroadcastChannel heartbeat) exclusive lock per project id, with a "read-only:
  open in another tab" banner for the loser. Full sync is not needed.

### M6. GPU textures are cached forever within a session

**Addressed 2026-07-20:** editor-side Pixi character previews now acquire
reference-counted leases for each resolved asset URL. Concurrent Character
Editor and Action/Expression Recorder previews continue sharing Pixi's cache;
scene teardown unloads through `Assets.unload` only after the last preview
releases the URL. Failed loads and scene-construction failures release their
partial leases, and the lease coordinator survives Vite hot replacement.

- **Where:** `src/studio/character/pixi-preview-runtime.ts`
  (`loadPreviewTextures` → `Assets.load`); no `Assets.unload` anywhere in
  `src/`.
- **What:** Pixi's global `Assets` cache keys by URL. Blob URLs are stable per
  media id (cached in `db.ts`), so the cache is bounded by "all media ever
  previewed this session" — but it only grows: switching between many
  characters/variants accumulates GPU memory that `app.destroy(...,
{ texture: false })` deliberately doesn't release.
- **Failure scenario:** long character-authoring sessions on integrated GPUs
  degrade (texture eviction, jank) with no obvious cause; refresh "fixes" it.
- **Recommendation:** on character editor/recorder close, `Assets.unload` the
  URLs belonging to characters not currently placed in the project; or track
  URL→refcount alongside the existing `blobUrlCache`.

### M7. Monolithic component files concentrate change risk

**Reduction started 2026-07-21:** the character artwork intake workflow moved
from `CharacterEditor.tsx` into `CharacterArtworkImport.tsx`, while filename
inference and placement defaults moved into the unit-tested
`character-part-import.ts` helper. The unused 150-line `EyePresetSelector` and
its orphaned preset generator were deleted. The slot-aware layer/variant rail
then moved into `CharacterLayerList.tsx`, including its private hierarchy and
ordering logic. Variant thumbnails, key diagnostics, rig health, and pin
controls now live together in `CharacterVariantControls.tsx` instead of being
scattered through the editor. Canvas and skeleton setup then moved to
`CharacterRigSetupControls.tsx`, backed by shared fields in
`CharacterInspectorFields.tsx`. The next larger pass separated the part, group,
movement, and flexible-mesh inspectors into focused modules behind
`CharacterInspectorPanels.tsx`; shared preview helpers and option sets are now
pure modules rather than component-local logic. Character rigging, reach, mesh,
and group-transform chrome now lives in `CharacterEditorOverlays.tsx`, while
the transform, bounds, fitting, and constraint calculations are isolated in
the unit-tested `character-editor-geometry.ts`. `CharacterEditor.tsx` fell from
8,297 to 4,019 lines without changing the persisted character model or
renderer. At that checkpoint M7 remained open; the later staged reductions are
recorded below.

**Further reduced 2026-07-24:** Stage's editor-only SVG overlays moved into
`StageOverlays.tsx`, motion-path derivation moved into
`stage-motion-paths.ts`, and selection/snap/transform/keyboard calculations
moved into the unit-tested `stage-interactions.ts`. `Stage.tsx` fell from
2,633 to 1,617 lines while retaining playback state, interaction ownership,
and all movie mutations. The remaining Stage controller is still substantial,
but its previously mixed presentation and pure geometry tails are now isolated.

**Timeline reduced 2026-07-24:** scene-strip/ruler UI moved into
`TimelineSceneStrip.tsx`, draggable and trimmable parent clips moved into
`TimelineClipBlock.tsx`, and composition diagnostics, scene-time projection,
lane targeting, and expanded-row packing moved into unit-tested pure modules.
`Timeline.tsx` fell from 2,908 to 1,890 lines while retaining seek/playback
state and all store-mutation wiring.

**Recorder reduced 2026-07-24:** keyframe-stamp, part-list, and transform
property panels moved into `MotionPresetRecorderPanels.tsx`. Pure keypose
loading/navigation, override comparison/defaults, signed scaling, variant
options, and flexible-curve constraints moved into the unit-tested
`motion-recorder-state.ts`. `MotionPresetRecorder.tsx` fell from 3,762 to
2,641 lines. A second pass moved its persistent Pixi playback wrapper, React
draft/onion layers, anchor debugger, and flexible/rotation chrome into
`MotionPresetRecorderPreview.tsx`; constraint and rig-frame calculations now
live in `motion-recorder-geometry.ts`, and both canvas paths share the tested
RAF coalescer in `motion-recorder-interactions.ts`.
`MotionPresetRecorder.tsx` is now 1,585 lines and retains the draft controller,
save/load workflow, and user-action orchestration.

**Character Editor reduced again 2026-07-24:** the header and angle/pose
toolbar moved into `CharacterEditorToolbar.tsx`, while selection frames and
the shared transform adapter moved into `CharacterEditorCanvasChrome.tsx`.
Timestamp-based preview motion and variant selection now live with the other
unit-tested helpers in `character-editor-preview.ts`. `CharacterEditor.tsx`
fell from 4,019 to 3,340 lines without moving persistence, scene commands, or
the persistent Pixi preview lifecycle.

**Character Editor dedicated controller pass 2026-07-26:** undo/redo,
autosave, and current-document refs moved into the tested
`use-character-document.ts`; async alpha-bounds/mask work moved into
`use-character-artwork-analysis.ts`; mouth-test timers, fetch cancellation,
AudioContext/source teardown, and RAF ownership moved into
`use-character-preview-controller.ts`. Canvas hit testing and group
resize/rotation snapshots are now pure, unit-tested functions in
`character-editor-interactions.ts`. All editor gestures use the shared
`startWindowPointerDrag` lifecycle, including pointer-cancel and window-blur
cleanup. `CharacterEditor.tsx` is now 2,994 lines; it retains scene-command and
gesture orchestration rather than hiding the same coupling behind a giant hook.

**Store reduced 2026-07-26:** pure project transformations moved out of the
Zustand action module: asset-manifest upkeep is in `project-assets.ts`,
editor-timeline projection is in `project-timeline.ts`, scene and nested source
operations are in `hyperframes/project-source.ts`, and character composition
rebuilds are in `character/project-compositions.ts`. `store.ts` fell from 3,154
to 2,296 lines while retaining mutation ordering, history, save scheduling, and
all Zustand state ownership.

**Timeline and Store reduced again 2026-07-26:** composition-outline rows,
visual stage-motion rows, and character Action/Expression/speech rows moved
into `TimelineCompositionOutline.tsx`, `TimelineVisualMotionTracks.tsx`, and
`TimelineCharacterTracks.tsx`. `Timeline.tsx` now owns seek/playback/store
orchestration in 795 lines instead of 1,890. The complete public Zustand
contract moved to the type-only `store-types.ts`; runtime actions, history, and
autosave remain in `store.ts`, now 2,085 lines.

- **Where:** `CharacterEditor.tsx` **2,994 lines / 1 top-level component**,
  with the main component spanning ~235–2,993 (≈2,759 lines).
  `MotionPresetRecorder.tsx` 1,585, `store.ts` 2,085, `Timeline.tsx` 795,
  `Stage.tsx` 1,617.
- **What:** these five files are where nearly every regression this quarter
  will land. The source-contract integration tests (which `readFileSync`
  these files and assert markers) make _within-file_ churn safe-ish but make
  _splitting_ the files feel expensive, so they keep growing.
- **Failure scenario:** hook-order bugs and stale-closure bugs remain likely at
  the edges. `PartLayer` still has a deliberately dep-less `useLayoutEffect`
  with an explicit lint suppression; an identity check prevents its state
  update from looping, but correctness depends on that guard staying intact.
- **Recommendation:** adopt a "no new top-level sections in these files" rule:
  new panels/overlays go in sibling modules (the codebase already does this
  well elsewhere — `stage-helpers.ts`, `transform-box.ts`). Update the
  integration tests' paths as sections move; the markers themselves are
  path-agnostic strings.

**Current assessment:** M7 is substantially mitigated and accepted as a
documented residual rather than an urgent cleanup queue. Timeline no longer
qualifies as a monolithic controller. Recorder, Stage, and Store have clear
ownership after their extractions. Character Editor's history, resource
lifecycle, hit testing, and reusable transform math are isolated; its remaining
scene-command/gesture orchestration is still substantial but cohesive. Split it
further only alongside a feature that supplies a real boundary, not to chase a
line-count target with a giant hook or callback interface.

### M8. Same-origin `srcdoc` means pasted blocks run with full app privileges

**Mitigated 2026-07-19, architectural remainder documented:** Library block,
pasted root-project, and Inspector composition-source previews run with
`sandbox="allow-scripts"` and no `allow-same-origin`. Adding a block, applying
composition source, or importing HTML/ZIP now requires explicit confirmation
that the user trusts the executable source; changing the source clears that
confirmation. The editable Stage remains same-origin because the installed
`@hyperframes/studio` picker, computed-style reader, timeline bridge, and live
edit path require direct iframe DOM access. Fully isolating the Stage therefore
remains a larger postMessage-boundary project, not a safe local attribute change.

- **Where:** `Stage.tsx` (player srcdoc), Library → Blocks paste flow,
  Inspector → Source, `project-import.ts` (imported `.hf` zips).
- **What:** `srcdoc` iframes are same-origin with the editor. That is a
  _requirement_ for the player bridge (`window.__timelines`, picker API), but
  it also means any pasted custom block or imported project executes arbitrary
  JS that can read/write the entire IndexedDB (all projects, all media) and
  call the local API endpoints (including the ElevenLabs proxy).
- **Failure scenario:** "here, import my cool title block" on a forum →
  attacker script exfiltrates or wipes every local project next time the
  stage renders.
- **Recommendation:** document this as the current trust model (it is a
  reasonable local-first tradeoff), and route _untrusted_ paste-time
  **validation/preview** through a sandboxed iframe (`sandbox="allow-scripts"`
  - `about:srcdoc` origin isolation) even if final playback stays same-origin.
    Long-term: consider `sandbox` + a postMessage player bridge.

### M9. The pinned dependency graph carries current security advisories

**Partially addressed 2026-07-24; audit count re-verified 2026-07-26; remaining
upgrades require isolated compatibility passes.** Vite was upgraded from 7.3.2 to 7.3.6 within its
existing major, clearing both Vite advisories. `npm audit --omit=dev` now
reports 13 vulnerable dependency entries (9 high, 3 moderate, 1 low,
0 critical). Most arrive through the pinned HyperFrames CLI and engine family
rather than Studio application code: Hono/node-server, `sharp`,
`adm-zip`/ONNX Runtime, `protobufjs`, `js-yaml`, `postcss`, and `ws`. Vite's
transitive `esbuild` also retains a Windows-specific development-server advisory.

- **Actual exposure:** Studio is bound to `127.0.0.1` and currently runs on
  Linux, which materially limits the Vite and Windows path-traversal findings.
  Several Hono advisories concern middleware or deployment adapters Studio does
  not use directly. The image/archive/parser denial-of-service findings remain
  relevant if untrusted input reaches the HyperFrames CLI during import or
  render, although the app's explicit trust prompts reduce that path.
- **Recommendation:** upgrade `hyperframes` and every `@hyperframes/*` package
  together only after checking their published compatibility, then rerun
  preview/export parity and MP4 rendering. Handle the remaining transitive
  packages through those owners where possible. Do not use a blanket
  `npm audit fix`; it cannot resolve the current HyperFrames tree safely and
  would obscure which runtime contract changed. The isolated research,
  automated gate, adapter audit, and manual render matrix are specified in
  `docs/hyperframes-upgrade-safety-plan.md`.

---

## 3. Low

- **L1. Incorrect `"sideEffects": false` — addressed 2026-07-22.** The field
  was removed because this app intentionally has side-effect imports
  (`@hyperframes/player` and `styles.css`).
- **L2. Development forced to production `NODE_ENV` — addressed 2026-07-22.**
  The hardcoded replacement was removed; Vite now supplies its mode-correct
  value. The other browser compatibility definitions remain for bundled
  HyperFrames dependencies.
- **L3. `vite-tsconfig-paths` dependency classification — addressed
  2026-07-22.** The build-time plugin and its lockfile-only dependency chain
  now sit in `devDependencies`.
- **L4. Unused-code detection is fully off** —
  `@typescript-eslint/no-unused-vars: "off"` and `noUnusedLocals: false`.
  Deliberate (AGENTS.md documents it), but with 80k lines and no periodic
  sweep, dead exports will accumulate invisibly. Suggest an occasional manual
  `knip`/`ts-prune` run (not wired into any gate) to keep the boundary modules
  honest.
- **L5. `script-blocks.ts` regex-parses `<script>` tags** — a sanctioned
  exception to the "never string-parse HTML" rule; it's read-only validator
  plumbing, clearly commented. Keep it read-only: the moment something
  _rewrites_ scripts via these regexes, move it behind the core GSAP script
  helpers.
- **L6. Baseline lint debt — addressed 2026-07-22.** The four Prettier errors
  in `StageMoveable.tsx`, `keyframes.ts`, and `transform.ts` were formatted;
  project-wide lint is now expected to be clean.
- **L7. Housekeeping — partially addressed 2026-07-22.** The stale tracked
  `bun.lockb` and `bunfig.toml` were removed; npm remains canonical. The stray
  temporary settings file is no longer present. The old user-owned stash and
  the two unreferenced `character-previews/` SVG assets were deliberately left
  untouched pending an explicit decision about their value.
- **L8. `blobUrlCache` session retention — addressed 2026-07-23.** Closing a
  project now revokes and clears every cached media URL. Per-media revisions
  and a session epoch also prevent an in-flight IndexedDB lookup from
  recreating a URL after deletion/close, while a post-await cache check avoids
  leaking duplicate URLs from concurrent misses.
- **L9. SVG-only enforcement at one entry point — verified 2026-07-23; no
  current bypass.** Every current part-attachment path either imports through
  `importMediaFile(file, { scope: "character-part" })` or duplicates/mirrors
  already validated part art. There is no library-media-to-slot path today, so
  a second rejection at save time would add legacy-character risk without
  closing a reachable bug. If such an assignment path is added, it must assert
  SVG media at that new attachment boundary.

---

## 4. What is in good shape (keep it that way)

- **Hygiene is exceptional for the size:** zero `TODO/FIXME/HACK`, zero
  `as any`, zero `@ts-ignore`, zero `console.log` in app code; the only two
  `eslint-disable`s are shadcn boilerplate.
- **The architectural boundary is intact:** exactly four files import values
  from `@hyperframes/core`; everything else goes through the studio adapters.
  `preview-parity.test.ts` really does lock preview and export to identical
  bytes.
- **Persistence race handling is thought through:** `saveProject`'s generation
  guard keeps newer in-memory edits when a stale debounce lands; `undo`/`redo`
  schedule saves; Stage keyboard nudges checkpoint once with a reset timer.
- **Server input handling is careful where it matters:**
  `safeRelativeFilePath` blocks traversal; result downloads are keyed by
  server-side UUIDs; runtime file serving is allowlisted; the TTS client
  validates inputs and truncates upstream error bodies.
- **Blob URL lifecycles are respected** at the transient sites
  (dashboard import, alpha-bounds probing) and centralized in `db.ts`.
- **Thumbnail regeneration is content-hashed** (FNV over `hf`), so dashboards
  don't re-render unchanged projects.
- **`PixiCharacterPreview`'s race handling** (alive flag, hold-vs-blank
  semantics, late-resolution destroy) is careful — the gap is only the init
  _failure_ path (M2).

## 5. Historical uncommitted diff at audit time

This section is retained as audit history; it is no longer the working-tree
state. The flexible-limb work was committed and subsequently exercised through
the staged mesh debugging and parity passes.

13 files, ~1,430 insertions: an in-progress flexible-limb "mesh locks"
feature (locks pin part of a limb path; attachments follow the deformed path).

- The **hand-mirror discipline held**: `applyRopePathAttachments` and `lockTs`
  handling landed in _both_ `pixi-preview-runtime.ts` and the inline script in
  `pixi-composition.ts`; the new math (`limbPathEndWeight`,
  `limbPathCurveWeight`, `limbPathProjectPointT`, `limbPathTangentAngle`)
  lives in `mesh-deform.ts` and is `toString()`-embedded — and all four new
  functions are correctly self-contained (only `Math`/`Number`).
- New tests came with it (`mesh-deform.test.ts` +27, recorder integration
  +41) and the full suite is green with the diff applied.
- **Historical risk:** ~1,400 lines of the most fragile subsystem were
  uncommitted at the time. That risk is closed; current work should still be
  committed at each human-approved checkpoint.

## 6. Current remaining order

1. Manually verify and commit the final M7 Character Editor/controller checkpoint.
2. Run the HyperFrames-family upgrade as a dedicated compatibility project
   following `hyperframes-upgrade-safety-plan.md`; do not mix it with product
   work.
3. Add periodic dead-code/duplicate-export review for L4 without weakening the
   normal build gates or adding an unapproved dependency.
4. Decide explicitly whether the two unreferenced `character-previews/` assets
   are examples worth keeping; do not delete user-facing assets speculatively.
5. Treat the remaining M8 same-origin Stage boundary as an architectural
   project requiring a postMessage player bridge, not a cleanup patch.
