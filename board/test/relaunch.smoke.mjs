/**
 * relaunch.smoke.mjs — Improve & Run is a true fresh loop (Part A, offline).
 *
 *   RL1  priorRunFinished: a board with no card mid-flight is "finished".
 *   RL2  decideRunState: the raw state model (new / rerun-fresh / resume).
 *   RL3  relaunchMode: finished + integrated → rerun-fresh; finished + NOT
 *        integrated (plain retry) stays resume; not-finished stays resume.
 *   RL4  the insight checker ceiling reads 10 at the authoritative site + every
 *        fallback (no stale 5 lurks).
 *   RL5  view: the settled snapshot releases when the live run is active again
 *        (not only on a run_id change), and the ?wf pin is cleared on a fresh loop.
 *
 * Run:  node test/relaunch.smoke.mjs    (from board/)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decideRunState, priorRunFinished, relaunchMode } from "../cli/run.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOARD = path.resolve(HERE, "..");

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

class AssertError extends Error {}
const assert = (c, m) => { if (!c) throw new AssertError(m); };
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "relaunch-smoke-"));

const DOC2 = { steps: [{ title: "Alpha", requires: [] }, { title: "Beta", requires: [0] }] };
function writeStatus(dir, steps) {
  const p = path.join(dir, "status.json");
  fs.writeFileSync(p, JSON.stringify({ run_id: "r1", run_name: "run-1", status: "done", steps }, null, 2));
  return p;
}

const scenarios = [];
const test = (name, fn) => scenarios.push({ name, fn });

test("RL1 priorRunFinished — finished iff no card is mid-flight", () => {
  const tmp = tmpdir();
  assert(priorRunFinished(path.join(tmp, "none.json"), DOC2) === false, "no status → not finished");
  assert(priorRunFinished(writeStatus(tmp, { "0": { status: "done" }, "1": { status: "done" } }), DOC2) === true, "all done → finished");
  assert(priorRunFinished(writeStatus(tmp, { "0": { status: "done" }, "1": { status: "failed" } }), DOC2) === true, "done + failed (terminal) → finished");
  assert(priorRunFinished(writeStatus(tmp, { "0": { status: "done" }, "1": { status: "pending" } }), DOC2) === false, "done + pending → mid-flight, NOT finished");
  assert(priorRunFinished(writeStatus(tmp, { "0": { status: "running" } }), { steps: [{ title: "A", requires: [] }] }) === false, "running → mid-flight, NOT finished");
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

test("RL5 view — snapshot releases on active run + ?wf pin clears on a fresh loop", () => {
  const kanban = fs.readFileSync(path.join(BOARD, "src", "components", "WorkflowKanban.tsx"), "utf8");
  assert(/const liveActive = !allSettledNow/.test(kanban), "snapshot must release when the live run is active (liveActive), not only on run_id change");
  assert(/runChanged \|\| liveActive/.test(kanban), "release on EITHER runChanged OR liveActive");
  const app = fs.readFileSync(path.join(BOARD, "src", "App.tsx"), "utf8");
  assert(/setSelectedWf\(null\)/.test(app), "the ?wf pin must be cleared on a fresh loop");
  assert(/variant === "integration" && statusOf/.test(app), "the pin should clear when an integration feed goes live (so integration leads)");
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
