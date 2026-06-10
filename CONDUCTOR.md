# Agent Conductor — For Agents

Follow `setup.conductor.json` to get started.

## Core Model

A skill becomes cards on a Kanban board. Every card is independently verified
against its own instruction. Write better instructions, get better verification.
No separate checker configuration needed.

Each card in `workflow.json` has:

```json
{
  "title": "Research the treatment",
  "instruction": "Gather at least 4 veterinary sources covering what, when, cost, and owner concerns.",
  "summary": "Researches the treatment from veterinary sources. Produces a sourced reference covering what it is, when it is needed, typical cost, and common owner concerns.",
  "requires": []
}
```

`cards.json` in the card-design phase is a JSON array of objects with `title`, `instruction`, and a generated `summary`.
The dependency-mapping phase adds integer `requires` and writes the final workflow.

If a unit of work cannot be independently checked against a concrete instruction,
fold it into a card that can be checked.

## Glossary

- **Card:** one verifiable unit of work on the board.
- **Instruction:** what the agent must do; this is what the checker evaluates.
- **Summary:** a short plain-language line about the card for the board. Generated, not user-authored: the composer writes an intent summary at `decompose`; the checker writes an outcome summary at verification.
- **Artifact:** the durable markdown receipt the card produced: `.conductor/artifacts/<card-index>-<slugified-card-title>.md`.
- **Update:** agent narration shown on the board; never proof of completion.
- **Checker:** independent evaluator comparing the instruction to the artifact.

## Runtime

### The one command (start here)

To take a skill from any state to a finished run with a visible board, use a
single command — it compiles if needed, picks the worker, opens the board, and
dispatches:

```bash
npx conductor-board run SKILL.md
```

`run` follows one rule against the run's `status.json`: **run everything that
isn't done; if everything's done, rerun fresh.** A re-run reuses the compiled
workflow and skips done cards, so only a new or edited skill pays the first
compile. The worker (`claude` / `codex` / `CONDUCTOR_WORKER_CMD`) is chosen
automatically and printed; with none on PATH, `run` fails loud. See
[`board/START.md`](board/START.md) for prerequisites and gotchas.

`run` is the supported path. The manual verbs below still exist for driving one
phase in isolation, and are what `run` orchestrates internally.

### Driving phases by hand

You keep `.conductor/status.json` live as you work.

1. Initialize the visible board for this workflow:

```bash
npx conductor-board init-board .conductor/workflow.json
```

`init-board` runs `status-init`, starts or reuses the board server, opens the
browser, checks `/health`, and confirms the board is serving the current workflow
name.

Do not begin card execution until `init-board` confirms the board is live and
showing the current workflow.

Visibility is the default. Users install Conductor to watch the workflow happen.
Only use headless mode when the run is unattended (CI, cron, cloud/no-display)
or when the user explicitly asks for headless/background execution:

```bash
npx conductor-board init-board .conductor/workflow.json --headless
# or
CONDUCTOR_HEADLESS=1 npx conductor-board init-board .conductor/workflow.json
```

2. For each card, update status and write progress updates while doing the work:

```bash
npx conductor-board step 0 running --goal "Gather treatment sources"
npx conductor-board update 0 "Found AVMA and university guidance; comparing cost ranges and owner concerns before drafting."
```

3. After producing the card artifact, save the primary markdown receipt as
   `.conductor/artifacts/<card-index>-<slugified-card-title>.md`, then run `check` to print the
   independent checker prompt. The checker sees the card instruction and artifact
   only. Evaluate that prompt in a clean context, then record the PASS/FAIL
   verdict:

```bash
npx conductor-board check 0 --output-file .conductor/artifacts/0-research.md
npx conductor-board gate-result 0 --passed --evidence "PASS ..."
npx conductor-board complete 0
```

If the checker fails, record the failed verdict with `gate-result --failed`, then
call `complete` once. `complete` consumes that failed verdict, increments the
attempt counter, and stores the feedback for the retry.

If completion fails, read the checker feedback, fix the work in the same
environment, then run `check`, record the verdict, and complete again:

```bash
npx conductor-board feedback 0
npx conductor-board check 0 --output-file .conductor/artifacts/0-research.md
npx conductor-board gate-result 0 --passed --evidence "PASS ..."
npx conductor-board complete 0
```

Calling `complete` without a recorded checker result fails with:

```text
no checker result — run the independent checker first.
```

