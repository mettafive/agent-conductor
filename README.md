<div align="center">

# 🎼 Agent Conductor

**Turn any agent skill into a gated, watchable workflow.**

A skill becomes a `conductor.yaml` of steps with **gates**; an agent runs it, and a
live local board — kanban columns plus a heartbeat stream — shows it move in real
time. Fail a gate, fix it, retry. Never skip.

[Docs](https://mettafive.github.io/agent-conductor) ·
[For agents — CONDUCTOR.md](./CONDUCTOR.md) ·
[Spec](./spec/conductor-spec.md) ·
[Examples](./examples) ·
[MIT](./LICENSE)

</div>

> **🤖 Agent?** Skip the prose. Read [`CONDUCTOR.md`](./CONDUCTOR.md) — or point
> yourself at [`setup.conductor.yaml`](./setup.conductor.yaml) and execute it. It
> verifies the environment, starts the board, converts the user's skill into a
> gated workflow, red-teams the gates, gets them human-approved, and runs it.

---

## What it is

Agent Conductor takes a skill — the kind you'd hand an agent as a runbook — and
turns it into a workflow of **discrete steps, each behind a gate**. The agent reads
the conductor file, executes the steps in order, validates every gate before
advancing, and writes its progress to `.conductor/status.json`. Run
`npx conductor-board` and a local board lights up: cards move through
**Pending → Running → Gate Check → Done**, and a heartbeat terminal streams the
agent narrating itself as it works.

**Zero dependencies for the spec.** No SDK, no API wrapper, no runtime. The
conductor file is the whole contract; the board just watches a JSON file and redraws.

## The problem

You hand an agent twelve steps and hope. Somewhere around step seven it decides the
rest is implied, declares victory, and gives you a half-finished thing that *looks*
done. Long workflows rot because nothing forces the agent to actually clear each bar
before moving on — and you can't watch it happen, so you find out at the end.

## The solution

**Gates that are real, not lint — proven before they ever run.**

A gate is only worth the run if it would actually *fail bad work*. The common failure
is writing a gate as a lint: it confirms the output didn't crash and has the right
shape, then passes anything that renders. That's a formatter, not a gate. Conductor's
authoring bar holds every gate to a higher standard:

- **Check substance, not surface** — *is it correct, faithful, complete?*, not *did
  it render?* Output can be perfectly well-formed and completely wrong.
- **Cross-validate the dimensions against each other** — the FAQ price matches the
  body matches the database, and the source backs the claim sitting beside it.
  Per-field checks in isolation miss every inconsistency *between* fields.
- **No self-widening loopholes** — a threshold can't be relaxed by a side-effect of
  the work it's judging. The thing being judged can't move the bar.
- **Catch blatant fabrication, but gate on grounding, not novelty** — a new,
  well-sourced fact should *pass*; only an unsupported one is flagged. Blocking every
  new fact reduces a capable agent to a word-shuffler.
- **Prove every gate catches its own violation** — a gate you haven't watched FAIL on
  a crafted bad example is assumed broken. Every hard gate ships red-teamed, the way
  you ship a test with a failing case.

The full standard — including grounding checks in real data and honestly delegating
the judgment dimensions to a reviewer — is in [`CONDUCTOR.md`](./CONDUCTOR.md).

## Authored, red-teamed, approved — before any run

Gates don't go live on trust. Converting a skill into a conductor is a one-time setup
flow, and **nothing executes on an unproven gate**:

1. **Skill → gates.** Each step's *goal* is translated into a real, cross-validating
   check authored to the bar above — not a shape check.
2. **Red-team each hard gate.** It's fed a known-bad example and must be watched to
   **fail** it; the proof is recorded to `.conductor/gate-review.md`.
3. **You approve they match intent.** Every gate is presented as an **Approve / Reject**
   card — its skill goal, what it rejects, its red-team proof. Execution can't start
   until you agree the gates faithfully capture the skill; a rejection routes back to
   fix the gate.
4. **Only then does it run.** Every later run just *enforces* the approved gates.

## Nothing gets skipped

Coverage is structural, not aspirational:

- **A loop can't close with work undone.** Every iteration is frontloaded as `pending`
  the moment it's scoped, and a loop-coverage guard refuses to advance while any
  iteration is incomplete — it lists the ones you missed. A frontloaded item left
  pending is a *skipped page*, not a finished loop.
- **Phase 0 can't be skipped.** The self-improvement pass runs before step 1; its
  cards must resolve before any workflow gate can pass.
- **A failed gate forces fix-and-retry.** A gate that can't be satisfied sends the
  card back into Running. The agent fixes and re-attempts — it never jumps ahead.

## A run you read and steer

The board isn't just a window — it's a steering wheel.

- **Heartbeats group into activity cards.** A run reads as a story, not a firehose. A
  card is *one intent on one target* (writing a page, verifying a check, fixing a
  link); it gets a title, a live status, and a comment box. When a card closes, a
  parallel summarizer writes a one-line recap of what it accomplished.
- **Comment on a card → it becomes a directive.** A note you leave is a human
  instruction that outranks the agent's own insights. The next run's Phase 0 must, for
  each open directive, either **apply it** (and record how) or **defer it** (with a
  real reason) — never silently gloss it.
- **The agent's learnings escalate and auto-apply.** Insights captured mid-run escalate
  `emerging → proven` (3× sightings) and travel with the repo in the conductor's
  `knowledge:` section. A later Phase 0 applies the proven ones automatically, rewrites
  the steps they name, and re-validates.

## Quick start

**1. Start the board** in your project and leave it running:

```bash
npx conductor-board      # live Kanban board on http://localhost:3042
```

**2. Point your agent at the spec.** Tell it: *"Read CONDUCTOR.md, convert my skill
into a conductor, save it to `.conductor/`, and run it."* The agent writes
`conductor.yaml` and maintains `status.json` — the board lights up on its own.

> Or skip the manual setup entirely: point your agent at
> [`setup.conductor.yaml`](./setup.conductor.yaml) and it verifies the environment,
> converts the skill, red-teams and gets the gates approved, then runs it.

A conductor is just steps with gates:

```yaml
conductor: 1.0.0
name: basic-report
description: Research, then write — citing every claim.

inputs:
  - topic

steps:
  - id: research
    instruction: Research {topic}. Gather at least five credible sources.
    gate:
      - "At least 5 sources, each with a URL and a takeaway"

  - id: write
    instruction: Write an 800-word report from the research, citing every claim.
    requires: [research]
    gate:
      - "Every claim cites a source it's actually backed by"   # soft
      - "No placeholder text remains"                          # soft
      - check: "test -f report.md"                             # hard — must exit 0
```

**3. Watch it run.** Cards move through the columns; expand any card to read its
heartbeats and gate state; open the monitor (`` Ctrl + ` ``) to follow every beat.

## CLI

```bash
npx conductor-board                        # serve the live board
npx conductor-board init                   # scaffold a .conductor/conductor.yaml
npx conductor-board validate <file>        # check a conductor against the spec
```

`init --name <name> --steps <n>` scaffolds non-interactively. `validate` checks
required keys, unique ids, well-formed gates, condition/loop shape, dangling
references, dependency cycles, and unreachable steps. `npx 3042` is an alias for
`npx conductor-board`.

The agent drives the board with status-writer commands rather than hand-editing JSON
— `status-init`, `step`, `heartbeat … --card`, `overview`, `loop`, `directives`,
`resolve`, `suggest`, `knowledge`, `complete`. `complete` runs a step's **hard** gates
itself (you can't fake them — the board shows 🔒 verified vs ✋ attested) and only
advances when they pass. Housekeeping: `ps` lists running boards, `stop [--all]` stops
them, `clean` trims history. Full reference in [`CONDUCTOR.md`](./CONDUCTOR.md).

**Run several workflows at once** by giving each its own subdirectory —
`.conductor/<name>/conductor.yaml` + `status.json`. The board shows them grouped and
switchable in the sidebar (the flat `.conductor/status.json` still works for one).

## How it works

```
 conductor.yaml  ─►  agent reads + executes  ─►  .conductor/status.json
                          (gates each step)              │
                                                         ▼
                                            npx conductor-board (live board)
```

1. **Phase 0 — improve.** Before step 1, the agent applies any *proven* insights from
   the conductor's `knowledge:` section and resolves every open directive (apply / defer).
2. **Phase 1+ — execute.** It walks the steps in order, heartbeating about every 30s
   (configurable, 15s–5min), grouping beats into activity cards, and ending each step
   with a `finalBeat` that hands context to the next.
3. **Gate each step.** It runs every hard `check` and self-validates every soft
   criterion. All pass → the step goes `done` and the next unlocks. Any fail → it
   retries. Conditions route the flow; loops fan out one gated sub-sequence per item.
4. **Run end — learn.** Before `status: done` it writes its learnings back to the
   conductor's `knowledge:` section, so the workflow gets sharper every lap.

## Examples

| Example | Pattern | Shows |
| --- | --- | --- |
| [`basic-report.yaml`](./examples/basic-report.yaml) | Linear | Gates, inputs, output passing |
| [`treatment-page.yaml`](./examples/treatment-page.yaml) | Branching | `condition`, `if_true`/`if_false`, `then` rejoin |
| [`code-review.yaml`](./examples/code-review.yaml) | Gates-heavy | Multiple conditions, mixed soft + hard gates |
| [`batch-review.yaml`](./examples/batch-review.yaml) | Loop | `type: loop` over a list, per-iteration gated sub-steps |
| [`daily-price.yaml`](./examples/daily-price.yaml) | Loop (real-world) | A clinic-by-clinic scrape loop with the board-sync first gate |
| [`content-pipeline.yaml`](./examples/content-pipeline.yaml) | Loop + approval | A polish loop held at a `type: approval` human gate before shipping |

On the board a loop opens into its own **view** — an overview of every iteration, each
drillable into a **full per-iteration kanban** — and a `type: approval` step renders an
interactive Approve / Reject card. Ready-to-fork starters live in
[`templates/`](./templates).

## The spec

The full format — steps, gates, conditions, loops, approval, output passing, the
status file, insights, and the execution contract — lives in
**[`spec/conductor-spec.md`](./spec/conductor-spec.md)**. How to write good heartbeats
is in **[`spec/heartbeat-guide.md`](./spec/heartbeat-guide.md)**.

## Design principles

1. **Real gates** — a green gate means *faithful, accurate, sourced*, not *didn't crash*.
2. **Watchable** — the board shows only what the agent narrates; silent work is a stall.
3. **Portable** — no lock-in to any agent, model, or framework; the file is the contract.
4. **Open** — MIT, community-first.

## License

[MIT](./LICENSE) © mettafive
