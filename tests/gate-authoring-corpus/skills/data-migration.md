# Skill: data-migration

**Intent:** Move rows from the legacy schema to the new schema with zero data loss and correct type mapping.

**Grounding source (truth the work is checked against):** source row counts + per-row checksums vs the destination

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. List every legacy table to migrate. For each, snapshot source row count + a checksum of
2. For each table in the list:
   a. Migrate <table>'s rows into the new schema, mapping each column type explicitly.
3. Confirm every table migrated with matching counts; produce a per-table loss report (must be 0 lost rows).
