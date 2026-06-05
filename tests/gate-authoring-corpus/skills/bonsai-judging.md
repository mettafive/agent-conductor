# Skill: bonsai-judging

**Intent:** Score each bonsai entry on rubric criteria; scores reflect the entry's measured traits and sum correctly.

**Grounding source (truth the work is checked against):** the entry's measured traits + the rubric weights

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Load entries with their MEASURED traits (nebari spread, taper, ramification, pot harmony…) and the
2. For each entry in the list:
   a. Score <entry>.
3. Confirm every entry scored, summed, grounded.
