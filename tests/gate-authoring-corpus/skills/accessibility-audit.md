# Skill: accessibility-audit

**Intent:** Flag real a11y violations per WCAG on each view; each cites a DOM node.

**Grounding source (truth the work is checked against):** the rendered DOM

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Render each view; capture its DOM snapshot into the grounding bundle.
2. For each view in the list:
   a. Audit <view> for WCAG violations.
3. Confirm every view audited against its DOM.
