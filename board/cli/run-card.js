import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { dependencyBlockers, dependencyBlockerMessage, resolveTopLevelIndex } from "./dependencies.js";
import { receiptArtifactName, artifactsDir, findReceiptArtifact } from "./artifacts.js";
import { timingEnabled, writeWorkerSidecar } from "./timing.js";

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const amber = (s) => `\x1b[38;5;214m${s}\x1b[0m`;

// The resolved local cli binary — the worker reports through THIS, never npx.
const CLI_BIN = fileURLToPath(new URL("../bin/cli.js", import.meta.url));

function flag(args, names) {
  for (const n of names) {
    const i = args.indexOf(n);
    if (i !== -1) {
      const v = args[i + 1];
      return v && !v.startsWith("-") ? v : true;
    }
  }
  return undefined;
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

const HELP = `
  conductor-board run-card <card-index> - autonomous single-card worker

  Spawns exactly ONE non-interactive agent for ONE eligible card. The agent
  does the card's work, writes the receipt artifact, and reports its own honest
  verdict through the existing CLI verbs (step / check / gate-result / complete).
  Then this command re-reads status.json and prints the verdict.

  Usage
    $ node bin/cli.js run-card <card-index> [options]

  Options
    --path, -p <file>      status.json (default: .conductor/status.json)
    --workflow, -c <file>  workflow.json (default: discovered next to status.json)
    --timeout <ms>         worker timeout (default: 1200000 = 20 min)
    --timing               (opt-in, also needs CONDUCTOR_TIMING=1) run the worker
                           with --output-format stream-json --verbose and parse
                           tool-use events for worker-side timing stamps (written
                           as a sidecar). Default OFF = plain claude -p.
    --print-brief          print the assembled brief and exit (no spawn)
    --help, -h             this help

  Eligibility (a GUARD, not a lock): the card must be status==="pending" AND
  every requires dependency must be status==="done". Otherwise it refuses.
`;

/**
 * Resolve the dependency artifacts a card needs, reading each dep's stored
 * receipt from disk so the worker gets ISOLATED inputs - not the whole run.
 */
function collectDependencyInputs({ doc, status, statusPath, step }) {
  const inputs = [];
  for (const dep of step?.requires || []) {
    const depIndex = Number(dep);
    if (!Number.isInteger(depIndex)) continue;
    const depStep = doc.steps?.[depIndex];
    const depEntry = status?.steps?.[String(depIndex)] || (depStep?.id ? status?.steps?.[depStep.id] : null);
    let abs = null;
    const recorded = depEntry?.artifact || depEntry?.receipt;
    const dir = artifactsDir(statusPath);
    if (recorded) {
      abs = path.isAbsolute(recorded) ? recorded : path.resolve(dir, String(recorded).replace(/^artifacts[\\/]/, ""));
    }
    if (!abs || !fs.existsSync(abs)) {
      const found = findReceiptArtifact({ statusPath, stepId: String(depIndex), entry: depEntry || {}, step: depStep });
      if (found) abs = found.abs;
    }
    if (!abs) abs = path.join(dir, receiptArtifactName(String(depIndex), depStep));
    const rel = `.conductor/artifacts/${path.basename(abs)}`;
    const exists = fs.existsSync(abs) && fs.statSync(abs).isFile();
    inputs.push({
      index: depIndex,
      title: depStep?.title || `card ${depIndex}`,
      abs,
      rel,
      exists,
      text: exists ? fs.readFileSync(abs, "utf8") : null,
    });
  }
  return inputs;
}

/**
 * Compose the one self-contained worker brief: role + task + isolated inputs +
 * output location + the exact verb-only reporting protocol + the honesty rule.
 */
function composeBrief({ cardIndex, step, inputs, receiptRel, statusPath, workflowPath, cwd }) {
  const relStatus = path.relative(cwd, statusPath) || statusPath;
  const relWorkflow = path.relative(cwd, workflowPath) || workflowPath;
  const verb = (v) =>
    `node ${CLI_BIN} ${v} --path ${JSON.stringify(relStatus)} --workflow ${JSON.stringify(relWorkflow)}`;

  const inputBlocks = inputs.length
    ? inputs
        .map((i) =>
          i.exists
            ? `### Dependency artifact - card ${i.index} "${i.title}" (${i.rel})\n\n${i.text}`
            : `### Dependency artifact - card ${i.index} "${i.title}" - MISSING at ${i.rel} (note this gap in your work)`,
        )
        .join("\n\n---\n\n")
    : "(This card has no dependencies. Work only from its instruction.)";

  return `You are a WORKER assigned EXACTLY ONE card in a conductor-board workflow. Do ONLY this card. Do not touch any other card's status, artifact, or files. When this card is reported done, you are finished - exit. Do this card's work yourself. Do not delegate, spawn subagents, or use any Task/Agent tool.

Your working directory is: ${cwd}

# Your card: index ${cardIndex} - "${step.title}"

## Task (this card's instruction)
${String(step.instruction || "").trim()}

# Inputs (the dependency artifacts you may rely on)
${inputBlocks}

# Output location (REQUIRED)
Write your primary markdown receipt to EXACTLY this path (relative to the working dir above):

    ${receiptRel}

The receipt must contain the actual work product (content/data/code/report) or, for an action card, a verifiable action record (command run, return value, changed resource, verification result). A receipt that merely *describes* what was done without proof will fail the rubric.

# Reporting protocol - report ONLY through these shell commands (run them, in order)
All commands use the SAME local conductor-board CLI binary and the SAME status/workflow paths. The environment variable CONDUCTOR_HEADLESS=1 is already set for you, so these run non-interactively. The card has ALREADY been marked running for you — proceed straight to the work.

1. Do the actual work and WRITE the receipt to the output path above.

2. Print the independent checker rubric for this card (it auto-reads your receipt from disk):
   ${verb(`check ${cardIndex}`)}

3. Evaluate YOUR OWN output against that rubric, honestly, in clean judgment. Decide PASS or FAIL.

4. Record the verdict (use --passed only if it genuinely meets the rubric; otherwise --failed):
   ${verb(`gate-result ${cardIndex} --passed --evidence "<your reasoning, ending with a SUMMARY: line>" --summary "<two complete sentences: what was done and how you verified it>"`)}
   (For a failure: replace --passed with --failed and describe what is missing.)

5. Consume the verdict and finalize:
   ${verb(`complete ${cardIndex}`)}

# Honesty rule (the most important rule)
NEVER force-pass. If your output does not meet the rubric, record --failed truthfully and let the attempt count. A false pass is worse than an honest fail. Do not edit status.json directly - report only through the verbs above. Do not run any other conductor-board command than the ones listed.

Begin now. End after step 5.`;
}

/**
 * THE SEAM - launch exactly ONE non-interactive agent, BOUNDED, scoped to cwd,
 * fed the brief, awaited with a timeout. Wired as a single swappable function.
 *
 * Bounding (belt + braces):
 *   1. Tool scope (the leash): the worker gets ONLY the tools a card needs -
 *      Bash, Read, Write, Edit, Glob, Grep - via --allowedTools, with the
 *      delegation tool explicitly denied via --disallowedTools "Task". Under
 *      --permission-mode dontAsk, allowed tools run non-interactively without
 *      prompts and ANY other tool (Task/Agent/Workflow/sub-spawn) is DENIED
 *      without prompting (confirmed against the installed claude --help: choices
 *      include "dontAsk"). The blanket --permission-mode bypassPermissions is
 *      gone - that was what let the worker freely use its own Task tool and
 *      balloon to 43 processes.
 *   2. Process-group seatbelt: the worker runs DETACHED in its own process group;
 *      a poller counts its descendant subtree (pgrep -P, recursively). If the
 *      descendant count exceeds DESCENDANT_CAP (5) OR the timeout elapses, the
 *      ENTIRE process group is SIGKILLed (process.kill(-pgid, "SIGKILL")). The
 *      max descendant count observed is recorded and returned. This caps any
 *      runaway even if the tool-restriction flags somehow fail.
 *
 * Codex fallback: scoped to --sandbox workspace-write with -c
 * approval_policy="never" (no bypass, no subagent path), --add-dir for the
 * status/workflow dir so it can write the receipt + run node, run detached under
 * the same process-group guard.
 *
 * Override with CONDUCTOR_WORKER_CMD (a shell command; brief on stdin) to swap
 * the runtime without touching this file. The bounded invocation is the default.
 */
const DESCENDANT_CAP = 5;

// Allow-list: only what a card needs to do its own work + report through the CLI
// verbs (node bin/cli.js ...). NOT Task/Agent/Workflow - no delegation path.
const WORKER_ALLOWED_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep"];
const WORKER_DISALLOWED_TOOLS = ["Task"];

/** Count the live descendant subtree of a pid via pgrep -P (recursive). */
function countDescendants(rootPid) {
  let count = 0;
  const stack = [rootPid];
  const seen = new Set();
  while (stack.length) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    const r = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
    if (r.status !== 0 || !r.stdout) continue;
    for (const line of r.stdout.split(/\s+/)) {
      const child = Number(line.trim());
      if (Number.isInteger(child) && child > 0 && !seen.has(child)) {
        count++;
        stack.push(child);
      }
    }
  }
  return count;
}

