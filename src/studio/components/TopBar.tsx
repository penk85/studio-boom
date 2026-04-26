// Top bar — project name, render hint, soon-to-come export.
import { Link } from "@tanstack/react-router";
import { Save } from "lucide-react";
import { useState } from "react";
import { useStudio } from "../store";

export function TopBar() {
  const project = useStudio((s) => s.project);
  const saveProject = useStudio((s) => s.saveProject);
  const [saved, setSaved] = useState(false);
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
      <Link
        to="/presets"
        className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-panel-2 hover:text-foreground"
      >
        Presets
      </Link>
      <button
        onClick={saveNow}
        className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-panel-2 hover:text-foreground"
        title="Save project state locally"
      >
        <Save size={13} />
        {saved ? "Saved" : "Save"}
      </button>
      <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          {project.width}×{project.height}
        </span>
        <span>·</span>
        <span>{project.fps}fps</span>
        <span>·</span>
        <span>{project.duration}s</span>
        <button
          disabled
          title="Hyperframes export coming in the next phase"
          className="ml-3 cursor-not-allowed rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground opacity-60"
        >
          Export Hyperframes ▼
        </button>
      </div>
    </header>
  );
}
