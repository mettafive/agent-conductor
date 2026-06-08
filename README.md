# Agent Conductor

**Turn any agent skill into an independently checked, watchable workflow.**

A skill becomes cards on a Kanban board. Every card is independently verified
against its own instruction. Write better instructions, get better verification.
No separate checker configuration needed.

## What It Is

Agent Conductor takes a skill or runbook and turns it into a `workflow.json`.
The agent executes each card, keeps `.conductor/status.json` current, and a local
board shows the run live: pending, running, checking, done.

Visibility is the default. Conductor is for watching agent work happen, not for
silent execution. Use headless mode only for unattended environments such as CI,
cron, cloud/no-display, or when the user explicitly asks for headless/background
execution.

The card schema is intentionally small:

```json
{
  "conductor": "3.0.0",
  "name": "basic-report",
  "description": "Research, then write a sourced report.",
  "max_attempts": 5,
  "steps": [
    {
      "title": "Research",
      "instruction": "Gather at least five credible sources, each with a URL and takeaway.",
      "requires": []
    },
    {
      "title": "Write report",
      "instruction": "Write the report from the research and cite every factual claim.",
      "requires": [0]
    }
  ]
}
```

## Runtime Check

The checker is implicit. For each card:

> The agent was asked to do X. Here is what it produced. Did it satisfy X?

For v3, `check` prints the instruction/output comparison prompt. Evaluate it in
a clean context, then record the verdict. Checker evidence should include a
dashboard line that starts with `SUMMARY:`:

The output passed to `check` must be the actual work product or a verifiable
action record. Content cards should show the content, code, data, diff, source
list, or report. Action cards should show command/script run, return value,
changed resource, and verification result. A report that merely describes what
the agent did should fail.

Completion also requires a durable markdown receipt under `.conductor/artifacts/`.
`complete` refuses to move a card to Done unless the checker passed and the
card has the required browsable artifact file: `.conductor/artifacts/<card>.md`.
For images, screenshots, PDFs, uploads, or deployments, that artifact is still
the human-readable markdown receipt. Images from the card should be embedded
inline with markdown image syntax, while the underlying image files remain
supporting files in `.conductor/artifacts/`.

Updates are narration for the board, not proof. Proof lives in the artifact:
content/code/data for creation cards, or command/return/changed-resource/
verification evidence for action cards.

```bash
npx conductor-board check 0 --output-file .conductor/artifacts/0.md
npx conductor-board gate-result 0 --passed --evidence "PASS ...\nSUMMARY: ..."
npx conductor-board complete 0
```

`complete` fails without a recorded checker result:

```text
no checker result — run the independent checker first.
```

## Authoring Flow

`setup.conductor.json` uses two phases:

1. **Card design:** skill to `.conductor/cards.json` with only `title` and
   `instruction` (array index is identity).
2. **Dependency mapping:** add `requires` and assemble `.conductor/workflow.json`.

Validate them with:

```bash
npx conductor-board cards .conductor/cards.json
npx conductor-board validate .conductor/workflow.json
```

Before executing cards, initialize the visible board:

```bash
npx conductor-board init-board .conductor/workflow.json
```

Headless is opt-in:

```bash
npx conductor-board init-board .conductor/workflow.json --headless
```

## Quick Start

```bash
npx conductor-board
```

Then point your agent at [`CONDUCTOR.md`](./CONDUCTOR.md) or
[`setup.conductor.json`](./setup.conductor.json).

Useful commands:

```bash
npx conductor-board init
npx conductor-board compile --skill SKILL.md
npx conductor-board decompose --skill SKILL.md
npx conductor-board cards .conductor/cards.json
npx conductor-board order --cards .conductor/cards.json --out .conductor/workflow.json
npx conductor-board validate .conductor/workflow.json
npx conductor-board status-init .conductor/workflow.json
npx conductor-board check <card> --output-file .conductor/artifacts/<card>.md
npx conductor-board gate-result <card> --passed --evidence "checked output"
npx conductor-board complete <card>
npx conductor-board feedback <card>
```

`compile` is the normal starting point for a run: it reuses an accepted cached
workflow skeleton for unchanged skills, or runs `decompose`, `order`,
`order-audit`, and `validate` before saving the accepted skeleton.

`decompose` is model-first: a composer model creates candidate cards, an
independent checker model audits them against the original skill, and failures
loop back for repair. `order` uses the same composer/checker loop for the
dependency graph, rejecting lazy linearization and preserving parallelism. Both
use local `codex exec` by default; there is no heuristic fallback.

Examples live in [`examples/`](./examples), templates in [`templates/`](./templates),
and the full schema is in [`spec/conductor-spec.md`](./spec/conductor-spec.md).
