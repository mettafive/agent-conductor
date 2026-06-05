# Skill: sql-optimization

**Intent:** Rewrite each slow query to be faster with an identical result set.

**Grounding source (truth the work is checked against):** the EXPLAIN plan + result-set equality vs the original

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Profile each slow query; snapshot its result-set + baseline cost into the grounding bundle.
2. For each query in the list:
   a. Rewrite <query>.
3. Confirm every query faster + result-equal.
