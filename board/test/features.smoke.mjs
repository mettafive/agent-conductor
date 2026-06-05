/**
 * Feature smoke test — every MAIN conductor feature through the REAL CLI.
 *
 * Where loops.smoke.ts goes deep on one feature (loop rendering), this goes WIDE:
 * 50+ real-world scenarios a future user will actually hit, each invoking
 * `node bin/cli.js …` exactly as a user/agent would and asserting on the real
 * exit code + stdout/stderr + the on-disk status.json / conductor.yaml.
 *
 * Coverage map (feature → scenarios):
 *   init        scaffold, flags, clamp, --force refuse/overwrite, generated-yaml-validates
 *   validate    every VALID shape (linear/loop/condition/approval/parallel/DAG) +
 *               every INVALID path the validator can emit (16 distinct rules)
 *   status-init linear, run-id, goal, auto_improve off, Phase-0 injection, loop type
 *   step/gate   running/done/failed transitions, current_step, gate states, errors
 *   heartbeat   append, insight tags, finalBeat handoff, loop-sub bubble, errors
 *   check       board-sync pass + every stale/desync/Phase-0 failure
 *   complete    hard-gate pass/fail, soft-attest, loop-coverage guard, sub-step
 *   loop        loop-scope frontload, multiword guard, sequential guard, parallel exempt
 *   knowledge   suggest (+scope validation), --min gate, --min-scopes gate
 *   lifecycle   one realistic init→validate→status-init→run→complete→finish run
 *
 * Run:  node test/features.smoke.mjs    (from board/)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOARD = path.resolve(HERE, "..");
const CLI = path.join(BOARD, "bin", "cli.js");

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const amber = (s) => `\x1b[38;5;214m${s}\x1b[0m`;

// ── harness ───────────────────────────────────────────────────────────────
class AssertError extends Error {}
function assert(cond, msg) {
  if (!cond) throw new AssertError(msg);
}

/** Run the real CLI. Returns { code, out } — out = stdout+stderr merged on EVERY
 *  path (warnings go to stderr even on exit 0, so we must always capture both). */
function cli(args, cwd) {
  const r = spawnSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function tmpdir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "feat-smoke-"));
  fs.mkdirSync(path.join(d, ".conductor"), { recursive: true });
  return d;
}
/** Write a conductor.yaml into <tmp>/.conductor and return tmp. */
function withConductor(yamlStr) {
  const tmp = tmpdir();
  fs.writeFileSync(path.join(tmp, ".conductor", "conductor.yaml"), yamlStr);
  return tmp;
}
const status = (tmp) => JSON.parse(fs.readFileSync(path.join(tmp, ".conductor", "status.json"), "utf8"));
const writeFile = (tmp, rel, body) => {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
};

// ── reusable conductor fixtures ─────────────────────────────────────────────
const LINEAR = `conductor: 2.0.0
name: linear-flow
description: A simple three-step linear workflow.
steps:
  - id: gather
    instruction: Gather the inputs.
    gate:
      - "inputs gathered"
  - id: build
    instruction: Build the thing.
    requires: [gather]
    gate:
      - "build succeeds"
  - id: ship
    instruction: Ship it.
    requires: [build]
    gate:
      - check: "true"
        name: smoke
`;

const LOOP = `conductor: 2.0.0
name: loop-flow
description: A loop over items.
steps:
  - id: run
    type: loop
    over: items
    as: item
    steps:
      - id: work
        instruction: "Do work for {item}."
        gate:
          - "{item} done"
`;

const PARALLEL_LOOP = LOOP.replace("    as: item\n", "    as: item\n    parallel: true\n");

// ── scenarios ────────────────────────────────────────────────────────────────
const scenarios = [];
const test = (name, fn) => scenarios.push({ name, fn });

// helper: validate-only assertions
function expectValid(yamlStr) {
  const tmp = tmpdir();
  const p = writeFile(tmp, "c.yaml", yamlStr);
  const r = cli(["validate", p], tmp);
  fs.rmSync(tmp, { recursive: true, force: true });
  assert(r.code === 0, `expected valid (exit 0), got exit ${r.code}:\n${r.out}`);
  assert(/is valid/.test(r.out), `expected "is valid" in output:\n${r.out}`);
}
function expectInvalid(yamlStr, substr) {
  const tmp = tmpdir();
  const p = writeFile(tmp, "c.yaml", yamlStr);
  const r = cli(["validate", p], tmp);
  fs.rmSync(tmp, { recursive: true, force: true });
  assert(r.code !== 0, `expected INVALID (non-zero exit) but got exit 0:\n${r.out}`);
  if (substr) assert(r.out.includes(substr), `expected error containing "${substr}", got:\n${r.out}`);
}

