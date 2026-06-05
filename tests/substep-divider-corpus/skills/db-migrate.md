# Skill: db-migrate

**Shape:** iterates over each migration in migrations.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **backup** — backup, snapshot.
- **apply migration** — apply migration, run migration.
- **verify indexes** — verify index, reindex.  _(visibility divider — no hard gate needed)_
- **smoke test** — smoke test, query check.

## Procedure
For each migration in migrations:
  1. backup — backup, snapshot.
  2. apply migration — apply migration, run migration.
  3. verify indexes — verify index, reindex.
  4. smoke test — smoke test, query check.
