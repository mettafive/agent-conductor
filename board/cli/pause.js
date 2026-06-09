import fs from "node:fs";
import path from "node:path";

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const amber = (s) => `\x1b[38;5;214m${s}\x1b[0m`;

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

function resolveStatusPath(args) {
  const p = flag(args, ["--path", "-p"]);
  return path.resolve(process.cwd(), typeof p === "string" ? p : ".conductor/status.json");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function saveStatus(statusPath, status) {
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
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
  const statusPath = resolveStatusPath(args);
  if (!fs.existsSync(statusPath)) {
    console.error(red(`no status.json at ${statusPath}`));
    return false;
  }
  let status;
  try {
    status = readJson(statusPath);
  } catch (e) {
    console.error(red(`could not parse status.json: ${e.message}`));
    return false;
  }
  if (status.status === "done" || status.status === "failed") {
    console.error(amber(`run is already ${status.status} — nothing to pause.`));
    return false;
  }
  if (status.status === "paused") {
    console.log(dim("run already paused."));
    return true;
  }
  accumulateAndFreeze(status);
  status.status = "paused";
  status.paused_at = new Date().toISOString();
  saveStatus(statusPath, status);
  console.log(
    `  ${amber("|| PAUSED")} ${dim(`(timer frozen at ${Math.round((status.elapsed_ms || 0) / 1000)}s; dispatcher will idle)`)}`,
  );
  return true;
}

export async function runResume(args) {
  const statusPath = resolveStatusPath(args);
  if (!fs.existsSync(statusPath)) {
    console.error(red(`no status.json at ${statusPath}`));
    return false;
  }
  let status;
  try {
    status = readJson(statusPath);
  } catch (e) {
    console.error(red(`could not parse status.json: ${e.message}`));
    return false;
  }
  if (status.status === "done" || status.status === "failed") {
    console.error(amber(`run is ${status.status} — cannot resume a finished run.`));
    return false;
  }
  if (status.status === "running") {
    console.log(dim("run already running."));
    return true;
  }
  resumeClock(status);
  status.status = "running";
  delete status.paused_at;
  saveStatus(statusPath, status);
  console.log(`  ${green("> RESUMED")} ${dim("(timer continues; dispatcher resumes handing)")}`);
  return true;
}
