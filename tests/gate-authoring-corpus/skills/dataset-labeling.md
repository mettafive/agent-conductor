# Skill: dataset-labeling

**Intent:** Label each item per the rubric; labels are valid and inter-consistent with the rubric.

**Grounding source (truth the work is checked against):** the rubric (allowed labels + decision criteria) + the item content

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Load the labeling rubric (allowed label set + criteria) and the items into the grounding bundle.
2. For each item in the list:
   a. Label <item>.
3. Confirm every item labeled with a valid, grounded label.
