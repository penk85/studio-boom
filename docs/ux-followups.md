# UX follow-ups

Open UX/UI issues, most important first. Derived from the 2026-08-02 UX audit;
the vocabulary pass from that audit is done and canonized in
`docs/ui-vocabulary.md`.

---

## 1. Playback stops at the end of a scene (reported 2026-08-03)

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

---

## 2. Drag and drop does not exist

The stated human interaction model is drag and drop; every add is a button.
Media tiles, characters, and text blocks all place at a computed centre position
with `start: 0`, ignoring the playhead. HTML5 DnD appears only in scene reordering
and the character editor's SVG import.

Needed: library → stage (drop point sets position, playhead sets start) and
library → timeline lane (drop x sets start, lane sets track).

## 3. Rigger controls sit in beginner panels

`CharacterRigPresetPanel` ("Rebuild 12" bones, Root Depth, Slot Depth, angle
dropdown with `" (add)"` options) writes to the shared character preset, changing
every clip that uses that character. It belongs in the Character Editor. It now
renders once, under the Inspector's Acting tab, rather than twice.

## 4. Type scale is a pro-tool scale

274 hardcoded sub-12px sizes (185 × `text-[10px]`, 74 × `text-[11px]`,
14 × `text-[9px]`, 1 × `text-[8px]`). Collapse to three tokens —
13px body / 11px meta / 11px uppercase label.

## 5. Native `confirm()` / `alert()` for destructive actions

Eleven sites, including character, scene, and project deletion. The character
delete builds a thoughtful multi-paragraph message about downstream clip
references and renders it as an unstyled OS dialog. One `ConfirmDialog` on the
existing Radix `Dialog` retires all eleven.

## 6. The AI JSON surface is buried

`AiAddonPromptPanel` (`src/studio/ai/generated-editor.tsx`) is well designed —
numbered steps, prompt export, paste target, artifact summary, repair prompt —
but is used only by `MotionPresetRecorder`, four clicks deep. `character-json/ai-context.ts`
has the same single consumer. If AI control is half the product thesis, this needs
to be a top-level pane with a reviewable per-item approve/tweak diff, reusing the
existing validate → preview → trust → apply pipeline.

## 7. Library tab grid and character entry points

Five tabs in a `grid-cols-3` wrap to two rows with an orphan cell and truncate in
a 240px rail. The Characters tab opens with three competing "make a character"
entry points.

## 8. Onboarding

The Character Editor's Build → Rig → Pose phase model is the best onboarding idea
in the codebase and has no equivalent at the studio level. The dashboard's
first-run state is a blank grid with no orientation and no template project.
