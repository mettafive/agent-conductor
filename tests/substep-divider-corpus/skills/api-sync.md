# Skill: api-sync

**Shape:** iterates over each record in records.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **fetch local** — fetch local, load desired.
- **push remote** — push, sync to api.
- **rate limit** — rate limit, throttle, backoff.  _(visibility divider — no hard gate needed)_
- **readback** — read back, verify remote.

## Procedure
For each record in records:
  1. fetch local — fetch local, load desired.
  2. push remote — push, sync to api.
  3. rate limit — rate limit, throttle, backoff.
  4. readback — read back, verify remote.
