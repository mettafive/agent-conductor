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

---

## What it is

Agent Conductor is a single YAML file you hand to any agent — Claude Code, Codex,
Hermes, whatever — that breaks a task into **discrete steps with validation
gates**. The agent reads the file, executes the steps in order, self-validates
against each gate, and writes its progress to `.conductor/status.json`. Run
`npx agent-conductor` and a local board lights up in real time as it works.

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
Execute this conductor. Maintain .conductor/status.json as you go,
validate every gate before advancing, and retry — never skip — on failure.
```

Watch it run:

```bash
npx agent-conductor      # local Kanban board on http://localhost:3000
```

The board watches `.conductor/status.json` and updates automatically as the agent
moves through **Pending → Running → Gate Check → Done** (and **Failed**, when a
gate can't be satisfied).

## How it works

```
 conductor.yaml  ─►  agent reads + executes  ─►  .conductor/status.json
                          (gates each step)              │
                                                         ▼
                                            npx agent-conductor (live board)
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

## The spec

The full format — steps, gates, conditions, output passing, the status file, and
the execution contract — lives in **[`spec/conductor-spec.md`](./spec/conductor-spec.md)**.

## Roadmap

- **Phase 1 — Spec + docs site.** ✅ This repo.
- **Phase 2 — Local Kanban board.** `npx agent-conductor` serves a live board
  that watches the status file.
- **Phase 3 — npm package.** `init` scaffolds a conductor, `validate` checks one
  against the spec.

## Design principles

1. **Zero friction** — understandable in under 30 seconds.
2. **Portable** — no lock-in to any agent, model, or framework.
3. **Beautiful** — every surface demonstrates craft.
4. **Open** — MIT, community-first.

## License

[MIT](./LICENSE) © mettafive
