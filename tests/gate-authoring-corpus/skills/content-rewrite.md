# Skill: content-rewrite

**Intent:** Rewrite each article for clarity while preserving every factual claim and all internal links.

**Grounding source (truth the work is checked against):** the original article's extracted facts + link set

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Collect the articles to rewrite. For each, extract its factual claims and the set of internal links
2. For each article in the list:
   a. Rewrite <article> for clarity.
3. Confirm every article rewritten with links+facts preserved.
