# Skill: model-eval

**Shape:** iterates over each checkpoint in checkpoints.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **load checkpoint** — load checkpoint, model weights.
- **run benchmark** — run benchmark, eval suite.
- **per category** — per category, breakdown.  _(visibility divider — no hard gate needed)_
- **regression flag** — regression, compare baseline.  _(visibility divider — no hard gate needed)_
- **record scores** — record scores, leaderboard.

## Procedure
For each checkpoint in checkpoints:
  1. load checkpoint — load checkpoint, model weights.
  2. run benchmark — run benchmark, eval suite.
  3. per category — per category, breakdown.
  4. regression flag — regression, compare baseline.
  5. record scores — record scores, leaderboard.
