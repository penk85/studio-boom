import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CharacterEditor } from "@/studio/character/CharacterEditor";

export const Route = createFileRoute("/character/$id")({
  head: ({ params }) => ({
    meta: [{ title: `Character — Hyperframes Studio` }, { name: "description", content: `Edit character ${params.id}` }],
  }),
  component: CharacterRoute,
});

function CharacterRoute() {
  const { id } = Route.useParams();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">Loading…</div>;
  return <CharacterEditor characterId={id} />;
}
