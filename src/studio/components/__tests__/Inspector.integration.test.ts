import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const inspectorPath = join(process.cwd(), "src/studio/components/Inspector.tsx");

describe("Inspector source integration", () => {
  it("shows editable composition source and read-only primitive root source", () => {
    const source = readFileSync(inspectorPath, "utf8");

    expect(source).toContain("<CompositionSourceInspector");
    expect(source).toContain("onApply={(html) => updateCompositionHtml");
    expect(source).toContain("<SourceTrustConfirmation");
    expect(source).toContain('previewStatus === "ready" && sourceTrusted');
    expect(source).toContain("<RootElementSourceInspector");
    expect(source).toContain("readRootElementSource(rootHtml, clip.id)");
    expect(source).toContain("readOnly");
  });

  it("offers project settings in exactly one place — the no-selection state", () => {
    const source = readFileSync(inspectorPath, "utf8");

    expect(source).toContain("<ProjectSettingsPanel project={rootProject} />");
    expect(source.match(/<ProjectSettingsPanel/g)).toHaveLength(1);
    // The clip inspector's "More" tab must not re-offer project-wide settings.
    expect(source).not.toContain("rootProject={rootProject}");
  });

  it("shows move controls for visual clips", () => {
    const source = readFileSync(inspectorPath, "utf8");

    expect(source).toContain("<MoveInspector");
    expect(source).toContain("addClipMotionStep(clip.id, time)");
    expect(source).toContain("addClipMotionCheckpoint(clip.id, motionId, time)");
    expect(source).toContain("updateClipKeyframe");
    expect(source).toContain("moveClipMotionCheckpoint");
    expect(source).toContain("renameClipMotionStep");
    expect(source).toContain("Move name");
    expect(source).toContain("pointTimeForMotion(motion, localPlayheadTime)");
    expect(source).toContain("Point");
    expect(source).toContain("onSeek(checkpoint.time)");
    expect(source).toContain("removeClipMotionCheckpoint");
    expect(source).toContain("removeClipMotionStep");
    expect(source).toContain("sampleClipKeyframedState(clip, localPlayheadTime)");
  });

  it("keeps character speech controls in a dedicated inspector tab", () => {
    const source = readFileSync(inspectorPath, "utf8");

    expect(source).toContain(
      'type InspectorTab = "clip" | "speech" | "move" | "acting" | "advanced"',
    );
    expect(source).toContain('label: "Speech"');
    expect(source).toContain('activeTab === "speech"');
    expect(source).toContain("<VoiceLipSyncPanel");
    expect(source).not.toContain(
      "{character && <MotionPanel clip={characterClip} character={character} />}\n      <VoiceLipSyncPanel",
    );
  });

  it("separates canvas movement from character performance", () => {
    const source = readFileSync(inspectorPath, "utf8");

    // "Motion" used to name both moving a clip around the canvas and a
    // character's body/face animation. Move and Acting are now distinct tabs.
    expect(source).toContain('label: "Move"');
    expect(source).toContain('label: "Acting"');
    expect(source).toContain('activeTab === "move" && clip.kind !== "audio"');
    expect(source).toContain('activeTab === "acting" && characterClip');
    expect(source).toContain("<ActingInspectorTab");
    expect(source).not.toContain('label: "Motion"');
  });

  it("commits text content once after editing instead of once per keystroke", () => {
    const source = readFileSync(inspectorPath, "utf8");

    expect(source).toContain("const [contentDraft, setContentDraft]");
    expect(source).toContain("onChange={(event) => setContentDraft(event.target.value)}");
    expect(source).toContain("onBlur={(event) => commitContent(event.currentTarget.value)}");
  });
});
