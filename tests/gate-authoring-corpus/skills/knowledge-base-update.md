# Skill: knowledge-base-update

**Intent:** Update each KB article to current product reality; no stale claims remain.

**Grounding source (truth the work is checked against):** the current product/code reality

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Load KB articles + a snapshot of current product reality (features/flags/endpoints) into the grounding bundle.
2. For each kb in the list:
   a. Update <kb>.
3. Confirm every article current, no stale claims.