Calling `complete` with a passed checker result but no durable artifact fails
too. Done means both requirements are true: the independent checker passed, and
the card has a browsable artifact in `.conductor/artifacts/`.

`check` prints the universal checker prompt: the card instruction on the left
and the produced output on the right. Evaluate that prompt in a clean context,
then record the verdict with `gate-result`. If there is no output at all,
`check` records a failure with evidence `no output was produced.`

`gate-result <step>[::iter::sub] --passed|--failed [--evidence "..."]` records the
verdict. It also accepts `--summary`, `--made`, and `--checked` (one complete
sentence each) to set the three human display lines the board shows; any line you
omit is generated from `--evidence`. The `--summary` you pass here is the card's
outcome summary.

The artifact must be either the actual work product or a verifiable action
record. If the artifact merely describes what was done without proof, the checker
must fail immediately.

Use `.conductor/artifacts/<card-index>-<slugified-card-title>.md` as the required primary artifact path.
The markdown receipt must contain one of:

- **Work product:** the actual content, code, data, diff, report, source list,
  or decision the card produced.
- **Action record:** command/script run, timestamp, inputs, return value,
  changed resource, affected rows/files/URLs, and verification query/curl/test
  result.
- **Non-text work:** keep `.conductor/artifacts/<card-index>-<slugified-card-title>.md` as the primary
  artifact. Put every image from that card inline in the receipt with markdown
  image syntax, for example `![Alt text](7-treatment-image.webp)`. List
  screenshots, PDFs, uploads, CSV, JSON, HTML previews, or other files as
  supporting assets with the proof needed to inspect them. The receipt is the
  artifact; non-text files are supporting files referenced by it.

Pass the artifact to `check` with `--output-file`; the board will show that
artifact. Progress updates are narration for the board; they are never the card
artifact.

The default circuit breaker is 5 attempts. Set `max_attempts: N` at the top of
`workflow.json` to change it. Checker failures escalate through `feedback`:

```text
Attempt 1/5. Checker found: [reasons]. Fix and retry.
Attempt 2/5. Checker found: [reasons]. Fix and retry.
Attempt 3/5. This card has failed three times. Two attempts remaining before the run stops. Address every point: [reasons].
Attempt 4/5. Final warning. One attempt remaining. Issues: [reasons].
Attempt 5/5. No attempts remaining. Final checker failure: [reasons]
```

On the fifth failed attempt, the card status becomes `failed`, the overall run
status becomes `failed`, and `complete` refuses further retries for that card.

## Autonomous Execution (opt-in)

The manual runtime above is always available. Alongside it, an opt-in execution
plane can drive the same cards through the same verbs. It does not skip checking:
every card still produces an artifact and is gated by its own checker before it
can reach done.

- `run-card <card-index>` spawns one bounded, non-interactive worker for one
  eligible card (the card is `pending`/`running` and all `requires` are `done`).
  The worker gets only that card's instruction plus its dependency artifacts as
  isolated inputs, does the work, writes the receipt, and reports its own honest
  verdict via `check` → `gate-result` → `complete`. It runs under a restricted
  tool set (no delegation/sub-spawn), a wall-clock timeout, and a descendant
  process cap.
- `dispatch` is a model-free loop: it hands eligible cards to `run-card` workers
  up to a concurrency cap (`--cap`, default `max_concurrency` /
  `CONDUCTOR_MAX_CONCURRENCY` / 6), refills as workers finish, and reclaims dead
  workers by watching the worker process (not the heartbeat). A worker that exits
  without completing its card resets it to `pending`; a card past `max_attempts`
  trips the breaker and is marked `failed`. `status.json` stays the source of
  truth.
- `fold-card <card-index>` copies a finished card's receipt and referenced files
  into the run directory the moment the card is done.

```bash
npx conductor-board run-card 0
npx conductor-board dispatch --cap 4
```

### Run states and the work-timer

The top-level run is **running**, **paused**, **failed**, or **done**:

- `pause` sets the run to `paused` (distinct from failed): the dispatcher idles
  and hands out no new cards. `resume` returns it to `running`.
- A card that exhausts its attempts sets the run to `failed`; the board shows a
  failed-reason modal with the failure reason and the failed step.

A work-timer accumulates only running time. `elapsed_ms` is the frozen total and
`running_since` marks the current running interval; the timer freezes on
pause/done/failed and continues on resume.

### Timekeeper (`--timing`)

