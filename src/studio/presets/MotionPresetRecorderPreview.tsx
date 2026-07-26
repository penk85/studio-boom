// Draft pose, playback preview, and interaction chrome for the action recorder.
import { useMemo } from "react";
import type React from "react";
import { RotateCw } from "lucide-react";
import { getMediaUrl } from "../db";
import { useMediaUrl } from "../hooks/useMediaUrl";
import { useStudio } from "../store";
import { buildCharacterRenderPayload } from "../character/composition";
import { PixiCharacterPreview } from "../character/PixiCharacterPreview";
import { limbPathBendPoints } from "../character/mesh-deform";
import { limbPathSolveInputsForPart, type CharacterSceneAsset } from "../character/scene";
import { matrixToCss, transformPoint } from "../character/geometry";
import {
  resolveRuntimeSlotPart,
  runtimeBoneWorldTransforms,
  type CharacterRuntime,
} from "../character/runtime";
import { startWindowPointerDrag } from "../interaction/pointer-drag";
import type { CharacterPart, CharacterPreset, MotionPreset } from "../types";
import {
  constrainFlexibleCurvePatch,
  defaultOverride,
  recorderActionLimbPathForPart,
  round,
  type CharacterSlot,
  type FlexiblePointChange,
  type RecorderPartState,
} from "./motion-recorder-state";
import { recorderPartFrame, recorderPartPlacement } from "./motion-recorder-geometry";
import {
  createRafCoalescedDispatcher,
  recorderPatchEqual,
  useRafCoalescedCallback,
} from "./motion-recorder-interactions";

export function ReactPoseCanvas({
  runtime,
  slots,
  character,
  overrides,
  activePartForSlot,
  activeVariantsBySlot,
  poseWorldByBone,
  faceTurnX,
  faceTurnY,
  opacity = 1,
  tint,
}: {
  runtime: CharacterRuntime;
  slots: CharacterSlot[];
  character: CharacterPreset;
  overrides: Map<string, RecorderPartState>;
  activePartForSlot: (slot: CharacterSlot, poseSwap?: string) => CharacterPart | undefined;
  activeVariantsBySlot: Record<string, string>;
  poseWorldByBone: CharacterRuntime["worldByBone"];
  faceTurnX: number;
  faceTurnY: number;
  opacity?: number;
  tint?: "previous" | "next";
}) {
  const layers = useMemo(
    () =>
      slots
        .flatMap((slot) => {
          const overrideFromMap = overrides.get(slot.id);
          const part = activePartForSlot(slot, overrideFromMap?.poseSwap);
          if (!part?.visible) return [];
          const override = overrideFromMap ?? defaultOverride(slot.id, part);
          const placement = recorderPartPlacement(
            slot,
            part,
            runtime,
            activeVariantsBySlot,
            poseWorldByBone,
          );
          const frame = recorderPartFrame(
            slot,
            part,
            override,
            runtime,
            overrides,
            activePartForSlot,
            faceTurnX,
            faceTurnY,
            character.canvasWidth,
            character.canvasHeight,
            activeVariantsBySlot,
            poseWorldByBone,
            placement,
          );
          return [{ slot, part, override, frame, drawOrder: placement.drawOrder }];
        })
        .sort((a, b) => a.drawOrder - b.drawOrder),
    [
      activePartForSlot,
      activeVariantsBySlot,
      character.canvasHeight,
      character.canvasWidth,
      faceTurnX,
      faceTurnY,
      overrides,
      poseWorldByBone,
      runtime,
      slots,
    ],
  );

  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        opacity,
        filter: tint === "previous" ? "saturate(0.75) hue-rotate(155deg)" : undefined,
      }}
      aria-hidden={tint ? "true" : undefined}
    >
      {layers.map((layer, index) => (
        <ReactPosePart
          key={`${layer.slot.id}:${layer.part.id}`}
          part={layer.part}
          frame={layer.frame}
          opacity={layer.override.opacity}
          zIndex={index}
        />
      ))}
    </div>
  );
}

