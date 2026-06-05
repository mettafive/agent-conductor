# Skill: geo-encode

**Shape:** iterates over each address in addresses.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **parse address** — parse address, normalize address.
- **geocode** — geocode, lat lng, coordinates.
- **confidence flag** — confidence, flag low match.  _(visibility divider — no hard gate needed)_
- **store** — store, save coordinates.

## Procedure
For each address in addresses:
  1. parse address — parse address, normalize address.
  2. geocode — geocode, lat lng, coordinates.
  3. confidence flag — confidence, flag low match.
  4. store — store, save coordinates.
