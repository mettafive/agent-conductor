import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveTopLevelIndex } from "./dependencies.js";
import {
  timingEnabled,
  TimingLedger,
  readWorkerSidecar,
  buildReport,
  emitPaths,
} from "./timing.js";

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const amber = (s) => `\x1b[38;5;214m${s}\x1b[0m`;
const iris = (s) => `\x1b[38;5;141m${s}\x1b[0m`;

// The resolved local cli binary — workers run through THIS, never npx.
const CLI_BIN = fileURLToPath(new URL("../bin/cli.js", import.meta.url));

const HELP = `
  conductor-board dispatch — the dumb fan-out loop (the "hander")

  A programmatic, model-free loop. It fans out eligible cards to leashed
  run-card workers (one detached process per card), refills slots as workers
  finish, and reclaims frozen/crashed cards by watching the WORKER PROCESS —
  never the heartbeat (a healthy card beats through its whole run with no
  status change). status.json on disk stays the source of truth / the real lock.

  Triggers: an fs.watch "completion bell" on the status dir (debounced) plus a
  slow setInterval patrol — both run the SAME idempotent dispatch() pass.

  Usage
    $ node bin/cli.js dispatch [options]

  Options
    --path, -p <file>      status.json (default: .conductor/status.json)
    --workflow, -c <file>  workflow.json (default: discovered next to status.json)
    --cap <n>              max concurrent run-card workers
                           (default: workflow.max_concurrency, or
                            CONDUCTOR_MAX_CONCURRENCY, or 6)
    --timing               (opt-in, also needs CONDUCTOR_TIMING=1) The Timekeeper:
                           stamp per-card boundaries + emit a leak-map table to
                           .conductor/timing-<run_id>.md + .json. Default OFF =
                           byte-identical behavior. PURE instrumentation.
    --help, -h             this help

  Safety: every launched run-card runs detached in its OWN process group; the
  dispatcher tracks each pgid and SIGKILLs them all on SIGINT/SIGTERM/exit, so
  aborting leaves no orphans. A global ceiling (cap × 8 descendants) aborts loud.
`;

