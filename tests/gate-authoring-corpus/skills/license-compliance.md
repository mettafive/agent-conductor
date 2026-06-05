# Skill: license-compliance

**Intent:** Check each dependency's license against the allowlist; verdict matches the real license.

**Grounding source (truth the work is checked against):** the package's actual license file + the allowlist

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Load packages + the license allowlist; capture each package's real license text into the grounding bundle.
2. For each package in the list:
   a. Check <package>'s license.
3. Confirm every package's license checked + correct verdict.
