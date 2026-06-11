# Skill: moderation-queue

**Shape:** iterates over each post in posts.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **read post** — read post, load content.
- **classify policy** — classify, policy match.
- **context check** — context, nuance.  _(visibility divider — no hard gate needed)_
- **action post** — action, remove keep.

## Procedure
For each post in posts:
  1. read post — read post, load content.
  2. classify policy — classify, policy match.
  3. context check — context, nuance.
  4. action post — action, remove keep.
