import { validateCompositionSourceHtml } from "../hyperframes/composition-source";
import { parseHtmlDocument } from "./parse";
import type { CharacterDocumentIssue, CharacterDocumentLintResult } from "./schema";

export function lintCharacterDocument(html: string): CharacterDocumentLintResult {
  const issues = makeIssues();
  const defaults = compositionDefaultsFromHtml(html);
  const native = validateCompositionSourceHtml(html, defaults);
  for (const error of native.errors) issues.error("$.hyperframes", error);

  let doc: Document;
  try {
    doc = parseHtmlDocument(html);
  } catch (error) {
    issues.error("$", error instanceof Error ? error.message : "Character document is invalid.");
    return issues.result();
  }

  const characterRoot = doc.querySelector('[data-character-root="true"]');
  if (!characterRoot) issues.error("$.character", "Missing character document root.");

  const boneIds = lintBones(doc, issues);
  const slotIds = lintSlots(doc, issues, boneIds);
  lintParts(doc, issues, slotIds);
  lintTimelineContract(html, issues);

  return issues.result();
}

function lintBones(doc: Document, issues: ReturnType<typeof makeIssues>): Set<string> {
  const boneIds = new Set<string>();
  const parentByBone = new Map<string, string>();
  for (const [index, bone] of Array.from(
    doc.querySelectorAll<HTMLElement>('[data-character-bone="true"]'),
  ).entries()) {
    const path = `$.bones[${index}]`;
    const boneId = bone.getAttribute("data-character-bone-id");
    if (!bone.id) issues.error(path, "Bone element is missing id.");
    if (!boneId) {
      issues.error(path, "Bone is missing data-character-bone-id.");
      continue;
    }
    if (boneIds.has(boneId)) issues.error(path, `Duplicate bone id "${boneId}".`);
    boneIds.add(boneId);
    const parentId = bone.getAttribute("data-character-parent-bone-id");
    if (parentId) parentByBone.set(boneId, parentId);
  }

  for (const [boneId, parentId] of parentByBone.entries()) {
    if (!boneIds.has(parentId)) {
      issues.error(`$.bones.${boneId}.parent`, `Bone parent "${parentId}" does not exist.`);
    }
  }

  for (const boneId of boneIds) {
    const seen = new Set<string>();
    let current: string | undefined = boneId;
    while (current) {
      if (seen.has(current)) {
        issues.error(`$.bones.${boneId}.parent`, `Bone "${boneId}" is part of a parent cycle.`);
        break;
      }
      seen.add(current);
      current = parentByBone.get(current);
    }
  }

  return boneIds;
}

function lintSlots(
  doc: Document,
  issues: ReturnType<typeof makeIssues>,
  boneIds: Set<string>,
): Set<string> {
  const slotIds = new Set<string>();
  for (const [index, slot] of Array.from(
    doc.querySelectorAll<HTMLElement>('[data-character-slot="true"]'),
  ).entries()) {
    const path = `$.slots[${index}]`;
    const slotId = slot.getAttribute("data-character-slot-id");
    if (!slot.id) issues.error(path, "Slot element is missing id.");
    if (!slotId) {
      issues.error(path, "Slot is missing data-character-slot-id.");
      continue;
    }
    if (slotIds.has(slotId)) issues.error(path, `Duplicate slot id "${slotId}".`);
    slotIds.add(slotId);

    const boundBoneId = slot.getAttribute("data-character-bound-bone-id");
    if (!boundBoneId) {
      issues.error(path, `Slot "${slotId}" is missing data-character-bound-bone-id.`);
    } else if (!boneIds.has(boundBoneId)) {
      issues.error(path, `Slot "${slotId}" references missing bone "${boundBoneId}".`);
    }

    const hostBoneId = slot.getAttribute("data-character-host-bone-id");
    if (hostBoneId && !boneIds.has(hostBoneId)) {
      issues.error(path, `Slot "${slotId}" references missing host bone "${hostBoneId}".`);
    }
  }

  for (const [index, slot] of Array.from(
    doc.querySelectorAll<HTMLElement>('[data-character-slot="true"]'),
  ).entries()) {
    const hostSlotId = slot.getAttribute("data-character-host-slot-id");
    if (hostSlotId && !slotIds.has(hostSlotId)) {
      issues.error(`$.slots[${index}]`, `Host slot "${hostSlotId}" does not exist.`);
    }
  }

  return slotIds;
}

function lintParts(
  doc: Document,
  issues: ReturnType<typeof makeIssues>,
  slotIds: Set<string>,
): void {
  const partIds = new Set<string>();
  for (const [index, part] of Array.from(
    doc.querySelectorAll<HTMLElement>('[data-character-part="true"]'),
  ).entries()) {
    const path = `$.parts[${index}]`;
    const partId = part.getAttribute("data-character-part-id");
    const slotId = part.getAttribute("data-character-slot-id");
    if (!part.id) issues.error(path, "Part element is missing id.");
    if (!partId) {
      issues.error(path, "Part is missing data-character-part-id.");
    } else if (partIds.has(partId)) {
      issues.error(path, `Duplicate part id "${partId}".`);
    } else {
      partIds.add(partId);
    }
    if (!slotId) {
      issues.error(path, "Part is missing data-character-slot-id.");
    } else if (!slotIds.has(slotId)) {
      issues.error(path, `Part references missing slot "${slotId}".`);
    }
    if (part.tagName === "IMG") {
      const src = part.getAttribute("src") ?? "";
      if (!src.startsWith("asset:")) issues.error(path, "Image part is missing asset:<id> src.");
    }
  }
}

function lintTimelineContract(html: string, issues: ReturnType<typeof makeIssues>): void {
  if (!/gsap\.timeline\(\s*\{\s*paused\s*:\s*true/s.test(html)) {
    issues.error("$.timeline", "Character timeline must be a finite paused GSAP timeline.");
  }
}

function compositionDefaultsFromHtml(html: string): {
  duration: number;
  width: number;
  height: number;
} {
  try {
    const doc = parseHtmlDocument(html);
    const root = doc.querySelector<HTMLElement>("[data-composition-id]");
    const stage = doc.getElementById("stage");
    return {
      duration:
        positiveNumber(stage?.getAttribute("data-duration")) ??
        positiveNumber(root?.getAttribute("data-duration")) ??
        positiveNumber(root?.getAttribute("data-composition-duration")) ??
        1,
      width:
        positiveNumber(stage?.getAttribute("data-width")) ??
        positiveNumber(root?.getAttribute("data-width")) ??
        positiveNumber(root?.getAttribute("data-composition-width")) ??
        1,
      height:
        positiveNumber(stage?.getAttribute("data-height")) ??
        positiveNumber(root?.getAttribute("data-height")) ??
        positiveNumber(root?.getAttribute("data-composition-height")) ??
        1,
    };
  } catch {
    return { duration: 1, width: 1, height: 1 };
  }
}

function positiveNumber(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function makeIssues() {
  const errors: CharacterDocumentIssue[] = [];
  const warnings: CharacterDocumentIssue[] = [];
  return {
    error(path: string, message: string) {
      errors.push({ severity: "error", path, message });
    },
    warn(path: string, message: string) {
      warnings.push({ severity: "warning", path, message });
    },
    result(): CharacterDocumentLintResult {
      return { ok: errors.length === 0, errors, warnings };
    },
  };
}
