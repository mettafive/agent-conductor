# Skill: email-triage

**Intent:** Route each email to the right queue with a reason grounded in the email content.

**Grounding source (truth the work is checked against):** the email body + the routing rules

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Ingest the emails + the routing rules (queues + their trigger criteria) into the grounding bundle.
2. For each email in the list:
   a. Route <email> to a queue.
3. Confirm every email routed with a grounded reason.
