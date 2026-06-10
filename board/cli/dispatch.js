import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveTopLevelIndex } from "./dependencies.js";
import { artifactsDir, findReceiptArtifact } from "./artifacts.js";
import { mutateStatus } from "./status-store.js";
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
// Routed through the lock + a FRESH read so the dispatcher's whole-doc write never
// clobbers a worker beat written since the loop's top-of-pass read.
function resetCardToPending(statusPath, status, doc, index) {
  mutateStatus(statusPath, (fresh) => {
    if (!fresh) return null;
    fresh.steps = fresh.steps || {};
    const key = statusKey(fresh, doc, index);
    const step = (fresh.steps[key] = fresh.steps[key] || { attempt: 1 });
    step.status = "pending";
    if (step.gate === "checking" || step.gate === "running") step.gate = "pending";
    delete step.completed_at;
  });
}

// Claim a card by writing status:"running" to disk — the dispatcher is the
// single writer, so this is the authoritative claim from the moment of hand-out.
// Mirrors writer.runStep()'s running write (started_at, gate→pending, current_step)
// so the board renders the boot/ingest window under "running", not as a "next" gap.
// Idempotent: if already running, leave started_at untouched.
function claimCardRunning(statusPath, status, doc, index) {
  mutateStatus(statusPath, (fresh) => {
    if (!fresh) return null;
    fresh.steps = fresh.steps || {};
    const key = statusKey(fresh, doc, index);
    const step = (fresh.steps[key] = fresh.steps[key] || { attempt: 1 });
    if (step.status === "running") return null; // already claimed; no write, no started_at reset
    step.status = "running";
    step.started_at = step.started_at || new Date().toISOString();
    step.gate = step.gate && step.gate !== "passed" ? step.gate : "pending";
    fresh.current_step = key;
  });
}

// Mark a card failed (breaker tripped — stop re-handing forever).
function blockCard(statusPath, status, doc, index, note) {
  mutateStatus(statusPath, (fresh) => {
    if (!fresh) return null;
    fresh.steps = fresh.steps || {};
    const key = statusKey(fresh, doc, index);
    const step = (fresh.steps[key] = fresh.steps[key] || { attempt: 1 });
    step.status = "failed";
    step.gate = "failed";
    step.completed_at = new Date().toISOString();
    step.dispatch_note = note;
  });
}

// FIX 1.1: did the card's work LAND? gate accepted (passed) AND the receipt
// artifact is durable on disk. This is the done-at-gate-acceptance signal
// (commit 303b64e): a worker that passed its gate and wrote its receipt is
// terminal even if its PROCESS exited a beat before `complete` flipped
// status:done. Used to tell a spurious reclaim from a genuine mid-card crash.
function workLanded(statusPath, status, doc, index) {
  const entry = stepEntry(status, doc, index);
  if (!entry || entry.gate !== "passed") return false;
  const recorded = entry.artifact || entry.receipt;
  if (recorded) {
    const dir = artifactsDir(statusPath);
    const abs = path.isAbsolute(recorded)
      ? recorded
      : path.resolve(dir, String(recorded).replace(/^artifacts[\\/]/, ""));
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return true;
  }
  const found = findReceiptArtifact({ statusPath, stepId: String(index), entry, step: doc.steps?.[index] });
  return !!found;
}

