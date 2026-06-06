/**
 * Feature smoke test — every MAIN conductor feature through the REAL CLI.
 *
 * Where loops.smoke.ts goes deep on one feature (loop rendering), this goes WIDE:
 * 50+ real-world scenarios a future user will actually hit, each invoking
 * `node bin/cli.js …` exactly as a user/agent would and asserting on the real
 * exit code + stdout/stderr + the on-disk status.json / conductor.json.
 *
 * Coverage map (feature → scenarios):
 *   init        scaffold, flags, clamp, --force refuse/overwrite, generated-json-validates
 *   validate    every VALID shape (linear/loop/condition/parallel/DAG) +
 *               every INVALID path the validator can emit (16 distinct rules)
 *   status-init linear, run-id, goal, auto_improve off, Phase-0 injection, loop type
 *   step/gate   running/done/failed transitions, current_step, gate states, errors
 *   heartbeat   append, insight tags, finalBeat handoff, loop-sub bubble, errors
 *   check       independent instruction checker + heuristic fallback
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
    env: { ...process.env, OPENAI_API_KEY: "" },
  });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function tmpdir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "feat-smoke-"));
  fs.mkdirSync(path.join(d, ".conductor"), { recursive: true });
  return d;
}
/** Write a conductor.json into <tmp>/.conductor and return tmp. */
function withConductor(jsonStr) {
  const tmp = tmpdir();
  fs.writeFileSync(path.join(tmp, ".conductor", "conductor.json"), jsonStr);
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
  const f = path.join(tmp, ".conductor", "conductor.json");
  assert(fs.existsSync(f), "conductor.json not created");
  const body = fs.readFileSync(f, "utf8");
  assert(stepCount(body) === 4, `expected 4 steps, got:\n${body}`);
  const v = cli(["validate", f], tmp);
  assert(v.code === 0, `scaffolded conductor did not validate:\n${v.out}`);
});

test("init: --steps 1 produces a single-step conductor", () => {
  const tmp = tmpdir();
  const r = cli(["init", "--name", "one", "--steps", "1"], tmp);
  assert(r.code === 0, r.out);
  const body = fs.readFileSync(path.join(tmp, ".conductor", "conductor.json"), "utf8");
  assert(stepCount(body) === 1, `expected 1 step:\n${body}`);
});

test("init: --steps 99 clamps to 50", () => {
  const tmp = tmpdir();
  cli(["init", "--name", "big", "--steps", "99"], tmp);
  const body = fs.readFileSync(path.join(tmp, ".conductor", "conductor.json"), "utf8");
  assert(stepCount(body) === 50, "expected clamp to 50 steps");
});

test("init: --steps 0 falls back to the 3-step default", () => {
  const tmp = tmpdir();
  cli(["init", "--name", "zero", "--steps", "0"], tmp);
  const body = fs.readFileSync(path.join(tmp, ".conductor", "conductor.json"), "utf8");
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
  const body = fs.readFileSync(path.join(tmp, ".conductor", "conductor.json"), "utf8");
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
test("validate: condition step with both branches is valid", () =>
  expectValid(`{
  "conductor": "3.0.0",
  "name": "cond",
  "description": "branch.",
  "steps": [
    {
      "id": "decide",
      "title": "Decide",
      "type": "condition",
      "instruction": "Decide.",
      "requires": [],
      "if_true": "yes-path",
      "if_false": "no-path"
    },
    {
      "id": "yes-path",
      "title": "Yes path",
      "instruction": "Do yes.",
      "requires": [
        "decide"
      ]
    },
    {
      "id": "no-path",
      "title": "No path",
      "instruction": "Do no.",
      "requires": [
        "decide"
      ]
    }
  ]
}`));
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

test("validate: condition missing if_true is rejected", () =>
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
}`, "missing if_true"));

test("validate: condition missing if_false is rejected", () =>
  expectInvalid(`{
  "conductor": "2.0.0",
  "name": "c",
  "description": "d.",
  "steps": [
    {
      "id": "a",
      "type": "condition",
      "instruction": "A.",
      "if_true": "b"
    },
    {
      "id": "b",
      "instruction": "B."
    }
  ]
}`, "missing if_false"));

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

test("validate: unknown 'then' target is rejected", () =>
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
}`, 'unknown step "nowhere"'));

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
  assert(/No conductor file/.test(r.out), `expected "No conductor file":\n${r.out}`);
});

