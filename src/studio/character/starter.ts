import { db, deleteMediaIfUnused, importMediaFile, mediaIdsForCharacter, uid } from "../db";
import type { CharacterPreset } from "../types";
import {
  buildPresenterCharacter,
  presenterPartSpecs,
  presenterPartSvg,
  PRESENTER_VERSION,
  type PresenterVariant,
} from "./presenter";

const STARTER_ID = "builtin-starter-character";

/** Up to date when the persisted copy was built by the current generator revision. */
function isCurrentPresenter(character: CharacterPreset): boolean {
  return character.builtinVersion === PRESENTER_VERSION && character.parts.length > 0;
}

/**
 * Generate a fully-rigged presenter `CharacterPreset` for the given id and variant: import one SVG
 * media blob per part spec, then build the character against those media ids. Pure persistence of
 * the art + character record is left to the caller.
 */
async function materializePresetCharacter(
  id: string,
  variant: PresenterVariant,
): Promise<CharacterPreset> {
  const specs = presenterPartSpecs(variant);
  const mediaIdByKey = new Map<string, string>();
  await Promise.all(
    specs.map(async (spec) => {
      const file = new File(
        [presenterPartSvg(spec.svg, spec.frame)],
        `${spec.key.replace(/[:]/g, "-")}.svg`,
        { type: "image/svg+xml" },
      );
      const asset = await importMediaFile(file, { scope: "character-part" });
      mediaIdByKey.set(spec.key, asset.id);
    }),
  );

  return buildPresenterCharacter(id, variant, (k) => {
    const mediaId = mediaIdByKey.get(k);
    if (!mediaId) throw new Error(`Missing seeded media for presenter part "${k}"`);
    return mediaId;
  });
}

/**
 * Seed (or replace) the built-in "Studio Presenter" character: a stylized human presenter rigged
 * across front and two three-quarter angles, with full limbs, face/visemes, hand variants, and
 * pose presets. Replaces an out-of-date persisted copy in place and prunes its orphan art.
 */
export async function ensureStarterCharacterSeeded(): Promise<CharacterPreset> {
  const existing = await db.characters.get(STARTER_ID);
  if (existing && isCurrentPresenter(existing)) return existing;

  const character = await materializePresetCharacter(STARTER_ID, "male");

  const previousMediaIds = mediaIdsForCharacter(existing);
  await db.characters.put(character);

  // Drop the replaced starter's now-unused part art.
  const nextMediaIds = mediaIdsForCharacter(character);
  await Promise.all(
    Array.from(previousMediaIds)
      .filter((id) => !nextMediaIds.has(id))
      .map((id) => deleteMediaIfUnused(id, { internalOnly: true })),
  );

  return character;
}

/**
 * Create a fresh, user-owned preset character (its own id) from the generator — the base for
 * "generate a preset character" in the Characters tab. Persisted to Dexie and returned; the caller
 * registers it with the store and opens the editor.
 */
export async function createPresetCharacter(variant: PresenterVariant): Promise<CharacterPreset> {
  const character = await materializePresetCharacter(uid(), variant);
  await db.characters.put(character);
  return character;
}