/**
 * Run a command DETACHED in its own process group, await it (bounded by timeout),
 * poll its descendant subtree, and SIGKILL the whole group on cap-breach or
 * timeout. Returns a summarizeRun-shaped object plus maxDescendants/killedReason.
 */
function spawnBounded(cmd, argv, { cwd, env, timeoutMs, input, onStreamLine }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, {
      cwd,
      env,
      detached: true, // new process group => we can kill -pgid
      stdio: ["pipe", "pipe", "pipe"],
    });
    const pgid = child.pid; // detached child is its own group leader
    let stdout = "";
    let stderr = "";
    let maxDescendants = 0;
    let killedReason = null;
    let settled = false;
    // TIMEKEEPER: line-split buffer so the stream parser sees whole JSON events
    // as they arrive. Only used when onStreamLine is provided (--timing on).
    let lineBuf = "";

    child.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      if (stdout.length > 64 * 1024 * 1024) stdout = stdout.slice(-64 * 1024 * 1024);
      if (onStreamLine) {
        lineBuf += s;
        let nl;
        while ((nl = lineBuf.indexOf("\n")) !== -1) {
          const line = lineBuf.slice(0, nl);
          lineBuf = lineBuf.slice(nl + 1);
          if (line.trim()) {
            try { onStreamLine(line); } catch { /* parser must never break the run */ }
          }
        }
      }
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 8 * 1024 * 1024) stderr = stderr.slice(-8 * 1024 * 1024);
    });

    if (input != null) {
      try { child.stdin.write(input); child.stdin.end(); } catch { /* ignore */ }
    }

    const killGroup = (reason) => {
      if (killedReason) return;
      killedReason = reason;
      try { process.kill(-pgid, "SIGKILL"); } catch { /* group may be gone */ }
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
    };

    const poll = setInterval(() => {
      const n = countDescendants(pgid);
      if (n > maxDescendants) maxDescendants = n;
      if (n > DESCENDANT_CAP) killGroup(`descendant cap exceeded (${n} > ${DESCENDANT_CAP})`);
    }, 1000);

    const timer = setTimeout(() => killGroup("timeout"), timeoutMs);

    const finish = (status, signal, error) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);
      resolve({
        status,
        signal,
        timedOut: killedReason === "timeout",
        error: error ? error.message : (killedReason ? `killed: ${killedReason}` : null),
        stdout,
        stderr,
        maxDescendants,
        killedReason,
      });
    };

    child.on("error", (err) => finish(null, null, err));
    child.on("close", (code, signal) => finish(code, signal, null));
  });
}

