// Stage — renders project.hf.rootHtml through the HyperFrames player iframe.
// React hosts the editor shell; HyperFrames owns the movie preview.
import "@hyperframes/player";
import gsapRaw from "gsap/dist/gsap.min.js?raw";
import { Move } from "lucide-react";
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { resolveIframe, useElementPicker, type PickedElement } from "@hyperframes/studio";
import { useStudio } from "../store";
import { getMediaUrl } from "../db";
import type { HyperframesPlayerElement } from "../../hyperframes-player";
import { deriveEditorClips, type EditorClip } from "../types";
import {
  commitElementRect,
  commitElementPosition,
  hasPickerApi,
  previewElementRect,
  previewElementPosition,
} from "../hyperframes/player-editing";
import {
  compositionDomRectToCss,
  compositionRectToCss,
  getRenderedPixelRect,
  getStageGeometry,
  pointerDeltaToComposition,
  roundCompositionRect,
  resizeCompositionRect,
  resolvePickedClipId,
  resolveTargetClipId,
  scaleCompositionRectFromHandleRect,
  type CompositionRect,
  type ResizeHandle,
  type StageGeometry,
} from "./stage-helpers";

const GSAP_SCRIPT_RE =
  /<script\s+src=["'](?:https:\/\/cdn\.jsdelivr\.net\/npm\/gsap@[^"']+\/dist\/gsap\.min\.js|\.\.\/gsap\.min\.js)["']\s*><\/script>/gi;
const MIN_STAGE_RESIZE_SIZE = 16;

function inlinePreviewScripts(html: string): string {
  return html.replace(GSAP_SCRIPT_RE, `<script>${gsapRaw}</script>`);
}

interface ResolvedPreviewHtml {
  html: string;
  revoke: () => void;
}

async function resolvePreviewHtml(
  rootHtml: string,
  compositionHtml: Record<string, string>,
  assets: { id: string }[],
): Promise<ResolvedPreviewHtml> {
  const assetEntries = await Promise.all(
    assets.map(async (a) => [a.id, await getMediaUrl(a.id)] as const),
  );
  const assetUrls = new Map(assetEntries.filter((e): e is [string, string] => Boolean(e[1])));

  const blobUrls: string[] = [];
  const compBlobUrls = new Map<string, string>();
  for (const [compId, compHtml] of Object.entries(compositionHtml)) {
    let resolved = inlinePreviewScripts(compHtml);
    for (const [id, url] of assetUrls) resolved = resolved.replaceAll(`asset:${id}`, url);
    const blobUrl = URL.createObjectURL(new Blob([resolved], { type: "text/html" }));
    blobUrls.push(blobUrl);
    compBlobUrls.set(compId, blobUrl);
  }

  let html = inlinePreviewScripts(rootHtml);
  for (const [id, url] of assetUrls) html = html.replaceAll(`asset:${id}`, url);
  for (const [compId, blobUrl] of compBlobUrls)
    html = html.replaceAll(`compositions/${compId}.html`, blobUrl);

  return {
    html,
    revoke: () => {
      for (const url of blobUrls) URL.revokeObjectURL(url);
    },
  };
}

interface StageProps {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  onIframeLoad: () => void;
}

type StageDrag =
  | null
  | {
      type: "move";
      clipId: string;
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startX: number;
      startY: number;
      previewX: number;
      previewY: number;
      geometry: StageGeometry;
    }
  | {
      type: "resize";
      clipId: string;
      handle: ResizeHandle;
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startClip: CompositionRect;
      startHandleRect: CompositionRect;
      previewClip: CompositionRect;
      previewHandleRect: CompositionRect;
      geometry: StageGeometry;
    };

