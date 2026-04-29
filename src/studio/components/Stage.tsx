// Stage — the visual preview area. Renders all currently-active clips
// using DOM layers (img / video / audio). Selection + drag/resize handles.
import { useEffect, useMemo, useRef, useState, type SVGAttributes } from "react";
import { ArrowDown, ArrowUp, RotateCw } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useStudio } from "../store";
import { db } from "../db";
import type {
  AnyClip,
  CharacterClip,
  CharacterPart,
  CharacterPreset,
  FallbackMouthAnchor,
  MediaClip,
  MouthViseme,
} from "../types";
import { clipActiveAt } from "../timeline-utils";
import { useMediaUrl } from "../hooks/useMediaUrl";
import { visemeAt, visemeStateAt } from "../lipsync/visemeMap";
import { ensurePresetsSeeded } from "../presets/seed";
import { composeActionsAt, deltaFor, poseSwapFor } from "../presets/apply";
import {
  listCharacterSlots,
  pickActivePartForSlot,
  roleEnabledByManifest,
} from "../character/character-utils";
import { combinedParallax } from "../character/parallax";
import {
  buildCharacterTimeline,
  slotDomId,
  visemeDomId,
  eyeDomId,
  rigComponentId,
} from "../export/timeline-builder";
import { RIG_STYLES, poseToTransforms, MOUTH_VIEWBOX } from "../character/mouth-libraries";
import type { MouthRig } from "../types";

export function Stage() {
  const project = useStudio((s) => s.project);
  const playhead = useStudio((s) => s.playhead);
  const playing = useStudio((s) => s.playing);
  const selectedId = useStudio((s) => s.selectedClipId);
  const selectClip = useStudio((s) => s.selectClip);
  const updateClip = useStudio((s) => s.updateClip);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Seed presets + load characters/presets for compositing
  useEffect(() => {
    void ensurePresetsSeeded();
  }, []);
  const characters = useLiveQuery(() => db.characters.toArray(), []);
  const presets = useLiveQuery(() => db.movements.toArray(), []);
  const charMap = useMemo(
    () => new Map((characters ?? []).map((c) => [c.id, c] as const)),
    [characters],
  );
  const presetMap = useMemo(
    () => new Map((presets ?? []).map((p) => [p.id, p] as const)),
    [presets],
  );

  // Fit-to-container scale
  useEffect(() => {
    if (!project) return;
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth - 32;
      const h = el.clientHeight - 32;
      const s = Math.min(w / project.width, h / project.height, 1);
      setScale(s > 0 ? s : 0.1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [project]);

  // Keyboard shortcuts for selected clip
  useEffect(() => {
    if (!selectedId) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "]") {
        updateClip(selectedId, {
          zIndex: (project?.clips.find((c) => c.id === selectedId)?.zIndex ?? 0) + 1,
        });
      } else if (e.key === "[") {
        const current = project?.clips.find((c) => c.id === selectedId)?.zIndex ?? 0;
        updateClip(selectedId, { zIndex: Math.max(0, current - 1) });
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selectedId, project, updateClip]);

  const activeClips = useMemo(
    () =>
      project
        ? project.clips.filter((c) => clipActiveAt(c, playhead)).sort((a, b) => a.zIndex - b.zIndex)
        : [],
    [project, playhead],
  );

  if (!project) return null;

  return (
    <div
      ref={wrapRef}
      className="relative flex h-full w-full items-center justify-center bg-stage-bg p-4"
      onClick={(e) => {
        // Only deselect when the click is on the empty stage background itself.
        if (e.target === e.currentTarget) selectClip(null);
      }}
    >
      <div
        className="relative shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)] outline outline-1 outline-border"
        style={{
          width: project.width * scale,
          height: project.height * scale,
          background: "oklch(0.06 0 0)",
        }}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            width: project.width,
            height: project.height,
            transform: `scale(${scale})`,
          }}
        >
          {activeClips.map((c) =>
            c.kind === "audio" ? (
              <AudioLayer key={c.id} clip={c as MediaClip} playhead={playhead} playing={playing} />
            ) : (
              <ClipLayer
                key={c.id}
                clip={c}
                fps={project.fps}
                playhead={playhead}
                playing={playing}
                selected={c.id === selectedId}
                scale={scale}
                onSelect={() => selectClip(c.id)}
                onChange={(p) => updateClip(c.id, p)}
                character={
                  c.kind === "character" ? charMap.get((c as CharacterClip).characterId) : undefined
                }
                presetMap={presetMap}
              />
            ),
          )}
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-2 right-3 rounded bg-panel/80 px-2 py-1 text-xs text-muted-foreground">
        {project.width}×{project.height} · {Math.round(scale * 100)}%
      </div>
    </div>
  );
}

