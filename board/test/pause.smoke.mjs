/**
 * pause.smoke.mjs — drain-and-hold pause/resume (offline, real board server).
 *
 *   PT1 /pause flips a running run to "paused" AND freezes the clock (folds the live
 *       interval into elapsed_ms, nulls running_since, sets paused_at).
 *   PT2 /resume flips it back to "running" and reopens the clock (running_since set,
 *       paused_at cleared) — elapsed_ms preserved (paused time didn't count).
 *   PT3 idempotent: pause-while-paused and resume-while-running are no-ops.
 *   PT4 the engine is wired for drain-and-hold: the dispatcher still HONORS paused
 *       (drains, hands nothing), narrates each transition with exactly one control
 *       beat (in-flight COUNT on pause, next card on resume), and the model holds
 *       the clock via the accumulator.
 *
 * Run:  node test/pause.smoke.mjs    (from board/)
 */
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOARD = path.resolve(HERE, "..");
const CLI = path.join(BOARD, "bin", "cli.js");
process.env.CONDUCTOR_DECOMPOSE_CODEX = "0";

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

class AssertError extends Error {}
const assert = (c, m) => { if (!c) throw new AssertError(m); };
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "pause-smoke-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let portCounter = 48600 + Math.floor(Math.random() * 800);

function req(method, port, urlPath) {
  return new Promise((resolve) => {
    const r = http.request({ host: "127.0.0.1", port, path: urlPath, method, timeout: 5000 }, (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => { let j = null; try { j = JSON.parse(d); } catch {} resolve({ status: res.statusCode, json: j }); });
    });
    r.on("error", () => resolve({ status: 0, json: null }));
    r.on("timeout", () => { r.destroy(); resolve({ status: 0, json: null }); });
    r.end();
  });
}

const servers = [];
function seed(tmp, slug, status) {
  const scoped = path.join(tmp, ".conductor", slug);
  fs.mkdirSync(scoped, { recursive: true });
  fs.writeFileSync(path.join(scoped, "workflow.json"), JSON.stringify({ conductor: "3.0.0", name: slug, steps: [{ title: "A", requires: [] }] }, null, 2));
  fs.writeFileSync(path.join(scoped, "status.json"), JSON.stringify(status, null, 2));
  return { scoped, status: path.join(scoped, "status.json") };
}
async function startBoard(scoped, port) {
  const child = spawn("node", [CLI, "--port", String(port), "--path", path.join(scoped, "status.json"), "--headless"],
    { cwd: path.resolve(scoped, "..", ".."), env: { ...process.env, CONDUCTOR_HEADLESS: "1" }, stdio: "ignore", detached: true });
  servers.push(child);
  for (let i = 0; i < 60; i++) { const h = await req("GET", port, "/health"); if (h.status === 200) return; await sleep(150); }
  throw new Error("board did not become healthy");
}
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const scenarios = [];
const test = (name, fn) => scenarios.push({ name, fn });

