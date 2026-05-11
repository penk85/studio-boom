# Native HyperFrames Workflow Audit

Studio Boom's render invariant is:

```text
user edit -> project.hf -> Stage preview
                  |
                  v
            MP4 render staging -> hyperframes render
```

`project.hf.rootHtml`, `project.hf.compositionHtml`, and `project.hf.assets` are the
movie. `editorMeta` is editor-only intent and UI state.

## Layer Classification

- Necessary adapter: `Stage.tsx` resolves `asset:<id>` and composition file references to local blob URLs for browser preview.
- Necessary adapter: `project-files.ts` stages `project.hf` as a temporary HyperFrames project directory for the CLI.
- Necessary adapter: `render-plugin.ts` writes staged files to `/tmp` and invokes `hyperframes render`.
- Upstream boundary adapter: `normalizeNativeHyperframesHtml` normalizes HTML from current `@hyperframes/core` helpers into the native shape expected by the CLI/runtime without reading editor state.
- Upstream boundary adapter: `parseStudioHtml` patches current parser output from native `data-duration`/`data-track-index` attrs until `@hyperframes/core` reads those attrs directly.
- Root composition boundary: `root-composition.ts` owns new root composition creation and direct root metadata updates without rebuilding the whole composition.
- Transitional character bridge: `export/bake.ts` remains isolated for the current character pipeline and must not grow.
- Removable extra surface: ZIP download support has been removed; MP4 download is the only user-facing export path.

## Guardrails

- MP4 staging must never construct render output from React state or `editorMeta`.
- Preview and MP4 render must consume the same `project.hf` source.
- New root or sub-compositions may use `generateHyperframesHtml`.
- Ordinary clip edits should use `addElementToHtml`, `updateElementInHtml`, and `removeElementFromHtml` against canonical stored HTML, not parse/edit/reserialize loops.
- Root metadata edits such as duration and dimensions should update the stored composition directly, not regenerate all clips from parsed element lists.

## Next Priorities

- Stage authoring controls: selection, drag, resize, rotate, and mirror where supported by the HyperFrames/player boundary.
- Timeline control polish: reset to start and draggable seek needle.
- Audio alignment cleanup so linked audio behavior follows the same canonical HTML-first architecture.
- Character refactor only after the stage and audio boundaries are clearer.