function ClipLayer({
  clip,
  fps,
  playhead,
  playing,
  selected,
  scale,
  onSelect,
  onChange,
  character,
  presetMap,
}: {
  clip: AnyClip;
  fps: number;
  playhead: number;
  playing: boolean;
  selected: boolean;
  scale: number;
  onSelect: () => void;
  onChange: (p: Partial<AnyClip>) => void;
  character?: CharacterPreset;
  presetMap: Map<string, import("../types").ActionPreset>;
}) {
  const mediaId = clip.kind !== "character" ? (clip as MediaClip).mediaId : undefined;
  const url = useMediaUrl(mediaId);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Keep video element synced with playhead
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const local = playhead - clip.start;
    if (Math.abs(v.currentTime - local) > 0.15) {
      try {
        v.currentTime = Math.max(0, local);
      } catch {
        /* ignore */
      }
    }
    if (playing) v.play().catch(() => {});
    else v.pause();
  }, [playing, playhead, clip.start]);

  // Drag to move
  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    onSelect();
    if (e.button !== 0) return;
    const startX = e.clientX,
      startY = e.clientY;
    const ox = clip.x,
      oy = clip.y;
    const move = (ev: PointerEvent) => {
      onChange({
        x: Math.round(ox + (ev.clientX - startX) / scale),
        y: Math.round(oy + (ev.clientY - startY) / scale),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // For character clips: compose camera transform so the clip can apply a tiny scale.
  let charCamera = { dx: 0, dy: 0, zoom: 1 };
  if (clip.kind === "character") {
    const cc = clip as CharacterClip;
    const composed = composeActionsAt(cc, playhead - cc.start, presetMap);
    charCamera = composed.camera;
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()}
      className={`absolute select-none ${selected ? "outline-2 outline-primary" : "outline-1 outline-transparent hover:outline-accent/60"} outline outline-offset-0`}
      style={{
        left: clip.x + charCamera.dx,
        top: clip.y + charCamera.dy,
        width: clip.width,
        height: clip.height,
        opacity: clip.opacity,
        transform: `rotate(${clip.rotation}deg) scale(${charCamera.zoom})`,
        zIndex: clip.zIndex,
        cursor: "move",
      }}
    >
      {clip.kind === "image" && url && (
        <img src={url} alt={clip.name} draggable={false} className="h-full w-full object-cover" />
      )}
      {clip.kind === "video" && url && (
        <video ref={videoRef} src={url} muted playsInline className="h-full w-full object-cover" />
      )}
      {clip.kind === "character" &&
        (character ? (
          <CharacterRig
            clip={clip as CharacterClip}
            character={character}
            playhead={playhead}
            presetMap={presetMap}
            fps={fps}
          />
        ) : (
          <CharacterPlaceholder clip={clip as CharacterClip} playhead={playhead} fps={fps} />
        ))}
      {selected && <Handle clip={clip} scale={scale} onChange={onChange} />}
    </div>
  );
}

function Handle({
  clip,
  scale,
  onChange,
}: {
  clip: AnyClip;
  scale: number;
  onChange: (p: Partial<AnyClip>) => void;
}) {
  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation();
    const sx = e.clientX,
      sy = e.clientY;
    const ow = clip.width,
      oh = clip.height;
    const move = (ev: PointerEvent) => {
      onChange({
        width: Math.max(8, Math.round(ow + (ev.clientX - sx) / scale)),
        height: Math.max(8, Math.round(oh + (ev.clientY - sy) / scale)),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startRotate = (e: React.PointerEvent) => {
    e.stopPropagation();
    const sx = e.clientX,
      sy = e.clientY;
    const oRotation = clip.rotation;
    const cx = clip.x + clip.width / 2,
      cy = clip.y + clip.height / 2;
    const move = (ev: PointerEvent) => {
      const angle = Math.atan2(ev.clientY - cy, ev.clientX - cx) * (180 / Math.PI);
      const startAngle = Math.atan2(sy - cy, sx - cx) * (180 / Math.PI);
      onChange({ rotation: Math.round(oRotation + angle - startAngle) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <>
      {/* Resize handle */}
      <div
        onPointerDown={startResize}
        className="absolute -bottom-1 -right-1 h-3 w-3 cursor-se-resize rounded-sm bg-primary"
      />
      {/* Rotate handle */}
      <button
        onPointerDown={startRotate}
        className="absolute -top-6 left-1/2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border border-primary bg-background text-primary"
        title="Rotate"
      >
        <RotateCw size={12} />
      </button>
      {/* Bring forward */}
      <button
        onPointerDown={(e) => {
          e.stopPropagation();
          onChange({ zIndex: clip.zIndex + 1 });
        }}
        className="absolute -top-6 -left-1 flex h-5 w-5 items-center justify-center rounded border border-primary bg-background text-primary"
        title="Bring forward (])"
      >
        <ArrowUp size={12} />
      </button>
      {/* Send backward */}
      <button
        onPointerDown={(e) => {
          e.stopPropagation();
          onChange({ zIndex: Math.max(0, clip.zIndex - 1) });
        }}
        className="absolute -top-6 left-0 flex h-5 w-5 items-center justify-center rounded border border-primary bg-background text-primary"
        title="Send backward ([)"
      >
        <ArrowDown size={12} />
      </button>
    </>
  );
}

function AudioLayer({
  clip,
  playhead,
  playing,
}: {
  clip: MediaClip;
  playhead: number;
  playing: boolean;
}) {
  const url = useMediaUrl(clip.mediaId);
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    const local = playhead - clip.start;
    if (Math.abs(a.currentTime - local) > 0.15) {
      try {
        a.currentTime = Math.max(0, local);
      } catch {
        /* ignore */
      }
    }
    if (playing) a.play().catch(() => {});
    else a.pause();
  }, [playing, playhead, clip.start]);
  if (!url) return null;
  return <audio ref={ref} src={url} preload="auto" />;
}

const VISEME_GLYPH: Record<string, string> = {
  rest: "-",
  A: "A",
  E: "E",
  O: "O",
  U: "U",
  MBP: "M",
  FV: "F",
  L: "L",
  WQ: "W",
  Smile: ":)",
};

interface FallbackMouthPlacement extends FallbackMouthAnchor {
  slotId?: string;
}

interface PartMotion {
  dx: number;
  dy: number;
  scale: number;
  scaleY?: number;
  rotation: number;
  opacity?: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function autoBlinkClosedAt(clip: CharacterClip, tInClip: number) {
  if (clip.autoBlink === false || tInClip < 0) return false;
  const hash = hashString(clip.id);
  const cycle = 3.2 + (hash % 140) / 100;
  const offset = (((hash >>> 8) % 100) / 100) * cycle;
  const blinkDuration = 0.14;
  const phase = (tInClip + offset) % cycle;
  return phase >= cycle - blinkDuration;
}

function fallbackMouthPlacement(character: CharacterPreset): FallbackMouthPlacement {
  if (character.fallbackMouth) return character.fallbackMouth;

  const mouthParts = character.parts
    .filter((p) => p.role === "mouth" && p.visible)
    .sort((a, b) => a.zIndex - b.zIndex);
  const mouthAnchor = mouthParts.find((p) => p.viseme === "rest") ?? mouthParts[0];
  if (mouthAnchor) return placementFromMouthPart(character, mouthAnchor);

  const head = character.parts.find((p) => p.role === "head" && p.visible);
  const headLooksLikeFullCanvas =
    !!head &&
    head.width > character.canvasWidth * 0.72 &&
    head.height > character.canvasHeight * 0.72;
  const centerX = head ? head.x + head.width * 0.5 : character.canvasWidth * 0.5;
  const centerY = head
    ? headLooksLikeFullCanvas
      ? character.canvasHeight * 0.4
      : head.y + head.height * 0.7
    : character.canvasHeight * 0.42;
  const width = clamp(
    (head?.width ?? character.canvasWidth) * 0.18,
    54,
    character.canvasWidth * 0.2,
  );
  const height = clamp(width * 0.42, 22, character.canvasHeight * 0.08);

  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
    rotation: head?.rotation ?? 0,
    anchorX: 0.5,
    anchorY: 0.5,
    zIndex: 50,
    depth: 0,
  };
}

function placementFromMouthPart(
  character: CharacterPreset,
  part: CharacterPart,
): FallbackMouthPlacement {
  const looksLikeFullCanvas =
    part.width > character.canvasWidth * 0.72 && part.height > character.canvasHeight * 0.72;
  const centerX = part.x + part.width * 0.5;
  const centerY = looksLikeFullCanvas ? part.y + part.height * 0.4 : part.y + part.height * 0.5;
  const width = looksLikeFullCanvas
    ? clamp(character.canvasWidth * 0.14, 54, 120)
    : clamp(part.width, 44, character.canvasWidth * 0.22);
  const height = looksLikeFullCanvas
    ? clamp(width * 0.42, 22, 58)
    : clamp(part.height, 18, character.canvasHeight * 0.09);

  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
    rotation: part.rotation,
    anchorX: part.anchorX,
    anchorY: part.anchorY,
    zIndex: Math.max(part.zIndex, 50),
    depth: part.depth,
    slotId: part.slotId,
  };
}

function exactMouthPartForSlot(
  slot: ReturnType<typeof listCharacterSlots>[number],
  viseme: MouthViseme,
  anchor?: FallbackMouthPlacement,
) {
  if (slot.role !== "mouth") return undefined;
  const matches = slot.parts.filter(
    (part) => part.visible && (part.viseme === viseme || part.pose === viseme),
  );
  if (matches.length <= 1) return matches[0];
  if (!anchor) return matches.sort((a, b) => a.zIndex - b.zIndex)[0];

  const ax = anchor.x + anchor.width / 2;
  const ay = anchor.y + anchor.height / 2;
  return matches.slice().sort((a, b) => {
    const acx = a.x + a.width / 2;
    const acy = a.y + a.height / 2;
    const bcx = b.x + b.width / 2;
    const bcy = b.y + b.height / 2;
    const ad = Math.hypot(acx - ax, acy - ay);
    const bd = Math.hypot(bcx - ax, bcy - ay);
    if (Math.abs(ad - bd) > 1) return ad - bd;
    const aArea = a.width * a.height;
    const bArea = b.width * b.height;
    if (Math.abs(aArea - bArea) > 1) return aArea - bArea;
    return a.zIndex - b.zIndex;
  })[0];
}

function hasEyeVariant(slot: ReturnType<typeof listCharacterSlots>[number], eyeState: string) {
  return slot.parts.some(
    (part) => part.visible && (part.eyeState === eyeState || part.pose === eyeState),
  );
}

function isFaceAttachedRole(role: CharacterPart["role"]) {
  return role === "eye" || role === "eyebrow" || role === "mouth";
}

function findSlotForPart(slots: ReturnType<typeof listCharacterSlots>, partId: string | undefined) {
  if (!partId) return undefined;
  return slots.find((slot) => slot.parts.some((part) => part.id === partId));
}

function partPivot(part: CharacterPart) {
  return (
    part.pivot ?? {
      x: part.x + part.width * part.anchorX,
      y: part.y + part.height * part.anchorY,
    }
  );
}

function transformPointAroundPivot(
  point: { x: number; y: number },
  pivot: { x: number; y: number },
  motion: PartMotion,
) {
  const radians = (motion.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const relX = (point.x - pivot.x) * motion.scale;
  const relY = (point.y - pivot.y) * motion.scale;
  return {
    x: pivot.x + motion.dx + relX * cos - relY * sin,
    y: pivot.y + motion.dy + relX * sin + relY * cos,
  };
}

function inheritedMotionForPart({
  part,
  role,
  slots,
  composed,
}: {
  part: CharacterPart;
  role: CharacterPart["role"];
  slots: ReturnType<typeof listCharacterSlots>;
  composed: ReturnType<typeof composeActionsAt>;
}): PartMotion {
  const parentSlot =
    findSlotForPart(slots, part.parentId) ??
    (isFaceAttachedRole(role) ? slots.find((slot) => slot.role === "head") : undefined);
  if (!parentSlot) return { dx: 0, dy: 0, scale: 1, rotation: 0 };
  const parentPart = pickActivePartForSlot(parentSlot, {
    pose: undefined,
    viseme: parentSlot.role === "mouth" ? "rest" : undefined,
    eyeState: parentSlot.role === "eye" ? "open" : undefined,
  });
  if (!parentPart) return { dx: 0, dy: 0, scale: 1, rotation: 0 };
  const parentDelta = deltaFor(composed, parentSlot.role, parentSlot.id);
  const childPivot = partPivot(part);
  const transformedPivot = transformPointAroundPivot(childPivot, partPivot(parentPart), {
    ...parentDelta,
    opacity: parentDelta.opacity ?? undefined,
  });
  return {
    dx: transformedPivot.x - childPivot.x,
    dy: transformedPivot.y - childPivot.y,
    scale: parentDelta.scale,
    rotation: parentDelta.rotation,
    opacity: parentDelta.opacity ?? undefined,
  };
}

function motionForEye(
  part: CharacterPart,
  slot: ReturnType<typeof listCharacterSlots>[number],
  d: PartMotion,
  requestedEyeState: string | undefined,
) {
  const usingRealClosedState = part.eyeState === "closed" || part.pose === "closed";
  const slotHasClosedState = hasEyeVariant(slot, "closed");
  if (usingRealClosedState && slotHasClosedState && d.scale < 0.35) {
    return { ...d, scale: 1 };
  }
  if (!slotHasClosedState && d.scale < 0.35) {
    return { ...d, scale: 1, scaleY: Math.max(0.08, d.scale) };
  }
  if (!slotHasClosedState && requestedEyeState === "closed" && part.eyeState !== "closed") {
    return { ...d, scale: 1, scaleY: 0.12 };
  }
  return d;
}

function CharacterPlaceholder({
  clip,
  playhead,
  fps,
}: {
  clip: CharacterClip;
  playhead: number;
  fps: number;
}) {
  const v = visemeAt(clip.visemes, playhead - clip.start, {
    minHoldSeconds: 4 / Math.max(1, fps),
  });
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-clip-character/30 text-foreground">
      <div className="text-xs">{clip.name}</div>
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-foreground/10 text-2xl font-bold tracking-wider">
        {VISEME_GLYPH[v] ?? "—"}
      </div>
      {clip.voiceLine && (
        <div className="line-clamp-2 max-w-[80%] text-center text-[10px] text-muted-foreground">
          “{clip.voiceLine.text}”
        </div>
      )}
    </div>
  );
}

/**
 * Render a real character rig using GSAP seek.
 * All parts are in the DOM at rest positions. buildCharacterTimeline drives all
 * transforms; tl.seek(t) positions the rig at any time without React re-renders.
 */
function CharacterRig({
  clip,
  character,
  playhead,
  presetMap,
  fps,
}: {
  clip: CharacterClip;
  character: CharacterPreset;
  playhead: number;
  presetMap: Map<string, import("../types").ActionPreset>;
  fps: number;
}) {
  const tlRef = useRef<gsap.core.Timeline | null>(null);

  // Rebuild GSAP timeline when clip or character changes.
  useEffect(() => {
    tlRef.current = buildCharacterTimeline(clip, character, presetMap);
  }, [clip, character, presetMap]);

  // Seek to current playhead position on every frame.
  useEffect(() => {
    tlRef.current?.seek(Math.max(0, playhead - clip.start), false);
  }, [playhead, clip.start]);

  const scaleX = clip.width / character.canvasWidth;
  const scaleY = clip.height / character.canvasHeight;

  const slots = useMemo(
    () =>
      listCharacterSlots(character.parts).filter((slot) =>
        roleEnabledByManifest(slot.role, character.manifest),
      ),
    [character.parts, character.manifest],
  );

  const visemeState = visemeStateAt(clip.visemes, Math.max(0, playhead - clip.start), {
    minHoldSeconds: 4 / Math.max(1, fps),
    blendWindowSeconds: 0.075,
  });

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ isolation: "isolate" }}>
      <div className="absolute left-0 top-0" style={{ width: "100%", height: "100%" }}>
        {/* Transform-based mouth rig — rendered outside the slot loop */}
        {character.mouthRig && character.mouthStyle !== "images" && (
          <MouthRigRenderer
            rig={character.mouthRig}
            clipId={clip.id}
            scaleX={scaleX}
            scaleY={scaleY}
          />
        )}

        {slots.map((slot) => {
          // Skip mouth slot when a transform rig handles it.
          if (slot.role === "mouth" && character.mouthRig && character.mouthStyle !== "images")
            return null;

          if (slot.role === "mouth") {
            return (
              <MorphedMouthSlot
                key={slot.id}
                slot={slot}
                clip={clip}
                scaleX={scaleX}
                scaleY={scaleY}
                visemeState={visemeState}
              />
            );
          }

          if (slot.role === "eye") {
            // Container receives GSAP action transforms; variants inside toggle for blink.
            const openPart = slot.parts.find(
              (p) => p.visible && (p.eyeState === "open" || (!p.eyeState && !p.pose)),
            );
            const closedPart = slot.parts.find(
              (p) => p.visible && (p.eyeState === "closed" || p.pose === "closed"),
            );
            const basePart = openPart ?? closedPart;
            if (!basePart) return null;

            return (
              <div
                key={slot.id}
                id={slotDomId(clip.id, slot.id)}
                style={{
                  position: "absolute",
                  left: basePart.x * scaleX,
                  top: basePart.y * scaleY,
                  width: basePart.width * scaleX,
                  height: basePart.height * scaleY,
                  zIndex: basePart.zIndex,
                  transformOrigin: `${basePart.anchorX * 100}% ${basePart.anchorY * 100}%`,
                  overflow: "visible",
                }}
              >
                {openPart && (
                  <EyeVariantImage
                    id={eyeDomId(clip.id, slot.id, "open")}
                    part={openPart}
                    containerPart={basePart}
                    scaleX={scaleX}
                    scaleY={scaleY}
                    initialOpacity={1}
                  />
                )}
                {closedPart && (
                  <EyeVariantImage
                    id={eyeDomId(clip.id, slot.id, "closed")}
                    part={closedPart}
                    containerPart={basePart}
                    scaleX={scaleX}
                    scaleY={scaleY}
                    initialOpacity={0}
                  />
                )}
                <TintOverlay id={`${slotDomId(clip.id, slot.id)}-tint`} />
              </div>
            );
          }

          // All other roles: render the first visible part.
          const part = slot.parts.find((p) => p.visible);
          if (!part) return null;
          return (
            <PartImageScaled
              key={slot.id}
              id={slotDomId(clip.id, slot.id)}
              part={part}
              scaleX={scaleX}
              scaleY={scaleY}
              initialOpacity={1}
            />
          );
        })}
      </div>
    </div>
  );
}

const VISEMES: MouthViseme[] = ["rest", "A", "E", "O", "U", "MBP", "FV", "L", "WQ", "Smile"];

/**
 * Renders a mouth slot either as a React-morphed SVG (when all viseme parts have
 * compatible primaryPath data) or as GSAP opacity-toggled fallback variants.
 */
function MorphedMouthSlot({
  slot,
  clip,
  scaleX,
  scaleY,
  visemeState,
}: {
  slot: ReturnType<typeof listCharacterSlots>[number];
  clip: CharacterClip;
  scaleX: number;
  scaleY: number;
  visemeState: { current: MouthViseme; next?: MouthViseme; blend: number };
}) {
  const currentPart =
    slot.parts.find(
      (p) => p.visible && (p.viseme === visemeState.current || p.pose === visemeState.current),
    ) ?? slot.parts.find((p) => p.visible && (p.viseme === "rest" || p.pose === "rest"));

  const nextPart = visemeState.next
    ? slot.parts.find(
        (p) => p.visible && (p.viseme === visemeState.next || p.pose === visemeState.next),
      )
    : undefined;

  const morphedD = useMemo(() => {
    if (!currentPart?.morph?.primaryPath) return null;
    if (!nextPart?.morph?.primaryPath || visemeState.blend === 0)
      return currentPart.morph.primaryPath;
    return (
      interpolatedPath(
        currentPart.morph.primaryPath,
        nextPart.morph.primaryPath,
        visemeState.blend,
      ) ?? currentPart.morph.primaryPath
    );
  }, [currentPart, nextPart, visemeState.blend]);

  if (morphedD && currentPart?.morph) {
    const { morph } = currentPart;
    return (
      <div
        id={slotDomId(clip.id, slot.id)}
        className="absolute"
        style={{
          left: currentPart.x * scaleX,
          top: currentPart.y * scaleY,
          width: currentPart.width * scaleX,
          height: currentPart.height * scaleY,
          zIndex: currentPart.zIndex,
          opacity: 1,
          transformOrigin: `${currentPart.anchorX * 100}% ${currentPart.anchorY * 100}%`,
          pointerEvents: "none",
          overflow: "visible",
        }}
      >
        <svg
          viewBox={morph.viewBox ?? `0 0 ${currentPart.width} ${currentPart.height}`}
          className="absolute inset-0 h-full w-full overflow-visible"
          aria-hidden
        >
          <path
            d={morphedD}
            fill={morph.fill ?? "#733f43"}
            stroke={morph.stroke}
            strokeWidth={morph.strokeWidth}
            strokeLinecap={morph.strokeLinecap as SVGAttributes<SVGPathElement>["strokeLinecap"]}
            strokeLinejoin={morph.strokeLinejoin as SVGAttributes<SVGPathElement>["strokeLinejoin"]}
          />
        </svg>
        <TintOverlay id={`${slotDomId(clip.id, slot.id)}-tint`} />
      </div>
    );
  }

  // Fallback: GSAP opacity toggle for image-based or non-morph mouth parts.
  const basePart =
    slot.parts.find((p) => p.visible && (p.viseme === "rest" || p.pose === "rest")) ??
    slot.parts.find((p) => p.visible);
  if (!basePart) return null;
  return (
    <div
      id={slotDomId(clip.id, slot.id)}
      className="absolute"
      style={{
        left: basePart.x * scaleX,
        top: basePart.y * scaleY,
        width: basePart.width * scaleX,
        height: basePart.height * scaleY,
        zIndex: basePart.zIndex,
        transformOrigin: `${basePart.anchorX * 100}% ${basePart.anchorY * 100}%`,
        pointerEvents: "none",
        overflow: "visible",
      }}
    >
      {VISEMES.map((viseme) => {
        const part = slot.parts.find(
          (p) => p.visible && (p.viseme === viseme || p.pose === viseme),
        );
        if (!part) return null;
        return (
          <SlotVariantImage
            key={`${slot.id}-${viseme}`}
            id={visemeDomId(clip.id, slot.id, viseme)}
            part={part}
            containerPart={basePart}
            scaleX={scaleX}
            scaleY={scaleY}
            initialOpacity={viseme === "rest" ? 1 : 0}
          />
        );
      })}
      <TintOverlay id={`${slotDomId(clip.id, slot.id)}-tint`} />
    </div>
  );
}

/**
 * Renders the 5 transform-based mouth rig components (upper lip, lower lip,
 * interior, teeth, tongue). GSAP targets each by rigComponentId for animation.
 * The components sit at rest transforms; tl.to() moves them per viseme.
 */
function MouthRigRenderer({
  rig,
  clipId,
  scaleX,
  scaleY,
}: {
  rig: MouthRig;
  clipId: string;
  scaleX: number;
  scaleY: number;
}) {
  const style = RIG_STYLES.find((s) => s.id === rig.styleId) ?? RIG_STYLES[0];
  const { placement } = rig;
  const svgStyle: React.CSSProperties = {
    position: "absolute",
    left: placement.x * scaleX,
    top: placement.y * scaleY,
    width: placement.width * scaleX,
    height: placement.height * scaleY,
    zIndex: placement.zIndex,
    overflow: "visible",
    pointerEvents: "none",
    transformOrigin: "50% 50%",
  };

  // Each component shares the same container position; GSAP applies y/scaleX/scaleY.
  // transform-origin is set to the horizontal centre of the lip line (cx=50, cy=30 in SVG units).
  const componentStyle = (id: string): React.CSSProperties => ({
    position: "absolute",
    inset: 0,
    transformOrigin: `50% ${(30 / 60) * 100}%`,
  });

  return (
    <div id={rigComponentId(clipId, "container")} style={svgStyle}>
      {/* Interior — rendered first (bottom layer) */}
      <svg
        id={rigComponentId(clipId, "interior")}
        viewBox={MOUTH_VIEWBOX}
        style={componentStyle(rigComponentId(clipId, "interior"))}
        aria-hidden
      >
        <path d={style.interiorPath} fill={rig.interiorColor} />
      </svg>
      {/* Tongue */}
      <svg
        id={rigComponentId(clipId, "tongue")}
        viewBox={MOUTH_VIEWBOX}
        style={{ ...componentStyle(rigComponentId(clipId, "tongue")), opacity: 0 }}
        aria-hidden
      >
        <path d={style.tonguePath} fill={rig.tongueColor} />
      </svg>
      {/* Teeth */}
      <svg
        id={rigComponentId(clipId, "teeth")}
        viewBox={MOUTH_VIEWBOX}
        style={{ ...componentStyle(rigComponentId(clipId, "teeth")), opacity: 0 }}
        aria-hidden
      >
        <path d={style.teethPath} fill={rig.teethColor} />
      </svg>
      {/* Lower lip */}
      <svg
        id={rigComponentId(clipId, "lower-lip")}
        viewBox={MOUTH_VIEWBOX}
        style={componentStyle(rigComponentId(clipId, "lower-lip"))}
        aria-hidden
      >
        <path d={style.lowerLipPath} fill={rig.lipColor} />
      </svg>
      {/* Upper lip — top layer */}
      <svg
        id={rigComponentId(clipId, "upper-lip")}
        viewBox={MOUTH_VIEWBOX}
        style={componentStyle(rigComponentId(clipId, "upper-lip"))}
        aria-hidden
      >
        <path d={style.upperLipPath} fill={rig.lipColor} />
      </svg>
    </div>
  );
}

/**
 * Render a character part with explicitly scaled coordinates.
 * GSAP applies x/y/scale/rotation/opacity transforms on top.
 * Handles SVG path parts (mouth with morph metadata) and image parts.
 */
function PartImageScaled({
  id,
  part,
  scaleX,
  scaleY,
  initialOpacity,
}: {
  id: string;
  part: CharacterPart;
  scaleX: number;
  scaleY: number;
  initialOpacity: number;
}) {
  const url = useMediaUrl(part.mediaId);
  const svgSpec = useSvgPathSpec(part);

  const style: React.CSSProperties = {
    position: "absolute",
    left: part.x * scaleX,
    top: part.y * scaleY,
    width: part.width * scaleX,
    height: part.height * scaleY,
    zIndex: part.zIndex,
    opacity: initialOpacity,
    transformOrigin: `${part.anchorX * 100}% ${part.anchorY * 100}%`,
    pointerEvents: "none",
    overflow: "visible",
  };

  const contentStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
  };

  if (svgSpec) {
    return (
      <div id={id} style={style}>
        <svg
          viewBox={svgSpec.viewBox ?? `0 0 ${part.width} ${part.height}`}
          className="overflow-visible"
          style={contentStyle}
          aria-hidden
        >
          <path
            d={svgSpec.d}
            fill={svgSpec.fill ?? (svgSpec.stroke ? "none" : "#733f43")}
            stroke={svgSpec.stroke}
            strokeWidth={svgSpec.strokeWidth}
            strokeLinecap={
              svgSpec.strokeLinecap as import("react").SVGAttributes<SVGPathElement>["strokeLinecap"]
            }
            strokeLinejoin={
              svgSpec.strokeLinejoin as import("react").SVGAttributes<SVGPathElement>["strokeLinejoin"]
            }
          />
        </svg>
        <TintOverlay id={`${id}-tint`} />
      </div>
    );
  }

  if (!url) return null;
  return (
    <div id={id} style={style}>
      <img
        src={url}
        alt={part.name}
        draggable={false}
        className="absolute object-contain"
        style={contentStyle}
      />
      <TintOverlay id={`${id}-tint`} />
    </div>
  );
}

