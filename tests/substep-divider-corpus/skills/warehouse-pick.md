# Skill: warehouse-pick

**Shape:** iterates over each order in orders.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **read order** — read order, line items.
- **plan route** — plan route, pick path.
- **batch merge** — batch, wave pick.  _(visibility divider — no hard gate needed)_
- **confirm pick** — confirm pick, mark fulfilled.

## Procedure
For each order in orders:
  1. read order — read order, line items.
  2. plan route — plan route, pick path.
  3. batch merge — batch, wave pick.
  4. confirm pick — confirm pick, mark fulfilled.
