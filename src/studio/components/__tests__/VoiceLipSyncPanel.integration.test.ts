import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const panelPath = join(process.cwd(), "src/studio/components/VoiceLipSyncPanel.tsx");
const helperPath = join(process.cwd(), "src/studio/lipsync/elevenlabs.ts");

describe("Voice lip sync panel integration", () => {
  it("lets imported speech audio be aligned after the file is attached", () => {
    const panelSource = readFileSync(panelPath, "utf8");
    const helperSource = readFileSync(helperPath, "utf8");

    expect(panelSource).toContain("alignAttachedAudioLipSyncForClip");
    expect(panelSource).toContain("onAlignAttachedAudio");
    expect(panelSource).toContain("No lip sync timing yet");
    expect(panelSource).toContain("Create lip sync from transcript");
    expect(panelSource).toContain("Re-align lip sync from transcript");
    expect(helperSource).toContain("db.mediaBlobs.get(mediaId)");
    expect(helperSource).toContain("forcedAlignAudioWithText({ file, text: transcript })");
  });
});