function TintOverlay({ id }: { id: string }) {
  return (
    <div
      id={id}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        mixBlendMode: "multiply",
        opacity: 0,
        backgroundColor: "rgba(0, 0, 0, 0)",
        borderRadius: "inherit",
      }}
    />
  );
}

/**
 * Eye variant image positioned relative to its slot container.
 * The container div (slotDomId) receives action transforms; this element just
 * toggles opacity for blink via GSAP.
 */
function EyeVariantImage({
  id,
  part,
  containerPart,
  scaleX,
  scaleY,
  initialOpacity,
}: {
  id: string;
  part: CharacterPart;
  containerPart: CharacterPart;
  scaleX: number;
  scaleY: number;
  initialOpacity: number;
}) {
  const url = useMediaUrl(part.mediaId);
  if (!url) return null;
  return (
    <img
      id={id}
      src={url}
      alt={part.name}
      draggable={false}
      className="absolute object-contain"
      style={{
        left: (part.x - containerPart.x) * scaleX,
        top: (part.y - containerPart.y) * scaleY,
        width: part.width * scaleX,
        height: part.height * scaleY,
        opacity: initialOpacity,
        transformOrigin: `${part.anchorX * 100}% ${part.anchorY * 100}%`,
        pointerEvents: "none",
      }}
    />
  );
}

