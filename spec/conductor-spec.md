# Conductor Spec

Version: 3.0.0

Agent Conductor turns a skill into cards on a Kanban board. Every card is
independently verified against its own instruction. Write better instructions,
get better verification. No separate checker configuration is needed.

There are no explicit gate fields, no soft/hard distinction, and no approval
steps during execution.

## Card Shape

Every card has two fields in `cards.json` and three fields in `workflow.json`
after dependency mapping:

`cards.json`:

```json
[
  {
    "title": "Research the treatment",
    "instruction": "Gather at least 4 veterinary sources covering what, when, cost, and owner concerns."
  }
]
```

`workflow.json`:

```json
{
  "title": "Research the treatment",
  "instruction": "Gather at least 4 veterinary sources covering what, when, cost, and owner concerns.",
  "requires": []
}
```

- `title`: what the unit of work is, shown on the board.
- `instruction`: what the work agent does and what the checker verifies against.
- `requires`: list of card indexes that must be done first. Use `[]` for no dependencies.
- Card identity is the array index. There is no card `id` field.

Order emerges from the `requires` graph. Cards whose dependencies are satisfied
can run; cards with no mutual dependencies can run in parallel.

Terminology:

- An **artifact** is the durable file the card produced under `.conductor/artifacts/`.
- An **update** is agent narration for the board and is never completion proof.
- The **checker** compares the card instruction to the artifact.

## Implicit Checking

The checker contract is universal:

> The agent was asked to do X. Here is what it produced. Did it satisfy X?

The artifact must be the actual work product or a verifiable action record. If
the output only describes what was done without concrete proof, the checker must
fail immediately. Action records include command/script run, timestamp, inputs,
return value, changed resource, affected rows/files/URLs, and verification
query/curl/test result.

Every completed card must also have a durable markdown receipt under
`.conductor/artifacts/`. The required path is
`.conductor/artifacts/<card-index>-<slugified-card-title>.md`: a human-readable receipt containing the work
product or action proof. For images, screenshots, PDFs, JSON, CSV, HTML, and
other inspectable files, the markdown receipt is still the primary artifact.
Images produced by the card must be embedded inline in that receipt with
markdown image syntax; the underlying files remain supporting assets.

For v3, `check` prints the universal instruction/output comparison prompt.
An external independent checker evaluates that prompt and records its verdict
before completion:

```bash
npx conductor-board check 0 --output-file .conductor/artifacts/0-research.md
npx conductor-board gate-result 0 --passed --evidence "4 sources captured with cost and owner-concern coverage"
npx conductor-board gate-result 0 --failed --evidence "missing owner-concern coverage"
```

`conductor-board complete <card>` has one path:

1. Resolve the card.
2. Look for a recorded checker result.
3. If no result exists, fail with `no checker result — run the independent checker first.`
4. If the checker passed but no artifact exists under `.conductor/artifacts/`, fail.
5. If the checker passed and an artifact exists, move the card to Done and unlock dependents.
6. If the checker failed, keep the card incomplete so the work agent retries.

## Situational Work

There is no system-level condition field and no branch card type. If work only
applies in a certain situation, fold that situation into the card instruction.
The card still runs, produces an artifact, and goes through the checker.

Example instruction:

> Check whether the title/meta gate failed. If it failed, repair the proposal
> and rerun the gate. If it passed, write an artifact documenting that no repair
> was needed, including the passing gate evidence.

Both outcomes can pass. The artifact must prove the situation was evaluated
against real evidence.

## Loops

Loop containers and loop sub-steps are cards:

```json
{
  "title": "Process pages",
  "instruction": "Process every page in the page list.",
  "requires": [],
  "type": "loop",
  "over": "pages",
  "as": "page",
  "parallel": "auto",
  "steps": [
    {
      "title": "Check links",
      "instruction": "Check every link on {page} and record broken or suspicious links.",
      "requires": []
    }
  ]
}
```

A loop cannot complete while a frontloaded iteration has incomplete declared
sub-steps.

## Authoring Phases

The setup conductor has two authoring phases:

1. **Card design:** read the skill and output `.conductor/cards.json` with
   `title` and `instruction` for each verifiable unit of work. No dependencies,
   ids, ordering fields, or gates yet.
2. **Dependency mapping:** read the cards, add `requires` for each, and assemble
   `.conductor/workflow.json`.

Phase 1 is checked by:

```bash
npx conductor-board cards .conductor/cards.json
```

Phase 2 is checked by:

```bash
npx conductor-board validate .conductor/workflow.json
```

When `.conductor/cards.json` is present next to the conductor file, `validate`
also confirms every card from `cards.json` exists at the same array index in
`workflow.json`.