The Timekeeper is opt-in pure instrumentation: enabled only with `--timing` AND
`CONDUCTOR_TIMING=1`. Off by default = byte-identical behavior, no extra writes.
When on, `dispatch`/`run-card` stamp per-card phase boundaries and write a
run-level aggregate (per-card timing table + totals) to a timing file. It never
changes dispatch, reclaim, breaker, or claim behavior.


## Board Discipline

Using the board is not optional.

- Do not begin card execution until `init-board` confirms the board is live and showing the current workflow.
- Visible board is the default. Use `--headless` / `CONDUCTOR_HEADLESS=1` only for unattended runs or an explicit user request.
- Update status at every transition: pending, running, checking, passed/failed, done.
- Write progress updates as Codex-style preambles: concise notes that bring the user along while work is happening.
- Group related actions into one update instead of writing a note for every tiny read, command, or edit.
- Keep updates to 1-2 sentences. For quick updates, aim for 8-12 words.
- Build on prior context: say what you learned so far and what it implies for the next action.
- Avoid updates for trivial reads unless they are part of a larger grouped action.
- Do not write status-log updates like "drafting hero", "checking", "running tests", or "checker passed." The board already shows system status.
- Before marking a card done, append a final update with `--handoff --to <next-card>` that says what the next card needs to know.
- Do not work ahead of the board. If you drift, stop, resync, and restart the card cleanly.

Use `conductor-board update` for agent narration. `heartbeat` remains as a
backwards-compatible alias, but the product language is update.

Good updates:

```text
README still describes explicit gates, so I am rewriting the quick start around instruction-based checking.
Choosing "verified cards" over "gates" because v3 no longer has gate fields.
The checker needs actual before/after copy, not a report, so the output file must contain the work itself.
Handing off: package metadata now matches v3; next card should verify docs examples use workflow.json.
```

Bad updates:

```text
reading README
drafting hero
running tests
checker passed
```

## Authoring Rules

- Titles are short promises a user can scan.
- Instructions must be specific enough for an independent checker to compare output
  against them.
- Card design uses the same independent-check pattern as runtime execution:
  compose cards from the skill, check the cards against the original skill, repair
  on failure, and keep `.conductor/decomposition-check.json` as the audit trail.
- Rules, constraints, examples, warnings, and output formats are not cards by
  themselves. Fold them into the relevant card instructions.
- Card identity is the array index. Do not add `id` fields.
- Dependencies go in `requires`; order emerges from the graph.
- No `gate`, `command`, `agent`, `prompt`, approval, soft, or hard fields.
- Loops still need `title`, `instruction`, and `requires`.
- There is no `condition` field and no condition card type. Situational work
  belongs inside the instruction. The card still executes and its artifact must
  prove either the work was needed and done, or no action was needed and why.

## Validation

```bash
npx conductor-board cards .conductor/cards.json
npx conductor-board validate .conductor/workflow.json
```

`cards` validates the card-design artifact. `validate` checks schema, dependency
references, dependency cycles, loop shape, and card coverage when
`.conductor/cards.json` is present next to the conductor.

## Learnings

Conductor learns across runs. While working, post insights as you find them; at
the end of a run, capture anything still useful:

```bash
npx conductor-board suggest "Source coverage must include owner concerns" --scope this-conductor
npx conductor-board knowledge --min 1
```

Suggestions (plus human directives and card comments) accumulate in
`knowledge.json`. Archiving a run appends its open notes. On the next `run`, the
open items are applied automatically as the **integration ("shaping") cards** —
they lead the run on the same board, rewriting the plan, and the work cards flow
after, in one continuous run with no separate confirm. A failed integration is a
visible failed shaping card that halts the run cleanly (work never runs on a
half-integrated plan), and applying is crash-safe (a write-ahead
`pending-apply.json` marker makes the commit atomic, so a crash can never
re-apply the same insights). To apply them by hand instead:

```bash
npx conductor-board integrate --dir .conductor/<workflow-name>
```

Two more learners run over stored data:

```bash
# post-card efficiency learner (how the card ran; never changes what it does)
npx conductor-board learn-card <card> --path .conductor/status.json --workflow .conductor/workflow.json
# one-shot regeneration of clean verdict summaries in a run's stored data
npx conductor-board backfill-summaries .conductor/status.json
```

Phase 0 self-improvement is parked in v3 and runs only when a conductor explicitly
sets `auto_improve: true`.
