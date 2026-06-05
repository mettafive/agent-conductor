# Skill: feature-store

**Shape:** iterates over each feature in features.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **compute feature** — compute feature, transform.
- **validate feature** — validate, drift check.
- **backfill** — backfill, historical.  _(visibility divider — no hard gate needed)_
- **publish feature** — publish, register feature.

## Procedure
For each feature in features:
  1. compute feature — compute feature, transform.
  2. validate feature — validate, drift check.
  3. backfill — backfill, historical.
  4. publish feature — publish, register feature.
