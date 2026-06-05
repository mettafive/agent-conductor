# Skill: refactor-pass

**Shape:** iterates over each file in files.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **baseline** — baseline, snapshot tests.
- **refactor** — refactor, restructure.
- **rename symbols** — rename, symbol cleanup.  _(visibility divider — no hard gate needed)_
- **verify green** — verify green, tests pass.

## Procedure
For each file in files:
  1. baseline — baseline, snapshot tests.
  2. refactor — refactor, restructure.
  3. rename symbols — rename, symbol cleanup.
  4. verify green — verify green, tests pass.
