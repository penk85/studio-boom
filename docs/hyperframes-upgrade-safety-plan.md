# HyperFrames Compatibility Upgrade Safety Plan

This is the handoff and closeout record for upgrading Studio Boom's HyperFrames
family. The 0.7.103 compatibility migration is in progress; keep the historical
baseline and approval gates below for future family changes.

## Current Baseline

As of 2026-08-09, `npm ls --depth=0` resolves all six packages to exact
**0.7.103**:

- `@hyperframes/core`
- `@hyperframes/engine`
- `@hyperframes/player`
- `@hyperframes/producer`
- `@hyperframes/studio`
- `hyperframes` (CLI)

Vite resolves to **7.3.6**. Do not change Vite and HyperFrames in the same
compatibility diff.

The six HyperFrames package declarations and lockfile are pinned to this one
version. Treat the lockfile as the running baseline and choose any future 0.x
release deliberately; do not let an unrelated install silently select a new
family version. The previous 0.7.73 baseline is retained below as historical
evidence.

The original 0.5.3 state is retained below as historical evidence. The current
security follow-up is intentionally separate from the completed compatibility
upgrade: no blanket audit fix or unrelated dependency upgrade is authorized.

## Previous Upgrade Closeout (2026-07-27)

- The six-package family was upgraded together from 0.5.3 to exact 0.7.73.
- The 0.7 parser identity (`data-hf-id`), asynchronous linter, native timing
  attributes, and composition-root contract were audited at the Studio boundary.
- A StaticGuard regression involving duplicate `data-composition-id` values was
  fixed: `native.ts` now leaves the composition ID exactly once on `#stage`, and
  the regression is covered by `native.test.ts`.
- Automated verification is green: `npx vitest run` passes 84 files / 746 tests;
  `npx tsc --noEmit`, `npm run lint`, `npm run build`, and `git diff --check` are
  clean.
- Human smoke testing reported that the updated Studio behavior works. The full
  representative preview/export matrix remains the required human confirmation
  for a user-visible compatibility release; no saved 0.5.3 MP4 reference is
  checked into this repository.
- The post-upgrade production audit reports 11 advisories: 7 high, 3 moderate,
  1 low, and 0 critical. The remaining dependency work is tracked in
  `docs/code-audit-2026-07-07.md` and must be approved as a separate version set.

## Current Upgrade Checkpoint (2026-08-09)

- The six-package family was upgraded together from 0.7.73 to exact 0.7.103;
  Vite remains 7.3.6.
- Published 0.7.103 metadata raises the relevant HyperFrames transitive floors,
  including `@hono/node-server`, `adm-zip`, and `sharp`.
- The full automated gate passes: 90 test files / 807 tests, clean typecheck,
  lint, production build, and diff checks.
- `npm audit --omit=dev` is reduced to 6 vulnerabilities (4 high, 1 moderate,
  1 low). `npm audit` including development dependencies reports 10.
- The manual preview/export matrix is still required before treating this as a
  completed compatibility release. The clean install used
  `PUPPETEER_SKIP_DOWNLOAD=1` because the environment's Chrome archive download
  was corrupt; this does not replace browser-based human confirmation.

## Non-Negotiable Contracts

An upgrade is acceptable only if all of these remain true:

1. Editing, Stage preview, playback, and MP4 export consume the same
   `project.hf` source.
2. Existing projects load without destructive migration or silent source
   rewriting.
3. `preview-parity.test.ts` remains byte-identical.
4. Pixi character compositions, flexible `limb-path` meshes, legacy `bend`
   meshes, Actions/Expressions, speech, and visemes remain deterministic under
   seek and MP4 capture.
5. There remains exactly one `useTimelinePlayer()` call, in `Studio.tsx`.
6. Studio mutations continue through the local HyperFrames boundary adapters;
   no UI-state export compiler or second renderer is introduced.

## Phase 0: Research Without Changes

Before editing `package.json`:

1. Read official release notes, package changelogs, and published type/export
   surfaces for every version between 0.5.3 and the proposed target.
2. Confirm that all six packages publish a compatible target version. Do not
   mix family versions unless the official package metadata explicitly requires
   it.
3. Compare the installed exports used by Studio Boom:
   - core generation, parse/mutation, lint, GSAP, and text helpers;
   - Studio player hooks, `PlayerControls`, picker, and iframe resolution;
   - player `srcdoc` behavior;
   - producer bundling/runtime injection;
   - engine and CLI render contracts.
4. Report the proposed target, breaking changes, security effect, and expected
   adapter changes to the human **before installing anything**.

No dependency change is authorized merely by this document; the human must
approve the proposed target.

## Phase 1: Capture the Historical 0.5.3 Baseline

