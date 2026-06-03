<div align="center">

# 🎼 Agent Conductor

**Stop agents from skipping steps.**

A portable spec and a live local Kanban board for orchestrating AI agent
workflows with gated steps. Hand any agent a `conductor.yaml`, and every step
must pass its gate before the next one unlocks.

[Docs](https://mettafive.github.io/agent-conductor) ·
[Spec](./spec/conductor-spec.md) ·
[Examples](./examples) ·
[MIT](./LICENSE)

</div>

> **🤖 Agent?** Skip the docs. Read [`setup.conductor.yaml`](./setup.conductor.yaml)
> and execute it — it verifies the environment, starts the board, converts the
> user's skill into a gated workflow, validates it, and runs it.

---

## What it is

Agent Conductor is a single YAML file you hand to any agent — Claude Code, Codex,
Hermes, whatever — that breaks a task into **discrete steps with validation
gates**. The agent reads the file, executes the steps in order, self-validates
against each gate, and writes its progress to `.conductor/status.json`. Run
`npx conductor-board` and a local board lights up in real time as it works.

**Zero dependencies for the spec.** No SDK, no API wrapper, no runtime. The
conductor file is the whole contract.

## The problem

You hand an agent twelve steps and hope. Somewhere around step seven it decides
the rest is implied, declares victory, and hands you a half-finished thing that
*looks* done. Long workflows rot because nothing forces the agent to actually
clear each bar before moving on.

## The solution

**Gated steps.** Each step carries a gate — a set of criteria that must all pass
before the next step unlocks. Gates come in two flavors:

- **Soft gates** — plain-language criteria the agent self-validates
  (*"reads naturally"*, *"no placeholder text remains"*). Taste and intent.
- **Hard gates** — executable `check`s that must exit `0`
  (`npm test`, `test -f report.md`). Facts, not vibes.

If a gate fails, the agent **retries the step — it never skips it**. Conditions
add `if/else` branching; outputs pass data downstream; a live Kanban board shows
the whole thing executing.

## Quick start

Write a conductor:

```yaml
conductor: 1.0.0
name: basic-report
description: Research, outline, write, review.

inputs:
  - topic

steps:
  - id: research
    instruction: |
      Research {topic}. Gather at least five credible sources.
    gate:
      - "At least 5 sources, each with a URL and takeaway"

  - id: write
    instruction: |
      Write an 800-word report from the research, citing every claim.
    requires: [research]
    gate:
      - "Every claim cites a source"
      - "No placeholder text remains"
      - check: "test -f report.md"   # hard gate — must exist
```

Hand it to your agent:

```
Execute this conductor. Save it to .conductor/conductor.yaml, maintain
.conductor/status.json as you go, validate every gate before advancing,
and retry — never skip — on failure.
```

Start the board *first*, then point your agent at the conductor — it writes both
files into `.conductor/` and the board lights up on its own.

> **Or skip the manual setup** — point your agent at
> **[CONDUCTOR.md](./CONDUCTOR.md)** and let it handle everything: converting your
> skill into a conductor, saving it, and maintaining the status file.

Watch it run:

```bash
npx conductor-board      # local Kanban board on http://localhost:3042
```

## CLI

```bash
npx conductor-board                        # serve the live board
npx conductor-board init                   # scaffold a .conductor/conductor.yaml
npx conductor-board validate <file>        # check a conductor against the spec
```

`init --name <name> --steps <n>` scaffolds non-interactively. `validate` checks
required keys, unique ids, well-formed gates, condition/loop shape, dangling
references, dependency cycles, and unreachable steps.

> Prefer fewer keystrokes? `npx 3042` is an alias for `npx conductor-board`.

**Run several workflows at once** by giving each its own subdirectory —
`.conductor/<name>/conductor.yaml` + `status.json`. The board shows them as
grouped, switchable workflows (the flat `.conductor/status.json` still works).

The board watches `.conductor/status.json` and updates automatically as the agent
moves through **Pending → Running → Gate Check → Done** (and **Failed**, when a
gate can't be satisfied).

## How it works

```
 conductor.yaml  ─►  agent reads + executes  ─►  .conductor/status.json
                          (gates each step)              │
                                                         ▼
                                            npx conductor-board (live board)
```

1. The agent creates `.conductor/status.json` with every step `pending`.
2. It walks the steps in order, executing each instruction.
3. After each step it evaluates the gate — runs every `check`, self-validates
   every soft criterion.
4. All pass → the step goes `done` and the next unlocks. Any fail → it retries.
5. Conditions route the flow; outputs feed downstream steps.

## Examples

| Example | Pattern | Shows |
| --- | --- | --- |
| [`basic-report.yaml`](./examples/basic-report.yaml) | Linear | Gates, inputs, output passing |
| [`treatment-page.yaml`](./examples/treatment-page.yaml) | Branching | `condition`, `if_true`/`if_false`, `then` rejoin |
| [`code-review.yaml`](./examples/code-review.yaml) | Gates-heavy | Multiple conditions, mixed soft + hard gates |
| [`batch-review.yaml`](./examples/batch-review.yaml) | Loop | `type: loop` over a list, per-iteration gated sub-steps |

## The spec

The full format — steps, gates, conditions, output passing, the status file, and
the execution contract — lives in **[`spec/conductor-spec.md`](./spec/conductor-spec.md)**.

## Roadmap

- **Phase 1 — Spec + docs site.** ✅ Live at the [docs site](https://mettafive.github.io/agent-conductor).
- **Phase 2 — Local Kanban board.** ✅ [`board/`](./board) — `npx conductor-board`
  serves a live board that watches `.conductor/status.json` over Server-Sent
  Events. The board server runs on Node's standard library alone.
- **Phase 2.5 — Run history.** ✅ Completed and failed runs are archived to
  `.conductor/history/`; the board's sidebar browses past runs and freezes any
  one to its final state.
- **Phase 3 — npm package.** ✅ Published as
  [`conductor-board`](https://www.npmjs.com/package/conductor-board) —
  `npx conductor-board` serves the board, `init` scaffolds a conductor, and
  `validate` checks one against the spec. Plus [CONDUCTOR.md](./CONDUCTOR.md), the
  self-contained file you point any agent at.
- **Phase 4 — self-bootstrapping setup.** ✅ Point any agent at
  [`setup.conductor.yaml`](./setup.conductor.yaml) and it sets up, converts your
  skill, validates, and runs it. Plus a [`templates/`](./templates) library.
- **Phase 5 — multi-workflow workspace + self-improvement.** ✅ Run many workflows
  side by side; **heartbeats** carry **insights** that become **optimization
  suggestions** you apply back to the conductor — the workflow is refined by its
  own execution history. The board makes the heartbeat its center: a beating heart
  that weakens when an agent goes quiet, a live **heartbeat monitor** that streams
  every beat character by character, and per-step timelines with **finalBeat**
  handoffs that pass context cleanly from one step to the next.
- **Phase 5.1 — discipline + memory.** ✅ The board now actively enforces the
  contract: one board per run (re-running reuses it, no tab pile-up), a red
  **"Freeballing?"** banner when an agent works without updating the board, and a
  persistent **insights ledger** (`.conductor/insights.md`) that accumulates
  learnings across runs so they stop evaporating — commit it and the workflow's
  memory travels with the repo.

## Design principles

1. **Zero friction** — understandable in under 30 seconds.
2. **Portable** — no lock-in to any agent, model, or framework.
3. **Beautiful** — every surface demonstrates craft.
4. **Open** — MIT, community-first.

## License

[MIT](./LICENSE) © mettafive
