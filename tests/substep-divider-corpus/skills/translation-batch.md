# Skill: translation-batch

**Shape:** iterates over each segment in segments.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **load segment** — load segment, source text.
- **translate** — translate, render target.
- **glossary enforce** — glossary, do not translate.  _(visibility divider — no hard gate needed)_
- **number preserve** — number preserve, units.  _(visibility divider — no hard gate needed)_
- **save translation** — save, write output.

## Procedure
For each segment in segments:
  1. load segment — load segment, source text.
  2. translate — translate, render target.
  3. glossary enforce — glossary, do not translate.
  4. number preserve — number preserve, units.
  5. save translation — save, write output.
