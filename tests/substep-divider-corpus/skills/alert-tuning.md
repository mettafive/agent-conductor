# Skill: alert-tuning

**Shape:** iterates over each alert in alerts.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **analyze history** — analyze history, alert noise.
- **tune threshold** — tune threshold, adjust.
- **test replay** — replay, backtest alert.  _(visibility divider — no hard gate needed)_
- **deploy alert** — deploy, apply rule.

## Procedure
For each alert in alerts:
  1. analyze history — analyze history, alert noise.
  2. tune threshold — tune threshold, adjust.
  3. test replay — replay, backtest alert.
  4. deploy alert — deploy, apply rule.
