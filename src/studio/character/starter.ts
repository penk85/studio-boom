import { db, importMediaFile } from "../db";
import type { CharacterPreset, MouthViseme } from "../types";
import { createBlankCharacter, makePart } from "./character-utils";

const STARTER_ID = "builtin-starter-character";
const CANVAS_W = 600;
const CANVAS_H = 900;

export async function ensureStarterCharacterSeeded() {
  const existing = await db.characters.get(STARTER_ID);
  if (existing) return existing;

  const partFile = (name: string, body: string) =>
    new File(
      [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}">${body}</svg>`,
      ],
      `${name}.svg`,
      { type: "image/svg+xml" },
    );

  const importPart = (name: string, body: string) =>
    importMediaFile(partFile(name, body), { scope: "character-part" });

  const [
    body,
    head,
    eyesOpen,
    eyesClosed,
    brows,
    mouthRest,
    mouthAi,
    mouthE,
    mouthO,
    mouthU,
    mouthMbp,
    mouthFv,
    mouthL,
  ] = await Promise.all([
    importPart(
      "starter-body",
      `<path d="M236 338c12 36 116 36 128 0l48 24c54 27 85 83 85 144v235c0 25-20 45-45 45H148c-25 0-45-20-45-45V506c0-61 31-117 85-144l48-24Z" fill="#5cc8a3"/>
       <path d="M254 315h92v74c0 27-92 27-92 0v-74Z" fill="#f3b995"/>
       <path d="M127 504c-52 84-58 167-17 250" fill="none" stroke="#439b82" stroke-width="56" stroke-linecap="round"/>
       <path d="M473 504c52 84 58 167 17 250" fill="none" stroke="#439b82" stroke-width="56" stroke-linecap="round"/>
       <path d="M224 784c-22 31-34 66-36 104" fill="none" stroke="#35796e" stroke-width="58" stroke-linecap="round"/>
       <path d="M376 784c22 31 34 66 36 104" fill="none" stroke="#35796e" stroke-width="58" stroke-linecap="round"/>`,
    ),
    importPart(
      "starter-head",
      `<ellipse cx="300" cy="246" rx="128" ry="142" fill="#f5c2a3"/>
       <path d="M174 236c3-83 55-140 126-140 72 0 124 52 128 136-37-23-76-31-118-24-48 8-88 22-136 28Z" fill="#393341"/>
       <path d="M199 225c31-39 77-59 139-58-27 18-55 30-85 36-21 4-39 11-54 22Z" fill="#2f2a36"/>
       <circle cx="177" cy="255" r="25" fill="#f5c2a3"/>
       <circle cx="423" cy="255" r="25" fill="#f5c2a3"/>
       <path d="M292 287c-5 18-8 33-2 42 5 7 17 6 25 2" fill="none" stroke="#d58d76" stroke-width="6" stroke-linecap="round"/>`,
    ),
    importPart(
      "starter-eyes-open",
      `<ellipse cx="252" cy="250" rx="28" ry="19" fill="#fff"/>
       <ellipse cx="348" cy="250" rx="28" ry="19" fill="#fff"/>
       <circle cx="257" cy="252" r="10" fill="#242735"/>
       <circle cx="353" cy="252" r="10" fill="#242735"/>`,
    ),
    importPart(
      "starter-eyes-closed",
      `<path d="M224 253c18 14 39 14 57 0" fill="none" stroke="#242735" stroke-width="8" stroke-linecap="round"/>
       <path d="M320 253c18 14 39 14 57 0" fill="none" stroke="#242735" stroke-width="8" stroke-linecap="round"/>`,
    ),
    importPart(
      "starter-brows",
      `<path d="M219 216c23-13 45-14 66-4" fill="none" stroke="#393341" stroke-width="10" stroke-linecap="round"/>
       <path d="M315 212c22-10 45-9 66 4" fill="none" stroke="#393341" stroke-width="10" stroke-linecap="round"/>`,
    ),
    importPart(
      "starter-mouth-rest",
      `<path d="M270 363c20 9 41 9 62 0" fill="none" stroke="#733f43" stroke-width="8" stroke-linecap="round"/>`,
    ),
    importPart(
      "starter-mouth-ai",
      `<ellipse cx="300" cy="362" rx="29" ry="31" fill="#733f43"/><ellipse cx="300" cy="376" rx="17" ry="10" fill="#e87f89"/>`,
    ),
    importPart(
      "starter-mouth-e",
      `<path d="M264 358c24 23 51 23 75 0 0 30-75 30-75 0Z" fill="#733f43"/><rect x="278" y="360" width="44" height="9" rx="3" fill="#fff"/>`,
    ),
    importPart("starter-mouth-o", `<ellipse cx="300" cy="362" rx="22" ry="26" fill="#733f43"/>`),
    importPart(
      "starter-mouth-u",
      `<path d="M276 355c15 24 33 24 48 0 10 30-58 30-48 0Z" fill="#733f43"/>`,
    ),
    importPart(
      "starter-mouth-mbp",
      `<path d="M263 361c25-12 49-12 74 0-24 13-50 13-74 0Z" fill="#733f43"/>`,
    ),
    importPart(
      "starter-mouth-fv",
      `<path d="M268 355c22 18 43 18 64 0 0 22-64 22-64 0Z" fill="#733f43"/><rect x="276" y="355" width="48" height="9" rx="3" fill="#fff"/>`,
    ),
    importPart(
      "starter-mouth-l",
      `<path d="M276 356c16 24 32 24 48 0v24c-16 14-32 14-48 0v-24Z" fill="#733f43"/><path d="M288 374c9-10 16-10 24 0" fill="none" stroke="#e87f89" stroke-width="9" stroke-linecap="round"/>`,
    ),
  ]);

  const fullCanvas = {
    x: 0,
    y: 0,
    width: CANVAS_W,
    height: CANVAS_H,
  };

  const mouthPart = (mediaId: string, viseme: MouthViseme) =>
    makePart("mouth", mediaId, {
      ...fullCanvas,
      name: `Mouth ${viseme}`,
      viseme,
      zIndex: 50,
    });

  const now = Date.now();
  const character: CharacterPreset = {
    ...createBlankCharacter("Starter Actor"),
    id: STARTER_ID,
    canvasWidth: CANVAS_W,
    canvasHeight: CANVAS_H,
    parts: [
      makePart("body", body.id, { ...fullCanvas, name: "Body front", pose: "front", zIndex: 10 }),
      makePart("head", head.id, { ...fullCanvas, name: "Head front", zIndex: 30 }),
      makePart("eye", eyesOpen.id, {
        ...fullCanvas,
        name: "Eyes open",
        eyeState: "open",
        zIndex: 40,
      }),
      makePart("eye", eyesClosed.id, {
        ...fullCanvas,
        name: "Eyes closed",
        eyeState: "closed",
        zIndex: 40,
      }),
      makePart("brow", brows.id, { ...fullCanvas, name: "Brows neutral", zIndex: 45 }),
      mouthPart(mouthRest.id, "rest"),
      mouthPart(mouthAi.id, "AI"),
      mouthPart(mouthE.id, "E"),
      mouthPart(mouthO.id, "O"),
      mouthPart(mouthU.id, "U"),
      mouthPart(mouthMbp.id, "MBP"),
      mouthPart(mouthFv.id, "FV"),
      mouthPart(mouthL.id, "L"),
    ],
    createdAt: now,
    updatedAt: now,
  };

  await db.characters.put(character);
  return character;
}
