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

The first implementation should focus on custom composition blocks plus source
visibility, because that is the smallest useful path and aligns with
HyperFrames.

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
"video" | "image" | "text" | "audio" | "composition"
```

Studio Boom should align with those render-facing types. Editor metadata can
describe purpose:

```ts
compositionKind?: "ai-block" | "registry-block" | "character" | "user-composition";
```

## Phase 1: Clip Model Foundation

Add native editor support for HyperFrames clip types before building AI-specific
UX.

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

## Phase 2: Source-First Custom AI Block MVP

Build the first AI feature as paste/import of one custom HyperFrames composition
block.

User flow:

1. User opens AI/custom block panel.
2. User copies a Studio Boom prompt or pastes AI-generated HyperFrames HTML.
3. Studio Boom validates the composition HTML.
4. User previews it through the existing HyperFrames player path.
5. User applies it to the timeline.
6. Studio Boom creates one `composition` clip in `rootHtml` and stores the source
   in `compositionHtml[compositionId]`.

Source view is part of this phase, not later.

- Add an Inspector Source tab.
- For selected composition clips, show/edit `compositionHtml[compositionId]`.
- For selected primitive clips, optionally show the corresponding root HTML
  element source.
- Source edits must use `Validate -> Preview -> Apply`.
- Invalid source must never silently overwrite the project.

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
- Speech audio/lip-sync can eventually move inside character compositions,
  removing linked sibling audio hacks.

Acceptance criteria:

- Composition editing uses the same source-of-truth rules as root editing.
- No nested React preview renderer is introduced.
- Character refactor can build on this model without blocking AI block MVP.

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

## Recommended First Implementation Slice

Start here:

1. Update types so `EditorClip.kind` and related command types support:
   - `text`
   - non-character `composition`
2. Add store/build helpers for non-character composition clips.
3. Ensure `deriveEditorClips` maps HyperFrames composition elements using
   `editorMeta.kind`, not always `character`.
4. Add basic text clip serialization/parsing support through Studio HTML
   boundary helpers.
5. Add tests for:
   - adding non-character composition clips
   - adding text clips
   - preserving character behavior
   - undo/redo of composition/text edits
   - export staging of composition HTML
6. Then build Source tab and custom AI block import UI.

## Assumptions

- V1 is paste/copy workflow, not direct Anthropic/OpenAI API calls.
- Built-in API generation can be added later after import/source/validation
  works.
- No broad AI draft JSON schema is introduced in the first roadmap.
- The legacy `bake.ts` character pipeline has been removed; character rigs are
  native composition clips with generated `project.hf.compositionHtml` source.
- `project.hf` remains the durable movie format.
