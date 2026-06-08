# Agent Conductor — For Agents

Follow `setup.conductor.json` to get started.

## Core Model

A skill becomes cards on a Kanban board. Every card is independently verified
against its own instruction. Write better instructions, get better verification.
No separate checker configuration needed.

Each card in `workflow.json` has:

```json
{
  "title": "Research the treatment",
  "instruction": "Gather at least 4 veterinary sources covering what, when, cost, and owner concerns.",
  "requires": []
}
```

`cards.json` in the card-design phase is a JSON array with objects containing only `title` and `instruction`.
The dependency-mapping phase adds integer `requires` and writes the final workflow.

If a unit of work cannot be independently checked against a concrete instruction,
fold it into a card that can be checked.

## Glossary

- **Card:** one verifiable unit of work on the board.
- **Instruction:** what the agent must do; this is what the checker evaluates.
- **Artifact:** the durable markdown receipt the card produced: `.conductor/artifacts/<card-index>.md`.
- **Update:** agent narration shown on the board; never proof of completion.
- **Checker:** independent evaluator comparing the instruction to the artifact.

## Runtime

There is no automatic runner. You keep `.conductor/status.json` live as you work.

1. Initialize the visible board for this workflow:

```bash
npx conductor-board init-board .conductor/workflow.json
```

`init-board` runs `status-init`, starts or reuses the board server, opens the
browser, checks `/health`, and confirms the board is serving the current workflow
name.

Do not begin card execution until `init-board` confirms the board is live and
showing the current workflow.

Visibility is the default. Users install Conductor to watch the workflow happen.
Only use headless mode when the run is unattended (CI, cron, cloud/no-display)
or when the user explicitly asks for headless/background execution:

```bash
npx conductor-board init-board .conductor/workflow.json --headless
# or
CONDUCTOR_HEADLESS=1 npx conductor-board init-board .conductor/workflow.json
```

2. For each card, update status and write progress updates while doing the work:

```bash
npx conductor-board step 0 running --goal "Gather treatment sources"
npx conductor-board update 0 "Found AVMA and university guidance; comparing cost ranges and owner concerns before drafting."
```

3. After producing the card artifact, save the primary markdown receipt as
   `.conductor/artifacts/<card-index>.md`, then run `check` to print the
   independent checker prompt. The checker sees the card instruction and artifact
   only. Evaluate that prompt in a clean context, then record the PASS/FAIL
   verdict:

```bash
npx conductor-board check 0 --output-file .conductor/artifacts/0.md
npx conductor-board gate-result 0 --passed --evidence "PASS ..."
npx conductor-board complete 0
```

If the checker fails, record the failed verdict with `gate-result --failed`, then
call `complete` once. `complete` consumes that failed verdict, increments the
attempt counter, and stores the feedback for the retry.

If completion fails, read the checker feedback, fix the work in the same
environment, then run `check`, record the verdict, and complete again:

```bash
npx conductor-board feedback 0
npx conductor-board check 0 --output-file .conductor/artifacts/0.md
npx conductor-board gate-result 0 --passed --evidence "PASS ..."
npx conductor-board complete 0
```

Calling `complete` without a recorded checker result fails with:

```text
no checker result — run the independent checker first.
```

Calling `complete` with a passed checker result but no durable artifact fails
too. Done means both requirements are true: the independent checker passed, and
the card has a browsable artifact in `.conductor/artifacts/`.

`check` prints the universal checker prompt: the card instruction on the left
and the produced output on the right. Evaluate that prompt in a clean context,
then record the verdict with `gate-result`. If there is no output at all,
`check` records a failure with evidence `no output was produced.`

The artifact must be either the actual work product or a verifiable action
record. If the artifact merely describes what was done without proof, the checker
must fail immediately.

Use `.conductor/artifacts/<card-index>.md` as the required primary artifact path.
The markdown receipt must contain one of:

- **Work product:** the actual content, code, data, diff, report, source list,
  or decision the card produced.
- **Action record:** command/script run, timestamp, inputs, return value,
  changed resource, affected rows/files/URLs, and verification query/curl/test
  result.
