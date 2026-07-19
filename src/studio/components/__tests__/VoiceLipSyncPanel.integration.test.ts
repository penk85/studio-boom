import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const panelPath = join(process.cwd(), "src/studio/components/VoiceLipSyncPanel.tsx");
const helperPath = join(process.cwd(), "src/studio/lipsync/elevenlabs.ts");

describe("Voice lip sync panel integration", () => {
  it("lets imported speech audio be aligned after the file is attached", () => {
    const panelSource = readFileSync(panelPath, "utf8");
    const helperSource = readFileSync(helperPath, "utf8");

    expect(panelSource).toContain("alignVoiceForClip");
    expect(panelSource).toContain("onGenerateLipSync");
    expect(panelSource).toContain("No timing yet");
    expect(panelSource).toContain("Generate lip sync");
    expect(panelSource).toContain("Re-generate lip sync");
    expect(helperSource).toContain("db.mediaBlobs.get(args.audioId)");
    expect(helperSource).toContain("forcedAlignAudioWithText({ file, text: transcript })");
  });

  it("commits speech timing and volume once per completed edit", () => {
    const panelSource = readFileSync(panelPath, "utf8");

    expect(panelSource).toContain("<SpeechStartInput");
    expect(panelSource).toContain("<SpeechVolumeInput");
    expect(panelSource).toContain("onBlur={(event) => commit(event.currentTarget.value)}");
    expect(panelSource).toContain(
      "onPointerUp={(event) => commit(Number(event.currentTarget.value))}",
    );
    expect(panelSource).not.toContain(
      "onChange={(e) => moveSpeech(clip.id, speech.id, Number(e.target.value))}",
    );
  });
});
