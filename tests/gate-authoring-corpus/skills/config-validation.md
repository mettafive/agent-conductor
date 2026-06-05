# Skill: config-validation

**Intent:** Validate each config file against schema + cross-file references resolve.

**Grounding source (truth the work is checked against):** the schema + the referenced files

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Load the config files + the schema + the referenceable target set into the grounding bundle.
2. For each config in the list:
   a. Validate <config>.
3. Confirm every config valid + references resolve.
