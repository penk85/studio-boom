import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const editorPath = join(process.cwd(), "src/studio/character/CharacterEditor.tsx");

describe("CharacterEditor source integration", () => {
  it("works in Build / Rig / Pose phases with the legacy panels removed", () => {
    const source = readFileSync(editorPath, "utf8");

    // Phase scaffold: one switch drives panels, overlays, and the pose toolbar.
    expect(source).toContain('useState<"build" | "rig" | "pose">');
    expect(source).toContain("const switchPhase");
    expect(source).toContain('{editorPhase === "pose" && (');
    expect(source).toContain('{editorPhase === "build" && (');
    expect(source).toContain('{editorPhase === "rig" && (');

    // Removed legacy surfaces: AI rig paste panel, raw JSON export, prompt generator.
    expect(source).not.toContain("RigAssistant");
    expect(source).not.toContain("characterRigPrompt");
    expect(source).not.toContain("exportData");
    // Reset escape hatch survives, with a two-step confirm instead of a native dialog.
    expect(source).toContain("Reset skeleton to default");
    expect(source).toContain("function ConfirmButton");
    expect(source).not.toContain("window.confirm");
    expect(source).not.toContain("window.prompt");
  });

  it("explains every armed mode through the single ModeBanner", () => {
    const source = readFileSync(editorPath, "utf8");
    expect(source).toContain("const modeBanner");
    // All four armed modes feed the banner.
    expect(source).toContain("if (anchorDrag)");
    expect(source).toContain("if (socketPlacement)");
    expect(source).toContain("if (rangeEdit)");
    expect(source).toContain('if (mode === "pivot")');
    // Esc backs out; toasts auto-dismiss; destructive toasts offer Undo.
    expect(source).toContain('e.key === "Escape"');
    expect(source).toContain("setStatusUndoable");
    expect(source).toContain("undoCharacterHistory();");
  });

  it("keeps the effortless layer wired", () => {
    const source = readFileSync(editorPath, "utf8");
    // Autosave honesty: Done button + live save indicator.
    expect(source).toContain('useState<"saved" | "saving">');
    expect(source).toContain("✓ Saved");
    // Hover identification, breadcrumbs, and thumbnails.
    expect(source).toContain("handleCanvasHover");
    expect(source).toContain("Select the whole layer group");
    expect(source).toContain("function VariantGridButton");
  });
});
