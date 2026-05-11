// HyperFrames asset registry helpers.
// These are generic project.hf utilities used by preview and MP4 rendering.
import type { HFAsset, HyperFramesProject, MediaAsset } from "../types";

export function toHFAsset(asset: MediaAsset): HFAsset {
  return {
    id: asset.id,
    filename: asset.filename,
    mimeType: asset.mimeType,
    kind: asset.kind,
    width: asset.width,
    height: asset.height,
    duration: asset.duration,
  };
}

export function registerHfAsset(
  hf: HyperFramesProject,
  asset: MediaAsset | null | undefined,
): HyperFramesProject {
  if (!asset) return hf;
  const next = toHFAsset(asset);
  const idx = hf.assets.findIndex((a) => a.id === asset.id);
  if (idx < 0) return { ...hf, assets: [...hf.assets, next] };
  const current = hf.assets[idx];
  if (JSON.stringify(current) === JSON.stringify(next)) return hf;
  return { ...hf, assets: hf.assets.map((a, i) => (i === idx ? next : a)) };
}

export function pruneHfAssets(
  hf: HyperFramesProject,
  referencedIds: Set<string>,
): HyperFramesProject {
  const assets = hf.assets.filter((a) => referencedIds.has(a.id));
  return assets.length === hf.assets.length ? hf : { ...hf, assets };
}
