/**
 * heartbeat.smoke.mjs — the descriptive heartbeats are back. Offline, stub worker.
 *
 *   HB1 the worker brief carries the recovered instruction, UNPARAPHRASED.
 *   HB2 prose beats land in the per-card channel (status.json heartbeat[]) at
 *       start / during / end — not a mechanical ping.
 *   HB3 non-blocking: the work completes despite the beats (emission is off the
 *       hot path — a worker that narrates still finishes the card).
 *   HB4 the card component renders the heartbeat field (latest + rolling history).
 *
 * Run:  node test/heartbeat.smoke.mjs    (from board/)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.CONDUCTOR_DECOMPOSE_CODEX = "0"; // offline

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
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "hb-smoke-"));
function cli(args, cwd, env = {}) {
  const r = spawnSync("node", [CLI, ...args], { cwd, encoding: "utf8", timeout: 60000, env: { ...process.env, ...env } });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
function seed(tmp) {
  const scoped = path.join(tmp, ".conductor", "wf");
  fs.mkdirSync(scoped, { recursive: true });
  const wf = path.join(scoped, "workflow.json");
  fs.writeFileSync(wf, JSON.stringify({ conductor: "3.0.0", name: "hb", description: "x.", steps: [{ title: "A", instruction: "Do A.", requires: [] }] }, null, 2));
  const status = path.join(scoped, "status.json");
  assert(cli(["status-init", wf, "--path", status], tmp).code === 0, "status-init");
  return { wf, status };
}

const scenarios = [];
const test = (name, fn) => scenarios.push({ name, fn });

// The recovered (verbatim) crown — must appear in the brief, unparaphrased.
const CROWN = [
  "Treat each update like a Codex preamble: concise, grouped, and useful for bringing the user along while work is happening.",
  'Good update: "README still describes explicit gates, so I am rewriting the quick start around instruction-based checking."',
  'Good update: "Choosing verified cards over gates because v3 no longer has gate fields."',
];

test("HB1 worker brief carries the recovered instruction, unparaphrased", () => {
  const tmp = tmpdir();
  const { wf, status } = seed(tmp);
  const r = cli(["run-card", "0", "--path", status, "--workflow", wf, "--print-brief"], tmp);
  assert(r.code === 0, `print-brief failed:\n${r.out}`);
  for (const line of CROWN) assert(r.out.includes(line), `brief is missing the verbatim crown line:\n  ${line}`);
  assert(/Narrate your work as you go/.test(r.out), "brief should have a heartbeat narration section");
  assert(/update 0 "/.test(r.out), "brief should give the update command for this card");
  assert(/FIRE-AND-FORGET/.test(r.out), "brief should mark the beats fire-and-forget (parallel)");
  assert(/START.*at least once a minute.*FINISH/s.test(r.out), "brief should name the start/periodic/end triggers");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("HB2 prose beats land in the per-card channel at start/during/end", () => {
  const tmp = tmpdir();
  const { wf, status } = seed(tmp);
  const r = cli(["run-card", "0", "--path", status, "--workflow", wf], tmp,
    { CONDUCTOR_WORKER_CMD: `node ${STUB}`, STUB_BEATS: "1", CONDUCTOR_HEADLESS: "1" });
  assert(r.code === 0 || /done/.test(r.out), `run-card should complete:\n${r.out.slice(0, 300)}`);
  const st = JSON.parse(fs.readFileSync(status, "utf8"));
  const beats = st.steps["0"].heartbeat || [];
  const prose = beats.filter((b) => !b.system && typeof b.note === "string" && b.note.trim());
  assert(prose.length >= 3, `expected >=3 PROSE beats (start/during/end), got ${prose.length}: ${JSON.stringify(beats.map((b) => b.note))}`);
  assert(prose.some((b) => /Starting the card/.test(b.note)), "missing the START prose beat");
  assert(prose.some((b) => /Done:/.test(b.note)), "missing the END prose beat");
  // not just mechanical: the prose beats carry real sentences, not "Started: A" pings.
  assert(!prose.every((b) => /^Started:/.test(b.note)), "beats must be prose, not mechanical system pings");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("HB3 non-blocking: the card still completes while narrating", () => {
  const tmp = tmpdir();
  const { wf, status } = seed(tmp);
  cli(["run-card", "0", "--path", status, "--workflow", wf], tmp,
    { CONDUCTOR_WORKER_CMD: `node ${STUB}`, STUB_BEATS: "1", CONDUCTOR_HEADLESS: "1" });
  const st = JSON.parse(fs.readFileSync(status, "utf8"));
  assert(st.steps["0"].status === "done", `card must reach done despite the beats (work not stalled): ${st.steps["0"].status}`);
  // structural: the brief tells the worker not to block on a beat, and beats are
  // emitted by the worker via a SEPARATE `update` call — never awaited in the
  // dispatch/run-card hot path.
  const rc = fs.readFileSync(path.join(BOARD, "cli", "run-card.js"), "utf8");
  assert(/never block the work waiting on one/.test(rc), "brief should forbid blocking on a beat");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("HB4 the card component renders the heartbeat field (latest + rolling history)", () => {
  const src = fs.readFileSync(path.join(BOARD, "src", "components", "WorkflowKanban.tsx"), "utf8");
  // latest beat → the live summary line:
  assert(/latest\?\.note/.test(src), "card should derive the summary line from the latest heartbeat note");
  assert(/renderNote\(summaryLine\)/.test(src), "card should render the latest-beat summary line");
  // rolling history of prose beats, restored into the card:
  assert(/const proseBeats =/.test(src) && /recentBeats\.map/.test(src), "card should render a rolling history of recent prose beats");
});

// ── runner ───────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
console.log(`\n  ${bold(`heartbeat.smoke — ${scenarios.length} scenarios`)}\n`);
for (const s of scenarios) {
  try { await s.fn(); passed++; console.log(`  ${green("PASS")}  ${s.name}`); }
  catch (e) { failed++; console.log(`  ${red("FAIL")}  ${s.name}`); console.log(dim(`        ${String(e.message).split("\n").join("\n        ")}`)); }
}
spawnSync("pkill", ["-f", "hb-smoke|stub-worker"]);
console.log(`\n  ${bold("Summary:")} ${green(`${passed} passed`)}, ${failed ? red(`${failed} failed`) : dim("0 failed")} / ${scenarios.length}\n`);
process.exit(failed ? 1 : 0);
