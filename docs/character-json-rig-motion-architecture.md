# HyperFrames-First Character Document Architecture

## Summary

Studio Boom characters are specialized HyperFrames sub-compositions. The canonical
character document is the native HyperFrames HTML stored in:

```text
project.hf.compositionHtml[characterCompositionId]
```

That document owns the puppet DOM, bone groups, slot elements, angle metadata,
motion metadata, reach/host constraints, asset references, styles, and finite paused
GSAP timeline. React is the editor shell around that document. It reads the
document for inspectors and overlays, then writes back through typed character
commands.

JSON remains important, but it is not the living model. Character JSON, angle rig
JSON, motion JSON, and AI suggestion JSON are portable exchange formats:

```text
HyperFrames character document
  source of truth for preview/export/editing

Character commands
  typed authoring operations that update the document

JSON artifacts
  import/export, AI context, AI suggestions, debug snapshots
```

The invariant is the same as the rest of Studio Boom:

```text
React edits the movie.
HyperFrames HTML is the movie.
```

## Core Model

### Character Document

The character document is native HyperFrames composition HTML. It must contain:

```text
explicit puppet DOM
  data-character-bone
  data-character-slot
  data-character-bound-bone-id
  data-character-host-slot-id / data-character-host-bone-id where relevant

stable editor-readable metadata
  character id/name
  active angle
  angles
  semantic bone/slot ids
  reach and host constraints
  depth and draw order

timeline data
  finite paused GSAP timeline
  registered window.__timelines[compositionId]
  slot events and motion events expressed against real DOM targets

asset refs
  asset:<id> references for library media
```

### Character Commands

Character commands are typed document edits. They are not "patches" in the sense of
fixing broken HTML; they are the official authoring API for a character document.

Examples:

```ts
setBoneTransform(html, { boneId, x, y, rotation, depth })
setSlotBinding(html, { slotId, boneId, x, y, rotation, scaleX, scaleY })
setSlotVariant(html, { slotId, variantId })
addSlotVariant(html, { slotId, variant })
setReachLimit(html, { slotId, reach, rotReach })
setHostConstraint(html, { slotId, hostSlotId, mode })
setActiveAngle(html, { angleId })
applyMotionDraft(html, { motion })
commitMotion(html, { motion })
```

The command layer is the guardrail. Character Builder, Motion Editor, AI import,
and future rig assistants should all use the same commands.

### Parser and Inspector Model

React panels should parse the HyperFrames character document into a view model for
display only:

```text
parseCharacterDocument(html)
  -> bones
  -> slots
  -> angles
  -> motions
  -> reach/host/depth/draw-order data
  -> validation findings
```

The parsed model is never the export source and should not become a second
canonical character state. It is a lens over the document.

### Portable JSON Artifacts

JSON files are still first-class user-facing artifacts, but their job is exchange:

```text
export JSON
  derive from the current HyperFrames character document

import JSON
  validate, normalize, preview, convert to character commands

AI JSON
  context out and suggestions in; never direct document writes
```

## Goals

- Make the HyperFrames character sub-composition the source of truth for character
  authoring, preview, and export.
- Give Character Builder and Motion Editor the same real document surface, not two
  renderers.
- Make character and motion data readable, copyable, and AI-friendly through JSON
  import/export artifacts.
- Keep every JSON artifact easy to identify by filename and top-level `kind`.
- Support first-class custom slots such as umbrellas, tails, wings, props, clothing,
  and alternate face features.
- Treat each angle as its own concrete rig while preserving shared character identity.
- Preserve HyperFrames compatibility: HTML is the editable document and
  preview/export source.

## Non-Goals

- No second preview/export renderer.
- No long-lived parallel character state that must later be compiled to
  HyperFrames HTML.
- No full mesh deformation in this cleanup pass.
- No animated angle interpolation in this cleanup pass.
- No direct provider/API-specific AI automation in the character runtime.

## JSON Artifact Names

All JSON files should include a top-level `kind`, `schemaVersion`, and
`suggestedFilename`. The filename suffix should make the direction and purpose clear
even outside Studio Boom.

### Portable Authoring JSON

These are durable import/export shapes, but not the runtime source of truth while a
character is being edited in Studio Boom.

```text
<character-slug>.character.json
<character-slug>.<angle-id>.angle-rig.json
<motion-slug>.motion.json
```

Examples:

