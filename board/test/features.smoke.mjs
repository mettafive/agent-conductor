/**
 * Feature smoke test — every MAIN conductor feature through the REAL CLI.
 *
 * Where loops.smoke.ts goes deep on one feature (loop rendering), this goes WIDE:
 * 50+ real-world scenarios a future user will actually hit, each invoking
 * `node bin/cli.js …` exactly as a user/agent would and asserting on the real
 * exit code + stdout/stderr + the on-disk status.json / workflow.json.
 *
 * Coverage map (feature → scenarios):
 *   init        scaffold, flags, clamp, --force refuse/overwrite, generated-json-validates
 *   validate    every VALID shape (linear/loop/parallel/DAG) +
 *               every INVALID path the validator can emit (16 distinct rules)
 *   status-init linear, run-id, goal, auto_improve off, Phase-0 injection, loop type
 *   step/gate   running/done/failed transitions, current_step, gate states, errors
 *   heartbeat   append, insight tags, finalBeat handoff, loop-sub bubble, errors
 *   check       independent instruction checker prompt
 *   complete    checker pass/fail, retry loop, circuit breaker, loop-coverage guard, sub-step
 *   loop        loop-scope frontload, multiword guard, sequential guard, parallel exempt
 *   knowledge   suggest (+scope validation), --min gate, --min-scopes gate
 *   cards       card-design artifact validation: required fields, ids, forbidden fields
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
  const r = spawnSync("node", [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env },
  });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function tmpdir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "feat-smoke-"));
  fs.mkdirSync(path.join(d, ".conductor"), { recursive: true });
  return d;
}
/** Write a workflow.json into <tmp>/.conductor and return tmp. */
function withConductor(jsonStr) {
  const tmp = tmpdir();
  fs.writeFileSync(path.join(tmp, ".conductor", "workflow.json"), jsonStr);
  return tmp;
}
const status = (tmp) => JSON.parse(fs.readFileSync(path.join(tmp, ".conductor", "status.json"), "utf8"));
const writeFile = (tmp, rel, body) => {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
};
function slugTitle(title) {
  return String(title || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "card";
}
function receiptName(tmp, id) {
  const workflow = JSON.parse(fs.readFileSync(path.join(tmp, ".conductor", "workflow.json"), "utf8"));
  const step = (workflow.steps || [])[Number(id)] || (workflow.steps || []).find((s) => s && s.id === id);
  return `${String(id).replace(/[^a-zA-Z0-9._-]+/g, "__")}-${slugTitle(step?.title)}.md`;
}
const writeArtifact = (tmp, id, body = "Artifact output.") =>
  writeFile(tmp, path.join(".conductor", "artifacts", receiptName(tmp, id)), body);
const writeOutput = (tmp, rel, body) =>
  writeFile(tmp, path.join(".conductor", "artifacts", rel), body);
const withDecomposeFixtures = (tmp, files, fn) => {
  const dir = path.join(tmp, "model-fixtures");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(body, null, 2));
  }
  const prev = process.env.CONDUCTOR_DECOMPOSE_FIXTURES;
  process.env.CONDUCTOR_DECOMPOSE_FIXTURES = dir;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.CONDUCTOR_DECOMPOSE_FIXTURES;
    else process.env.CONDUCTOR_DECOMPOSE_FIXTURES = prev;
  }
};

// ── reusable conductor fixtures ─────────────────────────────────────────────
const LINEAR = `{
  "conductor": "3.0.0",
  "name": "linear-flow",
  "description": "A simple three-step linear workflow.",
  "steps": [
    {
      "id": "gather",
      "title": "Gather",
      "instruction": "Gather the inputs.",
      "requires": []
    },
    {
      "id": "build",
      "title": "Build",
      "instruction": "Build the thing.",
      "requires": [
        "gather"
      ]
    },
    {
      "id": "ship",
      "title": "Ship",
      "instruction": "Ship it.",
      "requires": [
        "build"
      ]
    }
  ]
}`;

const LOOP = `{
  "conductor": "3.0.0",
  "name": "loop-flow",
  "description": "A loop over items.",
  "steps": [
    {
      "id": "run",
      "title": "Run",
      "instruction": "Run work over items.",
      "type": "loop",
      "over": "items",
      "as": "item",
      "requires": [],
      "steps": [
        {
          "id": "work",
          "title": "Work",
          "instruction": "Do work for {item}.",
          "requires": []
        }
      ]
    }
  ]
}`;

const json = (doc) => JSON.stringify(doc, null, 2);
const mutateDoc = (src, fn) => {
  const doc = JSON.parse(src);
  fn(doc);
  return json(doc);
};
const stepCount = (src) => JSON.parse(src).steps.length;

const PARALLEL_LOOP = mutateDoc(LOOP, (doc) => {
  doc.steps[0].parallel = true;
});

// ── scenarios ────────────────────────────────────────────────────────────────
const scenarios = [];
const test = (name, fn) => scenarios.push({ name, fn });

// helper: validate-only assertions
function expectValid(jsonStr) {
  const tmp = tmpdir();
  const p = writeFile(tmp, "c.json", jsonStr);
  const r = cli(["validate", p], tmp);
  fs.rmSync(tmp, { recursive: true, force: true });
  assert(r.code === 0, `expected valid (exit 0), got exit ${r.code}:\n${r.out}`);
  assert(/is valid/.test(r.out), `expected "is valid" in output:\n${r.out}`);
}
function expectInvalid(jsonStr, substr) {
  const tmp = tmpdir();
  const p = writeFile(tmp, "c.json", jsonStr);
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
  const f = path.join(tmp, ".conductor", "workflow.json");
  assert(fs.existsSync(f), "workflow.json not created");
  const body = fs.readFileSync(f, "utf8");
  assert(stepCount(body) === 4, `expected 4 steps, got:\n${body}`);
  const v = cli(["validate", f], tmp);
  assert(v.code === 0, `scaffolded conductor did not validate:\n${v.out}`);
});

test("init: --steps 1 produces a single-step conductor", () => {
  const tmp = tmpdir();
  const r = cli(["init", "--name", "one", "--steps", "1"], tmp);
  assert(r.code === 0, r.out);
  const body = fs.readFileSync(path.join(tmp, ".conductor", "workflow.json"), "utf8");
  assert(stepCount(body) === 1, `expected 1 step:\n${body}`);
});

test("init: --steps 99 clamps to 50", () => {
  const tmp = tmpdir();
  cli(["init", "--name", "big", "--steps", "99"], tmp);
  const body = fs.readFileSync(path.join(tmp, ".conductor", "workflow.json"), "utf8");
  assert(stepCount(body) === 50, "expected clamp to 50 steps");
});

test("init: --steps 0 falls back to the 3-step default", () => {
  const tmp = tmpdir();
  cli(["init", "--name", "zero", "--steps", "0"], tmp);
  const body = fs.readFileSync(path.join(tmp, ".conductor", "workflow.json"), "utf8");
  assert(stepCount(body) === 3, "expected fallback to 3 steps");
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
  const body = fs.readFileSync(path.join(tmp, ".conductor", "workflow.json"), "utf8");
  assert(stepCount(body) === 5, "overwrite should reflect new --steps");
});

// ── VALIDATE: valid shapes ────────────────────────────────────────────────────
test("validate: linear 3-step conductor is valid", () => expectValid(LINEAR));
test("validate: loop conductor is valid", () => expectValid(LOOP));
test("validate: parallel loop (parallel: true) is valid", () => expectValid(PARALLEL_LOOP));
test("validate: parallel: auto is valid", () =>
  expectValid(mutateDoc(LOOP, (doc) => {
    doc.steps[0].parallel = "auto";
  })));
test("validate: acyclic requires DAG is valid", () =>
  expectValid(`{
  "conductor": "3.0.0",
  "name": "dag",
  "description": "dag.",
  "steps": [
    {
      "id": "a",
      "title": "A",
      "instruction": "A.",
      "requires": []
    },
    {
      "id": "b",
      "title": "B",
      "instruction": "B.",
      "requires": [
        "a"
      ]
    },
    {
      "id": "c",
      "title": "C",
      "instruction": "C.",
      "requires": [
        "a",
        "b"
      ]
    }
  ]
}`));
test("validate: summary reports steps without gate counts", () => {
  const tmp = tmpdir();
  const p = writeFile(tmp, "c.json", LINEAR);
  const r = cli(["validate", p], tmp);
  assert(r.code === 0, r.out);
  assert(/3 steps/.test(r.out), `expected steps counted:\n${r.out}`);
  assert(!/gates|soft|hard/.test(r.out), `expected no explicit gate/soft/hard vocabulary:\n${r.out}`);
});

// ── VALIDATE: invalid paths (one rule each) ───────────────────────────────────
test("validate: missing top-level name is rejected", () =>
  expectInvalid(`{
  "conductor": "2.0.0",
  "description": "no name.",
  "steps": [
    {
      "id": "a",
      "instruction": "A."
    }
  ]
}`, 'Missing required top-level key "name"'));

test("validate: missing conductor version is rejected", () =>
  expectInvalid(json({
    name: "x",
    description: "y.",
    steps: [{ id: "a", title: "A", instruction: "A.", requires: [] }],
  }), 'Missing required top-level key "conductor"'));

test("validate: non-semver conductor version is rejected", () =>
  expectInvalid(`{
  "conductor": "2.0",
  "name": "x",
  "description": "y.",
  "steps": [
    {
      "id": "a",
      "instruction": "A."
    }
  ]
}`, "semver"));

test("validate: duplicate step id is rejected", () =>
  expectInvalid(`{
  "conductor": "2.0.0",
  "name": "dup",
  "description": "d.",
  "steps": [
    {
      "id": "a",
      "instruction": "A."
    },
    {
      "id": "a",
      "instruction": "A2."
    }
  ]
}`, 'Duplicate step id "a"'));

test("validate: step with no instruction is rejected", () =>
  expectInvalid(`{
  "conductor": "3.0.0",
  "name": "noinst",
  "description": "d.",
  "steps": [
    {
      "id": "a",
      "gate": {
        "command": "true"
      }
    }
  ]
}`, "no instruction"));

test("validate: explicit gate field is rejected", () =>
  expectInvalid(`{
  "conductor": "2.0.0",
  "name": "badgate",
  "description": "d.",
  "steps": [
    {
      "id": "a",
      "title": "A",
      "instruction": "A.",
      "requires": [],
      "gate": {
        "command": "true"
      }
    }
  ]
}`, 'uses removed field "gate"'));

test("validate: removed condition type is rejected", () =>
  expectInvalid(`{
  "conductor": "2.0.0",
  "name": "c",
  "description": "d.",
  "steps": [
    {
      "id": "a",
      "type": "condition",
      "instruction": "A.",
      "if_false": "b"
    },
    {
      "id": "b",
      "instruction": "B."
    }
  ]
}`, 'uses removed type "condition"'));

test("validate: removed branch fields are rejected", () =>
  expectInvalid(`{
  "conductor": "2.0.0",
  "name": "c",
  "description": "d.",
  "steps": [
    {
      "id": "a",
      "instruction": "A.",
      "if_true": "b"
    },
    {
      "id": "b",
      "instruction": "B."
    }
  ]
}`, 'uses removed field "if_true"'));

test("validate: loop missing 'over' is rejected", () =>
  expectInvalid(`{
  "conductor": "2.0.0",
  "name": "l",
  "description": "d.",
  "steps": [
    {
      "id": "a",
      "type": "loop",
      "as": "item",
      "steps": [
        {
          "id": "w",
          "instruction": "W."
        }
      ]
    }
  ]
}`, 'missing "over"'));

test("validate: loop missing 'as' is rejected", () =>
  expectInvalid(`{
  "conductor": "2.0.0",
  "name": "l",
  "description": "d.",
  "steps": [
    {
      "id": "a",
      "type": "loop",
      "over": "items",
      "steps": [
        {
          "id": "w",
          "instruction": "W."
        }
      ]
    }
  ]
}`, 'missing "as"'));

test("validate: loop with no sub-steps is rejected", () =>
  expectInvalid(`{
  "conductor": "2.0.0",
  "name": "l",
  "description": "d.",
  "steps": [
    {
      "id": "a",
      "type": "loop",
      "over": "items",
      "as": "item",
      "steps": []
    }
  ]
}`, "no sub-steps"));

test("validate: loop sub-step missing instruction is rejected", () =>
  expectInvalid(`{
  "conductor": "3.0.0",
  "name": "l",
  "description": "d.",
  "steps": [
    {
      "id": "a",
      "type": "loop",
      "over": "items",
      "as": "item",
      "steps": [
        {
          "id": "w",
          "gate": {
            "command": "true"
          }
        }
      ]
    }
  ]
}`, "no instruction"));

test("validate: loop with invalid 'parallel' value is rejected", () =>
  expectInvalid(`{
  "conductor": "2.0.0",
  "name": "l",
  "description": "d.",
  "steps": [
    {
      "id": "a",
      "type": "loop",
      "over": "items",
      "as": "item",
      "parallel": "sometimes",
      "steps": [
        {
          "id": "w",
          "instruction": "W."
        }
      ]
    }
  ]
}`, 'invalid "parallel"'));

test("validate: removed approval step type is rejected", () =>
  expectInvalid(`{
  "conductor": "3.0.0",
  "name": "a",
  "description": "d.",
  "steps": [
    {
      "id": "r",
      "type": "approval"
    }
  ]
}`, 'uses removed type "approval"'));

test("validate: removed 'then' field is rejected", () =>
  expectInvalid(`{
  "conductor": "2.0.0",
  "name": "a",
  "description": "d.",
  "steps": [
    {
      "id": "a",
      "instruction": "A.",
      "then": "nowhere"
    }
  ]
}`, 'uses removed field "then"'));

test("validate: unknown 'requires' target is rejected", () =>
  expectInvalid(`{
  "conductor": "2.0.0",
  "name": "a",
  "description": "d.",
  "steps": [
    {
      "id": "a",
      "instruction": "A.",
      "requires": [
        "ghost"
      ]
    }
  ]
}`, 'unknown step "ghost"'));

test("validate: circular requires dependency is rejected", () =>
  expectInvalid(`{
  "conductor": "2.0.0",
  "name": "cyc",
  "description": "d.",
  "steps": [
    {
      "id": "a",
      "instruction": "A.",
      "requires": [
        "b"
      ]
    },
    {
      "id": "b",
      "instruction": "B.",
      "requires": [
        "a"
      ]
    }
  ]
}`, "Circular dependency"));

test("validate: empty file is rejected", () => {
  const tmp = tmpdir();
  const p = writeFile(tmp, "c.json", "");
  const r = cli(["validate", p], tmp);
  assert(r.code !== 0, "empty file should be invalid");
});

test("validate: unparseable JSON is rejected with a parse error", () =>
  expectInvalid(`name: "[unclosed
  bad: : :`, "parse"));

test("validate: nonexistent file path errors clearly", () => {
  const tmp = tmpdir();
  const r = cli(["validate", path.join(tmp, "nope.json")], tmp);
  assert(r.code !== 0, "missing file should error");
  assert(/No workflow file/.test(r.out), `expected "No workflow file":\n${r.out}`);
});

// ── STATUS-INIT ───────────────────────────────────────────────────────────────
test("status-init: linear conductor → all steps pending, running, goal carried", () => {
  const tmp = withConductor(LINEAR);
  const r = cli(["status-init", ".conductor/workflow.json"], tmp);
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
  cli(["status-init", ".conductor/workflow.json", "--run-id", "RUN-XYZ"], tmp);
  assert(status(tmp).run_id === "RUN-XYZ", "custom run_id not used");
});

test("status-init: run_name follows {slug}-run-N-{ts}", () => {
  const tmp = withConductor(LINEAR);
  cli(["status-init", ".conductor/workflow.json"], tmp);
  assert(/^linear-flow-run-1-/.test(status(tmp).run_name), `run_name format off: ${status(tmp).run_name}`);
});

test("status-init: auto_improve:false injects NO _improve cards even with proven knowledge", () => {
  const tmp = withConductor(`{
  "conductor": "3.0.0",
  "name": "ai-off",
  "description": "d.",
  "auto_improve": false,
  "knowledge": [
    {
      "title": "Always tag prices",
      "scope": "this-conductor",
      "status": "proven",
      "current": "untagged",
      "proposed": "tagged"
    }
  ],
  "steps": [
    {
      "id": "a",
      "instruction": "A."
    }
  ]
}`);
  cli(["status-init", ".conductor/workflow.json"], tmp);
  const ids = Object.keys(status(tmp).steps);
  assert(!ids.some((i) => i.startsWith("_improve")), `expected no _improve cards, got: ${ids.join(",")}`);
});

test("status-init: Phase-0 injects improvement cards only when explicitly enabled", () => {
  const tmp = withConductor(`{
  "conductor": "3.0.0",
  "name": "ai-on",
  "description": "d.",
  "auto_improve": true,
  "knowledge": [
    {
      "title": "Always tag prices",
      "scope": "this-conductor",
      "status": "proven",
      "current": "untagged",
      "proposed": "tagged"
    }
  ],
  "steps": [
    {
      "id": "a",
      "instruction": "A."
    }
  ]
}`);
  const r = cli(["status-init", ".conductor/workflow.json"], tmp);
  assert(/Phase 0 improvement/.test(r.out), `expected Phase 0 improvement note:\n${r.out}`);
  const ids = Object.keys(status(tmp).steps);
  assert(ids.includes("_improve::read-knowledge"), "missing _improve::read-knowledge");
  assert(ids.includes("_improve::validate"), "missing _improve::validate");
  assert(ids.some((i) => i.startsWith("_improve::always")), "missing the actionable improve card");
});

