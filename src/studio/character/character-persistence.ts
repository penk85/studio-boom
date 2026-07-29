// Character persistence boundary for normalized saves and reusable character records.
import { db, deleteMediaIfUnused, mediaIdsForCharacter } from "../db";
import type { CharacterPreset } from "../types";
import { normalizeCharacterSlots } from "./character-utils";

export async function loadCharacter(characterId: string): Promise<CharacterPreset | undefined> {
  return db.characters.get(characterId);
}

/** Persist a normalized character and remove superseded internal artwork. */
export async function saveCharacter(character: CharacterPreset): Promise<CharacterPreset> {
  const updated = { ...normalizeCharacterSlots(character), updatedAt: Date.now() };
  const previous = await db.characters.get(updated.id);
  await db.characters.put(updated);
  const nextMediaIds = mediaIdsForCharacter(updated);
  const removedMediaIds = Array.from(mediaIdsForCharacter(previous)).filter(
    (id) => !nextMediaIds.has(id),
  );
  await Promise.all(removedMediaIds.map((id) => deleteMediaIfUnused(id, { internalOnly: true })));
  return updated;
}

/** Delete a character record and return its internal artwork ids for reference cleanup. */
export async function deleteCharacterRecord(characterId: string): Promise<Set<string>> {
  const character = await db.characters.get(characterId);
  await db.characters.delete(characterId);
  return mediaIdsForCharacter(character);
}
