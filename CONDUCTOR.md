# Agent Conductor — For Agents

**Follow the setup conductor to get started.**

1. Read [`setup.conductor.yaml`](./setup.conductor.yaml) from this repo.
2. Execute it as a conductor workflow.
3. Everything else is handled by its steps and gates.

## Quick Setup

Start the board **once**, in the background, and **leave it running** — it opens
your browser automatically and serves one board for the whole run:

```bash
npx conductor-board &
```

**One board per run.** Start it once and reuse that server. If you run
`npx conductor-board` again it now detects the live board and reuses it instead of
spawning a second server and opening another tab — but don't rely on that as an
excuse to re-launch repeatedly (that's how you end up with a pile of tabs). Tips:

- **Don't `@latest` on every call.** Pin the version you start with for the run;
  re-resolving `@latest` each time hits the network and can leave hung processes.
- **Validation doesn't open anything** — `npx conductor-board validate <file>` is a
  CLI command that prints and exits. Use it freely.
- **`--headless`** (or `CONDUCTOR_HEADLESS=1`) is only for CI / cloud / no-display
  runs. It suppresses the browser; don't add it to a normal start — the board is
  meant to be seen.

Then read `setup.conductor.yaml` and execute it.

## The board is the contract — no freeballing

Using the board is **not** optional decoration. The discipline *is* the board, and
there is no automatic runner — "using the board" means **you** keep
`.conductor/status.json` current as you actually work:

- **Update status at every transition** — pending → running → gate (`checking`) →
  passed/failed → done. The human is watching the board to follow along; a stale
  board is a broken contract.
- **Heartbeat at least once per minute** while a step runs (see below).
- **Doing real work without updating the board is "freeballing" — not allowed.**
  If you notice you've drifted (worked ahead of what the board shows, or gone quiet
  for minutes), **stop, re-sync the board to reality, restart the step cleanly, and
  apologize to the user.** Don't silently back-fill afterwards and pretend it was
  live.
- The board raises a red **"Freeballing?"** banner after ~3 minutes with no
  heartbeat. If it shows — or the user calls it out — that's a hard stop: re-sync
  and resume the discipline.
- **Make it structural:** add `check: "npx conductor-board check <step-id>"` as the
  **first gate criterion of every step**. It fails when the board is stale for that
  step (wrong `current_step`, no heartbeat, or last beat >5 min old), so you
  literally cannot pass a gate on work the board doesn't reflect. See spec §8.1.

The setup conductor will:

- **Verify your environment** (Node 18+, npx).
- **Start the live board** — `npx conductor-board &` (auto-opens the browser,
  auto-detects a free port, and writes it to `.conductor/server.json`).
- **Convert the user's skill** into a gated conductor workflow — authoring each gate to
  the **"What makes a good gate"** bar (the skill is the benchmark: translate each step's
  *goal* into a real, cross-validating check), and **red-team every hard gate** (prove it
  fails a known-bad example) into `.conductor/gate-review.md`.
- **Validate** the generated workflow (`npx conductor-board validate`).
- **Confirm the gates with the user** — present each gate (its skill goal, what it rejects,
  its red-team proof) as an **Approve/Reject** card. Execution can't start until the human
  agrees the gates faithfully capture the skill; a rejection routes back to fix the gate.
  (One-time, at authoring — every later run just *enforces* the approved gates.)
- **Execute** it, updating `.conductor/status.json` so the board moves in real time.

Each step is **hard-gated** — it can't proceed until the check passes, so you can't
vibe through setup.

## What makes a good gate — author to this bar

A gate is only worth the run if it would actually **fail bad work**. The common failure
is to write a gate as a *lint* — it confirms the output didn't crash and has the right
shape, then passes anything that renders. That's not a gate; it's a formatter. When you
turn a skill into gated steps, author each gate to this bar:

1. **Check substance, not surface.** "Is it correct / faithful / complete," not "did it
   render without breaking." Output can be perfectly well-formed and completely wrong.
2. **Cross-validate the dimensions against each other — never in isolation.** If the
   skill produces a price, a body, and a source, the gate checks that the FAQ price
   matches the body matches the database, and that the source backs the claim it sits
   beside. Independent per-field checks miss every inconsistency *between* fields.
3. **No self-widening loopholes.** A gate's threshold must not be relaxable by a
   side-effect of the work it's checking (e.g. a word-count floor that loosens just
   because the edit added a sources section). The thing being judged can't move the bar.
4. **Catch fabrication.** Every fact, number, price or claim in the output must trace to
   a ground truth — the input, a cited source, or the database. An invented figure that
   "looks right" is the most dangerous thing a gate can wave through.
