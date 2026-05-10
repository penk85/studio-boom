import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import type { HyperFramesProject, MediaBlobRow } from "../types";
import {
  buildHfMediaHealth,
  EMPTY_HF_MEDIA_HEALTH,
  type HfMediaHealth,
} from "../hyperframes/media-health";

export function useHfMediaHealth(hf: HyperFramesProject | null | undefined): HfMediaHealth {
  const assetIds = useMemo(
    () => [...(hf?.assets.map((asset) => asset.id) ?? [])].sort(),
    [hf?.assets],
  );
  const assetKey = assetIds.join("|");

  const blobRows = useLiveQuery<MediaBlobRow[]>(async () => {
    if (assetIds.length === 0) return [];
    const rows = await db.mediaBlobs.bulkGet(assetIds);
    return rows.filter((row): row is MediaBlobRow => Boolean(row));
  }, [assetKey]);

  return useMemo(() => {
    if (!hf) return EMPTY_HF_MEDIA_HEALTH;
    if (!blobRows) {
      return { ...EMPTY_HF_MEDIA_HEALTH, checking: true };
    }
    return buildHfMediaHealth(
      hf,
      blobRows.map((row) => row.id),
    );
  }, [blobRows, hf]);
}
