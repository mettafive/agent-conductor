# Skill: test-authoring

**Intent:** Write tests that actually exercise the target code and fail when it regresses.

**Grounding source (truth the work is checked against):** coverage of the target + a mutation/break check

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Pick the functions/modules to test; snapshot each target's signature + a known-good baseline into
2. For each target in the list:
   a. Write tests for <target>.
3. Confirm each target has a regression-catching test.
