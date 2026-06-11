# Skill: fraud-review

**Shape:** iterates over each transaction in transactions.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **score transaction** — score, fraud score.
- **investigate** — investigate, review flags.
- **velocity check** — velocity, rapid transactions.  _(visibility divider — no hard gate needed)_
- **decide action** — decide, block allow.

## Procedure
For each transaction in transactions:
  1. score transaction — score, fraud score.
  2. investigate — investigate, review flags.
  3. velocity check — velocity, rapid transactions.
  4. decide action — decide, block allow.
