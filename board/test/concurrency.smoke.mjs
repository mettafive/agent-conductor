/**
 * concurrency.smoke.mjs — the locked, atomic status-write path (Part A + C, offline).
 *
 *   CC1 NO LOST UPDATES (the headline): N concurrent writer PROCESSES each append
 *       beats + set their own status field through mutateStatus — every beat present,
 *       every field intact, nothing clobbered.
 *   CC2 monotonic seq under concurrency: seqs are exactly 1..(N·count) — strictly
 *       increasing, no duplicates, no gaps (proves the lock serialized the appends).
 *   CC3 atomic write: after the storm, status.json is valid JSON and no .tmp file lingers.
 *   CC4 stale-lock steal: a dead holder's lock never deadlocks a writer.
 *   CC5 control beats render immediately: the monitor skips the typewriter queue for them.
 *
 * Run:  node test/concurrency.smoke.mjs    (from board/)
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mutateStatus } from "../cli/status-store.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOARD = path.resolve(HERE, "..");
const WRITER = path.join(HERE, "_status-writer.mjs");

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

class AssertError extends Error {}
const assert = (c, m) => { if (!c) throw new AssertError(m); };
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "conc-smoke-"));
const seed = (sp) => fs.writeFileSync(sp, JSON.stringify({ steps: { "0": { heartbeat: [] } }, beat_seq: 0 }, null, 2));
const run = (args) => new Promise((res) => { const c = spawn("node", args, { stdio: "ignore" }); c.on("exit", (code) => res(code)); });

const scenarios = [];
const test = (name, fn) => scenarios.push({ name, fn });

const N = 8;
const COUNT = 15; // N·COUNT = 120 appends racing through the lock

test("CC1 no lost updates: N concurrent writers — every beat + every field survives", async () => {
  const tmp = tmpdir();
  const sp = path.join(tmp, "status.json");
  seed(sp);
  await Promise.all(Array.from({ length: N }, (_, id) => run([WRITER, sp, String(id), String(COUNT)])));
  const st = JSON.parse(fs.readFileSync(sp, "utf8"));
  const beats = st.steps["0"].heartbeat;
  assert(beats.length === N * COUNT, `expected ${N * COUNT} beats, got ${beats.length} — appends were LOST to clobber`);
  for (let id = 0; id < N; id++) assert(st[`field_${id}`] === String(id), `writer ${id}'s status field was clobbered (got ${st[`field_${id}`]})`);
  // and every writer's beats are all present (none dropped)
  for (let id = 0; id < N; id++) {
    const mine = beats.filter((b) => (b.note || "").startsWith(`w${id}-`)).length;
    assert(mine === COUNT, `writer ${id} lost beats: ${mine}/${COUNT}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("CC2 monotonic seq: seqs are exactly 1..N·count — no dup, no gap", async () => {
  const tmp = tmpdir();
  const sp = path.join(tmp, "status.json");
  seed(sp);
  await Promise.all(Array.from({ length: N }, (_, id) => run([WRITER, sp, String(id), String(COUNT)])));
  const beats = JSON.parse(fs.readFileSync(sp, "utf8")).steps["0"].heartbeat;
  const seqs = beats.map((b) => b.seq).sort((a, b) => a - b);
  assert(new Set(seqs).size === seqs.length, `duplicate seq under concurrency: ${seqs.length - new Set(seqs).size} dup(s)`);
  assert(seqs[0] === 1 && seqs[seqs.length - 1] === N * COUNT, `seqs should span 1..${N * COUNT} (got ${seqs[0]}..${seqs[seqs.length - 1]})`);
  assert(seqs.every((s, i) => s === i + 1), "seqs must be strictly increasing with no gaps");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("CC3 atomic write: status.json is always valid + no temp file lingers", async () => {
  const tmp = tmpdir();
  const sp = path.join(tmp, "status.json");
  seed(sp);
  await Promise.all(Array.from({ length: N }, (_, id) => run([WRITER, sp, String(id), String(COUNT)])));
  // valid JSON (temp+rename means a reader never sees a partial file)
  JSON.parse(fs.readFileSync(sp, "utf8"));
  const leftovers = fs.readdirSync(tmp).filter((f) => f.includes(".tmp.") || f.endsWith(".lock"));
  assert(leftovers.length === 0, `temp/lock files lingered (not cleaned): ${leftovers.join(", ")}`);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("CC4 stale-lock steal: a dead holder's lock never deadlocks the next writer", () => {
  const tmp = tmpdir();
  const sp = path.join(tmp, "status.json");
  seed(sp);
  // Plant a lock that looks abandoned (mtime ~20s ago > the 15s stale threshold).
  const lock = `${sp}.lock`;
  fs.writeFileSync(lock, "999999 0");
  const old = Date.now() / 1000 - 20;
  fs.utimesSync(lock, old, old);
  const t0 = Date.now();
  mutateStatus(sp, (s) => { s.stolen = true; });
  assert(Date.now() - t0 < 4000, "stealing a stale lock must not block on the full acquire timeout");
  assert(JSON.parse(fs.readFileSync(sp, "utf8")).stolen === true, "the write succeeded after stealing the stale lock");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("CC5 control beats bypass the typewriter queue (render immediately)", () => {
  const src = fs.readFileSync(path.join(BOARD, "src", "components", "HeartbeatMonitor.tsx"), "utf8");
  // never parked (the hide-skip excludes control), never queued for typing (the pump skips control):
  assert(/!b\.control && b\.key !== typingKey && !typedRef\.current\.has\(b\.key\)\) continue/.test(src), "control beats must never be parked/hidden");
  assert(/!typedRef\.current\.has\(b\.key\) && !b\.control/.test(src), "the typing pump must skip control beats");
});

// ── runner ───────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
console.log(`\n  ${bold(`concurrency.smoke — ${scenarios.length} scenarios`)}\n`);
for (const s of scenarios) {
  try { await s.fn(); passed++; console.log(`  ${green("PASS")}  ${s.name}`); }
  catch (e) { failed++; console.log(`  ${red("FAIL")}  ${s.name}`); console.log(dim(`        ${String(e.message).split("\n").join("\n        ")}`)); }
}
console.log(`\n  ${bold("Summary:")} ${green(`${passed} passed`)}, ${failed ? red(`${failed} failed`) : dim("0 failed")} / ${scenarios.length}\n`);
process.exit(failed ? 1 : 0);
