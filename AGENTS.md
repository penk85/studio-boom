# Agent Context

Before making architecture or export/render changes in Studio Boom, read
`CLAUDE.md`.

Before implementing AI-generated clips, custom HyperFrames blocks, source editing,
or nested composition timeline work, also read
`docs/ai-generated-hyperframes-clips-roadmap.md`.

The important rule is:

```text
React is for editing the movie.
HyperFrames-style output is the movie.
```

Protect this flow:

```text
editorMeta
  editable creative intent

boundary helpers
  mutate canonical HyperFrames HTML and rebuild native sub-compositions where needed

project.hf
  preview and export source of truth
```

Do not add a second preview/export renderer, and do not make export a late compiler
from React UI state into HyperFrames.

React editor chrome is allowed for selection outlines, handles, and controls, but
it must not draw duplicate media or preview content. Stage edits should manipulate
the real HyperFrames element and persist through `project.hf.rootHtml`.