// Mark a landed card (gate + durable artifact) terminal, so the run records it
// and the dispatcher never re-hands it. Mirrors complete's terminal write; the
// learning fold/insight (a complete side-effect) is best-effort and may be
// skipped when the worker raced ahead of its own `complete`.
function finalizeAccepted(statusPath, status, doc, index) {
  mutateStatus(statusPath, (fresh) => {
    if (!fresh) return null;
    fresh.steps = fresh.steps || {};
    const key = statusKey(fresh, doc, index);
    const step = (fresh.steps[key] = fresh.steps[key] || { attempt: 1 });
    step.status = "done";
    step.gate = "passed";
    step.completed_at = step.completed_at || new Date().toISOString();
  });
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

// SIGKILL a worker's whole subtree: its process GROUP plus every descendant pid
// found by a pgrep -P walk. The group kill ALONE misses a worker that re-spawned
// a grandchild in its OWN detached group — run-card spawns `claude -p`/`codex`
// DETACHED, so the real worker leads a different group and a `kill -runcardgroup`
// never reaches it (that orphan is what left ~3-minute zombie `claude -p`
// processes after a real run). The worker is still a DESCENDANT of run-card by
// pid, so the walk reaches it. Detached+unref'd background helpers
// (learn-card / fold) reparent to init the moment `complete` exits — by the time
// a card is gate-accepted they are no longer in this subtree, so the learning
// loop is not touched.
function killGroup(pgid) {
  const seen = new Set();
  const descendants = [];
  const stack = [pgid];
  while (stack.length) {
    const p = stack.pop();
    if (seen.has(p)) continue;
    seen.add(p);
    const r = spawnSync("pgrep", ["-P", String(p)], { encoding: "utf8" });
    if (r.status !== 0 || !r.stdout) continue;
    for (const line of r.stdout.split(/\s+/)) {
      const c = Number(line.trim());
      if (Number.isInteger(c) && c > 0 && !seen.has(c)) {
        descendants.push(c);
        stack.push(c);
      }
    }
  }
  // descendants first (incl. the detached worker group), then run-card's group.
  for (const d of descendants) {
    try { process.kill(-d, "SIGKILL"); } catch { /* group may be gone */ }
    try { process.kill(d, "SIGKILL"); } catch { /* already dead */ }
  }
  try { process.kill(-pgid, "SIGKILL"); } catch { /* group may be gone */ }
  try { process.kill(pgid, "SIGKILL"); } catch { /* already dead */ }
}

// Hard wall-clock backstop: longer than run-card's own ~20-min worker timeout.
const HARD_MAX_WALL_MS = 25 * 60 * 1000;

/**
 * Install the status-dir fs.watch "completion bell", resilient to faults (audit
 * §4a). Two failure modes are handled:
 *   - synchronous throw from fs.watch (e.g. EMFILE at setup) => degrade now.
 *   - ASYNC 'error' event on an already-created watcher (the common EMFILE shape
 *     under fd pressure) => WITHOUT a handler this is an unhandled EventEmitter
 *     'error' => uncaught exception => the dispatcher dies. We catch it, drop the
 *     watcher, and degrade — the patrol interval runs the SAME idempotent pass,
 *     so the run still advances (just on the slower cadence).
 * Returns { watcher } (null once degraded) so the caller can close it on exit.
 * Exported for direct testing of the degrade-not-crash behavior.
 */
export function installStatusWatcher(dir, { onChange, onDegrade }) {
  const state = { watcher: null };
  try {
    const w = fs.watch(dir, { persistent: true }, (_evt, fname) => {
      if (!fname || /status\.json$/.test(fname) || /artifacts/.test(String(fname))) {
        onChange();
      }
    });
    state.watcher = w;
    w.on("error", (e) => {
      onDegrade(`fs.watch error (${e.message})`);
      try { w.close(); } catch { /* already gone */ }
      state.watcher = null;
    });
  } catch (e) {
    onDegrade(`fs.watch unavailable (${e.message})`);
  }
  return state;
}

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

    let status;
    try {
      status = readJson(statusPath);
    } catch {
      return; // mid-write; the watch re-fires
    }

    // Global ceiling check — catch a genuine runaway (the 43-process origin),
    // NOT teardown noise (audit Fix 1.2). Count only LIVE workers: skip entries
    // that have exited, been marked terminal (ACCEPTED, killGroup'd), or whose
    // card is already terminal on disk — such a worker is winding down (its
    // subtree is about to be reaped), which is teardown, not live concurrency.
    // Counting it let a self-abort fire on dying processes rather than a runaway.
    let totalDescendants = 0;
    for (const [index, info] of inFlight) {
      if (info.exited || info.terminal) continue;
      if (TERMINAL.has(stepStatus(status, doc, index))) continue;
      if (info.pgid && pidAlive(info.pgid)) {
        totalDescendants += 1 + countDescendants(info.pgid);
      }
    }
    if (totalDescendants > maxProcsObserved) maxProcsObserved = totalDescendants;
    if (totalDescendants > GLOBAL_DESCENDANT_CEILING) {
      abortLoud(`total LIVE descendant process count ${totalDescendants} exceeded ceiling ${GLOBAL_DESCENDANT_CEILING}`);
      return;
    }

    // ===== RECLAIM branch (FIRST) — liveness = the PROCESS, never the beat. =====
    for (const [index, info] of [...inFlight]) {
      const onDisk = stepStatus(status, doc, index);

      // ===== THE TRIGGER: gate-ACCEPTANCE (card terminal on disk), NOT exit. =====
      // A card is DONE when its artifact is durable (gate-accepted), not when the
      // worker process winds down. The gate had to READ the artifact to accept it,
      // so an accepted (terminal) card is durable by definition (Phase 1 verified:
      // complete writes the receipt + st.artifact + status:done in one save, and
      // collectDependencyInputs reads the live .conductor/artifacts/<dep> — nothing
      // a dependent needs is written after acceptance; the fold is a detached COPY).
      // If the on-disk status is terminal while the worker PROCESS is still alive,
      // free the slot NOW (so the next eligible card is handed at acceptance) and
      // STOP the spent worker in the background (it must not linger as a writer that
      // can race the artifact / .conductor dir). Its ~65s claude -p wind-down then
      // runs OFF the critical path; the OS reaps it. Guard: we delete the in-flight
      // entry here, so the later child.on("close")/info.exited pass finds nothing in
      // inFlight for this index => NO double-free, NO re-hand, NO double-count.
      if (!info.exited && TERMINAL.has(onDisk)) {
        console.log(
          `  ${green("ACCEPTED")} card ${index} ${dim(`(on-disk: ${onDisk} at gate-acceptance; freeing slot + stopping worker — teardown backgrounded)`)}`,
        );
        info.terminal = true; // mark so a stray later pass is a definitive no-op
        if (info.pgid) killGroup(info.pgid); // stop the spent worker; OS reaps in bg
        inFlight.delete(index); // free the slot ONCE, at acceptance
        continue;
      }

      // Primary: a tracked run-card PROCESS has EXITED.
      if (info.exited) {
        // Re-read fresh first: a worker can write its terminal status a beat
        // before its process-exit is observed (the close event can fire before
        // the final fs write lands in THIS pass's snapshot). Closing that read
        // race resolves the common case (FIX 1.1).
        let liveStatus = status;
        try { liveStatus = readJson(statusPath); } catch { /* keep the snapshot */ }
        const onDiskNow = stepStatus(liveStatus, doc, index);
        if (TERMINAL.has(onDiskNow)) {
          console.log(`  ${green("DONE")} card ${index} ${dim(`(on-disk: ${onDiskNow}; freeing slot)`)}`);
          inFlight.delete(index);
        } else if (workLanded(statusPath, liveStatus, doc, index)) {
          // FIX 1.1: gate passed AND artifact durable — the work + gate LANDED;
          // the worker just exited before `complete` flipped status:done
          // (done-at-gate-acceptance, 303b64e). Resolve to DONE, do NOT reclaim.
          // Re-handing here is the spurious attempt-2/3 churn that piled up the
          // teardown that crossed the ceiling and self-aborted the dispatcher.
          finalizeAccepted(statusPath, liveStatus, doc, index);
          console.log(`  ${green("DONE")} card ${index} ${dim("(gate passed + artifact durable; worker exited before the status write — accepted, not reclaimed)")}`);
          inFlight.delete(index);
        } else {
          // worker died WITHOUT landing the work => genuine freeze/crash. Reclaim
          // (the legitimate path, unchanged).
          if (info.pgid) killGroup(info.pgid); // defensive subtree kill
          const attempts = handCount.get(index) || 0;
          if (attempts >= maxAttempts) {
            console.log(
              `  ${red("BREAKER")} card ${index} crashed ${attempts}x (max_attempts ${maxAttempts}) — marking failed, not re-handing.`,
            );
            blockCard(statusPath, liveStatus, doc, index, `dispatcher breaker: ${attempts} crashed attempts`);
            inFlight.delete(index);
          } else {
            console.log(
              `  ${amber("RECLAIM")} card ${index} ${dim(`(worker exited; on-disk "${onDiskNow}" not terminal, work not landed — reset to pending)`)}`,
            );
            resetCardToPending(statusPath, liveStatus, doc, index);
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
      if (watchState && watchState.watcher) watchState.watcher.close();
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

  const watchState = installStatusWatcher(path.dirname(statusPath), {
    onChange: () => scheduleDispatch("fs.watch"),
    onDegrade: (msg) => console.log(amber(`  ${msg} — relying on the patrol interval.`)),
  });

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
