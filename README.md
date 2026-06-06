# Agent Conductor

**Turn any agent skill into an independently checked, watchable workflow.**

A skill becomes cards on a Kanban board. Every card is independently verified
against its own instruction. Write better instructions, get better verification.
No separate checker configuration needed.

## What It Is

Agent Conductor takes a skill or runbook and turns it into a `conductor.json`.
The agent executes each card, keeps `.conductor/status.json` current, and a local
board shows the run live: pending, running, checking, done.

The card schema is intentionally small:

```json
{
  "conductor": "3.0.0",
  "name": "basic-report",
  "description": "Research, then write a sourced report.",
  "max_attempts": 5,
  "steps": [
    {
      "id": "research",
      "title": "Research",
      "instruction": "Gather at least five credible sources, each with a URL and takeaway.",
      "requires": []
    },
    {
      "id": "write-report",
      "title": "Write report",
      "instruction": "Write the report from the research and cite every factual claim.",
      "requires": [
        "research"
      ]
    }
  ]
}
```

## Runtime Check

The checker is implicit. For each card:

> The agent was asked to do X. Here is what it produced. Did it satisfy X?

For v3, an external checker records the verdict:

```bash
npx conductor-board check research --output-file .conductor/outputs/research.md
npx conductor-board complete research
```

`complete` fails without a recorded checker result:

```text
no checker result — run the independent checker first.
```

## Authoring Flow

`setup.conductor.json` uses two phases:

1. **Card design:** skill to `.conductor/cards.json` with only `id`, `title`, and
   `instruction`.
2. **Dependency mapping:** add `requires` and assemble `.conductor/conductor.json`.

Validate them with:

```bash
npx conductor-board cards .conductor/cards.json
npx conductor-board validate .conductor/conductor.json
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
npx conductor-board validate .conductor/conductor.json
npx conductor-board status-init .conductor/conductor.json
npx conductor-board heartbeat <card> "working note" --card
npx conductor-board gate-result <card> --passed --evidence "checked output"
npx conductor-board complete <card>
```

Examples live in [`examples/`](./examples), templates in [`templates/`](./templates),
and the full schema is in [`spec/conductor-spec.md`](./spec/conductor-spec.md).