```text
marisol.character.json
marisol.front.angle-rig.json
marisol.sideL.angle-rig.json
forward-walk.motion.json
hand-clap.motion.json
```

### Outbound AI Context JSON

These are copied from Studio Boom and pasted into an AI tool.

```text
<character-slug>.rig-context.ai-out.json
<character-slug>.<angle-id>.angle-context.ai-out.json
<motion-request-slug>.motion-request.ai-out.json
```

Examples:

```text
marisol.rig-context.ai-out.json
marisol.front.angle-context.ai-out.json
hand-clap.motion-request.ai-out.json
```

### Inbound AI Suggestion JSON

These are pasted back into Studio Boom for validation and preview.

```text
<character-slug>.rig-suggestion.ai-in.json
<motion-slug>.motion-suggestion.ai-in.json
```

Examples:

```text
marisol.rig-suggestion.ai-in.json
forward-walk.motion-suggestion.ai-in.json
```

Inbound AI JSON is never applied blindly. It is parsed, normalized, validated,
previewed, and then explicitly accepted by the user.

### Character Document

The editable character document is HyperFrames composition HTML:

```text
<composition-id>.character-composition.html
```

In the app this lives in:

```text
project.hf.compositionHtml[compositionId]
```

This is not "generated output" in the old compiler sense. It is the working
character document. JSON exports are derived from it.

## Suggested Export Package Layout

When exporting or debugging a character package, use this structure:

```text
characters/<character-id>/
  marisol.character.json
  angles/
    marisol.front.angle-rig.json
    marisol.sideL.angle-rig.json
    marisol.sideR.angle-rig.json
    marisol.3qL.angle-rig.json
    marisol.3qR.angle-rig.json
  motions/
    forward-walk.motion.json
    hand-clap.motion.json
  ai/
    out/
      marisol.rig-context.ai-out.json
      hand-clap.motion-request.ai-out.json
    in/
      hand-clap.motion-suggestion.ai-in.json
  document/
    comp_character_marisol.character-composition.html
```

The app may store these objects in Dexie rather than literal files, but clipboard,
debug export, import/export, and AI panels should use the same names and `kind`
values. The `document/` HTML is the editable character document; the JSON files are
portable views of it.

## Character JSON

`*.character.json` exports the shared identity and semantic vocabulary for one
character. It does not require every angle to have the same concrete bones or slots.
When imported, it should become character document commands that update identity,
semantic aliases, custom slot definitions, and angle availability.

```json
{
  "kind": "studioBoom.character.v1",
  "schemaVersion": 1,
  "suggestedFilename": "marisol.character.json",
  "id": "character:marisol",
  "name": "Marisol",
  "description": "Friendly presenter puppet",
  "defaultAngle": "front",
  "angles": ["front", "3qL", "3qR", "sideL", "sideR"],
  "semanticBones": [
    {
      "id": "bone:torso",
      "name": "Torso",
      "role": "body",
      "aliases": ["body", "chest"],
      "aiHint": "Main body control. Whole-body motion usually starts here."
    },
    {
      "id": "bone:rightHand",
      "name": "Right hand",
      "role": "hand",
      "aliases": ["right palm", "right fist"],
      "aiHint": "Hand at the end of the character's right arm."
    }
  ],
  "semanticSlots": [
    {
      "id": "slot:rightHand",
      "name": "Right hand",
      "role": "hand",
      "semanticType": "bodyPart",
      "aliases": ["right palm", "right fist"],
      "aiHint": "Visible hand art attached to the right hand bone.",
      "defaultAttachment": "bone:rightHand"
    },
    {
      "id": "slot:umbrella",
      "name": "Umbrella",
      "role": "custom",
      "semanticType": "prop",
      "aliases": ["parasol", "rain umbrella"],
      "aiHint": "Handheld umbrella prop attached to the right hand.",
      "defaultAttachment": "bone:rightHand"
    },
    {
      "id": "slot:tail",
      "name": "Tail",
      "role": "custom",
      "semanticType": "appendage",
      "aliases": ["animal tail", "cat tail"],
      "aiHint": "Flexible tail attached to the lower back.",
      "defaultAttachment": "bone:hips",
      "preferredRig": "chain"
    }
  ]
}
```

Custom slots are first-class. The standard human roles help with defaults and AI
prompts, but they do not limit what the user can add.

## Angle Rig JSON

`*.angle-rig.json` exports one concrete angle. Each angle may have unique bones,
slots, media variants, masks, reach, depth, and draw order. When imported, it
should become character document commands that update the active angle, bone
structure, slot bindings, variants, reach, host constraints, depth, and draw order.

