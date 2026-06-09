#!/usr/bin/env node
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { startServer } from "../server/server.js";

const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : null;
const rest = argv.slice(1);

if (argv.includes("--version") || argv.includes("-v")) {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  console.log(pkg.version);
  process.exit(0);
}

function flag(names, fallback) {
  for (const name of names) {
    const i = argv.indexOf(name);
    if (i !== -1) {
      const next = argv[i + 1];
      return next && !next.startsWith("-") ? next : true;
    }
  }
  return fallback;
}

const HELP = `
  conductor-board — independently checked AI-agent workflows, with a live Kanban board

  Usage
    $ npx conductor-board [command] [options]

  Commands
    (default)                Serve the live board (watches .conductor/)
    init                     Scaffold a new .conductor/workflow.json
    validate [path]          Check a conductor against the spec
    cards [path]             Validate card-design output: title/instruction,
                             no ids, gates, or dependencies.
                             [--skill <path>]
    decompose --skill <path> Compose SKILL.md into .conductor/cards.json,
                             then independently check and repair the result
    compile --skill <path>   Reuse an accepted compiled workflow, or run
                             decompose + order + audit + validate and cache it
    integrate --dir <path>   Apply open knowledge.json items to cards.json
                             before a repeat run
    order                    Add requires arrays to .conductor/cards.json,
                             then independently check and repair the graph
    order-audit              Spot-sample the dependency graph with concrete
                             root/dependency/parallelism questions
    coverage                 Verify every card in .conductor/cards.json
                             has a card at the same index in workflow.json.
                             [--cards <json>] [--workflow <json>]
    setup                    Write setup.conductor.json (the bootstrap conductor)
    init-board [workflow]    status-init, start/reuse board, open browser,
                             verify /health and current workflow
    check <step-id>          Print the instruction/output checker prompt
    ps                       List every conductor-board running on this machine
    stop [--all]             Stop this project's board (or every board)
    test --skill <path>      Run a clean structural E2E test in /tmp
    clean [--keep N]         Trim history to the last N runs; add
          [--prune-heartbeats] to archive old update beats (keeps finalBeats + insights)

  Status-writer (for agents — keep status.json live as you work)
    status-init <file>       Generate .conductor/status.json from a workflow
    step <id> <state>        running | done | failed  (state)
    gate <id> <state>        checking | passed | failed
    update <id> "note"       Append a progress update. Alias: heartbeat.
                             Write each note as ONE present-tense status line a
                             person can scan — what changed, what you learned, or
                             what you're handing off. No preamble, no restating
                             the card title.
    heartbeat <id> "note"    Back-compat alias for update (--iteration, --insight-type,
                             --insight-seed, --final, --to <step>)
    suggest "title" --scope SC    Append a learning to the conductor's knowledge:
    knowledge [--min N]      List knowledge / gate on captured-learnings count
    loop-scope <loop> <item...>   Frontload every iteration as pending (scope beat)
    loop <loop> <item> <sub> <state>   Update a loop sub-step
    gate-result <step>[::iter::sub] --passed|--failed [--evidence "..."]
                             Record an independent checker verdict for a card
    complete <step>[::iter::sub]   Consume checker verdict and require an output receipt
    feedback <step>[::iter::sub]   Read latest checker failure and attempts left
    backfill-summaries <status> [--dry-run]   One-shot: regenerate clean verdict
                             summaries into a run's stored gate_detail (stored data only)

  Board options
    --path, -p <file>        Path to status.json   (default: .conductor/status.json)
    --workflow, -c <file>    Path to workflow.json (default: auto-discovered)
    --port <n>               Port to serve on        (default: 3042)
    --headless               Opt in to unattended execution without opening a
                             browser (CI, cron, cloud, no display, or explicit
                             user request). Same as CONDUCTOR_HEADLESS=1.
                             Default: visible board opens before work starts.

  init options
    --name, -n <name>        Workflow name (skips the prompts)
    --description, -d <text> One-line description
    --steps, -s <n>          Number of placeholder steps
    --force, -f              Overwrite an existing workflow.json

  --help, -h                 Show this help

  Examples
    $ npx conductor-board
    $ npx conductor-board init --name clinic-update --steps 4
    $ npx conductor-board validate .conductor/workflow.json
`;

