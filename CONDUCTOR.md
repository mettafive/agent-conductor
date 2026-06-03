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
- **Convert the user's skill** into a gated conductor workflow.
- **Validate** the generated workflow (`npx conductor-board validate`).
- **Execute** it, updating `.conductor/status.json` so the board moves in real time.

Each step is **hard-gated** — it can't proceed until the check passes, so you can't
vibe through setup.

## Heartbeats

While executing, pulse a heartbeat to yourself **at least once per minute** so you —
and the human watching the board — stay oriented. Append
`{ "at": "<ISO-8601>", "note": "<1–2 sentences>" }` to the current step's
`heartbeat` array. Read your prior beats first, and orient each one against the
step's gate **and** the workflow's `goal`. Use `[text](url)` links for any PR or
page you produce — the board renders them clickable. After each loop iteration,
distill durable patterns into the step's `learnings` (max 5).

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
npx conductor-board heartbeat polish "done" --final --to gate-page
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
