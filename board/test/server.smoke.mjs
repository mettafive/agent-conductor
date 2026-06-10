/**
 * server.smoke.mjs — the one-click re-run bridge. A real board server + the stub
 * worker (offline). Proves the start-run endpoint LAUNCHES the run (compile reuse
 * → integrate-if-insights → dispatch) in the background and returns immediately,
 * with no second confirm and no 500 wall.
 *
 * Run:  node test/server.smoke.mjs    (from board/)
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
const STUB = path.join(HERE, "stub-worker.mjs");

// Offline: the spawned run uses the stub worker; no real model/codex.
process.env.CONDUCTOR_WORKER_CMD = `node ${STUB}`;
process.env.CONDUCTOR_DECOMPOSE_CODEX = "0";

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

class AssertError extends Error {}
const assert = (c, m) => { if (!c) throw new AssertError(m); };
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "srv-smoke-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let portCounter = 47000 + Math.floor(Math.random() * 1500);
const nextPort = () => portCounter++;

function req(method, port, urlPath, body) {
  return new Promise((resolve) => {
    const data = body == null ? null : (typeof body === "string" ? body : JSON.stringify(body));
    const r = http.request({ host: "127.0.0.1", port, path: urlPath, method, timeout: 5000,
      headers: data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {} },
      (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => { let j = null; try { j = JSON.parse(d); } catch {} resolve({ status: res.statusCode, json: j }); }); });
    r.on("error", () => resolve({ status: 0, json: null }));
    r.on("timeout", () => { r.destroy(); resolve({ status: 0, json: null }); });
    if (data) r.write(data);
    r.end();
  });
}

const WF = (name) => ({ conductor: "3.0.0", name, description: "server bridge test.",
  steps: [{ title: "Solo", instruction: "Do solo and write a receipt.", requires: [] }] });

function seed(tmp, slug, { openInsight = false, withCards = true } = {}) {
  const scoped = path.join(tmp, ".conductor", slug);
  fs.mkdirSync(scoped, { recursive: true });
  const skill = path.join(tmp, ".claude", "skills", slug, "SKILL.md");
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.writeFileSync(skill, "# Skill\nDo the work.\n");
  const wf = path.join(scoped, "workflow.json");
  fs.writeFileSync(wf, JSON.stringify(WF(slug), null, 2));
  const future = Date.now() / 1000 + 5;
  fs.utimesSync(wf, future, future); // newer than skill → compile reuse, no recompile
  if (withCards) fs.writeFileSync(path.join(scoped, "cards.json"), JSON.stringify([{ title: "Solo", instruction: "Do solo and write a receipt." }], null, 2));
  fs.writeFileSync(path.join(scoped, "migration-meta.json"), JSON.stringify({ skill_path: skill }, null, 2));
  if (openInsight) fs.writeFileSync(path.join(scoped, "knowledge.json"), JSON.stringify({ items: [{ id: "k1", status: "open", scope: "this-conductor", title: "T", current: "a", proposed: "b", step: "Solo" }] }, null, 2));
  // status-init so the server has a status to serve.
  spawnSync("node", [CLI, "status-init", wf, "--path", path.join(scoped, "status.json")], { encoding: "utf8" });
  return { scoped, wf, status: path.join(scoped, "status.json"), skill };
}

const servers = [];
async function startBoard(scoped, port) {
  const child = spawn("node", [CLI, "--port", String(port), "--path", path.join(scoped, "status.json"), "--headless"],
    { cwd: path.resolve(scoped, "..", ".."), env: { ...process.env, CONDUCTOR_HEADLESS: "1" }, stdio: "ignore", detached: true });
  servers.push(child);
  // wait for /health
  for (let i = 0; i < 60; i++) { const h = await req("GET", port, "/health"); if (h.status === 200) return child; await sleep(150); }
  throw new Error("board did not become healthy");
}
const readStatus = (s) => JSON.parse(fs.readFileSync(s, "utf8"));
async function pollCardDone(status, key, ms) {
  const t = Date.now();
  while (Date.now() - t < ms) { try { if (readStatus(status).steps[key]?.status === "done") return true; } catch {} await sleep(300); }
  return false;
}

const scenarios = [];
const test = (name, fn) => scenarios.push({ name, fn });

test("POST start-run launches the run, returns immediately, one click completes it", async () => {
  const tmp = tmpdir(); const port = nextPort();
  const { scoped, status } = seed(tmp, "srvone");
  await startBoard(scoped, port);
  const t0 = Date.now();
  const r = await req("POST", port, "/api/workflow/srvone/start-run", {});
  const latency = Date.now() - t0;
  assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.json)}`);
  assert(r.json?.launched === true, `expected launched:true, got ${JSON.stringify(r.json)}`);
  assert(!r.json?.integration_required, `no integration_required round-trip should remain: ${JSON.stringify(r.json)}`);
  assert(latency < 2500, `POST must return immediately (non-blocking), took ${latency}ms`);
  // a SINGLE post drives the run to completion (no second confirm).
  assert(await pollCardDone(status, "0", 25000), `the one click must dispatch + complete the run:\n${JSON.stringify(readStatus(status).steps)}`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("no 500 wall: a failing integration returns 200 (launched) and work never runs", async () => {
  const tmp = tmpdir(); const port = nextPort();
  // open insight + NO cards.json → integrateRoot returns false → the run halts (3c).
  const { scoped, status } = seed(tmp, "srvfail", { openInsight: true, withCards: false });
  await startBoard(scoped, port);
  const r = await req("POST", port, "/api/workflow/srvfail/start-run", {});
  assert(r.status === 200, `endpoint must NOT 500 on a failing integration — got ${r.status}: ${JSON.stringify(r.json)}`);
  assert(r.json?.launched === true, `should still launch: ${JSON.stringify(r.json)}`);
  // work must NOT complete on a half-integrated plan; give it a moment.
  await sleep(4000);
  assert(readStatus(status).steps["0"]?.status !== "done", `work must not run on a failed integration:\n${JSON.stringify(readStatus(status).steps)}`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("dead path gone: server has no initRuntimeStatus reset-only path; endpoint only launches", async () => {
  const src = fs.readFileSync(path.join(BOARD, "server", "server.js"), "utf8");
  assert(!/function initRuntimeStatus/.test(src), "the reset-only initRuntimeStatus path must be removed");
  assert(!/integration_required/.test(src.replace(/\/\/.*$/gm, "")), "no integration_required handshake should remain in live code");
  assert(/launched: true/.test(src), "the endpoint should respond launched:true");
  assert(/CLI_BIN, "run"/.test(src), "the endpoint should spawn the CLI run orchestration");
});

// ── runner ───────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
console.log(`\n  ${bold(`server.smoke — ${scenarios.length} scenarios`)}\n`);
for (const s of scenarios) {
  try { await s.fn(); passed++; console.log(`  ${green("PASS")}  ${s.name}`); }
  catch (e) { failed++; console.log(`  ${red("FAIL")}  ${s.name}`); console.log(dim(`        ${String(e.message).split("\n").join("\n        ")}`)); }
}
// 0 strays: kill the board servers + any spawned run/stub.
for (const c of servers) { try { process.kill(-c.pid, "SIGKILL"); } catch {} try { c.kill("SIGKILL"); } catch {} }
spawnSync("pkill", ["-f", "srv-smoke|stub-worker"]);
console.log(`\n  ${bold("Summary:")} ${green(`${passed} passed`)}, ${failed ? red(`${failed} failed`) : dim("0 failed")} / ${scenarios.length}\n`);
process.exit(failed ? 1 : 0);