// ── INIT ─────────────────────────────────────────────────────────────────────
test("init: --name + --steps scaffolds N steps and the result validates", () => {
  const tmp = tmpdir();
  const r = cli(["init", "--name", "my-wf", "--steps", "4", "--description", "demo"], tmp);
  assert(r.code === 0, `init failed: ${r.out}`);
  const f = path.join(tmp, ".conductor", "conductor.yaml");
  assert(fs.existsSync(f), "conductor.yaml not created");
  const body = fs.readFileSync(f, "utf8");
  assert((body.match(/- id: step-/g) || []).length === 4, `expected 4 steps, got:\n${body}`);
  const v = cli(["validate", f], tmp);
  assert(v.code === 0, `scaffolded conductor did not validate:\n${v.out}`);
});

test("init: --steps 1 produces a single-step conductor", () => {
  const tmp = tmpdir();
  const r = cli(["init", "--name", "one", "--steps", "1"], tmp);
  assert(r.code === 0, r.out);
  const body = fs.readFileSync(path.join(tmp, ".conductor", "conductor.yaml"), "utf8");
  assert((body.match(/- id: step-/g) || []).length === 1, `expected 1 step:\n${body}`);
});

test("init: --steps 99 clamps to 50", () => {
  const tmp = tmpdir();
  cli(["init", "--name", "big", "--steps", "99"], tmp);
  const body = fs.readFileSync(path.join(tmp, ".conductor", "conductor.yaml"), "utf8");
  assert((body.match(/- id: step-/g) || []).length === 50, "expected clamp to 50 steps");
});

test("init: --steps 0 falls back to the 3-step default", () => {
  const tmp = tmpdir();
  cli(["init", "--name", "zero", "--steps", "0"], tmp);
  const body = fs.readFileSync(path.join(tmp, ".conductor", "conductor.yaml"), "utf8");
  assert((body.match(/- id: step-/g) || []).length === 3, "expected fallback to 3 steps");
});

test("init: refuses to overwrite an existing conductor without --force", () => {
  const tmp = tmpdir();
  assert(cli(["init", "--name", "a"], tmp).code === 0, "first init should succeed");
  const r = cli(["init", "--name", "b"], tmp);
  assert(r.code !== 0, "second init should FAIL without --force");
  assert(/already exists/.test(r.out), `expected "already exists":\n${r.out}`);
});

test("init: --force overwrites an existing conductor", () => {
  const tmp = tmpdir();
  cli(["init", "--name", "a", "--steps", "2"], tmp);
  const r = cli(["init", "--name", "b", "--steps", "5", "--force"], tmp);
  assert(r.code === 0, `--force init should succeed: ${r.out}`);
  const body = fs.readFileSync(path.join(tmp, ".conductor", "conductor.yaml"), "utf8");
  assert((body.match(/- id: step-/g) || []).length === 5, "overwrite should reflect new --steps");
});

// ── VALIDATE: valid shapes ────────────────────────────────────────────────────
test("validate: linear 3-step conductor is valid", () => expectValid(LINEAR));
test("validate: loop conductor is valid", () => expectValid(LOOP));
test("validate: parallel loop (parallel: true) is valid", () => expectValid(PARALLEL_LOOP));
test("validate: parallel: auto is valid", () =>
  expectValid(LOOP.replace("    as: item\n", "    as: item\n    parallel: auto\n")));
test("validate: condition step with both branches is valid", () =>
  expectValid(`conductor: 2.0.0
name: cond
description: branch.
steps:
  - id: decide
    type: condition
    instruction: Decide.
    if_true: yes-path
    if_false: no-path
  - id: yes-path
    instruction: Do yes.
    gate: ["ok"]
  - id: no-path
    instruction: Do no.
    gate: ["ok"]
`));
test("validate: approval step with approve/reject targets is valid", () =>
  expectValid(`conductor: 2.0.0
name: appr
description: approve.
steps:
  - id: review
    type: approval
    approval:
      actions:
        approve: ship
        reject: halt
  - id: ship
    instruction: Ship.
    gate: ["ok"]
  - id: halt
    instruction: Stop.
    gate: ["ok"]
`));
test("validate: acyclic requires DAG is valid", () =>
  expectValid(`conductor: 2.0.0
name: dag
description: dag.
steps:
  - id: a
    instruction: A.
    gate: ["ok"]
  - id: b
    instruction: B.
    requires: [a]
    gate: ["ok"]
  - id: c
    instruction: C.
    requires: [a, b]
    gate: ["ok"]
`));
test("validate: mixed hard + soft gates report correct counts", () => {
  const tmp = tmpdir();
  const p = writeFile(tmp, "c.yaml", LINEAR);
  const r = cli(["validate", p], tmp);
  assert(r.code === 0, r.out);
  assert(/1 hard gate/.test(r.out), `expected 1 hard gate counted:\n${r.out}`);
  assert(/soft gate/.test(r.out), `expected soft gates counted:\n${r.out}`);
});

// ── VALIDATE: invalid paths (one rule each) ───────────────────────────────────
test("validate: missing top-level name is rejected", () =>
  expectInvalid(`conductor: 2.0.0
description: no name.
steps:
  - id: a
    instruction: A.
`, 'Missing required top-level key "name"'));