export function Stage({ iframeRef, onIframeLoad }: StageProps) {
  const project = useStudio((s) => s.project);
  const selectClip = useStudio((s) => s.selectClip);
  const selectedClipId = useStudio((s) => s.selectedClipId);
  const updateClip = useStudio((s) => s.updateClip);
  const updateRootHtml = useStudio((s) => s.updateRootHtml);

  const playerRef = useRef<HyperframesPlayerElement>(null);
  const stageShellRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<StageDrag>(null);
  const queuedDragRef = useRef<StageDrag>(null);
  const dragFrameRef = useRef<number | null>(null);
  const [resolvedHtml, setResolvedHtml] = useState<string | null>(null);
  const [drag, setDrag] = useState<StageDrag>(null);
  const [renderedElementRect, setRenderedElementRect] = useState<DOMRect | null>(null);

  const clips = useMemo(() => (project ? deriveEditorClips(project) : []), [project]);
  const clipIds = useMemo(() => new Set(clips.map((clip) => clip.id)), [clips]);
  const selectedClip = useMemo(
    () => clips.find((clip) => clip.id === selectedClipId) ?? null,
    [clips, selectedClipId],
  );
  const stageEditableClip = useMemo(
    () => getStageEditableClip(selectedClip, clips),
    [clips, selectedClip],
  );
  const outlinedClip = useMemo(() => {
    if (!stageEditableClip) return null;
    if (drag?.type === "move" && drag.clipId === stageEditableClip.id) {
      return { ...stageEditableClip, x: drag.previewX, y: drag.previewY };
    }
    if (drag?.type === "resize" && drag.clipId === stageEditableClip.id) {
      return { ...stageEditableClip, ...drag.previewClip };
    }
    return stageEditableClip;
  }, [drag, stageEditableClip]);
  const stageGeometry = (() => {
    if (!project || !stageShellRef.current) return null;
    const iframe = resolveIframe(playerRef.current);
    const iframeRect = iframe?.getBoundingClientRect();
    return getStageGeometry(
      stageShellRef.current,
      project.hf.width,
      project.hf.height,
      iframeRect && iframeRect.width > 0 && iframeRect.height > 0 ? iframeRect : null,
    );
  })();
  const outlineRect =
    stageEditableClip && outlinedClip && stageGeometry
      ? drag?.type === "resize" && drag.clipId === stageEditableClip.id
        ? compositionRectToCss(drag.previewHandleRect, stageGeometry)
        : renderedElementRect
          ? shiftRectForDrag(
              compositionDomRectToCss(renderedElementRect, stageGeometry),
              drag,
              stageGeometry,
              stageEditableClip.id,
            )
          : compositionRectToCss(outlinedClip, stageGeometry)
      : null;
  const moveHandleStyle = outlineRect
    ? getMoveHandleStyle(outlineRect, stageShellRef.current)
    : null;
  const activeDragKey = drag ? `${drag.pointerId}:${drag.clipId}` : null;

  const beginDrag = useCallback((nextDrag: NonNullable<StageDrag>) => {
    dragRef.current = nextDrag;
    queuedDragRef.current = null;
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    setDrag(nextDrag);
  }, []);

  const queueDragPreview = useCallback((nextDrag: NonNullable<StageDrag>) => {
    dragRef.current = nextDrag;
    queuedDragRef.current = nextDrag;
    if (dragFrameRef.current !== null) return;

    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      const queuedDrag = queuedDragRef.current;
      queuedDragRef.current = null;
      setDrag(queuedDrag);
    });
  }, []);

  const clearDrag = useCallback(() => {
    dragRef.current = null;
    queuedDragRef.current = null;
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    setDrag(null);
  }, []);

  // Resolve asset URLs and serve the complete preview HTML through srcdoc.
  // Blob URLs cannot be passed through `src`: the player appends shader query
  // params to `src`, which changes object URLs and breaks loading.
  useEffect(() => {
    if (!project) {
      setResolvedHtml(null);
      return;
    }
    let alive = true;
    let cleanupResolvedHtml: (() => void) | null = null;
    void resolvePreviewHtml(
      project.hf.rootHtml,
      project.hf.compositionHtml,
      project.hf.assets,
    ).then((resolved) => {
      if (!alive) {
        resolved.revoke();
        return;
      }
      cleanupResolvedHtml = resolved.revoke;
      setResolvedHtml(resolved.html);
    });
    return () => {
      alive = false;
      cleanupResolvedHtml?.();
    };
  }, [project]);

  useEffect(() => {
    if (!resolvedHtml) return;
    const iframe = resolveIframe(playerRef.current);
    (iframeRef as { current: HTMLIFrameElement | null }).current = iframe;
    if (!iframe) return;

    iframe.addEventListener("load", onIframeLoad);
    onIframeLoad();
    return () => {
      iframe.removeEventListener("load", onIframeLoad);
      if ((iframeRef as { current: HTMLIFrameElement | null }).current === iframe) {
        (iframeRef as { current: HTMLIFrameElement | null }).current = null;
      }
    };
  }, [iframeRef, onIframeLoad, resolvedHtml]);

  useEffect(() => {
    if (!stageEditableClip || !resolvedHtml) {
      setRenderedElementRect(null);
      return;
    }
    if (drag) return;

    const clipId = stageEditableClip.id;
    let stopped = false;
    const measure = async () => {
      if (stopped) return;
      const nextRect = await getRenderedPixelRect(iframeRef.current, clipId);
      if (stopped) return;
      setRenderedElementRect((currentRect) =>
        sameRect(currentRect, nextRect) ? currentRect : nextRect,
      );
    };

    void measure();
    const interval = window.setInterval(() => void measure(), 200);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [drag, iframeRef, stageEditableClip, resolvedHtml]);

  // Element picker — click in player iframe → select clip.
  const { pickedElement, enablePick, isPickMode } = useElementPicker(iframeRef, {
    workspaceFiles: project ? { "index.html": project.hf.rootHtml } : undefined,
    onSyncFiles: (files) => {
      if (files["index.html"]) updateRootHtml(files["index.html"]);
    },
  });

  useEffect(() => {
    const clipId = getPickedClipId(iframeRef.current, pickedElement, clipIds);
    if (clipId) selectClip(clipId);
  }, [clipIds, iframeRef, pickedElement, selectClip]);

  useEffect(() => {
    if (!resolvedHtml) return;
    const rootIframe = iframeRef.current;
    if (!rootIframe) return;

    const cleanups = new Map<Document, () => void>();
    let stopped = false;

    const bindFrameDocument = (frame: HTMLIFrameElement) => {
      const doc = frame.contentDocument;
      if (!doc || cleanups.has(doc)) return;

      const handleClick = (event: MouseEvent) => {
        const ownerFrame = doc.defaultView?.frameElement;
        const clipId = resolveTargetClipId(
          event.target,
          clipIds,
          ownerFrame instanceof Element ? ownerFrame : null,
        );
        if (clipId) selectClip(clipId);
      };

      doc.addEventListener("click", handleClick, true);
      cleanups.set(doc, () => {
        doc.removeEventListener("click", handleClick, true);
      });
    };

    const bindAccessibleFrames = () => {
      if (stopped) return;
      bindFrameDocument(rootIframe);
      for (const frame of rootIframe.contentDocument?.querySelectorAll("iframe") ?? []) {
        if (frame instanceof HTMLIFrameElement) bindFrameDocument(frame);
      }
    };

    bindAccessibleFrames();
    const retryTimer = window.setInterval(bindAccessibleFrames, 250);

    return () => {
      stopped = true;
      window.clearInterval(retryTimer);
      for (const cleanup of cleanups.values()) cleanup();
      cleanups.clear();
    };
  }, [clipIds, iframeRef, resolvedHtml, selectClip]);

  useEffect(() => {
    if (!resolvedHtml || drag || isPickMode) return;

    let attempts = 0;
    const maxAttempts = 20;
    const tryEnablePick = () => {
      enablePick();
      return hasPickerApi(iframeRef.current);
    };

    if (tryEnablePick()) return;

    const retryTimer = window.setInterval(() => {
      attempts += 1;
      if (tryEnablePick() || attempts >= maxAttempts) {
        window.clearInterval(retryTimer);
      }
    }, 200);

    return () => {
      window.clearInterval(retryTimer);
    };
  }, [drag, enablePick, iframeRef, isPickMode, resolvedHtml]);

  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);

  useEffect(() => {
    return () => {
      if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
    };
  }, []);

  useEffect(() => {
    if (!activeDragKey) return;

    const handlePointerMove = (event: PointerEvent) => {
      const currentDrag = dragRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) return;
      const delta = pointerDeltaToComposition(
        event.clientX - currentDrag.startClientX,
        event.clientY - currentDrag.startClientY,
        currentDrag.geometry,
      );

      if (currentDrag.type === "move") {
        const nextX = currentDrag.startX + delta.x;
        const nextY = currentDrag.startY + delta.y;
        previewElementPosition(iframeRef.current, currentDrag.clipId, nextX, nextY);
        queueDragPreview({ ...currentDrag, previewX: nextX, previewY: nextY });
        return;
      }

      const preview = getResizePreview(currentDrag, delta.x, delta.y, event.shiftKey);
      previewElementRect(iframeRef.current, currentDrag.clipId, preview.previewClip);
      queueDragPreview({ ...currentDrag, ...preview });
    };

    const commitDrag = (event: PointerEvent) => {
      const currentDrag = dragRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) return;
      const delta = pointerDeltaToComposition(
        event.clientX - currentDrag.startClientX,
        event.clientY - currentDrag.startClientY,
        currentDrag.geometry,
      );

      if (currentDrag.type === "move") {
        const nextX = currentDrag.startX + delta.x;
        const nextY = currentDrag.startY + delta.y;
        commitElementPosition(iframeRef.current, currentDrag.clipId, nextX, nextY);
        updateClip(currentDrag.clipId, { x: nextX, y: nextY });
        clearDrag();
        return;
      }

      const { previewClip } = getResizePreview(currentDrag, delta.x, delta.y, event.shiftKey);
      const finalClip = roundCompositionRect(previewClip);
      commitElementRect(iframeRef.current, currentDrag.clipId, finalClip);
      updateClip(currentDrag.clipId, {
        x: finalClip.x,
        y: finalClip.y,
        width: finalClip.width,
        height: finalClip.height,
      });
      setRenderedElementRect(null);
      clearDrag();
    };

    const restoreDrag = (currentDrag: NonNullable<StageDrag>) => {
      if (currentDrag.type === "move") {
        commitElementPosition(
          iframeRef.current,
          currentDrag.clipId,
          currentDrag.startX,
          currentDrag.startY,
        );
        return;
      }

      commitElementRect(iframeRef.current, currentDrag.clipId, currentDrag.startClip);
    };

    const cancelKeyboardDrag = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const currentDrag = dragRef.current;
      if (currentDrag) restoreDrag(currentDrag);
      clearDrag();
    };

    const cancelPointerDrag = (event: PointerEvent) => {
      const currentDrag = dragRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) return;
      restoreDrag(currentDrag);
      clearDrag();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", commitDrag);
    window.addEventListener("pointercancel", cancelPointerDrag);
    window.addEventListener("keydown", cancelKeyboardDrag);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", commitDrag);
      window.removeEventListener("pointercancel", cancelPointerDrag);
      window.removeEventListener("keydown", cancelKeyboardDrag);
    };
  }, [activeDragKey, clearDrag, iframeRef, queueDragPreview, updateClip]);

  const startResize = (handle: ResizeHandle, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!stageEditableClip || !stageShellRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const iframe = resolveIframe(playerRef.current);
    const geometry = getStageGeometry(
      stageShellRef.current,
      project.hf.width,
      project.hf.height,
      iframe?.getBoundingClientRect() ?? null,
    );
    const startClip = toCompositionRect(stageEditableClip);
    const startHandleRect = renderedElementRect
      ? domRectToCompositionRect(renderedElementRect)
      : startClip;

    beginDrag({
      type: "resize",
      clipId: stageEditableClip.id,
      handle,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startClip,
      startHandleRect,
      previewClip: startClip,
      previewHandleRect: startHandleRect,
      geometry,
    });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") selectClip(null);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectClip]);

  if (!project) return null;

  return (
    <div
      ref={stageShellRef}
      className="absolute inset-0 overflow-hidden bg-stage-bg"
      onClick={(e) => {
        if (e.target === e.currentTarget) selectClip(null);
      }}
    >
      {resolvedHtml && (
        <hyperframes-player
          //key={resolvedHtml}
          ref={playerRef}
          srcdoc={resolvedHtml}
          width={project.hf.width}
          height={project.hf.height}
          style={{ position: "absolute", inset: 0, display: "block" }}
        />
      )}
      {outlineRect && (
        <div
          data-stage-selection-overlay=""
          className="pointer-events-none absolute z-30"
          style={{
            left: outlineRect.left,
            top: outlineRect.top,
            width: Math.max(1, outlineRect.width),
            height: Math.max(1, outlineRect.height),
          }}
        >
          <SelectionCorner handle="nw" onPointerDown={startResize} />
          <SelectionCorner handle="ne" onPointerDown={startResize} />
          <SelectionCorner handle="sw" onPointerDown={startResize} />
          <SelectionCorner handle="se" onPointerDown={startResize} />
        </div>
      )}
      {outlineRect && moveHandleStyle && stageEditableClip && (
        <button
          type="button"
          data-stage-move-handle=""
          title="Move selected clip"
          aria-label="Move selected clip"
          className="absolute z-40 flex h-7 w-7 items-center justify-center rounded-md border border-primary/70 bg-panel/95 text-foreground shadow-[0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur hover:bg-panel-2"
          style={{
            ...moveHandleStyle,
            cursor: drag ? "grabbing" : "grab",
          }}
          onPointerDown={(event) => {
            if (!stageEditableClip || !stageShellRef.current) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            const iframe = resolveIframe(playerRef.current);
            const geometry = getStageGeometry(
              stageShellRef.current,
              project.hf.width,
              project.hf.height,
              iframe?.getBoundingClientRect() ?? null,
            );
            beginDrag({
              type: "move",
              clipId: stageEditableClip.id,
              pointerId: event.pointerId,
              startClientX: event.clientX,
              startClientY: event.clientY,
              startX: stageEditableClip.x,
              startY: stageEditableClip.y,
              previewX: stageEditableClip.x,
              previewY: stageEditableClip.y,
              geometry,
            });
          }}
        >
          <Move size={15} strokeWidth={2.2} />
        </button>
      )}
      <div className="pointer-events-none absolute bottom-2 right-3 rounded bg-panel/80 px-2 py-1 text-xs text-muted-foreground">
        {project.hf.width}×{project.hf.height}
      </div>
    </div>
  );
}