test("status-init: loop step registers with type 'loop' and an iterations map", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/workflow.json"], tmp);
  const st = status(tmp).steps.run;
  assert(st.type === "loop", `expected type loop, got ${st.type}`);
  assert(st.iterations && typeof st.iterations === "object", "missing iterations map");
  assert(st.total === 0 && st.completed === 0, "loop counters should start at 0");
});

test("init-board: initializes status, starts board, verifies health workflow", () => {
  const tmp = withConductor(LINEAR);
  const port = 39000 + Math.floor(Math.random() * 1000);
  const r = cli(["init-board", ".conductor/workflow.json", "--headless", "--port", String(port)], tmp);
  try {
    assert(r.code === 0, r.out);
    assert(/Board initialized and live: http:\/\/localhost:/.test(r.out), `expected board URL:\n${r.out}`);
    assert(/workflow: linear-flow/.test(r.out), `expected workflow name:\n${r.out}`);
    assert(fs.existsSync(path.join(tmp, ".conductor", "status.json")), "status.json not initialized");
    const server = JSON.parse(fs.readFileSync(path.join(tmp, ".conductor", "server.json"), "utf8"));
    assert(server.pid && server.url, "server.json missing pid/url");
  } finally {
    cli(["stop"], tmp);
  }
});

// ── STEP / GATE ───────────────────────────────────────────────────────────────
function initLinear() {
  const tmp = withConductor(LINEAR);
  cli(["status-init", ".conductor/workflow.json"], tmp);
  return tmp;
}

test("step running: sets current_step, started_at, and pending gate", () => {
  const tmp = initLinear();
  const r = cli(["step", "gather", "running", "--goal", "do the thing", "--headless"], tmp);
  assert(r.code === 0, r.out);
  const s = status(tmp);
  assert(s.current_step === "gather", "current_step not set");
  assert(s.steps.gather.started_at, "started_at not set");
  assert(s.steps.gather.gate === "pending", `gate should be pending, got ${s.steps.gather.gate}`);
  assert(s.current_step_goal === "do the thing", "current_step_goal not set");
});

test("step done: sets completed_at and passes the gate", () => {
  const tmp = initLinear();
  cli(["step", "gather", "running", "--headless"], tmp);
  cli(["step", "gather", "done"], tmp);
  const s = status(tmp);
  assert(s.steps.gather.status === "done", "status not done");
  assert(s.steps.gather.gate === "passed", `gate should be passed, got ${s.steps.gather.gate}`);
  assert(s.steps.gather.completed_at, "completed_at not set");
});

test("step failed: marks the gate failed", () => {
  const tmp = initLinear();
  cli(["step", "build", "running", "--headless"], tmp);
  cli(["step", "build", "failed"], tmp);
  assert(status(tmp).steps.build.gate === "failed", "gate should be failed");
});

test("step: errors when status.json is missing (no status-init)", () => {
  const tmp = withConductor(LINEAR); // no status-init
  const r = cli(["step", "gather", "running", "--headless"], tmp);
  assert(r.code !== 0, "step should fail without status.json");
  assert(/status-init/.test(r.out), `expected hint to run status-init:\n${r.out}`);
});

test("gate: transitions a known step's gate state", () => {
  const tmp = initLinear();
  cli(["step", "gather", "running", "--headless"], tmp);
  cli(["gate", "gather", "checking"], tmp);
  assert(status(tmp).steps.gather.gate === "checking", "gate not set to checking");
});

test("gate: errors on an unknown step id", () => {
  const tmp = initLinear();
  const r = cli(["gate", "ghost", "passed"], tmp);
  assert(r.code !== 0, "gate on unknown step should fail");
  assert(/no (step|card index) "ghost"/.test(r.out), `expected unknown-card error:\n${r.out}`);
});

// ── HEARTBEAT ─────────────────────────────────────────────────────────────────
test("heartbeat: appends a beat to the step", () => {
  const tmp = initLinear();
  cli(["step", "gather", "running", "--headless"], tmp);
  const r = cli(["heartbeat", "gather", "scanning inputs"], tmp);
  assert(r.code === 0, r.out);
  const beats = status(tmp).steps.gather.heartbeat;
  const auto = beats.find((b) => b.note === "Started: Gather");
  const manual = beats.find((b) => b.note === "scanning inputs");
  assert(Array.isArray(beats) && auto, "auto start beat not appended");
  assert(auto.system === true, "auto start beat should be tagged system:true");
  assert(manual, "manual beat not appended");
  assert(manual.system !== true, "manual agent beat should not be tagged system:true");
});

test("heartbeat: --insight-type attaches a structured insight", () => {
  const tmp = initLinear();
  cli(["step", "gather", "running", "--headless"], tmp);
  cli(["heartbeat", "gather", "found a gap", "--insight-type", "missing_instruction", "--insight-seed", "spec gap"], tmp);
  const b = status(tmp).steps.gather.heartbeat.find((beat) => beat.note === "found a gap");
  assert(b.insight && b.insight.type === "missing_instruction", "insight type not captured");
  assert(b.insight.seed === "spec gap", "insight seed not captured");
});

test("heartbeat: --final --to records a finalBeat handoff", () => {
  const tmp = initLinear();
  cli(["step", "gather", "running", "--headless"], tmp);
  cli(["heartbeat", "gather", "done; handing off", "--final", "--to", "build"], tmp);
  const b = status(tmp).steps.gather.heartbeat.find((beat) => beat.note === "done; handing off");
  assert(b.finalBeat === true, "finalBeat flag not set");
  assert(b.handoff && b.handoff.to === "build", "handoff target not set");
});

test("heartbeat: --handoff records agent context without system tag", () => {
  const tmp = initLinear();
  cli(["step", "gather", "running", "--headless"], tmp);
  cli(["heartbeat", "gather", "Handing off: inputs gathered. Next: build.", "--handoff"], tmp);
  const b = status(tmp).steps.gather.heartbeat.find((beat) => beat.note.startsWith("Handing off:"));
  assert(b.finalBeat === true, "handoff should set finalBeat");
  assert(b.handoff && b.handoff.context === "Handing off: inputs gathered. Next: build.", "handoff context not captured");
  assert(b.system !== true, "agent handoff should not be tagged system:true");
});

test("heartbeat: loop sub-step beat bubbles to the loop parent tagged iter+sub", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/workflow.json"], tmp);
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

// ── CHECK (independent instruction checker) ───────────────────────────────────
test("check: prints the instruction/output comparison prompt when output is recorded", () => {
  const tmp = initLinear();
  cli(["step", "gather", "running", "--headless"], tmp);
  const r = cli(["check", "gather", "--output", "Gathered source notes."], tmp);
  assert(r.code === 0, `check should print a prompt with output:\n${r.out}`);
  assert(/The agent was asked: Gather the inputs\./.test(r.out), `expected instruction in prompt:\n${r.out}`);
  assert(/Here is what was produced:/.test(r.out), `expected output header in prompt:\n${r.out}`);
  assert(/Gathered source notes/.test(r.out), `expected output in prompt:\n${r.out}`);
  assert(/SUMMARY:/.test(r.out), `expected dashboard summary instruction:\n${r.out}`);
  assert(!status(tmp).steps.gather.gate_detail, "check should not record a passing verdict");
});

test("check: fails when no output is recorded", () => {
  const tmp = initLinear();
  cli(["step", "gather", "running", "--headless"], tmp);
  const r = cli(["check", "gather"], tmp);
  assert(r.code !== 0, "check should fail with no output");
  assert(/no output was produced/.test(r.out), `expected no-output error:\n${r.out}`);
  assert(status(tmp).steps.gather.gate_detail[0].passed === false, "failed checker result not recorded");
  assert(status(tmp).steps.gather.gate_detail[0].summary === "No output was produced.", "no-output summary not recorded");
});

test("check: reads output from a file", () => {
  const tmp = initLinear();
  const file = writeFile(tmp, "artifact.md", "Built artifact.");
  const r = cli(["check", "build", "--output-file", file], tmp);
  assert(r.code === 0, `check should print prompt from output file:\n${r.out}`);
  assert(/artifact.md/.test(r.out), `expected output file source:\n${r.out}`);
  assert(/Built artifact/.test(r.out), `expected output file content:\n${r.out}`);
});

test("check: fails on an unknown step id", () => {
  const tmp = initLinear();
  const r = cli(["check", "ghost"], tmp);
  assert(r.code !== 0, "check should fail on unknown step");
  assert(/no card index "ghost"/.test(r.out), `expected unknown-step error:\n${r.out}`);
});

test("order enforcement: blocked cards cannot start or check before dependencies are done", () => {
  const tmp = withConductor(`{
  "conductor": "3.0.0",
  "name": "ordered",
  "description": "d.",
  "steps": [
    {
      "title": "Research",
      "instruction": "Research and produce notes.",
      "requires": []
    },
    {
      "title": "Draft",
      "instruction": "Draft from the notes.",
      "requires": [0]
    }
  ]
}`);
  cli(["status-init", ".conductor/workflow.json"], tmp);
  const start = cli(["step", "1", "running", "--headless"], tmp);
  assert(start.code !== 0, `blocked card should not start:\n${start.out}`);
  assert(/waiting for: 0 "Research"/.test(start.out), `expected blocker title:\n${start.out}`);
  const check = cli(["check", "1", "--output", "Drafted"], tmp);
  assert(check.code !== 0, `blocked card should not check:\n${check.out}`);
  assert(/blocked/.test(check.out), `expected blocked check:\n${check.out}`);

  cli(["step", "0", "running", "--headless"], tmp);
  writeArtifact(tmp, "0", "Research notes exist.");
  cli(["gate-result", "0", "--passed", "--evidence", "PASS\nSUMMARY: Notes exist."], tmp);
  const done = cli(["complete", "0"], tmp);
  assert(done.code === 0, done.out);
  const retry = cli(["step", "1", "running", "--headless"], tmp);
  assert(retry.code === 0, `unblocked card should start:\n${retry.out}`);
});

// ── COMPLETE ──────────────────────────────────────────────────────────────────
test("complete: a passing checker result advances the step to done", () => {
  const tmp = initLinear();
  writeArtifact(tmp, "ship", "Shipping artifact.");
  cli(["gate-result", "ship", "--passed", "--evidence", "output satisfies the instruction"], tmp);
  const r = cli(["complete", "ship"], tmp);
  assert(r.code === 0, `complete should pass on checker result:\n${r.out}`);
  assert(/Checker passed/.test(r.out), `expected pass message:\n${r.out}`);
  assert(status(tmp).steps.ship.status === "done", "ship not marked done");
  assert(status(tmp).steps.ship.artifacts.includes("ship-ship.md"), "artifact path not recorded on completion");
});

test("complete: a passing checker result without an artifact is rejected", () => {
  const tmp = initLinear();
  cli(["gate-result", "ship", "--passed", "--evidence", "output satisfies the instruction"], tmp);
  const r = cli(["complete", "ship"], tmp);
  assert(r.code !== 0, "complete should reject a pass without an artifact");
  assert(/no artifact found/.test(r.out), `expected artifact requirement:\n${r.out}`);
  assert(status(tmp).steps.ship.status !== "done", "ship should not be marked done without artifact");
});

test("complete: an action artifact can satisfy a non-content card", () => {
  const tmp = initLinear();
  writeArtifact(tmp, "ship", [
    "# Ship artifact",
    "Command: ./deploy.sh --target staging",
    "Return: deployment url https://example.test/build/123",
    "Changed resource: staging deployment build 123",
    "Verification: curl -I https://example.test/build/123 returned 200",
  ].join("\n"));
  cli(["gate-result", "ship", "--passed", "--evidence", "PASS\nSUMMARY: Deployment artifact proves command, return value, changed resource, and verification."], tmp);
  const r = cli(["complete", "ship"], tmp);
  assert(r.code === 0, `artifact-backed action should complete:\n${r.out}`);
  assert(status(tmp).steps.ship.artifact === "ship-ship.md", "artifact path not recorded");
});

test("complete: situational no-action artifact can pass", () => {
  const tmp = withConductor(`{
  "conductor": "3.0.0",
  "name": "situational-noop",
  "description": "d.",
  "steps": [
    {
      "title": "Check Repair Need",
      "instruction": "Check whether the prior gate failed. If it failed, repair the artifact. If it passed, write an artifact documenting that no repair was needed, including the passing gate evidence.",
      "requires": []
    }
  ]
}`);
  cli(["status-init", ".conductor/workflow.json"], tmp);
  cli(["step", "0", "running", "--headless"], tmp);
  writeArtifact(tmp, "0", [
    "# Check Repair Need",
    "Condition checked: prior gate result was PASS.",
    "Evidence: .conductor/status.json gate_detail for the prior card recorded passed=true.",
    "Action: no repair needed because the condition was not met.",
  ].join("\n"));
  cli(["gate-result", "0", "--passed", "--evidence", "PASS\nSUMMARY: The artifact proves the gate passed and no repair was needed."], tmp);
  const r = cli(["complete", "0"], tmp);
  assert(r.code === 0, `situational no-op should complete:\n${r.out}`);
  assert(status(tmp).steps["0"].status === "done", "situational no-op not marked done");
});

test("complete: situational action artifact can pass", () => {
  const tmp = withConductor(`{
  "conductor": "3.0.0",
  "name": "situational-action",
  "description": "d.",
  "steps": [
    {
      "title": "Check Repair Need",
      "instruction": "Check whether the prior gate failed. If it failed, repair the artifact and rerun the gate. If it passed, write an artifact documenting that no repair was needed.",
      "requires": []
    }
  ]
}`);
  cli(["status-init", ".conductor/workflow.json"], tmp);
  cli(["step", "0", "running", "--headless"], tmp);
  writeArtifact(tmp, "0", [
    "# Check Repair Need",
    "Condition checked: prior gate result was FAIL.",
    "Evidence: checker reported missing source links.",
    "Action performed: added source links to the proposal artifact.",
    "Verification: reran gate and recorded PASS.",
  ].join("\n"));
  cli(["gate-result", "0", "--passed", "--evidence", "PASS\nSUMMARY: The artifact proves the failure was checked, repaired, and reverified."], tmp);
  const r = cli(["complete", "0"], tmp);
  assert(r.code === 0, `situational action should complete:\n${r.out}`);
  assert(status(tmp).steps["0"].status === "done", "situational action not marked done");
});

test("complete: binary support requires markdown receipt", () => {
  const tmp = initLinear();
  writeArtifact(tmp, "ship", [
    "# Screenshot receipt",
    "Screenshot: .conductor/artifacts/ship.png",
    "Verification: image exists.",
  ].join("\n"));
  writeOutput(tmp, "ship.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  cli(["check", "ship", "--output-file", ".conductor/artifacts/ship.png"], tmp);
  cli(["gate-result", "ship", "--passed", "--evidence", "PASS\nSUMMARY: Image exists."], tmp);
  const r = cli(["complete", "ship"], tmp);
  assert(r.code === 0, `binary support should complete with receipt:\n${r.out}`);
  assert(status(tmp).steps.ship.artifact === "ship-ship.md", "markdown receipt path not recorded");
  assert(status(tmp).steps.ship.artifacts.includes("ship.png"), "supporting binary artifact not recorded");
});

test("complete: markdown receipt plus related binary records both", () => {
  const tmp = initLinear();
  writeArtifact(tmp, "ship", [
    "# Screenshot artifact",
    "URL: https://example.test",
    "Screenshot: .conductor/artifacts/ship.png",
    "Verification: screenshot shows the final page at desktop viewport.",
  ].join("\n"));
  writeOutput(tmp, "ship.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const check = cli(["check", "ship", "--output-file", ".conductor/artifacts/ship.png"], tmp);
  assert(check.code === 0, `check should record binary artifact support:\n${check.out}`);
  cli(["gate-result", "ship", "--passed", "--evidence", "PASS\nSUMMARY: Markdown receipt and image path are present."], tmp);
  const r = cli(["complete", "ship"], tmp);
  assert(r.code === 0, `markdown receipt plus binary should complete:\n${r.out}`);
  assert(status(tmp).steps.ship.artifact === "ship-ship.md", "artifact path not recorded");
  assert(status(tmp).steps.ship.artifacts.includes("ship.png"), "supporting binary artifact not recorded");
});

test("complete: a failing checker result does NOT advance the step", () => {
  const tmp = withConductor(`{
  "conductor": "3.0.0",
  "name": "checkerfail",
  "description": "d.",
  "steps": [
    {
      "id": "a",
      "title": "A",
      "instruction": "A.",
      "requires": []
    }
  ]
}`);
  cli(["status-init", ".conductor/workflow.json"], tmp);
  cli(["gate-result", "a", "--failed", "--evidence", "missing the requested artifact"], tmp);
  const r = cli(["complete", "a"], tmp);
  assert(r.code !== 0, "complete should fail on failing checker result");
  assert(/Checker failed/.test(r.out), `expected checker-failed message:\n${r.out}`);
  assert(status(tmp).steps.a.status !== "done", "step should not be done");
  assert(status(tmp).steps.a.attempt === 2, "attempt should increment after failed completion");
  assert(/missing the requested artifact/.test(status(tmp).steps.a.last_feedback), "feedback not stored");
});

test("complete: without a checker result is rejected", () => {
  const tmp = withConductor(`{
  "conductor": "3.0.0",
  "name": "checker",
  "description": "d.",
  "steps": [
    {
      "id": "review",
      "title": "Review",
      "instruction": "Review the output.",
      "requires": []
    }
  ]
}`);
  cli(["status-init", ".conductor/workflow.json"], tmp);
  const before = cli(["complete", "review"], tmp);
  assert(before.code !== 0 && /no checker result/.test(before.out), `expected missing checker result:\n${before.out}`);
});

test("gate-result: records checker verdict before complete", () => {
  const tmp = withConductor(`{
  "conductor": "3.0.0",
  "name": "checker",
  "description": "d.",
  "steps": [
    {
      "id": "review",
      "title": "Review",
      "instruction": "Review the output.",
      "requires": []
    }
  ]
}`);
  cli(["status-init", ".conductor/workflow.json"], tmp);
  writeArtifact(tmp, "review", "Review artifact.");
  const record = cli(["gate-result", "review", "--passed", "--evidence", "checked by independent agent"], tmp);
  assert(record.code === 0, `gate-result should pass:\n${record.out}`);
  const after = cli(["complete", "review"], tmp);
  assert(after.code === 0, `complete should consume checker result:\n${after.out}`);
  assert(status(tmp).steps.review.status === "done", "review not done");
});

test("gate-result: stores evidence separately from SUMMARY", () => {
  const tmp = withConductor(`{
  "conductor": "3.0.0",
  "name": "checker",
  "description": "d.",
  "steps": [
    {
      "id": "review",
      "title": "Review",
      "instruction": "Review the output.",
      "requires": []
    }
  ]
}`);
  cli(["status-init", ".conductor/workflow.json"], tmp);
  const evidence = "PASS The output covers every requested point.\nSUMMARY: Covered all requested points.";
  const record = cli(["gate-result", "review", "--passed", "--evidence", evidence], tmp);
  assert(record.code === 0, `gate-result should pass:\n${record.out}`);
  const detail = status(tmp).steps.review.gate_detail[0];
  assert(detail.evidence === "PASS The output covers every requested point.", `unexpected evidence:\n${detail.evidence}`);
  assert(detail.summary === "Covered all requested points.", `unexpected summary:\n${detail.summary}`);
});

test("gate-result: extracts SUMMARY when it follows PASS on the same line", () => {
  const tmp = withConductor(`{
  "conductor": "3.0.0",
  "name": "checker",
  "description": "d.",
  "steps": [
    {
      "id": "review",
      "title": "Review",
      "instruction": "Review the output.",
      "requires": []
    }
  ]
}`);
  cli(["status-init", ".conductor/workflow.json"], tmp);
  const evidence = "PASS. SUMMARY: Covered all requested points.";
  const record = cli(["gate-result", "review", "--passed", "--evidence", evidence], tmp);
  assert(record.code === 0, `gate-result should pass:\n${record.out}`);
  const detail = status(tmp).steps.review.gate_detail[0];
  assert(detail.evidence === "PASS.", `unexpected evidence:\n${detail.evidence}`);
  assert(detail.summary === "Covered all requested points.", `unexpected summary:\n${detail.summary}`);
  assert(detail.checked_summary === "Covered all requested points.", `unexpected checked summary:\n${detail.checked_summary}`);
});

test("feedback: returns latest failure and attempts remaining", () => {
  const tmp = initLinear();
  writeArtifact(tmp, "run", "Loop completion artifact.");
  cli(["gate-result", "gather", "--failed", "--evidence", "missing source notes"], tmp);
  cli(["complete", "gather"], tmp);
  const r = cli(["feedback", "gather"], tmp);
  assert(r.code === 0, `feedback should be available after failed completion:\n${r.out}`);
  assert(/Attempt 1\/5/.test(r.out), `expected attempt count:\n${r.out}`);
  assert(/missing source notes/.test(r.out), `expected failure reason:\n${r.out}`);
  assert(/attempts_remaining: 4/.test(r.out), `expected remaining attempts:\n${r.out}`);
});

test("feedback: escalates on third and fourth failures", () => {
  const tmp = initLinear();
  for (let i = 1; i <= 3; i++) {
    cli(["gate-result", "gather", "--failed", "--evidence", `issue ${i}`], tmp);
    cli(["complete", "gather"], tmp);
  }
  const third = cli(["feedback", "gather"], tmp);
  assert(/failed three times/.test(third.out), `expected third-attempt escalation:\n${third.out}`);
  cli(["gate-result", "gather", "--failed", "--evidence", "issue 4"], tmp);
  cli(["complete", "gather"], tmp);
  const fourth = cli(["feedback", "gather"], tmp);
  assert(/Final warning/.test(fourth.out), `expected fourth-attempt warning:\n${fourth.out}`);
});

test("complete: fifth failed checker result trips circuit breaker", () => {
  const tmp = initLinear();
  for (let i = 1; i <= 5; i++) {
    cli(["gate-result", "gather", "--failed", "--evidence", `issue ${i}`], tmp);
    cli(["complete", "gather"], tmp);
  }
  const s = status(tmp);
  assert(s.steps.gather.status === "failed", "step should fail after fifth failed attempt");
  assert(s.status === "failed", "run should fail after fifth failed attempt");
  const again = cli(["complete", "gather"], tmp);
  assert(again.code !== 0 && /exhausted/.test(again.out), `expected exhausted refusal:\n${again.out}`);
});

test("complete: loop-coverage guard blocks while an iteration is incomplete", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/workflow.json"], tmp);
  cli(["loop-scope", "run", "a", "b"], tmp);
  cli(["loop", "run", "a", "work", "done"], tmp); // a done, b untouched
  const r = cli(["complete", "run"], tmp);
  assert(r.code !== 0, "loop complete should be blocked by incomplete iteration b");
  assert(/incomplete iteration/.test(r.out), `expected incomplete-iteration block:\n${r.out}`);
});

test("complete: loop completes once every iteration is done", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/workflow.json"], tmp);
  cli(["loop-scope", "run", "a", "b"], tmp);
  cli(["loop", "run", "a", "work", "done"], tmp);
  cli(["loop", "run", "b", "work", "done"], tmp);
  writeArtifact(tmp, "run", "All scoped loop iterations completed.");
  cli(["gate-result", "run", "--passed", "--evidence", "all scoped iterations are done"], tmp);
  const r = cli(["complete", "run"], tmp);
  assert(r.code === 0, `loop complete should pass once all iters done:\n${r.out}`);
});

// ── LOOP machinery ────────────────────────────────────────────────────────────
test("loop-scope: frontloads every item as an iteration and sets total", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/workflow.json"], tmp);
  const r = cli(["loop-scope", "run", "a", "b", "c"], tmp);
  assert(r.code === 0, r.out);
  const st = status(tmp).steps.run;
  assert(st.total === 3, `expected total 3, got ${st.total}`);
  assert(["a", "b", "c"].every((k) => k in st.iterations), "not all items frontloaded");
});

