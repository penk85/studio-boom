# AI-Generated HyperFrames Clips Roadmap

## Summary

Use native HyperFrames HTML as the AI interchange format. Do not introduce a
broad structured AI draft schema unless a concrete limitation forces it.

Studio Boom should support AI-generated clips in two native shapes:

- **Custom composition block:** one self-contained HyperFrames composition stored
  in `project.hf.compositionHtml`, hosted by one `composition` clip in
  `project.hf.rootHtml`.
- **Editable clip set:** top-level HyperFrames `video`, `image`, `audio`,
  `text`, and `composition` elements that Studio Boom can parse and expose as
  individual timeline clips.

The first implementation now exists in a minimal form: Studio Boom can add native
text clips, import validated custom HyperFrames composition blocks, preview them in
a sandbox, and expose source for selected composition clips. The remaining work is
mostly product polish, richer source editing, and nested composition editing.

## Current Status

Implemented:

- First-class `text` clips can be inserted from Library -> Text and edited through
  the Inspector.
- Non-character `composition` clips can be inserted, selected, moved, resized,
  trimmed, layered, undone/redone, previewed, and exported.
- Characters are still composition clips with `compositionKind: "character"`.
- Library -> Blocks accepts self-contained HyperFrames composition HTML, validates
  it, previews it, and adds it as one `composition` clip.
- The Inspector exposes source for selected composition clips and primitive root
  elements.
- Validation errors can be copied as repair prompts.
- Character speech audio now lives inside character sub-compositions, not as
  linked root audio siblings.
- Character timed animation is presented as Actions and Expressions. The current
  import/export transport still uses legacy `studioBoom.motion.v1` JSON names
  until a mechanical schema rename happens.

Not implemented yet:

- Direct built-in AI API generation.
- Importing a simple generated top-level clip set as multiple editable clips.
- Nested composition timeline editing.
- A polished prompt-pack UI.

## Architectural Context

Studio Boom must preserve this flow:

```text
React editor chrome
  edits real HyperFrames elements

project.hf.rootHtml
project.hf.compositionHtml
project.hf.assets
  are the movie and export source of truth
```

Do not add a second preview/export renderer. Do not generate movie output from
React state. All AI output must become canonical HyperFrames HTML stored in
`project.hf`.

HyperFrames core clip types are:

```ts
"video" | "image" | "text" | "audio" | "composition";
```

Studio Boom should align with those render-facing types. Editor metadata can
describe purpose:

```ts
compositionKind?: "ai-block" | "registry-block" | "character" | "user-composition";
```

## Phase 1: Clip Model Foundation - Implemented

Native editor support for the important HyperFrames clip shapes is now in place.
Keep this section as the contract for future work.

- Add first-class `text` clips.
- Add first-class non-character `composition` clips.
- Stop deriving every HyperFrames `type: "composition"` element as a
  `character`.
- Keep characters working as a specialized composition kind.
- Ensure add/update/remove/undo/redo/export/preview all work through existing
  `rootHtml` and `compositionHtml` mutation paths.
- Keep editor tracks as human organization only; rendering order remains
  `zIndex`.

Acceptance criteria:

- A non-character composition clip can be inserted, selected, moved, resized,
  trimmed, layered, undone/redone, previewed, and exported.
- A text clip can be inserted, selected, moved, resized, trimmed, layered,
  previewed, and exported.
- Existing character clips still work.

## Phase 2: Source-First Custom AI Block MVP - Mostly Implemented

The paste/import path exists. Future work should improve editing ergonomics and
make source validation feedback friendlier.

User flow:

1. User opens AI/custom block panel.
2. User copies a Studio Boom prompt or pastes AI-generated HyperFrames HTML.
3. Studio Boom validates the composition HTML.
4. User previews it through the existing HyperFrames player path.
5. User applies it to the timeline.
6. Studio Boom creates one `composition` clip in `rootHtml` and stores the source
   in `compositionHtml[compositionId]`.

Source view is part of this phase, not later. Current behavior:

- Inspector source panels show/edit `compositionHtml[compositionId]` for selected
  composition clips.
- Inspector source panels can show the corresponding root HTML element source for
  selected primitive clips.
- Composition source edits use `Validate -> Preview -> Apply`.
- Invalid source does not overwrite the project.

Acceptance criteria:

- Pasted valid composition HTML becomes one editable timeline composition clip.
- The source is visible after import and can be edited/reapplied.
- Validation failures are shown clearly and can be copied back into an AI chat.
- Applying source changes updates `compositionHtml`, not React-rendered preview
  state.

## Phase 3: Prompt Pack And Validation Feedback

Treat the prompt as product infrastructure.

Create a versioned Studio Boom AI prompt pack that tells an external AI how to
write valid output.

Prompt pack must include:

- HyperFrames composition structure.
- Required data attributes.
- Timeline registration rules.
- Studio Boom architectural rules.
- Source-of-truth rule: output must become `project.hf`.
- Asset rules:
  - prefer existing `asset:<id>` references
  - no remote images by default
  - request missing assets explicitly
- Motion/transition guardrails.
- Character Action/Expression guardrails, including pose vs action vs expression
  vs speech/lip-sync vs Stage motion terminology.
