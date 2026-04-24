// Hook: resolves a media id to a Blob URL (lazy + cached).
import { useEffect, useState } from "react";
import { getMediaUrl } from "../db";

export function useMediaUrl(id?: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!id) { setUrl(null); return; }
    getMediaUrl(id).then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [id]);
  return url;
}