test("validate: missing conductor version is rejected", () =>
  expectInvalid(`name: x
description: y.
steps:
  - id: a
    instruction: A.
`, 'Missing required top-level key "conductor"'));

test("validate: non-semver conductor version is rejected", () =>
  expectInvalid(`conductor: "2.0"
name: x
description: y.
steps:
  - id: a
    instruction: A.
`, "semver"));

test("validate: duplicate step id is rejected", () =>
  expectInvalid(`conductor: 2.0.0
name: dup
description: d.
steps:
  - id: a
    instruction: A.
  - id: a
    instruction: A2.
`, 'Duplicate step id "a"'));

test("validate: step with no instruction is rejected", () =>
  expectInvalid(`conductor: 2.0.0
name: noinst
description: d.
steps:
  - id: a
    gate: ["ok"]
`, "no instruction"));

test("validate: malformed gate criterion is rejected", () =>
  expectInvalid(`conductor: 2.0.0
name: badgate
description: d.
steps:
  - id: a
    instruction: A.
    gate:
      - notcheck: "oops"
`, "malformed gate"));

test("validate: condition missing if_true is rejected", () =>
  expectInvalid(`conductor: 2.0.0
name: c
description: d.
steps:
  - id: a
    type: condition
    instruction: A.
    if_false: b
  - id: b
    instruction: B.
    gate: ["ok"]
`, "missing if_true"));

test("validate: condition missing if_false is rejected", () =>
  expectInvalid(`conductor: 2.0.0
name: c
description: d.
steps:
  - id: a
    type: condition
    instruction: A.
    if_true: b
  - id: b
    instruction: B.
    gate: ["ok"]
`, "missing if_false"));

test("validate: loop missing 'over' is rejected", () =>
  expectInvalid(`conductor: 2.0.0
name: l
description: d.
steps:
  - id: a
    type: loop
    as: item
    steps:
      - id: w
        instruction: W.
`, 'missing "over"'));

test("validate: loop missing 'as' is rejected", () =>
  expectInvalid(`conductor: 2.0.0
name: l
description: d.
steps:
  - id: a
    type: loop
    over: items
    steps:
      - id: w
        instruction: W.
`, 'missing "as"'));

test("validate: loop with no sub-steps is rejected", () =>
  expectInvalid(`conductor: 2.0.0
name: l
description: d.
steps:
  - id: a
    type: loop
    over: items
    as: item
    steps: []
`, "no sub-steps"));

test("validate: loop sub-step missing instruction is rejected", () =>
  expectInvalid(`conductor: 2.0.0
name: l
description: d.
steps:
  - id: a
    type: loop
    over: items
    as: item
    steps:
      - id: w
        gate: ["ok"]
`, "no instruction"));

test("validate: loop with invalid 'parallel' value is rejected", () =>
  expectInvalid(`conductor: 2.0.0
name: l
description: d.
steps:
  - id: a
    type: loop
    over: items
    as: item
    parallel: sometimes
    steps:
      - id: w
        instruction: W.
`, 'invalid "parallel"'));

test("validate: approval missing the approval block is rejected", () =>
  expectInvalid(`conductor: 2.0.0
name: a
description: d.
steps:
  - id: r
    type: approval
`, 'missing the "approval" block'));

test("validate: unknown 'then' target is rejected", () =>
  expectInvalid(`conductor: 2.0.0
name: a
description: d.
steps:
  - id: a
    instruction: A.
    then: nowhere
    gate: ["ok"]
`, 'unknown step "nowhere"'));

test("validate: unknown 'requires' target is rejected", () =>
  expectInvalid(`conductor: 2.0.0
name: a
description: d.
steps:
  - id: a
    instruction: A.
    requires: [ghost]
    gate: ["ok"]
`, 'unknown step "ghost"'));

test("validate: circular requires dependency is rejected", () =>
  expectInvalid(`conductor: 2.0.0
name: cyc
description: d.
steps:
  - id: a
    instruction: A.
    requires: [b]
    gate: ["ok"]
  - id: b
    instruction: B.
    requires: [a]
    gate: ["ok"]
`, "Circular dependency"));

test("validate: unreachable (orphan) step is rejected", () =>
  expectInvalid(`conductor: 2.0.0
name: orph
description: d.
steps:
  - id: a
    instruction: A.
    then: c
    gate: ["ok"]
  - id: b
    instruction: B (unreachable).
    gate: ["ok"]
  - id: c
    instruction: C.
    gate: ["ok"]
`, "unreachable"));

test("validate: empty file is rejected", () => {
  const tmp = tmpdir();
  const p = writeFile(tmp, "c.yaml", "");
  const r = cli(["validate", p], tmp);
  assert(r.code !== 0, "empty file should be invalid");
});

