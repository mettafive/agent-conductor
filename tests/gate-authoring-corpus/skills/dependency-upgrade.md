# Skill: dependency-upgrade

**Intent:** Upgrade each dependency without breaking the build or introducing known CVEs.

**Grounding source (truth the work is checked against):** the lockfile + build + the advisory database

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. List deps to upgrade; snapshot current versions + a green build baseline into the grounding bundle.
2. For each dep in the list:
   a. Upgrade <dep>.
3. Confirm all deps upgraded, build green, no CVEs.