function SlotVariantImage({
  id,
  part,
  containerPart,
  scaleX,
  scaleY,
  initialOpacity,
}: {
  id: string;
  part: CharacterPart;
  containerPart: CharacterPart;
  scaleX: number;
  scaleY: number;
  initialOpacity: number;
}) {
  const url = useMediaUrl(part.mediaId);
  const svgSpec = useSvgPathSpec(part);
  const style: React.CSSProperties = {
    position: "absolute",
    left: (part.x - containerPart.x) * scaleX,
    top: (part.y - containerPart.y) * scaleY,
    width: part.width * scaleX,
    height: part.height * scaleY,
    opacity: initialOpacity,
    transformOrigin: `${part.anchorX * 100}% ${part.anchorY * 100}%`,
    pointerEvents: "none",
  };

  if (svgSpec) {
    return (
      <svg
        id={id}
        viewBox={svgSpec.viewBox ?? `0 0 ${part.width} ${part.height}`}
        className="overflow-visible"
        style={style}
        aria-hidden
      >
        <path
          d={svgSpec.d}
          fill={svgSpec.fill ?? (svgSpec.stroke ? "none" : "#733f43")}
          stroke={svgSpec.stroke}
          strokeWidth={svgSpec.strokeWidth}
          strokeLinecap={svgSpec.strokeLinecap as SVGAttributes<SVGPathElement>["strokeLinecap"]}
          strokeLinejoin={svgSpec.strokeLinejoin as SVGAttributes<SVGPathElement>["strokeLinejoin"]}
        />
      </svg>
    );
  }

  if (!url) return null;
  return (
    <img
      id={id}
      src={url}
      alt={part.name}
      draggable={false}
      className="absolute object-contain"
      style={style}
    />
  );
}