// ---- subcommands ----
if (command === "help" || (!command && flag(["--help", "-h"], false))) {
  console.log(HELP);
  process.exit(0);
}

if (command === "init") {
  const { runInit } = await import("../cli/init.js");
  process.exit((await runInit(rest)) ? 0 : 1);
}

if (command === "validate") {
  const { runValidate } = await import("../cli/validate.js");
  process.exit((await runValidate(rest)) ? 0 : 1);
}

if (command === "cards") {
  const { runCards } = await import("../cli/cards.js");
  process.exit((await runCards(rest)) ? 0 : 1);
}

if (command === "decompose") {
  const { runDecompose } = await import("../cli/decompose.js");
  process.exit((await runDecompose(rest)) ? 0 : 1);
}

if (command === "compile") {
  const { runCompile } = await import("../cli/compile.js");
  process.exit((await runCompile(rest)) ? 0 : 1);
}

if (command === "integrate") {
  const { runIntegration } = await import("../cli/integration.js");
  process.exit((await runIntegration(rest)) ? 0 : 1);
}

if (command === "order") {
  const { runOrder } = await import("../cli/order.js");
  process.exit((await runOrder(rest)) ? 0 : 1);
}

if (command === "order-audit") {
  const { runOrderAudit } = await import("../cli/order.js");
  process.exit((await runOrderAudit(rest)) ? 0 : 1);
}

if (command === "coverage") {
  const { runCoverage } = await import("../cli/coverage.js");
  process.exit((await runCoverage(rest)) ? 0 : 1);
}

if (command === "setup") {
  const { runSetup } = await import("../cli/setup.js");
  process.exit((await runSetup(rest)) ? 0 : 1);
}

if (command === "init-board") {
  const { runInitBoard } = await import("../cli/init-board.js");
  process.exit((await runInitBoard(rest)) ? 0 : 1);
}

if (command === "check") {
  const { runCheck } = await import("../cli/check.js");
  process.exit((await runCheck(rest)) ? 0 : 1);
}

if (command === "ps") {
  const { runPs } = await import("../cli/ps.js");
  process.exit((await runPs()) ? 0 : 1);
}

if (command === "stop") {
  const { runStop } = await import("../cli/stop.js");
  process.exit((await runStop(rest)) ? 0 : 1);
}

if (command === "clean") {
  const { runClean } = await import("../cli/clean.js");
  process.exit((await runClean(rest)) ? 0 : 1);
}

if (command === "test") {
  const { runTest } = await import("../cli/test.js");
  process.exit((await runTest(rest)) ? 0 : 1);
}

// status-writer commands (for agents — keep the board live as you work)
if (["step", "gate", "update", "heartbeat", "overview", "comment", "directives", "resolve", "loop", "loop-scope", "status-init", "suggest", "knowledge"].includes(command)) {
  const w = await import("../cli/writer.js");
  const fn = {
    step: w.runStep,
    gate: w.runGate,
    update: w.runHeartbeat,
    heartbeat: w.runHeartbeat,
    overview: w.runOverview,
    comment: w.runComment,
    directives: w.runDirectives,
    resolve: w.runResolve,
    loop: w.runLoop,
    "loop-scope": w.runLoopScope,
    "status-init": w.runStatusInit,
    suggest: w.runSuggest,
    knowledge: w.runKnowledge,
  }[command];
  process.exit((await fn(rest)) ? 0 : 1);
}

if (command === "complete") {
  const { runComplete } = await import("../cli/complete.js");
  process.exit((await runComplete(rest)) ? 0 : 1);
}

if (command === "feedback") {
  const { runFeedback } = await import("../cli/complete.js");
  process.exit((await runFeedback(rest)) ? 0 : 1);
}

if (command === "gate-result") {
  const { runGateResult } = await import("../cli/complete.js");
  process.exit((await runGateResult(rest)) ? 0 : 1);
}

if (command === "learn-card") {
  const { runLearnCard } = await import("../cli/learning.js");
  process.exit((await runLearnCard(rest)) ? 0 : 1);
}

if (command === "backfill-summaries") {
  const { runBackfillSummaries } = await import("../cli/backfill.js");
  process.exit((await runBackfillSummaries(rest)) ? 0 : 1);
}

