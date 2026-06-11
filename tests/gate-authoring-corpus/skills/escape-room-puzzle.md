# Skill: escape-room-puzzle

**Intent:** Design each puzzle so it is solvable from provided clues alone, has exactly one solution, and chains to the next.

**Grounding source (truth the work is checked against):** the clue set + a solution-uniqueness check

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Plan the puzzle chain; for each puzzle capture its provided clue set + intended solution into the grounding bundle.
2. For each puzzle in the list:
   a. Design <puzzle>.
3. Confirm every puzzle solvable, unique, chained.