test("validate: unparseable YAML is rejected with a parse error", () =>
  expectInvalid(`name: "[unclosed
  bad: : :`, "parse"));

test("validate: nonexistent file path errors clearly", () => {
  const tmp = tmpdir();
  const r = cli(["validate", path.join(tmp, "nope.yaml")], tmp);
  assert(r.code !== 0, "missing file should error");
  assert(/No conductor file/.test(r.out), `expected "No conductor file":\n${r.out}`);
});

// ── STATUS-INIT ───────────────────────────────────────────────────────────────
test("status-init: linear conductor → all steps pending, running, goal carried", () => {
  const tmp = withConductor(LINEAR);
  const r = cli(["status-init", ".conductor/conductor.yaml"], tmp);
  assert(r.code === 0, r.out);
  const s = status(tmp);
  assert(s.status === "running", `expected status running, got ${s.status}`);
  assert(s.goal === "A simple three-step linear workflow.", `goal not carried: ${s.goal}`);
  assert(s.current_step === null, "current_step should start null");
  for (const id of ["gather", "build", "ship"]) {
    assert(s.steps[id] && s.steps[id].status === "pending", `step ${id} not pending`);
  }
});

test("status-init: custom --run-id is honored", () => {
  const tmp = withConductor(LINEAR);
  cli(["status-init", ".conductor/conductor.yaml", "--run-id", "RUN-XYZ"], tmp);
  assert(status(tmp).run_id === "RUN-XYZ", "custom run_id not used");
});

test("status-init: run_name follows {slug}-run-N-{ts}", () => {
  const tmp = withConductor(LINEAR);
  cli(["status-init", ".conductor/conductor.yaml"], tmp);
  assert(/^linear-flow-run-1-/.test(status(tmp).run_name), `run_name format off: ${status(tmp).run_name}`);
});

test("status-init: auto_improve:false injects NO _improve cards even with proven knowledge", () => {
  const tmp = withConductor(`conductor: 2.0.0
name: ai-off
description: d.
auto_improve: false
knowledge:
  - title: Always tag prices
    scope: this-conductor
    status: proven
    current: untagged
    proposed: tagged
steps:
  - id: a
    instruction: A.
    gate: ["ok"]
`);
  cli(["status-init", ".conductor/conductor.yaml"], tmp);
  const ids = Object.keys(status(tmp).steps);
  assert(!ids.some((i) => i.startsWith("_improve")), `expected no _improve cards, got: ${ids.join(",")}`);
});

test("status-init: Phase-0 injects improvement cards from proven this-conductor knowledge", () => {
  const tmp = withConductor(`conductor: 2.0.0
name: ai-on
description: d.
knowledge:
  - title: Always tag prices
    scope: this-conductor
    status: proven
    current: untagged
    proposed: tagged
steps:
  - id: a
    instruction: A.
    gate: ["ok"]
`);
  const r = cli(["status-init", ".conductor/conductor.yaml"], tmp);
  assert(/Phase 0 improvement/.test(r.out), `expected Phase 0 improvement note:\n${r.out}`);
  const ids = Object.keys(status(tmp).steps);
  assert(ids.includes("_improve::read-knowledge"), "missing _improve::read-knowledge");
  assert(ids.includes("_improve::validate"), "missing _improve::validate");
  assert(ids.some((i) => i.startsWith("_improve::always")), "missing the actionable improve card");
});

test("status-init: loop step registers with type 'loop' and an iterations map", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/conductor.yaml"], tmp);
  const st = status(tmp).steps.run;
  assert(st.type === "loop", `expected type loop, got ${st.type}`);
  assert(st.iterations && typeof st.iterations === "object", "missing iterations map");
  assert(st.total === 0 && st.completed === 0, "loop counters should start at 0");
});

// ── STEP / GATE ───────────────────────────────────────────────────────────────
function initLinear() {
  const tmp = withConductor(LINEAR);
  cli(["status-init", ".conductor/conductor.yaml"], tmp);
  return tmp;
}

test("step running: sets current_step, started_at, and pending gate", () => {
  const tmp = initLinear();
  const r = cli(["step", "gather", "running", "--goal", "do the thing"], tmp);
  assert(r.code === 0, r.out);
  const s = status(tmp);
  assert(s.current_step === "gather", "current_step not set");
  assert(s.steps.gather.started_at, "started_at not set");
  assert(s.steps.gather.gate === "pending", `gate should be pending, got ${s.steps.gather.gate}`);
  assert(s.current_step_goal === "do the thing", "current_step_goal not set");
});

test("step done: sets completed_at and passes the gate", () => {
  const tmp = initLinear();
  cli(["step", "gather", "running"], tmp);
  cli(["step", "gather", "done"], tmp);
  const s = status(tmp);
  assert(s.steps.gather.status === "done", "status not done");
  assert(s.steps.gather.gate === "passed", `gate should be passed, got ${s.steps.gather.gate}`);
  assert(s.steps.gather.completed_at, "completed_at not set");
});