function ReactPosePart({
  part,
  frame,
  opacity,
  zIndex,
}: {
  part: CharacterPart;
  frame: ReturnType<typeof recorderPartFrame>;
  opacity: number;
  zIndex: number;
}) {
  const url = useMediaUrl(part.mediaId);
  const style = {
    position: "absolute" as const,
    display: "block" as const,
    left: 0,
    top: 0,
    width: part.width,
    height: part.height,
    maxWidth: "none",
    maxHeight: "none",
    transform: matrixToCss(frame.matrix),
    transformOrigin: "0 0",
    opacity,
    zIndex,
    pointerEvents: "none" as const,
    userSelect: "none" as const,
  };

  if (part.morph?.primaryPath) {
    return (
      <svg
        viewBox={part.morph.viewBox ?? `0 0 ${part.width} ${part.height}`}
        aria-hidden="true"
        overflow="visible"
        style={style}
      >
        <path
          d={part.morph.primaryPath}
          fill={part.morph.fill ?? "#733f43"}
          stroke={part.morph.stroke}
          strokeWidth={part.morph.strokeWidth}
          strokeLinecap={part.morph.strokeLinecap as "round" | "butt" | "square" | undefined}
          strokeLinejoin={part.morph.strokeLinejoin as "round" | "miter" | "bevel" | undefined}
        />
      </svg>
    );
  }

  if (!url) return null;
  return <img src={url} alt="" draggable={false} style={style} />;
}

// Playback consumes the same render payload as generated character composition
// HTML while keeping a persistent Pixi app across stamped draft updates.
export function RecorderPixiPreview({
  character,
  basePoses,
  preset,
  compileRevision,
  time,
  staleBehavior = "hold",
  loadingLabel = "Loading character preview...",
}: {
  character: CharacterPreset;
  basePoses: Record<string, string>;
  preset: MotionPreset | null;
  compileRevision: number;
  time: number;
  staleBehavior?: "hold" | "blank";
  loadingLabel?: string;
}) {
  const compositionId = "recorder_character_preview";
  const mediaAssets = useStudio((state) => state.mediaAssets);

  const payload = useMemo(() => {
    const motionPresets = preset ? new Map([[preset.id, preset]]) : new Map<string, MotionPreset>();
    return buildCharacterRenderPayload({
      compositionId,
      clipId: "recorder-character-preview-clip",
      width: character.canvasWidth,
      height: character.canvasHeight,
      duration: Math.max(0.1, preset?.duration ?? 1),
      character,
      meta: {
        characterId: character.id,
        poses: basePoses,
        autoBlink: false,
        motions: preset
          ? [
              {
                id: "recorder-draft-motion",
                presetId: preset.id,
                offset: 0,
                intensity: 1,
                loop: false,
                duration: preset.duration,
              },
            ]
          : [],
      },
      mediaAssets,
      motionPresets,
    });
  }, [basePoses, character, compositionId, mediaAssets, preset]);

  const resetKey = `${payload.character.id}:${payload.duration}:${compileRevision}`;

  return (
    <PixiCharacterPreview
      payload={payload}
      time={time}
      resetKey={resetKey}
      reuseScene
      staleBehavior={staleBehavior}
      loadingLabel={loadingLabel}
      resolveAssetRef={resolveRecorderPreviewAssetRef}
      className="pointer-events-none absolute inset-0 block h-full w-full bg-transparent"
    />
  );
}

async function resolveRecorderPreviewAssetRef(asset: CharacterSceneAsset): Promise<string | null> {
  return getMediaUrl(asset.id);
}

/**
 * Dev-only editor chrome that marks resolved pivots and pin-driven joints.
 */
