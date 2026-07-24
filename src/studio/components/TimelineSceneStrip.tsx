// Timeline ruler, scene boundaries, and the scene management strip.

import { Copy, GripVertical, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useState, type RefObject } from "react";
import type { ProjectMutationOptions } from "../store";
import type { ProjectScene } from "../scenes";

export function TimelineRuler({ duration, zoom }: { duration: number; zoom: number }) {
  const step = zoom < 40 ? 5 : zoom < 80 ? 2 : 1;
  const ticks: number[] = [];
  for (let s = 0; s <= duration; s += step) ticks.push(s);
  return (
    <div className="relative h-full">
      {ticks.map((s) => (
        <div
          key={s}
          className="absolute top-0 h-full border-l border-border text-[10px] text-muted-foreground"
          style={{ left: s * zoom, paddingLeft: 4 }}
        >
          {s}s
        </div>
      ))}
    </div>
  );
}

export function SceneBoundaryOverlay({
  scenes,
  zoom,
  top,
}: {
  scenes: ProjectScene[];
  zoom: number;
  top: number;
}) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute bottom-0 left-0 right-0 z-30"
      style={{ top }}
    >
      {scenes.slice(1).map((scene) => (
        <div
          key={scene.id}
          className="absolute bottom-0 top-0 border-l border-primary/80"
          style={{
            left: scene.start * zoom,
            boxShadow: "0 0 0 1px color-mix(in oklch, var(--color-primary) 24%, transparent)",
          }}
        >
          <span className="absolute left-1 top-1 rounded-sm bg-panel/95 px-1 py-0.5 text-[10px] font-medium text-foreground shadow">
            {scene.name || `Scene ${scene.index + 1}`}
          </span>
        </div>
      ))}
    </div>
  );
}

