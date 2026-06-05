# Skill: dep-bump

**Shape:** iterates over each dep in deps.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **check version** — check version, latest release.
- **upgrade** — upgrade, bump version.
- **cve scan** — cve, advisory, audit.  _(visibility divider — no hard gate needed)_
- **changelog read** — read changelog, migration guide.  _(visibility divider — no hard gate needed)_
- **build** — build, run tests.

## Procedure
For each dep in deps:
  1. check version — check version, latest release.
  2. upgrade — upgrade, bump version.
  3. cve scan — cve, advisory, audit.
  4. changelog read — read changelog, migration guide.
  5. build — build, run tests.
