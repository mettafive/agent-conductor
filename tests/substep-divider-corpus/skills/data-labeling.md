# Skill: data-labeling

**Shape:** iterates over each item in items.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **load item** — load item, fetch sample.
- **label** — label, annotate.
- **confidence mark** — confidence, uncertain flag.  _(visibility divider — no hard gate needed)_
- **save label** — save label, store annotation.

## Procedure
For each item in items:
  1. load item — load item, fetch sample.
  2. label — label, annotate.
  3. confidence mark — confidence, uncertain flag.
  4. save label — save label, store annotation.
