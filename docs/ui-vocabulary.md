# Studio Boom UI vocabulary

Canonical user-facing labels. **This file governs what the UI says.** Internal
type names, Dexie tables, and HTML attributes are free to keep their legacy
spellings — but no legacy spelling may reach a label, tooltip, placeholder,
empty state, or status message.

Studio Boom's audience is people who have never animated anything, plus an LLM
producing control suggestions for them. Both need one word per concept. The rule
below is not style preference; it is the thing that makes the product learnable.

## The rule

> **One noun per concept, and no noun used for two concepts.**

Before adding a label, check it against the table. If the concept is not in the
table, add it here first.

## Canonical nouns

| Noun            | Means                                                                | Never call it                                                     |
| --------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Clip**        | One thing placed on the timeline — media, text, character, or composition | element, item, layer                                              |
| **Scene**       | A span of the film containing clips                                   | sequence, section                                                 |
| **Move**        | A clip travelling across the canvas over time                         | motion, keyframe group, motion step, tween                        |
| **Point**       | One stop inside a Move. The first and last are **Begin** and **End**  | checkpoint, keyframe, node                                        |
| **Effect**      | A ready-made thing a clip does — Fade in, Pop, Slow zoom               | transition, animation preset, filter                              |
| **Action**      | Repeatable body animation performed by a character                    | motion, motion preset, preset, animation                          |
| **Expression**  | Timed facial animation performed by a character                       | face preset, emotion preset                                       |
| **Pose**        | A held variant map with no timing (standing, folded arms)             | state, stance                                                     |
| **Speech**      | Placed voice audio plus its lip sync                                  | voice line, VO, dialogue track                                    |
| **Track**       | A horizontal band of the timeline (Background, Character, Video, Audio) | layer, row                                                      |
| **Lane**        | A sub-row inside a track, labelled `<Track noun> <n>`                 | V1, A2, BG1, subtrack                                             |
| **Part**        | One piece of character artwork                                        | asset, drawing, layer                                             |
| **Slot**        | A named place on a rig that a Part fills                              | socket, bone (a bone is a different thing)                        |

`Move` and `Action` are the pair most easily confused, and the confusion is the
whole reason this file exists:

- **Move** = the clip goes somewhere on the canvas. Applies to any visual clip.
- **Action** = the character's body does something. Applies only to characters.

A character walking across frame is a **Move** (the clip travels) plus an
**Action** (the legs walk). They are authored in two different Inspector tabs and
must never share a label.

**Effect** is the third noun, and the one most users reach for first. An Effect
is something a clip *does*: appear, disappear, emphasise, drift closer. Most
Effects do not move the clip at all — Fade is opacity, Pop and Slow zoom are
scale — which is precisely why they are not called Moves. A Move is the narrower
thing: the clip travelling a path.

The set is deliberately symmetrical: a character picks an **Action** from a
library, any clip picks an **Effect** from one. Both expand into ordinary editable
data — an Action into character motion, an Effect into Points — so neither is a
special case the rest of the editor has to know about.

Internally an Effect *is* stored as Move data, because that is the only animation
model the renderer has. That is an implementation detail and must not surface: the
Inspector tab is **Effects**, and the hand-built path editor inside it is
**Move along a path**.

## Property names

The same property carries the same label everywhere it appears — Clip tab, Move
tab, Stage, and any AI-facing JSON.

| Property   | Label       |
| ---------- | ----------- |
| x          | `X`         |
| y          | `Y`         |
| width      | `Width`     |
| height     | `Height`    |
| rotation   | `Rotation°` |
| scale      | `Scale`     |
| opacity    | `Opacity`   |

Do not reintroduce `Left`, `Top`, `Size`, `Angle°`, or `Visible` as aliases.

## Inspector tabs

| Tab        | Holds                                                     | Shown for            |
| ---------- | --------------------------------------------------------- | -------------------- |
| `Clip`     | Name, timing, Frame, Look, type-specific fields            | every clip           |
| `Speech`   | Voice library, TTS, alignment, placed speech               | character clips      |
| `Effects`  | Effects to pick from, then Moves, Points, path, feel        | every non-audio clip |
| `Acting`   | Auto blink, Rig, Actions & Expressions                     | character clips      |
| `More`     | Layer, lock, source, delete                                | every clip           |

Project-wide settings (name, size, fps, duration) live in **exactly one place** —
the Inspector's no-selection state, reachable from the format chip in the top
bar. Do not add a second copy inside a clip tab.

## Legacy internal names (do not surface)

These persist in the schema and are fine in code. They must not appear in the UI.

| Internal                                       | UI says            |
| ---------------------------------------------- | ------------------ |
| `MotionPreset`, `db.motionPresets`             | Action, Expression |
| `AppliedMotion`, `character.motions`           | Action, Expression |
| `ClipMotionStep`, `motionSteps`, `motionStepMetas` | Move           |
| `ClipMotionCheckpoint`, `checkpoint`           | Point              |
| `Keyframe`, `keyframes`                        | Point              |
| `MotionPanel`, `MotionPresetRecorder`          | Actions & Expressions |
| `ClipMotionStep` written by an effect preset   | Effect             |
| `compositionKind: "ai-block"`                  | Retired composition kind |

## Type scale

Two sizes, defined as Tailwind utilities in `src/styles.css`. Arbitrary
`text-[Npx]` values are banned and guarded by a test.

| Utility      | Size | Use for                                                     |
| ------------ | ---- | ----------------------------------------------------------- |
| `text-ui`    | 13px | Panel body copy, field values, anything read as a sentence   |
| `text-ui-sm` | 11px | Metadata, counts, chips, timeline lane labels                |

Section labels are `text-ui-sm uppercase tracking-wider`.

## Copy conventions

- Sentence case for buttons and labels: "Add to scene", not "Add To Scene".
- Tooltips say what happens, not what the control is: "Drag to change when this
  move ends" beats "End handle".
- Empty states name the next action: "No actions on this character yet."
- Never say "preset" to a user. They are choosing a thing, not a saved config.
