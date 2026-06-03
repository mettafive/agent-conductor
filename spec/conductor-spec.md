# The Conductor Spec

**Version `1.0.0`**

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
| `type`        | `condition`     | Marks a branching step. See §4.                                  |
| `if_true`     | step id         | Where to go when a condition evaluates true.                     |
| `if_false`    | step id         | Where to go when a condition evaluates false.                    |
| `then`        | step id         | Rejoin point after a branch step completes. See §4.              |
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
1. Create `.conductor/status.json` before starting.
2. After completing each step, update the status file.
3. After each gate check, record pass/fail for every criterion.
4. If a gate fails, retry the step — do not skip it.
5. Record which branch was taken at every condition step.
```

### 6.1 Status file format

The agent maintains `.conductor/status.json`. This is the file the local Kanban
board watches.

```json
{
  "conductor": "1.0.0",
  "workflow": "workflow-name",
  "started_at": "2026-06-03T09:00:00Z",
  "status": "running",
  "current_step": "write-draft",
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
      "attempt": 2
    }
  }
}
```

### 6.2 Field semantics

| Field          | Values                                  | Notes                                          |
| -------------- | --------------------------------------- | ---------------------------------------------- |
| `status` (top) | `running` `done` `failed`               | Overall workflow state.                        |
| `current_step` | step id                                 | The step in flight.                            |
| `status`       | `pending` `running` `done` `failed`     | Per-step lifecycle.                            |
| `gate`         | `pending` `passed` `failed`             | Result of the step's gate.                     |
| `attempt`      | integer ≥ 1                             | Increments on every retry.                     |
| `branch_taken` | step id                                 | Only on `condition` steps.                     |
| `output`       | any                                     | Only when the step declared `output`.          |

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

---

## 7. Execution model (the contract, in full)

1. Read the conductor. Resolve `inputs`.
2. Create `.conductor/status.json` with every step `pending`.
3. Walk steps in order. For each step:
   - Mark it `running`, set `current_step`, set `started_at`.
   - If `requires` is present, confirm all dependencies are `done` first.
   - Execute the `instruction` (template in inputs and prior outputs).
   - Evaluate the `gate`: run every `check`, self-validate every soft criterion.
   - **All pass** → mark `done`, record `output` if declared, advance.
   - **Any fail** → increment `attempt`, retry the step. Do not advance.
   - On a `condition` step → evaluate, set `branch_taken`, jump to `if_true` /
     `if_false`.
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
- **Plain language is a feature.** Soft gates let non-engineers author workflows.
- **Hard checks earn trust.** Anything verifiable should be a `check`.
- **One file, zero deps.** A conductor is portable by construction.

---

## 9. Minimal valid conductor

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
