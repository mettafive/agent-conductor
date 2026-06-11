# Skill: backup-verify

**Shape:** iterates over each backup in backups.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **locate backup** — locate, find backup.
- **restore test** — restore test, restore.
- **checksum** — checksum, hash compare.  _(visibility divider — no hard gate needed)_
- **report status** — report, verdict.

## Procedure
For each backup in backups:
  1. locate backup — locate, find backup.
  2. restore test — restore test, restore.
  3. checksum — checksum, hash compare.
  4. report status — report, verdict.
