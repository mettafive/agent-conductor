# Skill: invoice-process

**Shape:** iterates over each invoice in invoices.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **ocr extract** — ocr, extract fields.
- **reconcile total** — reconcile, line items sum.
- **tax lines** — tax line, vat.  _(visibility divider — no hard gate needed)_
- **enter system** — enter system, post to ledger.

## Procedure
For each invoice in invoices:
  1. ocr extract — ocr, extract fields.
  2. reconcile total — reconcile, line items sum.
  3. tax lines — tax line, vat.
  4. enter system — enter system, post to ledger.
