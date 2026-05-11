// Top bar — project name, MP4 download action, save.
import { Save } from "lucide-react";
import { useState } from "react";
import { useStudio } from "../store";
import { renderProjectToMp4 } from "../export/render-client";

export function TopBar() {
  const project = useStudio((s) => s.project);
  const saveProject = useStudio((s) => s.saveProject);
  const [saved, setSaved] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  if (!project) return null;

  const saveNow = async () => {
    await saveProject();
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
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
        onClick={saveNow}
        className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-panel-2 hover:text-foreground"
        title="Save project state locally"
      >
        <Save size={13} />
        {saved ? "Saved" : "Save"}
      </button>
      <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
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
