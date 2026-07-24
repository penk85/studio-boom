// Editor-only Stage overlays for hit targets, paths, snap guides, and resize chrome.

import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { PointerEventLike } from "../interaction/useSelectDrag";
import {
  compositionRectToCss,
  type ResizeHandle,
  type StageGeometry,
  type StageSnapGuide,
} from "./stage-helpers";
import type { StageClickTarget } from "./stage-interactions";
import {
  motionPathData,
  type StageMotionPath,
  type StageMotionPathPolylinePoint,
} from "./stage-motion-paths";

export function MotionPathOverlay({
  paths,
  onCheckpointPointerDown,
  onPathPointerDown,
}: {
  paths: StageMotionPath[];
  onCheckpointPointerDown: (checkpointId: string, event: ReactPointerEvent<SVGElement>) => void;
  onPathPointerDown: (
    motionId: string,
    polyline: StageMotionPathPolylinePoint[],
    event: ReactPointerEvent<SVGElement>,
  ) => void;
}) {
  // SVG container stays pointer-events-none so empty stage-area clicks pass
  // through to the iframe/player. Per-element pointer-events are enabled below
  // on dots and on the wide "hit-area" stroke under each line.
  return (
    <svg
      data-stage-motion-path=""
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible"
    >
      <defs>
        {paths.map((path, index) => (
          <marker
            key={path.id}
            id={`stage-motion-arrow-${index}`}
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path
              d="M 0 0 L 8 4 L 0 8 z"
              fill={path.active ? "var(--color-primary)" : "rgba(255,255,255,0.64)"}
            />
          </marker>
        ))}
      </defs>
      {paths.map((path, index) => {
        const pathData = motionPathData(path.polyline);
        const stroke = path.active ? "var(--color-primary)" : "rgba(255,255,255,0.62)";
        // Only paths bound to a motion step accept the click-to-insert gesture;
        // standalone position runs don't have a motion to attach a checkpoint to.
        const lineHitTarget = path.motionId ? (
          <path
            data-stage-motion-line-hit=""
            d={pathData}
            fill="none"
            stroke="transparent"
            strokeWidth={14}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ cursor: "copy", pointerEvents: "stroke" }}
            onPointerDown={(event) => onPathPointerDown(path.motionId!, path.polyline, event)}
          />
        ) : null;
        return (
          <g key={path.id} opacity={path.active ? 0.92 : 0.48}>
            <path
              d={pathData}
              fill="none"
              stroke="rgba(3,7,18,0.72)"
              strokeWidth={7}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={pathData}
              fill="none"
              stroke={stroke}
              strokeWidth={2.25}
              strokeDasharray="8 7"
              strokeLinecap="round"
              strokeLinejoin="round"
              markerEnd={`url(#stage-motion-arrow-${index})`}
            />
            {lineHitTarget}
            {path.checkpoints.map((point, pointIndex) => {
              const selected = point.selected;
              const endpoint = pointIndex === 0 || pointIndex === path.checkpoints.length - 1;
              const radius = selected ? 7 : endpoint ? 5.5 : 4.5;
              return (
                <g
                  key={point.id}
                  data-stage-motion-checkpoint=""
                  style={{
                    pointerEvents: "auto",
                    cursor: selected ? "grabbing" : "grab",
                  }}
                  onPointerDown={(event) => onCheckpointPointerDown(point.id, event)}
                >
                  <circle cx={point.x} cy={point.y} r={radius + 2.5} fill="rgba(3,7,18,0.76)" />
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={radius}
                    fill={selected ? "var(--color-primary)" : "var(--color-panel)"}
                    stroke={path.active ? "var(--color-primary)" : "rgba(255,255,255,0.68)"}
                    strokeWidth={selected ? 2.5 : 1.75}
                  />
                  {selected && (
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={2.4}
                      fill="var(--color-primary-foreground)"
                    />
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

export function StageClickOverlay({
  clips,
  geometry,
  onCanvasPointerDown,
}: {
  clips: StageClickTarget[];
  geometry: StageGeometry;
  onCanvasPointerDown: (event: PointerEventLike) => void;
}) {
  // One transparent `data-clip-id` rect per visible clip. The Figma-style controller
  // reads the full z-stack under the pointer via `elementsFromPoint` (see
  // `hitTestClipIdsAtPoint`), so the rects are pure hit targets — selection, drill-through,
  // body-drag, and deselect are all decided by the single container handler.
  return (
    <div
      aria-hidden="true"
      className="absolute z-10"
      style={{
        left: geometry.rect.left,
        top: geometry.rect.top,
        width: geometry.rect.width,
        height: geometry.rect.height,
      }}
      onPointerDown={onCanvasPointerDown}
    >
      {clips.map((clip) => {
        const rect = compositionRectToCss(clip, {
          ...geometry,
          rect: new DOMRect(0, 0, geometry.rect.width, geometry.rect.height),
        });
        return (
          <div
            key={clip.id}
            data-stage-click-target=""
            data-clip-id={clip.id}
            title={clip.name || clip.kind}
            className="absolute bg-transparent"
            style={{
              left: rect.left,
              top: rect.top,
              width: Math.max(1, rect.width),
              height: Math.max(1, rect.height),
              transform: `rotate(${clip.rotation}deg)`,
              transformOrigin: "center center",
              zIndex: clip.zIndex,
            }}
          />
        );
      })}
    </div>
  );
}

export function StageSnapGuideOverlay({
  guides,
  geometry,
}: {
  guides: StageSnapGuide[];
  geometry: StageGeometry;
}) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[25]">
      {guides.map((guide, index) => {
        const isVertical = guide.axis === "x";
        const style: CSSProperties = isVertical
          ? {
              left: guide.position / geometry.scaleX + geometry.rect.left,
              top: geometry.rect.top,
              width: 1,
              height: geometry.rect.height,
            }
          : {
              left: geometry.rect.left,
              top: guide.position / geometry.scaleY + geometry.rect.top,
              width: geometry.rect.width,
              height: 1,
            };
        return (
          <div
            key={`${guide.axis}:${guide.position}:${guide.targetId}:${index}`}
            data-stage-snap-guide=""
            className="absolute bg-primary/85 shadow-[0_0_10px_rgba(168,85,247,0.85)]"
            style={style}
          />
        );
      })}
    </div>
  );
}

export function SelectionCorner({
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
