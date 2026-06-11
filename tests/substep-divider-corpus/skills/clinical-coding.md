# Skill: clinical-coding

**Shape:** iterates over each encounter in encounters.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **read chart** — read chart, clinical note.
- **assign codes** — assign codes, icd cpt.
- **modifier check** — modifier, code modifier.  _(visibility divider — no hard gate needed)_
- **submit claim** — submit claim, billing.

## Procedure
For each encounter in encounters:
  1. read chart — read chart, clinical note.
  2. assign codes — assign codes, icd cpt.
  3. modifier check — modifier, code modifier.
  4. submit claim — submit claim, billing.