/**
 * TIMEKEEPER worker-side stream parser. Consumes claude --output-format
 * stream-json --verbose events (one JSON object per line) and stamps the
 * worker-side boundaries with arrival wall-clock (run-card is the parent
 * reading the pipe, so arrival time IS the observable time):
 *   t_boot_done    — first stream event AFTER the system/init event.
 *   t_first_action — first tool_use for Bash/Read/Write/Edit (a real action).
 *   t_gate         — the tool_use whose Bash command runs `gate-result`.
 * Also tracks t_first_observable (first event of any kind) for the BRACKET case.
 * Returns { onLine, stamps } — onLine is fed each raw stdout line.
 */
function makeStreamParser() {
  const stamps = {
    t_first_observable: null,
    t_boot_done: null,
    t_first_action: null,
    t_gate: null,
    saw_init: false,
  };
  const ACTION_TOOLS = new Set(["Bash", "Read", "Write", "Edit"]);
  const onLine = (line) => {
    const now = Date.now();
    if (stamps.t_first_observable == null) stamps.t_first_observable = now;
    let o;
    try { o = JSON.parse(line); } catch { return; }
    const type = o.type;
    if (type === "system" && o.subtype === "init") {
      stamps.saw_init = true;
      return;
    }
    // t_boot_done: first event after init (worker ready / first own output).
    if (stamps.saw_init && stamps.t_boot_done == null) stamps.t_boot_done = now;
    // tool_use events live on assistant messages.
    if (type === "assistant" && o.message && Array.isArray(o.message.content)) {
      for (const b of o.message.content) {
        if (b && b.type === "tool_use") {
          const name = b.name || "";
          const cmd = (b.input && (b.input.command || b.input.cmd)) || "";
          if (ACTION_TOOLS.has(name) && stamps.t_first_action == null) {
            stamps.t_first_action = now;
          }
          // t_gate: the gate-result emission (Bash tool running gate-result).
          if (name === "Bash" && /gate-result/.test(String(cmd)) && stamps.t_gate == null) {
            stamps.t_gate = now;
          }
        }
      }
    }
  };
  return { onLine, stamps };
}