test("step failed: marks the gate failed", () => {
  const tmp = initLinear();
  cli(["step", "build", "running"], tmp);
  cli(["step", "build", "failed"], tmp);
  assert(status(tmp).steps.build.gate === "failed", "gate should be failed");
});

test("step: errors when status.json is missing (no status-init)", () => {
  const tmp = withConductor(LINEAR); // no status-init
  const r = cli(["step", "gather", "running"], tmp);
  assert(r.code !== 0, "step should fail without status.json");
  assert(/status-init/.test(r.out), `expected hint to run status-init:\n${r.out}`);
});

test("gate: transitions a known step's gate state", () => {
  const tmp = initLinear();
  cli(["step", "gather", "running"], tmp);
  cli(["gate", "gather", "checking"], tmp);
  assert(status(tmp).steps.gather.gate === "checking", "gate not set to checking");
});

test("gate: errors on an unknown step id", () => {
  const tmp = initLinear();
  const r = cli(["gate", "ghost", "passed"], tmp);
  assert(r.code !== 0, "gate on unknown step should fail");
  assert(/no step "ghost"/.test(r.out), `expected unknown-step error:\n${r.out}`);
});

// ── HEARTBEAT ─────────────────────────────────────────────────────────────────
test("heartbeat: appends a beat to the step", () => {
  const tmp = initLinear();
  cli(["step", "gather", "running"], tmp);
  const r = cli(["heartbeat", "gather", "scanning inputs"], tmp);
  assert(r.code === 0, r.out);
  const beats = status(tmp).steps.gather.heartbeat;
  assert(Array.isArray(beats) && beats.length === 1, "beat not appended");
  assert(beats[0].note === "scanning inputs", "beat note wrong");
});

test("heartbeat: --insight-type attaches a structured insight", () => {
  const tmp = initLinear();
  cli(["step", "gather", "running"], tmp);
  cli(["heartbeat", "gather", "found a gap", "--insight-type", "missing_instruction", "--insight-seed", "spec gap"], tmp);
  const b = status(tmp).steps.gather.heartbeat[0];
  assert(b.insight && b.insight.type === "missing_instruction", "insight type not captured");
  assert(b.insight.seed === "spec gap", "insight seed not captured");
});

test("heartbeat: --final --to records a finalBeat handoff", () => {
  const tmp = initLinear();
  cli(["step", "gather", "running"], tmp);
  cli(["heartbeat", "gather", "done; handing off", "--final", "--to", "build"], tmp);
  const b = status(tmp).steps.gather.heartbeat[0];
  assert(b.finalBeat === true, "finalBeat flag not set");
  assert(b.handoff && b.handoff.to === "build", "handoff target not set");
});

test("heartbeat: loop sub-step beat bubbles to the loop parent tagged iter+sub", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/conductor.yaml"], tmp);
  cli(["loop-scope", "run", "x", "y"], tmp);
  cli(["heartbeat", "run", "working x", "--iteration", "x", "--sub", "work"], tmp);
  const beats = status(tmp).steps.run.heartbeat;
  const tagged = beats.find((b) => b.iteration === "x" && b.sub === "work");
  assert(tagged, "sub-step beat not bubbled to loop parent with iter+sub tags");
});

test("heartbeat: errors when status.json is missing", () => {
  const tmp = withConductor(LINEAR);
  const r = cli(["heartbeat", "gather", "hi"], tmp);
  assert(r.code !== 0, "heartbeat should fail without status.json");
});

// ── CHECK (board-sync) ────────────────────────────────────────────────────────
test("check: passes when the step is current with a fresh heartbeat", () => {
  const tmp = initLinear();
  cli(["step", "gather", "running"], tmp);
  cli(["heartbeat", "gather", "working"], tmp);
  const r = cli(["check", "gather"], tmp);
  assert(r.code === 0, `board-sync check should pass:\n${r.out}`);
  assert(/board-sync/.test(r.out), `expected board-sync output:\n${r.out}`);
});

test("check: fails a running step with no heartbeats", () => {
  const tmp = initLinear();
  cli(["step", "gather", "running"], tmp);
  const r = cli(["check", "gather"], tmp);
  assert(r.code !== 0, "check should fail with no heartbeat");
  assert(/no heartbeat/.test(r.out), `expected no-heartbeat error:\n${r.out}`);
});

test("check: fails when current_step is a different step", () => {
  const tmp = initLinear();
  cli(["step", "gather", "running"], tmp);
  cli(["heartbeat", "gather", "working"], tmp);
  const r = cli(["check", "build"], tmp); // build isn't current
  assert(r.code !== 0, "check should fail on desynced current_step");
  assert(/current_step/.test(r.out), `expected current_step mismatch error:\n${r.out}`);
});

test("check: fails on an unknown step id", () => {
  const tmp = initLinear();
  const r = cli(["check", "ghost"], tmp);
  assert(r.code !== 0, "check should fail on unknown step");
  assert(/no step "ghost"/.test(r.out), `expected unknown-step error:\n${r.out}`);
});

