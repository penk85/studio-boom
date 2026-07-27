// Async alpha-bounds backfill and cached pixel masks for Character Editor artwork.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { db } from "../db";
import type { CharacterPartAlphaBounds, CharacterPreset, ID } from "../types";
import {
  createAlphaHitMaskFromBlob,
  measureAlphaBoundsFromBlob,
  type AlphaHitMask,
} from "./alpha-bounds";
import { normalizePartPatch } from "./character-editor-geometry";

interface AlphaBoundsPatch {
  id: ID;
  alphaBounds: CharacterPartAlphaBounds;
}

export function applyMeasuredAlphaBounds(
  character: CharacterPreset,
  patches: AlphaBoundsPatch[],
  updatedAt = Date.now(),
): CharacterPreset {
  if (patches.length === 0) return character;
  const patchMap = new Map(patches.map((patch) => [patch.id, patch.alphaBounds] as const));
  let changed = false;
  const parts = character.parts.map((part) => {
    const alphaBounds = patchMap.get(part.id);
    if (!alphaBounds || part.alphaBounds) return part;
    changed = true;
    return normalizePartPatch({ ...part, alphaBounds }, { alphaBounds });
  });
  return changed ? { ...character, parts, updatedAt } : character;
}

export function useCharacterArtworkAnalysis(
  doc: CharacterPreset | null,
  setDoc: Dispatch<SetStateAction<CharacterPreset | null>>,
): (partId: ID) => AlphaHitMask | undefined {
  const alphaBackfillRef = useRef<Set<ID>>(new Set());
  const alphaMaskRef = useRef<Map<ID, AlphaHitMask>>(new Map());
  const alphaMaskLoadingRef = useRef<Set<ID>>(new Set());
  const [, setAlphaMaskTick] = useState(0);

  useEffect(() => {
    alphaBackfillRef.current.clear();
    alphaMaskRef.current.clear();
    alphaMaskLoadingRef.current.clear();
  }, [doc?.id]);

  useEffect(() => {
    if (!doc) return;
    const missing = doc.parts.filter(
      (part) => !part.alphaBounds && !alphaBackfillRef.current.has(part.id),
    );
    if (missing.length === 0) return;
    for (const part of missing) alphaBackfillRef.current.add(part.id);
    let alive = true;
    void (async () => {
      const measured = await Promise.all(
        missing.map(async (part) => {
          const [blobRow, media] = await Promise.all([
            db.mediaBlobs.get(part.mediaId),
            db.media.get(part.mediaId),
          ]);
          if (!blobRow?.blob) return null;
          const alphaBounds = await measureAlphaBoundsFromBlob(
            blobRow.blob,
            media?.width ?? part.width,
            media?.height ?? part.height,
          );
          return { id: part.id, alphaBounds };
        }),
      );
      const patches = measured.filter(Boolean) as AlphaBoundsPatch[];
      if (!alive || patches.length === 0) return;
      setDoc((current) => (current ? applyMeasuredAlphaBounds(current, patches) : current));
    })();
    return () => {
      alive = false;
    };
  }, [doc, setDoc]);

  useEffect(() => {
    if (!doc) return;
    const missing = doc.parts.filter(
      (part) => !alphaMaskRef.current.has(part.id) && !alphaMaskLoadingRef.current.has(part.id),
    );
    if (missing.length === 0) return;
    for (const part of missing) alphaMaskLoadingRef.current.add(part.id);
    let alive = true;
    void (async () => {
      const masks = await Promise.all(
        missing.map(async (part) => {
          const [blobRow, media] = await Promise.all([
            db.mediaBlobs.get(part.mediaId),
            db.media.get(part.mediaId),
          ]);
          if (!blobRow?.blob) return null;
          const mask = await createAlphaHitMaskFromBlob(
            blobRow.blob,
            media?.width ?? part.width,
            media?.height ?? part.height,
          );
          return mask ? { id: part.id, mask } : null;
        }),
      );
      if (!alive) return;
      for (const item of masks) {
        if (item) alphaMaskRef.current.set(item.id, item.mask);
      }
      setAlphaMaskTick((tick) => tick + 1);
    })();
    return () => {
      alive = false;
    };
  }, [doc]);

  return useCallback((partId: ID) => alphaMaskRef.current.get(partId), []);
}
