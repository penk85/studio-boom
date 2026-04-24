import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Studio } from "@/studio/Studio";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Hyperframes Studio — Visual Movie Builder" },
      {
        name: "description",
        content:
          "Drag-and-drop movie studio for Hyperframes. Build scenes with reusable puppet characters, movement presets, and automatic lip sync — all in your browser.",
      },
      { property: "og:title", content: "Hyperframes Studio — Visual Movie Builder" },
      {
        property: "og:description",
        content:
          "Toon Boom–style studio for Hyperframes: characters, movements, lip sync, and one-click project export.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  // Studio uses IndexedDB and DOM measurement; render only after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <h1 className="sr-only">Hyperframes Studio</h1>
        Loading studio…
      </main>
    );
  }
  return <Studio />;
}
