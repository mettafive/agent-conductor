# Skill: rag-index

**Shape:** iterates over each doc in docs.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **chunk doc** — chunk, split document.
- **embed** — embed, vectorize.
- **metadata tag** — metadata, tag chunk.  _(visibility divider — no hard gate needed)_
- **upsert vectors** — upsert, store vectors.

## Procedure
For each doc in docs:
  1. chunk doc — chunk, split document.
  2. embed — embed, vectorize.
  3. metadata tag — metadata, tag chunk.
  4. upsert vectors — upsert, store vectors.
