import { useEffect, useRef, useState } from "react";
import type { CharacterSceneAsset } from "./scene";
import {
  createPixiCharacterPreview,
  type PixiCharacterPreviewController,
  type PixiCharacterPreviewPayload,
} from "./pixi-preview-runtime";

export interface PixiCharacterPreviewProps {
  payload: PixiCharacterPreviewPayload;
  time: number;
  resetKey?: string | number;
  staleBehavior?: "hold" | "blank";
  loadingLabel?: string;
  className?: string;
  resolveAssetRef?: (asset: CharacterSceneAsset) => string | null | Promise<string | null>;
}

export function PixiCharacterPreview({
  payload,
  time,
  resetKey,
  staleBehavior = "hold",
  loadingLabel = "Loading character preview...",
  className,
  resolveAssetRef,
}: PixiCharacterPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<PixiCharacterPreviewController | null>(null);
  const latestTimeRef = useRef(time);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  latestTimeRef.current = time;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let alive = true;
    setStatus("loading");
    setError(null);

    const previous = controllerRef.current;
    if (staleBehavior === "blank") {
      previous?.destroy();
      controllerRef.current = null;
    }

    void createPixiCharacterPreview(host, payload, {
      resolveAssetRef,
      initialTime: latestTimeRef.current,
    })
      .then((controller) => {
        if (!alive) {
          controller.destroy();
          return;
        }
        previous?.destroy();
        controllerRef.current = controller;
        controller.renderAt(latestTimeRef.current);
        setStatus("ready");
      })
      .catch((caught) => {
        if (!alive) return;
        if (staleBehavior === "blank") previous?.destroy();
        controllerRef.current = staleBehavior === "hold" ? previous : null;
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(message);
        setStatus("error");
      });

    return () => {
      alive = false;
    };
  }, [payload, resetKey, resolveAssetRef, staleBehavior]);

  useEffect(() => {
    controllerRef.current?.renderAt(time);
  }, [time]);

  useEffect(
    () => () => {
      controllerRef.current?.destroy();
      controllerRef.current = null;
    },
    [],
  );

  const showOverlay = status === "loading" || status === "error";

  return (
    <>
      <div ref={hostRef} className={className} />
      {showOverlay && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/20 text-[11px] text-muted-foreground">
          {status === "error" ? error || "Unable to load character preview." : loadingLabel}
        </div>
      )}
    </>
  );
}
