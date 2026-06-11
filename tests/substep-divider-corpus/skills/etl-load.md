# Skill: etl-load

**Shape:** iterates over each table in tables.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **extract** — extract, pull rows.
- **transform** — transform, map columns.
- **type coerce** — type coerce, cast types.  _(visibility divider — no hard gate needed)_
- **dedupe** — dedupe, deduplicate.  _(visibility divider — no hard gate needed)_
- **load** — load, insert into warehouse.
- **reconcile** — reconcile, row count check.

## Procedure
For each table in tables:
  1. extract — extract, pull rows.
  2. transform — transform, map columns.
  3. type coerce — type coerce, cast types.
  4. dedupe — dedupe, deduplicate.
  5. load — load, insert into warehouse.
  6. reconcile — reconcile, row count check.
