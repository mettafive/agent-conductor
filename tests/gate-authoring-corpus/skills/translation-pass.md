# Skill: translation-pass

**Intent:** Translate each segment preserving meaning, numbers, and untranslatable terms.

**Grounding source (truth the work is checked against):** the source segment

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Load source segments + a glossary of do-not-translate terms into the grounding bundle.
2. For each segment in the list:
   a. Translate <segment>.
3. Confirm every segment translated faithfully.
