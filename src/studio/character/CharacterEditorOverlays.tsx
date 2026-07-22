// React/SVG chrome overlays for character rigging, reach, mesh paths, and group transforms.

import type { PointerEvent as ReactPointerEvent } from "react";
import { RotateCw } from "lucide-react";
import { startWindowPointerDrag } from "../interaction/pointer-drag";
import type { CharacterPart, CharacterPartDeform, CharacterPreset, ID } from "../types";
import { ANCHOR_SOURCE_COLORS } from "./CharacterVariantControls";
import { findCharacterSlot } from "./character-utils";
import {
  canvasPointToPartLocal,
  partLocalPointToCanvas,
  resizeCursor,
  type EditorPartTransform,
  type ResizeCorner,
} from "./character-editor-geometry";
import { limbPathBendSide } from "./scene";
import { limbPathPointAt, limbPathProjectPointT } from "./mesh-deform";
import { buildCharacterRuntime, runtimeBoneWorldTransforms } from "./runtime";
import { anchorSourceForChild } from "./variant-pairing";

export function ReachOverlay({
  points,
  scale,
  canvasWidth,
  canvasHeight,
}: {
  points: { x: number; y: number }[];
  scale: number;
  canvasWidth: number;
  canvasHeight: number;
}) {
  if (points.length < 3) return null;
  const stroke = Math.max(1.5, 2 / Math.max(0.0001, scale));
  const path = points.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={canvasWidth}
      height={canvasHeight}
      style={{ zIndex: 9400 }}
    >
      <polygon
        points={path}
        fill="rgba(245, 158, 11, 0.28)"
        stroke="#f59e0b"
        strokeWidth={stroke}
        strokeDasharray={`${stroke * 3} ${stroke * 2}`}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DeformPathOverlay({
  part,
  deform,
  previewTransform,
  scale,
  canvasWidth,
  canvasHeight,
  editing,
  onToggleEditing,
  onSetDeform,
}: {
  part: CharacterPart;
  deform: Extract<CharacterPartDeform, { mode: "limb-path" }>;
  previewTransform: EditorPartTransform;
  scale: number;
  canvasWidth: number;
  canvasHeight: number;
  editing?: boolean;
  onToggleEditing?: () => void;
  onSetDeform?: (deform: CharacterPartDeform | undefined, options?: { history?: boolean }) => void;
}) {
  const stroke = Math.max(1.5, 2 / Math.max(0.0001, scale));
  const knob = Math.max(4, 5 / Math.max(0.0001, scale));
  const toCanvas = (point: { x: number; y: number }) =>
    partLocalPointToCanvas(part, point, previewTransform);
  const samples = deformPathSamples(deform);
  const pathPoints = samples.map(toCanvas);
  const pathD = pathPoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  const start = toCanvas(deform.start);
  const end = toCanvas(deform.end);
  const curveLocal = deform.curve ?? {
    x: (deform.start.x + deform.end.x) / 2,
    y: (deform.start.y + deform.end.y) / 2,
  };
  const curve = deform.curve ? toCanvas(deform.curve) : null;
  // While editing, an unset curve shows as a ghost dot at the chord midpoint;
  // dragging it authors deform.curve.
  const curveGhost = !deform.curve && editing ? toCanvas(curveLocal) : null;
  const locks = (deform.locks ?? []).map(toCanvas);
  const interactive = editing && !!onSetDeform;
  const knobClass = interactive ? "pointer-events-auto cursor-grab" : undefined;
  // The joint (elbow/knee) marker slides along the spine; default is midway.
  const jointLocal = deform.joint ?? limbPathPointAt(samples, 0.5);
  const joint = toCanvas(jointLocal);
  // Fold-direction arrow: which side the elbow will swing toward. Solid when
  // the direction is locked, faded when it is only implied by the curve point.
  const foldSide = deform.side === 1 || deform.side === -1 ? deform.side : limbPathBendSide(deform);
  let foldArrow: { from: { x: number; y: number }; to: { x: number; y: number } } | null = null;
  if (foldSide) {
    const jointT = Math.max(0.05, Math.min(0.95, limbPathProjectPointT(samples, jointLocal)));
    const ahead = limbPathPointAt(samples, Math.min(1, jointT + 0.05));
    const behind = limbPathPointAt(samples, Math.max(0, jointT - 0.05));
    const tangentLength = Math.hypot(ahead.x - behind.x, ahead.y - behind.y) || 1;
    const nx = -(ahead.y - behind.y) / tangentLength;
    const ny = (ahead.x - behind.x) / tangentLength;
    const reach = Math.max(16, (deform.width ?? 30) * 0.75);
    foldArrow = {
      from: joint,
      to: toCanvas({
        x: jointLocal.x + nx * foldSide * reach,
        y: jointLocal.y + ny * foldSide * reach,
      }),
    };
  }
  const foldArrowHead = (() => {
    if (!foldArrow) return null;
    const dx = foldArrow.to.x - foldArrow.from.x;
    const dy = foldArrow.to.y - foldArrow.from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const size = knob * 1.4;
    const baseX = foldArrow.to.x - ux * size;
    const baseY = foldArrow.to.y - uy * size;
    return `${foldArrow.to.x},${foldArrow.to.y} ${baseX - uy * size * 0.6},${baseY + ux * size * 0.6} ${baseX + uy * size * 0.6},${baseY - ux * size * 0.6}`;
  })();

  const startPointDrag = (e: ReactPointerEvent<SVGElement>, kind: "joint" | "end" | "curve") => {
    if (e.button !== 0 || !interactive || !onSetDeform) return;
    e.preventDefault();
    e.stopPropagation();
    const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement;
    const rect = svg?.getBoundingClientRect();
    if (!rect) return;
    const pxPerUnitX = rect.width / Math.max(1, canvasWidth);
    const pxPerUnitY = rect.height / Math.max(1, canvasHeight);
    const round1 = (value: number) => Math.round(value * 10) / 10;
    // One undo checkpoint for the whole drag: history on the first patch only.
    let first = true;
    const move = (ev: PointerEvent) => {
      const canvasPoint = {
        x: (ev.clientX - rect.left) / pxPerUnitX,
        y: (ev.clientY - rect.top) / pxPerUnitY,
      };
      const local = canvasPointToPartLocal(part, canvasPoint, previewTransform);
      const point = { x: round1(local.x), y: round1(local.y) };
      if (kind === "joint") {
        // The joint slides along the spine rather than floating free.
        const t = Math.max(0.05, Math.min(0.95, limbPathProjectPointT(samples, local)));
        const snapped = limbPathPointAt(samples, t);
        onSetDeform(
          { ...deform, joint: { x: round1(snapped.x), y: round1(snapped.y) } },
          { history: first },
        );
      } else if (kind === "end") {
        onSetDeform({ ...deform, end: point }, { history: first });
      } else {
        onSetDeform({ ...deform, curve: point }, { history: first });
      }
      first = false;
    };
    startWindowPointerDrag({
      onMove: move,
      onEnd: (event) => {
        if (event) move(event);
      },
    });
  };

  const chipFont = 11 / Math.max(0.0001, scale);
  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0"
        width={canvasWidth}
        height={canvasHeight}
        // Above the group-move surface (10000) and bone markers (11000) so the
        // joint knob receives pointer events instead of starting an art drag.
        style={{ zIndex: 11500 }}
        aria-hidden="true"
      >
        <path
          d={pathD}
          fill="none"
          stroke="#14b8a6"
          strokeWidth={stroke}
          strokeDasharray={`${stroke * 3} ${stroke * 2}`}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {foldArrow && (
          <g opacity={deform.side === 1 || deform.side === -1 ? 1 : 0.45}>
            <line
              x1={foldArrow.from.x}
              y1={foldArrow.from.y}
              x2={foldArrow.to.x}
              y2={foldArrow.to.y}
              stroke="#a855f7"
              strokeWidth={stroke * 1.2}
            />
            {foldArrowHead && <polygon points={foldArrowHead} fill="#a855f7" />}
          </g>
        )}
        <circle
          cx={start.x}
          cy={start.y}
          r={knob}
          fill="#ffffff"
          stroke="#111827"
          strokeWidth={stroke}
        />
        {locks.map((lock, index) => (
          <circle
            key={index}
            cx={lock.x}
            cy={lock.y}
            r={knob * 0.9}
            fill="#facc15"
            stroke="#7c2d12"
            strokeWidth={stroke}
          />
        ))}
        {curve && (
          <circle
            cx={curve.x}
            cy={curve.y}
            r={knob * (editing ? 1.15 : 0.9)}
            fill="#f59e0b"
            stroke="#7c2d12"
            strokeWidth={stroke}
            className={knobClass}
            onPointerDown={interactive ? (e) => startPointDrag(e, "curve") : undefined}
          >
            {interactive && <title>Curve — drag to give the limb its natural bend</title>}
          </circle>
        )}
        {curveGhost && (
          <circle
            cx={curveGhost.x}
            cy={curveGhost.y}
            r={knob * 1.15}
            fill="rgba(245, 158, 11, 0.35)"
            stroke="#f59e0b"
            strokeWidth={stroke}
            strokeDasharray={`${stroke * 2} ${stroke * 2}`}
            className={knobClass}
            onPointerDown={interactive ? (e) => startPointDrag(e, "curve") : undefined}
          >
            <title>Curve — drag to give the limb its natural bend</title>
          </circle>
        )}
        <circle
          cx={end.x}
          cy={end.y}
          r={knob * (editing ? 1.4 : 1.15)}
          fill="#14b8a6"
          stroke="#0f766e"
          strokeWidth={stroke}
          className={knobClass}
          onPointerDown={interactive ? (e) => startPointDrag(e, "end") : undefined}
        >
          {interactive && <title>End — drag to where this limb's tip sits in the artwork</title>}
        </circle>
        <g transform={`translate(${joint.x} ${joint.y}) rotate(45)`}>
          <rect
            x={-knob * (editing ? 1.3 : 1)}
            y={-knob * (editing ? 1.3 : 1)}
            width={knob * 2 * (editing ? 1.3 : 1)}
            height={knob * 2 * (editing ? 1.3 : 1)}
            fill="#a855f7"
            stroke="#581c87"
            strokeWidth={stroke}
            className={knobClass}
            onPointerDown={interactive ? (e) => startPointDrag(e, "joint") : undefined}
          >
            <title>Joint — drag along the path to set where this limb bends</title>
          </rect>
        </g>
      </svg>
      {onToggleEditing && (
        <button
          type="button"
          className="pointer-events-auto absolute -translate-x-1/2 rounded-full border font-semibold shadow"
          style={{
            left: start.x,
            top: start.y - 36 / Math.max(0.0001, scale),
            zIndex: 11500,
            fontSize: chipFont,
            padding: `${3 / Math.max(0.0001, scale)}px ${9 / Math.max(0.0001, scale)}px`,
            background: editing ? "#a855f7" : "rgba(24, 24, 27, 0.92)",
            color: editing ? "#fff" : "#e9d5ff",
            borderColor: "#a855f7",
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onToggleEditing}
          title={
            editing
              ? "Finish editing the mesh path and restore normal move controls"
              : "Edit the mesh path: drag the joint, end, and curve points (art dragging pauses)"
          }
        >
          {editing ? "✓ Done" : "✎ Edit path"}
        </button>
      )}
    </>
  );
}

function deformPathSamples(deform: Extract<CharacterPartDeform, { mode: "limb-path" }>) {
  const count = Math.max(2, Math.round(deform.segments ?? 12));
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    if (!deform.curve) {
      points.push({
        x: deform.start.x + (deform.end.x - deform.start.x) * t,
        y: deform.start.y + (deform.end.y - deform.start.y) * t,
      });
      continue;
    }
    const inv = 1 - t;
    points.push({
      x: inv * inv * deform.start.x + 2 * inv * t * deform.curve.x + t * t * deform.end.x,
      y: inv * inv * deform.start.y + 2 * inv * t * deform.curve.y + t * t * deform.end.y,
    });
  }
  return points;
}

/**
 * Rotation-reach gizmo: a pivot, a wedge showing the allowed twist range, and a draggable knob to
 * trace it. Distinct (sky-blue) from the amber position reach. Shown in reach-edit focus mode.
 */
export function RotationReachOverlay({
  anchor,
  radius,
  range,
  scale,
  canvasWidth,
  canvasHeight,
  onStartRotate,
}: {
  anchor: { x: number; y: number };
  radius: number;
  range: { min: number; max: number } | null;
  scale: number;
  canvasWidth: number;
  canvasHeight: number;
  onStartRotate: (e: ReactPointerEvent) => void;
}) {
  const restAngle = -90; // straight up
  const stroke = Math.max(1.5, 2 / Math.max(0.0001, scale));
  const knobR = Math.max(7, 9 / Math.max(0.0001, scale));
  const toXY = (deg: number, r: number) => ({
    x: anchor.x + r * Math.cos((deg * Math.PI) / 180),
    y: anchor.y + r * Math.sin((deg * Math.PI) / 180),
  });
  const knob = toXY(restAngle, radius);
  let wedge: string | null = null;
  if (range && (range.min !== 0 || range.max !== 0)) {
    const p0 = toXY(restAngle + range.min, radius);
    const p1 = toXY(restAngle + range.max, radius);
    const large = range.max - range.min > 180 ? 1 : 0;
    wedge = `M ${anchor.x} ${anchor.y} L ${p0.x} ${p0.y} A ${radius} ${radius} 0 ${large} 1 ${p1.x} ${p1.y} Z`;
  }
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={canvasWidth}
      height={canvasHeight}
      style={{ zIndex: 9450 }}
    >
      {wedge && (
        <path
          d={wedge}
          fill="rgba(14, 165, 233, 0.22)"
          stroke="#0ea5e9"
          strokeWidth={stroke}
          strokeLinejoin="round"
        />
      )}
      <line
        x1={anchor.x}
        y1={anchor.y}
        x2={knob.x}
        y2={knob.y}
        stroke="#0ea5e9"
        strokeWidth={stroke}
        strokeDasharray={`${stroke * 3} ${stroke * 2}`}
      />
      <circle cx={anchor.x} cy={anchor.y} r={stroke * 1.6} fill="#0ea5e9" />
      <circle
        className="pointer-events-auto cursor-grab"
        cx={knob.x}
        cy={knob.y}
        r={knobR}
        fill="#0ea5e9"
        stroke="#082f49"
        strokeWidth={stroke * 0.7}
        onPointerDown={onStartRotate}
      />
    </svg>
  );
}

