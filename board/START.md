# Start here — running a skill on Conductor

Read this first. It is the shortest path from "here is a skill" to "the run is
happening on a visible board," plus the handful of gotchas that bite.

## The one command

```bash
npx conductor-board run SKILL.md
```

`run` does the whole pipeline for you, in order:

1. **Compile-if-needed** — turns the skill into cards (`workflow.json`). A skill
   already compiled is reused; only a brand-new or **edited** skill pays the
   compile. (Force a recompile with `--force`.)
2. **Pick the worker** — chosen automatically and **printed** as one line, e.g.
   `worker: claude (cap 5)`. No guessing which runtime ran.
3. **Integrate (if there are open insights)** — the integration ("shaping") cards
   lead the run on the same board, rewriting the plan from accumulated insights,
   then the work flows after. One continuous run, no second confirm. A failed
   integration halts cleanly (work never runs on a half-integrated plan).
4. **Open the board** — a visible Kanban board opens (or attaches) on the run's
   own workflow. Use `--headless` for CI/cron/no-display.
5. **Dispatch** — fans the cards out to bounded workers, refills as they finish,
   reclaims any that crash, and exits when every card is terminal.

That's it. There is no separate `init-board` + `dispatch` to stitch by hand.

### The state rule (what a re-run does)

`run` evaluates one rule against the run's `status.json`:

> **Run everything that isn't done. If everything's done, rerun fresh.**

- **Any card not done** (pending, failed, or a crash-stranded `running`) →
  **resume**: done cards are kept, the rest are reset to pending and dispatched.
- **All cards done** → **rerun fresh**: re-initialise and run them all again.
- **No status yet** → run all.

Failed is not special — it is just "not done," so it gets retried on the next
`run`. **Escape hatch:** to start completely clean, delete the run state
(`.conductor/<skill>/status.json`); the next `run` treats it as new.

## Prerequisites

- **A worker on PATH** — `claude` *or* `codex`. With neither (and no
  `CONDUCTOR_WORKER_CMD`), `run` fails loud and dispatches nothing. Override the
  runtime with `CONDUCTOR_WORKER_CMD="<shell command>"` (brief arrives on stdin).
- **Not a restrictive sandbox** — a file-descriptor-limited sandbox can break the
  dispatcher's `fs.watch` (it degrades to a slower patrol, but don't rely on it),
  and Codex nests its own `--sandbox`, so run outside an outer sandbox.
- **Port 3042 free or attachable** — the board's identity is the port. A healthy
  board there is reused; otherwise one is spawned. Change it with `--port`.

## Gotchas (the ones that actually bite)

- **PATH → silent runtime.** If `claude` isn't found, `run` uses `codex` and
  *says so* (`worker: codex (cap N) — claude not found, using codex`). Read the
  worker line; it is never silent now.
- **Per-runtime cap.** Each worker has its own safe descendant cap (Claude 5,
  Codex larger). A cap tuned to one runtime no longer kills the other. Override
  with `CONDUCTOR_WORKER_CAP=<n>` if a runtime's footprint is unusual.
- **Board not opening?** Only `run` / `init-board` / the bare `conductor-board`
  open a tab. `compile` deliberately does not. Use `run`, not `compile`, to see
  a board.
- **Scoped paths.** `run` keeps each skill's files under `.conductor/<skill>/`
  and threads those paths through every step — you never pass `--path` /
  `--workflow` yourself. (Calling `dispatch` / `init-board` by hand still
  defaults to flat `.conductor/`; prefer `run`.)
- **fs.watch fault → patrol.** If the watch faults (EMFILE under fd pressure),
  the dispatcher logs it and falls back to the 5-second patrol instead of
  crashing. The run still completes, just on the slower cadence.

## Doing it by hand (rarely needed)

`run` is the supported path. The individual verbs still exist —
`compile --skill`, `init-board`, `dispatch`, `run-card <i>` — and are documented
in `CONDUCTOR.md`. Reach for them only when you need to drive one phase in
isolation.
