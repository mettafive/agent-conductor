# Conductor Spec

Version: 3.0.0

Agent Conductor turns a skill into cards on a Kanban board. Every card is
independently verified against its own instruction. Write better instructions,
get better verification. No separate checker configuration is needed.

There are no explicit gate fields, no soft/hard distinction, and no approval
steps during execution.

## Card Shape

Every card has four fields in `conductor.json`:

```json
{
  "id": "research",
  "title": "Research the treatment",
  "instruction": "Gather at least 4 veterinary sources covering what, when, cost, and owner concerns.",
  "requires": []
}
```

- `id`: unique kebab-case card id.
- `title`: what the unit of work is, shown on the board.
- `instruction`: what the work agent does and what the checker verifies against.
- `requires`: list of card ids that must be done first. Use `[]` for no dependencies.

Order emerges from the `requires` graph. Cards whose dependencies are satisfied
can run; cards with no mutual dependencies can run in parallel.

## Implicit Checking

The checker contract is universal:

> The agent was asked to do X. Here is what it produced. Did it satisfy X?

For v3, an external independent checker records its verdict before completion:

```bash
npx conductor-board gate-result research --passed --evidence "4 sources captured with cost and owner-concern coverage"
npx conductor-board gate-result research --failed --evidence "missing owner-concern coverage"
```

`conductor-board complete <card>` has one path:

1. Resolve the card.
2. Look for a recorded checker result.
3. If no result exists, fail with `no checker result — run the independent checker first.`
4. If the checker passed, move the card to Done and unlock dependents.
5. If the checker failed, keep the card incomplete so the work agent retries.

## Conditions

Conditions are cards too:

```json
{
  "id": "decide",
  "title": "Decide route",
  "instruction": "Decide which path applies and cite the evidence for the decision.",
  "requires": [],
  "type": "condition",
  "if_true": "yes-path",
  "if_false": "no-path"
}
```

## Loops

Loop containers and loop sub-steps are cards:

```json
{
  "id": "process-pages",
  "title": "Process pages",
  "instruction": "Process every page in the page list.",
  "requires": [],
  "type": "loop",
  "over": "pages",
  "as": "page",
  "parallel": "auto",
  "steps": [
    {
      "id": "check-links",
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

1. **Card design:** read the skill and output `.conductor/cards.json` with `id`,
   `title`, and `instruction` for each verifiable unit of work. No dependencies yet.
2. **Dependency mapping:** read the cards, add `requires` for each, and assemble
   `.conductor/conductor.json`.

Phase 1 is checked by:

```bash
npx conductor-board cards .conductor/cards.json
```

Phase 2 is checked by:

```bash
npx conductor-board validate .conductor/conductor.json
```

When `.conductor/cards.json` is present next to the conductor file, `validate`
also confirms every card id from `cards.json` exists in `conductor.json`.
