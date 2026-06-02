// Top bar — project name, MP4 download action, save.
import { AlertCircle, CheckCircle2, FolderOpen, Loader2, Redo2, Save, Undo2 } from "lucide-react";
import { useState } from "react";
import { useStudio } from "../store";
import { renderProjectToMp4 } from "../export/render-client";

interface TopBarProps {
  onBackToProjects?: () => void;
}

export function TopBar({ onBackToProjects }: TopBarProps) {
  const project = useStudio((s) => s.project);
  const saveProject = useStudio((s) => s.saveProject);
  const undo = useStudio((s) => s.undo);
  const redo = useStudio((s) => s.redo);
  const canUndo = useStudio((s) => s.historyPast.length > 0);
  const canRedo = useStudio((s) => s.historyFuture.length > 0);
  const saveStatus = useStudio((s) => s.saveStatus);
  const saveError = useStudio((s) => s.saveError);
  const lastSavedAt = useStudio((s) => s.lastSavedAt);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  if (!project) return null;

  const saveNow = async () => {
    await saveProject();
  };

  return (
    <header className="flex items-center gap-3 border-b border-border bg-panel px-4 py-2">
      <div className="flex items-center gap-2">
        <div
          className="h-7 w-7 rounded-md"
          style={{ background: "var(--gradient-primary)" }}
          aria-hidden
        />
        <div className="font-semibold tracking-tight text-foreground">Hyperframes Studio</div>
      </div>
      {onBackToProjects && (
        <button
          type="button"
          onClick={onBackToProjects}
          className="rounded border border-border p-1.5 text-muted-foreground hover:bg-panel-2 hover:text-foreground"
          title="Projects"
          aria-label="Projects"
        >
          <FolderOpen size={14} />
        </button>
      )}
      <input
        value={project.name}
        onChange={(e) => useStudio.getState().setProjectMeta({ name: e.target.value })}
        className="ml-4 max-w-xs flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-sm text-foreground hover:border-border focus:border-primary focus:outline-none"
        aria-label="Project name"
      />
      <button
        onClick={() => useStudio.getState().openModal({ type: "presets" })}
        className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-panel-2 hover:text-foreground"
      >
        Motion presets
      </button>
      <button
        type="button"
        onClick={undo}
        disabled={!canUndo}
        className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-panel-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        title="Undo"
        aria-label="Undo"
      >
        <Undo2 size={13} />
        Undo
      </button>
      <button
        type="button"
        onClick={redo}
        disabled={!canRedo}
        className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-panel-2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        title="Redo"
        aria-label="Redo"
      >
        <Redo2 size={13} />
        Redo
      </button>
      <button
        onClick={saveNow}
        disabled={saveStatus === "saving"}
        className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-panel-2 hover:text-foreground"
        title={saveError ?? "Save project state locally"}
      >
        {saveStatus === "saving" ? (
          <Loader2 className="animate-spin" size={13} />
        ) : (
          <Save size={13} />
        )}
        {saveStatus === "saving" ? "Saving" : "Save"}
      </button>
      <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        <SaveStatusIndicator status={saveStatus} error={saveError} lastSavedAt={lastSavedAt} />
        {renderError && (
          <span className="max-w-[360px] truncate text-destructive" title={renderError}>
            {renderError}
          </span>
        )}
        <span>
          {project.hf.width}×{project.hf.height}
        </span>
        <span>·</span>
        <span>{project.hf.fps}fps</span>
        <span>·</span>
        <span>{project.hf.duration}s</span>
        <button
          disabled={rendering}
          title={rendering ? "Rendering…" : "Download MP4 with HyperFrames"}
          className="ml-3 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={async () => {
            setRendering(true);
            setRenderError(null);
            try {
              await saveProject();
              await renderProjectToMp4(project);
            } catch (error) {
              setRenderError(error instanceof Error ? error.message : String(error));
            } finally {
              setRendering(false);
            }
          }}
        >
          {rendering ? "Rendering…" : "Download MP4"}
        </button>
      </div>
    </header>
  );
}

function SaveStatusIndicator({
  status,
  error,
  lastSavedAt,
}: {
  status: "saved" | "saving" | "error";
  error: string | null;
  lastSavedAt: number | null;
}) {
  if (status === "saving") {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Loader2 className="animate-spin" size={13} />
        Saving
      </span>
    );
  }

  if (status === "error") {
    return (
      <span
        className="inline-flex max-w-[240px] items-center gap-1 truncate text-destructive"
        title={error ?? undefined}
      >
        <AlertCircle size={13} />
        Save failed
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 text-muted-foreground"
      title={formatSavedTime(lastSavedAt)}
    >
      <CheckCircle2 size={13} />
      Saved
    </span>
  );
}

function formatSavedTime(timestamp: number | null): string | undefined {
  if (!timestamp) return undefined;
  return `Saved ${new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp))}`;
}