5. **Hard where it matters.** The must-haves are **failures**, not "aspirational
   warnings." A warning the agent can ignore is not a gate. Reserve soft/warn for taste.
6. **Prove it catches its own violation (required).** A gate you haven't watched FAIL on
   a crafted violation is assumed broken. Before you trust it, feed it the exact thing
   it's meant to stop and confirm it reds — ship the gate with that red-team line, the
   way you ship a test with a failing case.
7. **Be honest about your limits, then delegate with context.** Mechanical checks can't
   judge prose quality, tone, or whether a source is *relevant*. Don't pretend they can:
   run the mechanical layer hard, hand the judgment dimensions to a reviewer (an
   LLM-judge packet or a human) **with the data they need**, and label the mechanical
   pass as what it is — *necessary, not sufficient.*
8. **Ground checks in real data, not the agent's own output.** Verify prices against the
   database, links against the live web — never against the page the agent just wrote.

A green gate should mean "faithful, accurate, sourced," not "didn't crash." If yours only
guarantees the latter, it's a lint wearing a gate's badge — rewrite it into one that would
actually stop the worst output the skill can produce.

## Heartbeats

**The board shows only what you narrate — so narrate every phase that takes time, not just
when a formal step begins.** That includes **orientation** (reading the runbook/spec, loading
context), **research** (searching, reading sources), and **long implementation work** — open a
card and beat it while you do them. Silent reading or thinking reads as a *stall* to the person
watching, even though you're working. The very first thing a run should do is open a "setup /
reading" card and heartbeat it, so the board lights up immediately instead of going dark while
you orient.

While executing, pulse a heartbeat to yourself **about every 30 seconds** (the default
cadence; the board's Settings let the watcher pick 15s–5min, and it flags a stall after ~3
missed beats) so you — and the human watching the board — stay oriented. Append
`{ "at": "<ISO-8601>", "note": "<1–2 sentences>" }` to the current step's
`heartbeat` array. Read your prior beats first, and orient each one against the
step's gate **and** the workflow's `goal`. Use `[text](url)` links for any PR or
page you produce — the board renders them clickable. After each loop iteration,
distill durable patterns into the step's `learnings` (max 5).

### Group your beats into activity cards

A run should read as a **story**, not a firehose. So narrate in **cards** — and tell the
board where each one begins.

> **A card is one coherent unit of work: a single _intent_ on a single _target_.**
> **intent** = one kind of action (researching, writing, verifying, fixing, shipping…).
> **target** = one thing (a page, a file, an entity, a check).
> A card **opens** when you turn to a new intent _or_ a new target; it **stays open** while
> the play-by-play serves that same intent+target; it **closes** when either changes, or the
> step hands off.

Open a card with `--card`, where the note **is the card's title** (your one-line statement of
intent). The beats that follow — without `--card` — are that card's detail:

```
heartbeat polish-and-ship "Writing fågel's FAQ" --iteration fagel --card
heartbeat polish-and-ship "grounded in GSC + PAA, snippet-shaped" --iteration fagel
heartbeat polish-and-ship "Fixing fågel's dead Källor link" --iteration fagel --card
```

Before each beat, run the check yourself: *"is this still the same intent + target as my open
card?"* — yes → a detail beat; no → open a new card. Good titles are short and concrete
("Claiming the batch", "Verifying artroskopi has no price data"), never "working…". The board
renders each card with its title as the hero, the latest detail as its live status, the rest
collapsed, and a comment box — and threads each card into the next. (Runs with no `--card`
still group mechanically, but you lose the composed titles.)

**When a card closes, spawn a parallel summarizer for it.** The instant you open the *next*
card (the previous one is now done), fire a **background sub-agent** that reads the closed
card's beats and writes a one-line overview — *what that card accomplished* — then keep
working; the summary backfills without slowing you. `heartbeat … --card` prints the card's
id (`[card <ISO>]`); pass it + the closed card's beats to the summarizer, which writes:

```
conductor-board overview <step> "…what the card accomplished…" --card <ISO>
```

Give the summarizer **these exact instructions** — they're tuned to produce overviews that are
a genuine pleasure to read (a flat step-list is the failure mode):

