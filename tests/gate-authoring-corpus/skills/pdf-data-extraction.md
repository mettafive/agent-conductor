# Skill: pdf-data-extraction

**Intent:** Extract a structured table from each PDF; cells match the source page.

**Grounding source (truth the work is checked against):** the PDF page text

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Load each PDF's extracted page text into the grounding bundle (cells are checked against it).
2. For each pdf in the list:
   a. Extract <pdf>'s table.
3. Confirm every PDF table extracted + grounded.
