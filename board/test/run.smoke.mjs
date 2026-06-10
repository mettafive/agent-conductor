/**
 * run.smoke.mjs — the `run <skill>` command + the five fixes, with a STUB worker.
 *
 * No model, no real Claude/Codex. Deterministic logic tests carry the proof:
 *   A. State model (new / half-done / failed / stranded-running / all-done)
 *   B. Worker adapter selection + per-runtime cap
 *   C. Board opens on the RUN's workflow (not compile's progress board)
 *   D. fs.watch async error degrades to patrol, never crashes
 *   E. Path coupling — a scoped skill run uses .conductor/<slug>/ end to end
 *   F. Start guide exists and teaches `run`
 *
 * Every board spawned is killed; the suite ends with 0 strays.
 * Run:  node test/run.smoke.mjs      (from board/)
 */
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
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
function assert(cond, msg) {
  if (!cond) throw new AssertError(msg);
}

const spawnedBoards = []; // { pid } — killed at the very end (0 strays)

function cli(args, cwd, extraEnv = {}) {
  const r = spawnSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 90000,
    env: { ...process.env, ...extraEnv },
  });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, timedOut: r.error?.code === "ETIMEDOUT" };
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "run-smoke-"));
}

let portCounter = 41000 + Math.floor(Math.random() * 2000);
const nextPort = () => portCounter++;

function slugTitle(title) {
  return String(title || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "card";
}
const receiptName = (i, title) => `${i}-${slugTitle(title)}.md`;

/** Seed a skill + a PRE-COMPILED scoped workflow.json (so run reuses, no model). */
function seedSkill(tmp, name, doc) {
  fs.writeFileSync(path.join(tmp, "SKILL.md"), "# Skill\nDo the work.\n");
  const scoped = path.join(tmp, ".conductor", name);
  fs.mkdirSync(scoped, { recursive: true });
  const wf = path.join(scoped, "workflow.json");
  fs.writeFileSync(wf, JSON.stringify(doc, null, 2));
  // Ensure the compiled workflow is NEWER than the skill → run reuses it.
  const future = Date.now() / 1000 + 5;
  fs.utimesSync(wf, future, future);
  return { scoped, wf, status: path.join(scoped, "status.json") };
}

const readStatus = (statusPath) => JSON.parse(fs.readFileSync(statusPath, "utf8"));
const cardStatus = (st, key) => st.steps[key]?.status;

function stopBoardFor(scoped) {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(scoped, "server.json"), "utf8"));
    if (info.pid) {
      spawnedBoards.push({ pid: info.pid });
      try { process.kill(info.pid, "SIGTERM"); } catch { /* gone */ }
    }
  } catch { /* no board */ }
}

/** Run `run` with the stub worker, headless, on a fresh port; stop the board after. */
function runSkill(tmp, name, scoped, extraArgs = [], extraEnv = {}) {
  const port = nextPort();
  const r = cli(
    ["run", "SKILL.md", "--name", name, "--headless", "--port", String(port), ...extraArgs],
    tmp,
    { CONDUCTOR_WORKER_CMD: `node ${STUB}`, CONDUCTOR_HEADLESS: "1", ...extraEnv },
  );
  stopBoardFor(scoped);
  return r;
}

const TWO = (name) => ({
  conductor: "3.0.0",
  name,
  description: "two-card linear flow.",
  steps: [
    { title: "Alpha", instruction: "Do alpha and write a receipt.", requires: [] },
    { title: "Beta", instruction: "Do beta and write a receipt.", requires: [0] },
  ],
});
const ONE = (name) => ({
  conductor: "3.0.0",
  name,
  description: "one-card flow.",
  steps: [{ title: "Solo", instruction: "Do solo and write a receipt.", requires: [] }],
});

const scenarios = [];
const test = (name, fn) => scenarios.push({ name, fn });

// ── A. STATE MODEL ───────────────────────────────────────────────────────────

