// Reference-counted Pixi Assets leases for editor-side character previews.
// Preview apps share Pixi's global cache, so the final consumer owns unloading.
import { Assets, type Texture } from "pixi.js";
import type { CharacterSceneAsset, CharacterSceneGraph } from "./scene";

interface SharedAssetEntry<T> {
  references: number;
  valuePromise?: Promise<T>;
  loaded: boolean;
  unloadPromise?: Promise<void>;
}

export interface PreviewAssetLease<T> {
  value: T;
  release(): Promise<void>;
}

export interface PreviewAssetLeaseManager<T> {
  acquire(key: string, load: () => Promise<T>): Promise<PreviewAssetLease<T>>;
}

export interface PixiPreviewTextureLease {
  textures: Record<string, Texture>;
  release(): Promise<void>;
}

type PreviewAssetResolver = (asset: CharacterSceneAsset) => string | null | Promise<string | null>;

/** Coordinate shared asset ownership without unloading resources another preview still uses. */
export function createPreviewAssetLeaseManager<T>(
  unload: (key: string) => Promise<void>,
): PreviewAssetLeaseManager<T> {
  const entries = new Map<string, SharedAssetEntry<T>>();

  return {
    async acquire(key, load) {
      const entry = entries.get(key) ?? { references: 0, loaded: false };
      entries.set(key, entry);
      entry.references += 1;

      const pendingUnload = entry.unloadPromise;
      if (pendingUnload) {
        // The release that started cleanup reports its own failure. A later
        // preview should still get a chance to load a fresh copy.
        await pendingUnload.catch(() => undefined);
      }

      let valuePromise: Promise<T> | undefined;
      try {
        if (!entry.valuePromise) {
          entry.valuePromise = Promise.resolve().then(load);
        }
        valuePromise = entry.valuePromise;
        const value = await valuePromise;
        entry.loaded = true;
        let released = false;
        return {
          value,
          async release() {
            if (released) return;
            released = true;
            await releaseReference(key, entry);
          },
        };
      } catch (error) {
        // Another acquisition may already have started a replacement after a
        // shared failure; do not clear that newer promise.
        if (entry.valuePromise === valuePromise) entry.valuePromise = undefined;
        await releaseReference(key, entry);
        throw error;
      }
    },
  };

  async function releaseReference(key: string, entry: SharedAssetEntry<T>): Promise<void> {
    entry.references = Math.max(0, entry.references - 1);
    if (entry.references > 0) return;
    if (!entry.loaded) {
      if (entries.get(key) === entry) entries.delete(key);
      return;
    }

    const unloadPromise = Promise.resolve()
      .then(() => unload(key))
      .finally(() => {
        if (entry.unloadPromise !== unloadPromise) return;
        entry.unloadPromise = undefined;
        entry.valuePromise = undefined;
        entry.loaded = false;
        if (entry.references === 0 && entries.get(key) === entry) entries.delete(key);
      });
    entry.unloadPromise = unloadPromise;
    await unloadPromise;
  }
}

type PixiPreviewAssetGlobal = typeof globalThis & {
  __studioBoomPixiPreviewTextureLeases?: PreviewAssetLeaseManager<Texture>;
};

const previewAssetGlobal = globalThis as PixiPreviewAssetGlobal;
const sharedTextureLeases =
  previewAssetGlobal.__studioBoomPixiPreviewTextureLeases ??
  createPreviewAssetLeaseManager<Texture>((key) => Assets.unload(key));
previewAssetGlobal.__studioBoomPixiPreviewTextureLeases = sharedTextureLeases;

/** Load every scene texture and return an id map plus an idempotent shared-cache lease. */
export async function acquirePixiPreviewTextures(
  scene: CharacterSceneGraph,
  resolveAssetRef?: PreviewAssetResolver,
): Promise<PixiPreviewTextureLease> {
  Assets.setPreferences({ preferCreateImageBitmap: false });
  const resolvedAssets = await Promise.all(
    scene.assets.map(async (asset) => ({
      asset,
      src: (await resolveAssetRef?.(asset)) ?? asset.ref,
    })),
  );
  const assetsBySource = new Map<string, Array<{ asset: CharacterSceneAsset; src: string }>>();
  for (const resolved of resolvedAssets) {
    const group = assetsBySource.get(resolved.src) ?? [];
    group.push(resolved);
    assetsBySource.set(resolved.src, group);
  }

  const groups = Array.from(assetsBySource.values());
  const attempts = await Promise.allSettled(
    groups.map(async (group) => {
      const { asset, src } = group[0];
      const lease = await sharedTextureLeases.acquire(src, () =>
        Assets.load<Texture>({
          src,
          parser: asset.parser || "texture",
          // Full-canvas SVG layers can be several times larger than the
          // composition. Rasterize only the pixels the video can display.
          data:
            asset.parser === "svg"
              ? { width: asset.rasterWidth, height: asset.rasterHeight, resolution: 1 }
              : { autoGenerateMipmaps: true },
        }),
      );
      return { group, lease };
    }),
  );
  const acquired = attempts.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failedIndex = attempts.findIndex((result) => result.status === "rejected");
  if (failedIndex >= 0) {
    await releaseTextureLeases(acquired.map(({ lease }) => lease));
    const failure = attempts[failedIndex] as PromiseRejectedResult;
    const failedGroup = groups[failedIndex];
    const partIds = Array.from(new Set(failedGroup.flatMap(({ asset }) => asset.partIds))).join(
      ", ",
    );
    const message =
      failure.reason instanceof Error ? failure.reason.message : String(failure.reason);
    throw new Error(
      `Failed to load character texture ${failedGroup[0].asset.id} for parts ${partIds}: ${message}`,
    );
  }

  const textures: Record<string, Texture> = {};
  for (const { group, lease } of acquired) {
    for (const { asset } of group) textures[asset.id] = lease.value;
  }
  let released = false;
  return {
    textures,
    async release() {
      if (released) return;
      released = true;
      await releaseTextureLeases(acquired.map(({ lease }) => lease));
    },
  };
}

async function releaseTextureLeases(leases: Array<PreviewAssetLease<Texture>>): Promise<void> {
  const results = await Promise.allSettled(leases.map((lease) => lease.release()));
  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("Failed to unload an unused Pixi character preview texture", result.reason);
    }
  }
}