The following was the baseline checklist before the completed migration. Keep it
for repeatability; a future upgrade should capture a fresh baseline rather than
assuming the old results still apply.

```bash
npm ls @hyperframes/core @hyperframes/engine @hyperframes/player \
  @hyperframes/producer @hyperframes/studio hyperframes vite --depth=0
npm audit --omit=dev
npx vitest run
npx tsc --noEmit
npm run lint
npm run build
```

Also manually preserve one representative project containing:

- image, video, audio, and text clips;
- multiple scenes and nested compositions;
- a character with rigid and flexible parts;
- at least one Action, Expression, motion path, and placed speech;
- a known-good MP4 render for visual comparison.

Record warnings and audit counts so the upgrade is judged against evidence, not
memory.

## Phase 2: Upgrade Only the HyperFrames Family

- Change all six package declarations together.
- Use npm only and commit `package.json` plus `package-lock.json` in the isolated
  compatibility diff.
- Do not run a blanket `npm audit fix`.
- Do not delete Studio boundary adapters just because the new package appears to
  overlap them.

Immediately run typecheck and focused contract tests. If the public API changed,
adapt the narrow boundary module rather than spreading package-specific handling
through components or the store.

## Phase 3: Re-Audit Local Compatibility Seams

Review these files against the target package implementation:

- `src/studio/hyperframes/html.ts`
  - native timing, track, size, rotation, name, and composition attributes;
  - add/update/parse round trips.
- `src/studio/hyperframes/native.ts`
  - root/stage metadata and canonical attribute normalization.
- `src/studio/hyperframes/root-composition.ts`
  - composition generation and metadata updates.
- `src/studio/hyperframes/keyframes.ts`
  - GSAP parsing/serialization and transform-reader invariants.
- `src/studio/components/Stage.tsx`
  - `srcdoc`, `resolveIframe`, element picker, live edit boundary, timeline ready.
- `src/studio/export/project-files.ts` and
  `src/studio/hyperframes/render-plugin.ts`
  - producer bundling, runtime packaging, CLI arguments, result handling.
- `src/studio/character/pixi-composition.ts`
  - synchronous timeline registration, readiness gate, packaged Pixi runtime,
    seek behavior, and audio clips.

Remove a local patch only after a focused regression test proves the target
package now owns that behavior. Adapter deletion and package upgrade can be
separate commits when that makes review clearer.

## Phase 4: Automated Compatibility Gate

At minimum:

```bash
npx vitest run
npx tsc --noEmit
npm run lint
npm run build
git diff --check
```

Pay special attention to:

- `preview-parity.test.ts`
- `html.test.ts`
- `native.test.ts`
- `keyframes.test.ts`
- `transform-reader-invariant.test.ts`
- `project-files.test.ts`
- `render-plugin.test.ts`
- `composition.test.ts`
- `mesh-deform.test.ts`

Add regression cases for every removed adapter behavior or changed package
contract. Never weaken parity/source-contract assertions to make the upgrade
green.

## Phase 5: Manual Preview and Export Matrix

Run `npm run dev`, open the representative project, and verify:

1. Stage playback, seeking, clip selection, drag/resize/rotate, and timeline
   readiness.
2. Scene switching and nested composition playback.
3. Character Editor and Action/Expression recorder preview.
4. Rigid and flexible artwork at rest and while moving; no missing bodies,
   disjoint limbs, permanent mesh imprints, or variant displacement.
5. Speech playback, visemes, trimming, and volume.
6. TopBar MP4 render/download. Compare the MP4 with Stage playback and the
   saved baseline reference. The current repository does not contain a saved
   0.5.3 MP4 artifact, so visual comparison is still a human follow-up.

The compatibility change is not done until this matrix is confirmed by a human.

## Phase 6: Security and Documentation Closeout

After compatibility is proven:

- rerun `npm audit --omit=dev` and record what changed;
- update `AGENTS.md`, `CLAUDE.md`, `README.md`,
  `native-hyperframes-workflow-audit.md`, and
  `code-audit-2026-07-07.md`;
- update comments that say a boundary compensates for 0.5.3;
- keep unresolved advisories documented with actual exposure rather than
  forcing incompatible transitive overrides.

This closeout has completed the documentation updates for the 0.7.103
checkpoint. The audit result is not a claim of zero vulnerabilities: remaining
production paths include `hono`, `postcss`, `protobufjs`, `nanoid`, and
`dompurify`; development-only paths also include `esbuild`. These remain
transitive and require a reviewed override or upstream fix rather than a
blanket audit command.

If compatibility fails, revert the isolated upgrade commit and keep 0.5.3.
Do not stack product fixes on top of an unproven package migration.
