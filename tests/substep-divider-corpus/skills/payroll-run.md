# Skill: payroll-run

**Shape:** iterates over each employee in employees.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **compute gross** — compute gross, hours pay.
- **apply deductions** — deductions, withholding.
- **benefits** — benefits, 401k, pension.  _(visibility divider — no hard gate needed)_
- **issue payment** — issue payment, pay.

## Procedure
For each employee in employees:
  1. compute gross — compute gross, hours pay.
  2. apply deductions — deductions, withholding.
  3. benefits — benefits, 401k, pension.
  4. issue payment — issue payment, pay.
