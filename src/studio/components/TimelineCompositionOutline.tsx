// Expanded nested-composition rows shown beneath a parent timeline clip.
import type { CompositionOutlineItem } from "../hyperframes/composition-outline";
import type { EditorClip } from "../types";
import type { ProjectTimelineClip } from "../scenes";
import {
  COMPOSITION_OUTLINE_PARENT_HEIGHT,
  COMPOSITION_OUTLINE_ROW_HEIGHT,
} from "./timeline-constants";
import { compositionOutlineLaneHeight } from "./timeline-layout";
import { formatTimelineSeconds } from "./timeline-display";

export function CompositionOutlineHeader({
  clip,
  outline,
}: {
  clip: EditorClip;
  outline: CompositionOutlineItem[];
}) {
  return (
    <div
      style={{ height: compositionOutlineLaneHeight(outline) }}
      className="border-t border-border/60 bg-panel/50"
    >
      <div
        className="flex items-center gap-1 px-3 text-ui-sm text-foreground"
        style={{ height: COMPOSITION_OUTLINE_PARENT_HEIGHT }}
      >
        <span className="text-muted-foreground">↳</span>
        <span className="min-w-0 flex-1 truncate">{clip.name}</span>
        <span className="shrink-0 text-muted-foreground">{outline.length}</span>
      </div>
      {outline.map((item) => (
        <div
          key={item.id}
          style={{ height: COMPOSITION_OUTLINE_ROW_HEIGHT, paddingLeft: 24 + item.depth * 10 }}
          className="flex items-center gap-1 border-t border-border/40 pr-3 text-ui-sm text-muted-foreground"
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${outlineDotColor(item.kind)}`} />
          <span className="min-w-0 flex-1 truncate">{item.name}</span>
          <span className="shrink-0 uppercase tracking-[0.08em] text-muted-foreground/70">
            {item.timed ? item.kind : "layer"}
          </span>
        </div>
      ))}
    </div>
  );
}

export function CompositionOutlineLaneSet({
  clip,
  outline,
  zoom,
  top,
  onSelect,
}: {
  clip: ProjectTimelineClip;
  outline: CompositionOutlineItem[];
  zoom: number;
  top: number;
  onSelect: () => void;
}) {
  return (
    <div
      className="absolute left-0 right-0 border-t border-border/60 bg-panel/25"
      style={{ top, height: compositionOutlineLaneHeight(outline) }}
    >
      <div
        className="absolute rounded border border-primary/20 bg-primary/5"
        style={{
          left: clip.start * zoom,
          top: COMPOSITION_OUTLINE_PARENT_HEIGHT + 3,
          width: Math.max(8, clip.duration * zoom),
          bottom: 3,
        }}
      />
      {outline.map((item, index) => (
        <button
          key={item.id}
          type="button"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
          className={`absolute h-5 overflow-hidden rounded border px-1.5 text-left text-ui-sm text-foreground/90 shadow-sm ${outlineBlockColor(
            item.kind,
          )}`}
          style={{
            left: (clip.start + (item.timed ? item.start : 0)) * zoom,
            top: COMPOSITION_OUTLINE_PARENT_HEIGHT + index * COMPOSITION_OUTLINE_ROW_HEIGHT + 3,
            width: Math.max(12, (item.timed ? item.duration : clip.duration) * zoom),
          }}
          title={`${item.name} (${
            item.timed
              ? `${formatTimelineSeconds(item.start)}-${formatTimelineSeconds(
                  item.start + item.duration,
                )}`
              : "DOM layer"
          })`}
          aria-label={`Select parent composition for ${item.name}`}
        >
          <span className="block truncate leading-5">{item.name}</span>
        </button>
      ))}
    </div>
  );
}

function outlineDotColor(kind: CompositionOutlineItem["kind"]): string {
  switch (kind) {
    case "audio":
      return "bg-clip-audio";
    case "composition":
      return "bg-indigo-300";
    case "image":
      return "bg-clip-bg";
    case "text":
      return "bg-fuchsia-300";
    case "video":
      return "bg-clip";
    case "layer":
    default:
      return "bg-slate-400";
  }
}

function outlineBlockColor(kind: CompositionOutlineItem["kind"]): string {
  switch (kind) {
    case "audio":
      return "border-cyan-300/70 bg-cyan-500/45";
    case "composition":
      return "border-indigo-300/70 bg-indigo-500/45";
    case "image":
      return "border-emerald-300/70 bg-emerald-500/45";
    case "text":
      return "border-fuchsia-300/70 bg-fuchsia-500/45";
    case "video":
      return "border-purple-300/70 bg-purple-500/45";
    case "layer":
    default:
      return "border-slate-300/60 bg-slate-500/35";
  }
}
