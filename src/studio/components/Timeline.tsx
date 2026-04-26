// Timeline — multi-track strip with draggable clips, ruler, playhead.
import { useEffect, useRef } from "react";
import { useStudio } from "../store";
import type { AnyClip } from "../types";
import { fmtTime } from "../timeline-utils";

const TRACK_HEIGHT = 44;
const RULER_HEIGHT = 28;

export function Timeline() {
  const project = useStudio((s) => s.project);
  const playhead = useStudio((s) => s.playhead);
  const setPlayhead = useStudio((s) => s.setPlayhead);
  const playing = useStudio((s) => s.playing);
  const togglePlay = useStudio((s) => s.togglePlay);
  const setPlaying = useStudio((s) => s.setPlaying);
  const zoom = useStudio((s) => s.zoom);
  const setZoom = useStudio((s) => s.setZoom);
  const selectedId = useStudio((s) => s.selectedClipId);
  const selectClip = useStudio((s) => s.selectClip);
  const updateClip = useStudio((s) => s.updateClip);
  const removeClip = useStudio((s) => s.removeClip);
  const addLane = useStudio((s) => s.addLane);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const lastTickRef = useRef<number>(0);
  const rafRef = useRef<number | undefined>(undefined);

  // Playback loop
  useEffect(() => {
    if (!playing || !project) return;
    lastTickRef.current = performance.now();
    const loop = (now: number) => {
      const dt = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      const next = useStudio.getState().playhead + dt;
      if (next >= project.duration) {
        useStudio.getState().setPlayhead(project.duration);
        useStudio.getState().setPlaying(false);
        return;
      }
      useStudio.getState().setPlayhead(next);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, project]);

  if (!project) return null;
  const totalWidth = Math.max(1200, project.duration * zoom);

  const seekFromEvent = (e: React.MouseEvent) => {
    const el = scrollerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left + el.scrollLeft;
    setPlayhead(x / zoom);
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      {/* Transport */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <button
          onClick={() => togglePlay()}
          className="flex h-7 w-7 items-center justify-center rounded bg-primary text-primary-foreground hover:opacity-90"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <button
          onClick={() => { setPlaying(false); setPlayhead(0); }}
          className="rounded border border-border px-2 py-1 hover:bg-panel-2"
        >
          ⏮
        </button>
        <div className="ml-2 font-mono text-foreground">
          {fmtTime(playhead)} / {fmtTime(project.duration)}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-muted-foreground">Zoom</span>
          <input
            type="range" min={20} max={300} value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-32 accent-[oklch(0.7_0.18_295)]"
          />
        </div>
      </div>

      {/* Track headers + tracks */}
      <div className="flex min-h-0 flex-1">
        <div className="w-40 shrink-0 border-r border-border bg-panel-2">
          <div style={{ height: RULER_HEIGHT }} className="border-b border-border" />
          {project.tracks.map((t, i) => {
            const lanes = Math.max(1, t.lanes ?? 1);
            const lanePrefix =
              t.kind === "audio" ? "A" :
              t.kind === "background" ? "BG" :
              t.kind === "character" ? "C" : "V";
            return (
              <div
                key={t.id}
                style={{ height: TRACK_HEIGHT * lanes }}
                className={`flex flex-col border-b border-border ${i % 2 ? "bg-track-alt" : "bg-track"}`}
              >
                <div className="flex items-center gap-2 px-3 pt-1 text-xs">
                  <span className={`h-2 w-2 rounded-full ${
                    t.kind === "background" ? "bg-clip-bg" :
                    t.kind === "character" ? "bg-clip-character" :
                    t.kind === "audio" ? "bg-clip-audio" : "bg-clip"
                  }`} />
                  <span className="flex-1 truncate text-foreground">{t.name}</span>
                  <button
                    onClick={() => addLane(i)}
                    title="Add a sub-track lane"
                    className="rounded border border-border px-1.5 text-[10px] leading-tight text-muted-foreground hover:bg-panel hover:text-foreground"
                  >
                    +
                  </button>
                </div>
                <div className="flex flex-1 flex-col">
                  {Array.from({ length: lanes }).map((_, lane) => (
                    <div
                      key={lane}
                      style={{ height: TRACK_HEIGHT - (lane === 0 ? 18 : 0) }}
                      className="flex items-center px-3 text-[10px] text-muted-foreground"
                    >
                      {lanePrefix}{lane + 1}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div ref={scrollerRef} className="relative min-h-0 flex-1 overflow-auto">
          <div style={{ width: totalWidth, position: "relative" }}>
            {/* Ruler */}
            <div
              onMouseDown={seekFromEvent}
              className="sticky top-0 z-10 cursor-ew-resize border-b border-border bg-panel-2"
              style={{ height: RULER_HEIGHT }}
            >
              <Ruler duration={project.duration} zoom={zoom} />
            </div>

            {/* Tracks */}
            {project.tracks.map((t, i) => {
              const lanes = Math.max(1, t.lanes ?? 1);
              return (
                <div
                  key={t.id}
                  style={{ height: TRACK_HEIGHT * lanes }}
                  onMouseDown={(e) => { if (e.target === e.currentTarget) seekFromEvent(e); }}
                  className={`relative border-b border-border ${i % 2 ? "bg-track-alt" : "bg-track"}`}
                >
                  {/* Grid */}
                  <div
                    aria-hidden
                    className="absolute inset-0 opacity-30"
                    style={{
                      backgroundImage:
                        `linear-gradient(to right, var(--color-grid-line) 1px, transparent 1px)`,
                      backgroundSize: `${zoom}px 100%`,
                    }}
                  />
                  {/* Lane separators */}
                  {Array.from({ length: lanes - 1 }).map((_, lane) => (
                    <div
                      key={lane}
                      aria-hidden
                      className="absolute left-0 right-0 border-b border-border/50"
                      style={{ top: TRACK_HEIGHT * (lane + 1) }}
                    />
                  ))}
                  {project.clips
                    .filter((c) => c.trackIndex === i)
                    .map((c) => (
                      <ClipBlock
                        key={c.id}
                        clip={c}
                        zoom={zoom}
                        selected={c.id === selectedId}
                        tracks={project.tracks.length}
                        duration={project.duration}
                        lanes={lanes}
                        onSelect={() => selectClip(c.id)}
                        onChange={(p) => updateClip(c.id, p)}
                        onDelete={() => removeClip(c.id)}
                      />
                    ))}
                </div>
              );
            })}

            {/* Playhead */}
            <div
              className="pointer-events-none absolute top-0 z-20"
              style={{
                left: playhead * zoom,
                top: 0,
                bottom: 0,
                width: 2,
                background: "var(--color-playhead)",
                boxShadow: "0 0 8px var(--color-playhead)",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Ruler({ duration, zoom }: { duration: number; zoom: number }) {
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

function ClipBlock({
  clip, zoom, selected, onSelect, onChange, onDelete, duration, lanes,
}: {
  clip: AnyClip;
  zoom: number;
  selected: boolean;
  tracks: number;
  duration: number;
  lanes: number;
  onSelect: () => void;
  onChange: (p: Partial<AnyClip>) => void;
  onDelete: () => void;
}) {
  const color =
    clip.kind === "audio" ? "bg-clip-audio" :
    clip.kind === "character" ? "bg-clip-character" :
    clip.kind === "video" ? "bg-clip" :
    "bg-clip-bg";

  const lane = clip.laneIndex ?? 0;

  const onMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY;
    const ostart = clip.start;
    const olane = lane;
    const move = (ev: MouseEvent) => {
      const ns = Math.max(0, Math.min(duration - clip.duration, ostart + (ev.clientX - sx) / zoom));
      // Snap vertical drag to nearest lane within the track.
      const dy = ev.clientY - sy;
      const laneDelta = Math.round(dy / TRACK_HEIGHT);
      const newLane = Math.max(0, Math.min(lanes - 1, olane + laneDelta));
      onChange({ start: ns, laneIndex: newLane });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const onResizeRight = (e: React.MouseEvent) => {
    e.stopPropagation();
    const sx = e.clientX, od = clip.duration;
    const move = (ev: MouseEvent) => {
      const nd = Math.max(0.1, Math.min(duration - clip.start, od + (ev.clientX - sx) / zoom));
      onChange({ duration: nd });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const onResizeLeft = (e: React.MouseEvent) => {
    e.stopPropagation();
    const sx = e.clientX, ostart = clip.start, od = clip.duration;
    const move = (ev: MouseEvent) => {
      const dx = (ev.clientX - sx) / zoom;
      const ns = Math.max(0, Math.min(ostart + od - 0.1, ostart + dx));
      const nd = od - (ns - ostart);
      onChange({ start: ns, duration: nd });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div
      onMouseDown={onMouseDown}
      onKeyDown={(e) => { if (e.key === "Delete" || e.key === "Backspace") onDelete(); }}
      tabIndex={0}
      className={`group absolute cursor-grab overflow-hidden rounded ${color} ${selected ? "ring-2 ring-primary" : "ring-1 ring-black/30"}`}
      style={{
        left: clip.start * zoom,
        width: Math.max(8, clip.duration * zoom),
        top: lane * TRACK_HEIGHT + 4,
        height: TRACK_HEIGHT - 8,
      }}
      title={clip.name}
    >
      <div className="flex h-full items-center px-2 text-[11px] font-medium text-foreground/95 mix-blend-luminosity">
        <span className="truncate">{clip.name}</span>
      </div>
      <div onMouseDown={onResizeLeft} className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize bg-black/30 opacity-0 group-hover:opacity-100" />
      <div onMouseDown={onResizeRight} className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize bg-black/30 opacity-0 group-hover:opacity-100" />
    </div>
  );
}