- Two allowed output modes:
  - custom composition block
  - editable top-level clip set
- Current project context:
  - width, height, fps, duration
  - available assets and IDs
  - supported clip types
  - known limitations

Validation failures should produce copyable repair prompts, for example:

```text
Fix this HyperFrames composition for Studio Boom.
Validation errors:
...
Original HTML:
...
```

Acceptance criteria:

- User can copy a prompt that includes current project dimensions and asset
  manifest.
- Validation errors are actionable and copyable.
- The prompt clearly asks for either a custom composition block or editable clip
  set.

## Phase 4: Editable HyperFrames Clip Set Import

After custom block import works, support importing native HyperFrames HTML as
individual editable clips.

- Parse top-level timed `video`, `image`, `audio`, `text`, and `composition`
  elements.
- Convert them into Studio Boom editor clips while preserving canonical
  HyperFrames HTML.
- If the HTML is too nested/custom to decompose reliably, import it as one
  composition block instead.
- Do not introduce a broad intermediate JSON schema unless a concrete limitation
  forces it.

Acceptance criteria:

- Simple AI-generated HyperFrames clip sets appear as individual timeline clips.
- Dragging/resizing/trimming individual imported clips mutates canonical
  `rootHtml`.
- Complex custom HTML gracefully falls back to composition-block import.

## Phase 5: Asset And Image Flow

Do not use remote images as the default export path.

Asset policy:

- Existing assets are referenced as `asset:<id>`.
- Missing assets are reported as required assets.
- User can choose an existing library asset or upload one.
- Later, user can generate missing assets through an image provider.
- Generated/imported assets are saved into Dexie, registered in
  `project.hf.assets`, and referenced as `asset:<id>`.

HyperFrames consumes assets. Studio Boom owns asset creation/import/storage.

Acceptance criteria:

- Importer rejects or warns on unknown `asset:<id>`.
- Importer warns on remote image URLs.
- Missing asset requests are visible to the user.
- Existing assets preview/export through the current asset pipeline.

## Phase 6: Nested Composition Editing

Use composition clips as the shared abstraction for rich nested content.

Long-term model:

- AI block = composition clip.
- Registry block = composition clip.
- User custom block = composition clip.
- Character = composition clip with character-specific tools.

Future UI:

- Expand a composition clip to reveal internal clips/timeline.
- Double-click or enter a composition to edit `compositionHtml[compositionId]`.
- Stage edits manipulate real elements in the active composition.
- Character speech audio and lip-sync already live inside character compositions.
  Keep that model when nested composition editing arrives.

Acceptance criteria:

- Composition editing uses the same source-of-truth rules as root editing.
- No nested React preview renderer is introduced.
- Existing native character composition clips keep working inside the nested
  composition editing model.

Effort estimate:

- Read-only nested outline in the root timeline: small. Show timed internal
  clips when they exist, and otherwise show useful DOM layers from rich custom
  compositions. This is visibility only; edits still apply to the parent
  composition source.
- Enter/open composition mode for timed internal clips: medium. Reuse the
  existing timeline mechanics against `compositionHtml[compositionId]` instead
  of `rootHtml`, with active-composition selection, source validation, undo/redo,
  and stage targeting.
- Stage selection/editing for nested internal elements: medium to large. The
  Stage must target the real nested element inside the bundled HyperFrames
  iframe and commit mutations back to the correct composition HTML.
- Rich DOM layer editing for generated scenes: large. DOM parts such as phone
  frames, SVG rings, labels, and graph lines are not necessarily HyperFrames
  timed clips, so editing them needs a layer/tree model and source-level style or
  transform mutations.
- Promote/break generated parts into first-class clips: large. This requires a
  decomposition policy so Studio Boom can turn selected DOM groups into scheduled
  HyperFrames clips without changing render behavior.

## Phase 7: Catalog Effects And Keyframes

Defer broad catalog infrastructure until there is a concrete need.

- Registry blocks can later import as composition clips.
- Registry components/effects can start as source-level snippets.
- Classify catalog support only when integrating real catalog items.
- Keep shader transitions deferred until dedicated preview/export coverage
  exists.
- Do not block AI clips on keyframe UI.
- Start with AI-authored GSAP in source; later expose selected animations as
  editable keyframes/curves.

## Next Implementation Slice

The original first slice has landed. A useful next slice is:

1. Improve the Blocks tab with saved examples and a clearer prompt-copy flow.
2. Add a prompt pack that includes current project dimensions, assets, supported
   clip types, and source-of-truth rules.
3. Support importing simple generated top-level clip sets as individual editable
   clips, while falling back to a single composition block for complex HTML.
4. Add source-edit test coverage around Validate -> Preview -> Apply.
5. Expand composition clips in the timeline with a read-only nested outline.
6. Start full nested composition timeline editing only after the source workflow
   and read-only outline are stable.

## Assumptions

- V1 is paste/copy workflow, not direct Anthropic/OpenAI API calls.
- Built-in API generation can be added later after import/source/validation
  works.
- No broad AI draft JSON schema is introduced in the first roadmap.
- The legacy `bake.ts` character pipeline has been removed; character rigs are
  native composition clips with generated `project.hf.compositionHtml` source.
- `project.hf` remains the durable movie format.
