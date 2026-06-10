# Conductor Spec

Version: 3.1.0

Agent Conductor turns a skill into cards on a Kanban board. Every card is
independently verified against its own instruction. Write better instructions,
get better verification. No separate checker configuration is needed.

There are no explicit gate fields, no soft/hard distinction, and no approval
steps during execution.

## Card Shape

Every card has three fields in `cards.json` and four fields in `workflow.json`
after dependency mapping:

`cards.json`:

```json
[
  {
    "title": "Research the treatment",
    "instruction": "Gather at least 4 veterinary sources covering what, when, cost, and owner concerns.",
    "summary": "Researches the treatment from veterinary sources. Produces a sourced reference covering what it is, when it is needed, typical cost, and common owner concerns."
  }
]
```

`workflow.json`:

```json
{
  "title": "Research the treatment",
  "instruction": "Gather at least 4 veterinary sources covering what, when, cost, and owner concerns.",
  "summary": "Researches the treatment from veterinary sources. Produces a sourced reference covering what it is, when it is needed, typical cost, and common owner concerns.",
  "requires": []
}
```

- `title`: what the unit of work is, shown on the board.
- `instruction`: what the work agent does and what the checker verifies against.
- `summary`: a short plain-language description of the card, for a non-technical user watching the board. It is **generated, not user-authored**: the composer writes a one- to two-sentence intent summary during `decompose`, and the checker writes an outcome summary at verification (`gate-result --summary`). The board shows the best available summary.
- `requires`: list of card indexes that must be done first. Use `[]` for no dependencies.
- Card identity is the array index. There is no card `id` field.

Order emerges from the `requires` graph. Cards whose dependencies are satisfied
can run; cards with no mutual dependencies can run in parallel.

Terminology:

- An **artifact** is the durable file the card produced under `.conductor/artifacts/`.
- An **update** is agent narration for the board and is never completion proof.
- The **checker** compares the card instruction to the artifact.

## Implicit Checking

The checker contract is universal:

> The agent was asked to do X. Here is what it produced. Did it satisfy X?

The artifact must be the actual work product or a verifiable action record. If
the output only describes what was done without concrete proof, the checker must
fail immediately. Action records include command/script run, timestamp, inputs,
return value, changed resource, affected rows/files/URLs, and verification
query/curl/test result.

Every completed card must also have a durable markdown receipt under
`.conductor/artifacts/`. The required path is
`.conductor/artifacts/<card-index>-<slugified-card-title>.md`: a human-readable receipt containing the work
product or action proof. For images, screenshots, PDFs, JSON, CSV, HTML, and
other inspectable files, the markdown receipt is still the primary artifact.
Images produced by the card must be embedded inline in that receipt with
markdown image syntax; the underlying files remain supporting assets.

For v3, `check` prints the universal instruction/output comparison prompt.
An external independent checker evaluates that prompt and records its verdict
before completion:

```bash
npx conductor-board check 0 --output-file .conductor/artifacts/0-research.md
npx conductor-board gate-result 0 --passed --evidence "4 sources captured with cost and owner-concern coverage"
npx conductor-board gate-result 0 --failed --evidence "missing owner-concern coverage"
```

`conductor-board complete <card>` has one path:

1. Resolve the card.
2. Look for a recorded checker result.
3. If no result exists, fail with `no checker result — run the independent checker first.`
4. If the checker passed but no artifact exists under `.conductor/artifacts/`, fail.
5. If the checker passed and an artifact exists, move the card to Done and unlock dependents.
6. If the checker failed, keep the card incomplete so the work agent retries.

## Situational Work

There is no system-level condition field and no branch card type. If work only
applies in a certain situation, fold that situation into the card instruction.
The card still runs, produces an artifact, and goes through the checker.

Example instruction:

> Check whether the title/meta gate failed. If it failed, repair the proposal
> and rerun the gate. If it passed, write an artifact documenting that no repair
> was needed, including the passing gate evidence.

Both outcomes can pass. The artifact must prove the situation was evaluated
against real evidence.

## Loops

Loop containers and loop sub-steps are cards:

```json
{
  "title": "Process pages",
  "instruction": "Process every page in the page list.",
  "requires": [],
  "type": "loop",
  "over": "pages",
  "as": "page",
  "parallel": "auto",
  "steps": [
    {
      "title": "Check links",
      "instruction": "Check every link on {page} and record broken or suspicious links.",
      "requires": []
    }
  ]
}
```

A loop cannot complete while a frontloaded iteration has incomplete declared
sub-steps.

## Authoring Phases

The setup conductor has two authoring phases:

1. **Card design:** read the skill and output `.conductor/cards.json` with
   `title` and `instruction` for each verifiable unit of work. No dependencies,
   ids, ordering fields, or gates yet.
2. **Dependency mapping:** read the cards, add `requires` for each, and assemble
   `.conductor/workflow.json`.

Phase 1 is checked by:

```bash
npx conductor-board cards .conductor/cards.json
```

Phase 2 is checked by:

```bash
npx conductor-board validate .conductor/workflow.json
```

When `.conductor/cards.json` is present next to the conductor file, `validate`
also confirms every card from `cards.json` exists at the same array index in
`workflow.json`.

## Manual vs. Autonomous Execution

There is no required automatic runner. The manual flow stands on its own: an
agent keeps `.conductor/status.json` live with `step`, `check`,
`gate-result`, and `complete` as it works through the cards itself.

On top of that, an **opt-in autonomous execution plane** can drive the same
cards through the same verbs. It does not replace or weaken checking — every card
still produces an artifact and is gated by its own checker before it can reach
done.

### `run-card` — one bounded worker for one card

`conductor-board run-card <card-index>` spawns exactly one non-interactive
worker for one eligible card. A card is eligible when it is `pending` (or
already `running`, claimed by the dispatcher) and every `requires` dependency
is `done`. The worker receives only that card's instruction plus the
dependency artifacts it needs as isolated inputs, does the work, writes the
receipt artifact, then reports its own honest verdict through the normal verbs
(`check` → `gate-result` → `complete`). The worker is bounded: a restricted
tool set, no delegation/sub-spawn, a wall-clock timeout, and a descendant-process
cap enforced by killing the worker process group.

### `dispatch` — the model-free fan-out loop

`conductor-board dispatch` is a dumb, model-free loop. It reads
`status.json` (the source of truth), hands each eligible card to a `run-card`
worker up to a concurrency cap (`--cap`, default `max_concurrency` /
`CONDUCTOR_MAX_CONCURRENCY` / 6), refills slots as workers finish, and reclaims
dead workers by watching the worker **process** (not the heartbeat): a worker
that exits without completing its card resets that card to `pending` for a
re-hand, and a card that crashes past `max_attempts` trips a breaker and is
marked `failed`. The dispatcher claims a card by writing `running` to disk
before spawning the worker, so it is the single writer.

### `fold-card` — durable per-card artifacts

`conductor-board fold-card <card-index>` copies one finished card's receipt and
referenced files into the run directory the instant the card is done, off the
critical path, so per-card results are crash-safe without folding the whole pile.

## Run States

The top-level run carries a status:

- **running** — work is in progress (or eligible to start).
- **paused** — a manual pause (`pause`); distinct from failed. The dispatcher
  idles and hands out no new cards until `resume`.
- **failed** — a card exhausted its attempts; the run stops. The board exposes a
  failed-reason modal with the failure reason and the failed step.
- **done** — every card is terminal and the work is complete.

A **work-timer** accumulates only running time. `elapsed_ms` holds the frozen
total and `running_since` marks the start of the current running interval; the
timer freezes on pause/done/failed (`running_since` cleared) and continues on
resume.

## Timekeeper (`--timing`)

The Timekeeper is opt-in, pure instrumentation. It is enabled only when
`--timing` is passed **and** `CONDUCTOR_TIMING=1` is set; with it off (the
default) behavior is byte-identical and nothing extra is written. When on,
`dispatch` and `run-card` stamp per-card phase boundaries and write a
run-level aggregate (a per-card timing table plus totals) to a timing file
(`.conductor/timing-<run_id>.md` and `.json`). It never changes dispatch,
reclaim, breaker, or claim behavior.

## Learning Across Runs

Conductor improves a workflow over repeated runs. The loop:

1. **Capture.** While working, an agent posts insights with
   `suggest "..." --scope this-conductor`. Human directives and card comments
   are captured the same way.
2. **Accumulate.** Open items collect in `knowledge.json`. When a run is
   archived, its open notes are appended there.
3. **Integrate.** The next `run` applies the open knowledge items automatically:
   the integration ("shaping") cards lead the run on the same board, rewriting
   `cards.json`/`workflow.json`, then the work cards follow — one continuous run.
   Applying is crash-safe (a write-ahead `pending-apply.json` marker makes the
   commit atomic), and a failed integration halts the run cleanly rather than
   running work on a half-integrated plan. `integrate` applies them by hand.
4. **Learn per card.** `learn-card` is the post-card efficiency learner: after a
   card completes it derives an efficiency insight about how the card ran (it
   never changes what the card does).
5. **Backfill.** `backfill-summaries` regenerates clean verdict summaries over a
   run's stored data.