`front` is not the master rig. It is just one angle.

```json
{
  "kind": "studioBoom.angleRig.v1",
  "schemaVersion": 1,
  "suggestedFilename": "marisol.front.angle-rig.json",
  "characterId": "character:marisol",
  "angleId": "front",
  "canvas": { "width": 900, "height": 1200 },
  "bones": [
    {
      "id": "front:bone:torso",
      "semanticBoneId": "bone:torso",
      "name": "Torso",
      "parentId": null,
      "x": 450,
      "y": 650,
      "rotation": 0,
      "depth": 0,
      "maxExtension": null
    },
    {
      "id": "front:bone:rightHand",
      "semanticBoneId": "bone:rightHand",
      "name": "Right hand",
      "parentId": "front:bone:rightForearm",
      "x": 120,
      "y": 14,
      "rotation": 0,
      "depth": 2,
      "maxExtension": 72
    }
  ],
  "slots": [
    {
      "id": "front:slot:rightHand",
      "semanticSlotId": "slot:rightHand",
      "name": "Right hand",
      "role": "hand",
      "variants": [
        { "id": "openPalm", "mediaId": "media:right-hand-open", "name": "Open palm" },
        { "id": "closedFist", "mediaId": "media:right-hand-fist", "name": "Closed fist" }
      ]
    },
    {
      "id": "front:slot:umbrella",
      "semanticSlotId": "slot:umbrella",
      "name": "Umbrella",
      "role": "custom",
      "variants": [
        { "id": "closed", "mediaId": "media:umbrella-closed", "name": "Closed" },
        { "id": "open", "mediaId": "media:umbrella-open", "name": "Open" }
      ]
    }
  ],
  "bindings": [
    {
      "slotId": "front:slot:rightHand",
      "boneId": "front:bone:rightHand",
      "x": -18,
      "y": -22,
      "rotation": 0,
      "scaleX": 1,
      "scaleY": 1,
      "depth": 2,
      "defaultVariant": "openPalm"
    }
  ],
  "hostConstraints": [
    {
      "slotId": "front:slot:leftPupil",
      "hostSlotId": "front:slot:leftEye",
      "mode": "insideHostMask",
      "reachPolicy": "scaleToFit"
    }
  ],
  "drawOrder": [
    "front:slot:leftLeg",
    "front:slot:rightLeg",
    "front:slot:torso",
    "front:slot:rightHand",
    "front:slot:head",
    "front:slot:leftEye",
    "front:slot:rightEye"
  ]
}
```

Depth and draw order stay separate:

- `depth` is for parallax and later 2.5D behavior.
- `drawOrder` is visual stacking.

If an angle has different depth values, that is deliberate. The active angle's
depth is the depth used for parallax while that angle is active.

## Motion JSON

`*.motion.json` exports reusable animation intent. It should target semantic bones
and semantic slots whenever possible so the same motion can resolve across angles.
When imported, it should become a draft motion command against a temporary copy of
the HyperFrames character document. Saving commits it as a named motion and/or
applies it to the selected character clip.

```json
{
  "kind": "studioBoom.motion.v1",
  "schemaVersion": 1,
  "suggestedFilename": "hand-clap.motion.json",
  "id": "motion:hand-clap",
  "name": "Hand Clap",
  "category": "gesture",
  "duration": 0.9,
  "loop": false,
  "targetSpace": "parentRelative",
  "tracks": [
    {
      "id": "track:left-upper-arm",
      "target": { "kind": "semanticBone", "id": "bone:leftUpperArm" },
      "channel": "transform",
      "keyframes": [
        { "t": 0, "rotation": 0 },
        { "t": 0.45, "rotation": 42, "ease": "easeOut" },
        { "t": 1, "rotation": 0, "ease": "easeIn" }
      ]
    },
    {
      "id": "track:right-hand-shape",
      "target": { "kind": "semanticSlot", "id": "slot:rightHand" },
      "channel": "variant",
      "keyframes": [
        { "t": 0, "variant": "openPalm" },
        { "t": 0.55, "variant": "openPalm" },
        { "t": 0.8, "variant": "relaxed" }
      ]
    }
  ],
  "constraints": {
    "defaultReachPolicy": "scaleToFit",
    "allowOutOfBounds": [
      {
        "target": { "kind": "semanticSlot", "id": "slot:leftEye" },
        "reason": "Cartoon surprise expression"
      }
    ]
  }
}
```

