# Skill: store-locator-import

**Shape:** iterates over each store in stores.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **normalize store** — normalize, clean record.
- **geocode store** — geocode, coordinates.
- **hours parse** — hours, opening times.  _(visibility divider — no hard gate needed)_
- **save store** — save, store record.

## Procedure
For each store in stores:
  1. normalize store — normalize, clean record.
  2. geocode store — geocode, coordinates.
  3. hours parse — hours, opening times.
  4. save store — save, store record.
