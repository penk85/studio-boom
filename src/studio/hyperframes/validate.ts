import type { HyperFramesProject } from "../types";
import { parseStudioHtml } from "./html";

/** Assert that a HyperFramesProject is complete enough for preview/export.
 *  Validates the rootHtml structure and asset references. */
export function validateHfProject(hf: HyperFramesProject): void {
  const errors: string[] = [];

  if (!isPositiveNumber(hf.width)) errors.push("project width must be a positive number");
  if (!isPositiveNumber(hf.height)) errors.push("project height must be a positive number");
  if (!isPositiveNumber(hf.fps)) errors.push("project fps must be a positive number");
  if (!isNonNegativeNumber(hf.duration))
    errors.push("project duration must be a non-negative number");

  if (!hf.rootHtml) {
    errors.push("project is missing rootHtml");
  }

  const assetIds = new Set(hf.assets.map((a) => a.id));

  for (const asset of hf.assets) {
    if (!asset.id) errors.push("asset is missing id");
    if (!asset.filename) errors.push(`asset "${asset.id || "(missing id)"}" is missing filename`);
    if (!asset.mimeType) errors.push(`asset "${asset.id || "(missing id)"}" is missing mimeType`);
  }

  if (hf.rootHtml) {
    try {
      const { elements } = parseStudioHtml(hf.rootHtml);
      const seenIds = new Set<string>();
      for (const el of elements) {
        if (!el.id) {
          errors.push("element is missing id");
          continue;
        }
        if (seenIds.has(el.id)) {
          errors.push(`element "${el.id}" is duplicated`);
        }
        seenIds.add(el.id);

        const src = "src" in el ? (el as { src?: string }).src : undefined;
        if (src && src.startsWith("asset:")) {
          const assetId = src.slice("asset:".length);
          if (!assetIds.has(assetId)) {
            errors.push(`element "${el.id}" references missing asset "${assetId}"`);
          }
        }
      }
    } catch {
      errors.push("rootHtml could not be parsed");
    }
  }

  for (const [compId, compHtml] of Object.entries(hf.compositionHtml)) {
    if (!compHtml) {
      errors.push(`composition "${compId}" is empty`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `HF project is not previewable:\n${errors.map((e) => `- ${e}`).join("\n")}`,
    );
  }
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