### Track Types

Bone tracks move the hierarchy. Children inherit automatically.

```json
{
  "target": { "kind": "semanticBone", "id": "bone:rightForearm" },
  "channel": "transform"
}
```

Slot tracks change attached art or local attached offsets.

```json
{
  "target": { "kind": "semanticSlot", "id": "slot:rightHand" },
  "channel": "variant"
}
```

Use bone tracks for:

- walk, run, jump, clap, wave, nod, body bounce,
- inherited motion where children should come along.

Use slot tracks for:

- hand shapes such as open palm, fist, pointing,
- clothing swaps,
- mouth expressions and visemes,
- eye variants,
- local pupil darts,
- prop visibility or prop variant swaps,
- deliberate local offsets that should not move the whole parent bone.

## Target Resolution

Motion JSON can target semantic IDs or concrete angle IDs.

Preferred reusable target:

```json
{ "kind": "semanticBone", "id": "bone:rightHand" }
```

Angle-specific target:

```json
{ "kind": "angleBone", "angleId": "sideL", "id": "sideL:bone:visibleHand" }
```

The resolver maps semantic targets to the active angle:

```text
motion target semanticSlot:slot:rightHand
  -> active angle sideL
  -> sideL semantic map
  -> sideL:slot:visibleHand
```

If a semantic target cannot resolve for the active angle, validation should report a
specific error before preview:

```text
Motion "Hand Clap" targets slot:rightHand, but angle sideL has no mapped slot.
```

## AI Workflow

### Copy Out

The Motion Editor should expose clear JSON buttons:

- `Copy Character Context JSON`
- `Copy Active Angle Rig JSON`
- `Copy Motion Request JSON`

The copied outbound JSON should include:

- character identity,
- semantic bones and slots,
- custom slots with aliases and `aiHint`,
- active angle concrete bones and slots,
- valid target IDs,
- variant names,
- bounds/reach rules,
- depth/draw-order distinction,
- schema instructions,
- one small valid example.

### Paste In

The editor should expose:

- `Paste Rig Suggestion JSON`
- `Paste Motion Suggestion JSON`

Paste flow:

1. Parse JSON.
2. Check `kind` and `schemaVersion`.
3. Normalize aliases and legacy field names if safe.
4. Validate IDs, finite numbers, keyframe times, target resolution, and variants.
5. Convert the suggestion into character commands.
6. Preview those commands on a draft copy of the real HyperFrames character
   document.
7. Show warnings and unresolved targets.
8. Apply only after explicit user confirmation.

AI JSON must never directly mutate `project.hf.compositionHtml`. AI suggestions
must pass through validation and character commands first.

## Document Command Boundary

Implementation should center on the HyperFrames character document:

```text
parseCharacterDocument(html)
  -> inspector view model

applyCharacterCommand(html, command)
  -> updated HyperFrames character document

lintCharacterDocument(html)
  -> errors and warnings
```

Suggested module boundaries:

```text
src/studio/character-document/schema.ts
src/studio/character-document/parse.ts
src/studio/character-document/commands.ts
src/studio/character-document/lint.ts
src/studio/character-json/schema.ts       JSON exchange schemas only
src/studio/character-json/normalize.ts    JSON -> command normalization
src/studio/character-json/validate.ts     JSON validation before commands
src/studio/character-json/ai-context.ts   AI context and prompt packages
src/studio/presets/motion-json.ts         motion JSON import/export adapter
```

These modules should not import React components. React components may call them,
display their parsed view models, and render editor-only overlays.

### Character Commands

Commands should be explicit authoring operations:

```ts
type CharacterCommand =
  | { type: "setBoneTransform"; boneId: string; x: number; y: number; rotation: number }
  | { type: "setSlotBinding"; slotId: string; boneId: string; x: number; y: number }
  | { type: "addSlotVariant"; slotId: string; variant: SlotVariant }
  | { type: "setReachLimit"; slotId: string; reach: ReachLimit }
  | { type: "setHostConstraint"; slotId: string; constraint: HostConstraint }
  | { type: "setActiveAngle"; angleId: CharacterAngle }
  | { type: "applyMotionDraft"; motion: MotionJson }
  | { type: "commitMotion"; motion: MotionJson };
```