test("check: blocks a workflow step while Phase-0 improvement cards are open", () => {
  const tmp = withConductor(`conductor: 2.0.0
name: p0
description: d.
knowledge:
  - title: Tag prices
    scope: this-conductor
    status: proven
    current: untagged
    proposed: tagged
steps:
  - id: work
    instruction: W.
    gate: ["ok"]
`);
  cli(["status-init", ".conductor/conductor.yaml"], tmp); // injects open _improve cards
  cli(["step", "work", "running"], tmp);
  cli(["heartbeat", "work", "starting"], tmp);
  const r = cli(["check", "work"], tmp);
  assert(r.code !== 0, "check should block while Phase 0 is open");
  assert(/Phase 0 not complete/.test(r.out), `expected Phase 0 block:\n${r.out}`);
});

// ── COMPLETE ──────────────────────────────────────────────────────────────────
test("complete: a passing hard gate advances the step to done (🔒 verified)", () => {
  const tmp = initLinear();
  const r = cli(["complete", "ship"], tmp); // ship has hard gate: true
  assert(r.code === 0, `complete should pass on hard gate true:\n${r.out}`);
  assert(/All gates passed/.test(r.out), `expected pass message:\n${r.out}`);
  assert(status(tmp).steps.ship.status === "done", "ship not marked done");
});

test("complete: a failing hard gate does NOT advance the step", () => {
  const tmp = withConductor(`conductor: 2.0.0
name: hardfail
description: d.
steps:
  - id: a
    instruction: A.
    gate:
      - check: "false"
        name: nope
`);
  cli(["status-init", ".conductor/conductor.yaml"], tmp);
  const r = cli(["complete", "a"], tmp);
  assert(r.code !== 0, "complete should fail on failing hard gate");
  assert(/Hard gate.*failed/.test(r.out), `expected hard-gate-failed message:\n${r.out}`);
  assert(status(tmp).steps.a.status !== "done", "step should not be done");
});

test("complete: a soft-only gate requires --attest-soft", () => {
  const tmp = initLinear(); // gather has only a soft gate
  const r1 = cli(["complete", "gather"], tmp);
  assert(r1.code !== 0, "soft gate should not auto-pass");
  assert(/not attested/.test(r1.out), `expected not-attested message:\n${r1.out}`);
  const r2 = cli(["complete", "gather", "--attest-soft"], tmp);
  assert(r2.code === 0, `--attest-soft should pass:\n${r2.out}`);
  assert(status(tmp).steps.gather.status === "done", "gather not done after attest");
});

test("complete: loop-coverage guard blocks while an iteration is incomplete", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/conductor.yaml"], tmp);
  cli(["loop-scope", "run", "a", "b"], tmp);
  cli(["loop", "run", "a", "work", "done"], tmp); // a done, b untouched
  const r = cli(["complete", "run"], tmp);
  assert(r.code !== 0, "loop complete should be blocked by incomplete iteration b");
  assert(/incomplete iteration/.test(r.out), `expected incomplete-iteration block:\n${r.out}`);
});

test("complete: loop completes once every iteration is done", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/conductor.yaml"], tmp);
  cli(["loop-scope", "run", "a", "b"], tmp);
  cli(["loop", "run", "a", "work", "done"], tmp);
  cli(["loop", "run", "b", "work", "done"], tmp);
  const r = cli(["complete", "run"], tmp);
  assert(r.code === 0, `loop complete should pass once all iters done:\n${r.out}`);
});

// ── LOOP machinery ────────────────────────────────────────────────────────────
test("loop-scope: frontloads every item as an iteration and sets total", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/conductor.yaml"], tmp);
  const r = cli(["loop-scope", "run", "a", "b", "c"], tmp);
  assert(r.code === 0, r.out);
  const st = status(tmp).steps.run;
  assert(st.total === 3, `expected total 3, got ${st.total}`);
  assert(["a", "b", "c"].every((k) => k in st.iterations), "not all items frontloaded");
});

test("loop-scope: warns when one quoted item hides multiple tokens (still scopes 1)", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/conductor.yaml"], tmp);
  const r = cli(["loop-scope", "run", "a b c"], tmp);
  assert(/space-separated tokens/.test(r.out), `expected multiword warning:\n${r.out}`);
  assert(Object.keys(status(tmp).steps.run.iterations).length === 1, "should scope as ONE iteration");
});

test("loop: sequential loop refuses an out-of-order iteration", () => {
  const tmp = withConductor(LOOP); // no parallel → sequential
  cli(["status-init", ".conductor/conductor.yaml"], tmp);
  cli(["loop-scope", "run", "first", "second", "third"], tmp);
  const r = cli(["loop", "run", "second", "work", "running"], tmp); // skip 'first'
  assert(r.code !== 0, "sequential loop should refuse out-of-order start");
  assert(/sequential/.test(r.out), `expected sequential refusal:\n${r.out}`);
  assert(/finish 'first'/.test(r.out), `expected blocker hint:\n${r.out}`);
});

