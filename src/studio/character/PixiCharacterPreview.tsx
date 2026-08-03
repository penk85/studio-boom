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
  /** Reuse the current Pixi scene when only timeline data changes. */
  reuseScene?: boolean;
  staleBehavior?: "hold" | "blank";
  loadingLabel?: string;
  className?: string;
  resolveAssetRef?: (asset: CharacterSceneAsset) => string | null | Promise<string | null>;
}

export function PixiCharacterPreview({
  payload,
  time,
  resetKey,
  reuseScene = false,
  staleBehavior = "hold",
  loadingLabel = "Loading character preview...",
  className,
  resolveAssetRef,
}: PixiCharacterPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<PixiCharacterPreviewController | null>(null);
  const latestTimeRef = useRef(time);
  const latestPayloadRef = useRef(payload);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  latestTimeRef.current = time;
  latestPayloadRef.current = payload;
  const scenePayloadKey = reuseScene ? null : payload;

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

    void createPixiCharacterPreview(host, latestPayloadRef.current, {
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
        controller.updateTimelineScene(latestPayloadRef.current.timelineScene);
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
  }, [resetKey, resolveAssetRef, scenePayloadKey, staleBehavior]);

  useEffect(() => {
    if (!reuseScene) return;
    controllerRef.current?.updateTimelineScene(payload.timelineScene);
  }, [payload.timelineScene, reuseScene]);

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
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/20 text-ui-sm text-muted-foreground">
          {status === "error" ? error || "Unable to load character preview." : loadingLabel}
        </div>
      )}
    </>
  );
}
