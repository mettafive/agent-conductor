# Skill: ci-pipeline

**Shape:** single pass.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **install** — install deps, npm ci.
- **lint** — lint, eslint.
- **test** — test, unit tests.
- **coverage report** — coverage report, coverage threshold.  _(visibility divider — no hard gate needed)_
- **build artifact** — build artifact, bundle.
- **deploy** — deploy, ship.

## Procedure
1. install — install deps, npm ci.
2. lint — lint, eslint.
3. test — test, unit tests.
4. coverage report — coverage report, coverage threshold.
5. build artifact — build artifact, bundle.
6. deploy — deploy, ship.
