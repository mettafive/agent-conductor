# Skill: batch-api-sync

**Intent:** Sync each record to the remote API so remote state equals local intent, idempotently.

**Grounding source (truth the work is checked against):** a read-back of remote state vs the local desired payload

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Load the records to sync. For each, snapshot the local DESIRED payload into the grounding bundle —
2. For each record in the list:
   a. Push <record> to the remote API.
3. Confirm remote state matches local intent for all records.
