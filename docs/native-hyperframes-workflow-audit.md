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
- Runtime packaging boundary: `project-files.ts` strips packaged
  `hyperframe-runtime.js` script tags from stored/imported HTML before preview or
  render staging. Studio Boom lets the official HyperFrames bundler inject the
  runtime with `bundleToSingleHtml(..., { runtime: "inline" })`, so project
  source should not depend on a sibling runtime file being served by the Studio
  app.
- Necessary adapter: `render-plugin.ts` writes staged files to `/tmp` and invokes `hyperframes render`.
- Stage interaction adapter: `player-editing.ts` previews drag/resize/rotate on
  the real player iframe element, using `PlayerAPI` first where available and a
  direct DOM fallback when the package API does not expose a preview helper.
- Upstream boundary adapter: `native.ts` / `normalizeNativeHyperframesHtml`
  normalizes HTML from current `@hyperframes/core` helpers into the native shape
  expected by the CLI/runtime without reading editor state. It also keeps root
  composition dimensions, stage dimensions, and viewport metadata aligned for
  export.
- Upstream boundary adapter: `html.ts` / `parseStudioHtml` patches current parser
  output from native `data-duration`/`data-track-index`/sizing attrs until
  `@hyperframes/core` reads those attrs directly. It also owns the temporary
  `data-rotation` base-transform seam until core exposes base rotation natively,
  and persists visual clip layer order as CSS `z-index` in `rootHtml`.
- Root composition boundary: `root-composition.ts` owns new root composition creation and direct root metadata updates without rebuilding the whole composition.
- Character composition builder: `character/composition.ts` generates native
  HyperFrames sub-composition HTML for Studio Boom puppet rigs. Root character
  clips are regular composition clips with `compositionKind: "character"`.
- Speech/lip-sync boundary: character speech audio is reusable library media.
  Speech placement lives in character clip metadata, viseme timing lives on the
  audio `MediaAsset`, and `character/composition.ts` serializes placed speech as
  internal HyperFrames `<audio>` clips in the character sub-composition.
- ElevenLabs boundary: `render-plugin.ts` exposes local `/api/elevenlabs/*`
  endpoints during development. The API key is read from server-side
  `ELEVENLABS_API_KEY` and is not bundled into browser code.
- Source block boundary: Library -> Blocks validates and previews custom
  HyperFrames composition HTML before adding it to `project.hf.compositionHtml`.
  Inspector source editing uses the same Validate -> Preview -> Apply rule.
- Removable extra surface: ZIP download support has been removed; MP4 download is the only user-facing export path.

## Guardrails

- MP4 staging must never construct render output from React state or `editorMeta`.
- Preview and MP4 render must consume the same `project.hf` source.
- React may draw editor chrome over the Stage, but it must not draw duplicate
  media or content. The selected/edited object remains the real HyperFrames
  element.
- New root or sub-compositions may use `generateHyperframesHtml`.
- Ordinary clip edits should use `addElementToHtml`, `updateElementInHtml`, and
  `removeElementFromHtml` against canonical stored HTML, not
  parse/edit/reserialize loops.
- Root metadata edits such as duration and dimensions should update the stored composition directly, not regenerate all clips from parsed element lists.
- Stage drag/resize/rotate/nudge should preview through the real player iframe
  and commit through `updateClip`, which mutates `rootHtml`. Rotation remains
  base transform state, not keyframe animation state.
- Visual layer ordering is a HyperFrames HTML concern. Editor timeline
  track/lane metadata must not become the render stack; layer shortcuts and
  controls should update canonical `rootHtml` z-index values.
- Undo/redo should restore canonical `Project` snapshots and must not rebuild
  render output from React-only state.
- Same-track overlap validation should run per staged project file before
  bundling. Root clips and internal sub-composition clips may reuse track indexes
  because they live in separate HyperFrames composition files.
- Secrets must stay server-side. Do not read provider API keys from client code or
  `VITE_` environment variables.

## Next Priorities

- Source-visible custom HyperFrames blocks: polish the existing Blocks tab and
  Inspector source panels while keeping all generated output in `project.hf`.
- Prompt pack and validation feedback for external AI workflows.
- Editable HyperFrames clip-set import after custom block import is stable.
- Runtime script cleanup: audit whether `hyperframe-runtime.js` stripping should
  happen during ZIP import as canonical source normalization, stay only at
  preview/render staging for backwards compatibility, or move upstream into the
  HyperFrames bundler's embedded-runtime stripping list.
- Crop and mirror only after confirming the native HyperFrames representation; do
  not fake them with a second renderer.
- Timeline control polish: reset to start and draggable seek needle.
- Voice library polish: editing/removing reusable voice assets, clearer speech
  placement controls, and generic audio alignment cleanup.
- Character rig tool polish: richer rig editing and drag/drop motion authoring on
  top of the native character composition contract.