> Write the one-line recap that sits atop a finished card. **One sentence, ≤20 words.** Lead
> with the THING that changed (the page, the FAQ, the sources, the build…) and what became of
> it — the outcome, plus at most one telling detail. **Never** start with "Someone", "I", "We",
> or the card's title. Warm, plain, human. No step-lists, no number pile-ups, no jargon, no
> hedging. Then run `conductor-board overview <step> "<your sentence>" --card <id>` — the
> sentence is the only thing that ships, so write nothing else.
> GOOD: *"The bird page's sources are trustworthy again — three broken links swapped for real Jordbruksverket ones."*
> GOOD: *"The deploy was just waiting on a stale cache — one flush turned everything green."*
> BAD: *"Checked the sources, found three broken links, replaced them, and re-ran the linker."*

The board then shows each card's **overview by default, with a toggle to the raw beats** — so
the user gets a clean per-card recap and can drill into the play-by-play when they want. (No
paid API: the summarizer is a runtime sub-agent. A future option is the board server spawning
`claude -p` automatically on card-close.)

**End every step with a finalBeat.** Before you mark a step `done`, append one last
heartbeat with `"finalBeat": true` that summarizes what the step accomplished and
carries context forward: `"handoff": { "to": "<next-step>", "context": "<what the
next step needs>", "produced": "<file/artifact>" }`. End its note with
*"Handing off to <next-step>."* Before starting a step, read the previous step's
finalBeat. The board marks finalBeats with a `·→` handoff arrow — and the stall
timer resets on **every** heartbeat, finalBeats included, so the cooldown starts
fresh after each handoff and you get natural transition time before the next beat
is due.

