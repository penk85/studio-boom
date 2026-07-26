// Shared preview state and pure motion/variant helpers for character authoring.

import type { CharacterPart, ID, MouthViseme, PartRole } from "../types";
import { getPartSlotId, partMatchesVariant } from "./character-utils";
import { runtimeAncestorMotionTargets } from "./motion-targets";
import type { CharacterRuntime } from "./runtime";

export interface PreviewState {
  kind: "blink" | "talk" | "wave" | "kick" | "nod" | "bounce" | "raise";
  targetPartId: string;
  targetSlotId: string;
  targetRole: PartRole;
  startedAt: number;
  durationMs: number;
  visemes?: MouthViseme[];
  /** When set, talk shows exactly this viseme during live audio-driven testing. */
  forcedViseme?: MouthViseme;
  /** Audio drives the preview frame-by-frame; lifetime is managed by playback. */
  audioDriven?: boolean;
}

export function previewLabels(
  part: CharacterPart,
): Array<{ kind: PreviewState["kind"]; label: string }> {
  const out: Array<{ kind: PreviewState["kind"]; label: string }> = [];
  if (part.role === "eye" || (part.role === "custom" && part.motionBehavior === "blink")) {
    out.push({ kind: "blink", label: "Test Blink" });
  }
  if (part.role === "mouth" || (part.role === "custom" && part.motionBehavior === "lipSync")) {
    out.push({ kind: "talk", label: "Test Talk" });
  }
  if (part.role === "arm" || part.role === "upperArm" || part.role === "lowerArm") {
    out.push({ kind: "wave", label: "Test Wave" });
  }
  if (
    part.role === "leg" ||
    part.role === "upperLeg" ||
    part.role === "lowerLeg" ||
    part.role === "foot"
  ) {
    out.push({ kind: "kick", label: "Test Kick" });
  }
  if (part.role === "custom" && part.motionBehavior === "rotate") {
    out.push({ kind: "wave", label: "Test Wave" });
  }
  if (part.role === "head") out.push({ kind: "nod", label: "Test Nod" });
  if (part.role === "hair" || (part.role === "custom" && part.motionBehavior === "bounce")) {
    out.push({ kind: "bounce", label: "Test Bounce" });
  }
  if (part.role === "eyebrow" || (part.role === "custom" && part.motionBehavior === "raise")) {
    out.push({ kind: "raise", label: "Test Raise" });
  }
  return out;
}

export function wordToVisemes(word: string): MouthViseme[] {
  const map: Record<string, MouthViseme> = {
    a: "A",
    e: "E",
    i: "E",
    o: "O",
    u: "U",
    m: "MBP",
    b: "MBP",
    p: "MBP",
    f: "FV",
    v: "FV",
    l: "L",
    w: "WQ",
    q: "WQ",
  };
  return [
    "rest",
    ...word
      .toLowerCase()
      .split("")
      .map((character) => map[character] ?? "E"),
    "rest",
  ];
}

export function activePreviewVariantForPart(
  part: CharacterPart,
  preview: PreviewState | null,
  now = Date.now(),
): string | undefined {
  if (!preview || preview.targetSlotId !== getPartSlotId(part)) return undefined;
  if (preview.kind === "blink" && part.role === "eye") {
    const elapsed = now - preview.startedAt;
    const t = Math.min(1, elapsed / preview.durationMs);
    return t > 0.35 && t < 0.55 ? "closed" : "open";
  }
  if (preview.kind === "talk" && part.role === "mouth") {
    if (preview.forcedViseme) return preview.forcedViseme;
    const elapsed = now - preview.startedAt;
    const t = Math.min(1, elapsed / preview.durationMs);
    const visemes = preview.visemes ?? ["rest", "A", "E", "O", "MBP"];
    const idx = Math.floor(t * visemes.length * 1.1) % visemes.length;
    return visemes[idx];
  }
  return undefined;
}

export function previewDelta(
  part: CharacterPart,
  preview: PreviewState | null,
  previewParentPart?: CharacterPart,
  allParts: CharacterPart[] = [],
  runtime?: CharacterRuntime,
  now = Date.now(),
) {
  if (!preview) return { dx: 0, dy: 0, rotation: 0, scale: 1, scaleY: 1, opacity: 1 };
  const targetsPart = part.id === preview.targetPartId || part.slotId === preview.targetSlotId;
  const elapsed = now - preview.startedAt;
  const t = Math.min(1, elapsed / preview.durationMs);
  const wave = Math.sin(t * Math.PI * 2);
  if (!targetsPart) {
    const ancestor =
      previewTargetAncestor(part, preview, allParts, runtime) ??
      (isLegacyHeadPreviewChild(part, preview) ? previewParentPart : undefined);
    const motion = ancestor ? previewMotionForPart(ancestor, preview, t, wave) : null;
    if (!ancestor || !motion || !hasGeometricPreviewMotion(motion)) {
      return { dx: 0, dy: 0, rotation: 0, scale: 1, scaleY: 1, opacity: 1 };
    }
    const childPivot = editorPartPivot(part);
    const transformedPivot = editorTransformPointAroundPivot(
      childPivot,
      editorPartPivot(ancestor),
      motion,
    );
    return {
      dx: transformedPivot.x - childPivot.x,
      dy: transformedPivot.y - childPivot.y,
      rotation: motion.rotation,
      scale: 1,
      scaleY: 1,
      opacity: 1,
    };
  }
  return previewMotionForPart(part, preview, t, wave);
}

