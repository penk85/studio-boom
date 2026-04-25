// Stage — the visual preview area. Renders all currently-active clips
// using DOM layers (img / video / audio). Selection + drag/resize handles.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useStudio } from "../store";
import { db } from "../db";
import type { AnyClip, CharacterClip, CharacterPreset, MediaClip } from "../types";
import { clipActiveAt } from "../timeline-utils";
import { useMediaUrl } from "../hooks/useMediaUrl";
import { visemeAt } from "../lipsync/visemeMap";
import { ensurePresetsSeeded } from "../presets/seed";
import { composeActionsAt, deltaFor } from "../presets/apply";
import { pickActivePart } from "../character/character-utils";
import { parallaxOffset } from "../character/parallax";

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
  useEffect(() => { void ensurePresetsSeeded(); }, []);
  const characters = useLiveQuery(() => db.characters.toArray(), []) ?? [];
  const presets = useLiveQuery(() => db.movements.toArray(), []) ?? [];
  const charMap = useMemo(() => new Map(characters.map((c) => [c.id, c] as const)), [characters]);
  const presetMap = useMemo(() => new Map(presets.map((p) => [p.id, p] as const)), [presets]);

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
        ? project.clips
            .filter((c) => clipActiveAt(c, playhead))
            .sort((a, b) => a.zIndex - b.zIndex)
        : [],
    [project, playhead],
  );

  if (!project) return null;

  return (
    <div
      ref={wrapRef}
      className="relative flex h-full w-full items-center justify-center bg-stage-bg p-4"
      onClick={() => selectClip(null)}
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
                character={c.kind === "character" ? charMap.get((c as CharacterClip).characterId) : undefined}
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
      try { v.currentTime = Math.max(0, local); } catch { /* ignore */ }
    }
    if (playing) v.play().catch(() => {});
    else v.pause();
  }, [playing, playhead, clip.start]);

  // Drag to move
  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    onSelect();
    if (e.button !== 0) return;
    const startX = e.clientX, startY = e.clientY;
    const ox = clip.x, oy = clip.y;
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
        <video
          ref={videoRef}
          src={url}
          muted
          playsInline
          className="h-full w-full object-cover"
        />
      )}
      {clip.kind === "character" && (
        character
          ? <CharacterRig clip={clip as CharacterClip} character={character} playhead={playhead} presetMap={presetMap} />
          : <CharacterPlaceholder clip={clip as CharacterClip} playhead={playhead} />
      )}
      {selected && (
        <Handle clip={clip} scale={scale} onChange={onChange} />
      )}
    </div>
  );
}

function Handle({
  clip, scale, onChange,
}: { clip: AnyClip; scale: number; onChange: (p: Partial<AnyClip>) => void }) {
  const start = (e: React.PointerEvent) => {
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY;
    const ow = clip.width, oh = clip.height;
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

function AudioLayer({ clip, playhead, playing }: { clip: MediaClip; playhead: number; playing: boolean }) {
  const url = useMediaUrl(clip.mediaId);
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    const local = playhead - clip.start;
    if (Math.abs(a.currentTime - local) > 0.15) {
      try { a.currentTime = Math.max(0, local); } catch { /* ignore */ }
    }
    if (playing) a.play().catch(() => {});
    else a.pause();
  }, [playing, playhead, clip.start]);
  if (!url) return null;
  return <audio ref={ref} src={url} preload="auto" />;
}

const VISEME_GLYPH: Record<string, string> = {
  rest: "—", A: "A", E: "E", I: "I", O: "O", U: "U",
  MBP: "M", FV: "F", L: "L",
};

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
  clip, character, playhead, presetMap,
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
  const viseme = composed.mouthLocked
    ? undefined
    : visemeAt(clip.visemes, tInClip);

  // Roles to render (one part per role based on viseme/eyeState/poseSwap/clip.poses)
  const allRoles = Array.from(new Set(character.parts.map((p) => p.role)));

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        // Inner viewport scales the character's logical canvas to the clip box.
        // We use a wrapper at native resolution and scale via transform.
      }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          width: character.canvasWidth,
          height: character.canvasHeight,
          transform: `scale(${clip.width / character.canvasWidth}, ${clip.height / character.canvasHeight})`,
        }}
      >
        {allRoles
          .map((role) => {
            const poseSwap = composed.poseSwap.get(role) ?? clip.poses[role];
            const part = pickActivePart(character.parts, role, {
              pose: poseSwap,
              viseme: role === "mouth" ? viseme : undefined,
              eyeState: role.startsWith("eye") ? clip.poses["eye"] ?? "open" : undefined,
            });
            if (!part) return null;
            const d = deltaFor(composed, role);
            const parallax = character.parallaxEnabled
              ? parallaxOffset(part.depth, { dx: composed.camera.dx, dy: composed.camera.dy }, 0.5)
              : { dx: 0, dy: 0 };
            return (
              <PartImage
                key={role}
                part={part}
                dx={d.dx + parallax.dx}
                dy={d.dy + parallax.dy}
                scale={d.scale}
                rotation={d.rotation}
                opacity={d.opacity ?? 1}
              />
            );
          })}
      </div>
    </div>
  );
}

function PartImage({
  part, dx, dy, scale, rotation, opacity,
}: {
  part: import("../types").CharacterPart;
  dx: number; dy: number; scale: number; rotation: number; opacity: number;
}) {
  const url = useMediaUrl(part.mediaId);
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
