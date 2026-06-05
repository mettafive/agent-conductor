# Skill: research-synthesis

**Intent:** Synthesize a cited answer where every claim traces to a fetched source.

**Grounding source (truth the work is checked against):** the fetched source texts

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Decompose the question into sub-claims and fetch real sources for each into the grounding bundle
2. For each claim in the list:
   a. Write <claim>'s answer with its citation.
3. Assemble the cited answer; confirm no uncited claim slipped in.
