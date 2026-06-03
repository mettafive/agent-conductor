# Agent Conductor — For Agents

**Follow the setup conductor to get started.**

1. Read [`setup.conductor.yaml`](./setup.conductor.yaml) from this repo.
2. Execute it as a conductor workflow.
3. Everything else is handled by its steps and gates.

The setup conductor will:

- **Verify your environment** (Node 18+, npx).
- **Start the live board** — `npx conductor-board` (auto-detects a free port and
  writes it to `.conductor/server.json`).
- **Convert the user's skill** into a gated conductor workflow.
- **Validate** the generated workflow (`npx conductor-board validate`).
- **Execute** it, updating `.conductor/status.json` so the board moves in real time.

Each step is **hard-gated** — it can't proceed until the check passes, so you can't
vibe through setup.

---

Need the conductor format while converting a skill? It's in
[`spec/conductor-spec.md`](./spec/conductor-spec.md) with worked
[`examples/`](./examples). Don't have the repo on disk? Fetch the setup conductor
raw:
`https://raw.githubusercontent.com/mettafive/agent-conductor/main/setup.conductor.yaml`
