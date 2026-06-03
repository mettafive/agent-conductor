# Agent Conductor

You are about to run a **conductor**: a workflow broken into discrete steps, where
each step must pass a validation **gate** before the next one unlocks. This file is
self-contained — follow it directly.

## Quick Setup

Run this in the background before you start executing (it's non-blocking):

```bash
npx conductor-board
```

This starts a live Kanban board at http://localhost:3042 and opens the browser.
The board watches `.conductor/` for changes and updates automatically — so start it
first, then do the work below.

## Converting a Skill to a Conductor

Take the user's skill or instructions and restructure them as a conductor YAML:

1. Identify the discrete steps — each step does one thing.
2. Write gate criteria for every step:
   - **Soft gates** (strings): judgment you self-validate — `"reads naturally"`,
     `"no placeholder text"`.
   - **Hard gates** (`check:`): shell commands that must exit 0 — `"npm test"`,
     `"test -f output.md"`.
3. Add **conditions** where the workflow could branch (`type: condition`,
   `if_true`/`if_false`).
4. Add **loops** for repeated operations over a list (`type: loop`, `over`/`as`).
5. Chain data between steps with `output:` and `requires:`.

Save the conductor to: `.conductor/conductor.yaml`

## Conductor Format

```yaml
conductor: 1.1.0
name: workflow-name
description: One line describing what this does.

inputs:
  - variable_name

steps:
  # Standard step with a gate
  - id: step-id
    instruction: |
      What to do. Reference {variable_name} from inputs.
    gate:
      - "Soft gate criterion"
      - check: "shell command that must exit 0"

  # Condition (if/else branch)
  - id: decision
    instruction: "Evaluate whether X is true."
    type: condition
    if_true: step-when-true
    if_false: step-when-false

  # Branch step that rejoins the main flow
  - id: step-when-true
    instruction: "Do the true-branch work."
    gate:
      - "Criterion"
    then: next-main-step

  # Loop over a list
  - id: process-items
    type: loop
    over: item_list          # a list from inputs or a prior output
    as: item                 # templated into the sub-steps as {item}
    steps:
      - id: process
        instruction: "Process {item}."
        gate:
          - "Item fully processed"

  # Step with output passing
  - id: producer
    instruction: "Produce data."
    gate:
      - "Data is complete"
    output: produced_data

  # Step consuming a prior output
  - id: consumer
    instruction: "Use {produced_data}."
    requires: [producer]
    gate:
      - "Final check"
```

## Execution Contract

1. Save the conductor to `.conductor/conductor.yaml`.
2. Create `.conductor/status.json` with every step set to `pending` and a
   timestamp `run_id` (e.g. `2026-06-03T14-30-00`).
3. Walk steps in order. For each step:
   - Set its status to `running`, update `status.json`.
   - Execute the instruction.
   - Evaluate every gate criterion — run the `check:` commands, self-validate the
     soft ones (set the step's `gate` to `checking` while you do).
   - **All pass** → set the step `done`, advance.
   - **Any fail** → increment its `attempt` counter and retry. **Never skip.**
4. At conditions: record `branch_taken`, jump to the target step.
5. At loops: iterate through each item, running the sub-steps with gates per
   iteration; record progress under `iterations`.
6. When the last step is `done`, set top-level `status` to `done`.
7. If a gate cannot be satisfied after reasonable retries, set `status` to
   `failed` and stop.

## Status File Format

Maintain `.conductor/status.json` throughout execution:

```json
{
  "conductor": "1.1.0",
  "workflow": "workflow-name",
  "run_id": "2026-06-03T14-30-00",
  "started_at": "2026-06-03T14:30:00Z",
  "status": "running",
  "current_step": "step-id",
  "steps": {
    "step-id": {
      "status": "done",
      "gate": "passed",
      "started_at": "...",
      "completed_at": "...",
      "attempt": 1
    }
  }
}
```

A **loop** step records its iterations instead of a single gate:

```json
"process-items": {
  "status": "running",
  "type": "loop",
  "total": 10,
  "completed": 6,
  "current_item": "item-7",
  "iterations": {
    "item-7": { "process": { "status": "running", "gate": "checking" } }
  }
}
```

Step status values: `pending` | `running` | `done` | `failed`
Gate values: `pending` | `checking` | `passed` | `failed`

Update `status.json` after **every** step and gate change — that is what makes the
board move in real time.

---

Validate a conductor any time with `npx conductor-board validate .conductor/conductor.yaml`.
Full spec: https://github.com/mettafive/agent-conductor/blob/main/spec/conductor-spec.md