/**
 * Editor chrome marking, for every bone whose anchor depends on its parent slot's variant, the
 * parent pivot (white) and the currently resolved child anchor — colored by resolution path
 * (pin green / paired art blue / missing amber), matching the Motion Editor's overlay.
 */
export function VariantAnchorOverlay({
  doc,
  variantPreview,
  anchorDrag,
  emphasisSlotId,
  scale,
  onStartAnchorDrag,
}: {
  doc: CharacterPreset;
  variantPreview: Record<ID, string>;
  anchorDrag: { childSlotId: ID; dx: number; dy: number } | null;
  emphasisSlotId: ID | null;
  scale: number;
  onStartAnchorDrag: (
    e: ReactPointerEvent,
    context: { childSlotId: ID; parentSlotId: ID; variantKey: string },
  ) => void;
}) {
  const runtime = buildCharacterRuntime(doc);
  const world = runtimeBoneWorldTransforms(runtime, variantPreview);
  const slotName = (slotId: ID) => findCharacterSlot(doc, slotId)?.name ?? slotId;
  const dotRadius = Math.max(4, 5 / Math.max(0.0001, scale));
  const fontSize = Math.max(9, 10 / Math.max(0.0001, scale));
  const markers: Array<{
    boneId: string;
    x: number;
    y: number;
    parentX: number;
    parentY: number;
    color: string;
    label: string;
    faded: boolean;
    focused: boolean;
    /** Set when a parent variant is previewed — the marker is then a draggable anchor handle. */
    dragContext: { childSlotId: ID; parentSlotId: ID; variantKey: string } | null;
  }> = [];
  for (const bone of runtime.angleRig.bones) {
    if (!bone.parentId) continue;
    const at = world.get(bone.id);
    const parentAt = world.get(bone.parentId);
    const childSlotId = runtime.angleRig.slotBindings.find(
      (binding) => binding.boneId === bone.id,
    )?.slotId;
    const parentSlotId = bone.restSource?.slotId;
    if (!at || !parentAt || !childSlotId || !parentSlotId) continue;
    const activeKey = variantPreview[parentSlotId];
    const source = activeKey ? anchorSourceForChild(doc, childSlotId, activeKey) : "pin";
    const dragShift =
      anchorDrag && anchorDrag.childSlotId === childSlotId
        ? { dx: anchorDrag.dx, dy: anchorDrag.dy }
        : { dx: 0, dy: 0 };
    markers.push({
      boneId: bone.id,
      x: at.x + dragShift.dx,
      y: at.y + dragShift.dy,
      parentX: parentAt.x,
      parentY: parentAt.y,
      color: activeKey ? ANCHOR_SOURCE_COLORS[source] : "#94a3b8",
      label: `${slotName(childSlotId)} ← ${slotName(parentSlotId)} : ${activeKey ?? "rest"}${
        activeKey ? ` (${source})` : ""
      }`,
      faded: !!emphasisSlotId && childSlotId !== emphasisSlotId && parentSlotId !== emphasisSlotId,
      focused:
        (!!emphasisSlotId && (childSlotId === emphasisSlotId || parentSlotId === emphasisSlotId)) ||
        anchorDrag?.childSlotId === childSlotId,
      dragContext: activeKey ? { childSlotId, parentSlotId, variantKey: activeKey } : null,
    });
  }
  if (markers.length === 0) return null;
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={doc.canvasWidth}
      height={doc.canvasHeight}
      style={{ zIndex: 11000 }}
    >
      {markers.map((marker) => (
        <g key={marker.boneId} className="group" opacity={marker.faded ? 0.18 : 1}>
          <line
            x1={marker.parentX}
            y1={marker.parentY}
            x2={marker.x}
            y2={marker.y}
            stroke={marker.color}
            strokeDasharray={`${4 / Math.max(0.0001, scale)} ${3 / Math.max(0.0001, scale)}`}
            strokeWidth={Math.max(1, 1.5 / Math.max(0.0001, scale))}
          />
          <circle
            cx={marker.parentX}
            cy={marker.parentY}
            r={dotRadius * 0.7}
            fill="rgba(255,255,255,0.85)"
            stroke="#0f172a"
            strokeWidth={Math.max(0.75, 1 / Math.max(0.0001, scale))}
          />
          {marker.dragContext ? (
            <g
              className="pointer-events-auto cursor-move"
              role="button"
              aria-label={`Drag to move the ${marker.label} anchor`}
              onPointerDown={(e) => {
                e.stopPropagation();
                onStartAnchorDrag(e, marker.dragContext!);
              }}
            >
              {/* Generous invisible hit area — the visible dot is small at editor zoom. */}
              <circle cx={marker.x} cy={marker.y} r={dotRadius * 2.4} fill="transparent" />
              <circle
                cx={marker.x}
                cy={marker.y}
                r={dotRadius}
                fill={marker.color}
                stroke="#0f172a"
                strokeWidth={Math.max(0.75, 1 / Math.max(0.0001, scale))}
              />
              <title>Drag to move this variant pin</title>
            </g>
          ) : (
            <>
              <circle
                className="pointer-events-auto"
                cx={marker.x}
                cy={marker.y}
                r={dotRadius * 2.2}
                fill="transparent"
              />
              <circle
                cx={marker.x}
                cy={marker.y}
                r={dotRadius}
                fill={marker.color}
                stroke="#0f172a"
                strokeWidth={Math.max(0.75, 1 / Math.max(0.0001, scale))}
              />
            </>
          )}
          <text
            className={
              marker.focused
                ? "opacity-100"
                : "opacity-0 transition-opacity group-hover:opacity-100"
            }
            x={marker.x + dotRadius + 3}
            y={marker.y - dotRadius - 3}
            fill={marker.color}
            stroke="rgba(15,23,42,0.85)"
            strokeWidth={3}
            paintOrder="stroke"
            fontSize={fontSize}
          >
            {marker.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function RigBonesOverlay({
  doc,
  variantPreview,
  selectedBoneId,
  scale,
  onSelectBone,
  onStartBoneDrag,
}: {
  doc: CharacterPreset;
  variantPreview: Readonly<Record<ID, string>>;
  selectedBoneId: ID | null;
  scale: number;
  onSelectBone: (boneId: ID) => void;
  onStartBoneDrag: (e: ReactPointerEvent, boneId: ID) => void;
}) {
  const runtime = buildCharacterRuntime(doc);
  const world = runtimeBoneWorldTransforms(runtime, variantPreview);
  const bones = runtime.angleRig.bones;
  const radius = Math.max(6, 8 / Math.max(0.0001, scale));
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={doc.canvasWidth}
      height={doc.canvasHeight}
      style={{ zIndex: 12000 }}
    >
      {bones.map((bone) => {
        const point = world.get(bone.id);
        const parent = bone.parentId ? world.get(bone.parentId) : undefined;
        if (!point || !parent) return null;
        return (
          <line
            key={`${bone.id}:link`}
            x1={parent.x}
            y1={parent.y}
            x2={point.x}
            y2={point.y}
            stroke="rgba(56, 189, 248, 0.72)"
            strokeWidth={Math.max(1.5, 2 / Math.max(0.0001, scale))}
          />
        );
      })}
      {bones.map((bone) => {
        const point = world.get(bone.id);
        if (!point) return null;
        const selected = bone.id === selectedBoneId;
        return (
          <g
            key={bone.id}
            role="button"
            tabIndex={0}
            aria-label={`Select ${bone.name} bone`}
            className="group pointer-events-auto cursor-move"
            onClick={(e) => {
              e.stopPropagation();
              onSelectBone(bone.id);
            }}
            onPointerDown={(e) => onStartBoneDrag(e, bone.id)}
          >
            <circle
              cx={point.x}
              cy={point.y}
              r={radius}
              fill={selected ? "#facc15" : "#38bdf8"}
              stroke="#0f172a"
              strokeWidth={Math.max(1, 1.5 / Math.max(0.0001, scale))}
            />
            <text
              className={
                selected
                  ? "opacity-100"
                  : "opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100"
              }
              x={point.x + radius + 3}
              y={point.y - radius - 3}
              fill="#0f172a"
              stroke="rgba(255,255,255,0.82)"
              strokeWidth={3}
              paintOrder="stroke"
              fontSize={Math.max(10, 11 / Math.max(0.0001, scale))}
            >
              {bone.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Axis-aligned move/resize box for a whole slot group (eyes / mouth visemes). */
export function GroupControlsOverlay({
  bounds,
  scale,
  onStartMove,
  onStartResize,
  onStartRotate,
}: {
  bounds: { x: number; y: number; width: number; height: number };
  scale: number;
  onStartMove: (e: ReactPointerEvent) => void;
  onStartResize: (e: ReactPointerEvent, corner: ResizeCorner) => void;
  onStartRotate: (e: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const handleSize = 14 / Math.max(0.0001, scale);
  const rotateSize = 24 / Math.max(0.0001, scale);
  const rotateOffset = 34 / Math.max(0.0001, scale);
  const rotateTop =
    bounds.y > rotateOffset + rotateSize ? -rotateOffset : bounds.height + rotateOffset;
  const corners: ResizeCorner[] = ["nw", "ne", "sw", "se"];
  const cornerPos: Record<ResizeCorner, { x: number; y: number }> = {
    nw: { x: 0, y: 0 },
    ne: { x: bounds.width, y: 0 },
    sw: { x: 0, y: bounds.height },
    se: { x: bounds.width, y: bounds.height },
  };
  return (
    <div
      className="absolute"
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        zIndex: 10000,
      }}
    >
      <div
        onPointerDown={(e) => {
          e.stopPropagation();
          onStartMove(e);
        }}
        className="absolute inset-0 cursor-move border-2 border-dashed border-primary"
        style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.4)" }}
      />
      {corners.map((corner) => (
        <button
          key={corner}
          type="button"
          aria-label={`Resize group from ${corner}`}
          onPointerDown={(e) => {
            e.stopPropagation();
            onStartResize(e, corner);
          }}
          className={`absolute rounded-sm border border-background bg-primary shadow-[0_1px_4px_rgba(0,0,0,0.35)] ${resizeCursor(corner)}`}
          style={{
            left: cornerPos[corner].x,
            top: cornerPos[corner].y,
            width: handleSize,
            height: handleSize,
            transform: "translate(-50%, -50%)",
          }}
        />
      ))}
      <button
        type="button"
        aria-label="Rotate group"
        onPointerDown={onStartRotate}
        className="pointer-events-auto absolute flex items-center justify-center rounded-full border border-background bg-primary text-primary-foreground shadow-[0_1px_5px_rgba(0,0,0,0.35)]"
        style={{
          left: bounds.width / 2,
          top: rotateTop,
          width: rotateSize,
          height: rotateSize,
          transform: "translate(-50%, -50%)",
        }}
      >
        <RotateCw size={Math.max(10, rotateSize * 0.55)} strokeWidth={2.25} />
      </button>
    </div>
  );
}

/**
 * Slot-level "Flexible" path-mesh control. Shown in both the part Inspector
 * (single-image limbs) and the GroupInspector (multi-variant slots) so it is
 * reachable however the layer is selected. Deform is written to every variant
 * of the slot so swaps stay consistent; face builders are excluded.
 */
