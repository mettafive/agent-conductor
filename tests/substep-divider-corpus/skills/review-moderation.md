# Skill: review-moderation

**Shape:** iterates over each review in reviews.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **read review** — read review, load review.
- **moderate** — moderate, approve reject.
- **spam check** — spam, fake review.  _(visibility divider — no hard gate needed)_
- **publish review** — publish, post review.

## Procedure
For each review in reviews:
  1. read review — read review, load review.
  2. moderate — moderate, approve reject.
  3. spam check — spam, fake review.
  4. publish review — publish, post review.
