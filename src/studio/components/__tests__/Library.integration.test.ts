import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const libraryPath = join(process.cwd(), "src/studio/components/Library.tsx");
const starterPath = join(process.cwd(), "src/studio/character/starter.ts");

describe("Library integration", () => {
  it("does not expose the retired pasted composition block workflow", () => {
    const librarySource = readFileSync(libraryPath, "utf8");

    expect(librarySource).not.toContain("BlocksTab");
    expect(librarySource).not.toContain('id: "blocks"');
    expect(librarySource).not.toContain("validateCompositionSourceHtml");
    expect(librarySource).not.toContain("HyperFramesPreviewPanel");
    expect(librarySource).not.toContain("SourceTrustConfirmation");
    expect(librarySource).not.toContain("Advanced: paste a block");
  });

  it("places the seeded starter character through the registered character preset", () => {
    const librarySource = readFileSync(libraryPath, "utf8");
    const starterSource = readFileSync(starterPath, "utf8");

    expect(starterSource).toContain(
      'export const STARTER_CHARACTER_ID = "builtin-starter-character"',
    );
    expect(librarySource).toContain("ensureStarterCharacterSeeded");
    // Registration moved inside placeOnTimeline, which every character path uses.
    expect(librarySource).toContain("registerCharacterPreset(character)");
    expect(librarySource).toContain("const starter =");
    expect(librarySource).toContain("placeOnTimeline(starter)");
    expect(librarySource).not.toContain('placeOnTimeline("stub"');
  });

  it("adds every library item through one placement path that drag and drop shares", () => {
    const librarySource = readFileSync(libraryPath, "utf8");
    const itemsSource = readFileSync(join(process.cwd(), "src/studio/library-items.ts"), "utf8");
    const stageSource = readFileSync(
      join(process.cwd(), "src/studio/components/Stage.tsx"),
      "utf8",
    );
    const timelineSource = readFileSync(
      join(process.cwd(), "src/studio/components/Timeline.tsx"),
      "utf8",
    );

    // Media, text and character clips used to be built inline per tab, each
    // hardcoding a centred position and start: 0. One builder now serves the
    // Library buttons and both drop targets, so a dropped clip and a clicked
    // clip are constructed identically.
    expect(itemsSource).toContain("export function buildTextClip");
    expect(itemsSource).toContain("export function buildCharacterClip");
    expect(itemsSource).toContain("export function topLeftFromCenter");
    expect(librarySource).toContain('addLibraryItem({ kind: "text"');
    expect(librarySource).toContain('addLibraryItem({ kind: "media"');
    expect(librarySource).toContain('addLibraryItem({ kind: "character"');
    expect(librarySource).toContain("writeLibraryDragItem");

    // Stage drop: position from the drop point, start from the playhead.
    expect(stageSource).toContain("clientPointToComposition(event.clientX, event.clientY");
    expect(stageSource).toContain("start: usePlayerStore.getState().currentTime");
    // Timeline drop: start from the drop x, track/lane from where it landed.
    expect(timelineSource).toContain("dropLibraryItemOnTrack");
    expect(timelineSource).toContain("nearestLaneIndex(laneTops, event.clientY - rect.top)");
  });
});
