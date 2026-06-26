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
- Character document direction: character authoring should move toward the
  HyperFrames-first document model in `docs/character-json-rig-motion-architecture.md`.
  The character sub-composition HTML is the editable document; JSON artifacts are
  import/export and AI exchange formats.
- Character Action/Expression boundary: reusable character presets are currently
  persisted through legacy `motionPresets`/`MotionPreset` names, but product
  vocabulary is Pose (held variant state), Action (timed body animation),
  Expression (timed facial animation), Speech/lip-sync, and separate Stage
  motion for moving the whole clip.
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
- Upstream primitive audit: revisit HyperFrames Studio picker, property-panel,
  file-tree, and nested composition primitives behind a feature flag or isolated
  prototype before wiring them into the stable Stage. The first direct
  picker/property-panel attempt interfered with root clip selection and was
  backed out.
- Prompt pack and validation feedback for external AI workflows.
- Editable HyperFrames clip-set import after custom block import is stable.
- Runtime script cleanup: audit whether `hyperframe-runtime.js` stripping should
  happen during ZIP import as canonical source normalization, stay only at
  preview/render staging for backwards compatibility, or move upstream into the
  HyperFrames bundler's embedded-runtime stripping list.
- Crop and mirror only after confirming the native HyperFrames representation; do
  not fake them with a second renderer.
- Timeline polish: keep Voice/lip-sync, Expressions, Actions, and Camera cues as
  distinct character subtracks; keep Stage motion separate from character Actions.
- Voice library polish: editing/removing reusable voice assets, clearer speech
  placement controls, and generic audio alignment cleanup.
- Character rig tool polish: richer rig editing and drag/drop Action/Expression
  authoring on top of the native character composition contract.

## Deferred Audio Capabilities (gain > 100% and fades)

Two requested audio features are **shelved** because HyperFrames audio volume is a
single static native value with no amplification and no automation:

- **Volume above 100% (amplification).** The runtime applies volume as
  `audioElement.volume = data-volume` (no clamping), and the HTML media `.volume`
  property is spec-capped at `0.0–1.0` — a value `> 1` throws in the browser and
  would break playback/render. So the volume slider stays `0–100%`.
- **Fade in / fade out.** HyperFrames cannot express an audio-volume envelope (no
  volume keyframes; the GSAP adapter does not animate volume), so a fade would only
  affect the Studio preview and would not render in the exported MP4.

**Potential later add-on — bake gain into the audio.** The only path that renders
everywhere is to process the samples themselves: decode the blob via Web Audio,
apply a gain factor (or a fade envelope), re-encode, and store a derived audio asset
whose native `data-volume` stays `≤ 1`. Costs: per-clip re-encode, possible clipping
on amplification, and a derived blob to manage. Revisit if/when HyperFrames adds
audio-volume automation, or build the gain/envelope-baking pipeline here. Applies to
both regular audio clips and character speech. See the volume/trim work in
`store.ts`, `character/composition.ts`, and `components/Timeline.tsx`.