When a beat captures something that would improve the workflow for future runs (a
drift you corrected, a faster path, a too-strict gate, a missing instruction), tag
it with an `insight` object — `{ type, seed, step, confidence }`. After the last
step, **before** writing `status: "done"`, synthesize the run's insights, learnings,
and timing into 3–5 `suggestions` in `status.json` (see
[spec §9](./spec/conductor-spec.md#9-insights--optimization)). The board lets the
user apply them back to the conductor.

## Run lifecycle — improve, execute, learn

Every run has three phases. **The conductor file IS the knowledge base** — there
is no separate ledger.

**Phase 0 — Improve (automatic).** `conductor-board status-init` reads the
conductor's `knowledge:` section and, for each **proven** `this-conductor` entry
with `current`/`proposed` text, injects an `_improve::*` card (plus a `_validate`
card) **before** step 1. The board groups these under an **IMPROVEMENT** header.
For each, rewrite the named step's instruction/gate as specified, then mark the
card done; run `conductor-board validate` at the end. Structural changes
(add/remove/reorder a step) appear as cards with an **Approve** button — never
auto-apply them. Then write a scope beat: *"Applied N improvements. Watching M
emerging. Starting workflow."* If there's nothing proven, the phase is empty.

**Phase 0 — Developer directives (the flow manager's word, never glossed).** Still in
Phase 0, read the developer's open directives — notes they left on activity cards and
promoted to steering signals: `conductor-board directives --open`. These are **human**
instructions and outrank your own insights. For **each** one you must do exactly one of:

- **Apply it** — make the change it asks for (edit the step/gate/instruction per its
  scope, add a guardrail, restructure the flow), then record how:
  `conductor-board resolve <cardId> --applied "what I changed"`.
- **Defer it** — only with a real reason (it conflicts with a hard rule, needs the user's
  input, or can't be done safely): `conductor-board resolve <cardId> --deferred "why"`.

**Never leave an open directive untouched and never silently skip one** — the whole point is
that the developer is steering the flow, so each directive comes back applied-with-how or
deferred-with-why, visible on its card. Close Phase 0 with a beat naming what you applied vs
deferred. (A plain note — not promoted to a directive — is context only; read it, don't act.)

**Phase 1+ — Execute.** Run the workflow steps as defined — gates, heartbeats,
finalBeats, breathing beats.

**Run end — Learn.** Before `status: done`, append what you learned to the
conductor's `knowledge:` section with `conductor-board suggest`:

- **`--scope` is required** — `this-conductor` (auto-appliable) | `upstream` |
  `template` | `tooling` | `corpus`. The highest-leverage learnings are usually
  cross-cutting; without a scope they leak into chat and vanish.
- For `this-conductor` insights, include `--step`, `--current`, `--proposed` so a
  future run can auto-apply them once they reach **proven**.
- A repeat sighting bumps `observed` and escalates `emerging` → **proven** (3×).
  The conductor file is version-controlled — commit it and the learning travels
  with the repo. Browse it any time on the board's ✨ **Insights** page.
- Enforce it by **value, not count**: give your **final step** a quality gate,
  `check: "npx conductor-board knowledge --min 1 --min-scopes 2"` — at least one
  insight, spanning at least two scopes — plus a soft gate that fishes for the
  cross-cutting ones: *"What did I learn that does NOT fit a step of this
  workflow?"* A run that produces only `this-conductor` insights has likely missed
  its most valuable findings.

**One workflow, one subdirectory.** Keep each workflow in
`.conductor/<workflow-name>/` (`conductor.yaml`, `status.json`, `insights.md`,
`history/`). The flat `.conductor/status.json` still works for a single workflow,
but subdirectories are the convention.

See the **[Heartbeat Guide](./spec/heartbeat-guide.md)** for how to write good ones.

## Status-writer commands

Instead of hand-editing `status.json`, drive the board with these (they keep it
well-formed and current — which the board-sync gate requires):

```bash
npx conductor-board status-init conductor.yaml     # all steps pending
npx conductor-board step polish running             # running | done | failed
npx conductor-board heartbeat polish "fixed dead link" --insight-type gate_issue --insight-seed "verify link liveness" --insight-scope this-conductor
npx conductor-board heartbeat polish-and-ship "scraping links…" --iteration akupunktur --sub check-links   # a loop sub-step beat (bubbles to the parent)
npx conductor-board heartbeat polish "Writing the FAQ" --card           # opens an activity card (note = its title)
npx conductor-board overview polish "The FAQ now leads with the price." --card <cardId>   # parallel summarizer recap
npx conductor-board heartbeat polish "done" --final --to gate-page
npx conductor-board directives --open                                  # Phase 0: read the developer's steering directives
npx conductor-board resolve <cardId> --applied "added an early-exit gate when the price table is empty"   # …or --deferred "why"
npx conductor-board loop polish akupunktur polish-page done   # a loop sub-step
npx conductor-board suggest "Sitemap-first is faster" --scope this-conductor --step discover-prices --current "Nav first." --proposed "Sitemap first, nav fallback."   # → conductor knowledge:
npx conductor-board knowledge --min 1 --min-scopes 2   # quality gate: ≥1 insight, ≥2 scopes
npx conductor-board complete polish --attest-soft   # run hard gates, then advance
npx conductor-board complete polish-and-ship::akupunktur::check-links --attest-soft   # a loop sub-step
```

`complete` runs the step's **hard** gates itself (you can't fake them — the board
shows 🔒 verified vs ✋ attested) and only advances when they pass.

Housekeeping: `npx conductor-board ps` lists running boards, `stop [--all]` stops
them, `clean --keep 20 --prune-heartbeats` trims history and archives old beats.

## Loops & human approval

- **Loops** (`type: loop` over a list) run one gated sub-sequence per item. The
  board shows a loop as its own view: an **overview of every iteration**, each
  drillable into a **full kanban** of that iteration's sub-steps. **Frontload the
  whole iteration list as `pending` the moment you scope it** (write a "scope beat"
  naming all items) so the plan is visible before any card moves. Then update each
  item's sub-steps in the status `iterations` map as you go, and end each iteration
  with a finalBeat. `parallel: true` runs items at once; `parallel: auto` lets you
  decide at runtime (scout the first iteration, then parallelize the rest).
- **Do every frontloaded iteration, in order, before the loop closes — never skip
  one.** For a sequential loop, work the items in the order you scoped them, finishing
  each (all its sub-steps) before starting the next; do not jump ahead or drop one. A
  frontloaded item left `pending` is a *skipped page*, not a completed loop — and
  `complete <loopId>` refuses to advance while any iteration is still incomplete (it
  lists the ones you missed), so you can't silently lose coverage. Before leaving the
  loop, confirm the iteration count done == the count you frontloaded.
- **Approval** (`type: approval`) pauses for a human. Mark the step
  `awaiting_approval` (gate `pending_human`) with an `approval` object, then wait —
  the board shows an Approve/Reject card and writes the human's decisions back into
  `status.json`. Read them and route to `actions.approve` / `actions.reject`. See
  spec §4.4.

## Gate commands & CommonJS

If the project uses CommonJS (the Node.js default), inline `node -e` / `tsx -e`
blocks with **top-level `await`** will fail. Wrap async in
`async function main() { … } main()`, or call a small `.ts`/`.js` helper script from
the gate's `check:` — helper scripts are more reliable than complex one-liners.

---

Need the conductor format while converting a skill? It's in
[`spec/conductor-spec.md`](./spec/conductor-spec.md) with worked
[`examples/`](./examples). Don't have the repo on disk? Fetch the setup conductor
raw:
`https://raw.githubusercontent.com/mettafive/agent-conductor/main/setup.conductor.yaml`
