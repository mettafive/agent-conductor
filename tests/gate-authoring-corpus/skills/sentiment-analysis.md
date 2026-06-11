# Skill: sentiment-analysis

**Intent:** Score each review's sentiment; label matches the text and scale is valid.

**Grounding source (truth the work is checked against):** the review text

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Load reviews + the sentiment scale definition into the grounding bundle.
2. For each review in the list:
   a. Score <review>.
3. Confirm every review scored validly + grounded.
