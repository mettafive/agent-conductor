# Skill: schema-validate

**Shape:** iterates over each config in configs.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **load config** — load config, parse file.
- **validate schema** — validate schema, conform.
- **cross ref** — cross reference, resolve refs.  _(visibility divider — no hard gate needed)_
- **report config** — report, verdict.

## Procedure
For each config in configs:
  1. load config — load config, parse file.
  2. validate schema — validate schema, conform.
  3. cross ref — cross reference, resolve refs.
  4. report config — report, verdict.
