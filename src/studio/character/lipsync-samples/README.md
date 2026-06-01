# Character editor lip-sync test clips

Drop short speech audio files here (`.mp3`, `.wav`, `.m4a`, `.ogg`, `.aac`). They
are picked up automatically by `import.meta.glob` - no manifest to edit - and
appear in the **Test Lip Sync** panel on the mouth group in the Character editor.

Two ways a clip is used:

- **Attach to a sample word** - name the file after one of the sample words
  (case-insensitive), e.g. `mommy.mp3`, `welcome.mp3`, `hello.mp3`, `shalom.mp3`.
  That word button then plays the clip **and** drives the word's scripted viseme
  shapes timed to the clip (correct movement + sound). A music-note mark identifies
  attached words.
- **Standalone clip** - any other filename shows as its own test button and drives
  the mouth from the audio's **amplitude** (loudness to openness). Rough, but useful
  for longer/arbitrary speech.

These files are only for testing mouth parts while building a character. They do
not create reusable studio voice assets and they do not write to `project.hf`.

Production character speech now lives in the main editor:

1. Add a character to the timeline.
2. Select the character clip.
3. Open **Inspector -> Speech**.
4. Generate speech with ElevenLabs, upload/drop audio, or add an existing voice
   from the voice library.
5. If the audio has no timing, paste the transcript and generate lip sync.

The Speech tab creates reusable audio media, stores viseme timing on the audio
asset, and serializes speech into the character sub-composition as HyperFrames
`<audio>` clips.
