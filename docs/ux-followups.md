# UX follow-ups

Open UX/UI issues, most important first. Derived from the 2026-08-02 UX audit;
the vocabulary pass from that audit is done and canonized in
`docs/ui-vocabulary.md`.

---

## 1. Playback stops at the end of a scene — FIXED 2026-08-03 (Option A)

**Resolution.** Stage now previews the whole film at all times
(`src/studio/components/Stage.tsx`); `activeSceneId` scopes *editing* only.
Timeline clips already carried absolute film time, so seeking is now plain
absolute time and scrubbing across a boundary no longer reloads the iframe.
Playing one scene is a **play button on the scene chip** — an action, not a mode.
It seeks to the scene start, starts playback, and arms a stop time for that single
run; nothing stays toggled and the edit scope is untouched. Scrubbing cancels the
armed stop, so taking over manually never leaves a stale boundary behind.

Two earlier attempts were worse and were removed: a "Stop at end of scene" text
button in the transport (a sentence-long label among icons, detached from Play),
then a lock on the scene chip (a mode, and "lock" already means "ignores canvas
clicks" for tracks and clips — a vocabulary collision).

The change was gated on whether clips inside a scene composition stay addressable
from the root document. They do: `bundleToSingleHtml` inlines sub-compositions
into **one document with no nested iframe**, and leaf clip ids survive verbatim
(the composition's *inner root* is rewritten to `data-hf-authored-id`, but hosts
and leaves keep their ids). So `contentDocument.getElementById(clipId)` still
reaches them, and `player-editing.ts` needed no changes.

Two things to remember:

- Anything addressing a *composition root* by authored id will not find it after
  bundling. Clip-level addressing is unaffected.
- If one `compositionId` were ever placed by two clips, inner ids would collide
  in the single document. Studio mints a unique `comp_<sceneId>` / `comp_<clipId>`
  per clip, so this is currently safe — worth re-checking if `duplicateScene`
  ever starts sharing a composition.

Locked by `Stage.integration.test.ts` and `Timeline.integration.test.ts`.

<details>
<summary>Original diagnosis</summary>

**Symptom.** Press play and the film plays one scene, then stops. The transport
keeps showing the whole-film duration, so it reads as a broken play button.

**Cause.** Stage previews a scene-scoped project, not the film.

`Stage.tsx` builds its `srcdoc` from `buildSceneEditingProject(project, activeSceneId)`
(`src/studio/components/Stage.tsx:616-618`). When `activeSceneId` is set, that
helper swaps `hf.rootHtml` for the scene's **sub-composition** HTML and sets
`hf.duration = scene.duration` (`src/studio/scenes.ts:126-141`). The player
document therefore contains one scene and a duration equal to that scene. It
plays to that end and stops, correctly, because the rest of the film is not in
the document.

Three things make this read as a bug rather than as a scoped preview:

1. **The transport contradicts it.** `Timeline.tsx` renders
   `fmtTime(rootProject.hf.duration)` as the total — the whole film — while the
   playhead can only ever reach the end of the active scene.
2. **Nothing announces the scope.** The only indicator is which chip is lit in
   the scene strip's 160px header column.
3. **Editing forces the scoped mode.** Clicking any clip calls
   `activateTimelineClip` → `setActiveScene(clip.sceneId)`
   (`src/studio/components/Timeline.tsx:328-330`). So the moment a user touches
   anything, they are in single-scene playback.

**Whole-film playback already works** — it is the `activeSceneId === null` path,
reachable via the "Project" chip in the scene strip
(`src/studio/components/TimelineSceneStrip.tsx:127-136`). Cross-scene *seeking*
also already works: `seekProjectTime` maps a project time to the owning scene,
switches to it, and re-seeks locally. Only continuous playback across a boundary
is missing, because nothing advances the active scene when the player ends.

### Candidate fixes

**A. Always preview the film; scope editing only (recommended).**
Stage renders the real `project.hf.rootHtml` at all times. `activeSceneId` keeps
scoping selection, the Inspector, and mutation, but stops scoping the rendered
document. Playback and the transport then agree with the timeline by
construction, and no scene-boundary reload is needed.

_Risk to check first:_ stage editing addresses real elements inside the player
document (`hyperframes/player-editing.ts`, the click-rect measurement, and
`useElementPicker`). Clips that live inside a nested scene composition may not be
addressable from the root document. If they are not, this fix needs a way to
reach into the nested composition's document — which is the same capability
nested-composition editing needs anyway (see
`docs/ai-generated-hyperframes-clips-roadmap.md`).

**B. Auto-advance at the scene boundary.**
When the player reaches the end of the active scene, switch to the next scene and
continue. Small change, but each boundary swaps `srcdoc`, which fully reloads the
iframe — black flash and a GSAP re-boot mid-playback. Acceptable as a stopgap,
not as the answer.

**C. Make the current scoping legible.**
Show scene time and a "Previewing: Scene 2 / Whole film" control in the transport.
This makes the tool honest but does not give the user what they asked for, so it
is only worth doing as a companion to A or B — not instead of them.

**Recommendation:** A, gated on the addressability check. B only if A is blocked
and the fix is needed before nested-composition editing lands.

</details>

---

## 2. Drag and drop — FIXED 2026-08-03

Media tiles, text blocks, and characters are all draggable, onto either target:

- **Canvas** — the drop point sets position, the playhead sets start time.
- **Timeline track** — the drop x sets start time, the row and y set track and lane.

Clicking still adds at the defaults, so nothing that worked before stopped working.

The three tabs each used to build their own clip inline, hardcoding a centred
position and `start: 0`. That is now one path: `src/studio/library-items.ts` holds
the drag payload (a custom MIME type so a Library drag is distinguishable from a
file or URL drop), the text/character clip builders, and the sizing and clamping
rules; `store.addLibraryItem(item, placement)` is the single entry point both the
buttons and the drop handlers call. A dropped clip and a clicked clip are
therefore constructed identically.

`topLeftFromCenter` clamps to the canvas, so a wide block dropped near an edge
lands fully on screen instead of hanging off it. Malformed drag payloads are
rejected rather than producing a broken clip. Covered by
`src/studio/__tests__/library-items.test.ts` (behavioural) plus source assertions
in `Library.integration.test.ts`.

**Not yet verified in a browser.** Drag-and-drop behaviour — the drop indicator,
`dragLeave` when moving between tracks, and drops onto the iframe area of the
canvas — cannot be exercised by these tests.

## 3. Rigger controls in beginner panels — FIXED 2026-08-03

`CharacterRigPresetPanel` (Rebuild bones, Root Depth, Slot Depth, angle dropdown
with `" (add)"` options) wrote to the shared character, changing every clip using
it. Deleted rather than migrated: the Character Editor's `CharacterRigSetupControls`
already has strictly better versions — Bone Depth and Slot Depth for the *selected*
bone/slot rather than an arbitrary first binding, a Rebuild skeleton button, and
angle switching in the toolbar. The Inspector's Acting tab now links to the
Character Editor instead, with a tooltip saying the change affects every clip.

Delete clip also moved out of "More" → "Danger" into the Inspector header, where
it is reachable from any tab.

## 4. Type scale — FIXED 2026-08-03

All 275 arbitrary `text-[Npx]` values across 32 files collapsed to two utilities
defined in `src/styles.css`: `text-ui` (13px) and `text-ui-sm` (11px). Section
labels are `text-ui-sm uppercase tracking-wider`. The 8/9/10px sizes are gone;
11px stays 11px. Guarded by `ui-vocabulary.test.ts`.

**Not yet verified visually.** The size increases (8→11, 9→11, 10→11, 12→13) can
push dense rows — timeline lane headers, pose chips, the recorder's stamp strip —
into wrapping or overflow. Worth one pass with real content before considering
this closed.

## 5. Native `confirm()` / `alert()` — FIXED 2026-08-03

All eleven sites now use `ConfirmDialogProvider` / `useConfirm` / `useNotify`
(`src/studio/components/ConfirmDialog.tsx`), a promise-based replacement that keeps
the imperative shape of the old calls. Destructive confirms are styled as such and
name the action ("Delete character") instead of "OK". The character-delete copy
that used to be `\n`-joined into an OS alert now renders as real paragraphs.

## 6. The AI JSON surface — FIXED 2026-08-03

There is now an **Ask AI** pane at the top level (`Ask AI` in the top bar, sharing
the Inspector rail). Three steps: copy prompt → paste reply → approve.

- **Context OUT** — `ai/project-control-surface.ts` builds a JSON document of the
  film (project settings, scenes, every clip with its timing and transform, plus
  the available actions and text blocks) and the operations the model may propose.
  The advertised operation list and the accepted one are the same constant, so
  what we ask for is exactly what we can apply.
- **Suggestion IN** — `ai/project-suggestions.ts` parses a pasted reply into
  reviewable rows. It never throws; malformed JSON, an unknown `op`, a clip id
  that does not exist, an action aimed at a non-character clip, or a transform
  with no fields each become a row-level error explaining the problem.
- **Review** — every operation is a row showing a plain-language summary and its
  before → after, plus the model's own `why`. Applicable rows start approved, so
  reviewing means removing what you disagree with. Rows with errors are shown but
  cannot be approved.
- **Apply** — approved operations run through the ordinary store actions, so an AI
  edit lands in undo history exactly like a hand edit.

v1 operations: `setClipTiming`, `setClipTransform`, `setTextContent`, `addAction`,
`addTextBlock`. Covered by `ai/__tests__/project-suggestions.test.ts` (12 cases
against a real store-built project).

Worth extending later: deleting clips, adding characters and media, scene-level
operations, and a repair-prompt button reusing `buildJsonRepairPrompt` for when
the model returns something invalid.

## 7. Library tab grid and character entry points — FIXED 2026-08-03; BLOCKS REMOVED 2026-08-09

The Library now has four tabs in a `grid-cols-2` (Media / Text / Characters /
Actions). The retired pasted-composition Blocks surface and its Advanced toggle
are gone. The Characters tab now leads with one "+ Add a character" button that
opens four labelled choices (ready-made presenter, male, female, own artwork)
instead of three competing peer buttons. "Add to scene" also stopped using a
washed-out `bg-primary/30` that read as disabled.

## 8. Effects — DONE 2026-08-09

Characters could pick an Action from a library; every other clip had to be
keyframed by hand. `src/studio/hyperframes/effect-presets.ts` closes that
asymmetry: Fade in, Fade out, Slide in from left/right, Rise up, Pop, Slow zoom.

They are **Effects**, not Moves. Most of them do not move the clip at all — Fade
is opacity, Pop and Slow zoom are scale — so filing them under Move named them
after their storage rather than their meaning. The Inspector tab is now
`Effects`, with the hand-built path editor beneath as `Move along a path`.

They are not a new concept in the data — `applyEffectPreset` expands one into
ordinary keyframes plus a Move step and commits it through the same path a
hand-built Move uses, so the Points it creates are editable, undoable, and
exportable identically. Distances are expressed in clip widths/heights, so a
preset lands correctly on any clip size, and spans are capped so an entrance on a
40s clip is still an entrance.

The AI control surface advertises them as an `addEffect` operation, which gives the
model something far better to propose than raw coordinates and makes the review
row read as a sentence ("Title: Fade in") instead of numbers.

Covered by `hyperframes/__tests__/effect-presets.test.ts` — including a case that
caught a real bug where the minimum-span guard pushed a fade-out past the end of
a very short clip.

## 9. Onboarding

The Character Editor's Build → Rig → Pose phase model is the best onboarding idea
in the codebase and has no equivalent at the studio level. The dashboard's
first-run state is a blank grid with no orientation and no template project.
