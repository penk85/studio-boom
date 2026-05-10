import type { HyperFramesProject } from "../types";

export interface HfMediaHealth {
  checking: boolean;
  missingAssetIds: Set<string>;
  affectedClipIds: Set<string>;
  missingAssetIdsByClipId: Map<string, string[]>;
}

export const EMPTY_HF_MEDIA_HEALTH: HfMediaHealth = {
  checking: false,
  missingAssetIds: new Set(),
  affectedClipIds: new Set(),
  missingAssetIdsByClipId: new Map(),
};

export function buildHfMediaHealth(
  hf: HyperFramesProject,
  availableBlobIds: Iterable<string>,
  checking = false,
): HfMediaHealth {
  const available = new Set(availableBlobIds);
  const missingAssetIds = new Set<string>();
  const affectedClipIds = new Set<string>();
  const missingAssetIdsByClipId = new Map<string, string[]>();

  for (const asset of hf.assets) {
    if (available.has(asset.id)) continue;
    missingAssetIds.add(asset.id);
  }

  return { checking, missingAssetIds, affectedClipIds, missingAssetIdsByClipId };
}

export function indexHfAssetReferences(hf: HyperFramesProject): Map<string, Set<string>> {
  const references = new Map<string, Set<string>>();

  // Scan all asset:ID references from rootHtml and compositionHtml
  const assetRefRe = /asset:([a-zA-Z0-9_-]+)/g;

  const scanHtml = (html: string, sourceId: string) => {
    for (const match of html.matchAll(assetRefRe)) {
      const assetId = match[1];
      const clipIds = references.get(assetId) ?? new Set<string>();
      clipIds.add(sourceId);
      references.set(assetId, clipIds);
    }
  };

  scanHtml(hf.rootHtml, "root");
  for (const [compId, html] of Object.entries(hf.compositionHtml)) {
    scanHtml(html, compId);
  }

  return references;
}
