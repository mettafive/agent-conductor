# Skill: astro-imaging

**Shape:** iterates over each target in targets.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **plan session** — plan session, target altitude.
- **capture subs** — capture, sub frames.
- **calibration frames** — calibration, darks flats.  _(visibility divider — no hard gate needed)_
- **guiding** — guiding, autoguide.  _(visibility divider — no hard gate needed)_
- **stack process** — stack, process image.

## Procedure
For each target in targets:
  1. plan session — plan session, target altitude.
  2. capture subs — capture, sub frames.
  3. calibration frames — calibration, darks flats.
  4. guiding — guiding, autoguide.
  5. stack process — stack, process image.
