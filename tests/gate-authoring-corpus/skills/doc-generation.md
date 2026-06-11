# Skill: doc-generation

**Intent:** Generate API docs from each module; signatures match the actual code.

**Grounding source (truth the work is checked against):** the source signatures

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Parse each module's real exported signatures into the grounding bundle.
2. For each module in the list:
   a. Generate docs for <module>.
3. Confirm every module documented + accurate.