// ── STATUS-INIT ───────────────────────────────────────────────────────────────
test("status-init: linear conductor → all steps pending, running, goal carried", () => {
  const tmp = withConductor(LINEAR);
  const r = cli(["status-init", ".conductor/conductor.json"], tmp);
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
  cli(["status-init", ".conductor/conductor.json", "--run-id", "RUN-XYZ"], tmp);
  assert(status(tmp).run_id === "RUN-XYZ", "custom run_id not used");
});

test("status-init: run_name follows {slug}-run-N-{ts}", () => {
  const tmp = withConductor(LINEAR);
  cli(["status-init", ".conductor/conductor.json"], tmp);
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
  cli(["status-init", ".conductor/conductor.json"], tmp);
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
  const r = cli(["status-init", ".conductor/conductor.json"], tmp);
  assert(/Phase 0 improvement/.test(r.out), `expected Phase 0 improvement note:\n${r.out}`);
  const ids = Object.keys(status(tmp).steps);
  assert(ids.includes("_improve::read-knowledge"), "missing _improve::read-knowledge");
  assert(ids.includes("_improve::validate"), "missing _improve::validate");
  assert(ids.some((i) => i.startsWith("_improve::always")), "missing the actionable improve card");
});

test("status-init: loop step registers with type 'loop' and an iterations map", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/conductor.json"], tmp);
  const st = status(tmp).steps.run;
  assert(st.type === "loop", `expected type loop, got ${st.type}`);
  assert(st.iterations && typeof st.iterations === "object", "missing iterations map");
  assert(st.total === 0 && st.completed === 0, "loop counters should start at 0");
});

