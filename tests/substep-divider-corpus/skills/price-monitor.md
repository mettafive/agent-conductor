# Skill: price-monitor

**Shape:** iterates over each product in products.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **fetch listing** — fetch listing, live page.
- **record price** — record price, current price.
- **change flag** — change flag, price delta.  _(visibility divider — no hard gate needed)_
- **store history** — store history, log price.

## Procedure
For each product in products:
  1. fetch listing — fetch listing, live page.
  2. record price — record price, current price.
  3. change flag — change flag, price delta.
  4. store history — store history, log price.