function DefaultMouthShape({
  viseme,
  placement,
  dx,
  dy,
  scale,
  scaleY,
  rotation,
  opacity,
  transitionMs = 80,
}: {
  viseme: MouthViseme;
  placement: FallbackMouthPlacement;
  dx: number;
  dy: number;
  scale: number;
  scaleY?: number;
  rotation: number;
  opacity: number;
  transitionMs?: number;
}) {
  return (
    <svg
      viewBox="0 0 100 60"
      className="absolute overflow-visible"
      style={{
        left: placement.x + dx,
        top: placement.y + dy,
        width: placement.width,
        height: placement.height,
        zIndex: placement.zIndex,
        opacity,
        transform: `rotate(${placement.rotation + rotation}deg) scale(${scale}, ${scaleY ?? scale})`,
        transformOrigin: `${placement.anchorX * 100}% ${placement.anchorY * 100}%`,
        pointerEvents: "none",
        transition: transitionMs > 0 ? `opacity ${transitionMs}ms ease-in-out` : undefined,
      }}
      aria-hidden
    >
      {renderDefaultMouthViseme(viseme)}
    </svg>
  );
}

function renderDefaultMouthViseme(viseme: MouthViseme) {
  const mouth = "#733f43";
  const tongue = "#e87f89";
  switch (viseme) {
    case "A":
      return (
        <>
          <ellipse cx="50" cy="30" rx="23" ry="27" fill={mouth} />
          <ellipse cx="50" cy="42" rx="14" ry="8" fill={tongue} />
        </>
      );
    case "E":
      return (
        <>
          <path d="M18 22c20 18 44 18 64 0 1 27-65 27-64 0Z" fill={mouth} />
          <rect x="31" y="25" width="38" height="8" rx="3" fill="#fff" />
        </>
      );
    case "O":
      return <ellipse cx="50" cy="30" rx="18" ry="24" fill={mouth} />;
    case "U":
      return <path d="M30 21c12 23 28 23 40 0 9 30-49 30-40 0Z" fill={mouth} />;
    case "WQ":
      return <ellipse cx="50" cy="30" rx="12" ry="19" fill={mouth} />;
    case "MBP":
      return <path d="M16 31c22-11 46-11 68 0-22 12-46 12-68 0Z" fill={mouth} />;
    case "FV":
      return (
        <>
          <path d="M22 22c19 17 37 17 56 0 0 22-56 22-56 0Z" fill={mouth} />
          <rect x="29" y="22" width="42" height="8" rx="3" fill="#fff" />
        </>
      );
    case "L":
      return (
        <>
          <path d="M30 21c13 22 27 22 40 0v25c-13 12-27 12-40 0V21Z" fill={mouth} />
          <path
            d="M40 40c7-8 13-8 20 0"
            fill="none"
            stroke={tongue}
            strokeWidth="8"
            strokeLinecap="round"
          />
        </>
      );
    case "Smile":
      return (
        <path
          d="M20 24c16 22 44 22 60 0"
          fill="none"
          stroke={mouth}
          strokeWidth="8"
          strokeLinecap="round"
        />
      );
    case "rest":
    default:
      return (
        <path
          d="M22 31c18 8 38 8 56 0"
          fill="none"
          stroke={mouth}
          strokeWidth="8"
          strokeLinecap="round"
        />
      );
  }
}

