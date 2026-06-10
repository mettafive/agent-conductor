import fs from "node:fs";
import path from "node:path";

import { runCompile } from "./compile.js";
import { runStatusInit } from "./writer.js";
import { runDispatch } from "./dispatch.js";
import { openRunBoard } from "./init-board.js";
import { integrateRoot } from "./integration.js";
import { scopedConductorDir } from "./learning.js";
import { selectAdapter, adapterCap, workerLine } from "./worker-adapters.js";

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const iris = (s) => `\x1b[38;5;141m${s}\x1b[0m`;

const HELP = `
  conductor-board run <skill> — compile-if-needed → board → dispatch, in one command

  Takes a skill from ANY state to the right outcome by one rule:
    Run everything that isn't done. If everything's done, rerun fresh.
  A re-run skips compile (the compiled workflow is reused) and skips done cards,
  so only a brand-new (or changed) skill pays the first compile.

  Usage
    $ node bin/cli.js run SKILL.md [options]

  Options
    --name, -n <name>      Scoped conductor name (default: derived from the skill)
    --cap <n>              Max concurrent run-card workers (passed to dispatch)
    --port <n>             Board port (default: 3042)
    --force, -f            Recompile even if a compiled workflow already exists
    --headless             Don't open a browser (CI/cron/cloud). Same as
                           CONDUCTOR_HEADLESS=1. Default: a visible board opens.
    --help, -h             this help

  Worker: chosen automatically at start and printed —
    CONDUCTOR_WORKER_CMD → claude → codex → loud error (need one on PATH).
`;

function flag(args, names, fallback) {
  for (const name of names) {
    const i = args.indexOf(name);
    if (i !== -1) {
      const next = args[i + 1];
      return next && !next.startsWith("-") ? next : true;
    }
  }
  return fallback;
}

