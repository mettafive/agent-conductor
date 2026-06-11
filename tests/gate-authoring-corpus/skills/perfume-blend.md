# Skill: perfume-blend

**Intent:** Formulate each blend so notes are balanced, IFRA limits respected, and percentages sum to 100.

**Grounding source (truth the work is checked against):** the ingredient IFRA-limit table + the note-pyramid rules

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Load the ingredient table (each with its IFRA max % and note class: top/heart/base) into the grounding bundle.
2. For each blend in the list:
   a. Formulate <blend>.
3. Confirm every blend sums + IFRA-compliant.