function SelectionCorner({
  handle,
  onPointerDown,
}: {
  handle: ResizeHandle;
  onPointerDown: (handle: ResizeHandle, event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const classes = {
    nw: "-left-2 -top-2 cursor-nwse-resize border-l-2 border-t-2",
    ne: "-right-2 -top-2 cursor-nesw-resize border-r-2 border-t-2",
    sw: "-bottom-2 -left-2 cursor-nesw-resize border-b-2 border-l-2",
    se: "-bottom-2 -right-2 cursor-nwse-resize border-b-2 border-r-2",
  }[handle];
  const labels = {
    nw: "Resize selected clip from top left",
    ne: "Resize selected clip from top right",
    sw: "Resize selected clip from bottom left",
    se: "Resize selected clip from bottom right",
  };
  return (
    <button
      type="button"
      aria-label={labels[handle]}
      className={`pointer-events-auto absolute h-4 w-4 border-primary/95 bg-transparent p-0 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] ${classes}`}
      onPointerDown={(event) => onPointerDown(handle, event)}
    />
  );
}

function getStageEditableClip(selectedClip: EditorClip | null, clips: EditorClip[]) {
  if (!selectedClip) return null;
  if (selectedClip.kind === "audio") return null;
  if (
    selectedClip.linkedCharacterClipId &&
    clips.some((clip) => clip.id === selectedClip.linkedCharacterClipId)
  ) {
    return null;
  }
  return selectedClip;
}

function getPickedClipId(
  iframe: HTMLIFrameElement | null,
  pickedElement: PickedElement | null,
  clipIds: Set<string>,
) {
  return resolvePickedClipId(iframe, pickedElement, clipIds);
}

function getResizePreview(
  drag: Extract<StageDrag, { type: "resize" }>,
  deltaX: number,
  deltaY: number,
  preserveAspect: boolean,
) {
  const previewHandleRect = resizeCompositionRect({
    handle: drag.handle,
    startX: drag.startHandleRect.x,
    startY: drag.startHandleRect.y,
    startWidth: drag.startHandleRect.width,
    startHeight: drag.startHandleRect.height,
    deltaX,
    deltaY,
    preserveAspect,
    minSize: MIN_STAGE_RESIZE_SIZE,
  });
  return {
    previewHandleRect,
    previewClip: scaleCompositionRectFromHandleRect(
      drag.startClip,
      drag.startHandleRect,
      previewHandleRect,
      MIN_STAGE_RESIZE_SIZE,
    ),
  };
}

function toCompositionRect(clip: Pick<EditorClip, "x" | "y" | "width" | "height">) {
  return {
    x: clip.x,
    y: clip.y,
    width: Math.max(MIN_STAGE_RESIZE_SIZE, clip.width),
    height: Math.max(MIN_STAGE_RESIZE_SIZE, clip.height),
  };
}

function domRectToCompositionRect(rect: DOMRect): CompositionRect {
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function sameRect(a: DOMRect | null, b: DOMRect | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

function shiftRectForDrag(
  rect: ReturnType<typeof compositionDomRectToCss>,
  drag: StageDrag,
  geometry: StageGeometry,
  clipId: string,
) {
  if (!drag || drag.type !== "move" || drag.clipId !== clipId) return rect;
  return {
    ...rect,
    left: rect.left + (drag.previewX - drag.startX) / geometry.scaleX,
    top: rect.top + (drag.previewY - drag.startY) / geometry.scaleY,
  };
}

function getMoveHandleStyle(
  rect: ReturnType<typeof compositionDomRectToCss>,
  container: HTMLElement | null,
): CSSProperties {
  const handleSize = 28;
  const gap = 8;
  const padding = 4;
  const stageWidth = container?.clientWidth ?? rect.left + rect.width + handleSize + gap + padding;
  const stageHeight =
    container?.clientHeight ?? rect.top + rect.height + handleSize + gap + padding;
  const maxLeft = Math.max(padding, stageWidth - handleSize - padding);
  const maxTop = Math.max(padding, stageHeight - handleSize - padding);

  const rightOutside = rect.left + rect.width + gap;
  const leftOutside = rect.left - handleSize - gap;
  const aboveOutside = rect.top - handleSize - gap;
  const belowOutside = rect.top + rect.height + gap;

  const left =
    rightOutside + handleSize <= stageWidth - padding
      ? rightOutside
      : leftOutside >= padding
        ? leftOutside
        : clamp(rect.left + rect.width - handleSize, padding, maxLeft);
  const top =
    aboveOutside >= padding
      ? aboveOutside
      : belowOutside + handleSize <= stageHeight - padding
        ? belowOutside
        : clamp(rect.top, padding, maxTop);

  return {
    left,
    top,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
