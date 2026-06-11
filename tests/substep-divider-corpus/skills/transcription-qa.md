# Skill: transcription-qa

**Shape:** iterates over each file in files.

**Distinct work-units this skill performs** (each is a phase the user will look for on the board):

- **auto transcribe** — auto transcribe, asr.
- **human correct** — human correct, proofread.
- **speaker label** — speaker label, diarization.  _(visibility divider — no hard gate needed)_
- **finalize transcript** — finalize, publish transcript.

## Procedure
For each file in files:
  1. auto transcribe — auto transcribe, asr.
  2. human correct — human correct, proofread.
  3. speaker label — speaker label, diarization.
  4. finalize transcript — finalize, publish transcript.