Commands are allowed to edit DOM attrs, style blocks, and editor-readable metadata
inside the character composition, but they must preserve valid HyperFrames HTML and
a finite paused timeline.

## Motion Editor Runtime Contract

The Motion Editor must not maintain a flat private puppet renderer.

It should author against a draft copy of the real HyperFrames character document:

```text
current character composition HTML
  -> copy draft HTML
  -> applyMotionDraft command
  -> preview draft HTML in HyperFrames player
  -> commitMotion command when saved
```

The Motion Editor may use React overlays for:

- selection,
- bone handles,
- slot handles,
- rotate controls,
- reach/mask visualization,
- JSON validation messages.

It must not draw a second copy of the puppet. The character body parts in the
Motion Editor should come from the same HyperFrames DOM shape used by Stage and
export.

## Character Document Lint

Add a character-specific linter on top of native HyperFrames validation:

```ts
lintCharacterDocument(html)
```

It should catch:

- invalid native HyperFrames composition HTML,
- missing or duplicate `data-character-bone-id`,
- missing or duplicate `data-character-slot-id`,
- slot without a valid bound bone,
- bone parent cycles,
- host constraints referencing missing slots or bones,
- reach constraints referencing missing slots,
- motion targets that do not resolve,
- unknown motion categories normalized to `custom`,
- missing asset refs,
- empty or non-finite timelines,
- child motion that restates inherited parent translation in built-in presets.

This linter should run after character commands, before accepting imported AI JSON,
and before export/debug package generation.

## Bounds and Reach

Character documents define host constraints and reach. Motions respect them by
default.

Default behavior:

```text
motion exceeds reach
  -> scale the motion delta to fit
  -> preserve gesture shape and timing
```

Avoid hard capping unless the user explicitly chooses a mechanical limit. Scaling
keeps the motion expressive; capping makes parts appear to hit an invisible wall.

Per-motion escape hatch:

```json
{
  "constraints": {
    "allowOutOfBounds": [
      {
        "target": { "kind": "semanticSlot", "id": "slot:leftEye" },
        "reason": "Surprise eye pop"
      }
    ]
  }
}
```

This is scoped to the movement, not the character.

## Built-In Motion Cleanup

Built-in motions should be converted from flat absolute tracks to parent-relative
bone tracks.

For example, a jump should move the body/root bone upward. The head should not also
receive the same upward translation unless the desired result is extra relative head
motion.

Correct shape:

```text
Jump
  body/root bone: dy -60
  arms: relative swing
  legs: relative squash/kick
  head: optional small relative bob only
```

Incorrect skeleton shape:

```text
Jump
  body: dy -60
  head: dy -60
```

The incorrect shape double-counts once the head is nested under the body.

## Testing Requirements

- Character document parsing reads bones, slots, variants, angles, depth, draw
  order, reach, host constraints, and motion metadata from HyperFrames HTML.
- Character commands update the HyperFrames character document and preserve native
  composition validity.
- Character document lint catches duplicate IDs, missing bindings, invalid bone
  graphs, unresolved host/reach constraints, missing assets, and invalid timelines.
- Character JSON validates required `kind`, `schemaVersion`, IDs, semantic slots,
  custom slot hints, and angle list.
- Angle Rig JSON validates bone graph, slot bindings, host constraints, depth, and
  draw order.
- Motion JSON validates target resolution, keyframe values, variants, and
  per-motion bounds overrides.
- A semantic motion resolves correctly for `front` and fails with a clear message
  for an unmapped side angle.
- Built-in Jump moves the head exactly once through parent inheritance.
- Wave rotates an arm bone and carries the hand slot automatically.
- A slot variant track swaps open hand to closed fist without changing bone motion.
- The Motion Editor previews a draft copy of the real HyperFrames character
  document.
- Pasted AI JSON cannot write directly to HyperFrames HTML; it must become
  validated character commands first.

## Implementation Order

1. Add `character-document` parser, command, and linter module boundaries.
2. Teach existing character composition HTML to carry all editor-readable document
   metadata needed by the parser.
3. Move Character Builder edits onto character commands against
   `project.hf.compositionHtml[compositionId]`.
4. Move Motion Editor preview to a draft copy of the real character document in a
   HyperFrames player.
5. Route AI JSON imports through validation and character commands.
6. Convert built-in presets to parent-relative bone/slot tracks.
7. Add per-track or per-target `allowOutOfBounds` UI in Motion Editor.
8. Keep mesh/deformation extensions behind the same character document command
   contract.
