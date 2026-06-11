import fs from "node:fs";
import path from "node:path";

const LEDGER = "worker-groups.json";

function ledgerPath(root) {
  return path.join(root, LEDGER);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function pidAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

function killProcessGroup(pgid) {
  const n = Number(pgid);
  if (!Number.isInteger(n) || n <= 1) return false;
  let killed = false;
  try {
    process.kill(-n, "SIGKILL");
    killed = true;
  } catch {
    /* group may be gone */
  }
  try {
    process.kill(n, "SIGKILL");
    killed = true;
  } catch {
    /* process may be gone */
  }
  return killed;
}

export function registerWorkerGroup(root, entry) {
  const file = ledgerPath(root);
  const ledger = readJson(file, { groups: [] });
  const pgid = Number(entry?.pgid);
  if (!Number.isInteger(pgid) || pgid <= 1) return;
  const groups = Array.isArray(ledger.groups) ? ledger.groups.filter((g) => Number(g?.pgid) !== pgid) : [];
  groups.push({
    pgid,
    kind: entry.kind || "worker",
    index: entry.index ?? null,
    run_id: entry.run_id ?? null,
    started_at: entry.started_at || new Date().toISOString(),
  });
  writeJson(file, { groups });
}

export function unregisterWorkerGroup(root, pgid) {
  const file = ledgerPath(root);
  const ledger = readJson(file, null);
  if (!ledger || !Array.isArray(ledger.groups)) return;
  const next = ledger.groups.filter((g) => Number(g?.pgid) !== Number(pgid));
  if (next.length) writeJson(file, { groups: next });
  else {
    try { fs.unlinkSync(file); } catch { /* already gone */ }
  }
}

export function clearWorkerGroups(root) {
  try { fs.unlinkSync(ledgerPath(root)); } catch { /* already gone */ }
}

export function reapWorkerGroups(root) {
  const file = ledgerPath(root);
  const ledger = readJson(file, null);
  if (!ledger || !Array.isArray(ledger.groups)) return { killed: 0, stale: 0 };
  let killed = 0;
  let stale = 0;
  for (const group of ledger.groups) {
    const pgid = Number(group?.pgid);
    if (!Number.isInteger(pgid) || pgid <= 1) continue;
    if (pidAlive(pgid)) {
      if (killProcessGroup(pgid)) killed++;
    } else {
      stale++;
    }
  }
  try { fs.unlinkSync(file); } catch { /* already gone */ }
  return { killed, stale };
}

