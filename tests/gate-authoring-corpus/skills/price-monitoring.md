# Skill: price-monitoring

**Intent:** Record each product's current price from the live listing; flag real changes.

**Grounding source (truth the work is checked against):** the live listing + the last recorded price

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Load products + their last recorded prices, and fetch each live listing into the grounding bundle.
2. For each product in the list:
   a. Record <product>'s current price.
3. Confirm every product priced from its live listing.
