import fs from "node:fs";
import { mutateStatus } from "./status-store.js";
import { applyPauseResume } from "./pause-core.js";
import { resolveStatusPath as resolveWorkflowStatusPath } from "./workflow-context.js";

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const amber = (s) => `\x1b[38;5;214m${s}\x1b[0m`;

function resolveStatusPath(args) {
  return resolveWorkflowStatusPath(args);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// Fold the currently-running interval into the accumulator, then freeze the clock.
// Returns elapsed_ms after folding. Idempotent when not running (running_since null).
export function accumulateAndFreeze(status, nowMs = Date.now()) {
  const since = typeof status.running_since === "string" ? new Date(status.running_since).getTime() : null;
  let acc = typeof status.elapsed_ms === "number" ? status.elapsed_ms : 0;
  if (since !== null && !Number.isNaN(since) && nowMs >= since) {
    acc += nowMs - since;
  }
  status.elapsed_ms = acc;
  status.running_since = null;
  return acc;
}

// Resume the accumulator clock from now.
export function resumeClock(status, nowMs = Date.now()) {
  if (typeof status.elapsed_ms !== "number") status.elapsed_ms = 0;
  status.running_since = new Date(nowMs).toISOString();
}

export async function runPause(args) {
  return pauseResumeCli(args, "pause");
}

export async function runResume(args) {
  return pauseResumeCli(args, "resume");
}

// ONE pause path: the CLI writes the SAME way the UI endpoint does — through the locked
// mutateStatus + the shared applyPauseResume (flip status + fold the clock + emit the
// control heartbeat), so both confirm identically. The terminal log is the CLI's extra.
function pauseResumeCli(args, action) {
  const statusPath = resolveStatusPath(args);
  if (!fs.existsSync(statusPath)) {
    console.error(red(`no status.json at ${statusPath}`));
    return false;
  }
  let pre;
  try {
    pre = readJson(statusPath);
  } catch (e) {
    console.error(red(`could not parse status.json: ${e.message}`));
    return false;
  }
  if (pre.status === "done" || pre.status === "failed") {
    console.error(amber(`run is ${pre.status} — cannot ${action} a finished run.`));
    return false;
  }
  if (action === "pause" && pre.status === "paused") {
    console.log(dim("run already paused."));
    return true;
  }
  if (action === "resume" && pre.status === "running") {
    console.log(dim("run already running."));
    return true;
  }

  // The doc lets resume name the next card (same source as the UI endpoint).
  let doc = null;
  try {
    const wfp = path.join(path.dirname(statusPath), "workflow.json");
    if (fs.existsSync(wfp)) doc = readJson(wfp);
  } catch {
    /* resume note falls back without a doc */
  }

  let applied = null;
  mutateStatus(statusPath, (s) => {
    applied = applyPauseResume(s, action, doc);
    return applied ? undefined : null;
  });
  if (applied === "paused") {
    const secs = Math.round((readJson(statusPath).elapsed_ms || 0) / 1000);
    console.log(`  ${amber("|| PAUSED")} ${dim(`(timer frozen at ${secs}s; dispatcher will idle)`)}`);
  } else if (applied === "final-drain") {
    console.log(`  ${amber("|| PAUSE NOT HELD")} ${dim("(final card is already running; run will complete)")}`);
  } else if (applied === "running") {
    console.log(`  ${green("> RESUMED")} ${dim("(timer continues; dispatcher resumes handing)")}`);
  }
  return true;
}
