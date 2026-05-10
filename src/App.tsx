import { useEffect, useState } from "react";
import { Studio } from "@/studio/Studio";
import { CharacterEditor } from "@/studio/character/CharacterEditor";
import { PresetsModal } from "./PresetsModal";
import { useStudio } from "@/studio/store";

export default function App() {
  const [mounted, setMounted] = useState(false);
  const modal = useStudio((s) => s.currentModal);
  const closeModal = useStudio((s) => s.closeModal);

  useEffect(() => setMounted(true), []);

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
      <Studio />
      {modal?.type === "character-editor" && (
        <div className="fixed inset-0 z-50">
          <CharacterEditor characterId={modal.characterId} onClose={closeModal} />
        </div>
      )}
      {modal?.type === "presets" && <PresetsModal onClose={closeModal} />}
    </>
  );
}
