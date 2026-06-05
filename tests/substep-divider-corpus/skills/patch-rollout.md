# Skill: patch-rollout

**Shape:** iterates over each cohort in cohorts.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **select cohort** — select cohort, canary group.
- **deploy patch** — deploy patch, rollout.
- **monitor errors** — monitor errors, error rate.  _(visibility divider — no hard gate needed)_
- **promote or halt** — promote, halt rollback.

## Procedure
For each cohort in cohorts:
  1. select cohort — select cohort, canary group.
  2. deploy patch — deploy patch, rollout.
  3. monitor errors — monitor errors, error rate.
  4. promote or halt — promote, halt rollback.
