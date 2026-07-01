// The single place a stage transform edit becomes real. `liveApplyStagePatch` maps a transform
// patch → the correct player-editing live-apply call (preview during a gesture, commit on release),
// so the legacy drag handlers and the react-moveable overlay can't drift in how they touch the
// player element. Persisting to rootHtml (updateClip / updateClipKeyframe + suppress-reload) stays
// with the Stage, which owns those refs — see the Stage-bound `applyStageEdit` that wraps this.
import {
  commitElementFlip,
  commitElementPosition,
  commitElementRect,
  commitElementRotation,
  previewElementPosition,
  previewElementRect,
  previewElementRotation,
} from "./player-editing";

/** A partial transform edit in composition space. Fields present drive which live-apply runs. */
export interface StageTransformPatch {
  x?: number;
  y?: number;
  /** Composition source width (resize). Present together with `height`. */
  width?: number;
  height?: number;
  rotation?: number;
  /** Per-axis mirror sign (flip). */
  scaleX?: number;
  scaleY?: number;
}

/**
 * Apply a transform patch to the live player element through the player-editing boundary.
 * `preview` writes the iframe only (per-frame during a gesture); `commit` also persists the
 * transform attrs on the element. Returns whether any live write landed — callers use it to
 * decide whether to suppress the srcdoc reload (the element already shows the change).
 */
export function liveApplyStagePatch(
  iframe: HTMLIFrameElement | null,
  clipId: string,
  patch: StageTransformPatch,
  mode: "preview" | "commit",
): boolean {
  const commit = mode === "commit";
  let applied = false;

  if (patch.width !== undefined && patch.height !== undefined) {
    // Resize carries its position, so it goes through the rect path (which moves + sizes).
    const rect = { x: patch.x ?? 0, y: patch.y ?? 0, width: patch.width, height: patch.height };
    applied = (commit ? commitElementRect : previewElementRect)(iframe, clipId, rect) || applied;
  } else if (patch.x !== undefined && patch.y !== undefined) {
    applied =
      (commit ? commitElementPosition : previewElementPosition)(iframe, clipId, patch.x, patch.y) ||
      applied;
  }

  if (patch.rotation !== undefined) {
    applied =
      (commit ? commitElementRotation : previewElementRotation)(iframe, clipId, patch.rotation) ||
      applied;
  }

  if (patch.scaleX !== undefined || patch.scaleY !== undefined) {
    // Flip is a discrete toggle (no per-frame preview) — always applied as a commit-style write.
    applied = commitElementFlip(iframe, clipId, patch.scaleX ?? 1, patch.scaleY ?? 1) || applied;
  }

  return applied;
}