test("loop: sequential loop allows the genuine next-in-line iteration", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/conductor.yaml"], tmp);
  cli(["loop-scope", "run", "first", "second"], tmp);
  const r = cli(["loop", "run", "first", "work", "running"], tmp);
  assert(r.code === 0, `first iteration should be allowed:\n${r.out}`);
});

test("loop: parallel loop is EXEMPT from the order guard", () => {
  const tmp = withConductor(PARALLEL_LOOP);
  cli(["status-init", ".conductor/conductor.yaml"], tmp);
  cli(["loop-scope", "run", "first", "second", "third"], tmp);
  const r = cli(["loop", "run", "third", "work", "running"], tmp); // out of order, but parallel
  assert(r.code === 0, `parallel loop should allow out-of-order:\n${r.out}`);
});

test("loop: completing all sub-steps of an iteration bumps completed, partials don't", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/conductor.yaml"], tmp);
  cli(["loop-scope", "run", "a", "b"], tmp);
  cli(["loop", "run", "a", "work", "done"], tmp);
  assert(status(tmp).steps.run.completed === 1, "completed should be 1 after a finishes");
  // b only started, not done
  cli(["loop", "run", "b", "work", "running"], tmp);
  assert(status(tmp).steps.run.completed === 1, "partial iteration must not count as completed");
});

test("loop-scope: duplicate items are deduped so total == distinct iterations", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/conductor.yaml"], tmp);
  const r = cli(["loop-scope", "run", "a", "a", "b"], tmp);
  assert(/duplicate item/.test(r.out), `expected duplicate warning:\n${r.out}`);
  const st = status(tmp).steps.run;
  assert(st.total === 2, `total should be 2 (distinct), got ${st.total}`);
  assert(Object.keys(st.iterations).length === 2, "should hold 2 distinct iterations");
  assert(st.total === Object.keys(st.iterations).length, "total must equal iteration count (no wedge)");
});

test("loop-scope: re-scoping is additive and keeps total == iteration count", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/conductor.yaml"], tmp);
  cli(["loop-scope", "run", "a", "b", "c"], tmp);
  cli(["loop-scope", "run", "a", "b"], tmp); // re-scope with fewer
  const st = status(tmp).steps.run;
  assert(st.total === Object.keys(st.iterations).length, `total ${st.total} != iterations ${Object.keys(st.iterations).length}`);
});

test("loop: a typo'd (undeclared) sub-step warns and does NOT falsely complete the iteration", () => {
  const tmp = withConductor(LOOP); // declared sub-step is 'work'
  cli(["status-init", ".conductor/conductor.yaml"], tmp);
  cli(["loop-scope", "run", "a"], tmp);
  const r = cli(["loop", "run", "a", "phantom-sub", "done"], tmp); // typo — real 'work' never done
  assert(/not a declared sub-step/.test(r.out), `expected undeclared-sub warning:\n${r.out}`);
  const st = status(tmp).steps.run;
  assert(st.completed === 0, `phantom sub must NOT complete the iteration; completed=${st.completed}`);
  assert(st.status !== "done", "loop must not be marked done off a phantom sub");
});

test("loop: completion is judged on declared sub-steps (real sub done → counts)", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/conductor.yaml"], tmp);
  cli(["loop-scope", "run", "a"], tmp);
  cli(["loop", "run", "a", "work", "done"], tmp); // the real declared sub
  const st = status(tmp).steps.run;
  assert(st.completed === 1, `real sub done should complete iteration; completed=${st.completed}`);
});

// ── KNOWLEDGE / suggest ───────────────────────────────────────────────────────
test("suggest: writes a learning into the conductor's knowledge store", () => {
  const tmp = withConductor(LINEAR);
  const r = cli(["suggest", "Cache the price list", "--scope", "this-conductor"], tmp);
  assert(r.code === 0, `suggest should succeed:\n${r.out}`);
  const doc = fs.readFileSync(path.join(tmp, ".conductor", "conductor.yaml"), "utf8");
  assert(/knowledge:/.test(doc) && /Cache the price list/.test(doc), "knowledge not written to conductor");
});

test("suggest: --scope is required", () => {
  const tmp = withConductor(LINEAR);
  const r = cli(["suggest", "no scope here"], tmp);
  assert(r.code !== 0, "suggest should fail without --scope");
  assert(/scope is required/.test(r.out), `expected scope-required error:\n${r.out}`);
});

test("suggest: an invalid --scope is rejected", () => {
  const tmp = withConductor(LINEAR);
  const r = cli(["suggest", "x", "--scope", "galaxy"], tmp);
  assert(r.code !== 0, "invalid scope should fail");
  assert(/--scope must be one of/.test(r.out), `expected scope-enum error:\n${r.out}`);
});