function positionals(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("-")) {
      const v = args[i + 1];
      if (v && !v.startsWith("-")) i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// Open insights carried by the skill (normalized status, matching integration's
// knowledgeStatus). Empty if no knowledge.json or none open.
function openInsightsForRoot(root) {
  let kn;
  try {
    kn = JSON.parse(fs.readFileSync(path.join(root, "knowledge.json"), "utf8"));
  } catch {
    return [];
  }
  if (!kn || !Array.isArray(kn.items)) return [];
  return kn.items.filter((it) => it && String(it.status ?? "open").trim().toLowerCase() === "open");
}

function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

// The status-map key for a workflow step at index i (mirrors dispatch/run-card).
function statusKey(status, doc, index) {
  if (status.steps?.[String(index)]) return String(index);
  const id = doc.steps?.[index]?.id;
  if (id && status.steps?.[id]) return id;
  return String(index);
}

function cardStatus(status, doc, index) {
  const key = statusKey(status, doc, index);
  return status.steps?.[key]?.status || "pending";
}

/**
 * THE STATE MODEL (the spine): one rule against the run's status.json.
 *   - no status / unreadable      → "new"          (status-init, run all)
 *   - every card done             → "rerun-fresh"  (status-init, run all again)
 *   - any card not done           → "resume"       (reset failed + stranded
 *                                                    running → pending; keep done)
 * Failed is NOT special — it is just "not done". Returns the decision label.
 */
function decideRunState(statusPath, doc) {
  if (!fs.existsSync(statusPath)) return { mode: "new" };
  let status;
  try {
    status = readJson(statusPath);
  } catch {
    return { mode: "new" }; // unreadable/corrupt → treat as new
  }
  const n = doc.steps.length;
  const statuses = [];
  for (let i = 0; i < n; i++) statuses.push(cardStatus(status, doc, i));
  const allDone = statuses.length > 0 && statuses.every((s) => s === "done");
  if (allDone) return { mode: "rerun-fresh" };
  return { mode: "resume", status, statuses };
}

/**
 * Resume in place: reset failed + stranded-running cards to pending (fresh
 * breaker count — the dispatcher's per-run hand count starts from zero), leave
 * done cards untouched, flip the run back to running. Dispatch then hands the
 * not-done set whose deps are satisfied.
 */
function applyResume(statusPath, status, doc) {
  let reset = 0;
  let kept = 0;
  for (let i = 0; i < doc.steps.length; i++) {
    const key = statusKey(status, doc, i);
    const step = (status.steps[key] = status.steps[key] || { attempt: 1 });
    if (step.status === "done") {
      kept++;
      continue;
    }
    if (step.status === "failed" || step.status === "running") {
      step.status = "pending";
      if (step.gate === "checking" || step.gate === "running" || step.gate === "failed") step.gate = "pending";
      delete step.completed_at;
      reset++;
    }
  }
  status.status = "running";
  status.current_step = null;
  saveJson(statusPath, status);
  return { reset, kept };
}

export async function runRun(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return true;
  }

  const [skillArg] = positionals(args);
  if (!skillArg) {
    console.error(red("usage: conductor-board run SKILL.md [--name N] [--cap N] [--port N] [--force] [--headless]"));
    return false;
  }
  const skillPath = path.resolve(process.cwd(), skillArg);
  if (!fs.existsSync(skillPath) || !fs.statSync(skillPath).isFile()) {
    console.error(red(`✗ skill file not found: ${path.relative(process.cwd(), skillPath)}`));
    return false;
  }

  const name = typeof flag(args, ["--name", "-n"]) === "string" ? String(flag(args, ["--name", "-n"])) : undefined;
  const port = Number(flag(args, ["--port"], 3042)) || 3042;
  const cap = flag(args, ["--cap"]);
  const force = args.includes("--force") || args.includes("-f");
  const headless = args.includes("--headless") || process.env.CONDUCTOR_HEADLESS === "1";

  // Scoped paths — compile writes here; init-board + dispatch read here. Threading
  // these everywhere is what closes the path coupling (compile scopes to
  // .conductor/<slug>/ but the other verbs default to flat .conductor/).
  const outDir = scopedConductorDir(skillPath, name);
  const workflowPath = path.join(outDir, "workflow.json");
  const statusPath = path.join(outDir, "status.json");

  console.log("");
  console.log(`  ${iris("🎼 conductor-board run")} ${dim(`— ${path.relative(process.cwd(), skillPath)}`)}`);

  // 0. WORKER (choose once, print once, fail loud). Done BEFORE the expensive
  //    compile so "no worker" fails fast and nothing is dispatched (audit §4b).
  const adapter = selectAdapter();
  if (!adapter) {
    console.error(red(`  ${workerLine(null)}`));
    return false;
  }
  console.log(`  ${bold(workerLine(adapter, adapterCap(adapter)))}`);

  // 1. COMPILE-IF-NEEDED. The durable compiled workflow is the "already-compiled"
  //    signal: reuse it unless --force or the skill is newer (edited) than it.
  //    runCompile itself is cache-aware (compile-meta.json) — this just avoids
  //    invoking it at all when the artifact is clearly current.
  const haveWorkflow = fs.existsSync(workflowPath);
  const skillNewer = haveWorkflow && fs.statSync(skillPath).mtimeMs > fs.statSync(workflowPath).mtimeMs;
  const needCompile = force || !haveWorkflow || skillNewer;
  if (needCompile) {
    const why = force ? "forced" : !haveWorkflow ? "new skill" : "skill changed";
    console.log(dim(`  compile: ${why} — compiling…`));
    const compileArgs = ["--skill", skillPath, "--out-dir", outDir];
    if (name) compileArgs.push("--name", name);
    if (force) compileArgs.push("--force");
    const ok = await runCompile(compileArgs);
    if (!ok) {
      console.error(red("  ✗ compile failed — not dispatching."));
      return false;
    }
  } else {
    console.log(dim(`  compile: reusing compiled workflow (${path.relative(process.cwd(), workflowPath)})`));
  }

  if (!fs.existsSync(workflowPath)) {
    console.error(red(`  ✗ no workflow.json at ${path.relative(process.cwd(), workflowPath)} after compile`));
    return false;
  }

  // 1b. INTEGRATION LEADS (continuous flow, audit Change 1). If the skill carries
  //     open insights, SHAPE the plan first — on the same board surface — then
  //     chain into the work dispatch below. One command, no second confirm.
  const openInsights = openInsightsForRoot(outDir);
  if (openInsights.length) {
    console.log(`  ${iris("shaping:")} ${openInsights.length} open insight(s) — integration leads, then work.`);
    // Bring the board up now (best-effort) so the integration feed is visible as
    // the shaping cards run; the authoritative work-board open happens below.
    // Interactive only — headless/CI doesn't need the early window.
    if (!headless) {
      try { await openRunBoard(statusPath, workflowPath, { headless, port }); } catch { /* best-effort */ }
    }
    let integrated = false;
    try {
      integrated = await integrateRoot({ root: outDir, skillPath });
    } catch (e) {
      // 3c: integration must never crash the run with a wall. A thrown error is
      // treated as a failed shaping card — halt cleanly, do not dispatch work.
      console.error(red(`  ✗ integration errored: ${e.message}`));
      integrated = false;
    }
    if (!integrated) {
      // 3c: a failed integration is a visible failed shaping card on the board;
      // the run HALTS cleanly here — work is NEVER run on a half-integrated plan.
      // No crash, no 500.
      console.error(red("  ✗ integration failed — halting. Work is not run on a half-integrated plan."));
      console.error(dim("    See the failed shaping card on the board, then retry (run again) or clear the open insight."));
      return false;
    }
    // integration rewrote workflow.json / cards.json — the doc read below picks
    // up the updated plan, and the state model runs the integrated workflow.
  }

  let doc;
  try {
    doc = readJson(workflowPath);
  } catch (e) {
    console.error(red(`  ✗ could not read compiled workflow: ${e.message}`));
    return false;
  }

  // 2. STATE MODEL — new / rerun-fresh / resume.
  const decision = decideRunState(statusPath, doc);
  if (decision.mode === "new" || decision.mode === "rerun-fresh") {
    const label = decision.mode === "new" ? "new run" : "all cards done — rerunning fresh";
    console.log(dim(`  state: ${label} — status-init (all cards pending).`));
    const ok = await runStatusInit([workflowPath, "--path", statusPath]);
    if (!ok) {
      console.error(red("  ✗ status-init failed."));
      return false;
    }
  } else {
    const { reset, kept } = applyResume(statusPath, decision.status, doc);
    console.log(dim(`  state: resume — ${kept} done kept, ${reset} not-done reset to pending.`));
    if (reset === 0 && kept === doc.steps.length) {
      // Defensive: decideRunState already routes all-done to rerun-fresh; this is
      // only reachable on a race. Nothing to do.
      console.log(dim("  (nothing to resume.)"));
    }
  }

  // 3. ALWAYS-OPEN RUN BOARD — on the RUN's scoped files (not compile's progress
  //    board). Attaches to a live board on the port, else spawns one.
  const board = await openRunBoard(statusPath, workflowPath, { headless, port });
  if (!board.healthy) {
    console.error(red(`  ✗ board did not become healthy on port ${port} — not dispatching.`));
    return false;
  }
  console.log(`  ${green("board:")} ${board.browserUrl || board.url} ${dim(`(workflow: ${board.workflow})`)}`);
  if (headless) console.log(dim("  (headless — not opening a browser.)"));

  // 4. DISPATCH — the live run, scoped. runDispatch runs its loop and exits the
  //    process when every card is terminal, so this is the terminal step.
  console.log(dim("  dispatching…"));
  console.log("");
  const dispatchArgs = ["--path", statusPath, "--workflow", workflowPath];
  if (typeof cap === "string") dispatchArgs.push("--cap", cap);
  return await runDispatch(dispatchArgs);
}
