# Skill: tarot-spread

**Intent:** Generate a spread reading where each position's meaning matches the drawn card's canonical meaning AND the position's defined role.

**Grounding source (truth the work is checked against):** the canonical card-meaning reference + the spread layout definition

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Load the spread layout (each position + its role, e.g. 'past', 'obstacle') and the canonical
2. For each position in the list:
   a. Interpret <position>.
3. Confirm every position interpreted, grounded + role-tied.