if (command && command !== "board") {
  console.error(`Unknown command "${command}". Run with --help to see usage.`);
  process.exit(1);
}

// ---- default: serve the board ----
const statusPath = String(flag(["--path", "-p"], ".conductor/status.json"));
const conductorArg = flag(["--workflow", "--conductor", "-c"], null);
const conductorPath = conductorArg ? path.resolve(process.cwd(), String(conductorArg)) : null;
const wantedPort = Number(flag(["--port"], 3042)) || 3042;
// The board opens the browser by default because visibility is the product.
// --headless (or CONDUCTOR_HEADLESS=1) is for unattended environments: CI,
// cron, cloud/no-display, or an explicit user request.
const headless = argv.includes("--headless") || process.env.CONDUCTOR_HEADLESS === "1";

function openBrowser(url) {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* opening the browser is best-effort */
  }
}

function repoKey(cwd = process.cwd()) {
  return crypto.createHash("sha256").update(path.resolve(cwd)).digest("hex").slice(0, 24);
}

function registryPath(cwd = process.cwd()) {
  return path.join(os.homedir(), ".conductor", "servers", `${repoKey(cwd)}.json`);
}

function readJsonMaybe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function boardBrowserUrl(url, workflow) {
  const u = new URL(url);
  u.pathname = "/";
  if (workflow) u.searchParams.set("wf", workflow);
  return u.toString();
}

function browserAlreadyOpened(registry) {
  const info = readJsonMaybe(registry);
  return typeof info?.browser_opened_at === "string";
}

function syncRegistry(registry, info, extras = {}) {
  writeJson(registry, {
    ...(readJsonMaybe(registry) || {}),
    ...info,
    ...extras,
    repo: path.resolve(process.cwd()),
    registry_key: repoKey(),
    updated_at: new Date().toISOString(),
  });
}

async function listenOnRequestedPort(port) {
  try {
    return await startServer({ statusPath, conductorPath, port });
  } catch (e) {
    if (e && e.code === "EADDRINUSE") {
      throw new Error(`port ${port} is already in use; stop or reuse the existing board instead of starting another port`);
    }
    throw e;
  }
}

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const iris = (s) => `\x1b[38;5;141m${s}\x1b[0m`;
const mint = (s) => `\x1b[38;5;78m${s}\x1b[0m`;
const amber = (s) => `\x1b[38;5;214m${s}\x1b[0m`;

function ago(iso) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function ask(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) return resolve(false); // non-interactive — never block
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

// A pid is "alive" if signalling it doesn't throw ESRCH (EPERM = alive, not ours).
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

// Probe a recorded board's /health endpoint — distinguishes a live, serving
// board (reuse it) from a wedged pid that holds the port but isn't responding.
async function boardHealthy(url) {
  if (!url) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1200);
    const r = await fetch(`${url}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return false;
    const body = await r.json().catch(() => null);
    return !!body && body.status === "ok";
  } catch {
    return false;
  }
}

/**
 * Before binding a port, look for a board already serving this project.
 *
 *  - dead pid / no file → clear any stale server.json, start fresh (returns null)
 *  - live board, non-interactive → REUSE it (returns its info). This is the key
 *    guard against the tab flood: re-running `npx conductor-board` no longer
 *    spawns a second server on the next port and opens another browser tab.
 *  - live board, interactive → ask. "y" kills it and starts fresh (null);
 *    anything else reuses the existing one (returns its info).
 *
 * One board per project — you should never end up with a pile of tabs.
 */
async function preflightStaleBoard(serverJsonPath) {
  let info;
  try {
    info = JSON.parse(fs.readFileSync(serverJsonPath, "utf8"));
  } catch {
    return null; // no (readable) server.json — nothing to do
  }
  const pid = info && info.pid;
  const clear = () => {
    try {
      fs.unlinkSync(serverJsonPath);
    } catch {
      /* already gone */
    }
  };

  if (!pid || !pidAlive(pid)) {
    if (pid) {
      clear();
      console.log(dim(`\n  cleared a stale server.json (pid ${pid} is no longer running).`));
    }
    return null;
  }

  const url = info.url || `http://localhost:${info.port ?? "?"}`;
  const reuse = { reuse: true, pid, url, when: info.started_at ? ago(info.started_at) : "" };

  // Alive but unhealthy (wedged — holds the port but /health doesn't answer):
  // kill it and start fresh, so a hung board can't block a clean restart (§4.6).
  if (!(await boardHealthy(url))) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* may have just exited */
    }
    await new Promise((r) => setTimeout(r, 600));
    clear();
    console.log(amber(`\n  ⚠ board pid ${pid} was unresponsive — stopped it and starting fresh.`));
    return null;
  }

  // Non-interactive (an agent, a script): never duplicate — reuse silently.
  if (!process.stdin.isTTY) return reuse;

  const port = info.port ?? "?";
  const when = info.started_at ? `, started ${ago(info.started_at)}` : "";
  console.log("");
  console.log(`  ${amber("⚠")}  A board is already running on port ${bold(port)} (pid ${pid}${when}).`);
  const yes = await ask(`     Kill it and start a fresh one? ${dim("[y/N]")} `);
  if (yes) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* it may have just exited */
    }
    await new Promise((r) => setTimeout(r, 600)); // let it release the port
    clear();
    console.log(dim(`     stopped pid ${pid}.`));
    return null;
  }
  return reuse;
}

