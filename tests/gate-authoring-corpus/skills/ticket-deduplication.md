# Skill: ticket-deduplication

**Intent:** Merge each duplicate ticket cluster; merged tickets are genuinely the same issue.

**Grounding source (truth the work is checked against):** the ticket texts (similarity evidence)

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Group candidate duplicate tickets into clusters; capture each ticket's text into the grounding bundle.
2. For each cluster in the list:
   a. Decide and merge <cluster>.
3. Confirm every cluster resolved with justified merges.
