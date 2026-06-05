# Skill: pr-review

**Shape:** iterates over each file in files.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **read diff** — read diff, load changes.
- **review** — review, find defects.
- **style check** — style, lint, formatting.  _(visibility divider — no hard gate needed)_
- **security scan** — security, vuln, injection.  _(visibility divider — no hard gate needed)_
- **comment** — comment, post review.

## Procedure
For each file in files:
  1. read diff — read diff, load changes.
  2. review — review, find defects.
  3. style check — style, lint, formatting.
  4. security scan — security, vuln, injection.
  5. comment — comment, post review.
