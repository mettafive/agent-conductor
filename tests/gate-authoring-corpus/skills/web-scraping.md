# Skill: web-scraping

**Intent:** Extract structured records from each page; fields match what the live page actually shows.

**Grounding source (truth the work is checked against):** the live page HTML

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. List target pages and fetch each page's raw HTML into the grounding bundle (the truth the
2. For each page in the list:
   a. Extract structured fields from <page>.
3. Confirm every page scraped, fields grounded in HTML.
