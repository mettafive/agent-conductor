# Agent Conductor — For Agents

Follow `setup.conductor.json` to get started.

## Core Model

A skill becomes cards on a Kanban board. Every card is independently verified
against its own instruction. Write better instructions, get better verification.
No separate checker configuration needed.

Each card in `conductor.json` has:

```json
{
  "id": "research",
  "title": "Research the treatment",
  "instruction": "Gather at least 4 veterinary sources covering what, when, cost, and owner concerns.",
  "requires": []
}
```

`cards.json` in the card-design phase is a JSON array with objects containing only `id`, `title`, and `instruction`.
The dependency-mapping phase adds `requires` and writes the final conductor.

If a unit of work cannot be independently checked against a concrete instruction,
fold it into a card that can be checked.

## Runtime

There is no automatic runner. You keep `.conductor/status.json` live as you work.

1. Start the board once:

```bash
npx conductor-board &
```

2. Initialize the run:

```bash
npx conductor-board status-init .conductor/conductor.json
```

3. For each card, update status and heartbeat while doing the work:

```bash
npx conductor-board step research running --goal "Gather treatment sources"
npx conductor-board heartbeat research "checking veterinary association guidance" --card
```

4. After producing the card output, run the independent checker. The checker sees
   the card instruction and the output only, then records a PASS/FAIL verdict:

```bash
npx conductor-board check research --output-file .conductor/outputs/research.md
npx conductor-board complete research
```

If `check` reports FAIL, still call `complete` once. `complete` consumes that
failed verdict, increments the attempt counter, and stores the feedback for the
retry.

If completion fails, read the checker feedback, fix the work in the same
environment, then run `check` and `complete` again:

```bash
npx conductor-board feedback research
npx conductor-board check research --output-file .conductor/outputs/research.md
npx conductor-board complete research
```

Calling `complete` without a recorded checker result fails with:

```text
no checker result — run the independent checker first.
```

For v1, `check` uses `OPENAI_API_KEY` when present. Without an LLM key, it falls
back to a basic heuristic: no output fails; recorded output gets a provisional
pass with a warning.

The default circuit breaker is 5 attempts. Set `max_attempts: N` at the top of
`conductor.json` to change it. Checker failures escalate through `feedback`:

```text
Attempt 1/5. Checker found: [reasons]. Fix and retry.
Attempt 2/5. Checker found: [reasons]. Fix and retry.
Attempt 3/5. This card has failed three times. Two attempts remaining before the run stops. Address every point: [reasons].
Attempt 4/5. Final warning. One attempt remaining. Issues: [reasons].
Attempt 5/5. No attempts remaining. Final checker failure: [reasons]
```

On the fifth failed attempt, the card status becomes `failed`, the overall run
status becomes `failed`, and `complete` refuses further retries for that card.

## Board Discipline

Using the board is not optional.

- Update status at every transition: pending, running, checking, passed/failed, done.
- Heartbeat at least once per minute while a card runs.
- Use `--card` when a heartbeat starts a meaningful activity card.
- Before marking a card done, append a final heartbeat with `--final --to <next-card>`.
- Do not work ahead of the board. If you drift, stop, resync, and restart the card cleanly.

## Authoring Rules

- Card ids are kebab-case.
- Titles are short promises a user can scan.
- Instructions must be specific enough for an independent checker to compare output
  against them.
- Dependencies go in `requires`; order emerges from the graph.
- No `gate`, `command`, `agent`, `prompt`, approval, soft, or hard fields.
- Loops and condition cards still need `id`, `title`, `instruction`, and `requires`.

## Validation

```bash
npx conductor-board cards .conductor/cards.json
npx conductor-board validate .conductor/conductor.json
```

`cards` validates the card-design artifact. `validate` checks schema, dependency
references, dependency cycles, loop/condition shape, and card coverage when
`.conductor/cards.json` is present next to the conductor.

## Learnings

At the end of a run, capture useful learnings:

```bash
npx conductor-board suggest "Source coverage must include owner concerns" --scope this-conductor
npx conductor-board knowledge --min 1
```

Phase 0 self-improvement is parked in v3 and runs only when a conductor explicitly
sets `auto_improve: true`.
