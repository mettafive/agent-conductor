# Skill: license-audit

**Shape:** iterates over each package in packages.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **read license** — read license, license file.
- **classify license** — classify, spdx.
- **allowlist check** — allowlist, policy check.  _(visibility divider — no hard gate needed)_
- **report verdict** — report, verdict.

## Procedure
For each package in packages:
  1. read license — read license, license file.
  2. classify license — classify, spdx.
  3. allowlist check — allowlist, policy check.
  4. report verdict — report, verdict.
