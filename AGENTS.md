# Agent Context

Before making architecture or export/render changes in Studio Boom, read
`CLAUDE.md`.

Before implementing AI-generated clips, custom HyperFrames blocks, source editing,
or nested composition timeline work, also read
`docs/ai-generated-hyperframes-clips-roadmap.md`.

The important rule is:

```text
One canonical render-ready project source drives editing, stage preview, playback,
and MP4 export.

No UI layer, renderer adapter, or export step may reinterpret separate state into
the movie.
```

Protect this flow:

```text
editorMeta
  editable creative intent and UI affordance metadata only

boundary helpers
  mutate canonical project source and rebuild native renderable compositions where needed

project.hf
  rootHtml, compositionHtml, and assets are the durable movie document used by
  preview, stage playback, and export
```

Do not add a second preview/export source of truth, and do not make export a late
compiler from React/UI state into renderable `project.hf` output.

Editor chrome is allowed for selection outlines, handles, and controls, but it
must not draw duplicate media or preview content. Stage and nested-composition
edits should manipulate the real renderable project element or composition data
and persist through `project.hf.rootHtml` / `project.hf.compositionHtml`.

Character rendering status:

```text
Character rig concepts (bones, sockets/pins, slots, variants, poses, Actions,
Expressions, speech) are canonical authoring intent.

Pixi is the only character renderer, and it lives inside generated HyperFrames
character composition source, driven by the same timeline/source path as preview
and export. The legacy DOM puppet renderer and per-clip renderer switch were
removed; stored DOM compositions from old saves stay playable until rebuilt.
```

Do not reintroduce DOM-only character rendering. Do not emit Pixi mesh
primitives by default; mesh/stretch-limb work must remain behind explicit
preview/export parity coverage.