function editorPartPivot(part: CharacterPart) {
  return (
    part.pivot ?? {
      x: part.x + part.width * part.anchorX,
      y: part.y + part.height * part.anchorY,
    }
  );
}

function editorTransformPointAroundPivot(
  point: { x: number; y: number },
  pivot: { x: number; y: number },
  motion: { dx: number; dy: number; scale: number; rotation: number },
) {
  const radians = (motion.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const relX = (point.x - pivot.x) * motion.scale;
  const relY = (point.y - pivot.y) * motion.scale;
  return {
    x: pivot.x + motion.dx + relX * cos - relY * sin,
    y: pivot.y + motion.dy + relX * sin + relY * cos,
  };
}

function previewMotionForPart(part: CharacterPart, preview: PreviewState, t: number, wave: number) {
  if (preview.kind === "blink" && part.role === "eye") {
    const closedMoment = t > 0.35 && t < 0.55;
    if (part.eyeState || part.variant) {
      const target = closedMoment ? "closed" : "open";
      const shouldShow = partMatchesVariant(part, target);
      return { dx: 0, dy: 0, rotation: 0, scale: 1, scaleY: 1, opacity: shouldShow ? 1 : 0 };
    }
    return { dx: 0, dy: 0, rotation: 0, scale: 1, scaleY: closedMoment ? 0.12 : 1, opacity: 1 };
  }
  if (
    preview.kind === "wave" &&
    (part.role === "arm" ||
      part.role === "upperArm" ||
      part.role === "lowerArm" ||
      part.motionBehavior === "rotate")
  ) {
    return { dx: 0, dy: 0, rotation: wave * 18, scale: 1, opacity: 1 };
  }
  if (
    preview.kind === "kick" &&
    (part.role === "leg" ||
      part.role === "upperLeg" ||
      part.role === "lowerLeg" ||
      part.role === "foot")
  ) {
    return {
      dx: Math.round(Math.abs(wave) * 10),
      dy: 0,
      rotation: wave * 12,
      scale: 1,
      opacity: 1,
    };
  }
  if (preview.kind === "nod" && part.role === "head") {
    return { dx: 0, dy: Math.round(Math.abs(wave) * 8), rotation: wave * 3, scale: 1, opacity: 1 };
  }
  if (preview.kind === "bounce" && part.role === "hair") {
    return { dx: 0, dy: Math.round(wave * 6), rotation: wave * 2, scale: 1, opacity: 1 };
  }
  if (preview.kind === "raise" && part.role === "eyebrow") {
    return { dx: 0, dy: Math.round(-Math.abs(wave) * 12), rotation: 0, scale: 1, opacity: 1 };
  }
  if (preview.kind === "talk" && part.role === "mouth") {
    const active =
      preview.forcedViseme ??
      (() => {
        const visemes = preview.visemes ?? ["rest", "A", "E", "O", "MBP"];
        const idx = Math.floor(t * visemes.length * 1.1) % visemes.length;
        return visemes[idx];
      })();
    return {
      dx: 0,
      dy: 0,
      rotation: 0,
      scale: 1,
      opacity: !part.variant && !part.viseme ? 1 : partMatchesVariant(part, active) ? 1 : 0,
    };
  }
  return { dx: 0, dy: 0, rotation: 0, scale: 1, opacity: 1 };
}

function isLegacyHeadPreviewChild(part: CharacterPart, preview: PreviewState) {
  return (
    preview.kind === "nod" &&
    preview.targetRole === "head" &&
    (part.role === "eye" ||
      part.role === "eyebrow" ||
      part.role === "mouth" ||
      part.role === "hair")
  );
}

function hasGeometricPreviewMotion(motion: ReturnType<typeof previewMotionForPart>) {
  return (
    motion.dx !== 0 ||
    motion.dy !== 0 ||
    motion.rotation !== 0 ||
    motion.scale !== 1 ||
    (motion.scaleY ?? motion.scale) !== 1
  );
}

function previewTargetAncestor(
  part: CharacterPart,
  preview: PreviewState,
  allParts: CharacterPart[],
  runtime?: CharacterRuntime,
): CharacterPart | undefined {
  if (
    runtime &&
    runtimeAncestorMotionTargets(runtime, getPartSlotId(part)).some(
      (target) => target.slotId === preview.targetSlotId,
    )
  ) {
    return allParts.find(
      (candidate) =>
        candidate.id === preview.targetPartId || getPartSlotId(candidate) === preview.targetSlotId,
    );
  }
  const byId = new Map(allParts.map((candidate) => [candidate.id, candidate]));
  let current = part.parentId ? byId.get(part.parentId) : undefined;
  const seen = new Set<ID>();
  while (current && !seen.has(current.id)) {
    if (current.id === preview.targetPartId || current.slotId === preview.targetSlotId) {
      return current;
    }
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return undefined;
}
