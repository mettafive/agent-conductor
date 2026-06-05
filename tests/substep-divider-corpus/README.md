# Substep-divider corpus & visual-step coverage harness

A re-runnable stress test for the part of agent-conductor that turns a **skill** into **visible
steps**. It is the **visibility counterpart** to the [gate-authoring corpus](../gate-authoring-corpus/):
that one proves gates *fail bad work*; this one proves the conversion *surfaces a board card for
every distinct work-unit the skill names* — including the pure-visibility **"divider"** phases that
need no hard gate.

## The failure this exists to catch

A daily-enrichment skill did real SEO work — DataForSEO keyword research + akut/hembesök polish —
but the conversion **folded** that work into other steps' instructions (`research-clinic`,
`write-fields`) and never gave it its own card. The user scanned the board and thought *"the SEO
step — was this skipped?"* That is the exact opposite of what the board is for. The conversion
**over-collapsed**: it only created a STEP when something needed a GATE, when it should create a
step whenever there's a distinct unit of work the user would look for.

**The principle (the "substep divider"):** every distinct, user-recognizable unit of work the skill
names becomes its OWN visual step/sub-step — **even if it needs no hard gate**. A divider step
exists for *visibility/confidence*, not gating; a soft attestation or no gate at all is fine and
expected. Visibility is **orthogonal** to gate quality. This is NOT over-gating: a divider step
can be gate-less. See CONDUCTOR.md → *"What makes a (visual) step — surface every work-unit"*.

## What's here

- `specs.mjs` — the 120 cases (100 common + 20 deliberately obscure). Each names K distinct
  work-units; each unit declares its keywords, whether it's a **`divider`** (visibility-only) or a
  gateable phase, its gate kind (`hard` | `soft` | `none`), and — for the naive renderer — which
  sibling it gets **`foldInto`** (the bug being reproduced).
- `gen.mjs` — renders, per case, `skills/<id>.md` (the skill, naming every work-unit as a phase)
  and `conductors/<id>.conductor.yaml`. `COVERAGE=naive|improved` switches the conversion logic.
- `coverage.mjs` — the matcher. For each declared unit it decides **surfaced** (its own card),
  **folded** (buried in a sibling's prose), or **missing**. It works from the board-reader's signal
  (each card's title + instruction), not from step ids, so coverage can't be trivially true.
- `verify-unit.mjs` — a stand-in for the hard-gate `check:` commands so the conductors are real and
  runnable. (Gate *substance* is the sibling corpus's job; this corpus asserts *visibility*.)
- `run.mjs` — the harness.
- `report.md` / `report.improved.json` / `report.naive.json` — generated assessments.

## Run it

```bash
# from the repo root
node tests/substep-divider-corpus/run.mjs                  # improved logic — expects 120/120 complete, exits 0
COVERAGE=naive node tests/substep-divider-corpus/run.mjs   # pre-fix folding — shows the hidden-phase bug
SKIP_VALIDATE=1 node tests/substep-divider-corpus/run.mjs  # skip per-file board validate (faster)
```

The harness regenerates the corpus for the requested mode, then per case asserts:

1. **VALID** — `board/bin/cli.js validate` passes.
2. **SURFACED** — every declared work-unit has its OWN visual step/sub-step (a board card), not
   folded into a sibling step's instruction prose.
3. **DIVIDERS KEPT** — divider (visibility-only) units are surfaced too. Gate-less is fine; hidden
   is not.

`improved` must reach 120/120 complete (the harness exits non-zero otherwise — wire it into CI).

## Naive → improved scoreboard

| | naive (pre-fix) | improved |
|---|---|---|
| Visual-step coverage | **370/520 (71.2%)** | **520/520 (100%)** |
| Divider phases surfaced | **1/151** (150 hidden) | **151/151** (0 hidden) |
| Folded into a sibling | 150 | 0 |
| Complete cases (100%) | **1/120** | **120/120** |
| Obscure cases complete | **1/20** | **20/20** |

The systematic weakness it catches: **"a step only when there's a gate."** The naive conversion
creates a card only for gateable phases and absorbs every gate-less divider into a neighbour's
instruction — hiding 150 of 151 divider phases, exactly the daily-enrichment SEO-step failure. The
fix (granular-by-default: surface EVERY named work-unit, gate-less dividers included) is encoded in
CONDUCTOR.md (*"What makes a (visual) step"* + the *substep divider* definition) and the
setup `read-skill` / `convert-to-conductor` steps. It holds on all 20 obscure cases — the conversion
generalizes (bell-ringing peals, cuneiform editions, raku firings…), it doesn't pattern-match
familiar pipelines.
