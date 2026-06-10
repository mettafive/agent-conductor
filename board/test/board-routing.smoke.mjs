/**
 * board-routing.smoke.mjs — the compile must not squat the run's identity (offline).
 *
 * The warm path spawns the board pointing at compile.status.json, so discovery used
 * to register the COMPILE as the flat primary `landing-forge` (first-writer-wins) and
 * the real run was hidden. The fix: a lifecycle --path registers the sibling RUN as the
 * primary and the lifecycle feed under its own variant.
 *
 *   BR1 warm compile (explicit compile.status.json) + run on disk:
 *       `landing-forge` is the RUN (21 cards), the compile is a reachable variant.
 *   BR2 cold/normal (explicit run status.json): unchanged — run owns the id.
 *   BR3 compile-only (no run yet): the compile never squats `landing-forge`.
 *
 * Run:  node test/board-routing.smoke.mjs    (from board/)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverWorkflows } from "../server/server.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

class AssertError extends Error {}
const assert = (c, m) => { if (!c) throw new AssertError(m); };
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "route-smoke-"));

// Lay out a scoped conductor dir like a warm compile→run: the run's workflow.json +
// status.json (21 cards, card 0 done), plus the compile's compile.* feed beside them.
function seed(tmp, { withRun = true } = {}) {
  const dir = path.join(tmp, ".conductor", "landing-forge");
  fs.mkdirSync(dir, { recursive: true });
  const runSteps = {};
  for (let i = 0; i < 21; i++) runSteps[String(i)] = { status: i === 0 ? "done" : "pending", gate: i === 0 ? "passed" : "pending", attempt: 1 };
  if (withRun) {
    fs.writeFileSync(path.join(dir, "workflow.json"), JSON.stringify({ conductor: "3.0.0", name: "landing-forge", steps: Array.from({ length: 21 }, (_, i) => ({ title: `Card ${i}`, requires: i ? [i - 1] : [] })) }, null, 2));
    fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify({ workflow: "landing-forge", status: "running", current_step: "1", steps: runSteps }, null, 2));
  }
  // the warm compile's feed (3 cards, done) — its workflow.json is named the generic migration title
  fs.writeFileSync(path.join(dir, "compile.workflow.json"), JSON.stringify({ conductor: "3.0.0", name: "Migrating skill to conductor", steps: [{ title: "Create Cards" }, { title: "Map Dependencies" }, { title: "Validate Workflow" }] }, null, 2));
  fs.writeFileSync(path.join(dir, "compile.status.json"), JSON.stringify({ status: "done", steps: { "0": { status: "done" }, "1": { status: "done" }, "2": { status: "done" } } }, null, 2));
  return { dir, compileStatus: path.join(dir, "compile.status.json"), runStatus: path.join(dir, "status.json") };
}

const scenarios = [];
const test = (name, fn) => scenarios.push({ name, fn });

test("BR1 warm compile: landing-forge is the RUN, compile is a reachable variant", () => {
  const tmp = tmpdir();
  const { dir, compileStatus, runStatus } = seed(tmp);
  // the board was spawned by the warm compile → explicit --path is compile.status.json
  const found = discoverWorkflows(dir, compileStatus, null);
  const primary = found.find((w) => w.name === "landing-forge");
  assert(primary, `a "landing-forge" feed must exist: ${JSON.stringify(found.map((w) => w.name))}`);
  assert(primary.variant === "run", `landing-forge must be the run (variant "run"), got "${primary.variant}"`);
  assert(path.resolve(primary.statusPath) === path.resolve(runStatus), "landing-forge must point at the RUN's status.json, not the compile's");
  // and it really is the 21-card run
  const st = JSON.parse(fs.readFileSync(primary.statusPath, "utf8"));
  assert(Object.keys(st.steps).length === 21, `landing-forge must be the 21-card run (got ${Object.keys(st.steps).length})`);
  // the compile self-check survives as its own variant — not destroyed
  const compile = found.find((w) => w.variant === "compile");
  assert(compile, "the compile must remain reachable as a compile variant");
  assert(compile.name !== "landing-forge", `the compile must NOT occupy the run's id (got "${compile.name}")`);
  assert(path.resolve(compile.statusPath) === path.resolve(compileStatus), "the compile variant points at compile.status.json");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("BR2 cold/normal: an explicit run status.json keeps the run as primary", () => {
  const tmp = tmpdir();
  const { dir, runStatus } = seed(tmp);
  const found = discoverWorkflows(dir, runStatus, null); // explicit --path is the RUN's status.json
  const primary = found.find((w) => w.name === "landing-forge");
  assert(primary && primary.variant === "run", "run is the primary in the normal path");
  assert(path.resolve(primary.statusPath) === path.resolve(runStatus), "primary points at the run status.json");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("BR3 compile-only (run not started): the compile never squats landing-forge", () => {
  const tmp = tmpdir();
  const { dir, compileStatus } = seed(tmp, { withRun: false });
  const found = discoverWorkflows(dir, compileStatus, null);
  // no run on disk yet → no feed may claim the bare "landing-forge" id
  assert(!found.some((w) => w.name === "landing-forge"), `nothing may squat "landing-forge" before the run exists: ${JSON.stringify(found.map((w) => w.name))}`);
  // the compile is present as a (namespaced) compile variant
  const compile = found.find((w) => w.variant === "compile");
  assert(compile && path.resolve(compile.statusPath) === path.resolve(compileStatus), "the compile is reachable as a compile variant");
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── runner ───────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
console.log(`\n  ${bold(`board-routing.smoke — ${scenarios.length} scenarios`)}\n`);
for (const s of scenarios) {
  try { await s.fn(); passed++; console.log(`  ${green("PASS")}  ${s.name}`); }
  catch (e) { failed++; console.log(`  ${red("FAIL")}  ${s.name}`); console.log(dim(`        ${String(e.message).split("\n").join("\n        ")}`)); }
}
console.log(`\n  ${bold("Summary:")} ${green(`${passed} passed`)}, ${failed ? red(`${failed} failed`) : dim("0 failed")} / ${scenarios.length}\n`);
process.exit(failed ? 1 : 0);
