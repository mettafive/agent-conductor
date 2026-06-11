# Skill: form-data-entry

**Intent:** Enter each form record into the system; stored values equal the source form.

**Grounding source (truth the work is checked against):** the source form

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Load source forms into the grounding bundle (the truth stored values are checked against).
2. For each form in the list:
   a. Enter <form> into the system.
3. Confirm every form entered + read-back matches.