function flag(args, names) {
  for (const n of names) {
    const i = args.indexOf(n);
    if (i !== -1) {
      const v = args[i + 1];
      return v && !v.startsWith("-") ? v : true;
    }
  }
  return undefined;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// ----- status helpers (status.json is the source of truth / the real lock) -----

function stepEntry(status, doc, index) {
  const step = doc.steps?.[index];
  return status?.steps?.[String(index)] || (step?.id ? status?.steps?.[step.id] : null) || null;
}

function stepStatus(status, doc, index) {
  return stepEntry(status, doc, index)?.status || "pending";
}

const TERMINAL = new Set(["done", "failed", "blocked"]);

// Mirror writer.save(): atomic-ish single write of the whole status doc.
function saveStatus(statusPath, status) {
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
}

function statusKey(status, doc, index) {
  if (status.steps?.[String(index)]) return String(index);
  const id = doc.steps?.[index]?.id;
  if (id && status.steps?.[id]) return id;
  return String(index);
}

// Reset a card to pending so the next pass re-hands it (reclaim path).
function resetCardToPending(statusPath, status, doc, index) {
  const key = statusKey(status, doc, index);
  const step = (status.steps[key] = status.steps[key] || { attempt: 1 });
  step.status = "pending";
  if (step.gate === "checking" || step.gate === "running") step.gate = "pending";
  delete step.completed_at;
  saveStatus(statusPath, status);
}

// Claim a card by writing status:"running" to disk — the dispatcher is the
// single writer, so this is the authoritative claim from the moment of hand-out.
// Mirrors writer.runStep()'s running write (started_at, gate→pending, current_step)
// so the board renders the boot/ingest window under "running", not as a "next" gap.
// Idempotent: if already running, leave started_at untouched.
function claimCardRunning(statusPath, status, doc, index) {
  const key = statusKey(status, doc, index);
  const step = (status.steps[key] = status.steps[key] || { attempt: 1 });
  if (step.status === "running") return; // already claimed; do not reset started_at
  step.status = "running";
  step.started_at = step.started_at || new Date().toISOString();
  step.gate = step.gate && step.gate !== "passed" ? step.gate : "pending";
  status.current_step = key;
  saveStatus(statusPath, status);
}

// Mark a card failed (breaker tripped — stop re-handing forever).
function blockCard(statusPath, status, doc, index, note) {
  const key = statusKey(status, doc, index);
  const step = (status.steps[key] = status.steps[key] || { attempt: 1 });
  step.status = "failed";
  step.gate = "failed";
  step.completed_at = new Date().toISOString();
  step.dispatch_note = note;
  saveStatus(statusPath, status);
}

// ----- dependency graph (model-free fact-checks only) -----

// Count how many cards transitively REQUIRE `index` — the unblock weight. The
// card whose completion frees the most downstream goes first.
function unblockWeight(doc, index) {
  const directDependents = (i) =>
    doc.steps
      .map((s, j) => ({ s, j }))
      .filter(({ s }) => (s?.requires || []).map(Number).includes(i))
      .map(({ j }) => j);
  const seen = new Set();
  const stack = [...directDependents(index)];
  while (stack.length) {
    const j = stack.pop();
    if (seen.has(j)) continue;
    seen.add(j);
    for (const k of directDependents(j)) if (!seen.has(k)) stack.push(k);
  }
  return seen.size;
}

// ----- process subtree counting (liveness via the PROCESS, never the beat) -----

function countDescendants(rootPid) {
  let count = 0;
  const stack = [rootPid];
  const seen = new Set();
  while (stack.length) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    const r = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
    if (r.status !== 0 || !r.stdout) continue;
    for (const line of r.stdout.split(/\s+/)) {
      const child = Number(line.trim());
      if (Number.isInteger(child) && child > 0 && !seen.has(child)) {
        count++;
        stack.push(child);
      }
    }
  }
  return count;
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

function killGroup(pgid) {
  try {
    process.kill(-pgid, "SIGKILL");
  } catch {
    /* group may be gone */
  }
}

// Hard wall-clock backstop: longer than run-card's own ~20-min worker timeout.
const HARD_MAX_WALL_MS = 25 * 60 * 1000;

export async function runDispatch(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return true;
  }

  const p = flag(args, ["--path", "-p"]);
  const statusPath = path.resolve(process.cwd(), typeof p === "string" ? p : ".conductor/status.json");
  const wfArg = flag(args, ["--workflow", "--conductor", "-c"]);
  const cwd = process.cwd();

  let workflowPath = null;
  if (typeof wfArg === "string") workflowPath = path.resolve(cwd, wfArg);
  else {
    const guess = path.join(path.dirname(statusPath), "workflow.json");
    if (fs.existsSync(guess)) workflowPath = guess;
  }
  if (!workflowPath || !fs.existsSync(workflowPath)) {
    console.error(red(`no workflow.json found (pass --workflow). looked next to ${statusPath}`));
    return false;
  }
  if (!fs.existsSync(statusPath)) {
    console.error(red(`no status.json at ${statusPath}`));
    return false;
  }

  let doc;
  try {
    doc = readJson(workflowPath);
  } catch (e) {
    console.error(red(`could not parse workflow.json: ${e.message}`));
    return false;
  }

  // ----- the cap -----
  const capArg = flag(args, ["--cap"]);
  const cap =
    Number(typeof capArg === "string" ? capArg : NaN) ||
    Number(process.env.CONDUCTOR_MAX_CONCURRENCY) ||
    Number(doc.max_concurrency) ||
    6;
  const maxAttempts = Number(doc.max_attempts) || 5;
  const GLOBAL_DESCENDANT_CEILING = cap * 8;

  // ----- THE TIMEKEEPER (pure instrumentation, opt-in: --timing AND CONDUCTOR_TIMING=1) -----
  // Default OFF => no ledger, no extra writes, behavior byte-identical.
  const TIMING = timingEnabled(args);
  const ledger = TIMING ? new TimingLedger() : null;
  const runId =
    (function () {
      try {
        return readJson(statusPath).run_id || null;
      } catch {
        return null;
      }
    })() || new Date().toISOString().replace(/[:.]/g, "-");

  // ----- in-flight map: cardIndex -> { proc, pgid, startedAt, ... } -----
  const inFlight = new Map();
  // per-card hand/reclaim accounting (the breaker)
  const handCount = new Map();
  let maxProcsObserved = 0;
  let aborting = false;
  let stopped = false;

  // ----- safety: kill EVERY tracked process group on abort/exit -----
  function killAll() {
    for (const [, info] of inFlight) {
      if (info.pgid) killGroup(info.pgid);
    }
  }
  function abortLoud(reason) {
    if (aborting) return;
    aborting = true;
    console.error(red(`\n  !! DISPATCHER ABORT: ${reason}`));
    console.error(red(`  killing every tracked run-card process group...`));
    killAll();
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 300);
  }
  const onSignal = (sig) => {
    console.error(amber(`\n  received ${sig} — SIGKILLing all tracked worker groups, leaving no orphans.`));
    killAll();
    process.exit(130);
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("exit", () => killAll());

  console.log("");
  console.log(`  ${iris("conductor-board dispatch")} ${dim("— dumb fan-out loop")}`);
  console.log(`  ${bold("status:  ")} ${statusPath}`);
  console.log(`  ${bold("workflow:")} ${workflowPath}`);
  console.log(`  ${bold("cap:     ")} ${cap} concurrent run-card workers (max_attempts ${maxAttempts})`);
  console.log(dim(`  ceiling: abort if total descendants exceed ${GLOBAL_DESCENDANT_CEILING}`));
  console.log("");

  // ----- adopt any card already running on disk (rebuild the cache) -----
  (function adopt() {
    let status;
    try {
      status = readJson(statusPath);
    } catch {
      return;
    }
    for (let i = 0; i < doc.steps.length; i++) {
      if (stepStatus(status, doc, i) === "running" && !inFlight.has(i)) {
        inFlight.set(i, { proc: null, pgid: null, startedAt: Date.now(), adopted: true });
        console.log(dim(`  adopted card ${i} (already running on disk; reclaimed if it never finishes)`));
      }
    }
  })();

  // ----- launch one detached run-card worker for a card -----
  function launch(index) {
    // TIMEKEEPER: t_spawn — worker process launched (the spawn call). measured.
    if (ledger) ledger.markSpawn(index, doc.steps[index]?.title || "");
    // TIMEKEEPER: propagate --timing to the worker so it captures the stream
    // (worker-side boundaries). CONDUCTOR_TIMING=1 is already inherited via env.
    // Only added when the dispatcher itself has timing on; default OFF = no flag.
    const workerArgs = [CLI_BIN, "run-card", String(index), "--path", statusPath, "--workflow", workflowPath];
    if (ledger) workerArgs.push("--timing");
    const child = spawn(
      process.execPath,
      workerArgs,
      {
        cwd,
        env: { ...process.env, CONDUCTOR_HEADLESS: "1" },
        detached: true, // its own process group => we can kill -pgid
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const pgid = child.pid;
    const info = {
      proc: child,
      pgid,
      startedAt: Date.now(),
      adopted: false,
      exited: false,
    };
    inFlight.set(index, info);
    handCount.set(index, (handCount.get(index) || 0) + 1);

    let out = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
      if (out.length > 2 * 1024 * 1024) out = out.slice(-1024 * 1024);
    });
    child.stderr.on("data", () => {});
    child.on("close", (code, signal) => {
      info.exited = true;
      info.exitCode = code;
      info.exitSignal = signal;
      info.exitedAt = Date.now();
      info.tailOut = out.slice(-600);
      // TIMEKEEPER: t_exit (close handler) + exit_code. measured. Then fold the
      // worker-side sidecar (best-effort) the run-card worker dropped on disk.
      if (ledger) {
        ledger.markExit(index, code);
        ledger.foldWorker(index, readWorkerSidecar(statusPath, index));
      }
      scheduleDispatch("worker-exit");
    });
    child.on("error", () => {
      info.exited = true;
      info.exitError = true;
      scheduleDispatch("worker-error");
    });

    console.log(
      `  ${green("-> HAND-OUT")} card ${index} ${dim(`"${(doc.steps[index]?.title || "").slice(0, 50)}"`)} ` +
        `${dim(`(pgid ${pgid}, attempt ${handCount.get(index)})`)}`,
    );
  }

  // ----- the idempotent pass -----
  function dispatchPass(trigger) {
    if (aborting || stopped) return;

    // global ceiling check (we had a 43-process runaway before)
    let totalDescendants = 0;
    for (const [, info] of inFlight) {
      if (info.pgid && pidAlive(info.pgid)) {
        totalDescendants += 1 + countDescendants(info.pgid);
      }
    }
    if (totalDescendants > maxProcsObserved) maxProcsObserved = totalDescendants;
    if (totalDescendants > GLOBAL_DESCENDANT_CEILING) {
      abortLoud(`total descendant process count ${totalDescendants} exceeded ceiling ${GLOBAL_DESCENDANT_CEILING}`);
      return;
    }

    let status;
    try {
      status = readJson(statusPath);
    } catch {
      return; // mid-write; the watch re-fires
    }

    // ===== RECLAIM branch (FIRST) — liveness = the PROCESS, never the beat. =====
    for (const [index, info] of [...inFlight]) {
      const onDisk = stepStatus(status, doc, index);

      // Primary: a tracked run-card PROCESS has EXITED.
      if (info.exited) {
        if (TERMINAL.has(onDisk)) {
          console.log(`  ${green("DONE")} card ${index} ${dim(`(on-disk: ${onDisk}; freeing slot)`)}`);
          inFlight.delete(index);
        } else {
          // worker died WITHOUT completing => freeze/crash.
          if (info.pgid) killGroup(info.pgid); // defensive subtree kill
          const attempts = handCount.get(index) || 0;
          if (attempts >= maxAttempts) {
            console.log(
              `  ${red("BREAKER")} card ${index} crashed ${attempts}x (max_attempts ${maxAttempts}) — marking failed, not re-handing.`,
            );
            blockCard(statusPath, status, doc, index, `dispatcher breaker: ${attempts} crashed attempts`);
            inFlight.delete(index);
          } else {
            console.log(
              `  ${amber("RECLAIM")} card ${index} ${dim(`(worker exited; on-disk "${onDisk}" not terminal — reset to pending)`)}`,
            );
            resetCardToPending(statusPath, status, doc, index);
            inFlight.delete(index);
          }
        }
        continue;
      }

      // Backstop: process still alive but exceeded hard wall-clock.
      const age = Date.now() - info.startedAt;
      if (age > HARD_MAX_WALL_MS) {
        if (info.pgid) killGroup(info.pgid);
        if (TERMINAL.has(onDisk)) {
          inFlight.delete(index);
          continue;
        }
        const attempts = handCount.get(index) || 0;
        if (attempts >= maxAttempts) {
          console.log(`  ${red("BREAKER")} card ${index} exceeded ${Math.round(age / 60000)}m ${attempts}x — marking failed.`);
          blockCard(statusPath, status, doc, index, `dispatcher breaker: wall-clock + ${attempts} attempts`);
        } else {
          console.log(
            `  ${amber("RECLAIM")} card ${index} ${dim(`(exceeded hard ${Math.round(HARD_MAX_WALL_MS / 60000)}m wall-clock — killed + reset)`)}`,
          );
          resetCardToPending(statusPath, status, doc, index);
        }
        inFlight.delete(index);
      }
    }

    // ===== PAUSE honor — while top-level status==="paused", the dispatcher idles:
    // hand NOTHING, do not finish. Reclaim above still ran (a worker that crashed
    // mid-pause frees its slot), but no new cards go out until status flips back to
    // "running". The fs.watch on the resume write + the patrol re-fire this pass. =====
    if (status.status === "paused") {
      void trigger;
      return;
    }

    // ===== HAND-OUT branch. =====
    const openSlots = cap - inFlight.size;
    if (openSlots > 0) {
      const eligible = [];
      for (let i = 0; i < doc.steps.length; i++) {
        if (inFlight.has(i)) continue;
        if (stepStatus(status, doc, i) !== "pending") continue;
        const requires = (doc.steps[i]?.requires || []).map(Number);
        const allDone = requires.every((dep) => stepStatus(status, doc, dep) === "done");
        if (allDone) {
          eligible.push(i);
          // TIMEKEEPER: t_eligible — card entered the eligible set (deps satisfied).
          // Stamped once (markEligible no-ops if already set) so dispatch_wait
          // measures the real wait, not the last pass. measured.
          if (ledger) ledger.markEligible(i, doc.steps[i]?.title || "");
        }
      }
      // unblockers first: most transitive dependents leads.
      eligible.sort((a, b) => unblockWeight(doc, b) - unblockWeight(doc, a) || a - b);

      for (const index of eligible.slice(0, openSlots)) {
        if (inFlight.has(index)) continue;
        // claim guard FIRST (fast within-pass guard for the gap before spawn).
        inFlight.set(index, { proc: null, pgid: null, startedAt: Date.now(), claiming: true });
        // AUTHORITATIVE CLAIM: write status:"running" to disk SYNCHRONOUSLY, BEFORE
        // spawning run-card. The boot/ingest window now renders under "running"
        // instead of as a long "sitting in next" gap. Dispatcher is the single writer.
        // TIMEKEEPER: t_handout — dispatcher claims it (flip-to-running). measured.
        if (ledger) ledger.markHandout(index);
        try {
          claimCardRunning(statusPath, status, doc, index);
        } catch (e) {
          console.error(red(`  could not claim card ${index} as running: ${e.message}`));
        }
        launch(index); // launch() overwrites the entry with the real proc/pgid
      }
    }

    // ===== Termination check. =====
    const allTerminal = doc.steps.every((_, i) => TERMINAL.has(stepStatus(status, doc, i)));
    if (allTerminal && inFlight.size === 0) {
      finish(status);
      return;
    }

    void trigger; // idempotent: nothing eligible + nothing reclaimable => no-op
  }

  function finish(status) {
    if (stopped) return;
    stopped = true;
    const tally = { done: 0, failed: 0, blocked: 0 };
    doc.steps.forEach((_, i) => {
      const s = stepStatus(status, doc, i);
      if (s === "done") tally.done++;
      else if (s === "failed") tally.failed++;
      else if (s === "blocked") tally.blocked++;
    });
    console.log("");
    console.log(`  ${bold("=== DISPATCH COMPLETE ===")}`);
    console.log(
      `  ${green(`${tally.done} done`)}, ${tally.failed ? red(`${tally.failed} failed`) : dim("0 failed")}, ` +
        `${tally.blocked ? amber(`${tally.blocked} blocked`) : dim("0 blocked")} of ${doc.steps.length} cards`,
    );
    console.log(`  ${dim(`max concurrent descendant processes observed: ${maxProcsObserved}`)}`);
    console.log("");

    // TIMEKEEPER: emit the per-run timing table — print to stdout + write files.
    // Behind --timing (ledger only exists when enabled), so default-off is a no-op.
    if (ledger) {
      try {
        const rows = [...ledger.cards.values()].sort((a, b) => a.index - b.index);
        const { md } = buildReport(rows, { runId, workflow: doc.name || null });
        const { json } = buildReport(rows, { runId, workflow: doc.name || null });
        const out = emitPaths(statusPath, runId);
        fs.mkdirSync(path.dirname(out.md), { recursive: true });
        fs.writeFileSync(out.md, md);
        fs.writeFileSync(out.json, JSON.stringify(json, null, 2));
        console.log(md);
        console.log("");
        console.log(`  ${dim(`timing written: ${out.md}`)}`);
        console.log(`  ${dim(`timing written: ${out.json}`)}`);
        console.log("");
      } catch (e) {
        console.error(red(`  timing emit failed: ${e.message}`));
      }
    }

    cleanupAndExit(0);
  }

  function cleanupAndExit(code) {
    try {
      if (watcher) watcher.close();
    } catch {
      /* ignore */
    }
    clearInterval(patrol);
    process.exit(code);
  }

  // ----- triggers: a debounced fs.watch "completion bell" + a slow patrol -----
  let debounceTimer = null;
  function scheduleDispatch(trigger) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      try {
        dispatchPass(trigger);
      } catch (e) {
        console.error(red(`  dispatch pass error (${trigger}): ${e.message}`));
      }
    }, 250);
  }

  let watcher = null;
  try {
    watcher = fs.watch(path.dirname(statusPath), { persistent: true }, (_evt, fname) => {
      if (!fname || /status\.json$/.test(fname) || /artifacts/.test(String(fname))) {
        scheduleDispatch("fs.watch");
      }
    });
  } catch (e) {
    console.log(amber(`  fs.watch unavailable (${e.message}) — relying on the patrol interval.`));
  }

  // slow patrol — same dispatch() code; catches missed bells + wall-clock reclaim.
  const patrol = setInterval(() => {
    try {
      dispatchPass("patrol");
    } catch (e) {
      console.error(red(`  patrol pass error: ${e.message}`));
    }
  }, 5000);

  // first pass immediately.
  dispatchPass("startup");

  void resolveTopLevelIndex;

  // keep the process alive (interval + watcher do); exit via cleanupAndExit/signals.
  await new Promise(() => {});
  return true;
}