export function AnchorDebugOverlay({
  runtime,
  overrides,
}: {
  runtime: CharacterRuntime;
  overrides: Map<string, RecorderPartState>;
}) {
  const activeVariants = Object.fromEntries(
    Array.from(overrides.entries()).flatMap(([slotId, state]) =>
      state.poseSwap ? [[slotId, state.poseSwap]] : [],
    ),
  );
  const world = runtimeBoneWorldTransforms(runtime, activeVariants);
  const markers: Array<{ key: string; x: number; y: number; color: string; label?: string }> = [];
  for (const bone of runtime.angleRig.bones) {
    const at = world.get(bone.id);
    if (!at) continue;
    markers.push({ key: `pivot:${bone.id}`, x: at.x, y: at.y, color: "rgba(255,255,255,0.6)" });
    if (!bone.restSource || !bone.parentId) continue;
    const parentSlotId = bone.restSource.slotId;
    const activeKey = overrides.get(parentSlotId)?.poseSwap;
    const parentSlot = runtime.slotById.get(parentSlotId);
    const parentPart = parentSlot
      ? resolveRuntimeSlotPart(parentSlot, runtime, activeKey)
      : undefined;
    const resolved = !!parentPart?.pins?.[bone.restSource.pinName];
    markers.push({
      key: `anchor:${bone.id}`,
      x: at.x,
      y: at.y,
      color: resolved ? "#4ade80" : "#fbbf24",
      label:
        `${bone.name} ← ${parentSlotId}${activeKey ? ` : ${activeKey}` : ""} ` +
        `(${resolved ? bone.restSource.pinName : "missing pin"})`,
    });
  }
  return (
    <div className="pointer-events-none absolute inset-0 z-50">
      {markers.map((marker) => (
        <div
          key={marker.key}
          className="absolute"
          style={{ left: marker.x, top: marker.y, transform: "translate(-50%, -50%)" }}
        >
          <div
            className="rounded-full"
            style={{
              width: marker.label ? 10 : 6,
              height: marker.label ? 10 : 6,
              background: marker.color,
              boxShadow: "0 0 0 1px rgba(0,0,0,0.8)",
            }}
          />
          {marker.label && (
            <div
              className="absolute left-2 top-2 whitespace-nowrap rounded px-1 text-[9px]"
              style={{ background: "rgba(0,0,0,0.75)", color: marker.color }}
            >
              {marker.label}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function SelectionHandles({
  part,
  override,
  frame,
  scale,
  planeRef,
  onChange,
  onFlexiblePointChange,
}: {
  part: CharacterPart;
  override: RecorderPartState;
  frame: ReturnType<typeof recorderPartFrame>;
  scale: number;
  planeRef: React.RefObject<HTMLDivElement | null>;
  onChange: (patch: Partial<RecorderPartState>) => void;
  onFlexiblePointChange?: (change: FlexiblePointChange) => void;
}) {
  const queuedChange = useRafCoalescedCallback<FlexiblePointChange>((change) => {
    if (onFlexiblePointChange) onFlexiblePointChange(change);
    else onChange(change.patch);
  });
  const handleSize = 24 / Math.max(0.0001, scale);
  const flexibleDeform = part.deform?.mode === "limb-path" ? part.deform : null;
  const flexibleActionPath = flexibleDeform
    ? recorderActionLimbPathForPart(part, flexibleDeform)
    : null;
  const flexibleBaseCurve = flexibleActionPath
    ? (flexibleActionPath.curve ?? {
        x: (flexibleActionPath.start.x + flexibleActionPath.end.x) / 2,
        y: (flexibleActionPath.start.y + flexibleActionPath.end.y) / 2,
      })
    : null;
  const flexibleStartPosition = flexibleActionPath
    ? transformPoint(frame.matrix, flexibleActionPath.start)
    : null;
  const flexibleEndPosition = flexibleActionPath
    ? transformPoint(frame.matrix, {
        x: flexibleActionPath.end.x + override.pathEndX,
        y: flexibleActionPath.end.y + override.pathEndY,
      })
    : null;
  const flexibleCurvePosition =
    flexibleActionPath && flexibleBaseCurve
      ? transformPoint(frame.matrix, {
          x: flexibleBaseCurve.x + override.pathCurveX,
          y: flexibleBaseCurve.y + override.pathCurveY,
        })
      : null;
  // Trace the authored path displaced by the runtime's solved deformation so
  // the handles and guide stay aligned with the generated renderer.
  const flexibleSolveInputs = flexibleDeform ? limbPathSolveInputsForPart(part) : null;
  const hasFlexibleOffsets =
    override.pathEndX !== 0 ||
    override.pathEndY !== 0 ||
    override.pathCurveX !== 0 ||
    override.pathCurveY !== 0;
  let flexibleOverlayPoints: Array<{ x: number; y: number }> | null = null;
  if (
    flexibleSolveInputs &&
    flexibleSolveInputs.basePoints.length >= 2 &&
    flexibleSolveInputs.authoredPoints.length === flexibleSolveInputs.basePoints.length
  ) {
    if (!hasFlexibleOffsets) {
      flexibleOverlayPoints = flexibleSolveInputs.authoredPoints;
    } else {
      const solved = limbPathBendPoints(
        flexibleSolveInputs.basePoints,
        { x: override.pathEndX, y: override.pathEndY },
        { x: override.pathCurveX, y: override.pathCurveY },
        flexibleSolveInputs.lockTs,
        undefined,
        { side: flexibleSolveInputs.side, jointT: flexibleSolveInputs.jointT },
      );
      flexibleOverlayPoints = flexibleSolveInputs.authoredPoints.map((point, index) => ({
        x: point.x + solved[index].x - flexibleSolveInputs.basePoints[index].x,
        y: point.y + solved[index].y - flexibleSolveInputs.basePoints[index].y,
      }));
    }
  }
  const flexibleSolvedPath =
    flexibleOverlayPoints?.map((point) => transformPoint(frame.matrix, point)) ?? null;
  const flexiblePath = flexibleSolvedPath
    ? flexibleSolvedPath
        .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
        .join(" ")
    : flexibleStartPosition && flexibleEndPosition
      ? flexibleCurvePosition
        ? `M ${flexibleStartPosition.x} ${flexibleStartPosition.y} Q ${flexibleCurvePosition.x} ${flexibleCurvePosition.y} ${flexibleEndPosition.x} ${flexibleEndPosition.y}`
        : `M ${flexibleStartPosition.x} ${flexibleStartPosition.y} L ${flexibleEndPosition.x} ${flexibleEndPosition.y}`
      : "";

  const canvasPointFromPointer = (ev: PointerEvent | React.PointerEvent) => {
    const rect = planeRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: (ev.clientX - rect.left) / scale,
      y: (ev.clientY - rect.top) / scale,
    };
  };

  const startFlexiblePointDrag = (e: React.PointerEvent, point: "end" | "curve") => {
    e.preventDefault();
    e.stopPropagation();
    if (e.button !== 0 || !flexibleActionPath) return;
    const rect = planeRef.current?.getBoundingClientRect();
    if (!rect) return;
    const basePoint =
      point === "end"
        ? flexibleActionPath.end
        : (flexibleBaseCurve ?? {
            x: (flexibleActionPath.start.x + flexibleActionPath.end.x) / 2,
            y: (flexibleActionPath.start.y + flexibleActionPath.end.y) / 2,
          });
    const dragStartPoint =
      point === "end"
        ? {
            x: flexibleActionPath.end.x + override.pathEndX,
            y: flexibleActionPath.end.y + override.pathEndY,
          }
        : {
            x: basePoint.x + override.pathCurveX,
            y: basePoint.y + override.pathCurveY,
          };
    const dragStartCanvas = transformPoint(frame.matrix, dragStartPoint);
    let lastPatch: Partial<RecorderPartState> | null = null;
    const queuePatch = (patch: Partial<RecorderPartState>) => {
      if (recorderPatchEqual(lastPatch, patch)) return;
      lastPatch = patch;
      const nextPoint =
        point === "end"
          ? { x: basePoint.x + (patch.pathEndX ?? 0), y: basePoint.y + (patch.pathEndY ?? 0) }
          : {
              x: basePoint.x + (patch.pathCurveX ?? 0),
              y: basePoint.y + (patch.pathCurveY ?? 0),
            };
      const nextCanvas = transformPoint(frame.matrix, nextPoint);
      queuedChange.queue({
        point,
        patch,
        canvasDelta: {
          x: nextCanvas.x - dragStartCanvas.x,
          y: nextCanvas.y - dragStartCanvas.y,
        },
      });
    };
    const move = (ev: PointerEvent) => {
      const local = transformPoint(frame.inverseMatrix, {
        x: (ev.clientX - rect.left) / scale,
        y: (ev.clientY - rect.top) / scale,
      });
      const patch =
        point === "end"
          ? {
              pathEndX: round(local.x - basePoint.x, 1),
              pathEndY: round(local.y - basePoint.y, 1),
            }
          : constrainFlexibleCurvePatch({
              path: flexibleActionPath,
              baseCurve: basePoint,
              desired: local,
              override,
            });
      queuePatch(patch);
    };
    startWindowPointerDrag({
      onMove: move,
      onEnd: (event) => {
        if (event) move(event);
        queuedChange.flush();
      },
      onCancel: () => {
        queuedChange.cancel();
      },
    });
  };

  const startRotationDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.button !== 0) return;
    const startPoint = canvasPointFromPointer(e);
    if (!startPoint) return;
    const startAngle = Math.atan2(startPoint.y - frame.pivot.y, startPoint.x - frame.pivot.x);
    const startRotation = override.rotation;
    let lastPatch: Partial<RecorderPartState> | null = null;
    const queued = createRafCoalescedDispatcher<Partial<RecorderPartState>>((patch) => {
      if (!recorderPatchEqual(lastPatch, patch)) {
        lastPatch = patch;
        onChange(patch);
      }
    });
    const move = (ev: PointerEvent) => {
      const point = canvasPointFromPointer(ev);
      if (!point) return;
      const angle = Math.atan2(point.y - frame.pivot.y, point.x - frame.pivot.x);
      queued.queue({ rotation: round(startRotation + ((angle - startAngle) * 180) / Math.PI, 1) });
    };
    startWindowPointerDrag({
      onMove: move,
      onEnd: (event) => {
        if (event) move(event);
        queued.flush();
      },
      onCancel: queued.cancel,
    });
  };

  const rotateHandle = {
    x: (frame.bounds.left + frame.bounds.right) / 2,
    y: frame.bounds.top - Math.max(28, 34 / Math.max(0.0001, scale)),
  };

  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: 9999 }}>
      {/* Action editor chrome only: flexible-limb handles, pivot marker, and rotation handle. */}
      <svg className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
        {flexibleStartPosition && flexibleEndPosition && (
          <path
            d={flexiblePath}
            fill="none"
            stroke="#14b8a6"
            strokeWidth={Math.max(1.5, 2 / Math.max(0.0001, scale))}
            strokeDasharray={`${4 / Math.max(0.0001, scale)} ${3 / Math.max(0.0001, scale)}`}
            strokeLinecap="round"
          />
        )}
      </svg>
      {flexibleStartPosition && flexibleEndPosition && flexibleCurvePosition && (
        <>
          <div
            className="pointer-events-none absolute rounded-full border border-background bg-slate-950 shadow"
            style={{
              left: flexibleStartPosition.x,
              top: flexibleStartPosition.y,
              width: Math.max(8, handleSize * 0.36),
              height: Math.max(8, handleSize * 0.36),
              transform: "translate(-50%, -50%)",
            }}
            title="Flexible start"
          />
          <button
            type="button"
            onPointerDown={(e) => startFlexiblePointDrag(e, "end")}
            className="pointer-events-auto absolute rounded-full border border-background bg-teal-500 shadow"
            style={{
              left: flexibleEndPosition.x,
              top: flexibleEndPosition.y,
              width: Math.max(11, handleSize * 0.48),
              height: Math.max(11, handleSize * 0.48),
              transform: "translate(-50%, -50%)",
            }}
            title="Stretch flexible limb"
          />
          <button
            type="button"
            onPointerDown={(e) => startFlexiblePointDrag(e, "curve")}
            className="pointer-events-auto absolute rounded-full border border-background bg-amber-400 shadow"
            style={{
              left: flexibleCurvePosition.x,
              top: flexibleCurvePosition.y,
              width: Math.max(10, handleSize * 0.42),
              height: Math.max(10, handleSize * 0.42),
              transform: "translate(-50%, -50%)",
            }}
            title="Bend flexible limb"
          />
        </>
      )}
      <div
        className="absolute rounded-full border border-primary bg-background/80"
        style={{
          left: frame.pivot.x,
          top: frame.pivot.y,
          width: Math.max(8, handleSize * 0.4),
          height: Math.max(8, handleSize * 0.4),
          transform: "translate(-50%, -50%)",
        }}
      />
      <button
        type="button"
        onPointerDown={startRotationDrag}
        className="pointer-events-auto absolute flex items-center justify-center rounded-full border border-background bg-primary text-primary-foreground shadow"
        style={{
          left: rotateHandle.x,
          top: rotateHandle.y,
          width: Math.max(20, handleSize * 0.72),
          height: Math.max(20, handleSize * 0.72),
          transform: "translate(-50%, -50%)",
        }}
        title="Rotate"
      >
        <RotateCw size={Math.max(11, handleSize * 0.34)} />
      </button>
    </div>
  );
}
