# Skill: video-transcription

**Intent:** Transcribe each clip; transcript aligns to audio and timestamps are monotonic.

**Grounding source (truth the work is checked against):** the audio track

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Load each clip's audio reference + duration into the grounding bundle.
2. For each clip in the list:
   a. Transcribe <clip>.
3. Confirm every clip transcribed + aligned.
