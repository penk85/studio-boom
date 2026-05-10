# Agent Context

Before making architecture or export/render changes in Studio Boom, read
`CLAUDE.md`.

The important rule is:

```text
React is for editing the movie.
HyperFrames-style output is the movie.
```

Protect this flow:

```text
editorMeta
  editable creative intent

bake helpers
  convert intent into renderable HyperFrames data

project.hf
  preview and export source of truth
```

Do not add a second preview/export renderer, and do not make export a late compiler
from React UI state into HyperFrames.