const preflightServerJson = path.join(
  path.dirname(path.resolve(process.cwd(), statusPath)),
  "server.json",
);
const existing = await preflightStaleBoard(preflightServerJson);
if (existing) {
  console.log("");
  console.log(`  ${iris("🎼 conductor-board")}`);
  console.log(
    `  ${bold("Already live at")} ${mint(existing.url)} ${dim(
      `— reusing it (pid ${existing.pid}${existing.when ? ", started " + existing.when : ""})`,
    )}`,
  );
  console.log(`  ${dim("one board per project — not opening another tab. stop that process to restart.")}`);
  console.log("");
  process.exit(0);
}

const { conductorPath: resolvedConductor, absStatus, server, serverJsonPath, workflows } =
  await listenOnRequestedPort(wantedPort);
const port = server.address().port;
const url = `http://localhost:${port}/`;
const registry = registryPath();
const firstWorkflow = (workflows && workflows[0]) || null;
const browserUrl = boardBrowserUrl(url, firstWorkflow);
const rel = (p) => (p ? path.relative(process.cwd(), p) || p : null);

syncRegistry(registry, readJsonMaybe(serverJsonPath) || { port, url, pid: process.pid }, {
  url,
  conductor_root: path.dirname(absStatus),
  status_path: absStatus,
  workflow_path: resolvedConductor,
});

console.log("");
console.log(`  ${iris("🎼 conductor-board")}`);
console.log(`  ${bold("Board live at")} ${mint(browserUrl)} ${dim("— watching " + rel(absStatus))}`);
if (resolvedConductor) {
  console.log(`  ${dim("conductor:  " + rel(resolvedConductor))}`);
} else {
  console.log(`  ${dim("conductor:  not found — cards show status only")}`);
}
console.log(`  ${dim("press ctrl+c to stop")}`);
console.log("");

if (!headless && !browserAlreadyOpened(registry)) {
  openBrowser(browserUrl);
  syncRegistry(registry, readJsonMaybe(serverJsonPath) || { port, url, pid: process.pid }, {
    url,
    conductor_root: path.dirname(absStatus),
    status_path: absStatus,
    workflow_path: resolvedConductor,
    browser_opened_url: browserUrl,
    browser_opened_at: new Date().toISOString(),
  });
}

// Subdirectory convention (§4.7): warn if a flat .conductor/status.json is in
// use. One workflow per .conductor/<name>/ keeps history and insights separate.
try {
  const flat = path.resolve(process.cwd(), ".conductor", "status.json");
  if (path.resolve(absStatus) === flat && fs.existsSync(flat)) {
    console.log(
      amber("  ⚠ flat .conductor/status.json detected") +
        dim(" — the convention is .conductor/<workflow-name>/. It still works,") +
        "\n" +
        dim("    but subdirectories keep each workflow's history + insights separate."),
    );
    console.log("");
  }
} catch {
  /* advisory only */
}

function shutdown() {
  try {
    if (serverJsonPath) fs.unlinkSync(serverJsonPath);
  } catch {
    /* already gone */
  }
  console.log(dim("\n  board stopped\n"));
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGQUIT", shutdown);
