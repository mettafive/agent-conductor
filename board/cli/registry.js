import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Machine-wide board registry — Phase B of the one-persistent-board work.
//
// Phase A made every front door ATTACH to a healthy board on the canonical port
// instead of spawning per-cwd. But the board still only discovered workflows
// under its single launch .conductor dir, so one board could not see other
// projects' roots.
//
// This module is the single machine-wide record for THE board(s) plus the LIST
// of .conductor roots the board should watch. It lives at a stable path
//   ~/.conductor/board.json
// and is written atomically. Shape:
//
//   {
//     "boards": { "3042": { "port": 3042, "pid": 123, "url": "http://localhost:3042/" } },
//     "roots":  [ { "root": "/abs/.conductor", "added_at": "..." }, ... ]
//   }
//
// "boards" is keyed by port (board identity = port) so the 3042/3043 boards can
// coexist without clobbering each other. "roots" is a single deduped union of
// every .conductor root any project registered; the board watches all of them.
//
// Phase C (GC of dead board records / dead roots) is intentionally NOT done
// here — this module only ADDS (idempotently) and reads.
// ---------------------------------------------------------------------------

export function registryFile() {
  return process.env.CONDUCTOR_REGISTRY || path.join(os.homedir(), ".conductor", "board.json");
}

function readRegistry(file = registryFile()) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      boards: raw && typeof raw.boards === "object" && raw.boards ? raw.boards : {},
      roots: Array.isArray(raw?.roots) ? raw.roots : [],
    };
  } catch {
    return { boards: {}, roots: [] };
  }
}

// Atomic write: write to a temp sibling then rename over the target.
function writeRegistry(reg, file = registryFile()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * Idempotently add a .conductor root to the watched-roots list. Returns true
 * when the root was newly added (the board should re-discover), false when it
 * was already registered.
 */
export function registerRoot(conductorRoot, file = registryFile()) {
  if (!conductorRoot) return false;
  const root = path.resolve(conductorRoot);
  const reg = readRegistry(file);
  if (reg.roots.some((r) => path.resolve(r.root) === root)) return false;
  reg.roots.push({ root, added_at: new Date().toISOString() });
  writeRegistry(reg, file);
  return true;
}

/** Record (or refresh) THE board for a port — identity = port. Best-effort. */
export function registerBoard({ port, pid, url }, file = registryFile()) {
  if (!port) return;
  const reg = readRegistry(file);
  reg.boards[String(port)] = {
    port: Number(port),
    pid: pid ?? null,
    url: url || `http://localhost:${port}/`,
    updated_at: new Date().toISOString(),
  };
  writeRegistry(reg, file);
}

/** The deduped, absolute list of registered .conductor roots. */
export function registeredRoots(file = registryFile()) {
  const reg = readRegistry(file);
  const seen = new Set();
  const out = [];
  for (const r of reg.roots) {
    const abs = path.resolve(r.root || "");
    if (!abs || seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}

export function boardRecord(port, file = registryFile()) {
  return readRegistry(file).boards[String(port)] || null;
}

// ---------------------------------------------------------------------------
// Phase C — GC so a stale/zombie record can never linger.
//
// A board record's `pid` is a process; a roots entry is a directory. GC's job
// is to drop records that point at DEAD processes (and, optionally, roots whose
// .conductor dir vanished), and to sweep the OLD per-cwd ~/.conductor/servers/*
// files that the new board.json supersedes — but only ones whose recorded pid
// is dead.
//
// IMPORTANT: GC is belt-and-braces, NOT load-bearing for correctness. Phase A's
// ensureBoard decides spawn-vs-attach purely on a live /health probe of the
// port (not on any registry record), and killPortIfBoard was removed from the
// spawn path — so a stale record here can never trigger a kill or a duplicate
// spawn. GC just keeps the registry honest.
// ---------------------------------------------------------------------------

/**
 * Is a pid a live process? process.kill(pid, 0) sends no signal — it only
 * probes: ESRCH means the pid is dead/gone, EPERM means it's alive but owned by
 * another user (still alive — keep it). A null/NaN/<=0 pid is treated as dead.
 */
export function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (e) {
    return e && e.code === "EPERM"; // alive but not ours
  }
}

/** The old per-cwd scheme's directory: ~/.conductor/servers/ */
export function serversDir() {
  return process.env.CONDUCTOR_SERVERS_DIR || path.join(os.homedir(), ".conductor", "servers");
}

/**
 * Garbage-collect the machine-wide registry and the vestigial per-cwd files.
 *
 *   1. board.json: drop any boards[port] whose pid is dead; keep live ones.
 *      Optionally drop roots whose .conductor dir no longer exists.
 *   2. ~/.conductor/servers/*.json: unlink files whose recorded pid is dead
 *      (the new board.json supersedes them). NEVER touch a file at a live pid.
 *
 * board.json is rewritten atomically (temp + rename). Returns a summary.
 */
export function gcRegistry(file = registryFile()) {
  const result = {
    boards_removed: [],
    boards_kept: [],
    roots_removed: [],
    server_files_removed: [],
    server_files_kept: [],
  };

  // 1. board records — keyed by port, value carries the pid.
  const reg = readRegistry(file);
  let regChanged = false;
  for (const key of Object.keys(reg.boards)) {
    const rec = reg.boards[key];
    if (pidAlive(rec && rec.pid)) {
      result.boards_kept.push(key);
    } else {
      delete reg.boards[key];
      result.boards_removed.push(key);
      regChanged = true;
    }
  }
  // Optional, conservative: drop roots whose .conductor dir is gone.
  const rootsBefore = reg.roots.length;
  reg.roots = reg.roots.filter((r) => {
    const abs = path.resolve(r && r.root ? r.root : "");
    const keep = abs && fs.existsSync(abs);
    if (!keep) result.roots_removed.push(abs);
    return keep;
  });
  if (reg.roots.length !== rootsBefore) regChanged = true;
  if (regChanged) writeRegistry(reg, file);

  // 2. vestigial per-cwd ~/.conductor/servers/*.json — remove only DEAD ones.
  const dir = serversDir();
  let entries = [];
  try {
    entries = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    entries = []; // no old scheme dir — nothing to sweep
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    let pid = null;
    try {
      pid = JSON.parse(fs.readFileSync(full, "utf8")).pid;
    } catch {
      pid = null; // unparseable / no pid -> treat as dead, safe to remove
    }
    if (pidAlive(pid)) {
      result.server_files_kept.push({ file: name, pid });
      continue;
    }
    try {
      fs.unlinkSync(full);
      result.server_files_removed.push({ file: name, pid });
    } catch {
      /* best-effort */
    }
  }

  return result;
}

export { readRegistry, writeRegistry };
