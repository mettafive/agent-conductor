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
npx conductor-board check 0 --output-file .conductor/outputs/0.md
npx conductor-board gate-result 0 --passed --evidence "PASS ...\nSUMMARY: ..."
npx conductor-board complete 0
npx conductor-board feedback 0
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

The board expects JSON. A workflow card has `title`, `instruction`, and
`requires`; array index is the card identity.

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
      "requires": []
    },
    {
      "title": "Write report",
      "instruction": "Write the report from the research and cite factual claims.",
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
npx conductor-board check 0 --output-file .conductor/outputs/0.md
npx conductor-board gate-result 0 --passed --evidence "PASS ...\nSUMMARY: ..."
npx conductor-board complete 0
```

`check` prints the universal checker prompt. A separate checker evaluates the
card output against the card instruction, then records a verdict with
`gate-result`. `complete` consumes that verdict. If the verdict failed, the card
stays running and `feedback` returns the checker evidence for retry.

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
