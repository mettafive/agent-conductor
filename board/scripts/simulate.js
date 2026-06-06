#!/usr/bin/env node
// Dev tool: walk a conductor and write .conductor/status.json over time so the
// board animates through Pending -> Running -> Checking -> Done (and Failed).
// Emits the full Phase-5 status shape — goal, current_step_goal, per-step
// heartbeats (with the occasional insight), finalBeat handoffs, learnings, and
// post-run optimization suggestions — so any example showcases the live board.
// Not part of the shipped package — purely for demos and manual testing.
//
//   node scripts/simulate.js [conductor.json] [--dir .conductor] [--loop] [--fail seo-check]

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : def;
};
const conductorArg = args.find((a) => !a.startsWith("-") && /\.json$/.test(a));
const dir = path.resolve(process.cwd(), flag("--dir", ".conductor"));
const loop = args.includes("--loop");
const failStep = flag("--fail", null);
const fatalStep = flag("--fatal", null);
const itemsArg = flag("--items", null);
const SPEED = Number(flag("--speed", 1)) || 1;

const DEFAULT_ITEMS = ["src/auth.ts", "src/api/users.ts", "db/schema.sql", "ui/Login.tsx"];
const loopItems = () =>
  itemsArg ? String(itemsArg).split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_ITEMS;

const conductorPath = conductorArg ?? path.join(dir, "conductor.json");
if (!fs.existsSync(conductorPath)) {
  console.error(`conductor not found: ${conductorPath}`);
  process.exit(1);
}

