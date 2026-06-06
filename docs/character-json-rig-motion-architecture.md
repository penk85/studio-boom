# Character JSON, Rig, and Motion Architecture

## Summary

Studio Boom characters should be authored as structured JSON intent, resolved through
a shared rig/motion adapter, and emitted as native HyperFrames composition HTML.

The split is:

```text
Character JSON
  shared identity, semantic vocabulary, custom slots, angle list

Angle Rig JSON
  concrete bones, slots, bindings, masks/reach, depth, draw order for one angle

Motion JSON
  reusable parent-relative bone motion and slot variants/local offsets over time

HyperFrames HTML
  generated preview/export source of truth in project.hf.compositionHtml
```

React may provide editors, handles, inspectors, JSON panels, and validation UI. It
must not become a second character renderer. The generated HyperFrames character
composition remains the movie.

## Goals

- Make character and motion data readable, copyable, and AI-friendly.
- Keep every JSON artifact easy to identify by filename and top-level `kind`.
- Support first-class custom slots such as umbrellas, tails, wings, props, clothing,
  and alternate face features.
- Treat each angle as its own concrete rig while preserving shared character identity.
- Make the Motion Editor and Stage use the same rig semantics and motion sampler.
- Preserve HyperFrames compatibility: JSON is authoring intent; HTML is preview/export.

## Non-Goals

- No second preview/export renderer.
- No full mesh deformation in this cleanup pass.
- No animated angle interpolation in this cleanup pass.
- No direct provider/API-specific AI automation in the character runtime.

## JSON Artifact Names

All JSON files should include a top-level `kind`, `schemaVersion`, and
`suggestedFilename`. The filename suffix should make the direction and purpose clear
even outside Studio Boom.

### Canonical Authoring JSON

These are the durable, editable Studio Boom data shapes.

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

### Generated Output

Generated HyperFrames output should be clearly labeled as generated and should not be
treated as editable character JSON.

```text
<composition-id>.character-composition.html
```

In the app this lives in:

```text
project.hf.compositionHtml[compositionId]
```

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
  generated/
    comp_character_marisol.character-composition.html
```

The app may store these objects in Dexie rather than literal files, but clipboard,
debug export, import/export, and AI panels should use the same names and `kind`
values.

## Character JSON

`*.character.json` stores the shared identity and semantic vocabulary for one
character. It does not require every angle to have the same concrete bones or slots.

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

`*.angle-rig.json` stores one concrete angle. Each angle may have unique bones,
slots, media variants, masks, reach, depth, and draw order.

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

`*.motion.json` stores reusable animation intent. It should target semantic bones
and semantic slots whenever possible so the same motion can resolve across angles.

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
5. Preview on the same rig/motion sampler used by the Stage.
6. Show warnings and unresolved targets.
7. Apply only after explicit user confirmation.

AI JSON must never directly mutate `project.hf.compositionHtml`.

## Parser and Adapter Boundary

Implementation should keep schema parsing separate from rendering:

```text
parseCharacterJson()
parseAngleRigJson()
parseMotionJson()
  -> normalized Studio Boom character/motion objects
  -> shared motion sampler
  -> character composition builder
  -> project.hf.compositionHtml[compositionId]
```

Suggested module boundaries:

```text
src/studio/character-json/schema.ts
src/studio/character-json/normalize.ts
src/studio/character-json/validate.ts
src/studio/character-json/ai-context.ts
src/studio/presets/motion-json.ts
```

These modules should not import React components.

## Motion Editor Runtime Contract

The Motion Editor must not maintain a flat private puppet renderer.

It should author against the same logical runtime used by generated character
compositions:

```text
active Character JSON + active Angle Rig JSON + Motion JSON
  -> resolver
  -> shared sampler
  -> same nested skeleton semantics as Stage
```

The Motion Editor may use React overlays for:

- selection,
- bone handles,
- slot handles,
- rotate controls,
- reach/mask visualization,
- JSON validation messages.

It must not draw a second copy of the puppet whose motion differs from the generated
HyperFrames character composition.

## Bounds and Reach

Angle rigs define host constraints and reach. Motions respect them by default.

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
- The Motion Editor preview and generated character composition sample the same
  motion state at the same time.
- Pasted AI JSON cannot write directly to HyperFrames HTML.

## Implementation Order

1. Add JSON schema, normalizers, validators, and sample fixtures.
2. Convert built-in presets to parent-relative bone/slot tracks.
3. Refactor Motion Editor sampling away from its private flat sampler.
4. Add AI copy/paste panels using the identifiable JSON artifacts above.
5. Add per-track or per-target `allowOutOfBounds` UI in Motion Editor.
6. Keep mesh/deformation extensions behind the same character/angle/slot contract.
