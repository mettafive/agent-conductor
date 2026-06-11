# Skill: code-review

**Intent:** Find real defects in each changed file; every finding has a line + concrete fix that compiles.

**Grounding source (truth the work is checked against):** the actual diff + a build/typecheck of the proposed fix

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. List changed files from the diff; capture each file's actual changed-line ranges into the grounding
2. For each file in the list:
   a. Review <file> for real defects.
3. Roll findings into one review with an overall verdict.