// ── STEP / GATE ───────────────────────────────────────────────────────────────
function initLinear() {
  const tmp = withConductor(LINEAR);
  cli(["status-init", ".conductor/conductor.json"], tmp);
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
  cli(["status-init", ".conductor/conductor.json"], tmp);
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
test("check: records a provisional pass when output exists and no LLM is configured", () => {
  const tmp = initLinear();
  cli(["step", "gather", "running"], tmp);
  const r = cli(["check", "gather", "--output", "Gathered source notes."], tmp);
  assert(r.code === 0, `checker should pass with output:\n${r.out}`);
  assert(/checker PASS/.test(r.out), `expected checker pass output:\n${r.out}`);
  assert(status(tmp).steps.gather.gate_detail[0].passed === true, "checker result not recorded");
});

test("check: fails when no output is recorded", () => {
  const tmp = initLinear();
  cli(["step", "gather", "running"], tmp);
  const r = cli(["check", "gather"], tmp);
  assert(r.code !== 0, "check should fail with no output");
  assert(/no output/.test(r.out), `expected no-output error:\n${r.out}`);
  assert(status(tmp).steps.gather.gate_detail[0].passed === false, "failed checker result not recorded");
});

test("check: reads output from a file", () => {
  const tmp = initLinear();
  const file = writeFile(tmp, "artifact.md", "Built artifact.");
  const r = cli(["check", "build", "--output-file", file], tmp);
  assert(r.code === 0, `checker should pass from output file:\n${r.out}`);
  assert(/artifact.md/.test(r.out), `expected output file source:\n${r.out}`);
});

test("check: fails on an unknown step id", () => {
  const tmp = initLinear();
  const r = cli(["check", "ghost"], tmp);
  assert(r.code !== 0, "check should fail on unknown step");
  assert(/no step "ghost"/.test(r.out), `expected unknown-step error:\n${r.out}`);
});

// ── COMPLETE ──────────────────────────────────────────────────────────────────
test("complete: a passing checker result advances the step to done", () => {
  const tmp = initLinear();
  cli(["gate-result", "ship", "--passed", "--evidence", "output satisfies the instruction"], tmp);
  const r = cli(["complete", "ship"], tmp);
  assert(r.code === 0, `complete should pass on checker result:\n${r.out}`);
  assert(/Checker passed/.test(r.out), `expected pass message:\n${r.out}`);
  assert(status(tmp).steps.ship.status === "done", "ship not marked done");
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
  cli(["status-init", ".conductor/conductor.json"], tmp);
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
  cli(["status-init", ".conductor/conductor.json"], tmp);
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
  cli(["status-init", ".conductor/conductor.json"], tmp);
  const record = cli(["gate-result", "review", "--passed", "--evidence", "checked by independent agent"], tmp);
  assert(record.code === 0, `gate-result should pass:\n${record.out}`);
  const after = cli(["complete", "review"], tmp);
  assert(after.code === 0, `complete should consume checker result:\n${after.out}`);
  assert(status(tmp).steps.review.status === "done", "review not done");
});

test("feedback: returns latest failure and attempts remaining", () => {
  const tmp = initLinear();
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
  cli(["status-init", ".conductor/conductor.json"], tmp);
  cli(["loop-scope", "run", "a", "b"], tmp);
  cli(["loop", "run", "a", "work", "done"], tmp); // a done, b untouched
  const r = cli(["complete", "run"], tmp);
  assert(r.code !== 0, "loop complete should be blocked by incomplete iteration b");
  assert(/incomplete iteration/.test(r.out), `expected incomplete-iteration block:\n${r.out}`);
});

test("complete: loop completes once every iteration is done", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/conductor.json"], tmp);
  cli(["loop-scope", "run", "a", "b"], tmp);
  cli(["loop", "run", "a", "work", "done"], tmp);
  cli(["loop", "run", "b", "work", "done"], tmp);
  cli(["gate-result", "run", "--passed", "--evidence", "all scoped iterations are done"], tmp);
  const r = cli(["complete", "run"], tmp);
  assert(r.code === 0, `loop complete should pass once all iters done:\n${r.out}`);
});

// ── LOOP machinery ────────────────────────────────────────────────────────────
test("loop-scope: frontloads every item as an iteration and sets total", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/conductor.json"], tmp);
  const r = cli(["loop-scope", "run", "a", "b", "c"], tmp);
  assert(r.code === 0, r.out);
  const st = status(tmp).steps.run;
  assert(st.total === 3, `expected total 3, got ${st.total}`);
  assert(["a", "b", "c"].every((k) => k in st.iterations), "not all items frontloaded");
});

test("loop-scope: warns when one quoted item hides multiple tokens (still scopes 1)", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/conductor.json"], tmp);
  const r = cli(["loop-scope", "run", "a b c"], tmp);
  assert(/space-separated tokens/.test(r.out), `expected multiword warning:\n${r.out}`);
  assert(Object.keys(status(tmp).steps.run.iterations).length === 1, "should scope as ONE iteration");
});

test("loop: sequential loop refuses an out-of-order iteration", () => {
  const tmp = withConductor(LOOP); // no parallel → sequential
  cli(["status-init", ".conductor/conductor.json"], tmp);
  cli(["loop-scope", "run", "first", "second", "third"], tmp);
  const r = cli(["loop", "run", "second", "work", "running"], tmp); // skip 'first'
  assert(r.code !== 0, "sequential loop should refuse out-of-order start");
  assert(/sequential/.test(r.out), `expected sequential refusal:\n${r.out}`);
  assert(/finish 'first'/.test(r.out), `expected blocker hint:\n${r.out}`);
});

test("loop: sequential loop allows the genuine next-in-line iteration", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/conductor.json"], tmp);
  cli(["loop-scope", "run", "first", "second"], tmp);
  const r = cli(["loop", "run", "first", "work", "running"], tmp);
  assert(r.code === 0, `first iteration should be allowed:\n${r.out}`);
});

