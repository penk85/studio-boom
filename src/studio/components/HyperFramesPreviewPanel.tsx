import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "../types";
import { resolvePreviewHtml } from "../hyperframes/preview";

interface HyperFramesPreviewPanelProps {
  project: Project | null;
  width: number;
  height: number;
  seekTime?: number;
  title?: string;
  onStatusChange?: (status: "idle" | "loading" | "ready" | "error") => void;
}

export function HyperFramesPreviewPanel({
  project,
  width,
  height,
  seekTime = 0.75,
  title = "HyperFrames preview",
  onStatusChange,
}: HyperFramesPreviewPanelProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const hasStartedRef = useRef(false);
  const [scale, setScale] = useState(1);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const resolvedSeekTime = Math.max(0, seekTime);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const updateScale = () => {
      const nextWidth = shell.clientWidth;
      if (nextWidth > 0) setScale(nextWidth / safeWidth);
    };

    updateScale();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateScale);
      return () => window.removeEventListener("resize", updateScale);
    }

    const observer = new ResizeObserver(updateScale);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [safeWidth]);

  useEffect(() => {
    if (!project) {
      setHtml(null);
      setError(null);
      onStatusChange?.("idle");
      return;
    }

    let cancelled = false;
    let revoke = () => {};
    setHtml(null);
    setError(null);
    setIsPlaying(false);
    hasStartedRef.current = false;
    onStatusChange?.("loading");

    void resolvePreviewHtml(project)
      .then((resolved) => {
        revoke = resolved.revoke;
        if (cancelled) return;
        setHtml(withPreviewSeekDriver(resolved.html, resolvedSeekTime));
        onStatusChange?.("ready");
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        onStatusChange?.("error");
      });

    return () => {
      cancelled = true;
      revoke();
    };
  }, [project, resolvedSeekTime, onStatusChange]);

  const aspectRatio = useMemo(() => `${safeWidth} / ${safeHeight}`, [safeWidth, safeHeight]);
  const canControl = html !== null && error === null;

  const sendPreviewCommand = (action: "play" | "pause" | "restart") => {
    iframeRef.current?.contentWindow?.postMessage(
      {
        source: "studio-boom-preview",
        action,
        seekTime: resolvedSeekTime,
      },
      "*",
    );
  };

  const togglePlayback = () => {
    if (!canControl) return;
    if (isPlaying) {
      sendPreviewCommand("pause");
      setIsPlaying(false);
      return;
    }
    sendPreviewCommand(hasStartedRef.current ? "play" : "restart");
    hasStartedRef.current = true;
    setIsPlaying(true);
  };

  const restartPlayback = () => {
    if (!canControl) return;
    sendPreviewCommand("restart");
    hasStartedRef.current = true;
    setIsPlaying(true);
  };

  return (
    <div className="overflow-hidden rounded border border-border bg-stage-bg">
      <div className="flex items-center gap-1 border-b border-border bg-panel-2 px-2 py-1">
        <div className="min-w-0 flex-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Preview
        </div>
        <button
          type="button"
          onClick={togglePlayback}
          disabled={!canControl}
          className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-panel hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          title={isPlaying ? "Pause preview" : "Play preview"}
          aria-label={isPlaying ? "Pause preview" : "Play preview"}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button
          type="button"
          onClick={restartPlayback}
          disabled={!canControl}
          className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-panel hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          title="Restart preview"
          aria-label="Restart preview"
        >
          <RotateCcw size={14} />
        </button>
      </div>
      <div
        ref={shellRef}
        className="relative w-full overflow-hidden bg-stage-bg"
        style={{ aspectRatio }}
      >
        {html && (
          <iframe
            ref={iframeRef}
            title={title}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            srcDoc={html}
            className="absolute left-0 top-0 block border-0 bg-stage-bg"
            style={{
              width: safeWidth,
              height: safeHeight,
              transform: `scale(${scale})`,
              transformOrigin: "0 0",
            }}
          />
        )}
        {!html && !error && (
          <div className="absolute inset-0 grid place-items-center text-[11px] text-muted-foreground">
            Bundling preview...
          </div>
        )}
        {error && (
          <div className="absolute inset-0 overflow-auto bg-destructive/10 p-2 text-[11px] leading-relaxed text-destructive-foreground">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function withPreviewSeekDriver(html: string, seekTime: number): string {
  const script = `<script data-studio-preview-driver>
(() => {
  const seekTime = ${JSON.stringify(seekTime)};
  let attempts = 0;
  let timer = null;

  const timelines = () => Object.values(window.__timelines || {}).filter((timeline) => {
    return timeline && typeof timeline.seek === "function";
  });

  const controlPreview = (action, nextTime = seekTime) => {
    attempts += 1;
    let didSeek = false;

    const player = window.__player;
    if (player && action === "play" && typeof player.play === "function") {
      player.play();
      didSeek = true;
    } else if (player && action === "pause" && typeof player.pause === "function") {
      player.pause();
      didSeek = true;
    } else if (player && action === "restart" && typeof player.seek === "function") {
      player.seek(0);
      if (typeof player.play === "function") player.play();
      didSeek = true;
    } else if (player && typeof player.seek === "function") {
      player.seek(nextTime);
      didSeek = true;
    }

    for (const timeline of timelines()) {
      if (action === "play" && typeof timeline.play === "function") {
        timeline.play();
      } else if (action === "pause" && typeof timeline.pause === "function") {
        timeline.pause();
      } else if (action === "restart" && typeof timeline.restart === "function") {
        timeline.restart();
      } else {
        if (typeof timeline.pause === "function") timeline.pause();
        timeline.seek(nextTime);
      }
      didSeek = true;
    }

    if ((didSeek || attempts >= 30) && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };

  window.addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.source !== "studio-boom-preview") return;
    controlPreview(data.action, Number.isFinite(data.seekTime) ? data.seekTime : seekTime);
  });

  window.addEventListener("load", () => controlPreview("seek"));
  timer = window.setInterval(() => controlPreview("seek"), 100);
  window.setTimeout(() => controlPreview("seek"), 0);
})();
</script>`;

  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${script}</body>`);
  return `${html}\n${script}`;
}