test("PT1 /pause flips to paused + freezes the clock", async () => {
  const tmp = tmpdir(); const port = portCounter++;
  const runningSince = new Date(Date.now() - 3000).toISOString(); // running for ~3s
  const { scoped, status } = seed(tmp, "pone", { workflow: "pone", status: "running", running_since: runningSince, elapsed_ms: 1000, steps: { "0": { status: "running" } } });
  await startBoard(scoped, port);
  const r = await req("POST", port, "/api/workflow/pone/pause");
  assert(r.status === 200 && r.json?.status === "paused", `pause should 200 paused: ${JSON.stringify(r.json)}`);
  const st = read(status);
  assert(st.status === "paused", `status must be paused (got ${st.status})`);
  assert(st.running_since === null, "running_since must be nulled (clock frozen)");
  assert(typeof st.paused_at === "string", "paused_at must be set");
  assert(st.elapsed_ms >= 1000 + 2500, `the live interval must fold into elapsed_ms (got ${st.elapsed_ms})`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("PT2 /resume reopens the clock; paused time didn't count", async () => {
  const tmp = tmpdir(); const port = portCounter++;
  const { scoped, status } = seed(tmp, "ptwo", { workflow: "ptwo", status: "paused", running_since: null, paused_at: new Date().toISOString(), elapsed_ms: 5000, steps: { "0": { status: "running" } } });
  await startBoard(scoped, port);
  const r = await req("POST", port, "/api/workflow/ptwo/resume");
  assert(r.status === 200 && r.json?.status === "running", `resume should 200 running: ${JSON.stringify(r.json)}`);
  const st = read(status);
  assert(st.status === "running", `status must be running (got ${st.status})`);
  assert(typeof st.running_since === "string", "running_since must reopen");
  assert(st.paused_at === undefined, "paused_at must be cleared");
  assert(st.elapsed_ms === 5000, `paused time must NOT count — elapsed_ms preserved (got ${st.elapsed_ms})`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("PT3 idempotent: pause-while-paused and resume-while-running are no-ops", async () => {
  const tmp = tmpdir(); const port = portCounter++;
  const { scoped, status } = seed(tmp, "pthree", { workflow: "pthree", status: "paused", running_since: null, paused_at: "2026-01-01T00:00:00Z", elapsed_ms: 7000, steps: { "0": { status: "running" } } });
  await startBoard(scoped, port);
  await req("POST", port, "/api/workflow/pthree/pause"); // already paused → no-op
  let st = read(status);
  assert(st.status === "paused" && st.elapsed_ms === 7000, "pause-while-paused must not double-fold the clock");
  await req("POST", port, "/api/workflow/pthree/resume");
  await req("POST", port, "/api/workflow/pthree/resume"); // already running → no-op
  st = read(status);
  assert(st.status === "running", "resume-while-running stays running");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("PT4 engine wired for drain-and-hold (dispatcher narration + drain; clock model)", () => {
  const disp = fs.readFileSync(path.join(BOARD, "cli", "dispatch.js"), "utf8");
  // drain-and-hold: the dispatcher idles when paused (hands nothing), never kills in-flight
  assert(/status\.status === "paused"/.test(disp), "the dispatcher must honor paused (drain-and-hold)");
  // exactly one control beat per transition, in-flight COUNT on pause, next on resume
  assert(/prevDispatchStatus/.test(disp), "transitions are detected once via prevDispatchStatus");
  assert(/still running will finish, then holding/.test(disp) && /live\.length/.test(disp), "pause beat names the in-flight count");
  assert(/Resuming — dispatching/.test(disp), "resume beat names the next card");
  assert(/control: true/.test(disp), "pause/resume beats are control beats (render immediately)");
  // the model holds the clock via the accumulator
  const merge = fs.readFileSync(path.join(BOARD, "src", "lib", "merge.ts"), "utf8");
  assert(/running_since/.test(merge) && /elapsed_ms/.test(merge), "the model holds the clock via the accumulator");
  // the button exists, gated to an active run
  const kanban = fs.readFileSync(path.join(BOARD, "src", "components", "WorkflowKanban.tsx"), "utf8");
  assert(/\/(pause|resume)\b/.test(kanban) || /\$\{action\}/.test(kanban), "the run-header posts pause/resume");
  assert(/Resume/.test(kanban) && /Pause/.test(kanban), "the toggle shows Pause / Resume");
});

// ── runner ───────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
console.log(`\n  ${bold(`pause.smoke — ${scenarios.length} scenarios`)}\n`);
for (const s of scenarios) {
  try { await s.fn(); passed++; console.log(`  ${green("PASS")}  ${s.name}`); }
  catch (e) { failed++; console.log(`  ${red("FAIL")}  ${s.name}`); console.log(dim(`        ${String(e.message).split("\n").join("\n        ")}`)); }
}
for (const c of servers) { try { process.kill(-c.pid, "SIGKILL"); } catch {} try { c.kill("SIGKILL"); } catch {} }
spawnSync("pkill", ["-f", "pause-smoke"]);
console.log(`\n  ${bold("Summary:")} ${green(`${passed} passed`)}, ${failed ? red(`${failed} failed`) : dim("0 failed")} / ${scenarios.length}\n`);
process.exit(failed ? 1 : 0);
