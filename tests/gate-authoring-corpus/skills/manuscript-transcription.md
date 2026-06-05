# Skill: manuscript-transcription

**Intent:** Transcribe each folio; every expanded abbreviation and uncertain reading is marked and matches the imaged glyphs.

**Grounding source (truth the work is checked against):** the folio image + the abbreviation reference

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Load folio images + the scribal-abbreviation reference (sigla -> expansion) into the grounding bundle.
2. For each folio in the list:
   a. Transcribe <folio>.
3. Confirm every folio transcribed, expansions + uncertainty marked.
