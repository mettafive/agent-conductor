/**
 * served.smoke.mjs — gate every handoff on "served", not "healthy" (offline).
 *
 *   SV1 the baton source: a board can be HEALTHY (process alive, /health 200) while a
 *       feed is NOT yet SERVED (/health.workflows lacks it). Once the feed is written
 *       and re-discovered, it appears in /health.workflows. Served ≠ healthy.
 *   SV2 the gates are wired: dispatch waits for served (run.js); openRunBoard waits for
 *       served (10s, attach included); the compile handoff waits for the compile feed
 *       served (compile.js); the relaunch overlay advances on a SERVED feed, not a
 *       run_id heuristic (App.tsx).
 *
 * (The end-to-end "dispatch only after served" baton is exercised by run.smoke, which
 *  still passes 21/21 — the served gate doesn't stall a real run.)
 *
 * Run:  node test/served.smoke.mjs    (from board/)
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
process.env.CONDUCTOR_HEADLESS = "1";

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

class AssertError extends Error {}
const assert = (c, m) => { if (!c) throw new AssertError(m); };
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "served-smoke-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const src = (rel) => fs.readFileSync(path.join(BOARD, rel), "utf8");
let port = 49200 + Math.floor(Math.random() * 600);

function health(p) {
  return new Promise((resolve) => {
    const r = http.request({ host: "127.0.0.1", port: p, path: "/health", method: "GET", timeout: 4000 }, (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => { let j = null; try { j = JSON.parse(d); } catch {} resolve({ status: res.statusCode, json: j }); });
    });
    r.on("error", () => resolve({ status: 0, json: null }));
    r.on("timeout", () => { r.destroy(); resolve({ status: 0, json: null }); });
    r.end();
  });
}

const servers = [];
async function startBoard(scoped, p) {
  const child = spawn("node", [CLI, "--port", String(p), "--path", path.join(scoped, "status.json"), "--headless"],
    { cwd: path.resolve(scoped, "..", ".."), env: { ...process.env, CONDUCTOR_HEADLESS: "1" }, stdio: "ignore", detached: true });
  servers.push(child);
  for (let i = 0; i < 60; i++) { const h = await health(p); if (h.status === 200) return; await sleep(150); }
  throw new Error("board did not become healthy");
}
async function pollServed(p, key, ms) {
  const t = Date.now();
  while (Date.now() - t < ms) { const h = await health(p); if (h.json?.workflows && key in h.json.workflows) return true; await sleep(150); }
  return false;
}

const scenarios = [];
const test = (name, fn) => scenarios.push({ name, fn });

test("SV1 healthy ≠ served: a feed is served only once it's discovered + renderable", async () => {
  const tmp = tmpdir(); const p = port++;
  // A unique name so the machine-wide registry (other roots' feeds) can't pollute it.
  const wf = `served-${p}-${Math.floor(Date.now() % 1e6)}`;
  const scoped = path.join(tmp, ".conductor", wf);
  fs.mkdirSync(scoped, { recursive: true });
  await startBoard(scoped, p);
  // HEALTHY but NOT served: the process is alive, but THIS feed isn't discovered yet.
  const h = await health(p);
  assert(h.status === 200, "board must be healthy (process alive)");
  assert(!(wf in (h.json?.workflows || {})), `our feed must NOT be served before it's written: ${wf}`);
  // Now write the run feed → it becomes SERVED (the board re-discovers per request).
  fs.writeFileSync(path.join(scoped, "workflow.json"), JSON.stringify({ conductor: "3.0.0", name: wf, steps: [{ title: "A", requires: [] }] }, null, 2));
  fs.writeFileSync(path.join(scoped, "status.json"), JSON.stringify({ workflow: wf, status: "running", steps: { "0": { status: "running" } } }, null, 2));
  const served = await pollServed(p, wf, 6000);
  assert(served, "the run feed must become SERVED (in /health.workflows) once written + discovered");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("SV2 the handoff gates are wired to served", () => {
  const run = src("cli/run.js");
  assert(/if \(!board\.served\)/.test(run), "run.js gates dispatch on board.served, not just healthy");
  assert(/has not served the run feed/.test(run), "run.js halts (doesn't dispatch) when the run feed isn't served");
  const init = src("cli/init-board.js");
  assert(/waitForWorkflow\(ensured\.url, workflow, conductorDir, 10000\)/.test(init), "openRunBoard waits for the served baton (generous timeout, attach included)");
  const compile = src("cli/compile.js");
  assert(/waitCompileServed\(port, key\)/.test(compile) && /const key = `\$\{path\.basename\(outDir\)\} \(compile\)`/.test(compile), "the compile handoff waits for the compile feed served");
  assert(/url\.searchParams\.set\("starting", "1"\)/.test(compile), "standalone compile opens the shared cold-start board surface, not a compile-pinned URL");
  const app = src("src/App.tsx");
  assert(/advance on a SERVED signal/.test(app), "the relaunch overlay advances on a served signal");
  assert(/absent ⇒ not served/.test(app), "the overlay keys off the served (broadcast) workflows map");
  assert(!/\(!!liveModel\.runId && liveModel\.runId !== relaunch\.fromRunId\)/.test(app), "the old bare-run_id heuristic is gone");
});

// ── runner ───────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
console.log(`\n  ${bold(`served.smoke — ${scenarios.length} scenarios`)}\n`);
for (const s of scenarios) {
  try { await s.fn(); passed++; console.log(`  ${green("PASS")}  ${s.name}`); }
  catch (e) { failed++; console.log(`  ${red("FAIL")}  ${s.name}`); console.log(dim(`        ${String(e.message).split("\n").join("\n        ")}`)); }
}
for (const c of servers) { try { process.kill(-c.pid, "SIGKILL"); } catch {} try { c.kill("SIGKILL"); } catch {} }
spawnSync("pkill", ["-f", "served-smoke"]);
console.log(`\n  ${bold("Summary:")} ${green(`${passed} passed`)}, ${failed ? red(`${failed} failed`) : dim("0 failed")} / ${scenarios.length}\n`);
process.exit(failed ? 1 : 0);