interface SvgPathSpec {
  d: string;
  viewBox?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: string;
  strokeLinecap?: string;
  strokeLinejoin?: string;
}

function useSvgPathSpec(part: CharacterPart): SvgPathSpec | null {
  const url = useMediaUrl(part.mediaId);
  const [fetched, setFetched] = useState<SvgPathSpec | null>(null);
  const morph = part.morph;

  useEffect(() => {
    let alive = true;
    setFetched(null);
    if (morph?.primaryPath || !url) return;
    fetch(url)
      .then((res) => res.text())
      .then((text) => {
        if (alive) setFetched(extractSvgPathSpec(text));
      })
      .catch(() => {
        if (alive) setFetched(null);
      });
    return () => {
      alive = false;
    };
  }, [morph?.primaryPath, url]);

  if (morph?.primaryPath) {
    return {
      d: morph.primaryPath,
      viewBox: morph.viewBox,
      fill: morph.fill,
      stroke: morph.stroke,
      strokeWidth: morph.strokeWidth,
      strokeLinecap: morph.strokeLinecap,
      strokeLinejoin: morph.strokeLinejoin,
    };
  }
  return fetched;
}

function extractSvgPathSpec(text: string): SvgPathSpec | null {
  const svgMatch = text.match(/<svg\b([^>]*)>/i);
  const pathMatch = text.match(/<path\b([^>]*)>/i);
  if (!pathMatch) return null;
  const svgAttrs = parseSvgAttrs(svgMatch?.[1] ?? "");
  const pathAttrs = parseSvgAttrs(pathMatch[1]);
  if (!pathAttrs.d) return null;
  return {
    d: pathAttrs.d,
    viewBox: svgAttrs.viewBox,
    fill: pathAttrs.fill,
    stroke: pathAttrs.stroke,
    strokeWidth: pathAttrs["stroke-width"],
    strokeLinecap: pathAttrs["stroke-linecap"],
    strokeLinejoin: pathAttrs["stroke-linejoin"],
  };
}

