# Skill: refactor

**Intent:** Restructure code without changing observable behavior; tests still green.

**Grounding source (truth the work is checked against):** the pre-refactor test suite + public API surface

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Snapshot the public API surface + a passing test run for each module into the grounding bundle
2. For each module in the list:
   a. Refactor <module>.
3. Confirm full suite green, no API drift.