async function spawnWorker(brief, cwd, { timeoutMs, extraDir, timing }) {
  const env = { ...process.env, CONDUCTOR_HEADLESS: "1" };

  if (process.env.CONDUCTOR_WORKER_CMD) {
    // CONDUCTOR_WORKER_CMD is a shell command; run it via sh -c with brief on stdin,
    // bounded by the same detached-process-group + descendant-cap guard.
    const rr = await spawnBounded("/bin/sh", ["-c", process.env.CONDUCTOR_WORKER_CMD], { cwd, env, timeoutMs, input: brief });
    return { runtime: "CONDUCTOR_WORKER_CMD", ...rr };
  }

  const has = (cmd) => spawnSync(cmd, ["--version"], { encoding: "utf8", stdio: "ignore" }).status === 0;

  if (has("claude")) {
    const args = [
      "-p", brief,
      "--permission-mode", "dontAsk",
      "--allowedTools", WORKER_ALLOWED_TOOLS.join(" "),
      "--disallowedTools", WORKER_DISALLOWED_TOOLS.join(" "),
    ];
    // TIMEKEEPER: only when --timing is on, run the worker in stream/verbose mode
    // so tool-use events surface for the worker-side boundary parse. Default OFF
    // means today\x27s plain `claude -p` invocation is byte-identical.
    let parser = null;
    if (timing) {
      args.push("--output-format", "stream-json", "--verbose");
      parser = makeStreamParser();
    }
    if (extraDir) { args.push("--add-dir", extraDir); }
    const r = await spawnBounded("claude", args, {
      cwd,
      env,
      timeoutMs,
      onStreamLine: parser ? parser.onLine : undefined,
    });
    return {
      runtime: `claude -p --permission-mode dontAsk --allowedTools "${WORKER_ALLOWED_TOOLS.join(" ")}" --disallowedTools "Task"`
        + (timing ? " --output-format stream-json --verbose" : ""),
      workerStamps: parser ? parser.stamps : null,
      ...r,
    };
  }

  if (has("codex")) {
    const args = [
      "exec", "-",
      "--skip-git-repo-check",
      "--sandbox", "workspace-write",
      "-c", "approval_policy=\"never\"",
      "--color", "never",
    ];
    if (extraDir) { args.push("--add-dir", extraDir); }
    const r = await spawnBounded("codex", args, { cwd, env, timeoutMs, input: brief });
    return { runtime: "codex exec - --sandbox workspace-write -c approval_policy=never", ...r };
  }

  return { runtime: "none", status: null, error: "no worker runtime found (need claude or codex on PATH)", maxDescendants: 0 };
}

