/**
 * dispatch.smoke.mjs — Fix 1: the dispatcher self-abort. Stub workers, no model.
 *
 *   F1-A landed-but-no-complete: worker writes the receipt + gate-result PASSED
 *        then exits before `complete` flips status:done → the card resolves to
 *        DONE (no reclaim, no attempt-2). The spurious-churn fix.
 *   F1-B genuine crash: worker exits without landing the artifact → it DOES
 *        reclaim (legitimate path preserved), and breaks after max_attempts.
 *   F1-C teardown noise at cap 1: each worker leaves a fat live subtree for a
 *        beat after its card is done → the ceiling is NOT tripped by that
 *        teardown, every card completes, no DISPATCHER ABORT.
 *
 * Run:  node test/dispatch.smoke.mjs    (from board/)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOARD = path.resolve(HERE, "..");
const CLI = path.join(BOARD, "bin", "cli.js");
const STUB = path.join(HERE, "stub-worker.mjs");

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

class AssertError extends Error {}
const assert = (c, m) => { if (!c) throw new AssertError(m); };
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "disp-smoke-"));

function cli(args, cwd, env = {}) {
  const r = spawnSync("node", [CLI, ...args], { cwd, encoding: "utf8", timeout: 90000, env: { ...process.env, ...env } });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, timedOut: r.error?.code === "ETIMEDOUT" };
}

function seed(tmp, name, steps, maxAttempts) {
  const scoped = path.join(tmp, ".conductor", name);
  fs.mkdirSync(scoped, { recursive: true });
  const wf = path.join(scoped, "workflow.json");
  const status = path.join(scoped, "status.json");
  fs.writeFileSync(wf, JSON.stringify({ conductor: "3.0.0", name, description: "dispatch test.", max_attempts: maxAttempts ?? 5, steps }, null, 2));
  assert(cli(["status-init", wf, "--path", status], tmp).code === 0, "status-init");
  return { scoped, wf, status };
}
const readStatus = (s) => JSON.parse(fs.readFileSync(s, "utf8"));
const stepStatus = (st, k) => st.steps[k]?.status;
const dispatch = (tmp, wf, status, cap, env) =>
  cli(["dispatch", "--path", status, "--workflow", wf, "--cap", String(cap)], tmp, { CONDUCTOR_WORKER_CMD: `node ${STUB}`, CONDUCTOR_HEADLESS: "1", ...env });

const scenarios = [];
const test = (name, fn) => scenarios.push({ name, fn });

test("F1-A landed-but-no-complete → DONE, no reclaim, attempt stays 1", () => {
  const tmp = tmpdir();
  const { wf, status } = seed(tmp, "f1a", [{ title: "Solo", instruction: "Do it.", requires: [] }]);
  const r = dispatch(tmp, wf, status, 1, { STUB_LAND_NO_COMPLETE: "1" });
  assert(r.code === 0, `dispatch should finish 0:\n${r.out}`);
  const st = readStatus(status);
  assert(stepStatus(st, "0") === "done", `card must resolve to done (got ${stepStatus(st, "0")}):\n${r.out}`);
  assert((st.steps["0"].attempt ?? 1) === 1, `must NOT re-hand (attempt should stay 1, got ${st.steps["0"].attempt})`);
  assert(!/RECLAIM/.test(r.out), `must NOT reclaim a landed card:\n${r.out}`);
  assert(/accepted, not reclaimed/.test(r.out), `expected the landed-not-reclaimed resolution:\n${r.out}`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("F1-B genuine crash (no artifact) → reclaims, breaks after max_attempts", () => {
  const tmp = tmpdir();
  const { wf, status } = seed(tmp, "f1b", [{ title: "Solo", instruction: "Do it.", requires: [] }], 2);
  const r = dispatch(tmp, wf, status, 1, { STUB_NOOP: "1" });
  assert(r.code === 0, `dispatch should finish 0:\n${r.out}`);
  assert(/RECLAIM/.test(r.out), `a genuine crash MUST still reclaim (legitimate path):\n${r.out}`);
  const st = readStatus(status);
  assert(stepStatus(st, "0") === "failed", `should break to failed after max_attempts (got ${stepStatus(st, "0")})`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("F1-C teardown noise at cap 1 → no DISPATCHER ABORT, all cards done", () => {
  const tmp = tmpdir();
  const steps = [0, 1, 2].map((i) => ({ title: `Card ${i}`, instruction: `Do ${i}.`, requires: [] }));
  const { wf, status } = seed(tmp, "f1c", steps);
  // Each worker leaves 9 live children for a beat AFTER its card is done — without
  // the fix that 10-process winding-down subtree (>ceiling cap*8=8 at cap 1) would
  // self-abort. CONDUCTOR_WORKER_CAP high so run-card's per-worker cap doesn't kill
  // the stub first; we're testing the DISPATCHER ceiling, not the per-worker one.
  const r = dispatch(tmp, wf, status, 1, { STUB_TEARDOWN: "9", CONDUCTOR_WORKER_CAP: "50" });
  assert(!/DISPATCHER ABORT/.test(r.out), `teardown must NOT trip the ceiling:\n${r.out}`);
  assert(r.code === 0, `dispatch should finish 0:\n${r.out}`);
  const st = readStatus(status);
  for (const k of ["0", "1", "2"]) assert(stepStatus(st, k) === "done", `card ${k} should be done (got ${stepStatus(st, k)}):\n${r.out}`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── runner ───────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
console.log(`\n  ${bold(`dispatch.smoke — ${scenarios.length} scenarios`)}\n`);
for (const s of scenarios) {
  try { await s.fn(); passed++; console.log(`  ${green("PASS")}  ${s.name}`); }
  catch (e) { failed++; console.log(`  ${red("FAIL")}  ${s.name}`); console.log(dim(`        ${String(e.message).split("\n").join("\n        ")}`)); }
}
// reap any stray sleepers the teardown test left
spawnSync("pkill", ["-f", "stub-worker.mjs"]);
console.log(`\n  ${bold("Summary:")} ${green(`${passed} passed`)}, ${failed ? red(`${failed} failed`) : dim("0 failed")} / ${scenarios.length}\n`);
process.exit(failed ? 1 : 0);
