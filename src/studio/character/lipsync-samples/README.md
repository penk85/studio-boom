# Lip-sync test clips

Drop short speech audio files here (`.mp3`, `.wav`, `.m4a`, `.ogg`, `.aac`). They
are picked up automatically by `import.meta.glob` — no manifest to edit — and
appear in the **Test Lip Sync** panel on the mouth group in the Character editor.

Two ways a clip is used:

- **Attach to a sample word** — name the file after one of the sample words
  (case-insensitive), e.g. `mommy.mp3`, `welcome.mp3`, `hello.mp3`, `shalom.mp3`.
  That word button then plays the clip **and** drives the word's scripted viseme
  shapes timed to the clip (correct movement + sound). A ♪ marks attached words.
- **Standalone clip** — any other filename shows as its own test button and drives
  the mouth from the audio's **amplitude** (loudness → openness). Rough, but useful
  for longer/arbitrary speech.

Note: amplitude-driven clips and the scripted word clips are both previews, not
phoneme-accurate lip-sync. True sync needs a viseme timeline (forced alignment),
which is the shelved follow-up work.