test("loop-scope: warns when one quoted item hides multiple tokens (still scopes 1)", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/workflow.json"], tmp);
  const r = cli(["loop-scope", "run", "a b c"], tmp);
  assert(/space-separated tokens/.test(r.out), `expected multiword warning:\n${r.out}`);
  assert(Object.keys(status(tmp).steps.run.iterations).length === 1, "should scope as ONE iteration");
});

test("loop: sequential loop refuses an out-of-order iteration", () => {
  const tmp = withConductor(LOOP); // no parallel → sequential
  cli(["status-init", ".conductor/workflow.json"], tmp);
  cli(["loop-scope", "run", "first", "second", "third"], tmp);
  const r = cli(["loop", "run", "second", "work", "running"], tmp); // skip 'first'
  assert(r.code !== 0, "sequential loop should refuse out-of-order start");
  assert(/sequential/.test(r.out), `expected sequential refusal:\n${r.out}`);
  assert(/finish 'first'/.test(r.out), `expected blocker hint:\n${r.out}`);
});

test("loop: sequential loop allows the genuine next-in-line iteration", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/workflow.json"], tmp);
  cli(["loop-scope", "run", "first", "second"], tmp);
  const r = cli(["loop", "run", "first", "work", "running"], tmp);
  assert(r.code === 0, `first iteration should be allowed:\n${r.out}`);
});

test("loop: parallel loop is EXEMPT from the order guard", () => {
  const tmp = withConductor(PARALLEL_LOOP);
  cli(["status-init", ".conductor/workflow.json"], tmp);
  cli(["loop-scope", "run", "first", "second", "third"], tmp);
  const r = cli(["loop", "run", "third", "work", "running"], tmp); // out of order, but parallel
  assert(r.code === 0, `parallel loop should allow out-of-order:\n${r.out}`);
});

test("loop: completing all sub-steps of an iteration bumps completed, partials don't", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/workflow.json"], tmp);
  cli(["loop-scope", "run", "a", "b"], tmp);
  cli(["loop", "run", "a", "work", "done"], tmp);
  assert(status(tmp).steps.run.completed === 1, "completed should be 1 after a finishes");
  // b only started, not done
  cli(["loop", "run", "b", "work", "running"], tmp);
  assert(status(tmp).steps.run.completed === 1, "partial iteration must not count as completed");
});

test("loop-scope: duplicate items are deduped so total == distinct iterations", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/workflow.json"], tmp);
  const r = cli(["loop-scope", "run", "a", "a", "b"], tmp);
  assert(/duplicate item/.test(r.out), `expected duplicate warning:\n${r.out}`);
  const st = status(tmp).steps.run;
  assert(st.total === 2, `total should be 2 (distinct), got ${st.total}`);
  assert(Object.keys(st.iterations).length === 2, "should hold 2 distinct iterations");
  assert(st.total === Object.keys(st.iterations).length, "total must equal iteration count (no wedge)");
});

test("loop-scope: re-scoping is additive and keeps total == iteration count", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/workflow.json"], tmp);
  cli(["loop-scope", "run", "a", "b", "c"], tmp);
  cli(["loop-scope", "run", "a", "b"], tmp); // re-scope with fewer
  const st = status(tmp).steps.run;
  assert(st.total === Object.keys(st.iterations).length, `total ${st.total} != iterations ${Object.keys(st.iterations).length}`);
});

test("loop: a typo'd (undeclared) sub-step warns and does NOT falsely complete the iteration", () => {
  const tmp = withConductor(LOOP); // declared sub-step is 'work'
  cli(["status-init", ".conductor/workflow.json"], tmp);
  cli(["loop-scope", "run", "a"], tmp);
  const r = cli(["loop", "run", "a", "phantom-sub", "done"], tmp); // typo — real 'work' never done
  assert(/not a declared sub-step/.test(r.out), `expected undeclared-sub warning:\n${r.out}`);
  const st = status(tmp).steps.run;
  assert(st.completed === 0, `phantom sub must NOT complete the iteration; completed=${st.completed}`);
  assert(st.status !== "done", "loop must not be marked done off a phantom sub");
});

