# Skill: tide-mill-schedule

**Shape:** iterates over each tide in tides.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **predict tide** — predict tide, tidal table.
- **plan grind** — plan grind, milling window.
- **sluice set** — sluice, pond level.  _(visibility divider — no hard gate needed)_
- **log output** — log output, flour yield.

## Procedure
For each tide in tides:
  1. predict tide — predict tide, tidal table.
  2. plan grind — plan grind, milling window.
  3. sluice set — sluice, pond level.
  4. log output — log output, flour yield.
