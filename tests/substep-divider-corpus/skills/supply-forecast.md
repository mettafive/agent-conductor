# Skill: supply-forecast

**Shape:** iterates over each product in products.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **pull demand** — pull demand, sales history.
- **forecast** — forecast, predict demand.
- **seasonality** — seasonality, seasonal adjust.  _(visibility divider — no hard gate needed)_
- **recommend order** — recommend order, reorder qty.

## Procedure
For each product in products:
  1. pull demand — pull demand, sales history.
  2. forecast — forecast, predict demand.
  3. seasonality — seasonality, seasonal adjust.
  4. recommend order — recommend order, reorder qty.