test("knowledge --min: fails under the threshold, passes at/over it", () => {
  const tmp = withConductor(LINEAR);
  const r0 = cli(["knowledge", "--min", "1"], tmp);
  assert(r0.code !== 0, "knowledge --min 1 should fail with empty store");
  cli(["suggest", "Learned a thing", "--scope", "this-conductor"], tmp);
  const r1 = cli(["knowledge", "--min", "1"], tmp);
  assert(r1.code === 0, `knowledge --min 1 should pass after one suggest:\n${r1.out}`);
});

test("knowledge --min-scopes: enforces cross-cutting coverage across scopes", () => {
  const tmp = withConductor(LINEAR);
  cli(["suggest", "A", "--scope", "this-conductor"], tmp);
  const r1 = cli(["knowledge", "--min", "1", "--min-scopes", "2"], tmp);
  assert(r1.code !== 0, "one scope should fail --min-scopes 2");
  cli(["suggest", "B", "--scope", "tooling"], tmp);
  const r2 = cli(["knowledge", "--min", "2", "--min-scopes", "2"], tmp);
  assert(r2.code === 0, `two scopes should pass --min-scopes 2:\n${r2.out}`);
});

// ── unknown command ───────────────────────────────────────────────────────────
test("cli: an unknown command errors with a non-zero exit", () => {
  const tmp = tmpdir();
  const r = cli(["frobnicate"], tmp);
  assert(r.code !== 0, "unknown command should fail");
  assert(/Unknown command/.test(r.out), `expected unknown-command error:\n${r.out}`);
});

// ── REAL-WORLD CAPSTONE: a full run, init → finish ────────────────────────────
test("lifecycle: init → validate → status-init → run a step under board-sync → complete", () => {
  const tmp = tmpdir();
  // 1) scaffold + replace with a real 2-step conductor (one soft, one hard gate)
  assert(cli(["init", "--name", "release", "--steps", "2"], tmp).code === 0, "init failed");
  const real = `conductor: 2.0.0
name: release
description: Ship a release safely.
steps:
  - id: prepare
    instruction: Prepare the release notes.
    gate:
      - "notes drafted"
  - id: publish
    instruction: Publish.
    requires: [prepare]
    gate:
      - check: "true"
        name: published
`;
  fs.writeFileSync(path.join(tmp, ".conductor", "conductor.yaml"), real);
  // 2) validate
  assert(cli(["validate", ".conductor/conductor.yaml"], tmp).code === 0, "validate failed");
  // 3) status-init
  assert(cli(["status-init", ".conductor/conductor.yaml"], tmp).code === 0, "status-init failed");
  // 4) drive 'prepare' with a live board-sync gate, attest its soft gate
  cli(["step", "prepare", "running"], tmp);
  cli(["heartbeat", "prepare", "drafting notes"], tmp);
  assert(cli(["check", "prepare"], tmp).code === 0, "board-sync check should pass mid-step");
  assert(cli(["complete", "prepare", "--attest-soft"], tmp).code === 0, "prepare complete failed");
  // 5) drive 'publish' with a verified hard gate
  cli(["step", "publish", "running"], tmp);
  cli(["heartbeat", "publish", "publishing"], tmp);
  assert(cli(["complete", "publish"], tmp).code === 0, "publish complete failed");
  // 6) both steps done
  const s = status(tmp);
  assert(s.steps.prepare.status === "done" && s.steps.publish.status === "done", "not all steps done");
});

// ── runner ────────────────────────────────────────────────────────────────────
const results = [];
for (const { name, fn } of scenarios) {
  const tmpBefore = fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith("feat-smoke-"));
  try {
    fn();
    results.push({ name, pass: true, detail: "" });
  } catch (e) {
    results.push({ name, pass: false, detail: (e instanceof Error ? e.message : String(e)).split("\n").slice(0, 4).join("  ↩ ") });
  }
  // best-effort cleanup of any temp dirs this scenario created
  for (const d of fs.readdirSync(os.tmpdir()).filter((x) => x.startsWith("feat-smoke-") && !tmpBefore.includes(x))) {
    try { fs.rmSync(path.join(os.tmpdir(), d), { recursive: true, force: true }); } catch {}
  }
}

console.log(bold(`\n  Conductor feature smoke — ${results.length} real-world scenarios through the live CLI\n`));
const nameW = Math.min(78, Math.max(...results.map((r) => r.name.length)));
for (const r of results) {
  const tag = r.pass ? green("PASS") : red("FAIL");
  console.log(`  ${tag}  ${r.name.padEnd(nameW)}${r.pass ? "" : "\n        " + amber(r.detail)}`);
}
const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log("");
console.log(`  ${bold("Summary:")} ${green(`${passed} passed`)}${failed ? `, ${red(`${failed} failed`)}` : ""} / ${results.length}`);
console.log("");
process.exit(failed ? 1 : 0);