function parseSvgAttrs(input: string) {
  const attrs: Record<string, string> = {};
  for (const match of input.matchAll(/([:\w-]+)=["']([^"']*)["']/g)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

type PathToken =
  | { kind: "command"; value: string }
  | { kind: "number"; value: number; raw: string };

function tokenizePath(d: string): PathToken[] {
  const tokens: PathToken[] = [];
  const re = /[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g;
  for (const match of d.matchAll(re)) {
    const raw = match[0];
    if (/^[a-zA-Z]$/.test(raw)) tokens.push({ kind: "command", value: raw });
    else tokens.push({ kind: "number", value: Number(raw), raw });
  }
  return tokens;
}

function interpolatedPath(from: string, to: string, blend: number): string | null {
  const a = tokenizePath(from);
  const b = tokenizePath(to);
  if (a.length !== b.length) return null;
  const out: string[] = [];
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (left.kind !== right.kind) return null;
    if (left.kind === "command") {
      if (left.value !== right.value) return null;
      out.push(left.value);
    } else {
      const lv = left.value as number;
      const rv = (right as { kind: "number"; value: number }).value;
      out.push(formatPathNumber(lv + (rv - lv) * blend));
    }
  }
  return out.join(" ");
}

function formatPathNumber(value: number) {
  return Number(value.toFixed(3)).toString();
}

function MorphingMouthPart({
  part,
  nextPart,
  blend,
  dx,
  dy,
  scale,
  scaleY,
  rotation,
  opacity,
}: {
  part: CharacterPart;
  nextPart: CharacterPart;
  blend: number;
  dx: number;
  dy: number;
  scale: number;
  scaleY?: number;
  rotation: number;
  opacity: number;
}) {
  const currentSpec = useSvgPathSpec(part);
  const nextSpec = useSvgPathSpec(nextPart);
  const d = currentSpec && nextSpec ? interpolatedPath(currentSpec.d, nextSpec.d, blend) : null;

  if (!d || !currentSpec) {
    return (
      <PartImage
        part={part}
        dx={dx}
        dy={dy}
        scale={scale}
        scaleY={scaleY}
        rotation={rotation}
        opacity={opacity}
        transitionMs={0}
      />
    );
  }

  return (
    <svg
      viewBox={currentSpec.viewBox ?? `0 0 ${part.width} ${part.height}`}
      className="absolute overflow-visible"
      style={{
        left: part.x + dx,
        top: part.y + dy,
        width: part.width,
        height: part.height,
        zIndex: part.zIndex,
        opacity,
        transform: `rotate(${part.rotation + rotation}deg) scale(${scale}, ${scaleY ?? scale})`,
        transformOrigin: `${part.anchorX * 100}% ${part.anchorY * 100}%`,
        pointerEvents: "none",
      }}
      aria-hidden
    >
      <path
        d={d}
        fill={currentSpec.fill ?? (currentSpec.stroke ? "none" : "#733f43")}
        stroke={currentSpec.stroke}
        strokeWidth={currentSpec.strokeWidth}
        strokeLinecap={currentSpec.strokeLinecap as SVGAttributes<SVGPathElement>["strokeLinecap"]}
        strokeLinejoin={
          currentSpec.strokeLinejoin as SVGAttributes<SVGPathElement>["strokeLinejoin"]
        }
      />
    </svg>
  );
}

function PartImage({
  part,
  overrideMediaId,
  dx,
  dy,
  scale,
  scaleY,
  rotation,
  opacity,
  transitionMs = 80,
}: {
  part: import("../types").CharacterPart;
  overrideMediaId?: string;
  dx: number;
  dy: number;
  scale: number;
  scaleY?: number;
  rotation: number;
  opacity: number;
  transitionMs?: number;
}) {
  const url = useMediaUrl(overrideMediaId ?? part.mediaId);
  const svgSpec = useSvgPathSpec(part);
  if (part.role === "mouth" && svgSpec) {
    return (
      <svg
        viewBox={svgSpec.viewBox ?? `0 0 ${part.width} ${part.height}`}
        className="absolute overflow-visible"
        style={{
          left: part.x + dx,
          top: part.y + dy,
          width: part.width,
          height: part.height,
          zIndex: part.zIndex,
          opacity,
          transform: `rotate(${part.rotation + rotation}deg) scale(${scale}, ${scaleY ?? scale})`,
          transformOrigin: `${part.anchorX * 100}% ${part.anchorY * 100}%`,
          pointerEvents: "none",
          transition: transitionMs > 0 ? `opacity ${transitionMs}ms ease-in-out` : undefined,
        }}
        aria-hidden
      >
        <path
          d={svgSpec.d}
          fill={svgSpec.fill ?? (svgSpec.stroke ? "none" : "#733f43")}
          stroke={svgSpec.stroke}
          strokeWidth={svgSpec.strokeWidth}
          strokeLinecap={svgSpec.strokeLinecap as SVGAttributes<SVGPathElement>["strokeLinecap"]}
          strokeLinejoin={svgSpec.strokeLinejoin as SVGAttributes<SVGPathElement>["strokeLinejoin"]}
        />
      </svg>
    );
  }
  if (!url) return null;
  return (
    <img
      src={url}
      alt={part.name}
      draggable={false}
      className="absolute h-full w-full object-contain"
      style={{
        left: part.x + dx,
        top: part.y + dy,
        width: part.width,
        height: part.height,
        zIndex: part.zIndex,
        opacity,
        transform: `rotate(${part.rotation + rotation}deg) scale(${scale}, ${scaleY ?? scale})`,
        transformOrigin: `${part.anchorX * 100}% ${part.anchorY * 100}%`,
        pointerEvents: "none",
        transition: transitionMs > 0 ? `opacity ${transitionMs}ms ease-in-out` : undefined,
      }}
    />
  );
}