export function SceneStrip({
  scenes,
  activeSceneId,
  zoom,
  scrollRef,
  onScrollLeft,
  onProjectView,
  onSelectScene,
  onAddScene,
  onDuplicateScene,
  onRemoveScene,
  onMoveScene,
  onResizeScene,
  onHistoryCheckpoint,
}: {
  scenes: ProjectScene[];
  activeSceneId: string | null;
  zoom: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScrollLeft: (scrollLeft: number) => void;
  onProjectView: () => void;
  onSelectScene: (sceneId: string) => void;
  onAddScene: () => void;
  onDuplicateScene: (sceneId: string) => void;
  onRemoveScene: (sceneId: string) => void;
  onMoveScene: (sceneId: string, toIndex: number) => void;
  onResizeScene: (sceneId: string, duration: number, options?: ProjectMutationOptions) => void;
  onHistoryCheckpoint: () => void;
}) {
  const [dragSceneId, setDragSceneId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    sceneId: string;
    x: number;
    y: number;
  } | null>(null);
  const totalWidth = Math.max(480, scenes.reduce((sum, scene) => sum + scene.duration, 0) * zoom);
  const contextScene = contextMenu
    ? (scenes.find((scene) => scene.id === contextMenu.sceneId) ?? null)
    : null;

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  const confirmRemoveScene = (scene: ProjectScene) => {
    setContextMenu(null);
    if (scenes.length <= 1) return;
    const label = scene.name || `Scene ${scene.index + 1}`;
    if (!window.confirm(`Delete "${label}" and all content inside it? This cannot be undone.`)) {
      return;
    }
    onRemoveScene(scene.id);
  };

  return (
    <div className="relative flex h-12 shrink-0 border-b border-border bg-panel-2 text-xs">
      <div className="flex w-40 shrink-0 items-center gap-1 border-r border-border px-2">
        <button
          type="button"
          onClick={onProjectView}
          className={`rounded border px-2 py-1 text-[11px] ${
            activeSceneId === null
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-panel text-muted-foreground hover:text-foreground"
          }`}
          title="Project timeline"
        >
          Project
        </button>
        <button
          type="button"
          onClick={onAddScene}
          className="flex h-6 w-6 items-center justify-center rounded border border-border bg-panel text-muted-foreground hover:text-foreground"
          aria-label="Add scene"
          title="Add scene"
        >
          <Plus size={13} />
        </button>
      </div>
      <div
        ref={scrollRef}
        onScroll={(event) => onScrollLeft(event.currentTarget.scrollLeft)}
        className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
      >
        <div className="relative h-full" style={{ width: totalWidth }}>
          {scenes.map((scene) => {
            const active = scene.id === activeSceneId;
            const left = scene.start * zoom;
            const width = Math.max(48, scene.duration * zoom);
            const contentOverflow = scene.contentOverflow > 0.03;
            return (
              <div
                key={scene.id}
                draggable
                onDragStart={(event) => {
                  setDragSceneId(scene.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragSceneId && dragSceneId !== scene.id)
                    onMoveScene(dragSceneId, scene.index);
                  setDragSceneId(null);
                }}
                onDragEnd={() => setDragSceneId(null)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setContextMenu({ sceneId: scene.id, x: event.clientX, y: event.clientY });
                }}
                className={`group absolute top-1 flex h-10 items-center overflow-hidden rounded border ${
                  active
                    ? "border-primary bg-primary/20 ring-1 ring-primary"
                    : contentOverflow
                      ? "border-amber-500/60 bg-amber-500/10 hover:border-amber-400"
                      : "border-border bg-panel hover:border-primary/70"
                }`}
                style={{
                  left,
                  width,
                  backgroundImage: contentOverflow
                    ? "repeating-linear-gradient(135deg, transparent 0, transparent 8px, rgba(245, 158, 11, 0.18) 8px, rgba(245, 158, 11, 0.18) 12px)"
                    : undefined,
                }}
              >
                <button
                  type="button"
                  onClick={() => onSelectScene(scene.id)}
                  className="flex h-full min-w-0 flex-1 items-center gap-1 px-2 text-left"
                  title={
                    contentOverflow
                      ? `Scene content extends to ${formatSeconds(scene.contentEnd)}`
                      : `Scene ${scene.index + 1}`
                  }
                >
                  <GripVertical size={13} className="shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {scene.name || `Scene ${scene.index + 1}`}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {formatSeconds(scene.duration)}
                  </span>
                </button>
                {contentOverflow && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onResizeScene(scene.id, scene.contentEnd);
                    }}
                    className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded border border-amber-500/60 bg-panel text-amber-300 hover:bg-amber-500/10"
                    aria-label={`Extend scene ${scene.index + 1} to fit content`}
                    title={`Extend to fit content (${formatSeconds(scene.contentEnd)})`}
                  >
                    <TriangleAlert size={12} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDuplicateScene(scene.id);
                  }}
                  className="mr-1 hidden h-6 w-6 shrink-0 items-center justify-center rounded border border-border bg-panel text-muted-foreground hover:text-foreground group-hover:flex"
                  aria-label={`Duplicate scene ${scene.index + 1}`}
                  title="Duplicate scene"
                >
                  <Copy size={12} />
                </button>
                <div
                  role="separator"
                  aria-orientation="vertical"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const startX = event.clientX;
                    const startDuration = scene.duration;
                    onHistoryCheckpoint();
                    const move = (moveEvent: MouseEvent) => {
                      const nextDuration = Math.max(
                        0.2,
                        startDuration + (moveEvent.clientX - startX) / zoom,
                      );
                      onResizeScene(scene.id, nextDuration, { history: false });
                    };
                    const up = () => {
                      window.removeEventListener("mousemove", move);
                      window.removeEventListener("mouseup", up);
                    };
                    window.addEventListener("mousemove", move);
                    window.addEventListener("mouseup", up);
                  }}
                  className="h-full w-2 shrink-0 cursor-ew-resize bg-black/20 opacity-0 group-hover:opacity-100"
                  title="Resize scene"
                />
              </div>
            );
          })}
        </div>
      </div>
      {contextMenu && contextScene && (
        <div
          role="menu"
          className="fixed z-50 min-w-40 rounded border border-border bg-panel p-1 text-xs shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setContextMenu(null);
              onDuplicateScene(contextScene.id);
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-foreground hover:bg-panel-2"
          >
            <Copy size={13} />
            Duplicate scene
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={scenes.length <= 1}
            onClick={() => confirmRemoveScene(contextScene)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 size={13} />
            Delete scene
          </button>
        </div>
      )}
    </div>
  );
}

function formatSeconds(value: number) {
  return `${round(value, 1).toFixed(1)}s`;
}

function round(n: number, digits: number) {
  const k = Math.pow(10, digits);
  return Math.round(n * k) / k;
}
