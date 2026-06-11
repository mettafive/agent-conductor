# Skill: inventory-sync

**Shape:** iterates over each sku in skus.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **read stock** — read stock, warehouse count.
- **update listing** — update listing, set quantity.
- **low stock alert** — low stock, reorder alert.  _(visibility divider — no hard gate needed)_
- **confirm** — confirm, verify count.

## Procedure
For each sku in skus:
  1. read stock — read stock, warehouse count.
  2. update listing — update listing, set quantity.
  3. low stock alert — low stock, reorder alert.
  4. confirm — confirm, verify count.
