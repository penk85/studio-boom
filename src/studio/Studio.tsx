// The studio shell — three-pane layout with a timeline at the bottom.
import { useEffect } from "react";
import { db } from "./db";
import { useStudio } from "./store";
import { Library } from "./components/Library";
import { Stage } from "./components/Stage";
import { Inspector } from "./components/Inspector";
import { Timeline } from "./components/Timeline";
import { TopBar } from "./components/TopBar";

export function Studio() {
  const project = useStudio((s) => s.project);

  useEffect(() => {
    // Load most-recent project, or create a new one.
    (async () => {
      const recent = await db.projects.orderBy("updatedAt").reverse().first();
      if (recent) await useStudio.getState().loadProject(recent.id);
      else await useStudio.getState().newProject();
    })();
  }, []);

  if (!project) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-muted-foreground">
        Loading studio…
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 border-r border-border">
          <Library />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <Stage />
          </div>
          <div className="h-72 shrink-0 border-t border-border">
            <Timeline />
          </div>
        </main>
        <aside className="w-72 shrink-0 border-l border-border">
          <Inspector />
        </aside>
      </div>
    </div>
  );
}
