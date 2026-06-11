/**
 * relaunch.smoke.mjs — Improve & Run is a true fresh loop (Part A, offline).
 *
 *   RL1  priorRunFinished: a board with no card mid-flight is "finished".
 *   RL2  decideRunState: the raw state model (new / rerun-fresh / resume).
 *   RL3  relaunchMode: finished + integrated → rerun-fresh; finished + NOT
 *        integrated (plain retry) stays resume; not-finished stays resume.
 *   RL4  the insight checker ceiling reads 10 at the authoritative site + every
 *        fallback (no stale 5 lurks).
 *   RL5  recovered integration: if integration committed after the last status
 *        run but died before status-init, the next launch starts fresh.
 *   RL6  interrupted run recovery reaps remembered worker process groups before
 *        status resume can re-hand cards.
 *   RL7  view: the settled snapshot releases when the live run is active again
 *        (not only on a run_id change), and the ?wf pin is cleared on a fresh loop.
 *
 * Run:  node test/relaunch.smoke.mjs    (from board/)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decideRunState, integrationNewerThanStatus, priorRunFinished, relaunchMode } from "../cli/run.js";
import { reapWorkerGroups, registerWorkerGroup } from "../cli/worker-ledger.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOARD = path.resolve(HERE, "..");

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

class AssertError extends Error {}
const assert = (c, m) => { if (!c) throw new AssertError(m); };
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "relaunch-smoke-"));

const DOC2 = { steps: [{ title: "Gather Source Facts", requires: [] }, { title: "Write Final Summary", requires: [0] }] };
function writeStatus(dir, steps) {
  const p = path.join(dir, "status.json");
  fs.writeFileSync(p, JSON.stringify({ run_id: "r1", run_name: "run-1", status: "done", steps }, null, 2));
  return p;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

const scenarios = [];
const test = (name, fn) => scenarios.push({ name, fn });

test("RL1 priorRunFinished — finished iff no card is mid-flight", () => {
  const tmp = tmpdir();
  assert(priorRunFinished(path.join(tmp, "none.json"), DOC2) === false, "no status → not finished");
  assert(priorRunFinished(writeStatus(tmp, { "0": { status: "done" }, "1": { status: "done" } }), DOC2) === true, "all done → finished");
  assert(priorRunFinished(writeStatus(tmp, { "0": { status: "done" }, "1": { status: "failed" } }), DOC2) === true, "done + failed (terminal) → finished");
  assert(priorRunFinished(writeStatus(tmp, { "0": { status: "done" }, "1": { status: "pending" } }), DOC2) === false, "done + pending → mid-flight, NOT finished");
  assert(priorRunFinished(writeStatus(tmp, { "0": { status: "running" } }), { steps: [{ title: "Write Demo Note", requires: [] }] }) === false, "running → mid-flight, NOT finished");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("RL2 decideRunState — new / rerun-fresh / resume", () => {
  const tmp = tmpdir();
  assert(decideRunState(path.join(tmp, "none.json"), DOC2).mode === "new", "no status → new");
  assert(decideRunState(writeStatus(tmp, { "0": { status: "done" }, "1": { status: "done" } }), DOC2).mode === "rerun-fresh", "all done → rerun-fresh");
  assert(decideRunState(writeStatus(tmp, { "0": { status: "done" }, "1": { status: "failed" } }), DOC2).mode === "resume", "done + failed → resume (not all done)");
  assert(decideRunState(writeStatus(tmp, { "0": { status: "done" }, "1": { status: "pending" } }), DOC2).mode === "resume", "done + pending → resume");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("RL3 relaunchMode — finished+integrated → fresh; plain retry stays resume", () => {
  // THE Improve & Run fix: a finished board that integration reshaped (raw model
  // reads "resume" because the grown plan has not-done cards) → fresh loop.
  assert(relaunchMode({ baseMode: "resume", priorFinished: true, integrated: true }) === "rerun-fresh", "finished + integrated + resume → rerun-fresh");
  // A finished board relaunched WITHOUT integration is a plain retry — keep done, retry failed.
  assert(relaunchMode({ baseMode: "resume", priorFinished: true, integrated: false }) === "resume", "finished + NOT integrated → stays resume (retry the failed cards)");
  // A genuinely mid-flight board is always a resume, even with integration.
  assert(relaunchMode({ baseMode: "resume", priorFinished: false, integrated: true }) === "resume", "not finished → stays resume");
  // Non-resume modes pass through untouched.
  assert(relaunchMode({ baseMode: "rerun-fresh", priorFinished: true, integrated: true }) === "rerun-fresh", "rerun-fresh passes through");
  assert(relaunchMode({ baseMode: "new", priorFinished: false, integrated: false }) === "new", "new passes through");
});

test("RL4 insight checker ceiling reads 10 everywhere — no stale 5", () => {
  const src = fs.readFileSync(path.join(BOARD, "cli", "integration.js"), "utf8");
  assert(/Number\(flag\(args, \["--max-attempts"\]\) \|\| 10\)/.test(src), "authoritative ceiling must be || 10");
  assert(!/\|\| 5\)/.test(src), "no `|| 5)` fallback may remain");
  assert(!/maxAttempts = 5\b/.test(src), "no `maxAttempts = 5` default may remain");
  assert(!/max_attempts: 5\b/.test(src), "the display board max_attempts must not be 5");
  // and the defaults are actually 10:
  assert((src.match(/maxAttempts = 10\b/g) || []).length >= 8, "all compose/prompt defaults should read 10");
});

test("RL5 recovered integration newer than status forces a fresh improved run", () => {
  const tmp = tmpdir();
  const root = path.join(tmp, ".conductor", "demo");
  writeJson(path.join(root, "status.json"), {
    run_id: "2026-06-11T03-00-00",
    status: "done",
    steps: { "0": { status: "done" } },
  });
  writeJson(path.join(root, "runs", "2026-06-11T03-05-00", "integration-summary.json"), {
    run_id: "2026-06-11T03-05-00",
    applied: 1,
  });
  assert(integrationNewerThanStatus(root, path.join(root, "status.json")) === true, "newer applied integration must force a fresh run");
  writeJson(path.join(root, "status.json"), {
    run_id: "2026-06-11T03-10-00",
    status: "done",
    steps: { "0": { status: "done" } },
  });
  assert(integrationNewerThanStatus(root, path.join(root, "status.json")) === false, "status newer than integration should not force fresh");
  writeJson(path.join(root, "status.json"), {
    run_id: "2026-06-11T03-00-00",
    status: "running",
    steps: { "0": { status: "running" } },
  });
  assert(integrationNewerThanStatus(root, path.join(root, "status.json")) === false, "mid-flight status remains a genuine resume");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("RL6 interrupted run recovery reaps remembered worker groups", async () => {
  const tmp = tmpdir();
  const root = path.join(tmp, ".conductor", "demo");
  fs.mkdirSync(root, { recursive: true });
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  try {
    registerWorkerGroup(root, { pgid: child.pid, kind: "run-card", index: 0, run_id: "r1" });
    const result = reapWorkerGroups(root);
    assert(result.killed === 1, `expected one remembered group killed, got ${JSON.stringify(result)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    let alive = true;
    try { process.kill(child.pid, 0); } catch { alive = false; }
    assert(alive === false, "remembered worker process should be gone after reap");
    assert(!fs.existsSync(path.join(root, "worker-groups.json")), "worker ledger should be cleared after reap");
  } finally {
    try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
    try { process.kill(child.pid, "SIGKILL"); } catch { /* already gone */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("RL7 view — snapshot releases on active run + integration is preflight, not a board takeover", () => {
  const kanban = fs.readFileSync(path.join(BOARD, "src", "components", "WorkflowKanban.tsx"), "utf8");
  assert(/const liveActive = !allSettledNow/.test(kanban), "snapshot must release when the live run is active (liveActive), not only on run_id change");
  assert(/runChanged \|\| liveActive/.test(kanban), "release on EITHER runChanged OR liveActive");
  const app = fs.readFileSync(path.join(BOARD, "src", "App.tsx"), "utf8");
  assert(!/setSelectedWf\(null\); \/\/ unpin so the running integration feed can lead/.test(app), "the ?wf pin is not cleared to let integration take over");
  assert(/IntegrationPreflightState/.test(app), "integration renders as a preflight screen");
  assert(/never select integration as the central board surface/.test(app), "active board selection excludes integration feeds");
});

// ── runner ───────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
console.log(`\n  ${bold(`relaunch.smoke — ${scenarios.length} scenarios`)}\n`);
for (const s of scenarios) {
  try { await s.fn(); passed++; console.log(`  ${green("PASS")}  ${s.name}`); }
  catch (e) { failed++; console.log(`  ${red("FAIL")}  ${s.name}`); console.log(dim(`        ${String(e.message).split("\n").join("\n        ")}`)); }
}
console.log(`\n  ${bold("Summary:")} ${green(`${passed} passed`)}, ${failed ? red(`${failed} failed`) : dim("0 failed")} / ${scenarios.length}\n`);
process.exit(failed ? 1 : 0);
