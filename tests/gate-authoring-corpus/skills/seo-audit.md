# Skill: seo-audit

**Intent:** Audit each page against SEO rules; findings reflect the page's real HTML/meta.

**Grounding source (truth the work is checked against):** the live page (HTML + meta tags)

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Crawl the pages; capture each page's real title/meta/headings into the grounding bundle.
2. For each page in the list:
   a. Audit <page> against the SEO rules.
3. Confirm every page audited against real meta.