- **Non-text work:** keep `.conductor/artifacts/<card-index>.md` as the primary
  artifact. Put every image from that card inline in the receipt with markdown
  image syntax, for example `![Alt text](7-treatment-image.webp)`. List
  screenshots, PDFs, uploads, CSV, JSON, HTML previews, or other files as
  supporting assets with the proof needed to inspect them. The receipt is the
  artifact; non-text files are supporting files referenced by it.

Pass the artifact to `check` with `--output-file`; the board will show that
artifact. Progress updates are narration for the board; they are never the card
artifact.

The default circuit breaker is 5 attempts. Set `max_attempts: N` at the top of
`workflow.json` to change it. Checker failures escalate through `feedback`:

```text
Attempt 1/5. Checker found: [reasons]. Fix and retry.
Attempt 2/5. Checker found: [reasons]. Fix and retry.
Attempt 3/5. This card has failed three times. Two attempts remaining before the run stops. Address every point: [reasons].
Attempt 4/5. Final warning. One attempt remaining. Issues: [reasons].
Attempt 5/5. No attempts remaining. Final checker failure: [reasons]
```

On the fifth failed attempt, the card status becomes `failed`, the overall run
status becomes `failed`, and `complete` refuses further retries for that card.

## Board Discipline

Using the board is not optional.

- Do not begin card execution until `init-board` confirms the board is live and showing the current workflow.
- Visible board is the default. Use `--headless` / `CONDUCTOR_HEADLESS=1` only for unattended runs or an explicit user request.
- Update status at every transition: pending, running, checking, passed/failed, done.
- Write progress updates as Codex-style preambles: concise notes that bring the user along while work is happening.
- Group related actions into one update instead of writing a note for every tiny read, command, or edit.
- Keep updates to 1-2 sentences. For quick updates, aim for 8-12 words.
- Build on prior context: say what you learned so far and what it implies for the next action.
- Avoid updates for trivial reads unless they are part of a larger grouped action.
- Do not write status-log updates like "drafting hero", "checking", "running tests", or "checker passed." The board already shows system status.
- Before marking a card done, append a final update with `--handoff --to <next-card>` that says what the next card needs to know.
- Do not work ahead of the board. If you drift, stop, resync, and restart the card cleanly.

Use `conductor-board update` for agent narration. `heartbeat` remains as a
backwards-compatible alias, but the product language is update.

Good updates:

```text
README still describes explicit gates, so I am rewriting the quick start around instruction-based checking.
Choosing "verified cards" over "gates" because v3 no longer has gate fields.
The checker needs actual before/after copy, not a report, so the output file must contain the work itself.
Handing off: package metadata now matches v3; next card should verify docs examples use workflow.json.
```

Bad updates:

```text
reading README
drafting hero
running tests
checker passed
```

## Authoring Rules

- Titles are short promises a user can scan.
- Instructions must be specific enough for an independent checker to compare output
  against them.
- Card design uses the same independent-check pattern as runtime execution:
  compose cards from the skill, check the cards against the original skill, repair
  on failure, and keep `.conductor/decomposition-check.json` as the audit trail.
- Rules, constraints, examples, warnings, and output formats are not cards by
  themselves. Fold them into the relevant card instructions.
- Card identity is the array index. Do not add `id` fields.
- Dependencies go in `requires`; order emerges from the graph.
- No `gate`, `command`, `agent`, `prompt`, approval, soft, or hard fields.
- Loops still need `title`, `instruction`, and `requires`.
- There is no `condition` field and no condition card type. Situational work
  belongs inside the instruction. The card still executes and its artifact must
  prove either the work was needed and done, or no action was needed and why.

## Validation

```bash
npx conductor-board cards .conductor/cards.json
npx conductor-board validate .conductor/workflow.json
```

`cards` validates the card-design artifact. `validate` checks schema, dependency
references, dependency cycles, loop shape, and card coverage when
`.conductor/cards.json` is present next to the conductor.

## Learnings

At the end of a run, capture useful learnings:

```bash
npx conductor-board suggest "Source coverage must include owner concerns" --scope this-conductor
npx conductor-board knowledge --min 1
```

Phase 0 self-improvement is parked in v3 and runs only when a conductor explicitly
sets `auto_improve: true`.