function summarizeRun(r) {
  return {
    status: r.status,
    signal: r.signal,
    timedOut: r.error && r.error.code === "ETIMEDOUT",
    error: r.error ? r.error.message : null,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
}

export async function runRunCard(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return true;
  }

  const [cardArg] = positionals(args);
  const p = flag(args, ["--path", "-p"]);
  const statusPath = path.resolve(process.cwd(), typeof p === "string" ? p : ".conductor/status.json");
  const wfArg = flag(args, ["--workflow", "--conductor", "-c"]);
  const timeoutMs = Number(flag(args, ["--timeout"])) || 1200000;
  const cwd = process.cwd();

  if (cardArg === undefined) {
    console.error(red("usage: node bin/cli.js run-card <card-index> [--path status.json] [--workflow workflow.json]"));
    return false;
  }

  let workflowPath = null;
  if (typeof wfArg === "string") workflowPath = path.resolve(cwd, wfArg);
  else {
    const guess = path.join(path.dirname(statusPath), "workflow.json");
    if (fs.existsSync(guess)) workflowPath = guess;
  }
  if (!workflowPath || !fs.existsSync(workflowPath)) {
    console.error(red(`no workflow.json found (pass --workflow). looked next to ${statusPath}`));
    return false;
  }
  if (!fs.existsSync(statusPath)) {
    console.error(red(`no status.json at ${statusPath}`));
    return false;
  }

  let doc;
  let status;
  try {
    doc = readJson(workflowPath);
    status = readJson(statusPath);
  } catch (e) {
    console.error(red(`could not parse workflow/status: ${e.message}`));
    return false;
  }

  // 1. Find the card by index/id.
  const cardIndex = resolveTopLevelIndex(doc, cardArg);
  if (cardIndex === null) {
    console.error(red(`workflow has no card "${cardArg}"`));
    return false;
  }
  const step = doc.steps[cardIndex];
  const entry = status.steps?.[String(cardIndex)] || (step?.id ? status.steps?.[step.id] : null) || {};

  // 2. Eligibility pre-flight (GUARD, not a lock): not-yet-terminal + all deps done.
  // The dispatcher now CLAIMS a card by writing status:"running" BEFORE spawning
  // this worker (flip-to-running-at-hand-out), so "running" is the EXPECTED state
  // here, not a refusal. We still refuse a card that is already terminal
  // (done/failed/blocked) or in any unexpected non-runnable state.
  if (entry.status && entry.status !== "pending" && entry.status !== "running") {
    console.error(red(`card ${cardIndex} is "${entry.status}", not "pending"/"running" - refusing to run. (Guard, not a lock.)`));
    return false;
  }
  const blockers = dependencyBlockers(doc, status, String(cardIndex));
  if (blockers.length) {
    console.error(red(dependencyBlockerMessage(cardIndex, blockers)));
    return false;
  }

  // 3. Assemble isolated inputs from each dependency's artifact on disk.
  const inputs = collectDependencyInputs({ doc, status, statusPath, step });

  // 4. Compute the expected receipt path (where complete will look).
  const receiptName = receiptArtifactName(String(cardIndex), step);
  const receiptAbs = path.join(artifactsDir(statusPath), receiptName);
  const receiptRel = path.relative(cwd, receiptAbs) || receiptAbs;

  // 5. Compose the worker brief.
  const brief = composeBrief({ cardIndex, step, inputs, receiptRel, statusPath, workflowPath, cwd });

  if (args.includes("--print-brief")) {
    console.log(brief);
    return true;
  }

  console.log("");
  console.log(`  ${bold("run-card")} - single-card worker`);
  console.log(`  card ${cardIndex}: ${bold(step.title)}`);
  console.log(dim(`  status:   ${statusPath}`));
  console.log(dim(`  workflow: ${workflowPath}`));
  console.log(dim(`  receipt:  ${receiptRel}`));
  console.log(
    dim(
      `  inputs:   ${inputs.length ? inputs.map((i) => `${i.index}${i.exists ? "" : "(missing)"}`).join(", ") : "none"}`,
    ),
  );
  console.log(dim(`  cli:      ${CLI_BIN}`));

  // 5b. IDEMPOTENTLY ensure the card is running BEFORE spawning the slow worker.
  // Under the dispatcher the card is already running (claimed at hand-out); this
  // covers the DIRECT `run-card <id>` path (no dispatcher) so it, too, flips to
  // running at start rather than waiting for the worker to boot+ingest. The worker
  // brief no longer instructs `step running` — this is now the single flip point.
  try {
    const fresh = readJson(statusPath);
    const key = fresh.steps?.[String(cardIndex)] ? String(cardIndex) : (step?.id && fresh.steps?.[step.id] ? step.id : String(cardIndex));
    const cur = (fresh.steps[key] = fresh.steps[key] || { attempt: 1 });
    if (cur.status !== "running") {
      cur.status = "running";
      cur.started_at = cur.started_at || new Date().toISOString();
      cur.gate = cur.gate && cur.gate !== "passed" ? cur.gate : "pending";
      fresh.current_step = key;
      fs.mkdirSync(path.dirname(statusPath), { recursive: true });
      fs.writeFileSync(statusPath, JSON.stringify(fresh, null, 2));
    }
  } catch (e) {
    console.log(amber(`  could not pre-mark card ${cardIndex} running: ${e.message}`));
  }

  // 6. THE SEAM - spawn exactly one worker, await it.
  // TIMEKEEPER (opt-in: --timing AND CONDUCTOR_TIMING=1): turn on the worker-side
  // stream capture. Default OFF => plain `claude -p`, byte-identical behavior.
  const TIMING = timingEnabled(args);
  console.log(dim(`  spawning worker (timeout ${Math.round(timeoutMs / 1000)}s)...`));
  const extraDir = path.dirname(statusPath);
  const result = await spawnWorker(brief, cwd, { timeoutMs, extraDir, timing: TIMING });

  // TIMEKEEPER: drop the worker-side stamps as a sidecar for the dispatcher to
  // fold into its per-card row. Best-effort; absence => the dispatcher BRACKETS.
  if (TIMING && result.workerStamps) {
    const sc = writeWorkerSidecar(statusPath, cardIndex, result.workerStamps);
    if (sc) console.log(dim(`  timing: worker stamps -> ${sc}`));
  }
  console.log(dim(`  runtime:  ${result.runtime}`));
  console.log(dim(`  max worker-subtree descendants observed: ${result.maxDescendants ?? "?"}` + (result.killedReason ? ` (process group SIGKILLed: ${result.killedReason})` : "")));
  if (result.stdout) console.log(dim(`\n  --- worker stdout (tail) ---\n${tail(result.stdout, 4000)}\n`));
  if (result.stderr && result.stderr.trim()) console.log(dim(`  --- worker stderr (tail) ---\n${tail(result.stderr, 1500)}\n`));
  if (result.error) console.log(amber(`  worker process note: ${result.error}${result.timedOut ? " (TIMED OUT)" : ""}`));

  // 7. Emit the verdict - re-read status.json from disk; stat the artifact.
  let after;
  try {
    after = readJson(statusPath);
  } catch (e) {
    console.error(red(`could not re-read status.json after worker: ${e.message}`));
    return false;
  }
  const a = after.steps?.[String(cardIndex)] || (step?.id ? after.steps?.[step.id] : null) || {};
  const gateDetail = Array.isArray(a.gate_detail) ? a.gate_detail : [];
  const lastVerdict = [...gateDetail].reverse().find((d) => d && typeof d.passed === "boolean") || null;
  const beats = Array.isArray(a.heartbeat) ? a.heartbeat : [];
  const lastBeat = beats.length ? beats[beats.length - 1] : null;
  const artifactExists = fs.existsSync(receiptAbs) && fs.statSync(receiptAbs).isFile();
  const artifactSize = artifactExists ? fs.statSync(receiptAbs).size : 0;

  const reachedDone = a.status === "done";

  console.log("");
  console.log(`  ${bold("=== VERDICT ===")}`);
  console.log(`  card ${cardIndex} status:  ${reachedDone ? green(a.status) : amber(a.status || "pending")}`);
  console.log(`  gate:               ${a.gate || "pending"}`);
  console.log(`  attempt:            ${a.attempt ?? "?"}`);
  console.log(
    `  artifact:           ${artifactExists ? green(`present (${artifactSize} bytes)`) : red("MISSING")} at ${receiptRel}`,
  );
  if (lastVerdict) {
    console.log(`  gate-result:        ${lastVerdict.passed ? green("PASSED") : red("FAILED")}`);
    if (lastVerdict.summary) console.log(dim(`    summary: ${lastVerdict.summary}`));
  } else {
    console.log(`  gate-result:        ${red("none recorded")}`);
  }
  if (!reachedDone && lastBeat) {
    console.log(dim(`  last beat: ${lastBeat.note || ""}`));
  }
  console.log("");

  const pass = reachedDone && artifactExists && !!lastVerdict;
  console.log(pass ? green("  card reached done with a recorded verdict and a real artifact.") : red("  card did NOT complete cleanly - see verdict above."));
  console.log("");
  return pass;
}

function tail(s, n) {
  const str = String(s);
  return str.length <= n ? str : "..." + str.slice(str.length - n);
}