test("loop: parallel loop is EXEMPT from the order guard", () => {
  const tmp = withConductor(PARALLEL_LOOP);
  cli(["status-init", ".conductor/conductor.json"], tmp);
  cli(["loop-scope", "run", "first", "second", "third"], tmp);
  const r = cli(["loop", "run", "third", "work", "running"], tmp); // out of order, but parallel
  assert(r.code === 0, `parallel loop should allow out-of-order:\n${r.out}`);
});

test("loop: completing all sub-steps of an iteration bumps completed, partials don't", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/conductor.json"], tmp);
  cli(["loop-scope", "run", "a", "b"], tmp);
  cli(["loop", "run", "a", "work", "done"], tmp);
  assert(status(tmp).steps.run.completed === 1, "completed should be 1 after a finishes");
  // b only started, not done
  cli(["loop", "run", "b", "work", "running"], tmp);
  assert(status(tmp).steps.run.completed === 1, "partial iteration must not count as completed");
});

test("loop-scope: duplicate items are deduped so total == distinct iterations", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/conductor.json"], tmp);
  const r = cli(["loop-scope", "run", "a", "a", "b"], tmp);
  assert(/duplicate item/.test(r.out), `expected duplicate warning:\n${r.out}`);
  const st = status(tmp).steps.run;
  assert(st.total === 2, `total should be 2 (distinct), got ${st.total}`);
  assert(Object.keys(st.iterations).length === 2, "should hold 2 distinct iterations");
  assert(st.total === Object.keys(st.iterations).length, "total must equal iteration count (no wedge)");
});

test("loop-scope: re-scoping is additive and keeps total == iteration count", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/conductor.json"], tmp);
  cli(["loop-scope", "run", "a", "b", "c"], tmp);
  cli(["loop-scope", "run", "a", "b"], tmp); // re-scope with fewer
  const st = status(tmp).steps.run;
  assert(st.total === Object.keys(st.iterations).length, `total ${st.total} != iterations ${Object.keys(st.iterations).length}`);
});

test("loop: a typo'd (undeclared) sub-step warns and does NOT falsely complete the iteration", () => {
  const tmp = withConductor(LOOP); // declared sub-step is 'work'
  cli(["status-init", ".conductor/conductor.json"], tmp);
  cli(["loop-scope", "run", "a"], tmp);
  const r = cli(["loop", "run", "a", "phantom-sub", "done"], tmp); // typo — real 'work' never done
  assert(/not a declared sub-step/.test(r.out), `expected undeclared-sub warning:\n${r.out}`);
  const st = status(tmp).steps.run;
  assert(st.completed === 0, `phantom sub must NOT complete the iteration; completed=${st.completed}`);
  assert(st.status !== "done", "loop must not be marked done off a phantom sub");
});

test("loop: completion is judged on declared sub-steps (real sub done → counts)", () => {
  const tmp = withConductor(LOOP);
  cli(["status-init", ".conductor/conductor.json"], tmp);
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
  const doc = fs.readFileSync(path.join(tmp, ".conductor", "conductor.json"), "utf8");
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
  fs.writeFileSync(path.join(tmp, ".conductor", "conductor.json"), real);
  // 2) validate
  assert(cli(["validate", ".conductor/conductor.json"], tmp).code === 0, "validate failed");
  // 3) status-init
  assert(cli(["status-init", ".conductor/conductor.json"], tmp).code === 0, "status-init failed");
  // 4) drive 'prepare' through checker and completion
  cli(["step", "prepare", "running"], tmp);
  cli(["heartbeat", "prepare", "drafting notes"], tmp);
  assert(cli(["check", "prepare", "--output", "release notes prepared"], tmp).code === 0, "prepare checker failed");
  assert(cli(["complete", "prepare"], tmp).code === 0, "prepare complete failed");
  // 5) drive 'publish' through checker and completion
  cli(["step", "publish", "running"], tmp);
  cli(["heartbeat", "publish", "publishing"], tmp);
  assert(cli(["check", "publish", "--output", "published artifact exists"], tmp).code === 0, "publish checker failed");
  assert(cli(["complete", "publish"], tmp).code === 0, "publish complete failed");
  // 6) both steps done
  const s = status(tmp);
  assert(s.steps.prepare.status === "done" && s.steps.publish.status === "done", "not all steps done");
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
  const c = writeFile(tmp, ".conductor/conductor.json", FOLDED);
  const r = cli(["coverage", "--cards", cards, "--conductor", c], tmp);
  assert(r.code === 1, `expected exit 1 on a missing card, got ${r.code}:\n${r.out}`);
  assert(/buy-dataforseo-recon/.test(r.out), `expected the missing card named:\n${r.out}`);
  assert(/missing from conductor/.test(r.out), `expected a missing-card message:\n${r.out}`);
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
  const c = writeFile(tmp, ".conductor/conductor.json", fixed);
  const r = cli(["coverage", "--cards", cards, "--conductor", c], tmp);
  assert(r.code === 0, `expected exit 0 when all cards are present, got ${r.code}:\n${r.out}`);
  assert(/all 4 cards are present/.test(r.out), `expected the all-covered message:\n${r.out}`);
});

