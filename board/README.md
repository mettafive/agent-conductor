# agent-conductor (board)

The live local Kanban board for [Agent Conductor](../README.md). It watches
`.conductor/status.json` and renders your conductor workflow in real time as the
agent executes it.

```bash
npx agent-conductor
```

```
🎼 agent-conductor
Board live at http://localhost:3042 — watching .conductor/status.json
```

## What it does

- **Watches** `.conductor/status.json` via `fs.watch` and streams changes to the
  browser over **Server-Sent Events** — no polling, no WebSocket.
- **Merges** the live status with the conductor definition (auto-discovered next
  to the status file) so cards show the full picture: instruction, gate criteria,
  soft/hard split, `requires`, conditions, outputs.
- **Renders** a board with columns **Pending → Running → Gate Check → Done** and a
  **Failed** side column. Cards animate between columns as status changes.
- **Archives** every completed/failed run to `.conductor/history/` and shows a
  **history sidebar** — click any past run to view its frozen final state.

## Options

| Flag | Default | Description |
| --- | --- | --- |
| `--path`, `-p` | `.conductor/status.json` | Path to the status file |
| `--conductor`, `-c` | auto-discovered | Path to the conductor `.yaml` |
| `--port` | `3042` | Port to serve on (walks forward if taken) |
| `--no-open` | — | Don't open the browser |
| `--help`, `-h` | — | Show help |

```bash
npx agent-conductor --path ./run/status.json --port 3001
npx agent-conductor --conductor ./workflows/review.yaml
```

The board reads `status.json` for live **state** and the conductor file for step
**structure**. If no conductor file is found, cards degrade gracefully to
status-only.

## History

When a run reaches `done` or `failed`, the server archives a **self-contained**
record (the final status plus the conductor that produced it) to
`.conductor/history/<run_id>.json`. The board's history sidebar lists past runs
grouped by workflow; selecting one shows its frozen final state. Deep-link a run
with `?run=<run_id>`.

Give each run a distinct `run_id` (a timestamp works well) in `status.json` so
runs archive cleanly instead of overwriting each other.

| Endpoint | Returns |
| --- | --- |
| `GET /api/state` | current `{ status, conductorYaml }` snapshot |
| `GET /api/history` | summaries of archived runs, newest first |
| `GET /api/history/:run_id` | one full archived run (status + conductor) |
| `GET /events` | SSE stream of `update` and `history` events |

## Card anatomy

- Step ID, first line of the instruction, and soft/hard gate badges
- Attempt counter (`×2`) when a step has been retried
- Condition steps show a fork icon and the branch taken
- `requires` dependencies render as a chip on the card
- Click a card to expand its gate criteria with per-criterion pass/fail

## Architecture

```
.conductor/status.json ──fs.watch──┐
.conductor/conductor.yaml ─────────┤
                                   ▼
                       server (zero-dep node:http)
                          ├── serves dist/ (React app)
                          └── /events  (Server-Sent Events)
                                   ▼
                       browser: parse + merge + render
```

The server has **zero runtime dependencies** — plain `node:http`, `fs`, and
`fs.watch`. YAML is parsed in the browser, so the server never needs a parser.

## Develop

```bash
npm install
npm run build              # build the React app into dist/
npm start                  # serve the board (node bin/cli.js)

# drive a demo workflow through the board to see the animations + history:
npm run simulate -- --fail security-audit       # one run, with a retry
npm run simulate -- --fatal coverage-check      # a run that ends failed
npm run simulate -- --loop                      # keep archiving runs
```

`scripts/simulate.js` is a dev-only tool that walks a conductor and writes
`status.json` over time (it is not part of the published package).