const doc = JSON.parse(fs.readFileSync(conductorPath, "utf8"));
const steps = (doc.steps || []).filter((s) => s && s.id);
fs.mkdirSync(dir, { recursive: true });
const statusPath = path.join(dir, "status.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms / SPEED));
const nowIso = () => new Date().toISOString();
function write(state) {
  fs.writeFileSync(statusPath, JSON.stringify(state, null, 2));
}

// ---- Phase-5 heartbeat helpers -------------------------------------------

const oneLine = (s) =>
  String(s || "").trim().split("\n").map((x) => x.trim()).find(Boolean) || "";
const goalOf = (step) => oneLine(step.instruction) || step.id;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function beat(entry, note, extra = {}) {
  (entry.heartbeat ||= []).push({ at: nowIso(), note, ...extra });
}

// the id of the step the agent will move to next — for a finalBeat handoff
function nextStepId(step, idx) {
  if (step.then) return step.then;
  const after = steps[idx + 1];
  return after ? after.id : "wrap-up";
}

function maybeInsight(step) {
  return {
    type: "instruction",
    seed: `${step.id}: stating the exact output path in the instruction would remove a guess.`,
    step: step.id,
    confidence: Math.random() < 0.5 ? "high" : "medium",
  };
}

// 1–2 working heartbeats while a step runs; sometimes one carries an insight.
async function workBeats(step, entry, state, idx) {
  beat(entry, `Working ${step.id} against its instruction: "${goalOf(step)}".`);
  write({ ...state });
  await sleep(750);

  const withInsight = idx === 1 || /review|seo|security|audit|write/.test(step.id);
  const note = pick([
    "Making progress; collecting output the checker can inspect.",
    `${step.id} taking shape; checking it against the goal.`,
    `Cross-checking the work so far against "${goalOf(step)}".`,
  ]);
  beat(entry, note, withInsight && Math.random() < 0.7 ? { insight: maybeInsight(step) } : {});
  write({ ...state });
  await sleep(700);
}

function addLearnings(step, entry) {
  if (!/review|seo|security|audit|outline|research/.test(step.id)) return;
  entry.learnings = pick([
    [`${step.id}: making the instruction concrete kept the work on-target.`],
    [`${step.id}: naming the expected evidence made the checker result clearer.`],
  ]);
}

function finalBeat(step, entry, state, idx) {
  const to = nextStepId(step, idx);
  const handoff = { to, context: `${step.id} satisfied its instruction check; ${to} can build on it.` };
  if (step.output) handoff.produced = step.output;
  beat(entry, `${step.id} complete — checker passed. Handing off to ${to}.`, {
    finalBeat: true,
    handoff,
  });
}

function buildSuggestions(walked) {
  const ids = walked.length ? walked : steps.map((s) => s.id);
  const a = ids[Math.min(1, ids.length - 1)];
  const b = ids[ids.length - 1];
  return [
    {
      id: "sg-1",
      type: "instruction",
      step: a,
      title: `Tighten ${a}'s instruction`,
      rationale: `Heartbeats on ${a} show the checker would benefit from a more concrete output contract.`,
      source_heartbeat: nowIso(),
      proposed: `Produce the requested output and include inspectable evidence for ${a}.`,
      impact: "clearer checker verdict",
      confidence: "high",
    },
    {
      id: "sg-2",
      type: "instruction",
      step: b,
      title: `Name the output path in ${b}`,
      rationale: `The agent had to infer where ${b} writes its result; stating it removes a guess.`,
      source_heartbeat: nowIso(),
      current: `Write the result.`,
      proposed: `Write the result to ./out/${b}.md.`,
      impact: "fewer retries",
      confidence: "medium",
    },
    {
      id: "sg-3",
      type: "instruction",
      step: ids[0],
      title: `Have ${ids[0]} record sources as it goes`,
      rationale: `Later steps reach back for context; capturing it early in ${ids[0]} avoids re-work.`,
      source_heartbeat: nowIso(),
      impact: "less backtracking",
      confidence: "medium",
    },
  ];
}

function checkerDetail(step, passed) {
  return [{
    criterion: goalOf(step),
    name: step.title || step.id,
    checker: "instruction",
    passed,
    evidence: passed
      ? `Simulated checker verified output against: ${goalOf(step)}`
      : `Simulated checker found output did not satisfy: ${goalOf(step)}`,
  }];
}

async function runLoop(step, state, idx) {
  const items = loopItems();
  const subs = (step.steps || []).filter((s) => s && s.id);
  const entry = {
    status: "running",
    type: "loop",
    total: items.length,
    completed: 0,
    current_item: null,
    started_at: nowIso(),
    iterations: {},
  };
  for (const item of items) {
    entry.iterations[item] = {};
    for (const sub of subs) {
      entry.iterations[item][sub.id] = { status: "pending", gate: "pending", attempt: 1 };
    }
  }
  state.steps[step.id] = entry;
  state.current_step_goal = goalOf(step);
  beat(entry, `Starting the loop over ${items.length} items.`);
  write({ ...state });
  await sleep(500);

  for (let k = 0; k < items.length; k++) {
    const item = items[k];
    entry.current_item = item;
    // breathing beat — read prior context, state what to apply (spec §4.3)
    beat(
      entry,
      k === 0
        ? `${item}: first iteration, no prior finalBeat. Starting fresh.`
        : `${item}: read ${items[k - 1]}'s finalBeat + open insights. Applying learnings. Starting.`,
      { iteration: item },
    );
    write({ ...state });
    for (const sub of subs) {
      const cell = entry.iterations[item][sub.id];
      cell.status = "running";
      write({ ...state });
      await sleep(650);
      cell.gate = "checking";
      write({ ...state });
      await sleep(650);
      if (failStep === sub.id && item === items[0] && cell.attempt === 1) {
        cell.gate = "failed";
        cell.gate_detail = checkerDetail(sub, false);
        beat(entry, `${item}: ${sub.id} checker failed — retrying.`, { iteration: item });
        write({ ...state });
        await sleep(650);
        cell.attempt = 2;
        cell.gate = "pending";
        cell.status = "running";
        write({ ...state });
        await sleep(650);
        cell.gate = "checking";
        write({ ...state });
        await sleep(650);
      }
      cell.status = "done";
      cell.gate = "passed";
      cell.gate_detail = checkerDetail(sub, true);
      write({ ...state });
      await sleep(220);
    }
    entry.completed += 1;
    const nextItem = items[k + 1];
    beat(entry, `${item} done${nextItem ? ` — handing off to ${nextItem}.` : "."}`, {
      iteration: item,
      finalBeat: true,
      ...(nextItem ? { handoff: { to_iteration: nextItem, context: `pattern from ${item} carries forward` } } : {}),
    });
    write({ ...state });
    await sleep(280);
  }

  entry.status = "done";
  entry.gate = "passed";
  entry.gate_detail = checkerDetail(step, true);
  entry.current_item = null;
  entry.completed_at = nowIso();
  finalBeat(step, entry, state, idx);
  write({ ...state });
}

async function run() {
  // timestamp run id, e.g. 2026-06-03T14-30-00 (matches the archive filename prefix)
  const runId = nowIso().replace(/\.\d+Z$/, "").replace(/:/g, "-");
  const wfName = doc.name || "workflow";
  const nameSlug = String(wfName).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let priorRuns = 0;
  try {
    priorRuns = fs.readdirSync(path.join(dir, "history")).filter((f) => f.endsWith(".json")).length;
  } catch {
    /* no history */
  }
  const state = {
    conductor: "2.0.0",
    workflow: wfName,
    run_id: runId,
    run_name: `${nameSlug}-run-${priorRuns + 1}-${runId.replace(/-\d{2}$/, "")}`,
    auto_improve: doc.auto_improve !== false,
    _demo: true, // marks simulated data — the board shows a DEMO banner
    started_at: nowIso(),
    status: "running",
    goal: (doc.description || "").trim().replace(/\s+/g, " "),
    current_step: null,
    current_step_goal: null,
    steps: {},
  };
  for (const s of steps) state.steps[s.id] = { status: "pending", gate: "pending", attempt: 1 };
  write(state);
  await sleep(700);

  // Simple linear walk honoring conditions: take if_true when present.
  let i = 0;
  const indexById = new Map(steps.map((s, idx) => [s.id, idx]));
  const visited = new Set();
  const walked = [];

  while (i < steps.length) {
    const step = steps[i];
    if (visited.has(step.id)) {
      i++;
      continue;
    }
    visited.add(step.id);
    walked.push(step.id);
    state.current_step = step.id;
    const entry = state.steps[step.id];

    // loop step — walk each item through the sub-step sequence
    if (step.type === "loop") {
      await runLoop(step, state, i);
      i++;
      continue;
    }

    // running
    entry.status = "running";
    entry.started_at = nowIso();
    state.current_step_goal = goalOf(step);
    beat(entry, `Starting ${step.id}. Orienting against the goal and instruction.`);
    write({ ...state });
    await sleep(800);

    if (step.type === "condition") {
      const branch = step.if_true || step.if_false;
      beat(entry, `Decision: taking the "${branch}" branch.`);
      entry.status = "done";
      entry.gate = "passed";
      entry.gate_detail = checkerDetail(step, true);
      entry.completed_at = nowIso();
      entry.branch_taken = branch;
      beat(entry, `Branch chosen. Handing off to ${branch}.`, {
        finalBeat: true,
        handoff: { to: branch, context: `condition ${step.id} routed here` },
      });
      write({ ...state });
      await sleep(700);
      i = indexById.get(branch) ?? i + 1;
      continue;
    }

    // working heartbeats
    await workBeats(step, entry, state, i);

    // independent checker phase
    entry.gate = "checking";
    beat(entry, "Independent checker is comparing output to the instruction.");
    write({ ...state });
    await sleep(1200);

    // terminal failure — workflow ends failed (for demoing failed history)
    if (fatalStep === step.id) {
      entry.status = "failed";
      entry.gate = "failed";
      entry.gate_detail = checkerDetail(step, false);
      entry.completed_at = nowIso();
      beat(entry, `${step.id} could not satisfy its instruction check. Stopping.`);
      state.status = "failed";
      state.completed_at = nowIso();
      state.current_step = step.id;
      write({ ...state });
      console.log(`✗ workflow failed at ${step.id}`);
      return;
    }

    const shouldFail = failStep === step.id && entry.attempt === 1;
    if (shouldFail) {
      entry.gate = "failed";
      entry.gate_detail = checkerDetail(step, false);
      beat(entry, "Checker failed on first pass — diagnosing and retrying.");
      write({ ...state });
      await sleep(1000);
      entry.attempt = 2;
      entry.gate = "pending";
      entry.status = "running";
      beat(entry, `Retry: addressing the failed criterion.`);
      write({ ...state });
      await sleep(1000);
      entry.gate = "checking";
      write({ ...state });
      await sleep(1200);
    }

    entry.status = "done";
    entry.gate = "passed";
    entry.gate_detail = checkerDetail(step, true);
    entry.completed_at = nowIso();
    addLearnings(step, entry);
    finalBeat(step, entry, state, i);
    write({ ...state });
    await sleep(600);

    // jump to `then` rejoin if present
    if (step.then && indexById.has(step.then)) {
      i = indexById.get(step.then);
    } else {
      i++;
    }
  }

  // synthesize post-run optimization suggestions, then finish
  state.suggestions = buildSuggestions(walked);
  state.status = "done";
  state.current_step = null;
  state.current_step_goal = null;
  state.completed_at = nowIso();
  write({ ...state });
  console.log("✓ workflow complete");
}

(async () => {
  do {
    await run();
    if (loop) await sleep(2500);
  } while (loop);
})();
