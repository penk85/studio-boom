// What a Library entry is, and how it becomes a clip.
//
// Adding from the Library used to be button-only, and each tab built its own
// clip inline — so a media clip, a text clip and a character clip each landed at
// a hardcoded centre with `start: 0`, ignoring where the user was looking or when
// the playhead was. Drag and drop needs the same construction from a drop point,
// so the shapes and the placement rules live here and both paths share them.
import type { CharacterPreset, CompositionClip, EditorClip, MediaAsset, TextClip } from "./types";
import { defaultPoseForCharacter } from "./character/pose-presets";

/** Custom MIME type so a Library drag is distinguishable from a file or text drop. */
export const LIBRARY_DRAG_MIME = "application/x-studio-boom-library-item";

export type LibraryDragItem =
  | { kind: "media"; mediaId: string }
  | { kind: "text"; presetId: TextBlockId }
  | { kind: "character"; characterId: string };

/** Where a dropped or clicked item should land. Anything omitted gets a default. */
export interface ClipPlacement {
  /** Film time the clip starts at. Defaults to 0. */
  start?: number;
  trackIndex?: number;
  laneIndex?: number;
  /** Centre point in project coordinates. Defaults to the canvas centre. */
  center?: { x: number; y: number };
}

export function writeLibraryDragItem(dataTransfer: DataTransfer, item: LibraryDragItem): void {
  dataTransfer.setData(LIBRARY_DRAG_MIME, JSON.stringify(item));
  dataTransfer.effectAllowed = "copy";
}

export function readLibraryDragItem(dataTransfer: DataTransfer): LibraryDragItem | null {
  const raw = dataTransfer.getData(LIBRARY_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LibraryDragItem;
    if (parsed?.kind === "media" && typeof parsed.mediaId === "string") return parsed;
    if (parsed?.kind === "text" && typeof parsed.presetId === "string") return parsed;
    if (parsed?.kind === "character" && typeof parsed.characterId === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

/** True when a drag carries a Library item, so drop targets can show feedback. */
export function hasLibraryDragItem(dataTransfer: DataTransfer | null): boolean {
  return dataTransfer?.types?.includes(LIBRARY_DRAG_MIME) ?? false;
}

export const TEXT_BLOCKS = [
  {
    id: "title",
    label: "Title",
    content: "Add a title",
    widthFactor: 0.62,
    heightFactor: 0.16,
    yFactor: 0.18,
    fontSize: 88,
    fontWeight: 800,
  },
  {
    id: "caption",
    label: "Caption",
    content: "Add caption text",
    widthFactor: 0.54,
    heightFactor: 0.1,
    yFactor: 0.78,
    fontSize: 42,
    fontWeight: 600,
  },
  {
    id: "lower-third",
    label: "Lower third",
    content: "Speaker name",
    widthFactor: 0.38,
    heightFactor: 0.11,
    yFactor: 0.68,
    fontSize: 38,
    fontWeight: 700,
  },
] as const;

export type TextBlock = (typeof TEXT_BLOCKS)[number];
export type TextBlockId = TextBlock["id"];

export function findTextBlock(id: string): TextBlock | undefined {
  return TEXT_BLOCKS.find((block) => block.id === id);
}

interface StageSize {
  width: number;
  height: number;
}

/**
 * Top-left corner for a clip of this size, from a requested centre. Clamped so a
 * drop near an edge still lands fully on the canvas instead of half off-screen.
 */
export function topLeftFromCenter(
  center: { x: number; y: number } | undefined,
  size: { width: number; height: number },
  stage: StageSize,
  fallbackTop?: number,
): { x: number; y: number } {
  if (!center) {
    return {
      x: Math.round((stage.width - size.width) / 2),
      y: Math.round(fallbackTop ?? (stage.height - size.height) / 2),
    };
  }
  const maxX = Math.max(0, stage.width - size.width);
  const maxY = Math.max(0, stage.height - size.height);
  return {
    x: Math.round(Math.min(maxX, Math.max(0, center.x - size.width / 2))),
    y: Math.round(Math.min(maxY, Math.max(0, center.y - size.height / 2))),
  };
}

export function buildTextClip(args: {
  id: string;
  block: TextBlock;
  stage: StageSize;
  placement: ClipPlacement;
  trackIndex: number;
  zIndex: number;
}): TextClip {
  const { block, stage, placement } = args;
  const width = Math.round(stage.width * block.widthFactor);
  const height = Math.round(stage.height * block.heightFactor);
  const { x, y } = topLeftFromCenter(
    placement.center,
    { width, height },
    stage,
    stage.height * block.yFactor,
  );
  return {
    id: args.id,
    kind: "text",
    name: block.label,
    content: block.content,
    trackIndex: args.trackIndex,
    laneIndex: placement.laneIndex,
    start: Math.max(0, placement.start ?? 0),
    duration: 4,
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    zIndex: args.zIndex,
    color: "#111827",
    fontSize: block.fontSize,
    fontFamily: "Inter",
    fontWeight: block.fontWeight,
    fitToBounds: false,
  };
}

/** Fits a character to a comfortable share of the canvas without distorting it. */
export function characterClipSize(
  character: Pick<CharacterPreset, "canvasWidth" | "canvasHeight">,
  stage: StageSize,
): { width: number; height: number } {
  const aspect = character.canvasWidth / Math.max(1, character.canvasHeight);
  const maxW = Math.round(stage.width * 0.42);
  const maxH = Math.round(stage.height * 0.68);
  let height = maxH;
  let width = Math.round(height * aspect);
  if (width > maxW) {
    width = maxW;
    height = Math.round(width / Math.max(0.1, aspect));
  }
  return { width, height };
}

export function buildCharacterClip(args: {
  id: string;
  character: CharacterPreset;
  stage: StageSize;
  placement: ClipPlacement;
  trackIndex: number;
  zIndex: number;
}): CompositionClip {
  const { character, stage, placement } = args;
  const size = characterClipSize(character, stage);
  const { x, y } = topLeftFromCenter(placement.center, size, stage);
  return {
    id: args.id,
    kind: "composition",
    compositionKind: "character",
    character: {
      characterId: character.id,
      // Characters start in their default pose — a non-pose doesn't make sense.
      poses: defaultPoseForCharacter(character),
      autoBlink: true,
    },
    name: character.name,
    trackIndex: args.trackIndex,
    laneIndex: placement.laneIndex,
    start: Math.max(0, placement.start ?? 0),
    duration: 4,
    x,
    y,
    width: size.width,
    height: size.height,
    rotation: 0,
    opacity: 1,
    zIndex: args.zIndex,
  };
}

/** Media keeps its natural size, scaled down to fit the canvas. Audio has no box. */
export function mediaClipSize(
  asset: Pick<MediaAsset, "kind" | "width" | "height">,
  stage: StageSize,
): { width: number; height: number } {
  if (asset.kind === "audio") return { width: 0, height: 0 };
  let width = asset.width || stage.width;
  let height = asset.height || stage.height;
  if (width > stage.width || height > stage.height) {
    const ratio = Math.min(stage.width / width, stage.height / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }
  return { width, height };
}

/** Highest z-index among visual clips, so a new clip lands on top. */
export function nextVisualZIndex(clips: EditorClip[]): number {
  return clips.filter((clip) => clip.kind !== "audio").length;
}
