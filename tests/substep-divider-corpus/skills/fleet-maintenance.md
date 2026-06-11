# Skill: fleet-maintenance

**Shape:** iterates over each vehicle in vehicles.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **read telemetry** — read telemetry, diagnostics.
- **assess wear** — assess wear, maintenance need.
- **schedule service** — schedule service, book slot.  _(visibility divider — no hard gate needed)_
- **log record** — log, maintenance record.

## Procedure
For each vehicle in vehicles:
  1. read telemetry — read telemetry, diagnostics.
  2. assess wear — assess wear, maintenance need.
  3. schedule service — schedule service, book slot.
  4. log record — log, maintenance record.
