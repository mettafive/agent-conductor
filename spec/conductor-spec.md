# The Conductor Spec

**Version `1.1.0`** · adds [loops](#43-loops) (`type: loop`)

A conductor is a single YAML file that turns a loose pile of instructions into a
**gated workflow**. Each step must pass its gate before the next one unlocks. The
agent — Claude Code, Codex, Hermes, anything — reads the file, executes the steps
in order, self-validates against each gate, and writes its progress to a local
JSON status file.

No SDK. No runtime. No API. The spec *is* the product: a portable contract
between you and any agent.

---

## 1. Anatomy of a conductor

```yaml
conductor: 1.0.0
name: workflow-name
description: One line describing what this workflow accomplishes.

# Variables templated into instructions with {curly_braces}
inputs:
  - topic
  - audience

steps:
  - id: research
    instruction: |
      Research {topic} for an audience of {audience}.
      Collect at least five credible sources.
    gate:
      - "At least 5 sources collected"
      - "Each source has a URL and a one-line summary"
```

A conductor has exactly four top-level keys:

| Key           | Required | Meaning                                                    |
| ------------- | -------- | ---------------------------------------------------------- |
| `conductor`   | yes      | Spec version this file targets. Currently `1.0.0`.         |
| `name`        | yes      | Machine-friendly workflow name (kebab-case recommended).   |
| `description` | yes      | One human sentence. Shown on the board.                    |
| `inputs`      | no       | List of variable names templated into instructions.        |
| `steps`       | yes      | Ordered list of steps. The body of the workflow.           |

---

## 2. Steps

Steps execute **top to bottom** unless a condition redirects the flow. Every step
has an `id` (unique, kebab-case) and an `instruction`. Everything else is optional
and unlocks more behavior.

### 2.1 A standard gated step

```yaml
- id: write-draft
  instruction: |
    Write the first draft using the research from the previous step.
  gate:
    - "Draft is at least 800 words"
    - "Every claim cites one of the collected sources"
```

The agent does the work, then **self-validates against every gate criterion**
before it is allowed to advance. If any criterion fails, the agent retries the
step — it does **not** skip ahead.

### 2.2 Fields reference

| Field         | Type            | Purpose                                                          |
| ------------- | --------------- | ---------------------------------------------------------------- |
| `id`          | string          | Unique identifier for the step.                                  |
| `instruction` | string (block)  | What the agent should do. May reference `{inputs}` and outputs.  |
| `gate`        | list            | Criteria that must all pass before advancing. See §3.            |
| `type`        | `condition` `loop` | Marks a branching (§4.1) or looping (§4.3) step.              |
| `if_true`     | step id         | Where to go when a condition evaluates true.                     |
| `if_false`    | step id         | Where to go when a condition evaluates false.                    |
| `then`        | step id         | Rejoin point after a branch step completes. See §4.              |
| `over`        | variable name   | The list a `loop` iterates over (inputs or output). See §4.3.    |
| `as`          | string          | The loop variable name, templated into sub-steps. See §4.3.      |
| `steps`       | list            | Sub-steps run on each loop iteration. See §4.3.                  |
| `requires`    | list of step ids| Explicit dependencies that must be `done` first.                 |
| `output`      | string          | Names a variable downstream steps can template in.              |

---

## 3. Gates — the whole point

A gate is a checkpoint. **Every criterion in a gate must pass before the next step
unlocks.** There are two kinds of criterion, and a single gate can mix them
freely.

### 3.1 Soft gates — plain-language self-validation

A string criterion is a judgment the agent makes about its own work.

```yaml
gate:
  - "The summary reads naturally and avoids jargon"
  - "No placeholder text like TODO or [insert] remains"
```

Soft gates are how you encode taste, completeness, and intent — the things only a
reasoning model can assess. The agent must honestly evaluate each one and record
the verdict in the status file.

### 3.2 Hard gates — executable checks

A criterion can instead be a `check`: a shell command that **must exit `0`**. This
turns a gate from an aspiration into a fact.

```yaml
gate:
  - "Tests describe the new behavior"     # soft
  - check: "npm test"                       # hard — must exit 0
  - check: "test -f dist/report.md"         # hard — file must exist
```

A `check` criterion supports:

| Field    | Required | Default | Meaning                                            |
| -------- | -------- | ------- | -------------------------------------------------- |
| `check`  | yes      | —       | Shell command to run.                              |
| `expect` | no       | `0`     | Required exit code.                                |
| `name`   | no       | —       | Human label shown on the board instead of the cmd. |

```yaml
gate:
  - name: "Type-check passes"
    check: "tsc --noEmit"
  - name: "Lint clean"
    check: "eslint . --max-warnings 0"
    expect: 0
```

**Rule:** soft gates are self-attested; hard gates are *run*. A gate with any
failing criterion — soft or hard — blocks the step. The agent retries until the
gate passes or it explicitly marks the step `failed` and stops.

> **Why both?** Soft gates keep the spec portable and capture judgment. Hard gates
> make the workflow auditable — a skeptic can re-run the checks and confirm the
> agent didn't vibe through. Use soft for *"is this good?"*, hard for *"is this
> true?"*.

> **Note on shell commands in gates.** If your project uses CommonJS (the default
> for most Node.js projects), inline `tsx -e` or `node -e` blocks with **top-level
> `await`** will fail. Wrap async code in `async function main() { … } main()`, or
> — better — put it in a small `.ts`/`.js` helper script that the gate's `check:`
> calls. Helper scripts are more reliable and readable than complex one-liners.

---

## 4. Conditions & branching

### 4.1 Conditions

A step with `type: condition` evaluates something and routes the flow. It has no
gate of its own — its job is the decision.

```yaml
- id: needs-security-review
  instruction: |
    Determine whether this PR touches authentication, secrets, or user input.
  type: condition
  if_true: security-pass
  if_false: style-check
```

The agent records which branch it took in the status file
(`branch_taken: "security-pass"`).

### 4.2 Branch steps that rejoin

A branched step uses `then` to declare where the main flow resumes once it's done,
so both branches converge.

```yaml
- id: security-pass
  instruction: |
    Audit the changed files for injection, auth bypass, and leaked secrets.
  gate:
    - "Every changed file reviewed for the OWASP top 10"
    - check: "npm run lint:security"
  then: style-check        # both branches rejoin here

- id: style-check
  instruction: |
    Check the diff against the project style guide.
  gate:
    - "Naming and formatting match the surrounding code"
```

### 4.3 Loops

A step with `type: loop` repeats a sequence of sub-steps for each item in a list.
The list comes from a prior step's `output` or from `inputs`.

```yaml
- id: process-clinics
  type: loop
  over: clinic_list          # variable name (from input or prior output)
  as: clinic                 # loop variable name, templated into sub-steps
  steps:
    - id: scrape
      instruction: "Find current treatment prices for {clinic}."
      gate:
        - "At least one price found with a source URL"
    - id: validate
      instruction: "Validate prices for {clinic} against existing data."
      gate:
        - "Prices are within expected range or flagged as outliers"
```

Each iteration runs the full sub-step sequence with gates. The loop step is `done`
when all iterations complete. If any iteration's gate fails, that iteration
retries — other iterations are not affected.

**Design rules for loops**

- Loops are **sequential by default** (one iteration at a time). Parallel iteration
  is out of scope for v1.1.
- Sub-steps inside a loop follow all the same rules as top-level steps (gates,
  conditions, output passing).
- `over` must reference a **list** (from `inputs` or a prior step's `output`). If it
  is not a list, the step fails.
- Loop variables use the same `{name}` template syntax as inputs.

The loop's status records progress across iterations:

```json
"process-clinics": {
  "status": "running",
  "type": "loop",
  "total": 10,
  "completed": 6,
  "current_item": "Evidensia Stockholm",
  "iterations": {
    "Evidensia Stockholm": {
      "scrape":   { "status": "done",    "gate": "passed" },
      "validate": { "status": "running", "gate": "pending" }
    },
    "AniCura Göteborg": {
      "scrape":   { "status": "pending" },
      "validate": { "status": "pending" }
    }
  }
}
```

---

## 5. Inputs & output passing

### 5.1 Inputs

`inputs` lists variables provided when the workflow starts. They are templated
into any instruction with `{name}` syntax.

```yaml
inputs:
  - pr_number

steps:
  - id: read-pr
    instruction: "Read the diff for PR #{pr_number}."
```

### 5.2 Passing data between steps

A step that declares `output` names a value later steps can reference. A step that
declares `requires` won't unlock until its dependencies are `done`.

```yaml
- id: extract-keywords
  instruction: "Extract the 10 highest-intent keywords from the research."
  gate:
    - "Exactly 10 keywords, ranked by intent"
  output: keywords

- id: write-page
  instruction: "Write the landing page targeting {keywords}."
  requires: [extract-keywords]
  gate:
    - "Every keyword appears at least once, naturally"
```

`{keywords}` resolves to the value the producing step recorded in its status
entry.

---

## 6. Status reporting

Every conductor carries an implicit **preamble** that the agent must honor. When
you hand a conductor to an agent, you are also handing it these instructions:

```
As you execute this conductor workflow:
1. Save the conductor to `.conductor/conductor.yaml`.
2. Create `.conductor/status.json` with every step set to pending.
3. After completing each step, update the status file.
4. After each gate check, record pass/fail for every criterion.
5. If a gate fails, retry the step — do not skip it.
6. Record which branch was taken at every condition step.
```

Saving the conductor next to the status file is what makes the board *seamless*:
start the board first, then tell the agent to go. The agent writes both files into
`.conductor/`, and the board auto-discovers them and lights up — no manual copying,
no "put this YAML here."

### 6.1 Status file format

The agent maintains `.conductor/status.json`. This is the file the local Kanban
board watches.

```json
{
  "conductor": "1.0.0",
  "workflow": "workflow-name",
  "goal": "Research, write, and ship a publish-ready report on the topic.",
  "run_id": "2026-06-03T09-00-00",
  "started_at": "2026-06-03T09:00:00Z",
  "status": "running",
  "current_step": "write-draft",
  "current_step_goal": "Write an 800-word draft where every claim cites a source.",
  "steps": {
    "research": {
      "status": "done",
      "gate": "passed",
      "started_at": "2026-06-03T09:00:00Z",
      "completed_at": "2026-06-03T09:04:10Z",
      "attempt": 1
    },
    "write-draft": {
      "status": "running",
      "gate": "pending",
      "started_at": "2026-06-03T09:04:11Z",
      "attempt": 2,
      "heartbeat": [
        { "at": "2026-06-03T09:05:00Z", "note": "Drafting section 2. Gate needs every claim cited — tracking sources as I go." },
        { "at": "2026-06-03T09:06:30Z", "note": "Found a stronger source: [BLS data](https://example.com/bls). Swapping it in." }
      ],
      "learnings": [
        "The first two sources overlap — prefer the primary one."
      ]
    }
  }
}
```

### 6.2 Field semantics

| Field          | Values                                  | Notes                                          |
| -------------- | --------------------------------------- | ---------------------------------------------- |
| `run_id`       | string                                  | Unique id for this run (recommended: timestamp). Lets the board archive and group past runs. |
| `goal` (top)   | string                                  | The workflow's end goal — copied from the conductor's `description`. Shown on the board header. |
| `status` (top) | `running` `done` `failed`               | Overall workflow state.                        |
| `current_step` | step id                                 | The step in flight.                            |
| `current_step_goal` (top) | string                       | One-line summary of the current step's purpose (instruction + gate). Updated on each step transition. |
| `completed_at` (top) | ISO-8601                          | Set when the workflow reaches `done` or `failed`. |
| `status`       | `pending` `running` `done` `failed`     | Per-step lifecycle.                            |
| `gate`         | `pending` `checking` `passed` `failed`  | Gate result. `checking` is transient — set while the gate is being evaluated (drives the board's Gate Check column). |
| `attempt`      | integer ≥ 1                             | Increments on every retry.                     |
| `branch_taken` | step id                                 | Only on `condition` steps.                     |
| `output`       | any                                     | Only when the step declared `output`.          |
| `heartbeat`    | array of `{at, note, insight?, finalBeat?, handoff?}` | Append-only self-regulation log. `note` supports markdown links; `insight` flags an improvement signal; `finalBeat: true` marks a step's closing handoff beat. See §6.5, §9. |
| `learnings`    | array of strings (max 5)                | Patterns distilled from the heartbeats. See §6.5. |
| `suggestions` (top) | array                              | Post-run optimization suggestions the agent writes before `done`. See §9. |

### 6.3 Optional per-criterion detail

Agents may record gate detail to make the board richer. This is encouraged but not
required.

```json
"write-draft": {
  "status": "done",
  "gate": "passed",
  "gate_detail": [
    { "criterion": "Draft is at least 800 words", "kind": "soft", "passed": true },
    { "criterion": "npm test", "kind": "hard", "passed": true, "exit_code": 0 }
  ],
  "attempt": 2
}
```

### 6.4 History

When a run reaches `done` or `failed`, the board archives a self-contained copy
of it (the final status plus the conductor that produced it) to
`.conductor/history/<run_id>_<workflow>.json` (e.g.
`2026-06-03T14-30-00_treatment-page.json`). Past runs stay browsable in the
board's history panel, grouped by workflow. Give every run a distinct `run_id`
so they archive cleanly instead of overwriting each other.

### 6.5 Heartbeats — agent self-regulation

Long steps are where agents drift. A **heartbeat** is a structured pulse the agent
writes to itself to stay oriented — at least **once per minute** while a step runs.

- The agent **appends** an entry to the current step's `heartbeat` array at least
  once per minute. Each entry is `{ at, note }` — an ISO-8601 timestamp and one or
  two sentences. `note` may include markdown links (`[text](url)`).
- The `heartbeat` array is **append-only** — never clear or overwrite prior
  entries. It is the run's audit trail.
- **Before writing a heartbeat, the agent reads its prior entries** to keep
  continuity. Before starting each loop iteration, it reads heartbeats and
  `learnings` from prior iterations.
- **Every heartbeat is written with two goals in view:** the workflow's end goal
  (`goal`, from the conductor's `description`) and the current step's gate. Each
  beat answers: *am I advancing toward this step's gate **and** the workflow's
  purpose, or am I drifting?*
- `learnings` (max 5 strings per step) distills durable patterns from the beats.
  Replace weaker entries as better ones emerge.

```json
"discover-prices": {
  "status": "running",
  "gate": "pending",
  "attempt": 1,
  "heartbeat": [
    { "at": "2026-06-03T15:50:00Z", "note": "Starting extraction. Gate needs 5 sources with URLs." },
    { "at": "2026-06-03T15:51:30Z", "note": "3/5 found via sitemap. Crawling nav for the rest." },
    { "at": "2026-06-03T16:03:00Z", "note": "PR opened: [run 2026-06-03](https://github.com/org/repo/pull/42)." }
  ],
  "learnings": [
    "Swedish vet pricing pages are usually at /priser or /prislista.",
    "Sitemap-first discovery beats nav-first for most clinics."
  ]
}
```

In a **loop**, tag a beat with the iteration it belongs to so the board can route
it to the right sub-card:

```json
{ "at": "…", "iteration": "ale-djurklinik", "note": "Sitemap has /behandlingar/priser, fetching." }
```

**finalBeats — handoffs between steps.** Before marking a step `done`, the agent
writes one last heartbeat with `"finalBeat": true`. It summarizes what the step
accomplished and carries context to the next step via a `handoff` object. The note
should end with *"Handing off to <next-step>."*

```json
{
  "at": "2026-06-03T15:53:00Z",
  "note": "5 clinics claimed, all with live pricing pages. Handing off to snapshot-before.",
  "finalBeat": true,
  "handoff": {
    "to": "snapshot-before",
    "context": "Clinic ids [12, 45, 78, 102, 156]; Ahlbergs has known price URLs.",
    "produced": "candidates.json"
  }
}
```

Loop iterations get finalBeats too — use `"to_iteration"` in the handoff. Before
starting a step (or iteration), the agent **reads the previous finalBeat** so
context flows forward without loss. The board marks finalBeats with a `·→` arrow.

**The stall timer resets on every heartbeat, finalBeats included.** The board warns
when no beat has landed for 90s. Because a step's finalBeat resets that timer, the
cooldown starts fresh at each handoff — giving the agent a natural window to read
context and start the next step before another beat is expected. Variable intervals
are normal (20s during a busy scrape, 60s during a quiet write); 90s is the
"something might be wrong" threshold, and everything under it is healthy rhythm.

After ~3 minutes of silence while a step is `running`, the board escalates from the
subtle 90s pulse to a red **"Freeballing?"** banner. That's a signal the agent may
be doing real work without updating the board — which the execution contract
forbids (§7). The remedy is not to back-fill the board after the fact: stop,
re-sync `status.json` to reality, restart the step cleanly, and tell the user.

The agent also maintains the top-level `goal` (copied from the conductor's
`description` at init) and `current_step_goal` (a one-line summary of the active
step, refreshed whenever `current_step` changes). Both are shown on the board
header so the human always sees the destination.

> For detailed guidance on writing effective heartbeats, see the
> [Heartbeat Guide](./heartbeat-guide.md).

### 6.6 Multiple workflows

To run several workflows side by side, give each its own subdirectory:

```
.conductor/
├── daily-price/
│   ├── conductor.yaml
│   ├── status.json
│   └── history/
└── treatment-page/
    ├── conductor.yaml
    └── status.json
```

The board discovers every subdirectory containing a `conductor.yaml` and/or
`status.json` and shows them as separate workflows. The flat path
`.conductor/status.json` (no subdirectory) is still accepted for backwards
compatibility — new workflows should prefer the subdirectory convention.

---

## 7. Execution model (the contract, in full)

1. Read the conductor. Resolve `inputs`.
2. Create `.conductor/status.json` with every step `pending`. Set top-level `goal`
   from the conductor's `description`.
3. Walk steps in order. For each step:
   - Mark it `running`, set `current_step`, set `started_at`, and refresh
     `current_step_goal` with a one-line summary of this step.
   - If `requires` is present, confirm all dependencies are `done` first.
   - Execute the `instruction` (template in inputs and prior outputs).
   - **At least once per minute, append a heartbeat** to the step's `heartbeat`
     array (read prior entries first; orient against the step gate and `goal`).
   - Before starting, read the previous step's `finalBeat` for handed-off context.
   - Evaluate the `gate`: run every `check`, self-validate every soft criterion.
   - **All pass** → append a `finalBeat` (summary + `handoff`), mark `done`, record
     `output` if declared, advance.
   - **Any fail** → increment `attempt`, retry the step. Do not advance.
   - On a `condition` step → evaluate, set `branch_taken`, jump to `if_true` /
     `if_false`.
   - On a `loop` step → update `completed` and the `iterations` object as **each**
     iteration finishes; don't wait until the loop ends.
   - On a `then` step → after completing, jump to the `then` target.
4. When the last reachable step is `done`, set top-level `status: done`.
5. If a gate cannot be satisfied, set the step and the workflow to `failed` and
   stop. Never silently skip.

---

## 8. Design rules

- **Sequential by default.** Branching is explicit, never implicit.
- **Gates are mandatory.** A step without a gate is a step the agent can fake.
  Prefer at least one criterion per step.
- **Retry, never skip.** A failed gate sends the agent back into the step.
- **Keep the board live.** Update `status.json` at every transition and heartbeat
  as you go. Doing work the board doesn't reflect ("freeballing") breaks the
  contract — re-sync and restart the step rather than back-filling after the fact.
- **Plain language is a feature.** Soft gates let non-engineers author workflows.
- **Hard checks earn trust.** Anything verifiable should be a `check`.
- **One file, zero deps.** A conductor is portable by construction.

---

## 9. Insights & optimization

A conductor improves by being run. The same heartbeat that self-regulates a run
also captures *how the workflow itself could be better* — and after the run, those
signals become concrete suggestions the user can apply back to the conductor.

### 9.1 Insight-tagged heartbeats

When the agent recognizes a pattern that would improve the workflow for future runs
— a drift it corrected, a faster strategy, a gate that's too strict or too loose, a
missing instruction — it tags that heartbeat with an `insight` object:

```json
{
  "at": "2026-06-03T15:52:00Z",
  "note": "Spent 3min in the blog — drift. No pricing in editorial content.",
  "insight": {
    "type": "drift",
    "seed": "Add anti-drift instruction: skip blog/news/article links",
    "step": "scrape-and-price",
    "confidence": "high"
  }
}
```

`insight` is optional — only on the beats that carry a real signal.

| Field | Type | Notes |
| --- | --- | --- |
| `insight.type` | string | `drift`, `shortcut`, `gate_issue`, `missing_instruction`, `timing`, `error_pattern` |
| `insight.seed` | string | One-line description of the potential improvement |
| `insight.step` | string | Which step the insight applies to |
| `insight.confidence` | string | `high`, `medium`, `low` |

### 9.2 Post-run suggestions

After all steps complete and **before** setting the top-level status to `done`, the
agent reviews the run's insight-tagged heartbeats, learnings, gate-retry counts, and
timing, then writes 3–5 concrete suggestions to the status file's `suggestions`
array:

```json
"suggestions": [
  {
    "id": "s1",
    "type": "instruction",
    "step": "scrape-and-price",
    "title": "Try sitemap before navigation",
    "rationale": "Heartbeats show sitemap found pricing faster in 4/5 clinics.",
    "source_heartbeat": "2026-06-03T15:51:30Z",
    "current": "Navigation first, then Sitemap.",
    "proposed": "Sitemap first (faster), then Navigation.",
    "impact": "~10 min saved per 5-clinic batch",
    "confidence": "high"
  }
]
```

Each suggestion has: `id`, `type`, `step`, `title`, `rationale`, `source_heartbeat`,
`current` (when modifying existing text), `proposed`, `impact`, `confidence`.
Suggestion types: `instruction`, `gate`, `new_gate`, `new_step`, `remove_step`,
`reorder`.

### 9.3 The improvement cycle

The board presents the suggestions when a run finishes. The user selects which to
apply; applied suggestions mutate the conductor YAML on disk (with a backup and a
re-validation). The next run starts from the improved workflow. Over many runs, the
workflow is refined by its own execution history — suggestions become rare, gates
pass first try, the skill is polished by having been run.

### 9.4 The insights ledger — memory across runs

Suggestions don't evaporate when the run ends. The board merges each completed
run's suggestions into a persistent, deduped **ledger**:

- **`.conductor/insights.md`** — a human- and agent-readable view, grouped into
  **Open / Applied / Dismissed**, with provenance (which run first surfaced each).
- **`.conductor/insights.json`** — the structured source of truth the board reads
  and writes.

The agent **reads `insights.md` at the start of every run** to carry learnings
forward (and to avoid re-surfacing what's already recorded). Applying an insight in
the board marks it `applied`; dismissing it marks it `dismissed`; both persist. The
ledger is plain text — commit it, and the workflow's memory travels with the repo.

---

## 10. Minimal valid conductor

```yaml
conductor: 1.0.0
name: hello-conductor
description: The smallest workflow that still has a gate.

steps:
  - id: greet
    instruction: "Write 'hello' to greeting.txt."
    gate:
      - check: "test -f greeting.txt"
      - "The file contains a friendly greeting"
```

That's the whole spec. Hand the file to an agent and watch the board light up.
