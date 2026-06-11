# Skill: heraldry-blazon

**Intent:** Validate each blazon: tincture rule (no colour-on-colour), grammar, and that it renders to the intended arms.

**Grounding source (truth the work is checked against):** the heraldic grammar rules + the reference emblazon

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Load the blazons + the heraldic grammar rules (tincture classes, ordinary vocabulary) + each intended
2. For each blazon in the list:
   a. Validate <blazon>.
3. Confirm every blazon valid + tincture-compliant.
