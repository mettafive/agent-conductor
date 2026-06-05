# Skill: invoice-processing

**Intent:** Extract invoice fields; totals reconcile (line items sum to total) and match the document.

**Grounding source (truth the work is checked against):** the invoice document

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Load the invoice documents into the grounding bundle (the source the extracted fields are checked against).
2. For each invoice in the list:
   a. Extract <invoice>'s fields.
3. Confirm every invoice extracted + reconciled.
