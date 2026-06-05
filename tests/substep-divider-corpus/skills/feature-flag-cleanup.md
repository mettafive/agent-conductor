# Skill: feature-flag-cleanup

**Shape:** iterates over each flag in flags.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **find usages** — find usages, grep flag.
- **remove flag** — remove flag, delete branch.
- **update config** — update config, remove definition.  _(visibility divider — no hard gate needed)_
- **test build** — test, build check.

## Procedure
For each flag in flags:
  1. find usages — find usages, grep flag.
  2. remove flag — remove flag, delete branch.
  3. update config — update config, remove definition.
  4. test build — test, build check.
