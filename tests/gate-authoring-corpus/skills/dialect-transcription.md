# Skill: dialect-transcription

**Intent:** Transcribe each dialect recording with IPA + orthography preserving non-standard features faithfully.

**Grounding source (truth the work is checked against):** the audio + the dialect feature inventory

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Load recordings + the dialect feature inventory (the non-standard phonological/lexical markers to preserve)
2. For each recording in the list:
   a. Transcribe <recording>.
3. Confirm every recording transcribed, features preserved.
