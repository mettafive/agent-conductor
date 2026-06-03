# Agent Conductor — For Agents

**Follow the setup conductor to get started.**

1. Read [`setup.conductor.yaml`](./setup.conductor.yaml) from this repo.
2. Execute it as a conductor workflow.
3. Everything else is handled by its steps and gates.

## Quick Setup

Start the board in the background first — it **opens your browser automatically**:

```bash
npx conductor-board &
```

Don't add `--no-open` here; that's only for CI/headless. Then read
`setup.conductor.yaml` and execute it.

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

When a beat captures something that would improve the workflow for future runs (a
drift you corrected, a faster path, a too-strict gate, a missing instruction), tag
it with an `insight` object — `{ type, seed, step, confidence }`. After the last
step, **before** writing `status: "done"`, synthesize the run's insights, learnings,
and timing into 3–5 `suggestions` in `status.json` (see
[spec §9](./spec/conductor-spec.md#9-insights--optimization)). The board lets the
user apply them back to the conductor.

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