test("loop: completion is judged on declared sub-steps (real sub done → counts)", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/workflow.json"], tmp);
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
  const doc = fs.readFileSync(path.join(tmp, ".conductor", "workflow.json"), "utf8");
  assert(JSON.parse(doc).knowledge?.[0]?.title === "Cache the price list", "knowledge not written to conductor");
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

test("cli: --version prints the package version", () => {
  const tmp = tmpdir();
  const r = cli(["--version"], tmp);
  assert(r.code === 0, `version should pass:\n${r.out}`);
  assert(/^3\.0\.0\s*$/.test(r.out), `expected 3.0.0, got:\n${r.out}`);
});

// ── REAL-WORLD CAPSTONE: a full run, init → finish ────────────────────────────
test("lifecycle: init → validate → status-init → check → complete", () => {
  const tmp = tmpdir();
  // 1) scaffold + replace with a real 2-step conductor
  assert(cli(["init", "--name", "release", "--steps", "2"], tmp).code === 0, "init failed");
  const real = `{
  "conductor": "3.0.0",
  "name": "release",
  "description": "Ship a release safely.",
  "steps": [
    {
      "id": "prepare",
      "title": "Prepare",
      "instruction": "Prepare the release notes.",
      "requires": []
    },
    {
      "id": "publish",
      "title": "Publish",
      "instruction": "Publish.",
      "requires": [
        "prepare"
      ]
    }
  ]
}`;
  fs.writeFileSync(path.join(tmp, ".conductor", "workflow.json"), real);
  // 2) validate
  assert(cli(["validate", ".conductor/workflow.json"], tmp).code === 0, "validate failed");
  // 3) status-init
  assert(cli(["status-init", ".conductor/workflow.json"], tmp).code === 0, "status-init failed");
  // 4) drive 'prepare' through checker and completion
  cli(["step", "prepare", "running", "--headless"], tmp);
  cli(["heartbeat", "prepare", "drafting notes"], tmp);
  writeArtifact(tmp, "prepare", "release notes prepared");
  assert(cli(["check", "prepare", "--output", "release notes prepared"], tmp).code === 0, "prepare checker failed");
  assert(cli(["gate-result", "prepare", "--passed", "--evidence", "release notes prepared"], tmp).code === 0, "prepare verdict failed");
  assert(cli(["complete", "prepare"], tmp).code === 0, "prepare complete failed");
  // 5) drive 'publish' through checker and completion
  cli(["step", "publish", "running", "--headless"], tmp);
  cli(["heartbeat", "publish", "publishing"], tmp);
  writeArtifact(tmp, "publish", "published artifact exists");
  assert(cli(["check", "publish", "--output", "published artifact exists"], tmp).code === 0, "publish checker failed");
  assert(cli(["gate-result", "publish", "--passed", "--evidence", "published artifact exists"], tmp).code === 0, "publish verdict failed");
  assert(cli(["complete", "publish"], tmp).code === 0, "publish complete failed");
  // 6) both steps done
  const s = status(tmp);
  assert(s.steps.prepare.status === "done" && s.steps.publish.status === "done", "not all steps done");
  assert(s.status === "done", "run should auto-complete when all cards are done");
  assert(s.endedAt, "run should record endedAt");
});

test("decompose: numbered workflow steps become cards", () => {
  const tmp = tmpdir();
  const skill = writeFile(tmp, "SKILL.md", `# Support Skill

## Workflow

1. Read the ticket and classify severity.
2. Query the mock support API for similar issues.
3. Draft the customer reply.
`);
  const r = withDecomposeFixtures(tmp, {
    "composer-1.json": {
      cards: [
        { title: "Classify severity", instruction: "Read the ticket and classify severity." },
        { title: "Query support API", instruction: "Query the mock support API for similar issues and produce an issue-context summary." },
        { title: "Draft customer reply", instruction: "Draft the customer reply using the severity and issue context." },
      ],
    },
    "checker-1.json": { verdict: "PASS", feedback: "Cards preserve the workflow and produce verifiable outputs." },
  }, () => cli(["decompose", "--skill", skill], tmp));
  assert(r.code === 0, `decompose should pass:\n${r.out}`);
  const cards = JSON.parse(fs.readFileSync(path.join(tmp, ".conductor", "cards.json"), "utf8"));
  assert(cards.length === 3, `expected 3 cards, got ${cards.length}`);
  assert(cards[0].title === "Classify severity", `unexpected first title: ${cards[0].title}`);
  assert(cards[0].instruction === "Read the ticket and classify severity.", `instruction should stay detailed: ${cards[0].instruction}`);
});

test("decompose: Workflow bullets become cards when no numbered steps exist", () => {
  const tmp = tmpdir();
  const skill = writeFile(tmp, "SKILL.md", `# Product Skill

## Workflow

- Define the target customer segment.
- Compare the top three activation paths.
- Recommend the product experiment.
`);
  const r = withDecomposeFixtures(tmp, {
    "composer-1.json": {
      cards: [
        { title: "Define segment", instruction: "Define the target customer segment and write the segment criteria." },
        { title: "Compare paths", instruction: "Compare the top three activation paths and produce a comparison table." },
        { title: "Recommend experiment", instruction: "Recommend the product experiment with rationale and expected signal." },
      ],
    },
    "checker-1.json": { verdict: "PASS", feedback: "Cards preserve the bullet workflow and require concrete outputs." },
  }, () => cli(["decompose", "--skill", skill], tmp));
  assert(r.code === 0, `decompose should pass:\n${r.out}`);
  const cards = JSON.parse(fs.readFileSync(path.join(tmp, ".conductor", "cards.json"), "utf8"));
  assert(cards.map((c) => c.title).join("|") === "Define segment|Compare paths|Recommend experiment", `unexpected titles: ${JSON.stringify(cards)}`);
});

test("decompose: independent checker rejects cardized SEO rules and composer repairs", () => {
  const tmp = tmpdir();
  const skill = writeFile(tmp, "SKILL.md", `# SEO Skill

## Workflow

- Collect page evidence from HTML, metadata, headings, and schema.
- Produce findings with Finding, Evidence, Impact, Fix.
- Create FULL-AUDIT-REPORT.md.
- Create ACTION-PLAN.md.

## Quality Gates

- **INP not FID** — FID was removed. Never reference FID.
- **FAQ schema restricted** — Do not promise FAQ rich results for commercial pages.
- **JSON-LD only** — Never recommend Microdata or RDFa.
`);
  const r = withDecomposeFixtures(tmp, {
    "composer-1.json": {
      cards: [
        { title: "Collect evidence", instruction: "Collect page evidence from HTML, metadata, headings, and schema." },
        { title: "INP not FID", instruction: "Use INP, not FID." },
        { title: "FAQ schema restricted", instruction: "Do not promise FAQ rich results for commercial pages." },
        { title: "Create reports", instruction: "Create FULL-AUDIT-REPORT.md and ACTION-PLAN.md." },
      ],
    },
    "checker-1.json": {
      verdict: "FAIL",
      feedback: "Rules became cards. Fold INP, FAQ, and JSON-LD requirements into real audit/report cards.",
      misplaced: ["INP not FID", "FAQ schema restricted"],
    },
    "composer-2.json": {
      cards: [
        {
          title: "Collect evidence",
          instruction: "Collect page evidence from HTML, metadata, headings, and schema. Apply these criteria while collecting evidence: INP not FID; FAQ schema restricted; JSON-LD only.",
        },
        {
          title: "Produce findings",
          instruction: "Produce findings with Finding, Evidence, Impact, and Fix. Apply these criteria: never reference FID, do not promise FAQ rich results for commercial pages, and never recommend Microdata or RDFa.",
        },
        {
          title: "Create audit report",
          instruction: "Create FULL-AUDIT-REPORT.md containing confirmed findings, evidence, impact, and fixes. Include the INP, FAQ schema, and JSON-LD constraints where relevant.",
        },
        {
          title: "Create action plan",
          instruction: "Create ACTION-PLAN.md with prioritized recommendations and implementation steps. Preserve the INP, FAQ schema, and JSON-LD constraints.",
        },
      ],
    },
    "checker-2.json": { verdict: "PASS", feedback: "Rules are attached as criteria and the real work units remain cards." },
  }, () => cli(["decompose", "--skill", skill], tmp));
  assert(r.code === 0, `decompose should pass:\n${r.out}`);
  const cards = JSON.parse(fs.readFileSync(path.join(tmp, ".conductor", "cards.json"), "utf8"));
  const titles = cards.map((c) => c.title).join("|");
  assert(!/INP|FAQ schema|JSON-LD/.test(titles), `rules should not become cards: ${titles}`);
  assert(cards.length === 4, `expected 4 work cards, got ${cards.length}: ${titles}`);
  assert(cards.some((c) => /INP not FID/.test(c.instruction)), "INP rule should be attached to an instruction");
  assert(cards.some((c) => /FAQ schema restricted/.test(c.instruction)), "FAQ rule should be attached to an instruction");
  const report = JSON.parse(fs.readFileSync(path.join(tmp, ".conductor", "decomposition-check.json"), "utf8"));
  assert(report.ok === true, `checker report should pass: ${JSON.stringify(report)}`);
  assert(report.attempts.length === 2, `expected checker repair loop: ${JSON.stringify(report)}`);
  assert(report.attempts[0].check.verdict === "FAIL", "first checker attempt should fail");
});

test("decompose: passed cards stay done while unfinished cards are repaired", () => {
  const tmp = tmpdir();
  const skill = writeFile(tmp, "SKILL.md", `# Support Skill

## Workflow

- Research the ticket.
- Draft the reply.
`);
  const r = withDecomposeFixtures(tmp, {
    "composer-1.json": {
      cards: [
        { title: "Research ticket", instruction: "Research the ticket and produce a support context summary." },
        { title: "Draft reply", instruction: "Draft something." },
      ],
    },
    "checker-1.json": {
      verdict: "FAIL",
      feedback: "Research passed, reply is too vague.",
      passed: [{ card: 0, title: "Research ticket", reason: "Concrete artifact exists." }],
      unfinished: [{ card: 1, title: "Draft reply", problem: "Too vague.", needed: "Require an actual customer-facing reply." }],
      blocking_issues: [{ card: 1, title: "Draft reply", problem: "Too vague.", required_repair: "Require an actual customer-facing reply." }],
    },
    "composer-2.json": {
      cards: [
        { title: "Research ticket", instruction: "CHANGED BY MODEL AND SHOULD BE RESTORED." },
        { title: "Draft reply", instruction: "Draft the customer-facing reply using the support context summary." },
      ],
    },
    "checker-2.json": {
      verdict: "PASS",
      feedback: "Both cards are concrete.",
      passed: [
        { card: 0, title: "Research ticket", reason: "Still good." },
        { card: 1, title: "Draft reply", reason: "Now concrete." },
      ],
    },
  }, () => cli(["decompose", "--skill", skill], tmp));
  assert(r.code === 0, `decompose should pass:\n${r.out}`);
  const cards = JSON.parse(fs.readFileSync(path.join(tmp, ".conductor", "cards.json"), "utf8"));
  assert(cards[0].instruction === "Research the ticket and produce a support context summary.", `passed card should be restored:\n${JSON.stringify(cards, null, 2)}`);
  assert(cards[1].instruction === "Draft the customer-facing reply using the support context summary.", "unfinished card should be repaired");
  const report = JSON.parse(fs.readFileSync(path.join(tmp, ".conductor", "decomposition-check.json"), "utf8"));
  assert(report.attempts[1].passed_enforcement.length === 1, `expected passed-card enforcement:\n${JSON.stringify(report.attempts[1], null, 2)}`);
});

test("decompose: --resume continues a failed decomposition from existing report", () => {
  const tmp = tmpdir();
  const skill = writeFile(tmp, "SKILL.md", `# Resume Skill

## Workflow

- Gather facts.
- Write summary.
`);
  const first = withDecomposeFixtures(tmp, {
    "composer-1.json": {
      cards: [
        { title: "Gather facts", instruction: "Gather facts and produce a fact list." },
        { title: "Write summary", instruction: "Write something." },
      ],
    },
    "checker-1.json": {
      verdict: "FAIL",
      feedback: "Summary is too vague.",
      passed: [{ card: 0, title: "Gather facts", reason: "Concrete." }],
      unfinished: [{ card: 1, title: "Write summary", problem: "Too vague.", needed: "Require a finished summary." }],
    },
  }, () => cli(["decompose", "--skill", skill, "--max-attempts", "1"], tmp));
  assert(first.code !== 0, `first run should fail at one attempt:\n${first.out}`);
  const second = withDecomposeFixtures(tmp, {
    "composer-2.json": {
      cards: [
        { title: "Gather facts", instruction: "Gather facts and produce a fact list." },
        { title: "Write summary", instruction: "Write a finished summary from the gathered facts." },
      ],
    },
    "checker-2.json": {
      verdict: "PASS",
      feedback: "Both cards are concrete.",
      passed: [
        { card: 0, title: "Gather facts", reason: "Concrete." },
        { card: 1, title: "Write summary", reason: "Concrete." },
      ],
    },
  }, () => cli([
    "decompose",
    "--skill", skill,
    "--resume", path.join(tmp, ".conductor", "decomposition-check.json"),
    "--max-attempts", "2",
  ], tmp));
  assert(second.code === 0, `resume should pass:\n${second.out}`);
  const report = JSON.parse(fs.readFileSync(path.join(tmp, ".conductor", "decomposition-check.json"), "utf8"));
  assert(report.attempts.length === 2, `resume should preserve first attempt and add second:\n${JSON.stringify(report, null, 2)}`);
  assert(report.ok === true, "resume report should be ok");
});

test("order: dependency checker rejects lazy linearization and composer repairs", () => {
  const tmp = tmpdir();
  writeFile(tmp, ".conductor/cards.json", JSON.stringify([
    { title: "Collect context", instruction: "Collect context and produce notes." },
    { title: "Draft intro", instruction: "Draft the intro from the context notes." },
    { title: "Draft FAQ", instruction: "Draft the FAQ from the context notes." },
  ], null, 2));
  const r = withDecomposeFixtures(tmp, {
    "order-composer-1.json": {
      steps: [
        { requires: [] },
        { requires: [0] },
        { requires: [1] },
      ],
    },
    "order-checker-1.json": {
      verdict: "FAIL",
      feedback: "The graph is lazily linear. FAQ only needs context, not intro.",
      blocking_issues: [
        {
          card: 2,
          title: "Draft FAQ",
          problem: "Depends on Draft intro unnecessarily.",
          required_repair: "Change requires from [1] to [0].",
        },
      ],
    },
    "order-composer-2.json": {
      steps: [
        { requires: [] },
        { requires: [0] },
        { requires: [0] },
      ],
    },
    "order-checker-2.json": {
      verdict: "PASS",
      feedback: "Dependencies are minimal and parallelism is preserved.",
    },
  }, () => cli(["order", "--cards", ".conductor/cards.json", "--name", "ordered-skill"], tmp));
  assert(r.code === 0, `order should pass:\n${r.out}`);
  const workflow = JSON.parse(fs.readFileSync(path.join(tmp, ".conductor", "workflow.json"), "utf8"));
  assert(workflow.name === "ordered-skill", "workflow name not set");
  assert(JSON.stringify(workflow.steps.map((s) => s.requires)) === JSON.stringify([[], [0], [0]]), `wrong requires:\n${JSON.stringify(workflow, null, 2)}`);
  const report = JSON.parse(fs.readFileSync(path.join(tmp, ".conductor", "order-check.json"), "utf8"));
  assert(report.ok === true, "order report should pass");
  assert(report.attempts.length === 2, "order should repair after checker fail");
});

test("order: coarse cards are ordered by earliest safe start, not rejected for mini-sequences", () => {
  const tmp = tmpdir();
  writeFile(tmp, ".conductor/cards.json", JSON.stringify([
    { title: "Draft article", instruction: "Create the finished draft article." },
    { title: "Publish article", instruction: "Check that the draft is ready, publish it, then verify the live page renders." },
  ], null, 2));
  const r = withDecomposeFixtures(tmp, {
    "order-composer-1.json": {
      steps: [
        { requires: [] },
        { requires: [0] },
      ],
    },
    "order-checker-1.json": {
      verdict: "PASS",
      feedback: "The publish card is coarse but has one safe start point: after the draft exists.",
    },
  }, () => cli(["order", "--cards", ".conductor/cards.json", "--name", "coarse-card"], tmp));
  assert(r.code === 0, `coarse card should order successfully:\n${r.out}`);
  const workflow = JSON.parse(fs.readFileSync(path.join(tmp, ".conductor", "workflow.json"), "utf8"));
  assert(JSON.stringify(workflow.steps.map((s) => s.requires)) === JSON.stringify([[], [0]]), `wrong requires:\n${JSON.stringify(workflow, null, 2)}`);
});

test("order-audit: spot sample passes only with concrete reasoning", () => {
  const tmp = withConductor(`{
  "conductor": "3.0.0",
  "name": "audit-pass",
  "description": "d.",
  "steps": [
    {
      "title": "Collect context",
      "instruction": "Collect context and produce notes.",
      "requires": []
    },
    {
      "title": "Draft intro",
      "instruction": "Draft the intro from the context notes.",
      "requires": [0]
    },
    {
      "title": "Draft FAQ",
      "instruction": "Draft the FAQ from the context notes.",
      "requires": [0]
    }
  ]
}`);
  const r = withDecomposeFixtures(tmp, {
    "order-auditor-1.json": {
      verdict: "PASS",
      feedback: "Sampled roots, dependency cards, and sibling pair are justified.",
      samples: [
        { type: "root", card: 0, verdict: "PASS", reasoning: "Collect context creates the first notes and needs no prior artifact." },
        { type: "high-dependency", card: 1, verdict: "PASS", reasoning: "Draft intro needs the context notes from card 0." },
        { type: "parallel-pair", card: 1, other_card: 2, verdict: "PASS", reasoning: "Both use card 0 notes but do not need each other's outputs." },
      ],
      issues: [],
    },
  }, () => cli(["order-audit", "--workflow", ".conductor/workflow.json", "--sample", "4"], tmp));
  assert(r.code === 0, `order-audit should pass:\n${r.out}`);
  const report = JSON.parse(fs.readFileSync(path.join(tmp, ".conductor", "order-audit.json"), "utf8"));
  assert(report.ok === true, "audit report should be ok");
  assert(report.audit.samples.length >= 3, "audit should preserve sample reasoning");
});

test("order-audit: fails when a sampled dependency is unnecessary", () => {
  const tmp = withConductor(`{
  "conductor": "3.0.0",
  "name": "audit-fail",
  "description": "d.",
  "steps": [
    {
      "title": "Collect context",
      "instruction": "Collect context and produce notes.",
      "requires": []
    },
    {
      "title": "Draft intro",
      "instruction": "Draft the intro from the context notes.",
      "requires": [0]
    },
    {
      "title": "Draft FAQ",
      "instruction": "Draft the FAQ from the context notes.",
      "requires": [1]
    }
  ]
}`);
  const r = withDecomposeFixtures(tmp, {
    "order-auditor-1.json": {
      verdict: "FAIL",
      feedback: "Sample found lazy linearization.",
      samples: [
        { type: "high-dependency", card: 2, verdict: "FAIL", reasoning: "Draft FAQ needs context notes, not the intro output." },
      ],
      issues: [
        { card: 2, problem: "Unnecessary dependency on card 1.", required_repair: "Change requires from [1] to [0]." },
      ],
    },
  }, () => cli(["order-audit", "--workflow", ".conductor/workflow.json"], tmp));
  assert(r.code !== 0, `order-audit should fail:\n${r.out}`);
  assert(/Change requires from \[1\] to \[0\]/.test(r.out), `expected concrete repair:\n${r.out}`);
  const report = JSON.parse(fs.readFileSync(path.join(tmp, ".conductor", "order-audit.json"), "utf8"));
  assert(report.ok === false, "audit report should fail");
});

test("compile: first run creates accepted skeleton, second run reuses cache", () => {
  const tmp = tmpdir();
  const cache = path.join(tmp, "compile-cache");
  const skill = writeFile(tmp, "SKILL.md", `# Compile Skill

## Workflow

- Gather facts.
- Write report.
`);
  const first = withDecomposeFixtures(tmp, {
    "composer-1.json": {
      cards: [
        { title: "Gather facts", instruction: "Gather facts and produce a fact list." },
        { title: "Write report", instruction: "Write the report from the fact list." },
      ],
    },
    "checker-1.json": {
      verdict: "PASS",
      feedback: "Cards are concrete.",
      passed: [
        { card: 0, title: "Gather facts", reason: "Concrete." },
        { card: 1, title: "Write report", reason: "Concrete." },
      ],
    },
    "order-composer-1.json": {
      steps: [
        { requires: [] },
        { requires: [0] },
      ],
    },
    "order-checker-1.json": {
      verdict: "PASS",
      feedback: "Dependencies are minimal.",
    },
    "order-auditor-1.json": {
      verdict: "PASS",
      feedback: "Sampled dependencies are justified.",
      samples: [
        { type: "root", card: 0, verdict: "PASS", reasoning: "Facts start from initial inputs." },
        { type: "high-dependency", card: 1, verdict: "PASS", reasoning: "Report needs fact list." },
      ],
      issues: [],
    },
  }, () => cli(["compile", "--skill", skill, "--cache-dir", cache, "--name", "compile-skill"], tmp));
  assert(first.code === 0, `first compile should pass:\n${first.out}`);
  assert(/compiled accepted workflow/.test(first.out), `expected first compile message:\n${first.out}`);
  const root = path.join(tmp, ".conductor", "compile-skill");
  assert(fs.existsSync(path.join(root, "cards.json")), "cards.json not written");
  assert(fs.existsSync(path.join(root, "workflow.json")), "workflow.json not written");
  assert(fs.existsSync(path.join(root, "compile-meta.json")), "compile-meta.json not written");
  assert(fs.existsSync(path.join(root, "migration-meta.json")), "migration-meta.json not written");
  assert(fs.existsSync(path.join(root, "knowledge.json")), "knowledge.json not written");
  const meta = JSON.parse(fs.readFileSync(path.join(root, "compile-meta.json"), "utf8"));
  assert(meta.accepted === true && meta.cache_key, `bad compile meta:\n${JSON.stringify(meta, null, 2)}`);

  fs.rmSync(path.join(root, "cards.json"));
  fs.rmSync(path.join(root, "workflow.json"));
  const second = cli(["compile", "--skill", skill, "--cache-dir", cache, "--name", "compile-skill"], tmp);
  assert(second.code === 0, `second compile should reuse cache:\n${second.out}`);
  assert(/accepted compiled workflow found/.test(second.out), `expected cache-hit message:\n${second.out}`);
  const workflow = JSON.parse(fs.readFileSync(path.join(root, "workflow.json"), "utf8"));
  assert(workflow.steps[1].requires[0] === 0, `cached workflow not restored:\n${JSON.stringify(workflow, null, 2)}`);
});

test("integrate: ignores applied knowledge and resolves same-card duplicates", () => {
  const tmp = tmpdir();
  const root = path.join(tmp, ".conductor", "seo-skill");
  fs.mkdirSync(root, { recursive: true });
  writeFile(tmp, "SKILL.md", "# SEO Skill\n\nImprove treatment SEO.");
  writeFile(tmp, ".conductor/seo-skill/cards.json", JSON.stringify([
    { title: "Run SEO research", instruction: "Run SEO research." },
    { title: "Create treatment image", instruction: "Create one treatment image." },
  ], null, 2));
  writeFile(tmp, ".conductor/seo-skill/workflow.json", JSON.stringify({
    conductor: "3.0.0",
    name: "seo-skill",
    description: "SEO skill.",
    steps: [
      { title: "Run SEO research", instruction: "Run SEO research.", requires: [] },
      { title: "Create treatment image", instruction: "Create one treatment image.", requires: [0] },
    ],
  }, null, 2));
  writeFile(tmp, ".conductor/seo-skill/knowledge.json", JSON.stringify({
    items: [
      {
        id: "K-001",
        source_card: 0,
        title: "Synonym research",
        detail: "Add synonyms to the batched keyword call.",
        status: "applied",
        applied_in: "prior-run",
        applied_as: "tier-1:edit-card-0",
      },
      {
        id: "K-002",
        source_card: 1,
        title: "Create treatment image",
        detail: "Create one approved treatment image for each page in the family, parent plus every child.",
        status: "open",
      },
      {
        id: "K-003",
        source_card: "1",
        title: "Image per page",
        detail: "The image card must create one treatment image per page in the family, including parent and children.",
        status: "open",
      },
    ],
  }, null, 2));
  const r = withDecomposeFixtures(tmp, {
    "integration-1.json": {
      changes: [
        {
          type: "edit_instruction",
          card: 1,
          title: "Create treatment image",
          new_instruction: "Create one approved treatment image for each page in the family, parent plus every child.",
          change: "Preserved per-page image scope.",
          knowledge_id: "K-002",
        },
      ],
    },
    "integration-checker-1.json": {
      verdict: "PASS",
      feedback: "All open image-scope knowledge items are handled.",
      passed_patches: [
        { knowledge_id: "K-002", kind: "edit_instruction", reason: "Instruction preserves per-page image scope." },
      ],
      failed_patches: [],
    },
  }, () => cli(["integrate", "--dir", ".conductor/seo-skill", "--skill", "SKILL.md", "--run-id", "run-2"], tmp));
  assert(r.code === 0, `integration should pass:\n${r.out}`);
  const knowledge = JSON.parse(fs.readFileSync(path.join(root, "knowledge.json"), "utf8"));
  const byId = Object.fromEntries(knowledge.items.map((item) => [item.id, item]));
  assert(byId["K-001"].status === "applied" && byId["K-001"].applied_in === "prior-run", `applied item should not be reprocessed:\n${JSON.stringify(byId["K-001"], null, 2)}`);
  assert(byId["K-002"].status === "applied" && byId["K-002"].applied_in === "run-2", `primary item not applied:\n${JSON.stringify(byId["K-002"], null, 2)}`);
  assert(byId["K-003"].status === "applied" && byId["K-003"].applied_as === "tier-1:edit-card-1", `duplicate item should be folded into the shipped card edit:\n${JSON.stringify(byId["K-003"], null, 2)}`);
  const cards = JSON.parse(fs.readFileSync(path.join(root, "cards.json"), "utf8"));
  assert(/each page/.test(cards[1].instruction) && /parent/.test(cards[1].instruction), `duplicate learning should be present in shipped instruction:\n${cards[1].instruction}`);
  const artifact = fs.readFileSync(path.join(root, "runs", "run-2", "artifacts", "integration.md"), "utf8");
  assert(/2 open knowledge items reviewed/.test(artifact), `integration should review only open items:\n${artifact}`);
  const integrationWorkflow = JSON.parse(fs.readFileSync(path.join(root, "integration.workflow.json"), "utf8"));
  const integrationStatus = JSON.parse(fs.readFileSync(path.join(root, "integration.status.json"), "utf8"));
  assert(integrationWorkflow.name === "Integrating insights", `integration workflow should be visible:\n${JSON.stringify(integrationWorkflow, null, 2)}`);
  assert(integrationWorkflow.steps.map((step) => step.title).join("|") === "Apply instruction insights|Validate updated workflow", `instruction-only integration should show edit + validate phases:\n${JSON.stringify(integrationWorkflow, null, 2)}`);
  assert(integrationStatus.status === "done" && integrationStatus.steps["0"].status === "done" && integrationStatus.steps["1"].status === "done", `integration status should complete visibly:\n${JSON.stringify(integrationStatus, null, 2)}`);
});

test("integrate: patch guard preserves card order and dependencies", () => {
  const tmp = tmpdir();
  const root = path.join(tmp, ".conductor", "guarded-skill");
  fs.mkdirSync(root, { recursive: true });
  writeFile(tmp, "SKILL.md", "# Guarded Skill\n\nImprove an existing workflow without changing order.");
  writeFile(tmp, ".conductor/guarded-skill/cards.json", JSON.stringify([
    { title: "Collect facts", instruction: "Collect facts." },
    { title: "Draft page", instruction: "Draft the page from facts." },
    { title: "Review page", instruction: "Review the finished page." },
  ], null, 2));
  writeFile(tmp, ".conductor/guarded-skill/workflow.json", JSON.stringify({
    conductor: "3.0.0",
    name: "guarded-skill",
    description: "Guarded skill.",
    steps: [
      { title: "Collect facts", instruction: "Collect facts.", requires: [] },
      { title: "Draft page", instruction: "Draft the page from facts.", requires: [0] },
      { title: "Review page", instruction: "Review the finished page.", requires: [1] },
    ],
  }, null, 2));
  writeFile(tmp, ".conductor/guarded-skill/knowledge.json", JSON.stringify({
    items: [
      {
        id: "K-010",
        source_card: 1,
        title: "Add source citations",
        detail: "Drafting should include source citations.",
        status: "open",
      },
    ],
  }, null, 2));
  const beforeCards = fs.readFileSync(path.join(root, "cards.json"), "utf8");
  const beforeWorkflow = fs.readFileSync(path.join(root, "workflow.json"), "utf8");
  const r = withDecomposeFixtures(tmp, {
    "integration-1.json": {
      cards: [
        { title: "Collect facts", instruction: "Collect facts." },
        { title: "Draft page", instruction: "Draft the page from facts and include source citations." },
      ],
      workflow: {
        conductor: "3.0.0",
        name: "guarded-skill",
        steps: [
          { title: "Draft page", instruction: "Draft the page from facts and include source citations.", requires: [] },
        ],
      },
      changes: [
        {
          type: "edit_instruction",
          card: 1,
          title: "Draft page",
          new_instruction: "Draft the page from facts and include source citations.",
          change: "Added source citation requirement.",
          knowledge_id: "K-010",
        },
      ],
    },
    "integration-checker-1.json": {
      verdict: "PASS",
      feedback: "Instruction edit addresses the learning and no structural change is accepted.",
      passed_patches: [
        { knowledge_id: "K-010", kind: "edit_instruction", reason: "The draft instruction now requires citations." },
      ],
      failed_patches: [],
    },
  }, () => cli(["integrate", "--dir", ".conductor/guarded-skill", "--skill", "SKILL.md", "--run-id", "run-3"], tmp));
  assert(r.code === 0, `integration should ignore full-card/full-workflow payload and apply only patch:\n${r.out}`);
  const cards = JSON.parse(fs.readFileSync(path.join(root, "cards.json"), "utf8"));
  const workflow = JSON.parse(fs.readFileSync(path.join(root, "workflow.json"), "utf8"));
  const originalCards = JSON.parse(beforeCards);
  const originalWorkflow = JSON.parse(beforeWorkflow);
  assert(cards.length === originalCards.length, `card count changed:\n${JSON.stringify(cards, null, 2)}`);
  assert(workflow.steps.length === originalWorkflow.steps.length, `workflow step count changed:\n${JSON.stringify(workflow, null, 2)}`);
  assert(cards[0].instruction === originalCards[0].instruction, "unpatched card 0 changed");
  assert(cards[2].instruction === originalCards[2].instruction, "unpatched card 2 changed");
  assert(workflow.steps[1].instruction === "Draft the page from facts and include source citations.", "declared patch was not applied");
  assert(JSON.stringify(workflow.steps.map((step) => step.requires)) === JSON.stringify(originalWorkflow.steps.map((step) => step.requires)), `dependencies changed:\n${JSON.stringify(workflow.steps, null, 2)}`);
});

test("integrate: checker retry locks passed patches and repairs failed items", () => {
  const tmp = tmpdir();
  const root = path.join(tmp, ".conductor", "loop-skill");
  fs.mkdirSync(root, { recursive: true });
  writeFile(tmp, "SKILL.md", "# Loop Skill\n\nImprove cards from learned run facts.");
  writeFile(tmp, ".conductor/loop-skill/cards.json", JSON.stringify([
    { title: "Run research", instruction: "Run treatment research." },
    { title: "Write proposal", instruction: "Write the page proposal." },
  ], null, 2));
  writeFile(tmp, ".conductor/loop-skill/workflow.json", JSON.stringify({
    conductor: "3.0.0",
    name: "loop-skill",
    description: "Loop skill.",
    steps: [
      { title: "Run research", instruction: "Run treatment research.", requires: [] },
      { title: "Write proposal", instruction: "Write the page proposal.", requires: [0] },
    ],
  }, null, 2));
  writeFile(tmp, ".conductor/loop-skill/knowledge.json", JSON.stringify({
    items: [
      {
        id: "K-101",
        source_card: 0,
        title: "Known keyword cache",
        detail: "Use the existing keyword cache before running external research.",
        status: "open",
      },
      {
        id: "K-102",
        source_card: 1,
        title: "Mention synonym variants",
        detail: "The proposal should include synonym variants in headings and FAQs.",
        status: "open",
      },
    ],
  }, null, 2));

  const r = withDecomposeFixtures(tmp, {
    "integration-1.json": {
      changes: [
        {
          type: "edit_instruction",
          card: 0,
          title: "Run research",
          new_instruction: "Use the existing keyword cache before running external treatment research.",
          change: "Added keyword cache shortcut.",
          knowledge_id: "K-101",
        },
      ],
    },
    "integration-checker-1.json": {
      verdict: "FAIL",
      feedback: "One learning item is still unhandled.",
      passed_patches: [
        { knowledge_id: "K-101", kind: "edit_instruction", reason: "Keyword cache shortcut is woven into the research instruction." },
      ],
      failed_patches: [
        { knowledge_id: "K-102", feedback: "Synonym variants were not addressed.", required_repair: "Patch card 1 to include synonym variants in headings and FAQs." },
      ],
      repair_prompt: "Keep K-101 exactly. Add an edit_instruction patch for K-102 on card 1.",
    },
    "integration-2.json": {
      changes: [
        {
          type: "edit_instruction",
          card: 1,
          title: "Write proposal",
          new_instruction: "Write the page proposal, including synonym variants in headings and FAQs where they match real search intent.",
          change: "Added synonym variants to proposal requirements.",
          knowledge_id: "K-102",
        },
      ],
    },
    "integration-checker-2.json": {
      verdict: "PASS",
      feedback: "Both learning items are now handled.",
      passed_patches: [
        { knowledge_id: "K-101", kind: "edit_instruction", reason: "Locked keyword cache patch preserved." },
        { knowledge_id: "K-102", kind: "edit_instruction", reason: "Proposal instruction includes synonym variants." },
      ],
      failed_patches: [],
    },
  }, () => cli(["integrate", "--dir", ".conductor/loop-skill", "--skill", "SKILL.md", "--run-id", "run-4"], tmp));

  assert(r.code === 0, `integration retry loop should pass:\n${r.out}`);
  const cards = JSON.parse(fs.readFileSync(path.join(root, "cards.json"), "utf8"));
  assert(/keyword cache/.test(cards[0].instruction), `locked K-101 patch was not preserved:\n${JSON.stringify(cards, null, 2)}`);
  assert(/synonym variants/.test(cards[1].instruction), `K-102 repair was not applied:\n${JSON.stringify(cards, null, 2)}`);
  const workflow = JSON.parse(fs.readFileSync(path.join(root, "workflow.json"), "utf8"));
  assert(JSON.stringify(workflow.steps.map((step) => step.requires)) === JSON.stringify([[], [0]]), `dependencies changed:\n${JSON.stringify(workflow, null, 2)}`);
  const knowledge = JSON.parse(fs.readFileSync(path.join(root, "knowledge.json"), "utf8"));
  assert(knowledge.items.every((item) => item.status === "applied"), `all knowledge should be applied:\n${JSON.stringify(knowledge, null, 2)}`);
  const summary = JSON.parse(fs.readFileSync(path.join(root, "runs", "run-4", "integration-summary.json"), "utf8"));
  assert(summary.attempts === 2, `expected two integration attempts:\n${JSON.stringify(summary, null, 2)}`);
});

test("integrate: combines multiple insights for one card into one instruction edit", () => {
  const tmp = tmpdir();
  const root = path.join(tmp, ".conductor", "combine-skill");
  fs.mkdirSync(root, { recursive: true });
  writeFile(tmp, "SKILL.md", "# Combine Skill\n\nImprove one card from multiple comments.");
  writeFile(tmp, ".conductor/combine-skill/cards.json", JSON.stringify([
    { title: "Validate metadata", instruction: "Validate the title and meta description against the page proposal." },
  ], null, 2));
  writeFile(tmp, ".conductor/combine-skill/workflow.json", JSON.stringify({
    conductor: "3.0.0",
    name: "combine-skill",
    description: "Combine skill.",
    steps: [
      { title: "Validate metadata", instruction: "Validate the title and meta description against the page proposal.", requires: [] },
    ],
  }, null, 2));
  writeFile(tmp, ".conductor/combine-skill/knowledge.json", JSON.stringify({
    items: [
      { id: "K-201", source_card: 0, title: "Synonym variants", detail: "Include synonym variants in the validation.", status: "open" },
      { id: "K-202", source_card: 0, title: "Canonical URL", detail: "Verify the canonical URL is public HTTPS.", status: "open" },
    ],
  }, null, 2));

  const r = withDecomposeFixtures(tmp, {
    "integration-1.json": {
      changes: [
        {
          type: "edit_instruction",
          card: 0,
          title: "Validate metadata",
          knowledge_ids: ["K-201", "K-202"],
          new_instruction: "Validate the title and meta description against the page proposal, including synonym variants in the validation and verifying the canonical URL is public HTTPS.",
          change: "Added synonym and canonical checks.",
        },
      ],
    },
    "integration-checker-1.json": {
      verdict: "PASS",
      feedback: "Combined card edit preserves the original validation and includes both insights.",
      passed_patches: [
        { card: 0, knowledge_ids: ["K-201", "K-202"], reason: "Both insights are present and the original validation remains." },
      ],
      failed_patches: [],
    },
  }, () => cli(["integrate", "--dir", ".conductor/combine-skill", "--skill", "SKILL.md", "--run-id", "run-5"], tmp));

  assert(r.code === 0, `combined same-card integration should pass:\n${r.out}`);
  const cards = JSON.parse(fs.readFileSync(path.join(root, "cards.json"), "utf8"));
  assert(/synonym variants/.test(cards[0].instruction), `synonym insight missing:\n${cards[0].instruction}`);
  assert(/canonical URL is public HTTPS/.test(cards[0].instruction), `canonical insight missing:\n${cards[0].instruction}`);
  const knowledge = JSON.parse(fs.readFileSync(path.join(root, "knowledge.json"), "utf8"));
  assert(knowledge.items.every((item) => item.status === "applied"), `both insights should be applied:\n${JSON.stringify(knowledge, null, 2)}`);
});

test("integrate: ledger invariant rejects applied knowledge not present in shipped instruction", () => {
  const tmp = tmpdir();
  const root = path.join(tmp, ".conductor", "ledger-skill");
  fs.mkdirSync(root, { recursive: true });
  writeFile(tmp, "SKILL.md", "# Ledger Skill\n\nKeep cards and knowledge aligned.");
  writeFile(tmp, ".conductor/ledger-skill/cards.json", JSON.stringify([
    { title: "Validate metadata", instruction: "Validate metadata." },
  ], null, 2));
  writeFile(tmp, ".conductor/ledger-skill/workflow.json", JSON.stringify({
    conductor: "3.0.0",
    name: "ledger-skill",
    description: "Ledger skill.",
    steps: [
      { title: "Validate metadata", instruction: "Validate metadata.", requires: [] },
    ],
  }, null, 2));
  writeFile(tmp, ".conductor/ledger-skill/knowledge.json", JSON.stringify({
    items: [
      { id: "K-301", source_card: 0, title: "Synonyms", detail: "Include synonym variants.", status: "open" },
      { id: "K-302", source_card: 0, title: "Canonical", detail: "Verify canonical HTTPS.", status: "open" },
    ],
  }, null, 2));

  const r = withDecomposeFixtures(tmp, {
    "integration-1.json": {
      changes: [
        {
          type: "edit_instruction",
          card: 0,
          title: "Validate metadata",
          knowledge_ids: ["K-301", "K-302"],
          new_instruction: "Validate metadata and include synonym variants.",
          change: "Claims to add both insights but only includes one.",
        },
      ],
    },
    "integration-checker-1.json": {
      verdict: "PASS",
      feedback: "Bad checker fixture says this passed.",
      passed_patches: [
        { card: 0, knowledge_ids: ["K-301", "K-302"], reason: "incorrect fixture" },
      ],
      failed_patches: [],
    },
  }, () => cli(["integrate", "--dir", ".conductor/ledger-skill", "--skill", "SKILL.md", "--run-id", "run-6"], tmp));

  assert(r.code !== 0, `ledger mismatch should fail loudly:\n${r.out}`);
  assert(/ledger check failed/.test(r.out), `expected ledger error:\n${r.out}`);
  const knowledge = JSON.parse(fs.readFileSync(path.join(root, "knowledge.json"), "utf8"));
  assert(knowledge.items.every((item) => item.status === "open"), `knowledge should remain open after rejected integration:\n${JSON.stringify(knowledge, null, 2)}`);
});

test("integrate: checker rejects edits that drop prior requirements", () => {
  const tmp = tmpdir();
  const root = path.join(tmp, ".conductor", "preserve-skill");
  fs.mkdirSync(root, { recursive: true });
  writeFile(tmp, "SKILL.md", "# Preserve Skill\n\nDo not lose original requirements.");
  writeFile(tmp, ".conductor/preserve-skill/cards.json", JSON.stringify([
    { title: "Write proposal", instruction: "Write the proposal and cite all source documents." },
  ], null, 2));
  writeFile(tmp, ".conductor/preserve-skill/workflow.json", JSON.stringify({
    conductor: "3.0.0",
    name: "preserve-skill",
    description: "Preserve skill.",
    steps: [
      { title: "Write proposal", instruction: "Write the proposal and cite all source documents.", requires: [] },
    ],
  }, null, 2));
  writeFile(tmp, ".conductor/preserve-skill/knowledge.json", JSON.stringify({
    items: [
      { id: "K-401", source_card: 0, title: "Use FAQ language", detail: "Use FAQ language from Search Console.", status: "open" },
    ],
  }, null, 2));

  const r = withDecomposeFixtures(tmp, {
    "integration-1.json": {
      changes: [
        {
          type: "edit_instruction",
          card: 0,
          title: "Write proposal",
          knowledge_ids: ["K-401"],
          new_instruction: "Write the proposal using FAQ language from Search Console.",
          change: "Drops source citation requirement.",
        },
      ],
    },
    "integration-checker-1.json": {
      verdict: "FAIL",
      feedback: "The edit drops the original source-citation requirement.",
      failed_patches: [
        { card: 0, knowledge_ids: ["K-401"], problem: "Original citation requirement was lost.", required_repair: "Preserve source citations while adding FAQ language." },
      ],
      repair_prompt: "Preserve the citation requirement and add FAQ language.",
    },
  }, () => cli(["integrate", "--dir", ".conductor/preserve-skill", "--skill", "SKILL.md", "--run-id", "run-7", "--max-attempts", "1"], tmp));

  assert(r.code !== 0, `checker should reject dropped prior requirements:\n${r.out}`);
});

test("integrate: checker rejects structural smuggling in instruction edit", () => {
  const tmp = tmpdir();
  fs.mkdirSync(path.join(tmp, ".conductor", "structural-skill"), { recursive: true });
  writeFile(tmp, "SKILL.md", "# Structural Skill\n\nImage scope needs structural follow-up.");
  writeFile(tmp, ".conductor/structural-skill/cards.json", JSON.stringify([
    { title: "Create image", instruction: "Create one approved treatment image." },
  ], null, 2));
  writeFile(tmp, ".conductor/structural-skill/workflow.json", JSON.stringify({
    conductor: "3.0.0",
    name: "structural-skill",
    description: "Structural skill.",
    steps: [
      { title: "Create image", instruction: "Create one approved treatment image.", requires: [] },
    ],
  }, null, 2));
  writeFile(tmp, ".conductor/structural-skill/knowledge.json", JSON.stringify({
    items: [
      { id: "K-501", source_card: 0, title: "Per page image scope", detail: "Produce one image per treatment page.", status: "open" },
    ],
  }, null, 2));

  const r = withDecomposeFixtures(tmp, {
    "integration-1.json": {
      changes: [
        {
          type: "edit_instruction",
          card: 0,
          title: "Create image",
          knowledge_ids: ["K-501"],
          new_instruction: "Create one approved treatment image per treatment page.",
          change: "Changes cardinality from one image to per-page images.",
        },
      ],
    },
    "integration-checker-1.json": {
      verdict: "FAIL",
      feedback: "The edit changes the card cardinality and needs structural handling outside tier 1.",
      failed_patches: [
        { card: 0, knowledge_ids: ["K-501"], problem: "Cardinality changed from one image to per-page images.", required_repair: "Reject in tier 1; do not apply as instruction-only integration." },
      ],
      repair_prompt: "Dismiss or defer this insight until structural edits are enabled.",
    },
  }, () => cli(["integrate", "--dir", ".conductor/structural-skill", "--skill", "SKILL.md", "--run-id", "run-8", "--max-attempts", "1"], tmp));

  assert(r.code !== 0, `structural smuggling should fail:\n${r.out}`);
});

test("integrate: no open insights is idempotent", () => {
  const tmp = tmpdir();
  const root = path.join(tmp, ".conductor", "idempotent-skill");
  fs.mkdirSync(root, { recursive: true });
  writeFile(tmp, ".conductor/idempotent-skill/cards.json", JSON.stringify([
    { title: "Run research", instruction: "Run research." },
  ], null, 2));
  writeFile(tmp, ".conductor/idempotent-skill/workflow.json", JSON.stringify({
    conductor: "3.0.0",
    name: "idempotent-skill",
    description: "Idempotent skill.",
    steps: [
      { title: "Run research", instruction: "Run research.", requires: [] },
    ],
  }, null, 2));
  writeFile(tmp, ".conductor/idempotent-skill/knowledge.json", JSON.stringify({
    items: [
      { id: "K-601", source_card: 0, title: "Already applied", detail: "Already applied.", status: "applied" },
    ],
  }, null, 2));
  const beforeCards = fs.readFileSync(path.join(root, "cards.json"), "utf8");
  const beforeWorkflow = fs.readFileSync(path.join(root, "workflow.json"), "utf8");
  const r = cli(["integrate", "--dir", ".conductor/idempotent-skill", "--run-id", "run-9"], tmp);
  assert(r.code === 0, `idempotent integration should pass:\n${r.out}`);
  assert(fs.readFileSync(path.join(root, "cards.json"), "utf8") === beforeCards, "cards changed despite no open insights");
  assert(fs.readFileSync(path.join(root, "workflow.json"), "utf8") === beforeWorkflow, "workflow changed despite no open insights");
  assert(!fs.existsSync(path.join(root, "integration.status.json")), "no-open integration should not create an integration kanban");
});

test("integrate: order insight can move a dependency edge after instruction loop", () => {
  const tmp = tmpdir();
  const root = path.join(tmp, ".conductor", "order-skill");
  fs.mkdirSync(root, { recursive: true });
  writeFile(tmp, ".conductor/order-skill/cards.json", JSON.stringify([
    { title: "Research", instruction: "Research the page." },
    { title: "Draft", instruction: "Draft the page." },
    { title: "Validate", instruction: "Validate against research." },
  ], null, 2));
  writeFile(tmp, ".conductor/order-skill/workflow.json", JSON.stringify({
    conductor: "3.0.0",
    name: "order-skill",
    description: "Order skill.",
    steps: [
      { title: "Research", instruction: "Research the page.", requires: [] },
      { title: "Draft", instruction: "Draft the page.", requires: [0] },
      { title: "Validate", instruction: "Validate against research.", requires: [] },
    ],
  }, null, 2));
  writeFile(tmp, ".conductor/order-skill/knowledge.json", JSON.stringify({
    items: [
      { id: "K-701", source_card: 2, tag: "order", title: "Validate after research", detail: "Validate must run after Research.", status: "open" },
    ],
  }, null, 2));

  const r = withDecomposeFixtures(tmp, {
    "integration-order-1.json": {
      changes: [
        { type: "edit_order", knowledge_ids: ["K-701"], requires: { card: 2, add: [0], remove: [] }, change: "Make Validate wait for Research." },
      ],
    },
    "order-checker-1.json": { verdict: "PASS", feedback: "The graph is safe.", approved_edges: [{ from: 0, to: 1 }, { from: 0, to: 2 }] },
    "integration-order-checker-1.json": {
      verdict: "PASS",
      feedback: "The delta matches the insight.",
      passed: [{ knowledge_id: "K-701", reason: "Validate now waits for Research." }],
      failed: [],
    },
  }, () => cli(["integrate", "--dir", ".conductor/order-skill", "--run-id", "run-order-1"], tmp));

  assert(r.code === 0, `order integration should pass:\n${r.out}`);
  const workflow = JSON.parse(fs.readFileSync(path.join(root, "workflow.json"), "utf8"));
  assert(workflow.steps[2].requires.includes(0), `validate should require research:\n${JSON.stringify(workflow, null, 2)}`);
  const knowledge = JSON.parse(fs.readFileSync(path.join(root, "knowledge.json"), "utf8"));
  assert(knowledge.items[0].status === "applied" && /tier-2:edit-order/.test(knowledge.items[0].applied_as), `order item should be applied:\n${JSON.stringify(knowledge, null, 2)}`);
});

test("integrate: order coverage rejects valid but wrong dependency edge", () => {
  const tmp = tmpdir();
  const root = path.join(tmp, ".conductor", "wrong-order-skill");
  fs.mkdirSync(root, { recursive: true });
  writeFile(tmp, ".conductor/wrong-order-skill/cards.json", JSON.stringify([
    { title: "Research", instruction: "Research the page." },
    { title: "Draft", instruction: "Draft the page." },
    { title: "Validate", instruction: "Validate against research." },
  ], null, 2));
  const workflowDoc = {
    conductor: "3.0.0",
    name: "wrong-order-skill",
    description: "Wrong order skill.",
    steps: [
      { title: "Research", instruction: "Research the page.", requires: [] },
      { title: "Draft", instruction: "Draft the page.", requires: [0] },
      { title: "Validate", instruction: "Validate against research.", requires: [] },
    ],
  };
  writeFile(tmp, ".conductor/wrong-order-skill/workflow.json", JSON.stringify(workflowDoc, null, 2));
  writeFile(tmp, ".conductor/wrong-order-skill/knowledge.json", JSON.stringify({
    items: [
      { id: "K-702", source_card: 2, tag: "order", title: "Validate after research", detail: "Validate must run after Research, not Draft.", status: "open" },
    ],
  }, null, 2));

  const r = withDecomposeFixtures(tmp, {
    "integration-order-1.json": {
      changes: [
        { type: "edit_order", knowledge_ids: ["K-702"], requires: { card: 2, add: [1], remove: [] }, change: "Incorrectly make Validate wait for Draft." },
      ],
    },
    "order-checker-1.json": { verdict: "PASS", feedback: "The graph is coherent.", approved_edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }] },
    "integration-order-checker-1.json": {
      verdict: "FAIL",
      feedback: "Legal graph, wrong insight.",
      failed: [{ knowledge_id: "K-702", problem: "The insight asked for Research -> Validate, not Draft -> Validate.", required_repair: "Add 0 to card 2 requires." }],
      repair_prompt: "Use the requested research edge.",
    },
  }, () => cli(["integrate", "--dir", ".conductor/wrong-order-skill", "--run-id", "run-order-2", "--max-attempts", "1"], tmp));

  assert(r.code === 0, `unresolved order item should be honestly dismissed, not fail the whole integration:\n${r.out}`);
  const workflow = JSON.parse(fs.readFileSync(path.join(root, "workflow.json"), "utf8"));
  assert(JSON.stringify(workflow.steps.map((step) => step.requires)) === JSON.stringify(workflowDoc.steps.map((step) => step.requires)), `wrong legal edge should not ship:\n${JSON.stringify(workflow, null, 2)}`);
  const knowledge = JSON.parse(fs.readFileSync(path.join(root, "knowledge.json"), "utf8"));
  assert(knowledge.items[0].status === "dismissed" && /can't reorder/.test(knowledge.items[0].dismissed_reason), `order item should be dismissed with reason:\n${JSON.stringify(knowledge, null, 2)}`);
});

