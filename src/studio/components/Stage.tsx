// Stage — the visual preview area. Renders all currently-active clips
// using DOM layers (img / video / audio). Selection + drag/resize handles.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useStudio } from "../store";
import { db } from "../db";
import type {
  AnyClip,
  CharacterClip,
  CharacterPart,
  CharacterPreset,
  MediaClip,
  MouthViseme,
} from "../types";
import { clipActiveAt } from "../timeline-utils";
import { useMediaUrl } from "../hooks/useMediaUrl";
import { visemeAt } from "../lipsync/visemeMap";
import { ensurePresetsSeeded } from "../presets/seed";
import { composeActionsAt, deltaFor, poseSwapFor } from "../presets/apply";
import { listCharacterSlots, pickActivePartForSlot } from "../character/character-utils";
import { combinedParallax } from "../character/parallax";

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
          />
        ) : (
          <CharacterPlaceholder clip={clip as CharacterClip} playhead={playhead} />
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
  const start = (e: React.PointerEvent) => {
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
  return (
    <div
      onPointerDown={start}
      className="absolute -bottom-1 -right-1 h-3 w-3 cursor-se-resize rounded-sm bg-primary"
    />
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
  rest: "—",
  A: "A",
  E: "E",
  I: "I",
  O: "O",
  U: "U",
  MBP: "M",
  FV: "F",
  L: "L",
};

interface FallbackMouthPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  anchorX: number;
  anchorY: number;
  zIndex: number;
  depth: number;
  slotId?: string;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function fallbackMouthPlacement(character: CharacterPreset): FallbackMouthPlacement {
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

function CharacterPlaceholder({ clip, playhead }: { clip: CharacterClip; playhead: number }) {
  const v = visemeAt(clip.visemes, playhead - clip.start);
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

/** Render a real character rig: composes parts, applies actions and parallax. */
function CharacterRig({
  clip,
  character,
  playhead,
  presetMap,
}: {
  clip: CharacterClip;
  character: CharacterPreset;
  playhead: number;
  presetMap: Map<string, import("../types").ActionPreset>;
}) {
  const tInClip = playhead - clip.start;
  const composed = useMemo(
    () => composeActionsAt(clip, tInClip, presetMap),
    [clip, tInClip, presetMap],
  );
  const viseme = composed.mouthLocked ? undefined : visemeAt(clip.visemes, tInClip);

  // Active head variant (from headTurn presets)
  const headVariant = useMemo(() => {
    if (!composed.headDirection || !character.headVariants?.length) return null;
    return character.headVariants.find((v) => v.direction === composed.headDirection) ?? null;
  }, [composed.headDirection, character.headVariants]);

  // Clip motion delta = the character's own composed camera
  // (presets that drive __camera shift the whole character clip; treat that
  // as clip motion for parallax purposes).
  const clipDelta = { dx: composed.camera.dx, dy: composed.camera.dy };

  // Slots render one active variant each, while the whole rig remains one clip.
  const slots = useMemo(() => listCharacterSlots(character.parts), [character.parts]);
  const fallbackMouth = useMemo(() => fallbackMouthPlacement(character), [character]);
  const visibleMouthVisemes = useMemo(
    () =>
      new Set(
        character.parts
          .filter((p) => p.role === "mouth" && p.visible && p.viseme)
          .map((p) => p.viseme as MouthViseme),
      ),
    [character.parts],
  );
  const shouldUseFallbackMouth = Boolean(
    clip.visemes?.length && viseme && !composed.mouthLocked && !visibleMouthVisemes.has(viseme),
  );
  const fallbackMouthDelta = shouldUseFallbackMouth
    ? deltaFor(composed, "mouth", fallbackMouth.slotId)
    : null;
  const fallbackMouthParallax = shouldUseFallbackMouth
    ? combinedParallax(fallbackMouth.depth, character.parallax, { clipDelta })
    : { dx: 0, dy: 0 };
  const fallbackMouthFaceOffset =
    shouldUseFallbackMouth && headVariant
      ? { dx: headVariant.featureOffsetX ?? 0, dy: headVariant.featureOffsetY ?? 0 }
      : { dx: 0, dy: 0 };

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          width: character.canvasWidth,
          height: character.canvasHeight,
          transform: `scale(${clip.width / character.canvasWidth}, ${clip.height / character.canvasHeight})`,
        }}
      >
        {slots.map((slot) => {
          const role = slot.role;
          if (role === "mouth" && shouldUseFallbackMouth) return null;
          const poseSwap =
            poseSwapFor(composed, role, slot.id) ?? clip.poses[slot.id] ?? clip.poses[role];
          const part = pickActivePartForSlot(slot, {
            pose: poseSwap,
            viseme: role === "mouth" ? viseme : undefined,
            eyeState: role.startsWith("eye")
              ? (poseSwap ?? clip.poses[slot.id] ?? clip.poses[role] ?? clip.poses["eye"] ?? "open")
              : undefined,
          });
          if (!part) return null;
          const d = deltaFor(composed, role, slot.id);
          const parallax = combinedParallax(part.depth, character.parallax, {
            clipDelta,
          });
          // If this is the head and a head variant is active, swap the media id.
          const overrideMediaId = role === "head" && headVariant ? headVariant.mediaId : undefined;
          // Apply per-direction face feature offset to face features.
          const faceOffset =
            headVariant &&
            (role === "eye" ||
              role === "eyeL" ||
              role === "eyeR" ||
              role === "brow" ||
              role === "browL" ||
              role === "browR" ||
              role === "mouth")
              ? { dx: headVariant.featureOffsetX ?? 0, dy: headVariant.featureOffsetY ?? 0 }
              : { dx: 0, dy: 0 };
          return (
            <PartImage
              key={slot.id}
              part={part}
              overrideMediaId={overrideMediaId}
              dx={d.dx + parallax.dx + faceOffset.dx}
              dy={d.dy + parallax.dy + faceOffset.dy}
              scale={d.scale}
              rotation={d.rotation}
              opacity={d.opacity ?? 1}
            />
          );
        })}
        {shouldUseFallbackMouth && viseme && fallbackMouthDelta && (
          <DefaultMouthShape
            viseme={viseme}
            placement={fallbackMouth}
            dx={fallbackMouthDelta.dx + fallbackMouthParallax.dx + fallbackMouthFaceOffset.dx}
            dy={fallbackMouthDelta.dy + fallbackMouthParallax.dy + fallbackMouthFaceOffset.dy}
            scale={fallbackMouthDelta.scale}
            rotation={fallbackMouthDelta.rotation}
            opacity={fallbackMouthDelta.opacity ?? 1}
          />
        )}
      </div>
    </div>
  );
}

function DefaultMouthShape({
  viseme,
  placement,
  dx,
  dy,
  scale,
  rotation,
  opacity,
}: {
  viseme: MouthViseme;
  placement: FallbackMouthPlacement;
  dx: number;
  dy: number;
  scale: number;
  rotation: number;
  opacity: number;
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
        transform: `rotate(${placement.rotation + rotation}deg) scale(${scale})`,
        transformOrigin: `${placement.anchorX * 100}% ${placement.anchorY * 100}%`,
        pointerEvents: "none",
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
    case "I":
      return <rect x="22" y="24" width="56" height="15" rx="8" fill={mouth} />;
    case "O":
      return <ellipse cx="50" cy="30" rx="18" ry="24" fill={mouth} />;
    case "U":
      return <path d="M30 21c12 23 28 23 40 0 9 30-49 30-40 0Z" fill={mouth} />;
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

function PartImage({
  part,
  overrideMediaId,
  dx,
  dy,
  scale,
  rotation,
  opacity,
}: {
  part: import("../types").CharacterPart;
  overrideMediaId?: string;
  dx: number;
  dy: number;
  scale: number;
  rotation: number;
  opacity: number;
}) {
  const url = useMediaUrl(overrideMediaId ?? part.mediaId);
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
        transform: `rotate(${part.rotation + rotation}deg) scale(${scale})`,
        transformOrigin: `${part.anchorX * 100}% ${part.anchorY * 100}%`,
        pointerEvents: "none",
      }}
    />
  );
}
