# conductor-board

The CLI and live local Kanban board for [Agent Conductor](../README.md).
It watches `.conductor/status.json`, reads `.conductor/workflow.json`, and
shows a workflow moving through **Pending → Running → Checking → Done**.

```bash
npx conductor-board
```

```text
conductor-board
Board live at http://localhost:3042 — watching .conductor/status.json
```

## Commands

```bash
npx conductor-board                         # serve the live board
npx conductor-board init                    # scaffold .conductor/workflow.json
npx conductor-board compile --skill SKILL.md
npx conductor-board decompose --skill SKILL.md
npx conductor-board cards .conductor/cards.json
npx conductor-board order --cards .conductor/cards.json --out .conductor/workflow.json
npx conductor-board validate .conductor/workflow.json
npx conductor-board status-init .conductor/workflow.json
npx conductor-board check 0 --output-file .conductor/artifacts/0-research.md
npx conductor-board gate-result 0 --passed --evidence "PASS ...\nSUMMARY: ..."
npx conductor-board complete 0
npx conductor-board feedback 0
npx conductor-board integrate --dir .conductor/<workflow-name>   # apply open knowledge before a repeat run
npx conductor-board learn-card 0 --path .conductor/status.json --workflow .conductor/workflow.json
npx conductor-board backfill-summaries .conductor/status.json

# autonomous execution plane (opt-in; runs beside the manual flow above)
npx conductor-board run-card 0 --path .conductor/status.json --workflow .conductor/workflow.json   # run one eligible card in a bounded worker
npx conductor-board dispatch  --path .conductor/status.json --workflow .conductor/workflow.json --cap 6  # fan out eligible cards, refill + reclaim
npx conductor-board pause     --path .conductor/status.json   # hold the run (dispatcher idles, work-timer freezes)
npx conductor-board resume    --path .conductor/status.json   # resume (work-timer continues)
```

`compile` is the normal starting point for a run: it reuses an accepted cached
workflow skeleton for unchanged skills, or runs `decompose`, `order`,
`order-audit`, and `validate` before saving the accepted skeleton.

`decompose` is model-first. A composer model creates candidate cards, an
independent checker model audits them against the original skill, and failures
loop back for repair. `order` uses the same model/checker repair loop for
requires arrays, rejecting lazy linearization and preserving parallel work. Both
use local `codex exec` by default; override with `CONDUCTOR_DECOMPOSE_COMMAND`
or disable Codex with `CONDUCTOR_DECOMPOSE_CODEX=0` and use `OPENAI_API_KEY`.
There is no heuristic fallback.

Conductor learns across runs: agents post insights with `suggest`, which (with
human directives and comments) accumulate in `knowledge.json`; `integrate`
applies the open items to the cards before a repeat run.

## Autonomous execution (opt-in)

Beyond driving cards by hand (`step` / `check` / `gate-result` / `complete`), the
board ships a model-free execution plane that runs cards for you:

- `run-card <id>` runs one eligible card in a single bounded worker process.
- `dispatch` is a dumb loop that hands eligible cards to `run-card` workers up to a
  concurrency cap, refills as they finish, and reclaims a worker that dies. It is
  not a model — quality is still gated by each card's own checker.
- `fold-card` folds a finished card's artifacts into the run snapshot off the
  critical path; the run-end consolidation is idempotent.

Run states: a run is `running`, `paused` (a manual `pause`, distinct from failed —
the dispatcher idles and the work-timer freezes), `failed` (with the reason
surfaced on the board), or `done`. The work-timer accumulates only running time:
it freezes on pause/done/failed and continues on resume.

`--timing` (together with `CONDUCTOR_TIMING=1`) enables the Timekeeper: per-card
phase timing plus a run-level aggregate written to a timing file. It is off by
default, and default behavior is byte-identical without it.

## What It Does

- Serves a local React board and streams status changes over Server-Sent Events.
- Merges live `status.json` with `workflow.json` so every card shows its title,
  instruction-derived status, attempt count, and checker summary.
- Renders a monochrome Kanban board with small LED status dots and Framer Motion
  card transitions.
- Shows a completion timeline when a run finishes, with one row per card in
  completion order.
- Archives completed and failed runs under `.conductor/history/`.

## Workflow Format

The board expects JSON. A workflow card has `title`, `instruction`, `summary`,
and `requires`; array index is the card identity. `summary` is generated (the
composer writes an intent summary, the checker an outcome summary), not
hand-authored.

```json
{
  "conductor": "3.0.0",
  "name": "basic-report",
  "description": "Research, then write a report.",
  "max_attempts": 5,
  "steps": [
    {
      "title": "Research",
      "instruction": "Gather at least five credible sources with URLs and takeaways.",
      "summary": "Researches the topic and collects credible sources with URLs and takeaways for the report card.",
      "requires": []
    },
    {
      "title": "Write report",
      "instruction": "Write the report from the research and cite factual claims.",
      "summary": "Writes the report from the research and cites every factual claim back to a source.",
      "requires": [0]
    }
  ]
}
```

There is no `gate` field. Every card is checked against its own instruction.

## Runtime Flow

Agents keep the board live by writing status as they work:

```bash
npx conductor-board step 0 running
npx conductor-board check 0 --output-file .conductor/artifacts/0-research.md
npx conductor-board gate-result 0 --passed --evidence "PASS ...\nSUMMARY: ..."
npx conductor-board complete 0
```

`check` prints the universal checker prompt. A separate checker evaluates the
card output against the card instruction, then records a verdict with
`gate-result`. `complete` consumes that verdict. If the verdict failed, the card
stays running and `feedback` returns the checker evidence for retry.

`gate-result` accepts `--passed|--failed` with `--evidence`, plus `--summary`,
`--made`, and `--checked` to set the three human display lines the board shows
(any omitted line is generated from `--evidence`).

The output passed to `check` must be the actual work product. If it only
describes what the agent did instead of showing the content, code, data, diff,
source list, or other produced artifact, the checker should fail it immediately.

Lifecycle commands automatically write system update events, so card detail
never loses transition context:

- `step <card> running` → `Started: <title>`
- `check <card>` → `Checking: <title>`
- `complete <card>` on pass → `Passed: <title>`
- `complete <card>` on fail → `Failed attempt N/5: <evidence>`

## Board UI

During a live run, the main view is the Kanban board:

- **Pending**: cards waiting for dependencies.
- **Running**: the current work card.
- **Checking**: output is being independently checked.
- **Done**: checker passed.
- **Failed**: appears only when a card exhausts attempts.

When the run is complete, the default view switches to a completion timeline.
Use the `Summary / Board` toggle to inspect either the receipt-style timeline or
the final Kanban columns.

The bottom bar is intentionally minimal: a heart icon, one streaming update line,
and card progress.

## Options

| Flag | Default | Description |
| --- | --- | --- |
| `--path`, `-p` | `.conductor/status.json` | Path to the status file |
| `--workflow`, `-c` | auto-discovered | Path to `workflow.json` |
| `--port` | `3042` | Port to serve on, walking forward if taken |
| `--headless` | false | Opt in to unattended execution without opening a browser. Use only for CI, cron, cloud/no-display, or explicit user request. |
| `--help`, `-h` | - | Show help |

```bash
npx conductor-board --path ./run/status.json --workflow ./run/workflow.json --port 3001
```

## Develop

```bash
npm install
npm run build
npm run test:features
npm run test:loops
npm start
```

Dev simulations are available for exercising the board without an agent:

```bash
npm run simulate -- ../examples/basic-report.json
npm run simulate -- ../examples/batch-review.json --fail critique
```
