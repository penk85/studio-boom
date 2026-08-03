// The studio shell — three-pane layout with a timeline at the bottom.
import { useEffect, useState, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useTimelinePlayer } from "@hyperframes/studio";
import { useStudio } from "./store";
import { Library } from "./components/Library";
import { Stage } from "./components/Stage";
import { Inspector } from "./components/Inspector";
import { Timeline } from "./components/Timeline";
import { TopBar } from "./components/TopBar";

interface StudioProps {
  onBackToProjects?: () => void;
}

function usePersistentBoolean(key: string, fallback: boolean) {
  const [value, setValue] = useState<boolean>(() => {
    if (typeof localStorage === "undefined") return fallback;
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === "1";
  });
  const set = (next: boolean) => {
    setValue(next);
    try {
      localStorage.setItem(key, next ? "1" : "0");
    } catch {
      // ignore storage failures
    }
  };
  return [value, set] as const;
}

export function Studio({ onBackToProjects }: StudioProps) {
  const project = useStudio((s) => s.project);
  const undo = useStudio((s) => s.undo);
  const redo = useStudio((s) => s.redo);
  const refreshCharacterCompositions = useStudio((s) => s.refreshCharacterCompositions);
  // useTimelinePlayer owns the single iframeRef that connects the player to
  // PlayerControls and usePlayerStore. Stage bridges this ref to the
  // <hyperframes-player> iframe; Timeline passes togglePlay/seek to PlayerControls.
  const { iframeRef, togglePlay, seek, onIframeLoad } = useTimelinePlayer();
  const [libraryOpen, setLibraryOpen] = usePersistentBoolean("studio-library-open", true);
  const [inspectorOpen, setInspectorOpen] = usePersistentBoolean("studio-inspector-open", true);
  const projectId = project?.id ?? null;

  useEffect(() => {
    if (!projectId) return;
    refreshCharacterCompositions({ history: false });
  }, [projectId, refreshCharacterCompositions]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((!event.metaKey && !event.ctrlKey) || event.altKey) return;
      if (isTextEditingTarget(event.target)) return;

      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [redo, undo]);

  if (!project) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-muted-foreground">
        Loading studio…
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <TopBar
        onBackToProjects={onBackToProjects}
        onOpenProjectSettings={() => {
          // Project settings live in the Inspector's no-selection state, so
          // reveal the rail and clear the selection to land on them.
          setInspectorOpen(true);
          useStudio.getState().selectClip(null);
        }}
      />
      <div className="flex min-h-0 flex-1">
        {libraryOpen && (
          <aside className="w-60 shrink-0 bg-panel">
            <Library />
          </aside>
        )}
        <SidebarRail
          side="left"
          open={libraryOpen}
          label="Library"
          onToggle={() => setLibraryOpen(!libraryOpen)}
        />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="relative min-h-0 flex-1">
            <Stage iframeRef={iframeRef} onIframeLoad={onIframeLoad} />
          </div>
          <div className="h-72 shrink-0 border-t border-border">
            <Timeline togglePlay={togglePlay} seek={seek} />
          </div>
        </main>
        <SidebarRail
          side="right"
          open={inspectorOpen}
          label="Inspector"
          onToggle={() => setInspectorOpen(!inspectorOpen)}
        />
        {inspectorOpen && (
          <aside className="w-72 shrink-0 bg-panel">
            <Inspector seek={seek} />
          </aside>
        )}
      </div>
    </div>
  );
}

function SidebarRail({
  side,
  open,
  label,
  onToggle,
}: {
  side: "left" | "right";
  open: boolean;
  label: string;
  onToggle: () => void;
}): ReactNode {
  const Icon = open
    ? side === "left"
      ? PanelLeftClose
      : PanelRightClose
    : side === "left"
      ? PanelLeftOpen
      : PanelRightOpen;
  const borderClass = side === "left" ? "border-r border-border" : "border-l border-border";
  return (
    <div className={`flex w-7 shrink-0 flex-col items-center bg-panel ${borderClass}`}>
      <button
        type="button"
        onClick={onToggle}
        title={`${open ? "Collapse" : "Expand"} ${label}`}
        aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
        aria-expanded={open}
        className="mt-2 grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-panel-2 hover:text-foreground"
      >
        <Icon size={15} />
      </button>
      {!open && (
        <div className="mt-3 select-none text-[10px] font-medium uppercase tracking-wider text-muted-foreground [writing-mode:vertical-rl]">
          {label}
        </div>
      )}
    </div>
  );
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
