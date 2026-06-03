#!/usr/bin/env node
// Dev tool: walk a conductor and write .conductor/status.json over time so the
// board animates through Pending -> Running -> Gate Check -> Done (and Failed).
// Not part of the shipped package — purely for demos and manual testing.
//
//   node scripts/simulate.js [conductor.yaml] [--dir .conductor] [--loop] [--fail seo-check]

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : def;
};
const conductorArg = args.find((a) => !a.startsWith("-") && /\.ya?ml$/.test(a));
const dir = path.resolve(process.cwd(), flag("--dir", ".conductor"));
const loop = args.includes("--loop");
const failStep = flag("--fail", null);
const SPEED = Number(flag("--speed", 1)) || 1;

const conductorPath =
  conductorArg ?? path.join(dir, "conductor.yaml");
if (!fs.existsSync(conductorPath)) {
  console.error(`conductor not found: ${conductorPath}`);
  process.exit(1);
}

const doc = yaml.load(fs.readFileSync(conductorPath, "utf8"));
const steps = (doc.steps || []).filter((s) => s && s.id);
fs.mkdirSync(dir, { recursive: true });
const statusPath = path.join(dir, "status.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms / SPEED));
const nowIso = () => new Date().toISOString();
const gateCount = (s) => (Array.isArray(s.gate) ? s.gate.length : 0);

function write(state) {
  fs.writeFileSync(statusPath, JSON.stringify(state, null, 2));
}

function gateDetail(step, passed) {
  if (!Array.isArray(step.gate)) return undefined;
  return step.gate.map((g) => {
    const isHard = g && typeof g === "object" && typeof g.check === "string";
    return {
      criterion: isHard ? g.check : String(g),
      kind: isHard ? "hard" : "soft",
      passed,
      ...(isHard ? { exit_code: passed ? 0 : 1 } : {}),
    };
  });
}

async function run() {
  const state = {
    conductor: "1.0.0",
    workflow: doc.name || "workflow",
    started_at: nowIso(),
    status: "running",
    current_step: null,
    steps: {},
  };
  for (const s of steps) state.steps[s.id] = { status: "pending", gate: "pending", attempt: 1 };
  write(state);
  await sleep(700);

  // Simple linear walk honoring conditions: take if_true when present.
  let i = 0;
  const indexById = new Map(steps.map((s, idx) => [s.id, idx]));
  const visited = new Set();

  while (i < steps.length) {
    const step = steps[i];
    if (visited.has(step.id)) {
      i++;
      continue;
    }
    visited.add(step.id);
    state.current_step = step.id;
    const entry = state.steps[step.id];

    // running
    entry.status = "running";
    entry.started_at = nowIso();
    write({ ...state });
    await sleep(1100);

    if (step.type === "condition") {
      const branch = step.if_true || step.if_false;
      entry.status = "done";
      entry.gate = "passed";
      entry.completed_at = nowIso();
      entry.branch_taken = branch;
      write({ ...state });
      await sleep(700);
      i = indexById.get(branch) ?? i + 1;
      continue;
    }

    // gate check phase
    if (gateCount(step) > 0) {
      entry.gate = "checking";
      write({ ...state });
      await sleep(1300);
    }

    const shouldFail = failStep === step.id && entry.attempt === 1;
    if (shouldFail) {
      entry.gate = "failed";
      entry.gate_detail = gateDetail(step, false);
      write({ ...state });
      await sleep(1100);
      // retry
      entry.attempt = 2;
      entry.gate = "pending";
      entry.status = "running";
      write({ ...state });
      await sleep(1100);
      entry.gate = "checking";
      write({ ...state });
      await sleep(1300);
    }

    entry.status = "done";
    entry.gate = gateCount(step) > 0 ? "passed" : "pending";
    entry.gate_detail = gateDetail(step, true);
    entry.completed_at = nowIso();
    write({ ...state });
    await sleep(600);

    // jump to `then` rejoin if present
    if (step.then && indexById.has(step.then)) {
      i = indexById.get(step.then);
    } else {
      i++;
    }
  }

  state.status = "done";
  state.current_step = null;
  write({ ...state });
  console.log("✓ workflow complete");
}

(async () => {
  do {
    await run();
    if (loop) await sleep(2500);
  } while (loop);
})();
