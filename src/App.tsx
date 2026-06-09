import { useEffect, useState } from "react";
import { Studio } from "@/studio/Studio";
import { CharacterEditor } from "@/studio/character/CharacterEditor";
import { PresetsModal } from "./PresetsModal";
import { useStudio } from "@/studio/store";
import { ProjectDashboard } from "@/studio/components/ProjectDashboard";
import { garbageCollectUnusedInternalMedia } from "@/studio/db";
import { useTheme } from "@/studio/theme";

type AppView = "dashboard" | "studio";

export default function App() {
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<AppView>("dashboard");
  const modal = useStudio((s) => s.currentModal);
  const closeModal = useStudio((s) => s.closeModal);
  const saveProject = useStudio((s) => s.saveProject);
  // Reading the store here applies the persisted [data-theme] app-wide,
  // including on the dashboard before the studio (and its TopBar) mounts.
  const setTheme = useTheme((s) => s.setTheme);
  const theme = useTheme((s) => s.theme);

  useEffect(() => {
    setMounted(true);
    setTheme(theme);
    void garbageCollectUnusedInternalMedia();
  }, [setTheme, theme]);

  const openProject = async (projectId: string) => {
    await useStudio.getState().loadProject(projectId);
    setView("studio");
  };

  const createBlankProject = async () => {
    await useStudio.getState().newProject();
    setView("studio");
  };

  const openDashboard = async () => {
    await saveProject();
    setView("dashboard");
  };

  if (!mounted) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <h1 className="sr-only">Hyperframes Studio</h1>
        Loading studio…
      </main>
    );
  }

  return (
    <>
      {view === "dashboard" ? (
        <ProjectDashboard onCreateBlankProject={createBlankProject} onOpenProject={openProject} />
      ) : (
        <Studio onBackToProjects={openDashboard} />
      )}
      {modal?.type === "character-editor" && (
        <div className="fixed inset-0 z-50">
          <CharacterEditor characterId={modal.characterId} onClose={closeModal} />
        </div>
      )}
      {modal?.type === "presets" && <PresetsModal onClose={closeModal} />}
    </>
  );
}
