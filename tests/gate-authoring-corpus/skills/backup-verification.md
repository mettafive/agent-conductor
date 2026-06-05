# Skill: backup-verification

**Intent:** Verify each backup is restorable and matches the source checksum.

**Grounding source (truth the work is checked against):** a restore test + the source checksum

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. List backups; capture each backup's source checksum into the grounding bundle.
2. For each backup in the list:
   a. Verify <backup>.
3. Confirm every backup restorable + matching.
