// The studio shell — three-pane layout with a timeline at the bottom.
import { useEffect } from "react";
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

export function Studio({ onBackToProjects }: StudioProps) {
  const project = useStudio((s) => s.project);
  const undo = useStudio((s) => s.undo);
  const redo = useStudio((s) => s.redo);
  // useTimelinePlayer owns the single iframeRef that connects the player to
  // PlayerControls and usePlayerStore. Stage bridges this ref to the
  // <hyperframes-player> iframe; Timeline passes togglePlay/seek to PlayerControls.
  const { iframeRef, togglePlay, seek, onIframeLoad } = useTimelinePlayer();

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
      <TopBar onBackToProjects={onBackToProjects} />
      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 border-r border-border">
          <Library />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="relative min-h-0 flex-1">
            <Stage iframeRef={iframeRef} onIframeLoad={onIframeLoad} />
          </div>
          <div className="h-72 shrink-0 border-t border-border">
            <Timeline togglePlay={togglePlay} seek={seek} />
          </div>
        </main>
        <aside className="w-72 shrink-0 border-l border-border">
          <Inspector seek={seek} />
        </aside>
      </div>
    </div>
  );
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
