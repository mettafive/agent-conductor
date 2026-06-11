# Skill: fantasy-trade-eval

**Intent:** Evaluate each proposed trade for fairness using real player projections + league scoring rules.

**Grounding source (truth the work is checked against):** the player projection table + the league scoring settings

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Load the player projection table + the league's scoring settings (PPR? categories?) into the grounding bundle,
2. For each trade in the list:
   a. Evaluate <trade>.
3. Confirm every trade evaluated under real rules.