test("integrate: impossible order cycle is dismissed and workflow stays unchanged", () => {
  const tmp = tmpdir();
  const root = path.join(tmp, ".conductor", "cycle-order-skill");
  fs.mkdirSync(root, { recursive: true });
  writeFile(tmp, ".conductor/cycle-order-skill/cards.json", JSON.stringify([
    { title: "A", instruction: "Do A." },
    { title: "B", instruction: "Do B." },
  ], null, 2));
  const workflowDoc = {
    conductor: "3.0.0",
    name: "cycle-order-skill",
    description: "Cycle order skill.",
    steps: [
      { title: "A", instruction: "Do A.", requires: [1] },
      { title: "B", instruction: "Do B.", requires: [] },
    ],
  };
  writeFile(tmp, ".conductor/cycle-order-skill/workflow.json", JSON.stringify(workflowDoc, null, 2));
  writeFile(tmp, ".conductor/cycle-order-skill/knowledge.json", JSON.stringify({
    items: [
      { id: "K-703", source_card: 1, tag: "order", title: "B after A", detail: "B must run after A.", status: "open" },
    ],
  }, null, 2));

  const r = withDecomposeFixtures(tmp, {
    "integration-order-1.json": {
      changes: [
        { type: "edit_order", knowledge_ids: ["K-703"], requires: { card: 1, add: [0], remove: [] }, change: "This would create a cycle." },
      ],
    },
  }, () => cli(["integrate", "--dir", ".conductor/cycle-order-skill", "--run-id", "run-order-3", "--max-attempts", "1"], tmp));

  assert(r.code === 0, `cycle should be dismissed honestly:\n${r.out}`);
  const workflow = JSON.parse(fs.readFileSync(path.join(root, "workflow.json"), "utf8"));
  assert(JSON.stringify(workflow.steps.map((step) => step.requires)) === JSON.stringify(workflowDoc.steps.map((step) => step.requires)), `cycle edge should not ship:\n${JSON.stringify(workflow, null, 2)}`);
  const knowledge = JSON.parse(fs.readFileSync(path.join(root, "knowledge.json"), "utf8"));
  assert(knowledge.items[0].status === "dismissed" && /Circular dependency|can't reorder/.test(knowledge.items[0].dismissed_reason), `cycle item should be dismissed with concrete reason:\n${JSON.stringify(knowledge, null, 2)}`);
});

test("integrate: non-order knowledge cannot smuggle requires changes", () => {
  const tmp = tmpdir();
  fs.mkdirSync(path.join(tmp, ".conductor", "smuggle-order-skill"), { recursive: true });
  writeFile(tmp, ".conductor/smuggle-order-skill/cards.json", JSON.stringify([
    { title: "Research", instruction: "Research." },
    { title: "Draft", instruction: "Draft." },
  ], null, 2));
  writeFile(tmp, ".conductor/smuggle-order-skill/workflow.json", JSON.stringify({
    conductor: "3.0.0",
    name: "smuggle-order-skill",
    description: "Smuggle order skill.",
    steps: [
      { title: "Research", instruction: "Research.", requires: [] },
      { title: "Draft", instruction: "Draft.", requires: [] },
    ],
  }, null, 2));
  writeFile(tmp, ".conductor/smuggle-order-skill/knowledge.json", JSON.stringify({
    items: [
      { id: "K-704", source_card: 1, title: "Mention sources", detail: "Draft should mention sources.", status: "open" },
    ],
  }, null, 2));

  const r = withDecomposeFixtures(tmp, {
    "integration-1.json": {
      changes: [
        { type: "edit_order", knowledge_ids: ["K-704"], requires: { card: 1, add: [0], remove: [] }, change: "Illegally changes order for a non-order item." },
      ],
    },
    "integration-checker-1.json": {
      verdict: "PASS",
      feedback: "Bad fixture incorrectly approves smuggling.",
      passed_patches: [{ knowledge_id: "K-704", reason: "bad fixture" }],
    },
  }, () => cli(["integrate", "--dir", ".conductor/smuggle-order-skill", "--run-id", "run-order-4"], tmp));

  assert(r.code !== 0, `requires smuggling should be mechanically rejected:\n${r.out}`);
  assert(/unsupported integration change type|only edit_instruction/.test(r.out), `expected edit_order rejection:\n${r.out}`);
});

test("integrate: atomic insight with instruction and order does not commit edit when order fails", () => {
  const tmp = tmpdir();
  const root = path.join(tmp, ".conductor", "atomic-order-skill");
  fs.mkdirSync(root, { recursive: true });
  writeFile(tmp, ".conductor/atomic-order-skill/cards.json", JSON.stringify([
    { title: "A", instruction: "Do A." },
    { title: "B", instruction: "Do B." },
  ], null, 2));
  const workflowDoc = {
    conductor: "3.0.0",
    name: "atomic-order-skill",
    description: "Atomic order skill.",
    steps: [
      { title: "A", instruction: "Do A.", requires: [1] },
      { title: "B", instruction: "Do B.", requires: [] },
    ],
  };
  writeFile(tmp, ".conductor/atomic-order-skill/workflow.json", JSON.stringify(workflowDoc, null, 2));
  writeFile(tmp, ".conductor/atomic-order-skill/knowledge.json", JSON.stringify({
    items: [
      { id: "K-705", source_card: 1, tags: ["instruction", "order"], title: "B uses A output", detail: "B should mention A output and run after A.", status: "open" },
    ],
  }, null, 2));

  const r = withDecomposeFixtures(tmp, {
    "integration-1.json": {
      changes: [
        { type: "edit_instruction", card: 1, knowledge_ids: ["K-705"], new_instruction: "Do B after using A output.", change: "Mentions A output." },
      ],
    },
    "integration-checker-1.json": {
      verdict: "PASS",
      feedback: "Instruction facet is good.",
      passed_patches: [{ card: 1, knowledge_ids: ["K-705"], reason: "Instruction mentions A output." }],
    },
    "integration-order-1.json": {
      changes: [
        { type: "edit_order", knowledge_ids: ["K-705"], requires: { card: 1, add: [0], remove: [] }, change: "This would create a cycle." },
      ],
    },
  }, () => cli(["integrate", "--dir", ".conductor/atomic-order-skill", "--run-id", "run-order-5", "--max-attempts", "1"], tmp));

  assert(r.code === 0, `atomic failed order should dismiss the whole item:\n${r.out}`);
  const cards = JSON.parse(fs.readFileSync(path.join(root, "cards.json"), "utf8"));
  assert(cards[1].instruction === "Do B.", `instruction facet should not commit alone:\n${JSON.stringify(cards, null, 2)}`);
  const knowledge = JSON.parse(fs.readFileSync(path.join(root, "knowledge.json"), "utf8"));
  assert(knowledge.items[0].status === "dismissed", `atomic item should be dismissed:\n${JSON.stringify(knowledge, null, 2)}`);
});

test("integrate: add-card insight appends at next index and wires edges", () => {
  const tmp = tmpdir();
  const root = path.join(tmp, ".conductor", "add-skill");
  fs.mkdirSync(root, { recursive: true });
  writeFile(tmp, ".conductor/add-skill/cards.json", JSON.stringify([
    { title: "Research", instruction: "Research the page." },
    { title: "Upload image", instruction: "Upload the image." },
  ], null, 2));
  const workflowDoc = {
    conductor: "3.0.0",
    name: "add-skill",
    description: "Add skill.",
    steps: [
      { title: "Research", instruction: "Research the page.", requires: [] },
      { title: "Upload image", instruction: "Upload the image.", requires: [0] },
    ],
  };
  writeFile(tmp, ".conductor/add-skill/workflow.json", JSON.stringify(workflowDoc, null, 2));
  writeFile(tmp, ".conductor/add-skill/knowledge.json", JSON.stringify({
    items: [
      { id: "K-801", source_card: 1, tag: "add-card", title: "Compress images before upload", detail: "Add a card that compresses images before upload.", status: "open" },
    ],
  }, null, 2));

  const r = withDecomposeFixtures(tmp, {
    "integration-add-1.json": {
      changes: [
        {
          type: "add_card",
          knowledge_ids: ["K-801"],
          card: {
            title: "Compress images",
            instruction: "Compress images before upload and write .conductor/artifacts/<card-index>-<slugified-card-title>.md with commands, output files, and verification proof.",
          },
          requires: { self: [0], dependents: [{ card: 1, add_requires: ["N"] }] },
          change: "Added compression before upload.",
        },
      ],
    },
    "integration-add-quality-1.json": {
      verdict: "PASS",
      feedback: "Card is concrete.",
      passed: [{ knowledge_id: "K-801", reason: "New card is verifiable." }],
      failed: [],
    },
    "order-checker-1.json": {
      verdict: "PASS",
      feedback: "Placement is safe.",
      approved_edges: [{ from: 0, to: 1 }, { from: 0, to: 2 }, { from: 2, to: 1 }],
    },
    "integration-add-checker-1.json": {
      verdict: "PASS",
      feedback: "The added card matches the insight.",
      passed: [{ knowledge_id: "K-801", reason: "Compression card was added." }],
      failed: [],
    },
  }, () => cli(["integrate", "--dir", ".conductor/add-skill", "--run-id", "run-add-1"], tmp));

  assert(r.code === 0, `add-card integration should pass:\n${r.out}`);
  const cards = JSON.parse(fs.readFileSync(path.join(root, "cards.json"), "utf8"));
  const workflow = JSON.parse(fs.readFileSync(path.join(root, "workflow.json"), "utf8"));
  assert(cards.length === 3 && workflow.steps.length === 3, `length invariant failed:\n${JSON.stringify({ cards, workflow }, null, 2)}`);
  assert(cards[0].title === "Research" && cards[1].title === "Upload image", "existing card indexes changed");
  assert(cards[2].title === "Compress images", `new card should append at index 2:\n${JSON.stringify(cards, null, 2)}`);
  assert(JSON.stringify(workflow.steps[2].requires) === JSON.stringify([0]), `new card self requires wrong:\n${JSON.stringify(workflow, null, 2)}`);
  assert(workflow.steps[1].requires.includes(2), `dependent should require appended card:\n${JSON.stringify(workflow, null, 2)}`);
  const knowledge = JSON.parse(fs.readFileSync(path.join(root, "knowledge.json"), "utf8"));
  assert(knowledge.items[0].status === "applied" && knowledge.items[0].applied_card === 2, `add item should be applied with card index:\n${JSON.stringify(knowledge, null, 2)}`);
});

test("integrate: add coverage rejects valid but wrong new card", () => {
  const tmp = tmpdir();
  const root = path.join(tmp, ".conductor", "wrong-add-skill");
  fs.mkdirSync(root, { recursive: true });
  const cardsDoc = [
    { title: "Research", instruction: "Research." },
    { title: "Publish", instruction: "Publish." },
  ];
  const workflowDoc = {
    conductor: "3.0.0",
    name: "wrong-add-skill",
    description: "Wrong add skill.",
    steps: [
      { title: "Research", instruction: "Research.", requires: [] },
      { title: "Publish", instruction: "Publish.", requires: [0] },
    ],
  };
  writeFile(tmp, ".conductor/wrong-add-skill/cards.json", JSON.stringify(cardsDoc, null, 2));
  writeFile(tmp, ".conductor/wrong-add-skill/workflow.json", JSON.stringify(workflowDoc, null, 2));
  writeFile(tmp, ".conductor/wrong-add-skill/knowledge.json", JSON.stringify({
    items: [
      { id: "K-802", source_card: 1, tag: "add-card", title: "Add image compression", detail: "Add a card for image compression before publish.", status: "open" },
    ],
  }, null, 2));

  const r = withDecomposeFixtures(tmp, {
    "integration-add-1.json": {
      changes: [
        {
          type: "add_card",
          knowledge_ids: ["K-802"],
          card: {
            title: "Check spelling",
            instruction: "Check spelling and write .conductor/artifacts/<card-index>-<slugified-card-title>.md with corrections and proof.",
          },
          requires: { self: [0], dependents: [{ card: 1, add_requires: ["N"] }] },
        },
      ],
    },
    "integration-add-quality-1.json": { verdict: "PASS", feedback: "Card is valid.", passed: [{ knowledge_id: "K-802", reason: "valid card" }] },
    "order-checker-1.json": { verdict: "PASS", feedback: "Graph is valid.", approved_edges: [{ from: 0, to: 2 }, { from: 2, to: 1 }] },
    "integration-add-checker-1.json": {
      verdict: "FAIL",
      feedback: "Valid card, wrong insight.",
      failed: [{ knowledge_id: "K-802", problem: "Insight asked for image compression, not spelling.", required_repair: "Add an image compression card." }],
      repair_prompt: "Add image compression.",
    },
  }, () => cli(["integrate", "--dir", ".conductor/wrong-add-skill", "--run-id", "run-add-2", "--max-attempts", "1"], tmp));

  assert(r.code === 0, `wrong add should be dismissed honestly:\n${r.out}`);
  const cards = JSON.parse(fs.readFileSync(path.join(root, "cards.json"), "utf8"));
  const workflow = JSON.parse(fs.readFileSync(path.join(root, "workflow.json"), "utf8"));
  assert(cards.length === cardsDoc.length, `wrong card should not append:\n${JSON.stringify(cards, null, 2)}`);
  assert(JSON.stringify(workflow.steps.map((step) => step.requires)) === JSON.stringify(workflowDoc.steps.map((step) => step.requires)), `workflow should stay unchanged:\n${JSON.stringify(workflow, null, 2)}`);
  const knowledge = JSON.parse(fs.readFileSync(path.join(root, "knowledge.json"), "utf8"));
  assert(knowledge.items[0].status === "dismissed" && /can't add card/.test(knowledge.items[0].dismissed_reason), `add item should be dismissed:\n${JSON.stringify(knowledge, null, 2)}`);
});

test("integrate: add-card cycle placement is dismissed and graph unchanged", () => {
  const tmp = tmpdir();
  const root = path.join(tmp, ".conductor", "cycle-add-skill");
  fs.mkdirSync(root, { recursive: true });
  const cardsDoc = [
    { title: "A", instruction: "Do A." },
    { title: "B", instruction: "Do B." },
  ];
  const workflowDoc = {
    conductor: "3.0.0",
    name: "cycle-add-skill",
    description: "Cycle add skill.",
    steps: [
      { title: "A", instruction: "Do A.", requires: [] },
      { title: "B", instruction: "Do B.", requires: [0] },
    ],
  };
  writeFile(tmp, ".conductor/cycle-add-skill/cards.json", JSON.stringify(cardsDoc, null, 2));
  writeFile(tmp, ".conductor/cycle-add-skill/workflow.json", JSON.stringify(workflowDoc, null, 2));
  writeFile(tmp, ".conductor/cycle-add-skill/knowledge.json", JSON.stringify({
    items: [
      { id: "K-803", source_card: 0, tag: "add-card", title: "Add impossible middle card", detail: "Add a card between A and B.", status: "open" },
    ],
  }, null, 2));

  const r = withDecomposeFixtures(tmp, {
    "integration-add-1.json": {
      changes: [
        {
          type: "add_card",
          knowledge_ids: ["K-803"],
          card: {
            title: "Middle proof",
            instruction: "Produce middle proof and write .conductor/artifacts/<card-index>-<slugified-card-title>.md with proof.",
          },
          requires: { self: [1], dependents: [{ card: 1, add_requires: ["N"] }] },
        },
      ],
    },
    "integration-add-quality-1.json": { verdict: "PASS", feedback: "Card is valid.", passed: [{ knowledge_id: "K-803", reason: "valid card" }] },
  }, () => cli(["integrate", "--dir", ".conductor/cycle-add-skill", "--run-id", "run-add-3", "--max-attempts", "1"], tmp));

  assert(r.code === 0, `cycle add should be dismissed honestly:\n${r.out}`);
  const cards = JSON.parse(fs.readFileSync(path.join(root, "cards.json"), "utf8"));
  const workflow = JSON.parse(fs.readFileSync(path.join(root, "workflow.json"), "utf8"));
  assert(cards.length === 2, `cycle card should not append:\n${JSON.stringify(cards, null, 2)}`);
  assert(JSON.stringify(workflow.steps.map((step) => step.requires)) === JSON.stringify(workflowDoc.steps.map((step) => step.requires)), `cycle graph should not ship:\n${JSON.stringify(workflow, null, 2)}`);
  const knowledge = JSON.parse(fs.readFileSync(path.join(root, "knowledge.json"), "utf8"));
  assert(knowledge.items[0].status === "dismissed", `cycle item should be dismissed:\n${JSON.stringify(knowledge, null, 2)}`);
});

test("integrate: non-add knowledge cannot smuggle add_card", () => {
  const tmp = tmpdir();
  fs.mkdirSync(path.join(tmp, ".conductor", "smuggle-add-skill"), { recursive: true });
  writeFile(tmp, ".conductor/smuggle-add-skill/cards.json", JSON.stringify([
    { title: "Research", instruction: "Research." },
  ], null, 2));
  writeFile(tmp, ".conductor/smuggle-add-skill/workflow.json", JSON.stringify({
    conductor: "3.0.0",
    name: "smuggle-add-skill",
    description: "Smuggle add skill.",
    steps: [
      { title: "Research", instruction: "Research.", requires: [] },
    ],
  }, null, 2));
  writeFile(tmp, ".conductor/smuggle-add-skill/knowledge.json", JSON.stringify({
    items: [
      { id: "K-804", source_card: 0, title: "Mention sources", detail: "Research should mention sources.", status: "open" },
    ],
  }, null, 2));

  const r = withDecomposeFixtures(tmp, {
    "integration-1.json": {
      changes: [
        {
          type: "add_card",
          knowledge_ids: ["K-804"],
          card: { title: "Extra", instruction: "Write .conductor/artifacts/<card-index>-<slugified-card-title>.md." },
          requires: { self: [], dependents: [] },
        },
      ],
    },
    "integration-checker-1.json": {
      verdict: "PASS",
      feedback: "Bad fixture incorrectly approves smuggling.",
      passed_patches: [{ knowledge_id: "K-804", reason: "bad fixture" }],
    },
  }, () => cli(["integrate", "--dir", ".conductor/smuggle-add-skill", "--run-id", "run-add-4"], tmp));

  assert(r.code !== 0, `add smuggling should be mechanically rejected:\n${r.out}`);
  assert(/unsupported integration change type|only edit_instruction/.test(r.out), `expected add_card rejection:\n${r.out}`);
});

test("integrate: atomic instruction plus add-card does not commit edit when add fails", () => {
  const tmp = tmpdir();
  const root = path.join(tmp, ".conductor", "atomic-add-skill");
  fs.mkdirSync(root, { recursive: true });
  writeFile(tmp, ".conductor/atomic-add-skill/cards.json", JSON.stringify([
    { title: "Publish", instruction: "Publish the page." },
  ], null, 2));
  writeFile(tmp, ".conductor/atomic-add-skill/workflow.json", JSON.stringify({
    conductor: "3.0.0",
    name: "atomic-add-skill",
    description: "Atomic add skill.",
    steps: [
      { title: "Publish", instruction: "Publish the page.", requires: [] },
    ],
  }, null, 2));
  writeFile(tmp, ".conductor/atomic-add-skill/knowledge.json", JSON.stringify({
    items: [
      { id: "K-805", source_card: 0, tags: ["instruction", "add-card"], title: "Compress before publish", detail: "Publish should mention compression and add a compression card.", status: "open" },
    ],
  }, null, 2));

  const r = withDecomposeFixtures(tmp, {
    "integration-1.json": {
      changes: [
        { type: "edit_instruction", card: 0, knowledge_ids: ["K-805"], new_instruction: "Publish the page after compression.", change: "Mentions compression." },
      ],
    },
    "integration-checker-1.json": {
      verdict: "PASS",
      feedback: "Instruction facet passed.",
      passed_patches: [{ card: 0, knowledge_ids: ["K-805"], reason: "Instruction mentions compression." }],
    },
    "integration-add-1.json": {
      changes: [
        {
          type: "add_card",
          knowledge_ids: ["K-805"],
          card: { title: "Compression", instruction: "Think about compression." },
          requires: { self: [], dependents: [] },
        },
      ],
    },
    "integration-add-quality-1.json": {
      verdict: "FAIL",
      feedback: "Card has no verifiable receipt.",
      failed: [{ knowledge_id: "K-805", problem: "No receipt.", required_repair: "Require the markdown receipt and proof." }],
    },
  }, () => cli(["integrate", "--dir", ".conductor/atomic-add-skill", "--run-id", "run-add-5", "--max-attempts", "1"], tmp));

  assert(r.code === 0, `failed add facet should dismiss whole insight:\n${r.out}`);
  const cards = JSON.parse(fs.readFileSync(path.join(root, "cards.json"), "utf8"));
  assert(cards.length === 1 && cards[0].instruction === "Publish the page.", `instruction should not commit alone and no card should append:\n${JSON.stringify(cards, null, 2)}`);
  const knowledge = JSON.parse(fs.readFileSync(path.join(root, "knowledge.json"), "utf8"));
  assert(knowledge.items[0].status === "dismissed", `atomic item should be dismissed:\n${JSON.stringify(knowledge, null, 2)}`);
});

test("integrate: remove-card neuters in place and sets retired display flag", () => {
  const tmp = tmpdir();
  const root = path.join(tmp, ".conductor", "remove-skill");
  fs.mkdirSync(root, { recursive: true });
  const cardsDoc = [
    { title: "Research", instruction: "Research the page." },
    { title: "Old audit", instruction: "Run the obsolete audit and write the audit receipt." },
    { title: "Publish", instruction: "Publish the final page." },
  ];
  const workflowDoc = {
    conductor: "3.0.0",
    name: "remove-skill",
    description: "Remove skill.",
    steps: [
      { title: "Research", instruction: "Research the page.", requires: [] },
      { title: "Old audit", instruction: "Run the obsolete audit and write the audit receipt.", requires: [0] },
      { title: "Publish", instruction: "Publish the final page.", requires: [1] },
    ],
  };
  writeFile(tmp, ".conductor/remove-skill/cards.json", JSON.stringify(cardsDoc, null, 2));
  writeFile(tmp, ".conductor/remove-skill/workflow.json", JSON.stringify(workflowDoc, null, 2));
  writeFile(tmp, ".conductor/remove-skill/knowledge.json", JSON.stringify({
    items: [
      { id: "K-901", source_card: 1, tag: "remove-card", title: "Retire old audit", detail: "The old audit card is obsolete and should be retired.", status: "open" },
    ],
  }, null, 2));

  const r = withDecomposeFixtures(tmp, {
    "integration-remove-1.json": {
      changes: [
        { type: "remove_card", knowledge_ids: ["K-901"], card: 1, change: "Retired obsolete audit card." },
      ],
    },
    "integration-remove-checker-1.json": {
      verdict: "PASS",
      feedback: "The requested card is targeted.",
      passed: [{ knowledge_id: "K-901", reason: "Old audit is the obsolete card." }],
    },
    "integration-remove-safety-1.json": {
      verdict: "SAFE",
      feedback: "No surviving card consumes old audit output.",
      dependents: [],
    },
  }, () => cli(["integrate", "--dir", ".conductor/remove-skill", "--run-id", "run-remove-1"], tmp));

  assert(r.code === 0, `remove-card integration should pass:\n${r.out}`);
  const cards = JSON.parse(fs.readFileSync(path.join(root, "cards.json"), "utf8"));
  const workflow = JSON.parse(fs.readFileSync(path.join(root, "workflow.json"), "utf8"));
  assert(cards.length === 3 && workflow.steps.length === 3, "remove_card must not change array length");
  assert(cards[1].title === "Old audit" && workflow.steps[1].title === "Old audit", "remove_card must not renumber or rename");
  assert(workflow.steps[1].retired === true && workflow.steps[1].retired_by === "K-901", `retired flag missing:\n${JSON.stringify(workflow.steps[1], null, 2)}`);
  assert(/retired by K-901/.test(cards[1].instruction) && /no work is required/.test(cards[1].instruction), `card was not neutered:\n${cards[1].instruction}`);
  assert(JSON.stringify(workflow.steps.map((step) => step.requires)) === JSON.stringify(workflowDoc.steps.map((step) => step.requires)), `requires should stay untouched:\n${JSON.stringify(workflow, null, 2)}`);
  const knowledge = JSON.parse(fs.readFileSync(path.join(root, "knowledge.json"), "utf8"));
  assert(knowledge.items[0].status === "applied" && knowledge.items[0].applied_card === 1, `remove item should be applied:\n${JSON.stringify(knowledge, null, 2)}`);
});

test("integrate: remove-card orphan scan blocks surviving consumers", () => {
  const tmp = tmpdir();
  const root = path.join(tmp, ".conductor", "orphan-remove-skill");
  fs.mkdirSync(root, { recursive: true });
  const cardsDoc = [
    { title: "Research", instruction: "Research the page." },
    { title: "Image manifest", instruction: "Create the image manifest artifact." },
    { title: "Attach images", instruction: "Attach images using the image manifest artifact from the Image manifest card." },
  ];
  const workflowDoc = {
    conductor: "3.0.0",
    name: "orphan-remove-skill",
    description: "Orphan remove skill.",
    steps: [
      { title: "Research", instruction: "Research the page.", requires: [] },
      { title: "Image manifest", instruction: "Create the image manifest artifact.", requires: [0] },
      { title: "Attach images", instruction: "Attach images using the image manifest artifact from the Image manifest card.", requires: [1] },
    ],
  };
  writeFile(tmp, ".conductor/orphan-remove-skill/cards.json", JSON.stringify(cardsDoc, null, 2));
  writeFile(tmp, ".conductor/orphan-remove-skill/workflow.json", JSON.stringify(workflowDoc, null, 2));
  writeFile(tmp, ".conductor/orphan-remove-skill/knowledge.json", JSON.stringify({
    items: [
      { id: "K-902", source_card: 1, tag: "remove-card", title: "Remove manifest", detail: "Retire the image manifest card.", status: "open" },
    ],
  }, null, 2));

  const r = withDecomposeFixtures(tmp, {
    "integration-remove-1.json": {
      changes: [
        { type: "remove_card", knowledge_ids: ["K-902"], card: 1, change: "Retire image manifest." },
      ],
    },
    "integration-remove-checker-1.json": {
      verdict: "PASS",
      feedback: "The manifest card was targeted.",
      passed: [{ knowledge_id: "K-902", reason: "Targets image manifest." }],
    },
    "integration-remove-safety-1.json": {
      verdict: "UNSAFE",
      feedback: "Card 2 still consumes the manifest output.",
      dependents: [{ card: 2, reference: "Attach images uses the image manifest artifact." }],
      repair_prompt: "Rewrite Attach images before retiring the manifest card.",
    },
  }, () => cli(["integrate", "--dir", ".conductor/orphan-remove-skill", "--run-id", "run-remove-2", "--max-attempts", "1"], tmp));

  assert(r.code === 0, `unsafe remove should be dismissed honestly:\n${r.out}`);
  const cards = JSON.parse(fs.readFileSync(path.join(root, "cards.json"), "utf8"));
  const workflow = JSON.parse(fs.readFileSync(path.join(root, "workflow.json"), "utf8"));
  assert(cards[1].instruction === cardsDoc[1].instruction && workflow.steps[1].retired !== true, `unsafe remove should not mutate card:\n${JSON.stringify({ cards, workflow }, null, 2)}`);
  const knowledge = JSON.parse(fs.readFileSync(path.join(root, "knowledge.json"), "utf8"));
  assert(knowledge.items[0].status === "dismissed" && /can't remove card/.test(knowledge.items[0].dismissed_reason), `unsafe item should be dismissed:\n${JSON.stringify(knowledge, null, 2)}`);
});

test("integrate: remove coverage rejects wrong target", () => {
  const tmp = tmpdir();
  const root = path.join(tmp, ".conductor", "wrong-remove-skill");
  fs.mkdirSync(root, { recursive: true });
  writeFile(tmp, ".conductor/wrong-remove-skill/cards.json", JSON.stringify([
    { title: "Keep", instruction: "Keep this card." },
    { title: "Retire me", instruction: "This card is obsolete." },
  ], null, 2));
  writeFile(tmp, ".conductor/wrong-remove-skill/workflow.json", JSON.stringify({
    conductor: "3.0.0",
    name: "wrong-remove-skill",
    description: "Wrong remove skill.",
    steps: [
      { title: "Keep", instruction: "Keep this card.", requires: [] },
      { title: "Retire me", instruction: "This card is obsolete.", requires: [] },
    ],
  }, null, 2));
  writeFile(tmp, ".conductor/wrong-remove-skill/knowledge.json", JSON.stringify({
    items: [
      { id: "K-903", source_card: 1, tag: "remove-card", title: "Retire obsolete card", detail: "Retire the Retire me card.", status: "open" },
    ],
  }, null, 2));

  const r = withDecomposeFixtures(tmp, {
    "integration-remove-1.json": {
      changes: [
        { type: "remove_card", knowledge_ids: ["K-903"], card: 0, change: "Wrong card." },
      ],
    },
    "integration-remove-checker-1.json": {
      verdict: "FAIL",
      feedback: "Wrong card targeted.",
      failed: [{ knowledge_id: "K-903", problem: "Insight asked to retire card 1.", required_repair: "Target card 1." }],
      repair_prompt: "Target card 1.",
    },
  }, () => cli(["integrate", "--dir", ".conductor/wrong-remove-skill", "--run-id", "run-remove-3", "--max-attempts", "1"], tmp));

  assert(r.code === 0, `wrong remove should be dismissed honestly:\n${r.out}`);
  const workflow = JSON.parse(fs.readFileSync(path.join(root, "workflow.json"), "utf8"));
  assert(workflow.steps.every((step) => step.retired !== true), `wrong target should not retire anything:\n${JSON.stringify(workflow, null, 2)}`);
});

test("integrate: non-remove knowledge cannot smuggle remove_card", () => {
  const tmp = tmpdir();
  fs.mkdirSync(path.join(tmp, ".conductor", "smuggle-remove-skill"), { recursive: true });
  writeFile(tmp, ".conductor/smuggle-remove-skill/cards.json", JSON.stringify([
    { title: "Research", instruction: "Research." },
  ], null, 2));
  writeFile(tmp, ".conductor/smuggle-remove-skill/workflow.json", JSON.stringify({
    conductor: "3.0.0",
    name: "smuggle-remove-skill",
    description: "Smuggle remove skill.",
    steps: [
      { title: "Research", instruction: "Research.", requires: [] },
    ],
  }, null, 2));
  writeFile(tmp, ".conductor/smuggle-remove-skill/knowledge.json", JSON.stringify({
    items: [
      { id: "K-904", source_card: 0, title: "Mention sources", detail: "Research should mention sources.", status: "open" },
    ],
  }, null, 2));

  const r = withDecomposeFixtures(tmp, {
    "integration-1.json": {
      changes: [
        { type: "remove_card", knowledge_ids: ["K-904"], card: 0, change: "Illegally retires a normal instruction item." },
      ],
    },
    "integration-checker-1.json": {
      verdict: "PASS",
      feedback: "Bad fixture incorrectly approves smuggling.",
      passed_patches: [{ knowledge_id: "K-904", reason: "bad fixture" }],
    },
  }, () => cli(["integrate", "--dir", ".conductor/smuggle-remove-skill", "--run-id", "run-remove-4"], tmp));

  assert(r.code !== 0, `remove smuggling should be mechanically rejected:\n${r.out}`);
  assert(/unsupported integration change type|only edit_instruction/.test(r.out), `expected remove_card rejection:\n${r.out}`);
});

test("integrate: atomic instruction plus remove-card does not commit edit when remove fails", () => {
  const tmp = tmpdir();
  const root = path.join(tmp, ".conductor", "atomic-remove-skill");
  fs.mkdirSync(root, { recursive: true });
  writeFile(tmp, ".conductor/atomic-remove-skill/cards.json", JSON.stringify([
    { title: "Manifest", instruction: "Create manifest." },
    { title: "Consumer", instruction: "Use the Manifest output." },
  ], null, 2));
  writeFile(tmp, ".conductor/atomic-remove-skill/workflow.json", JSON.stringify({
    conductor: "3.0.0",
    name: "atomic-remove-skill",
    description: "Atomic remove skill.",
    steps: [
      { title: "Manifest", instruction: "Create manifest.", requires: [] },
      { title: "Consumer", instruction: "Use the Manifest output.", requires: [0] },
    ],
  }, null, 2));
  writeFile(tmp, ".conductor/atomic-remove-skill/knowledge.json", JSON.stringify({
    items: [
      { id: "K-905", source_card: 0, tags: ["instruction", "remove-card"], title: "Retire manifest after noting why", detail: "Document that the manifest is retired and retire the card.", status: "open" },
    ],
  }, null, 2));

  const r = withDecomposeFixtures(tmp, {
    "integration-1.json": {
      changes: [
        { type: "edit_instruction", card: 0, knowledge_ids: ["K-905"], new_instruction: "Create manifest and document why it may be retired.", change: "Instruction facet." },
      ],
    },
    "integration-checker-1.json": {
      verdict: "PASS",
      feedback: "Instruction facet passed.",
      passed_patches: [{ card: 0, knowledge_ids: ["K-905"], reason: "Instruction mentions retirement." }],
    },
    "integration-remove-1.json": {
      changes: [
        { type: "remove_card", knowledge_ids: ["K-905"], card: 0, change: "Retire manifest." },
      ],
    },
    "integration-remove-checker-1.json": {
      verdict: "PASS",
      feedback: "Target is right.",
      passed: [{ knowledge_id: "K-905", reason: "Manifest targeted." }],
    },
    "integration-remove-safety-1.json": {
      verdict: "UNSAFE",
      feedback: "Consumer still uses manifest.",
      dependents: [{ card: 1, reference: "Uses Manifest output." }],
      repair_prompt: "Rewrite Consumer before retiring Manifest.",
    },
  }, () => cli(["integrate", "--dir", ".conductor/atomic-remove-skill", "--run-id", "run-remove-5", "--max-attempts", "1"], tmp));

  assert(r.code === 0, `failed remove facet should dismiss whole insight:\n${r.out}`);
  const cards = JSON.parse(fs.readFileSync(path.join(root, "cards.json"), "utf8"));
  const workflow = JSON.parse(fs.readFileSync(path.join(root, "workflow.json"), "utf8"));
  assert(cards[0].instruction === "Create manifest." && workflow.steps[0].retired !== true, `instruction should not commit alone and card should not retire:\n${JSON.stringify({ cards, workflow }, null, 2)}`);
  const knowledge = JSON.parse(fs.readFileSync(path.join(root, "knowledge.json"), "utf8"));
  assert(knowledge.items[0].status === "dismissed", `atomic remove item should be dismissed:\n${JSON.stringify(knowledge, null, 2)}`);
});

test("test: runs a clean temp structural E2E and cleans up", () => {
  const tmp = tmpdir();
  const skill = writeFile(tmp, "SKILL.md", `# DevOps Skill

## Workflow

1. Inspect the deployment configuration.
2. Validate the rollback command.
`);
  const r = withDecomposeFixtures(tmp, {
    "composer-1.json": {
      cards: [
        { title: "Inspect deployment", instruction: "Inspect the deployment configuration and write the relevant settings found." },
        { title: "Validate rollback", instruction: "Validate the rollback command and write the exact command plus validation result." },
      ],
    },
    "checker-1.json": { verdict: "PASS", feedback: "Cards preserve the workflow and produce observable outputs." },
  }, () => cli(["test", "--skill", skill], tmp));
  assert(r.code === 0, `test runner should pass:\n${r.out}`);
  assert(/cards_created: 2/.test(r.out), `expected card count:\n${r.out}`);
  assert(/cards_completed: 2/.test(r.out), `expected completed count:\n${r.out}`);
  assert(/run_status: done/.test(r.out), `expected done status:\n${r.out}`);
  const tempMatch = r.out.match(/temp: (\/tmp\/conductor-test-[^\s]+)/);
  assert(tempMatch && !fs.existsSync(tempMatch[1]), `temp dir should be deleted: ${tempMatch?.[1]}`);
});

// ── coverage: every designed card must be present in the conductor ─────────────

// A conductor that FOLDS the paid recon into pick-batch (the real treatment-readability bug).
const FOLDED = json({
  conductor: "3.0.0",
  name: "tr",
  description: "d",
  steps: [
    { id: "setup-branch", title: "Setup branch", instruction: "branch", requires: [] },
    {
      id: "pick-batch",
      title: "Pick batch",
      instruction:
        "FIRST prefetch the paid recon:\n" +
        "  npx tsx scripts/tr.ts prefetch-popular --count 25\n" +
        "THEN claim the batch:\n" +
        "  npx tsx scripts/tr.ts next --count 5\n",
      requires: ["setup-branch"],
    },
    { id: "report", title: "Report", instruction: "report", requires: ["pick-batch"] },
  ],
});
const COVERAGE_CARDS = json([
  { id: "setup-branch", title: "Setup branch", instruction: "Create the branch." },
  { id: "buy-dataforseo-recon", title: "Buy DataForSEO recon", instruction: "Prefetch paid recon." },
  { id: "pick-batch", title: "Pick batch", instruction: "Claim the batch." },
  { id: "report", title: "Report", instruction: "Report the result." },
]);

test("coverage: fails (exit 1) and names cards missing from the conductor", () => {
  const tmp = tmpdir();
  const cards = writeFile(tmp, ".conductor/cards.json", COVERAGE_CARDS);
  const c = writeFile(tmp, ".conductor/workflow.json", FOLDED);
  const r = cli(["coverage", "--cards", cards, "--conductor", c], tmp);
  assert(r.code === 1, `expected exit 1 on a missing card, got ${r.code}:\n${r.out}`);
  assert(/card 3: Report/.test(r.out), `expected the missing card index/title:\n${r.out}`);
  assert(/missing card/.test(r.out), `expected a missing-card message:\n${r.out}`);
});

test("coverage: passes (exit 0) once every card — incl. loop sub-steps — is present", () => {
  const tmp = tmpdir();
  const fixed = mutateDoc(FOLDED, (doc) => {
    doc.steps.splice(1, 0, {
      id: "buy-dataforseo-recon",
      title: "Buy DataForSEO recon",
      instruction: "buy",
      requires: ["setup-branch"],
    });
    doc.steps = doc.steps.filter((s) => s.id !== "report");
    doc.steps.push({
      id: "polish-and-ship",
      title: "Polish and ship",
      instruction: "Polish and ship.",
      type: "loop",
      over: "xs",
      as: "x",
      requires: ["pick-batch"],
      steps: [{ id: "report", title: "Report", instruction: "report", requires: [] }],
    });
  });
  const cards = writeFile(tmp, ".conductor/cards.json", COVERAGE_CARDS);
  const c = writeFile(tmp, ".conductor/workflow.json", fixed);
  const r = cli(["coverage", "--cards", cards, "--conductor", c], tmp);
  assert(r.code === 0, `expected exit 0 when all cards are present, got ${r.code}:\n${r.out}`);
  assert(/all 4 cards are present/.test(r.out), `expected the all-covered message:\n${r.out}`);
});

test("coverage: errors clearly when cards.json is missing", () => {
  const tmp = tmpdir();
  const c = writeFile(tmp, ".conductor/workflow.json", FOLDED);
  const r = cli(["coverage", "--cards", path.join(tmp, "nope.json"), "--conductor", c], tmp);
  assert(r.code === 1 && /no cards\.json/i.test(r.out), `expected a missing-cards error:\n${r.out}`);
});

// ── cards: card-design output before dependencies exist ────────────────

const CARDS_OK = json([
  { title: "Gather", instruction: "Gather sources." },
  { title: "Build", instruction: "Build the thing." },
]);

test("cards: passes when entries have title/instruction only", () => {
  const tmp = tmpdir();
  const cards = writeFile(tmp, ".conductor/cards.json", CARDS_OK);
  const skill = writeFile(tmp, "skill.md", "Create a treatment page.");
  const r = cli(["cards", cards, "--skill", skill], tmp);
  assert(r.code === 0, `expected valid cards to pass:\n${r.out}`);
  assert(/2 cards valid/.test(r.out), `expected card count:\n${r.out}`);
});

test("cards: rejects id, missing instruction, gate, and dependency fields", () => {
  const tmp = tmpdir();
  const cards = writeFile(tmp, ".conductor/cards.json", json([
    { id: "Bad_ID", title: "Bad id", instruction: "Done.", gate: { command: "true" } },
    { id: "write-page", title: "Write page" },
    { id: "write-page", title: "Duplicate page", instruction: "Duplicate.", dependencies: ["Bad_ID"] },
  ]));
  const r = cli(["cards", cards], tmp);
  assert(r.code === 1, `expected invalid cards to fail:\n${r.out}`);
  assert(/forbidden field "id"/.test(r.out), `expected id forbidden error:\n${r.out}`);
  assert(/missing instruction/.test(r.out), `expected missing instruction error:\n${r.out}`);
  assert(/forbidden field "gate"/.test(r.out), `expected gate forbidden:\n${r.out}`);
  assert(/forbidden field "dependencies"/.test(r.out), `expected dependencies forbidden:\n${r.out}`);
});

test("validate: backstop warns (exit 0) when one step bundles 2+ distinct tool commands", () => {
  const tmp = tmpdir();
  const c = writeFile(tmp, "c.json", FOLDED);
  const r = cli(["validate", c], tmp);
  assert(r.code === 0, `backstop is a warning, must not fail validation: exit ${r.code}\n${r.out}`);
  assert(/bundles 2 distinct commands/.test(r.out), `expected the folded-phase warning:\n${r.out}`);
  assert(/prefetch-popular/.test(r.out) && /\bnext\b/.test(r.out), `expected the distinguishing subcommands shown:\n${r.out}`);
});

test("validate: backstop stays quiet for a single-command step (no false positive)", () => {
  const tmp = tmpdir();
  const ok = json({
    conductor: "3.0.0",
    name: "t",
    description: "d",
    steps: [
      {
        id: "claim-batch",
        title: "Claim batch",
        instruction: "Claim the batch:\n  npx tsx scripts/tr.ts next --count 5\n",
        requires: [],
      },
      {
        id: "setup-branch",
        title: "Setup branch",
        instruction: "mkdir -p runs/today\ngit switch -C work origin/main\n",
        requires: [],
      },
    ],
  });
  const c = writeFile(tmp, "c.json", ok);
  const r = cli(["validate", c], tmp);
  assert(r.code === 0, `expected valid:\n${r.out}`);
  assert(!/bundles \d+ distinct commands/.test(r.out), `single-command + scaffolding steps must not warn:\n${r.out}`);
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
