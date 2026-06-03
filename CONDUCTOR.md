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
- **`--no-open`** is only for CI/headless. Don't add it to the first start.

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

**Insights are remembered across runs.** When a run finishes, the board merges its
suggestions into a persistent, deduped ledger at `.conductor/insights.md` (human
view) + `insights.json`, and tracks which the user applies or dismisses. So:

- **At the start of every run, read `.conductor/insights.md`** to carry forward what
  past runs learned. Don't re-surface insights already recorded there; prefer
  acting on the ones still marked **Open**.
- Writing zero suggestions when the run clearly surfaced improvements wastes the
  whole loop — capture them so the next run is better than this one.

See the **[Heartbeat Guide](./spec/heartbeat-guide.md)** for how to write good ones.

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
