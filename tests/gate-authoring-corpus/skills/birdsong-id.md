# Skill: birdsong-id

**Intent:** Identify the species in each recording; ID is plausible for the region/season and cites acoustic features.

**Grounding source (truth the work is checked against):** the spectrogram features + the regional species list

**Shape:** iterates over a list (per-item procedure).

## Procedure
1. Load recordings with their location/date + extracted acoustic features, and the regional species list
2. For each recording in the list:
   a. Identify the species in <recording>.
3. Confirm every recording IDed, in-region + feature-grounded.