test("A1 fresh: no status → status-init, all cards run to done", () => {
  const tmp = tmpdir();
  const { scoped, status } = seedSkill(tmp, "a1", TWO("a1flow"));
  const r = runSkill(tmp, "a1", scoped);
  assert(r.code === 0, `run should exit 0:\n${r.out}`);
  const st = readStatus(status);
  assert(cardStatus(st, "0") === "done" && cardStatus(st, "1") === "done", `both cards should be done:\n${JSON.stringify(st.steps)}`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("A2 half-done: done card is NOT re-run; only the not-done card runs", () => {
  const tmp = tmpdir();
  const { scoped, status, wf } = seedSkill(tmp, "a2", TWO("a2flow"));
  // status-init then mark card 0 done with a real receipt.
  assert(cli(["status-init", wf, "--path", status], tmp).code === 0, "status-init");
  const st0 = readStatus(status);
  st0.steps["0"].status = "done";
  st0.steps["0"].gate = "passed";
  fs.writeFileSync(status, JSON.stringify(st0, null, 2));
  const art0 = path.join(scoped, "artifacts", receiptName("0", "Alpha"));
  fs.mkdirSync(path.dirname(art0), { recursive: true });
  fs.writeFileSync(art0, "# Alpha receipt (pre-existing)\nVerification: exists.");
  const mtime0 = fs.statSync(art0).mtimeMs;

  const r = runSkill(tmp, "a2", scoped);
  assert(r.code === 0, `run should exit 0:\n${r.out}`);
  assert(/resume/.test(r.out), `expected resume mode:\n${r.out}`);
  const st = readStatus(status);
  assert(cardStatus(st, "0") === "done" && cardStatus(st, "1") === "done", "both cards done after resume");
  assert(fs.statSync(art0).mtimeMs === mtime0, "done card's receipt must NOT be rewritten");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("A3 failed: a failed card is reset and retried to done", () => {
  const tmp = tmpdir();
  const { scoped, status, wf } = seedSkill(tmp, "a3", ONE("a3flow"));
  assert(cli(["status-init", wf, "--path", status], tmp).code === 0, "status-init");
  const st0 = readStatus(status);
  st0.steps["0"].status = "failed";
  st0.steps["0"].gate = "failed";
  st0.steps["0"].attempt = 2;
  fs.writeFileSync(status, JSON.stringify(st0, null, 2));

  const r = runSkill(tmp, "a3", scoped);
  assert(r.code === 0, `run should exit 0:\n${r.out}`);
  assert(cardStatus(readStatus(status), "0") === "done", "failed card should be retried to done");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("A4 stranded-running: a stranded running card is reset and run (no wall-clock wait)", () => {
  const tmp = tmpdir();
  const { scoped, status, wf } = seedSkill(tmp, "a4", ONE("a4flow"));
  assert(cli(["status-init", wf, "--path", status], tmp).code === 0, "status-init");
  const st0 = readStatus(status);
  st0.steps["0"].status = "running"; // stranded — no worker alive
  st0.steps["0"].started_at = new Date(Date.now() - 60000).toISOString();
  fs.writeFileSync(status, JSON.stringify(st0, null, 2));

  const t = Date.now();
  const r = runSkill(tmp, "a4", scoped);
  assert(r.code === 0, `run should exit 0:\n${r.out}`);
  assert(Date.now() - t < 60000, "must not wait on the 25m wall-clock backstop");
  assert(cardStatus(readStatus(status), "0") === "done", "stranded card should run to done");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("A5 all-done: rerun fresh (new run_id, cards re-run)", () => {
  const tmp = tmpdir();
  const { scoped, status } = seedSkill(tmp, "a5", ONE("a5flow"));
  const first = runSkill(tmp, "a5", scoped);
  assert(first.code === 0, `first run:\n${first.out}`);
  const st1 = readStatus(status);
  const art = path.join(scoped, "artifacts", receiptName("0", "Solo"));
  fs.rmSync(art, { force: true }); // delete the receipt → re-run must recreate it

  const second = runSkill(tmp, "a5", scoped);
  assert(second.code === 0, `second run:\n${second.out}`);
  assert(/rerun|fresh/.test(second.out), `expected rerun-fresh:\n${second.out}`);
  const st2 = readStatus(status);
  // A fresh run mints a new identity — run_name carries an incrementing run-N
  // (run_id is only second-granularity so it can collide on a fast machine).
  assert(st2.run_name !== st1.run_name || st2.run_id !== st1.run_id, `rerun-fresh should mint a new run identity (was ${st1.run_name}, now ${st2.run_name})`);
  assert(cardStatus(st2, "0") === "done", "card done again after rerun");
  assert(fs.existsSync(art), "receipt must be re-written on rerun (re-execution)");
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── B. WORKER ADAPTER + CAP ──────────────────────────────────────────────────

// Fake-binary helper: a dir with executable stubs that answer `--version`.
function fakeBin(names) {
  const d = tmpdir();
  for (const n of names) {
    const f = path.join(d, n);
    fs.writeFileSync(f, "#!/bin/sh\necho 1.0.0\n");
    fs.chmodSync(f, 0o755);
  }
  return d;
}

async function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("B1 claude on PATH → claude adapter, cap 5", async () => {
  const { selectAdapter, adapterCap, workerLine } = await import("../cli/worker-adapters.js");
  await withEnv({ PATH: fakeBin(["claude"]), CONDUCTOR_WORKER_CMD: undefined, CONDUCTOR_WORKER_CAP: undefined }, () => {
    const a = selectAdapter();
    assert(a && a.id === "claude", `expected claude, got ${a && a.id}`);
    assert(adapterCap(a) === 5, `expected cap 5, got ${adapterCap(a)}`);
    assert(/worker: claude \(cap 5\)/.test(workerLine(a, adapterCap(a))), workerLine(a, adapterCap(a)));
  });
});

test("B2 claude absent, codex present → codex adapter, loud note, codex cap (not 5)", async () => {
  const { selectAdapter, adapterCap, workerLine } = await import("../cli/worker-adapters.js");
  await withEnv({ PATH: fakeBin(["codex"]), CONDUCTOR_WORKER_CMD: undefined, CONDUCTOR_WORKER_CAP: undefined }, () => {
    const a = selectAdapter();
    assert(a && a.id === "codex", `expected codex, got ${a && a.id}`);
    assert(adapterCap(a) !== 5, `codex cap must not be the claude-tuned 5, got ${adapterCap(a)}`);
    assert(/claude not found, using codex/.test(workerLine(a, adapterCap(a))), `expected loud note:\n${workerLine(a, adapterCap(a))}`);
  });
});

test("B3 neither claude nor codex, no override → null → loud no-worker line", async () => {
  const { selectAdapter, workerLine } = await import("../cli/worker-adapters.js");
  await withEnv({ PATH: fakeBin([]), CONDUCTOR_WORKER_CMD: undefined }, () => {
    const a = selectAdapter();
    assert(a === null, `expected null adapter, got ${a && a.id}`);
    assert(/no worker found/.test(workerLine(null)), workerLine(null));
  });
});

test("B3b run with no worker → fails loud, dispatches nothing", () => {
  const tmp = tmpdir();
  const { scoped, status } = seedSkill(tmp, "b3", ONE("b3flow"));
  const port = nextPort();
  // A PATH with ONLY `node` (symlinked) and nothing else — so the subprocess can
  // launch, but claude/codex are genuinely absent. (A plain node-dir PATH leaks
  // a co-located claude; an empty PATH hides node itself. Symlinking node alone
  // is the only hermetic "no worker" environment.)
  const nodeOnly = tmpdir();
  fs.symlinkSync(process.execPath, path.join(nodeOnly, "node"));
  const r = cli(
    ["run", "SKILL.md", "--name", "b3", "--headless", "--port", String(port)],
    tmp,
    { PATH: nodeOnly, CONDUCTOR_WORKER_CMD: "", CONDUCTOR_HEADLESS: "1" },
  );
  stopBoardFor(scoped);
  assert(r.code !== 0, `run should fail with no worker:\n${r.out}`);
  assert(/no worker found/.test(r.out), `expected loud no-worker error:\n${r.out}`);
  assert(!fs.existsSync(status), "no status.json should be written when no worker");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("B4 CONDUCTOR_WORKER_CMD set → env adapter, conservative cap, line says so", async () => {
  const { selectAdapter, adapterCap, workerLine } = await import("../cli/worker-adapters.js");
  await withEnv({ CONDUCTOR_WORKER_CMD: "true", CONDUCTOR_WORKER_CAP: undefined }, () => {
    const a = selectAdapter();
    assert(a && a.id === "env", `expected env adapter, got ${a && a.id}`);
    assert(/worker: CONDUCTOR_WORKER_CMD \(cap \d+\)/.test(workerLine(a, adapterCap(a))), workerLine(a, adapterCap(a)));
  });
});

test("B5 per-adapter cap: K descendants killed under cap<K, survive under cap>K", () => {
  const tmp = tmpdir();
  const { scoped, status, wf } = seedSkill(tmp, "b5", ONE("b5flow"));
  assert(cli(["status-init", wf, "--path", status], tmp).code === 0, "status-init");
  // A worker that spawns 9 descendants and holds them ~3s.
  const SPAWN9 = "for i in 1 2 3 4 5 6 7 8 9; do sleep 3 & done; wait";
  const under = cli(
    ["run-card", "0", "--path", status, "--workflow", wf],
    tmp,
    { CONDUCTOR_WORKER_CMD: SPAWN9, CONDUCTOR_WORKER_CAP: "5", CONDUCTOR_HEADLESS: "1" },
  );
  assert(/SIGKILLed: descendant cap exceeded/.test(under.out), `cap 5 should kill 9 descendants:\n${under.out}`);
  const over = cli(
    ["run-card", "0", "--path", status, "--workflow", wf],
    tmp,
    { CONDUCTOR_WORKER_CMD: SPAWN9, CONDUCTOR_WORKER_CAP: "20", CONDUCTOR_HEADLESS: "1" },
  );
  assert(!/SIGKILLed: descendant cap exceeded/.test(over.out), `cap 20 should NOT kill 9 descendants:\n${over.out}`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── C. BOARD ON THE RUN'S WORKFLOW ───────────────────────────────────────────

test("C board opens on the RUN's workflow, not compile's progress board", () => {
  const tmp = tmpdir();
  const { scoped } = seedSkill(tmp, "cflow", ONE("cflowname"));
  const r = runSkill(tmp, "cflow", scoped);
  assert(r.code === 0, `run:\n${r.out}`);
  assert(/board:.*workflow: cflowname/.test(r.out.replace(/\n/g, " ")), `board should serve the run workflow:\n${r.out}`);
  assert(!/Migrating skill/.test(r.out), `must not show compile's progress board:\n${r.out}`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── D. fs.watch RESILIENCE ───────────────────────────────────────────────────

test("D fs.watch async error degrades (no crash), patrol unaffected; change still fires", async () => {
  const { installStatusWatcher } = await import("../cli/dispatch.js");
  const realWatch = fs.watch;
  try {
    // Async-error case: a watcher that emits 'error' AFTER creation.
    const emitter = new EventEmitter();
    emitter.close = () => {};
    let captured = null;
    fs.watch = (_d, _o, cb) => { captured = cb; return emitter; };
    let degraded = null;
    let changed = 0;
    const state = installStatusWatcher("/tmp", { onChange: () => changed++, onDegrade: (m) => (degraded = m) });
    assert(state.watcher === emitter, "watcher should be installed");
    captured("change", "status.json"); // a normal change still fires onChange
    assert(changed === 1, "onChange should fire on a status.json change");
    emitter.emit("error", new Error("EMFILE")); // must NOT throw / crash
    assert(/EMFILE/.test(String(degraded)), `expected degrade on async error:\n${degraded}`);
    assert(state.watcher === null, "watcher should be dropped after error");

    // Synchronous-throw case: fs.watch throws at setup → degrade, not crash.
    fs.watch = () => { throw new Error("EMFILE setup"); };
    let degraded2 = null;
    const state2 = installStatusWatcher("/tmp", { onChange: () => {}, onDegrade: (m) => (degraded2 = m) });
    assert(state2.watcher === null && /EMFILE setup/.test(String(degraded2)), `expected sync-throw degrade:\n${degraded2}`);
  } finally {
    fs.watch = realWatch;
  }
});

// ── E. PATH COUPLING ─────────────────────────────────────────────────────────

test("E scoped run uses .conductor/<slug>/ end to end, no flat .conductor/ fallback", () => {
  const tmp = tmpdir();
  const { scoped, status } = seedSkill(tmp, "escoped", ONE("eflow"));
  const r = runSkill(tmp, "escoped", scoped); // NO --path/--workflow
  assert(r.code === 0, `run:\n${r.out}`);
  assert(fs.existsSync(status), "scoped status.json must exist");
  assert(cardStatus(readStatus(status), "0") === "done", "scoped run should complete");
  assert(!fs.existsSync(path.join(tmp, ".conductor", "status.json")), "must NOT create a flat .conductor/status.json");
  assert(fs.existsSync(path.join(scoped, "artifacts", receiptName("0", "Solo"))), "receipt must be in the scoped artifacts dir");
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── Integration-leads flow (Change 1 + 3c) ───────────────────────────────────

test("INT-A no open insights → no integration, work runs straight through", () => {
  const tmp = tmpdir();
  const { scoped, status } = seedSkill(tmp, "inta", ONE("intaflow"));
  // knowledge.json present but everything already applied → nothing open.
  fs.writeFileSync(path.join(scoped, "knowledge.json"), JSON.stringify({ items: [{ id: "k1", status: "applied" }] }, null, 2));
  const r = runSkill(tmp, "inta", scoped);
  assert(r.code === 0, `run should exit 0:\n${r.out}`);
  assert(!/shaping:/.test(r.out), `must NOT lead with integration when nothing is open:\n${r.out}`);
  assert(!fs.existsSync(path.join(scoped, "integration.workflow.json")), "no integration feed should be written");
  assert(cardStatus(readStatus(status), "0") === "done", "work should run straight through");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("INT-F open insight + integration returns false → shaping leads, run halts clean, work never starts (3c)", () => {
  const tmp = tmpdir();
  const { scoped, status } = seedSkill(tmp, "intf", ONE("intfflow"));
  fs.writeFileSync(path.join(scoped, "knowledge.json"), JSON.stringify({
    items: [{ id: "k1", status: "open", scope: "this-conductor", title: "Tweak", current: "old", proposed: "new", step: "Solo" }],
  }, null, 2));
  // No cards.json — integration's own required-input guard makes integrateRoot
  // return false deterministically (no model needed). The point under test is
  // run.js's 3c handling: a false integration HALTS cleanly and never dispatches
  // work, regardless of WHY integration failed (a real model failure is the
  // real-machine proof, I).
  const port = nextPort();
  const r = cli(
    ["run", "SKILL.md", "--name", "intf", "--headless", "--port", String(port)],
    tmp,
    { CONDUCTOR_WORKER_CMD: `node ${STUB}`, CONDUCTOR_HEADLESS: "1" },
  );
  stopBoardFor(scoped);
  assert(r.code !== 0, `run should halt non-zero on integration failure:\n${r.out}`);
  assert(/shaping:/.test(r.out), `integration should LEAD (shaping line):\n${r.out}`);
  assert(/integration failed|integration errored/.test(r.out), `should report the integration failure (no crash/500):\n${r.out}`);
  // 3c: work NEVER runs on a half-integrated plan — the work status.json (created
  // at status-init, AFTER integration) must not exist / show no completed work.
  if (fs.existsSync(status)) {
    const st = readStatus(status);
    const anyDone = Object.values(st.steps || {}).some((s) => s.status === "done");
    assert(!anyDone, `work must not run on a half-integrated plan:\n${JSON.stringify(st.steps)}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── F. START GUIDE ───────────────────────────────────────────────────────────

test("F START.md teaches `run` with prerequisites + gotchas; CONDUCTOR.md repointed", () => {
  const start = path.join(BOARD, "START.md");
  assert(fs.existsSync(start), "board/START.md must exist");
  const s = fs.readFileSync(start, "utf8");
  assert(/conductor-board run SKILL\.md/.test(s), "START.md should teach the run command");
  assert(/claude.*or.*codex/i.test(s), "START.md should list the worker prerequisite");
  assert(/Gotchas/i.test(s), "START.md should have a gotchas section");
  const cm = fs.readFileSync(path.join(BOARD, "..", "CONDUCTOR.md"), "utf8");
  assert(/conductor-board run SKILL\.md/.test(cm), "CONDUCTOR.md should point at run");
});

// ── runner ───────────────────────────────────────────────────────────────────
const only = process.argv[2];
const run = scenarios.filter((s) => !only || s.name.includes(only));
let passed = 0;
let failed = 0;
console.log("");
console.log(bold(`  run.smoke — ${run.length} scenarios`));
console.log("");
for (const s of run) {
  try {
    await s.fn();
    passed++;
    console.log(`  ${green("PASS")}  ${s.name}`);
  } catch (e) {
    failed++;
    console.log(`  ${red("FAIL")}  ${s.name}`);
    console.log(dim(`        ${String(e.message).split("\n").join("\n        ")}`));
  }
}

// 0 strays: make sure every board we spawned is gone.
for (const b of spawnedBoards) {
  try { process.kill(b.pid, 0); try { process.kill(b.pid, "SIGKILL"); } catch { /* */ } } catch { /* already dead */ }
}

console.log("");
console.log(`  ${bold("Summary:")} ${green(`${passed} passed`)}, ${failed ? red(`${failed} failed`) : dim("0 failed")} / ${run.length}`);
console.log("");
process.exit(failed ? 1 : 0);