test("coverage: errors clearly when cards.json is missing", () => {
  const tmp = tmpdir();
  const c = writeFile(tmp, ".conductor/conductor.json", FOLDED);
  const r = cli(["coverage", "--cards", path.join(tmp, "nope.json"), "--conductor", c], tmp);
  assert(r.code === 1 && /no cards\.json/i.test(r.out), `expected a missing-cards error:\n${r.out}`);
});

// ── cards: card-design output before dependencies exist ────────────────

const CARDS_OK = json([
  {
    id: "research-treatment",
    title: "Research treatment",
    instruction: "Gather source-backed treatment evidence for later mapping.",
  },
  {
    id: "write-page",
    title: "Write page",
    instruction: "Write the owner-facing treatment page draft.",
  },
]);

test("cards: passes when entries have id/title/instruction only", () => {
  const tmp = tmpdir();
  const cards = writeFile(tmp, ".conductor/cards.json", CARDS_OK);
  const skill = writeFile(tmp, "skill.md", "Create a treatment page.");
  const r = cli(["cards", cards, "--skill", skill], tmp);
  assert(r.code === 0, `expected valid cards to pass:\n${r.out}`);
  assert(/2 cards valid/.test(r.out), `expected card count:\n${r.out}`);
});

test("cards: rejects duplicate, non-kebab, missing instruction, gate, and dependency fields", () => {
  const tmp = tmpdir();
  const cards = writeFile(tmp, ".conductor/cards.json", json([
    { id: "Bad_ID", title: "Bad id", instruction: "Done.", gate: { command: "true" } },
    { id: "write-page", title: "Write page" },
    { id: "write-page", title: "Duplicate page", instruction: "Duplicate.", dependencies: ["Bad_ID"] },
  ]));
  const r = cli(["cards", cards], tmp);
  assert(r.code === 1, `expected invalid cards to fail:\n${r.out}`);
  assert(/must be kebab-case/.test(r.out), `expected kebab-case error:\n${r.out}`);
  assert(/missing instruction/.test(r.out), `expected missing instruction error:\n${r.out}`);
  assert(/forbidden field "gate"/.test(r.out), `expected gate forbidden:\n${r.out}`);
  assert(/forbidden field "dependencies"/.test(r.out), `expected dependencies forbidden:\n${r.out}`);
  assert(/duplicate id "write-page"/.test(r.out), `expected duplicate id error:\n${r.out}`);
});

test("validate: backstop warns (exit 0) when one step bundles 2+ distinct tool commands", () => {
  const tmp = tmpdir();
  const c = writeFile(tmp, "c.json", FOLDED);
  const r = cli(["validate", c], tmp);
  assert(r.code === 0, `backstop is a warning, must not fail validation: exit ${r.code}\n${r.out}`);
  assert(/pick-batch.*bundles 2 distinct commands/.test(r.out), `expected the folded-phase warning:\n${r.out}`);
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
